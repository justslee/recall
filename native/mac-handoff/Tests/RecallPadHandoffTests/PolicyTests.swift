import XCTest
@testable import RecallPadHandoff

final class PolicyTests: XCTestCase {
    func testAdvertisementDoesNotAcceptArbitraryTXTContent() {
        XCTAssertTrue(HandoffPolicy.acceptsAdvertisement(port: 43210, installationID: "example-installation_1"))
        XCTAssertFalse(HandoffPolicy.acceptsAdvertisement(port: 80, installationID: "example"))
        XCTAssertFalse(HandoffPolicy.acceptsAdvertisement(port: 65536, installationID: "example"))
        XCTAssertFalse(HandoffPolicy.acceptsAdvertisement(port: 43210, installationID: "secret\nvalue"))
        XCTAssertFalse(HandoffPolicy.acceptsAdvertisement(port: 43210, installationID: ""))
        XCTAssertFalse(HandoffPolicy.acceptsAdvertisement(port: 43210, installationID: String(repeating: "a", count: 129)))
    }

    func testOnlyDiscoveryCommandsAreSupported() {
        XCTAssertEqual(HandoffPolicy.commands, ["status", "advertise", "stopAdvertising"])
        for removedCommand in ["requestAccessibility", "arm", "disarm", "paste", "copy"] {
            XCTAssertFalse(HandoffPolicy.commands.contains(removedCommand))
        }
    }
}
