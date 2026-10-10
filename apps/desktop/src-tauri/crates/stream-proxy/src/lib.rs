//! Loopback media proxy.
//!
//! The webview cannot fetch IPTV streams directly: providers do not send CORS
//! headers, some require custom request headers and MPEG-TS has to be fed to
//! `mpegts.js` through `fetch`. This crate runs a tiny HTTP server bound to
//! `127.0.0.1` on a random port. Every request must carry the per-run token,
//! must belong to an open playback session and may only reach origins that the
//! session discovered (the channel URL, its redirects and the URLs referenced
//! by HLS manifests). Private and loopback destinations are refused unless the
//! session explicitly allows them (local Ace Stream engine, development).

mod net;
mod rewrite;
mod server;
mod session;

pub use net::{is_private_ip, validate_destination, DestinationPolicy};
pub use server::{FetchTextOptions, FetchedText, ProxyHandle, ProxyOptions, ProxyServer};
pub use session::{OpenSession, SessionHeaders, SessionInfo};

#[derive(Debug, thiserror::Error)]
pub enum ProxyError {
    #[error("the URL is not valid")]
    InvalidUrl,
    #[error("only HTTP and HTTPS streams are supported")]
    UnsupportedScheme,
    #[error("private, loopback and link-local destinations are blocked")]
    PrivateDestination,
    #[error("the destination could not be resolved")]
    UnresolvedHost,
    #[error("the requested resource is outside this playback session")]
    OutsideSession,
    #[error("too many redirects")]
    TooManyRedirects,
    #[error("the stream could not be reached: {0}")]
    Upstream(String),
    #[error("upstream returned HTTP {0}")]
    UpstreamStatus(u16),
    #[error("the session does not exist")]
    UnknownSession,
    #[error("the proxy is not running")]
    NotRunning,
    #[error("{0}")]
    Io(String),
}

impl From<std::io::Error> for ProxyError {
    fn from(error: std::io::Error) -> Self {
        ProxyError::Io(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, ProxyError>;
