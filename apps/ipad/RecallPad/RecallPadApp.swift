import SwiftUI

@main
struct RecallPadApp: App {
    @StateObject private var store = DocumentStore()
    @StateObject private var bridge = BridgeClient()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(store)
                .environmentObject(bridge)
                .tint(PadPalette.accent)
                .onChange(of: phase) { _, value in
                    if value == .active { bridge.activate(store: store) } else { bridge.deactivate() }
                }
                .task { bridge.activate(store: store) }
        }
    }
}

enum PadPalette {
    static let background = adaptive(light: 0xeeece7, dark: 0x212421)
    static let surface = adaptive(light: 0xfffefb, dark: 0x2d312d)
    static let accent = adaptive(light: 0x355242, dark: 0xc7d7ac)
    private static func adaptive(light: UInt, dark: UInt) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, alpha: 1)
        })
    }
}
