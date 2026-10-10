use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::Error;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<OrivueNative<R>> {
    Ok(OrivueNative(app.clone()))
}

/// Desktop builds have no native player: every call reports `Unavailable` so
/// the UI falls back to the web player.
pub struct OrivueNative<R: Runtime>(AppHandle<R>);

impl<R: Runtime> OrivueNative<R> {
    pub fn load(&self, _request: LoadRequest) -> crate::Result<()> {
        Err(Error::Unavailable)
    }

    pub fn stop(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn set_paused(&self, _request: PausedRequest) -> crate::Result<()> {
        Err(Error::Unavailable)
    }

    pub fn set_volume(&self, _request: VolumeRequest) -> crate::Result<()> {
        Err(Error::Unavailable)
    }

    pub fn set_aspect(&self, _request: AspectRequest) -> crate::Result<()> {
        Err(Error::Unavailable)
    }

    pub fn seek(&self, _request: SeekRequest) -> crate::Result<()> {
        Err(Error::Unavailable)
    }

    pub fn select_track(&self, _request: TrackRequest) -> crate::Result<()> {
        Err(Error::Unavailable)
    }

    pub fn get_tracks(&self) -> crate::Result<Tracks> {
        Ok(Tracks::default())
    }

    pub fn set_back_handling(&self, _request: BackHandlingRequest) -> crate::Result<()> {
        Ok(())
    }

    pub fn exit_app(&self) -> crate::Result<()> {
        self.0.exit(0);
        Ok(())
    }

    pub fn get_device_info(&self) -> crate::Result<DeviceInfo> {
        Ok(DeviceInfo::default())
    }
}
