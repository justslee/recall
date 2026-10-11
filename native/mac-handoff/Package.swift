// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RecallPadHandoff",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "recall-pad-handoff", targets: ["RecallPadHandoff"])],
    targets: [
        .executableTarget(name: "RecallPadHandoff"),
        .testTarget(name: "RecallPadHandoffTests", dependencies: ["RecallPadHandoff"])
    ]
)
