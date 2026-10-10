use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    pub url: String,
    /// Live streams get latency chasing; on-demand streams report position.
    #[serde(default)]
    pub live: Option<bool>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// `hls`, `mpegts`, `http` or `unknown`; lets the player pick a media source.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedRequest {
    pub paused: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeRequest {
    pub volume: f32,
    #[serde(default)]
    pub muted: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AspectRequest {
    /// `contain`, `cover` or `fill`.
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeekRequest {
    pub position_seconds: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRequest {
    /// `audio` or `text`.
    pub kind: String,
    /// Track id as reported by `get_tracks`; `null` disables text tracks.
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackHandlingRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub selected: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracks {
    #[serde(default)]
    pub audio: Vec<Track>,
    #[serde(default)]
    pub text: Vec<Track>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    #[serde(default)]
    pub tv: bool,
    #[serde(default)]
    pub touchscreen: bool,
    #[serde(default)]
    pub manufacturer: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub player_available: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Empty {}
