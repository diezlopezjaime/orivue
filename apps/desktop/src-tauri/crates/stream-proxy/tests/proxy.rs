use std::net::SocketAddr;
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Redirect, Response};
use axum::routing::get;
use axum::Router;
use orivue_stream_proxy::{DestinationPolicy, OpenSession, ProxyHandle, ProxyOptions, ProxyServer};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Seen {
    user_agents: Vec<String>,
    ranges: Vec<String>,
}

async fn upstream() -> (SocketAddr, Arc<Mutex<Seen>>) {
    let seen = Arc::new(Mutex::new(Seen::default()));
    let app = Router::new()
        .route(
            "/live/index.m3u8",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")],
                    "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:4,\nseg0.ts\n",
                )
            }),
        )
        .route(
            "/live/seg0.ts",
            get(
                |State(seen): State<Arc<Mutex<Seen>>>, headers: HeaderMap| async move {
                    let mut seen = seen.lock().unwrap();
                    seen.user_agents.push(
                        headers
                            .get(header::USER_AGENT)
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("")
                            .to_string(),
                    );
                    if let Some(range) = headers.get(header::RANGE) {
                        seen.ranges.push(range.to_str().unwrap().to_string());
                    }
                    (
                        [(header::CONTENT_TYPE, "video/mp2t")],
                        vec![0x47u8; 188 * 3],
                    )
                },
            ),
        )
        .route(
            "/redirect",
            get(|| async { Redirect::temporary("/live/index.m3u8") }),
        )
        .route("/missing", get(|| async { StatusCode::NOT_FOUND }))
        .route(
            "/big.txt",
            get(|| async { Response::new(Body::from(vec![b'a'; 2048])) }),
        )
        .with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (address, seen)
}

async fn start() -> ProxyHandle {
    ProxyServer::start(ProxyOptions::default()).await.unwrap()
}

fn open(url: String) -> OpenSession {
    OpenSession {
        url,
        headers: Default::default(),
        allow_loopback: true,
        allow_private: false,
    }
}

#[tokio::test]
async fn rejects_private_destinations_unless_allowed() {
    let proxy = start().await;
    let error = proxy
        .open(OpenSession {
            url: "http://10.255.255.1/x.ts".into(),
            headers: Default::default(),
            allow_loopback: true,
            allow_private: false,
        })
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        orivue_stream_proxy::ProxyError::PrivateDestination
    ));
    let error = proxy
        .open(OpenSession {
            url: "http://127.0.0.1:9/x.ts".into(),
            headers: Default::default(),
            allow_loopback: false,
            allow_private: false,
        })
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        orivue_stream_proxy::ProxyError::PrivateDestination
    ));
    assert_eq!(proxy.session_count(), 0);
    proxy.shutdown();
}

#[tokio::test]
async fn relays_streams_with_headers_and_rewrites_manifests() {
    let (address, seen) = upstream().await;
    let proxy = start().await;
    let mut request = open(format!("http://{address}/redirect"));
    request
        .headers
        .insert("User-Agent".into(), "CustomAgent/1".into());
    request
        .headers
        .insert("Cookie".into(), "bad\r\nvalue".into());
    let session = proxy.open(request).await.unwrap();
    assert_eq!(session.status, 200);
    assert_eq!(
        session.content_type.as_deref(),
        Some("application/vnd.apple.mpegurl")
    );
    assert!(session.url.starts_with(proxy.base_url()));
    // The session URL points at the final (redirected) manifest.
    assert!(session.url.contains("index%2Em3u8"));

    let client = reqwest::Client::new();
    let manifest = client
        .get(&session.url)
        .header(header::ORIGIN, "tauri://localhost")
        .send()
        .await
        .unwrap();
    assert_eq!(manifest.status(), 200);
    assert_eq!(
        manifest
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .unwrap(),
        "tauri://localhost"
    );
    let text = manifest.text().await.unwrap();
    let segment_line = text
        .lines()
        .find(|line| line.contains("seg0"))
        .expect("segment rewritten");
    assert!(segment_line.starts_with(proxy.base_url()));
    assert!(text.contains(&format!("URI=\"{}/s/", proxy.base_url())));

    let segment = client
        .get(segment_line)
        .header(header::RANGE, "bytes=0-187")
        .send()
        .await
        .unwrap();
    assert_eq!(segment.status(), 200);
    assert_eq!(
        segment.headers().get(header::CONTENT_TYPE).unwrap(),
        "video/mp2t"
    );
    assert_eq!(
        segment.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    assert_eq!(segment.bytes().await.unwrap().len(), 188 * 3);
    {
        let seen = seen.lock().unwrap();
        assert_eq!(seen.user_agents, vec!["CustomAgent/1"]);
        assert_eq!(seen.ranges, vec!["bytes=0-187"]);
    }

    // Origins outside the session and bad tokens are refused.
    let outside = client
        .get(format!(
            "{}/s/{}/{}/r?u=http%3A%2F%2Fexample.invalid%2Fx.ts",
            proxy.base_url(),
            session.id,
            proxy.token()
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(outside.status(), 403);
    let bad_token = client
        .get(session.url.replace(proxy.token(), "nottoken"))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_token.status(), 403);

    // Unknown origins do not get CORS headers.
    let foreign = client
        .get(&session.url)
        .header(header::ORIGIN, "https://evil.test")
        .send()
        .await
        .unwrap();
    assert!(foreign
        .headers()
        .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
        .is_none());

    assert!(proxy.close(&session.id));
    assert!(!proxy.close(&session.id));
    let closed = client.get(&session.url).send().await.unwrap();
    assert_eq!(closed.status(), 404);
    proxy.shutdown();
}

#[tokio::test]
async fn reports_upstream_errors_and_handles_preflight() {
    let (address, _) = upstream().await;
    let proxy = start().await;
    let error = proxy
        .open(open(format!("http://{address}/missing")))
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        orivue_stream_proxy::ProxyError::UpstreamStatus(404)
    ));
    let session = proxy
        .open(open(format!("http://{address}/live/seg0.ts")))
        .await
        .unwrap();
    let client = reqwest::Client::new();
    let preflight = client
        .request(reqwest::Method::OPTIONS, &session.url)
        .header(header::ORIGIN, "http://tauri.localhost")
        .send()
        .await
        .unwrap();
    assert_eq!(preflight.status(), 204);
    assert_eq!(
        preflight
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
            .unwrap(),
        "range, content-type"
    );
    let head = client.head(&session.url).send().await.unwrap();
    assert_eq!(head.status(), 200);
    assert_eq!(
        head.headers().get(header::CONTENT_TYPE).unwrap(),
        "video/mp2t"
    );
    let health = client
        .get(format!("{}/health/{}", proxy.base_url(), proxy.token()))
        .send()
        .await
        .unwrap();
    assert_eq!(
        health.text().await.unwrap(),
        "{\"status\":\"ok\",\"sessions\":1}"
    );
    proxy.shutdown();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(client.get(&session.url).send().await.is_err());
}

#[tokio::test]
async fn fetch_text_enforces_limits() {
    let (address, _) = upstream().await;
    let proxy = start().await;
    let options = orivue_stream_proxy::FetchTextOptions {
        headers: Default::default(),
        max_bytes: 1024,
        timeout: Duration::from_secs(5),
        policy: DestinationPolicy::AllowLoopback,
    };
    let error = proxy
        .fetch_text(&format!("http://{address}/big.txt"), options.clone())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("size limit"));
    let fetched = proxy
        .fetch_text(
            &format!("http://{address}/redirect"),
            orivue_stream_proxy::FetchTextOptions {
                max_bytes: 1 << 20,
                ..options
            },
        )
        .await
        .unwrap();
    assert!(fetched.text.starts_with("#EXTM3U"));
    assert!(fetched.final_url.ends_with("/live/index.m3u8"));
    proxy.shutdown();
}
