use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_orivue_native);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<OrivueNative<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("io.github.jaime.orivue.bridge", "NativePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_orivue_native)?;
    Ok(OrivueNative(handle))
}

/// Access to the native player and device APIs.
pub struct OrivueNative<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> OrivueNative<R> {
    pub fn load(&self, request: LoadRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("load", request)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn stop(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("stop", Empty {})
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn set_paused(&self, request: PausedRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("setPaused", request)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn set_volume(&self, request: VolumeRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("setVolume", request)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn set_aspect(&self, request: AspectRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("setAspect", request)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn seek(&self, request: SeekRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("seek", request)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn select_track(&self, request: TrackRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("selectTrack", request)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn get_tracks(&self) -> crate::Result<Tracks> {
        self.0
            .run_mobile_plugin("getTracks", Empty {})
            .map_err(Into::into)
    }

    pub fn set_back_handling(&self, request: BackHandlingRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("setBackHandling", request)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn exit_app(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("exitApp", Empty {})
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn get_device_info(&self) -> crate::Result<DeviceInfo> {
        self.0
            .run_mobile_plugin("getDeviceInfo", Empty {})
            .map_err(Into::into)
    }
}
