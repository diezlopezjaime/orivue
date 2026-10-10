//! Tauri plugin exposing the native parts Orivue needs on mobile and TV:
//! a Media3/ExoPlayer surface behind the webview on Android and Fire TV,
//! hardware back-button interception and device information.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::OrivueNative;
#[cfg(mobile)]
use mobile::OrivueNative;

pub trait OrivueNativeExt<R: Runtime> {
    fn orivue_native(&self) -> &OrivueNative<R>;
}

impl<R: Runtime, T: Manager<R>> crate::OrivueNativeExt<R> for T {
    fn orivue_native(&self) -> &OrivueNative<R> {
        self.state::<OrivueNative<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("orivue-native")
        .invoke_handler(tauri::generate_handler![
            commands::load,
            commands::stop,
            commands::set_paused,
            commands::set_volume,
            commands::set_aspect,
            commands::seek,
            commands::select_track,
            commands::get_tracks,
            commands::set_back_handling,
            commands::get_device_info,
            commands::exit_app
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let orivue_native = mobile::init(app, api)?;
            #[cfg(desktop)]
            let orivue_native = desktop::init(app, api)?;
            app.manage(orivue_native);
            Ok(())
        })
        .build()
}
