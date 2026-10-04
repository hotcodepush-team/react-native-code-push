// swift-tools-version: 5.9
import PackageDescription

// The pod's logic that needs no React Native, compiled alone so `swift test` runs it on the host;
// the rest of `ios/` compiles inside an app, as `ci.yml` builds it in the demo.
let package = Package(
    name: "HotcodepushReactNativeCodePush",
    platforms: [.iOS(.v15), .macOS(.v12)],
    targets: [
        .target(
            name: "HotcodepushReactNativeCodePush",
            path: "ios",
            sources: ["ReloadGate.swift"]),
        .testTarget(
            name: "HotcodepushReactNativeCodePushTests",
            dependencies: ["HotcodepushReactNativeCodePush"],
            path: "Tests/HotcodepushReactNativeCodePushTests")
    ]
)
