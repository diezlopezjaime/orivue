const COMMANDS: &[&str] = &[
    "load",
    "stop",
    "set_paused",
    "set_volume",
    "set_aspect",
    "select_track",
    "get_tracks",
    "set_back_handling",
    "get_device_info",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
