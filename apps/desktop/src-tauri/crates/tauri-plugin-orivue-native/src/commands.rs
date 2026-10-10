use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::OrivueNativeExt;
use crate::Result;

#[command]
pub(crate) async fn load<R: Runtime>(app: AppHandle<R>, request: LoadRequest) -> Result<()> {
    app.orivue_native().load(request)
}

#[command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.orivue_native().stop()
}

#[command]
pub(crate) async fn set_paused<R: Runtime>(
    app: AppHandle<R>,
    request: PausedRequest,
) -> Result<()> {
    app.orivue_native().set_paused(request)
}

#[command]
pub(crate) async fn set_volume<R: Runtime>(
    app: AppHandle<R>,
    request: VolumeRequest,
) -> Result<()> {
    app.orivue_native().set_volume(request)
}

#[command]
pub(crate) async fn set_aspect<R: Runtime>(
    app: AppHandle<R>,
    request: AspectRequest,
) -> Result<()> {
    app.orivue_native().set_aspect(request)
}

#[command]
pub(crate) async fn select_track<R: Runtime>(
    app: AppHandle<R>,
    request: TrackRequest,
) -> Result<()> {
    app.orivue_native().select_track(request)
}

#[command]
pub(crate) async fn get_tracks<R: Runtime>(app: AppHandle<R>) -> Result<Tracks> {
    app.orivue_native().get_tracks()
}

#[command]
pub(crate) async fn set_back_handling<R: Runtime>(
    app: AppHandle<R>,
    request: BackHandlingRequest,
) -> Result<()> {
    app.orivue_native().set_back_handling(request)
}

#[command]
pub(crate) async fn get_device_info<R: Runtime>(app: AppHandle<R>) -> Result<DeviceInfo> {
    app.orivue_native().get_device_info()
}

#[command]
pub(crate) async fn exit_app<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.orivue_native().exit_app()
}

#[command]
pub(crate) async fn seek<R: Runtime>(app: AppHandle<R>, request: SeekRequest) -> Result<()> {
    app.orivue_native().seek(request)
}
