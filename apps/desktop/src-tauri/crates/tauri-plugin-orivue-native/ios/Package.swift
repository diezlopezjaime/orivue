// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-orivue-native",
    platforms: [
        .iOS(.v13),
    ],
    products: [
        .library(
            name: "tauri-plugin-orivue-native",
            type: .static,
            targets: ["tauri-plugin-orivue-native"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-orivue-native",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
