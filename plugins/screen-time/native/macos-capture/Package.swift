// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EchoLogScreenCapture",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "echolog-screen-capture", targets: ["EchoLogScreenCapture"]),
        .library(name: "EchoLogScreenCaptureCore", targets: ["EchoLogScreenCaptureCore"]),
    ],
    targets: [
        .target(
            name: "EchoLogScreenCaptureCore",
            linkerSettings: [
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("ImageIO"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("Security"),
                .linkedFramework("UniformTypeIdentifiers"),
            ]
        ),
        .executableTarget(
            name: "EchoLogScreenCapture",
            dependencies: ["EchoLogScreenCaptureCore"]
        ),
        .testTarget(
            name: "EchoLogScreenCaptureCoreTests",
            dependencies: ["EchoLogScreenCaptureCore"]
        ),
    ]
)
