import Foundation

enum HandoffPolicy {
    static let commands: Set<String> = ["status", "advertise", "stopAdvertising"]
    static let maxInputBytes = 100_000

    static func acceptsAdvertisement(port: Int, installationID: String) -> Bool {
        guard (1024...65535).contains(port), !installationID.isEmpty,
              installationID.utf8.count <= 128 else { return false }

        return installationID.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }
}
