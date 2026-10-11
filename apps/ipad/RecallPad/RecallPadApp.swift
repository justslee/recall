import SwiftUI

@main
struct RecallPadApp: App {
    @StateObject private var store = DocumentStore()
    @StateObject private var bridge = BridgeClient()
    @StateObject private var notebooks = NotebookStore()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(store)
                .environmentObject(bridge)
                .environmentObject(notebooks)
                .tint(PadPalette.accent)
                .onChange(of: phase) { _, value in
                    if value == .active { bridge.activate(store: store); bridge.activateNotebooks(store: notebooks) } else { bridge.deactivate() }
                }
                .task { bridge.activate(store: store); bridge.activateNotebooks(store: notebooks) }
        }
    }
}

enum PadPalette {
    static let background = adaptive(light: 0xeeece7, dark: 0x212421)
    static let surface = adaptive(light: 0xfffefb, dark: 0x2d312d)
    static let accent = adaptive(light: 0x355242, dark: 0xc7d7ac)
    static let text = adaptive(light: 0x282f2b, dark: 0xedece1)
    static let muted = adaptive(light: 0x626b61, dark: 0xafb4a9)
    static let border = adaptive(light: 0xdcded4, dark: 0x454d43)
    static let raised = adaptive(light: 0xe5eadc, dark: 0x383e34)
    static let sunken = adaptive(light: 0xf2f1ea, dark: 0x262c27)
    static let paper = Color(uiColor: paperUIColor)
    static let accentSoft = adaptive(light: 0xdce5d2, dark: 0x3d4b34)
    static let accentInk = adaptive(light: 0xfffdf4, dark: 0x243523)
    static let warm = adaptive(light: 0x89632e, dark: 0xdfba85)
    static let bluePaper = adaptive(light: 0xe4eaf2, dark: 0x2c3b49)
    static let blueInk = adaptive(light: 0x385580, dark: 0xbfd2eb)
    // Resolve the same paper tokens in UIKit without changing saved ink colors.
    static let paperUIColor = adaptiveUIColor(light: 0xf7f2e7, dark: 0x303329)

    private static func adaptive(light: UInt, dark: UInt) -> Color {
        Color(uiColor: adaptiveUIColor(light: light, dark: dark))
    }

    private static func adaptiveUIColor(light: UInt, dark: UInt) -> UIColor {
        UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, alpha: 1)
        }
    }
}
