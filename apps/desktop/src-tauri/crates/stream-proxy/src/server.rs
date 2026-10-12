use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use futures_util::{StreamExt, TryStreamExt};
use rand::RngCore;
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::net::{validate_destination, DestinationPolicy};
use crate::rewrite::{looks_like_manifest, proxied_url, rewrite_manifest};
use crate::session::{OpenSession, Session, SessionHeaders, SessionInfo, SharedSession};
use crate::{ProxyError, Result};

const MAX_REDIRECTS: usize = 5;
const MANIFEST_LIMIT: usize = 4 * 1024 * 1024;
const FORWARDED_RESPONSE_HEADERS: [&str; 4] = [
    "content-type",
    "content-length",
    "accept-ranges",
    "content-range",
];
/// Time allowed to open the TCP/TLS connection.
const CONNECT_TIMEOUT_SECS: u64 = 20;
/// Time allowed between two chunks of a response; large panels take a while
/// to start generating a playlist or a guide.
const READ_TIMEOUT_SECS: u64 = 120;

const ALLOWED_REQUEST_HEADERS: [&str; 7] = [
    "user-agent",
    "referer",
    "origin",
    "cookie",
    "authorization",
    "x-forwarded-for",
    "accept-language",
];

#[derive(Clone, Debug)]
pub struct ProxyOptions {
    /// Webview origins allowed to use `fetch` against the proxy (CORS).
    pub allowed_origins: Vec<String>,
    /// Default `User-Agent` when the playlist does not declare one.
    pub user_agent: String,
}

impl Default for ProxyOptions {
    fn default() -> Self {
        Self {
            allowed_origins: vec![
                "tauri://localhost".into(),
                "http://tauri.localhost".into(),
                "https://tauri.localhost".into(),
                "http://localhost:5173".into(),
                "http://127.0.0.1:5173".into(),
                "http://127.0.0.1:4173".into(),
                "http://localhost:4173".into(),
            ],
            // Many IPTV panels drop requests from clients they do not
            // recognise, so the default identifies as VLC. Sources and the
            // settings can override it per request.
            user_agent: "VLC/3.0.21 LibVLC/3.0.21".into(),
        }
    }
}

pub(crate) struct ProxyState {
    token: String,
    base_url: String,
    options: ProxyOptions,
    sessions: Mutex<HashMap<String, SharedSession>>,
}

/// Running proxy. Dropping it does not stop the server; call [`ProxyHandle::shutdown`].
#[derive(Clone)]
pub struct ProxyHandle {
    state: Arc<ProxyState>,
    shutdown: CancellationToken,
}

pub struct ProxyServer;

/// Result of a bounded text download (playlists, guides, JSON APIs).
#[derive(Clone, Debug)]
pub struct FetchedText {
    pub text: String,
    pub status: u16,
    pub content_type: Option<String>,
    pub final_url: String,
}

#[derive(Clone, Debug)]
pub struct FetchTextOptions {
    pub headers: SessionHeaders,
    pub max_bytes: usize,
    pub timeout: Duration,
    pub policy: DestinationPolicy,
}

impl ProxyServer {
    /// Binds `127.0.0.1:0` and starts serving in the current Tokio runtime.
    pub async fn start(options: ProxyOptions) -> Result<ProxyHandle> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let address = listener.local_addr()?;
        let state = Arc::new(ProxyState {
            token: random_hex(32),
            base_url: format!("http://127.0.0.1:{}", address.port()),
            options,
            sessions: Mutex::new(HashMap::new()),
        });
        let shutdown = CancellationToken::new();
        let app = Router::new()
            .route(
                "/s/{session}/{token}/r",
                get(relay).head(relay).options(preflight),
            )
            .route("/health/{token}", get(health))
            .with_state(state.clone());
        let stop = shutdown.clone();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move { stop.cancelled().await })
                .await;
        });
        Ok(ProxyHandle { state, shutdown })
    }
}

impl ProxyHandle {
    pub fn base_url(&self) -> &str {
        &self.state.base_url
    }

    pub fn token(&self) -> &str {
        &self.state.token
    }

    pub fn shutdown(&self) {
        self.close_all();
        self.shutdown.cancel();
    }

    /// Opens a playback session: validates the destination, probes it once and
    /// returns the loopback URL the player should load.
    pub async fn open(&self, request: OpenSession) -> Result<SessionInfo> {
        let policy = request.policy();
        let url = validate_destination(&request.url, policy).await?;
        let id = random_hex(12);
        let session = Arc::new(Session {
            id: id.clone(),
            policy,
            headers: sanitize_headers(&request.headers),
            origins: Mutex::new(std::iter::once(url.origin().ascii_serialization()).collect()),
            client: build_client()?,
            cancel: CancellationToken::new(),
        });
        let probe = tokio::time::timeout(
            Duration::from_secs(20),
            upstream_get(&session, &url, None, &self.state.options.user_agent),
        )
        .await
        .map_err(|_| ProxyError::Upstream("timeout".into()))?;
        let (response, final_url) = match probe {
            Ok(value) => value,
            Err(error) => {
                session.cancel.cancel();
                return Err(error);
            }
        };
        let status = response.status().as_u16();
        let content_type = header_string(response.headers(), header::CONTENT_TYPE);
        drop(response);
        if !(200..300).contains(&status) {
            session.cancel.cancel();
            return Err(ProxyError::UpstreamStatus(status));
        }
        self.state
            .sessions
            .lock()
            .map_err(|_| ProxyError::Io("lock".into()))?
            .insert(id.clone(), session);
        Ok(SessionInfo {
            id: id.clone(),
            url: proxied_url(
                &self.state.base_url,
                &id,
                &self.state.token,
                final_url.as_str(),
            ),
            content_type,
            status,
        })
    }

    pub fn close(&self, id: &str) -> bool {
        let removed = self
            .state
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(id));
        match removed {
            Some(session) => {
                session.cancel.cancel();
                true
            }
            None => false,
        }
    }

    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.state.sessions.lock() {
            for (_, session) in sessions.drain() {
                session.cancel.cancel();
            }
        }
    }

    pub fn session_count(&self) -> usize {
        self.state
            .sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or(0)
    }

    /// Downloads a text resource with the same destination rules as playback.
    pub async fn fetch_text(
        &self,
        raw_url: &str,
        options: FetchTextOptions,
    ) -> Result<FetchedText> {
        let url = validate_destination(raw_url, options.policy).await?;
        let session = Session {
            id: String::new(),
            policy: options.policy,
            headers: sanitize_headers(&options.headers),
            origins: Mutex::new(std::iter::once(url.origin().ascii_serialization()).collect()),
            client: build_client()?,
            cancel: CancellationToken::new(),
        };
        let work = async {
            let (response, final_url) =
                upstream_get(&session, &url, None, &self.state.options.user_agent).await?;
            let status = response.status().as_u16();
            if !(200..300).contains(&status) {
                return Err(ProxyError::UpstreamStatus(status));
            }
            let content_type = header_string(response.headers(), header::CONTENT_TYPE);
            let limit_error = || {
                ProxyError::Upstream(format!(
                    "the source exceeds the size limit of {} MB",
                    options.max_bytes / (1024 * 1024)
                ))
            };
            if let Some(length) = response.content_length() {
                if length as usize > options.max_bytes {
                    return Err(limit_error());
                }
            }
            let mut stream = response.bytes_stream();
            let mut buffer: Vec<u8> = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| ProxyError::Upstream(error.to_string()))?;
                if buffer.len() + chunk.len() > options.max_bytes {
                    return Err(limit_error());
                }
                buffer.extend_from_slice(&chunk);
            }
            Ok(FetchedText {
                text: String::from_utf8_lossy(&buffer).into_owned(),
                status,
                content_type,
                final_url: final_url.to_string(),
            })
        };
        tokio::time::timeout(options.timeout, work)
            .await
            .map_err(|_| {
                ProxyError::Upstream(format!(
                    "no response within {} s",
                    options.timeout.as_secs()
                ))
            })?
    }
}

fn build_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .read_timeout(Duration::from_secs(READ_TIMEOUT_SECS))
        .tcp_nodelay(true)
        .build()
        .map_err(|error| ProxyError::Io(error.to_string()))
}

fn sanitize_headers(input: &SessionHeaders) -> SessionHeaders {
    input
        .iter()
        .filter(|(name, value)| {
            ALLOWED_REQUEST_HEADERS.contains(&name.to_ascii_lowercase().as_str())
                && value.len() <= 4096
                && !value.chars().any(|c| c == '\r' || c == '\n' || c == '\0')
        })
        .map(|(name, value)| (name.to_ascii_lowercase(), value.clone()))
        .collect()
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buffer);
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn header_string(
    headers: &reqwest::header::HeaderMap,
    name: reqwest::header::HeaderName,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

/// Performs a GET following redirects manually so every hop is validated and
/// registered as an allowed origin of the session.
async fn upstream_get(
    session: &Session,
    url: &Url,
    range: Option<&str>,
    default_user_agent: &str,
) -> Result<(reqwest::Response, Url)> {
    let mut current = url.clone();
    for _ in 0..=MAX_REDIRECTS {
        let mut request = session
            .client
            .get(current.as_str())
            .header(header::ACCEPT, "*/*");
        let mut has_user_agent = false;
        for (name, value) in &session.headers {
            if name == "user-agent" {
                has_user_agent = true;
            }
            request = request.header(name.as_str(), value.as_str());
        }
        if !has_user_agent {
            request = request.header(header::USER_AGENT, default_user_agent);
        }
        if let Some(range) = range {
            request = request.header(header::RANGE, range);
        }
        let response = request
            .send()
            .await
            .map_err(|error| ProxyError::Upstream(describe_reqwest_error(&error)))?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| ProxyError::Upstream("redirect without location".into()))?;
            let next = current.join(location).map_err(|_| ProxyError::InvalidUrl)?;
            let validated = validate_destination(next.as_str(), session.policy).await?;
            session.register(&validated);
            current = validated;
            continue;
        }
        return Ok((response, current));
    }
    Err(ProxyError::TooManyRedirects)
}

fn describe_reqwest_error(error: &reqwest::Error) -> String {
    if error.is_connect() && error.is_timeout() {
        format!("no connection after {CONNECT_TIMEOUT_SECS} s")
    } else if error.is_timeout() {
        format!("no data received for {READ_TIMEOUT_SECS} s")
    } else if error.is_connect() {
        "connection failed".into()
    } else {
        "request failed".into()
    }
}

#[derive(Deserialize)]
struct RelayQuery {
    u: String,
}

fn cors_headers(state: &ProxyState, request_headers: &HeaderMap, response: &mut HeaderMap) {
    if let Some(origin) = request_headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        if state
            .options
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
        {
            if let Ok(value) = HeaderValue::from_str(origin) {
                response.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
                response.insert(header::VARY, HeaderValue::from_static("Origin"));
                response.insert(
                    header::ACCESS_CONTROL_EXPOSE_HEADERS,
                    HeaderValue::from_static(
                        "content-length, content-range, accept-ranges, content-type",
                    ),
                );
            }
        }
    }
}

async fn preflight(
    State(state): State<Arc<ProxyState>>,
    Path((_session, token)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if token != state.token {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    cors_headers(&state, &headers, response.headers_mut());
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("range, content-type"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    response
}

async fn health(State(state): State<Arc<ProxyState>>, Path(token): Path<String>) -> Response {
    if token != state.token {
        return StatusCode::FORBIDDEN.into_response();
    }
    let sessions = state
        .sessions
        .lock()
        .map(|sessions| sessions.len())
        .unwrap_or(0);
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        format!("{{\"status\":\"ok\",\"sessions\":{sessions}}}"),
    )
        .into_response()
}

fn error_response(error: ProxyError) -> Response {
    let status = match error {
        ProxyError::UnknownSession => StatusCode::NOT_FOUND,
        ProxyError::OutsideSession
        | ProxyError::PrivateDestination
        | ProxyError::UnsupportedScheme => StatusCode::FORBIDDEN,
        ProxyError::InvalidUrl => StatusCode::BAD_REQUEST,
        ProxyError::UpstreamStatus(code) => {
            StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY)
        }
        _ => StatusCode::BAD_GATEWAY,
    };
    let mut response = (status, error.to_string()).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn relay(
    State(state): State<Arc<ProxyState>>,
    Path((session_id, token)): Path<(String, String)>,
    Query(query): Query<RelayQuery>,
    method: Method,
    request_headers: HeaderMap,
) -> Response {
    if token != state.token {
        return StatusCode::FORBIDDEN.into_response();
    }
    let session = match state
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&session_id).cloned())
    {
        Some(session) => session,
        None => return error_response(ProxyError::UnknownSession),
    };
    let mut response =
        match relay_inner(&state, &session, &query.u, &method, &request_headers).await {
            Ok(response) => response,
            Err(error) => error_response(error),
        };
    cors_headers(&state, &request_headers, response.headers_mut());
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    response
}

async fn relay_inner(
    state: &ProxyState,
    session: &SharedSession,
    raw_url: &str,
    method: &Method,
    request_headers: &HeaderMap,
) -> Result<Response> {
    let url = Url::parse(raw_url).map_err(|_| ProxyError::InvalidUrl)?;
    if !session.allows(&url) {
        return Err(ProxyError::OutsideSession);
    }
    let url = validate_destination(url.as_str(), session.policy).await?;
    let range = request_headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let (upstream, final_url) = tokio::select! {
        result = upstream_get(session, &url, range, &state.options.user_agent) => result?,
        _ = session.cancel.cancelled() => return Err(ProxyError::UnknownSession),
    };
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if !(status.is_success() || status == StatusCode::PARTIAL_CONTENT) {
        return Err(ProxyError::UpstreamStatus(status.as_u16()));
    }
    let content_type = header_string(upstream.headers(), header::CONTENT_TYPE);
    let mut headers = HeaderMap::new();
    for name in FORWARDED_RESPONSE_HEADERS {
        if let Some(value) = upstream.headers().get(name) {
            if let Ok(name) = HeaderName::from_bytes(name.as_bytes()) {
                headers.insert(name, value.clone());
            }
        }
    }
    if method == Method::HEAD {
        let mut response = status.into_response();
        *response.headers_mut() = headers;
        return Ok(response);
    }
    if looks_like_manifest(content_type.as_deref(), &final_url) {
        let text = read_bounded(upstream, MANIFEST_LIMIT, &session.cancel).await?;
        let (rewritten, found) = rewrite_manifest(
            &text,
            &final_url,
            &state.base_url,
            &session.id,
            &state.token,
        );
        for reference in found {
            if reference.scheme() == "http" || reference.scheme() == "https" {
                session.register(&reference);
            }
        }
        headers.remove(header::CONTENT_LENGTH);
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/vnd.apple.mpegurl"),
        );
        let mut response = (status, rewritten).into_response();
        for (name, value) in headers.iter() {
            response.headers_mut().insert(name.clone(), value.clone());
        }
        return Ok(response);
    }
    let cancel = session.cancel.clone();
    let stream = upstream
        .bytes_stream()
        .map_err(std::io::Error::other)
        .take_until(async move { cancel.cancelled().await });
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}

async fn read_bounded(
    response: reqwest::Response,
    limit: usize,
    cancel: &CancellationToken,
) -> Result<String> {
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        let next: Option<reqwest::Result<Bytes>> = tokio::select! {
            chunk = stream.next() => chunk,
            _ = cancel.cancelled() => return Err(ProxyError::UnknownSession),
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|error| ProxyError::Upstream(error.to_string()))?;
        if buffer.len() + chunk.len() > limit {
            return Err(ProxyError::Upstream("manifest too large".into()));
        }
        buffer.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buffer).into_owned())
}
