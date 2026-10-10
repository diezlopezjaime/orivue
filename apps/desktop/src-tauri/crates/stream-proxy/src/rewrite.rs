use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use url::Url;

/// Builds the proxied form of an upstream URL for a session.
pub fn proxied_url(base: &str, session_id: &str, token: &str, upstream: &str) -> String {
    format!(
        "{base}/s/{session_id}/{token}/r?u={}",
        utf8_percent_encode(upstream, NON_ALPHANUMERIC)
    )
}

/// Rewrites every URI of an HLS manifest so the player keeps going through the
/// proxy. Returns the rewritten text and the absolute upstream URLs found.
pub fn rewrite_manifest(
    manifest: &str,
    manifest_url: &Url,
    base: &str,
    session_id: &str,
    token: &str,
) -> (String, Vec<Url>) {
    let mut found = Vec::new();
    let mut output = String::with_capacity(manifest.len() + manifest.len() / 2);
    for line in manifest.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            output.push_str(line);
        } else if let Some(rest) = trimmed.strip_prefix('#') {
            if rest.contains("URI=\"") {
                output.push_str(&rewrite_attribute_uris(
                    trimmed,
                    manifest_url,
                    base,
                    session_id,
                    token,
                    &mut found,
                ));
            } else {
                output.push_str(line);
            }
        } else if let Ok(absolute) = manifest_url.join(trimmed) {
            output.push_str(&proxied_url(base, session_id, token, absolute.as_str()));
            found.push(absolute);
        } else {
            output.push_str(line);
        }
        output.push('\n');
    }
    (output, found)
}

fn rewrite_attribute_uris(
    line: &str,
    manifest_url: &Url,
    base: &str,
    session_id: &str,
    token: &str,
    found: &mut Vec<Url>,
) -> String {
    let mut output = String::with_capacity(line.len() * 2);
    let mut rest = line;
    while let Some(index) = rest.find("URI=\"") {
        let (head, tail) = rest.split_at(index + 5);
        output.push_str(head);
        match tail.find('"') {
            Some(end) => {
                let uri = &tail[..end];
                match manifest_url.join(uri) {
                    Ok(absolute) => {
                        output.push_str(&proxied_url(base, session_id, token, absolute.as_str()));
                        found.push(absolute);
                    }
                    Err(_) => output.push_str(uri),
                }
                rest = &tail[end..];
            }
            None => {
                output.push_str(tail);
                rest = "";
            }
        }
    }
    output.push_str(rest);
    output
}

pub fn looks_like_manifest(content_type: Option<&str>, url: &Url) -> bool {
    let typed = content_type
        .map(|value| value.to_ascii_lowercase())
        .is_some_and(|value| value.contains("mpegurl") || value.contains("vnd.apple.mpegurl"));
    typed || url.path().to_ascii_lowercase().ends_with(".m3u8") || url.path().ends_with(".m3u")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_segments_and_attribute_uris() {
        let manifest = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"keys/1.key\"\n#EXTINF:4,\nseg1.ts\nhttps://cdn.test/abs/seg2.ts\n";
        let url = Url::parse("https://host.test/live/index.m3u8").unwrap();
        let (text, found) = rewrite_manifest(manifest, &url, "http://127.0.0.1:1", "sess", "tok");
        assert!(text.contains(
            "http://127.0.0.1:1/s/sess/tok/r?u=https%3A%2F%2Fhost%2Etest%2Flive%2Fseg1%2Ets"
        ));
        assert!(text.contains("URI=\"http://127.0.0.1:1/s/sess/tok/r?u=https%3A%2F%2Fhost%2Etest%2Flive%2Fkeys%2F1%2Ekey\""));
        assert!(text.contains("u=https%3A%2F%2Fcdn%2Etest%2Fabs%2Fseg2%2Ets"));
        assert_eq!(found.len(), 3);
        assert_eq!(found[2].host_str(), Some("cdn.test"));
    }

    #[test]
    fn detects_manifests() {
        let url = Url::parse("https://h.test/a.m3u8").unwrap();
        assert!(looks_like_manifest(None, &url));
        let ts = Url::parse("https://h.test/a.ts").unwrap();
        assert!(!looks_like_manifest(Some("video/mp2t"), &ts));
        assert!(looks_like_manifest(
            Some("application/vnd.apple.mpegurl"),
            &ts
        ));
    }
}
