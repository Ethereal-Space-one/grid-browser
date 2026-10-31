// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GridBrowserProbe",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "GridBrowserProbe", targets: ["GridBrowserProbe"]),
    ],
    targets: [
        .target(name: "GridCore"),
        .executableTarget(name: "GridBrowserProbe", dependencies: ["GridCore"]),
        .testTarget(name: "GridCoreTests", dependencies: ["GridCore"]),
    ]
)
