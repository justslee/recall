// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RecallPadCore",
    platforms: [.macOS(.v13)],
    products: [.library(name: "RecallPadCore", targets: ["RecallPadCore"])],
    targets: [
        .target(name: "RecallPadCore", path: "RecallPad", exclude: ["BridgeClient.swift", "DocumentStore.swift", "HomeView.swift", "Info.plist", "Info.Debug.plist", "Keychain.swift", "PaperCanvas.swift", "PaperEditor.swift", "QRScanner.swift", "QuestionView.swift", "RecallPadApp.swift", "SheetDeletionConfirmation.swift", "Resources"], sources: ["Models.swift"]),
        .testTarget(name: "RecallPadCoreTests", dependencies: ["RecallPadCore"], path: "CoreTests")
    ]
)
