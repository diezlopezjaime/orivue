use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::net::DestinationPolicy;

/// Request headers declared by the playlist entry (`User-Agent`, `Referer`...).
pub type SessionHeaders = HashMap<String, String>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSession {
    pub url: String,
    #[serde(default)]
    pub headers: SessionHeaders,
    /// Loopback only (local engines). Ignored when `allow_private` is set.
    #[serde(default)]
    pub allow_loopback: bool,
    /// LAN sources, explicit user setting.
    #[serde(default)]
    pub allow_private: bool,
}

impl OpenSession {
    pub fn policy(&self) -> DestinationPolicy {
        if self.allow_private {
            DestinationPolicy::AllowPrivate
        } else if self.allow_loopback {
            DestinationPolicy::AllowLoopback
        } else {
            DestinationPolicy::PublicOnly
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    /// URL the player should load. Always on the loopback proxy.
    pub url: String,
    /// Content type reported by the upstream probe, if any.
    pub content_type: Option<String>,
    pub status: u16,
}

pub(crate) struct Session {
    pub id: String,
    pub policy: DestinationPolicy,
    pub headers: SessionHeaders,
    pub origins: std::sync::Mutex<HashSet<String>>,
    pub client: reqwest::Client,
    pub cancel: CancellationToken,
}

impl Session {
    pub fn allows(&self, url: &Url) -> bool {
        self.origins
            .lock()
            .map(|origins| origins.contains(&url.origin().ascii_serialization()))
            .unwrap_or(false)
    }

    pub fn register(&self, url: &Url) {
        if let Ok(mut origins) = self.origins.lock() {
            origins.insert(url.origin().ascii_serialization());
        }
    }
}

pub(crate) type SharedSession = Arc<Session>;
