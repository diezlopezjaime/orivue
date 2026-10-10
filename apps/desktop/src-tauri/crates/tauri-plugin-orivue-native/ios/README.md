# Orivue native plugin (iOS)

Swift package consumed by the Tauri iOS project. It only exposes device
information: HLS is played natively by WebKit and MPEG-TS by `mpegts.js`
(ManagedMediaSource, iOS 17.1+). A VLCKit backend can be added here later
without touching the web UI, which already falls back when `load` rejects.
