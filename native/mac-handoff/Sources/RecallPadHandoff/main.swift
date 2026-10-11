import AppKit
import Foundation

// This helper only advertises local discovery. It has no clipboard, draft,
// Accessibility or synthesized-input interface and never receives page data.
func emit(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }

    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data([10]))
}

final class DiscoveryController: NSObject, NetServiceDelegate {
    private var service: NetService?
    private var advertising = false

    func handle(_ request: [String: Any]) {
        guard let id = request["id"] as? String, !id.isEmpty, id.utf8.count <= 100,
              request["version"] as? Int == 1,
              let command = request["command"] as? String else { return }

        let args = request["args"] as? [String: Any] ?? [:]
        let reply: ([String: Any]) -> Void = { emit(["id": id, "ok": true, "result": $0]) }
        let fail: (String) -> Void = { emit(["id": id, "ok": false, "error": $0]) }
        guard HandoffPolicy.commands.contains(command) else {
            fail("unknown-command"); return
        }

        switch command {
        case "status":
            reply(["available": true, "advertising": advertising])
        case "advertise":
            guard let port = args["port"] as? Int, let installationID = args["installationId"] as? String,
                  HandoffPolicy.acceptsAdvertisement(port: port, installationID: installationID) else {
                fail("invalid-advertisement"); return
            }

            stopAdvertising()
            let advertisement = NetService(domain: "local.", type: "_recall-pad._tcp.", name: "Recall-" + String(installationID.prefix(12)), port: Int32(port))
            advertisement.delegate = self
            advertisement.setTXTRecord(NetService.data(fromTXTRecord: [
                "version": Data("1".utf8), "installationId": Data(installationID.utf8)
            ]))
            service = advertisement
            advertisement.publish()
            reply(["state": "starting"])
        case "stopAdvertising":
            stopAdvertising()
            reply(["state": "stopped"])
        default:
            fail("unknown-command")
        }
    }

    private func stopAdvertising() {
        service?.stop()
        service = nil
        advertising = false
    }

    func netServiceDidPublish(_ sender: NetService) {
        guard sender === service else { return }

        advertising = true
        emit(["event": "bonjour", "state": "advertising"])
    }

    func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
        guard sender === service else { return }

        advertising = false
        emit(["event": "bonjour", "state": "unavailable"])
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let controller = DiscoveryController()
DispatchQueue.global(qos: .utility).async {
    var pending = Data()
    while true {
        let data = FileHandle.standardInput.availableData
        if data.isEmpty { DispatchQueue.main.async { exit(0) }; return }

        pending.append(data)
        if pending.count > HandoffPolicy.maxInputBytes {
            DispatchQueue.main.async { emit(["event": "protocol-error", "reason": "input-too-large"]); exit(2) }
            return
        }
        while let newline = pending.firstIndex(of: 10) {
            let line = pending.subdata(in: 0..<newline)
            pending.removeSubrange(0...newline)
            guard let request = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
                DispatchQueue.main.async { emit(["event": "protocol-error", "reason": "invalid-request"]) }
                continue
            }

            DispatchQueue.main.async { controller.handle(request) }
        }
    }
}
RunLoop.main.run()
