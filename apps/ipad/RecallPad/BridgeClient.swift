import Foundation
import Security
import UIKit
import Network

private final class PinnedSessionDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var pin: String?
    func setPin(_ value: String?) { lock.lock(); pin = value; lock.unlock() }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        lock.lock(); let expected = pin; lock.unlock()
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let expected, let trust = challenge.protectionSpace.serverTrust,
              PublicKeyPin.fingerprint(of: trust) == expected,
              let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = certificates.first else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        // Accept only the QR-pinned certificate as a local anchor, still checking
        // expiry, server usage and hostname with Security's SSL policy.
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, challenge.protectionSpace.host as CFString))
        SecTrustSetAnchorCertificates(trust, [leaf] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        guard SecTrustEvaluateWithError(trust, nil) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

@MainActor
final class BridgeClient: NSObject, ObservableObject, @preconcurrency NetServiceBrowserDelegate, @preconcurrency NetServiceDelegate {
    @Published private(set) var pairedMac: PairedMac?
    @Published private(set) var session: StudySession?
    @Published private(set) var cachedStudySession: StudySession?
    @Published private(set) var currentStudySession: StudySession?
    @Published private(set) var currentTutorSession: StudySession?
    @Published private(set) var cachedTutorSession: StudySession?
    @Published private(set) var activeDocumentId: String?
    @Published private(set) var connected = false
    @Published private(set) var pairing = false
    @Published var message: String?
    private let delegate = PinnedSessionDelegate()
    private var network: URLSession!
    private var pollTask: Task<Void, Never>?
    private var eventTask: Task<Void, Never>?
    private var websocket: URLSessionWebSocketTask?
    private var browser: NetServiceBrowser?
    private var services: [NetService] = []
    private var store: DocumentStore?
    private var sending = false
    private var isForeground = false
    var studyQuestionsSession: StudySession? { currentStudySession?.mode == "study" ? currentStudySession : cachedStudySession }
    var tutorQuestionsSession: StudySession? { connected ? currentTutorSession : cachedTutorSession }
    var deskQuestions: [QuestionPackage] {
        // An ended online session must not revive the last offline queue.
        let source = connected ? currentStudySession : studyQuestionsSession
        return source?.deskQuestions ?? []
    }

    func tutorSession(for target: String) -> StudySession? {
        guard let currentTutorSession, currentTutorSession.mode == "tutor",
              currentTutorSession.target == target else { return nil }

        return currentTutorSession
    }

    func isSending(_ document: PaperDocument) -> Bool { activeDocumentId == document.id }

    func deleteSheet(_ document: PaperDocument, from store: DocumentStore) throws {
        guard !isSending(document) else {
            throw PadError.rejected("This sheet is sending. Wait for its transfer to finish before deleting it.")
        }

        // Local deletion uses the view's observed store, even before a network
        // connection is activated. No suspension separates the guard and commit. A
        // commit already in flight can reach the Mac, so it cannot be cancelled
        // and described as a local-only deletion.
        try store.delete(document)
    }

    override init() {
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 90
        configuration.waitsForConnectivity = false
        network = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        do { pairedMac = try PairingKeychain.read(); delegate.setPin(pairedMac?.spkiSha256) }
        catch { message = error.localizedDescription }
    }

    func activate(store: DocumentStore) {
        self.store = store
        if cachedStudySession == nil, let cached = store.cachedSession(), cached.installationId == pairedMac?.installationId { cachedStudySession = cached }
        if cachedTutorSession == nil, let cached = store.cachedTutorSession(), cached.installationId == pairedMac?.installationId { cachedTutorSession = cached }
        isForeground = true
        guard pollTask == nil else { return }
        startDiscovery()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                await self.flushOutbox()
                await self.refreshReceipts()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    func deactivate() {
        isForeground = false
        pollTask?.cancel(); pollTask = nil
        eventTask?.cancel(); eventTask = nil
        websocket?.cancel(with: .goingAway, reason: nil); websocket = nil
        browser?.stop(); browser = nil
        services.removeAll()
        connected = false
    }

    func pair(_ text: String) async {
        guard !pairing else { return }
        pairing = true
        defer { pairing = false }
        do {
            let code = try PairingCode.decode(text)
            delegate.setPin(code.spkiSha256)
            let deviceId = UserDefaults.standard.string(forKey: "deviceId") ?? UUID().uuidString.lowercased()
            UserDefaults.standard.set(deviceId, forKey: "deviceId")
            let body: [String: Any] = ["version": 1, "bootstrapSecret": code.bootstrapSecret, "deviceId": deviceId, "deviceName": UIDevice.current.name]
            let response = try await object(path: "/v1/pair/request", method: "POST", body: body, endpoint: code.endpoint, credential: nil)
            guard let requestId = response["requestId"] as? String else { throw PadError.invalidPairing }
            message = "Confirm this iPad in Recall on your Mac."
            let deadline = Date().addingTimeInterval(300)
            while Date() < deadline, !Task.isCancelled {
                try await Task.sleep(for: .seconds(2))
                let response = try await object(path: "/v1/pair/requests/\(requestId)", endpoint: code.endpoint, credential: nil, headers: ["X-Pair-Secret": code.bootstrapSecret])
                if response["state"] as? String == "rejected" { throw PadError.rejected("Pairing was declined on the Mac.") }
                if response["state"] as? String == "approved" {
                    guard let credential = response["credential"] as? String,
                          response["installationId"] as? String == code.installationId,
                          response["deviceId"] as? String == deviceId else { throw PadError.invalidPairing }
                    let pair = PairedMac(installationId: code.installationId, endpoint: code.endpoint, spkiSha256: code.spkiSha256, deviceId: deviceId, credential: credential)
                    try PairingKeychain.save(pair)
                    pairedMac = pair
                    _ = try? await object(path: "/v1/pair/requests/\(requestId)/ack", method: "POST")
                    message = nil
                    await refresh()
                    return
                }
            }
            throw PadError.rejected("Pairing expired. Generate another code on your Mac.")
        } catch {
            delegate.setPin(pairedMac?.spkiSha256)
            message = error.localizedDescription
        }
    }

    func forgetMac() {
        deactivate()
        PairingKeychain.remove()
        pairedMac = nil
        delegate.setPin(nil)
        session = nil
        cachedStudySession = nil
        currentStudySession = nil
        currentTutorSession = nil
        cachedTutorSession = nil
        message = "Pairing removed from this iPad. Remove the device in Mac Settings to revoke its old credential too."
    }

    func refresh() async {
        guard pairedMac != nil, isForeground else { return }
        do {
            let study = try await request(path: "/v1/session/study")
            let tutor = try await request(path: "/v1/session/tutor")
            try acceptSession(JSONDecoder().decode(StudySession.self, from: study), channel: "study")
            try acceptSession(JSONDecoder().decode(StudySession.self, from: tutor), channel: "tutor")
            connected = true
            if websocket == nil { startEvents() }
        } catch {
            connected = false
            websocket?.cancel(with: .goingAway, reason: nil); websocket = nil
            if case PadError.rejected(let detail) = error { message = detail }
        }
    }

    func startTutor(target: String) async {
        do {
            guard target == "clipboard" else { throw PadError.rejected("Tutor Pad sends pages to your Mac. Update Recall Pad before starting this connection.") }
            let data = try await request(path: "/v1/tutor/start", method: "POST", body: ["target": target])
            try acceptSession(JSONDecoder().decode(StudySession.self, from: data), channel: "tutor")
        } catch { message = error.localizedDescription }
    }
    func endTutor() async {
        _ = try? await object(path: "/v1/tutor/end", method: "POST")
        await refresh()
    }

    private func acceptSession(_ fresh: StudySession, channel: String) throws {
        guard fresh.version == 1, fresh.installationId == pairedMac?.installationId,
              fresh.mode == "idle" || fresh.mode == channel else { throw PadError.invalidPairing }
        if fresh.mode == "tutor", !["clipboard", "chatgpt", "codex", "assistant"].contains(fresh.target ?? "") {
            throw PadError.rejected("Update Recall on your Mac to use Tutor Pad’s page receiver.")
        }
        if fresh.target == "assistant", !fresh.hasValidTutorBinding {
            throw PadError.rejected("Your tutor’s prompt has invalid session data. Existing work has been kept.")
        }

        session = fresh
        if channel == "tutor" {
            currentTutorSession = fresh
            if let cached = fresh.tutorFrontCache {
                cachedTutorSession = cached
                try store?.cacheTutorSession(cached)
            }
        }
        if channel == "study" {
            currentStudySession = fresh
            if fresh.mode == "study", !fresh.questions.isEmpty {
                cachedStudySession = fresh
                try store?.cacheSession(fresh)
            } else if fresh.mode == "idle", let cached = cachedStudySession,
                      cached.currentQuestionId != nil || cached.pendingQuestionIds != [] {
                // Remember that the live queue ended, including when the iPad
                // later disconnects. Keep its fronts and sheets recoverable.
                let ended = StudySession(version: cached.version, installationId: cached.installationId, mode: "study", handoffId: cached.handoffId, currentQuestionId: nil, questions: cached.questions, pendingQuestionIds: [])
                cachedStudySession = ended
                try store?.cacheSession(ended)
            }
        }
    }

    func flushOutbox() async {
        guard connected, !sending, let store else { return }
        sending = true
        defer { sending = false; activeDocumentId = nil }
        for attempt in store.attempts.filter({ $0.state == .waitingForMac && $0.retryAllowed }) {
            guard isForeground else { return }
            // A queued sheet can be deleted while another upload is awaiting
            // the network. Recheck the live index before loading its files.
            guard store.attempts.contains(where: { $0.id == attempt.id && $0.state == .waitingForMac && $0.retryAllowed }) else { continue }
            activeDocumentId = attempt.documentId
            do { try await deliver(attempt, store: store) }
            catch {
                if case PadError.rejected(let detail) = error {
                    try? store.updateAttempt(attempt.id, state: .needsAttention, error: detail, retryAllowed: false)
                } else {
                    connected = false
                    // A later retry has the same submission ID and immutable content.
                    try? store.updateAttempt(attempt.id, state: .waitingForMac, error: "Connection interrupted. Your pages are saved.")
                    return
                }
            }
            activeDocumentId = nil
        }
    }

    private func deliver(_ attempt: PaperAttempt, store: DocumentStore) async throws {
        let context = try attempt.transferContext()
        let directory = store.attemptURL(attempt.id)
        let drawing = try Data(contentsOf: directory.appendingPathComponent("drawing.data"))
        var assets: [String: (Data, String)] = [drawing.sha256: (drawing, "application/x-pencilkit")]
        var pages: [[String: Any]] = []
        for page in attempt.pages {
            let data = try Data(contentsOf: directory.appendingPathComponent(page.filename))
            guard data.sha256 == page.sha256 else { throw PadError.rejected("A saved page failed its integrity check. The original drawing is preserved.") }
            assets[page.sha256] = (data, page.mimeType)
            pages.append(["index": page.order - 1, "hash": page.sha256, "mime": page.mimeType, "name": page.filename, "width": page.width, "height": page.height])
        }
        guard assets.values.reduce(0, { $0 + $1.0.count }) <= 64 * 1024 * 1024 else { throw PadError.tooLarge }
        let formatter = ISO8601DateFormatter()
        var manifest: [String: Any] = ["version": context.version, "id": attempt.id, "documentId": attempt.documentId, "revision": attempt.documentRevision, "mode": attempt.mode.rawValue, "questionId": context.questionId as Any? ?? NSNull(), "handoffId": context.handoffId, "createdAt": formatter.string(from: attempt.createdAt), "pages": pages, "drawing": ["hash": drawing.sha256, "bytes": drawing.count], "evaluate": attempt.mode == .study]
        if let target = context.target { manifest["target"] = target }
        let staged = try await object(path: "/v1/attempts/\(attempt.id)/manifest", method: "POST", body: manifest)
        for hash in staged["missing"] as? [String] ?? [] {
            guard let asset = assets[hash] else { throw PadError.rejected("The Mac requested an unknown asset. This attempt has been kept.") }
            _ = try await request(path: "/v1/attempts/\(attempt.id)/assets/\(hash)", method: "PUT", bytes: asset.0, mime: asset.1)
        }
        let receipt = try await object(path: "/v1/attempts/\(attempt.id)/commit", method: "POST")
        guard receipt["id"] as? String == attempt.id, receipt["state"] as? String == "received" else { throw PadError.rejected("The Mac did not confirm saving this attempt.") }
        try store.updateAttempt(attempt.id, state: .receivedOnMac)
    }

    private func refreshReceipts() async {
        guard connected, let store else { return }
        for attempt in store.attempts.filter({ [.receivedOnMac, .queuedOnMac, .evaluating, .needsAttention, .needsResume, .copiedForTutor, .manualPageTray, .pasting, .pasteUnverified].contains($0.state) }) {
            if let receipt = try? await object(path: "/v1/attempts/\(attempt.id)") { applyReceipt(receipt) }
        }
    }
    private func applyReceipt(_ object: [String: Any]) {
        guard let id = object["id"] as? String, let state = object["state"] as? String,
              let mapped = DeliveryState.fromReceipt(state), let store else { return }
        try? store.updateAttempt(id, state: mapped, retryAllowed: mapped != .needsAttention)
    }

    private func startEvents() {
        guard let pairedMac, let url = URL(string: pairedMac.endpoint + "/v1/events"), var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        components.scheme = "wss"
        guard let socketURL = components.url else { return }
        var request = URLRequest(url: socketURL)
        request.setValue("Bearer \(pairedMac.credential)", forHTTPHeaderField: "Authorization")
        let socket = network.webSocketTask(with: request)
        // Issued fronts may include bounded embedded figures (server session cap 16 MiB).
        socket.maximumMessageSize = 18 * 1024 * 1024
        websocket = socket
        socket.resume()
        eventTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await socket.receive()
                    let data: Data
                    switch message { case .data(let value): data = value; case .string(let value): data = Data(value.utf8); @unknown default: continue }
                    guard let self, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                    if object["type"] as? String == "session", let session = object["session"] {
                        let decoded = try JSONDecoder().decode(StudySession.self, from: JSONSerialization.data(withJSONObject: session))
                        let channel = object["channel"] as? String ?? decoded.mode
                        if ["study", "tutor"].contains(channel) { try self.acceptSession(decoded, channel: channel) }
                    }
                    if object["type"] as? String == "receipt", let receipt = object["receipt"] as? [String: Any] { self.applyReceipt(receipt) }
                }
            } catch { self?.websocket = nil }
        }
    }

    private func object(path: String, method: String = "GET", body: [String: Any]? = nil, endpoint: String? = nil, credential: String? = nil, headers: [String: String] = [:]) async throws -> [String: Any] {
        let data = try await request(path: path, method: method, body: body, endpoint: endpoint, credential: credential, headers: headers)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw PadError.rejected("Recall returned an unreadable receipt.") }
        return value
    }
    private func request(path: String, method: String = "GET", body: [String: Any]? = nil, bytes: Data? = nil, mime: String = "application/json", endpoint: String? = nil, credential: String? = nil, headers: [String: String] = [:]) async throws -> Data {
        guard let endpoint = endpoint ?? pairedMac?.endpoint, let url = URL(string: endpoint + path), url.scheme == "https" else { throw PadError.notPaired }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = try bytes ?? body.map { try JSONSerialization.data(withJSONObject: $0) }
        if request.httpBody != nil { request.setValue(mime, forHTTPHeaderField: "Content-Type") }
        if let token = credential ?? (path.hasPrefix("/v1/pair/") && !path.hasSuffix("/ack") ? nil : pairedMac?.credential) { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let (data, response) = try await network.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PadError.rejected("Recall did not return an HTTP response.") }
        guard (200..<300).contains(http.statusCode) else {
            let details = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            if http.statusCode == 401 { throw PadError.rejected("The Mac no longer accepts this pairing. Pair again in Settings; your work is kept.") }
            if http.statusCode >= 500 { throw URLError(.badServerResponse) }
            throw PadError.rejected(details ?? "Recall could not accept this request (\(http.statusCode)). Your work is kept.")
        }
        return data
    }

    private func startDiscovery() {
        guard pairedMac != nil, browser == nil else { return }
        let value = NetServiceBrowser()
        value.delegate = self
        value.searchForServices(ofType: "_recall-pad._tcp.", inDomain: "local.")
        browser = value
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 5)
    }
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard var pairing = pairedMac, let txt = sender.txtRecordData(),
              let identity = NetService.dictionary(fromTXTRecord: txt)["installationId"],
              String(data: identity, encoding: .utf8) == pairing.installationId,
              let addresses = sender.addresses else { return }
        for address in addresses {
            let host = address.withUnsafeBytes { raw -> String? in
                guard let base = raw.baseAddress else { return nil }
                let pointer = base.assumingMemoryBound(to: sockaddr.self)
                guard pointer.pointee.sa_family == sa_family_t(AF_INET) else { return nil }
                var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                guard getnameinfo(pointer, socklen_t(address.count), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 else { return nil }
                return String(cString: buffer)
            }
            guard let host else { continue }
            pairing.endpoint = "https://\(host):\(sender.port)"
            pairedMac = pairing
            // Credentials are sent only after the pinned TLS handshake succeeds.
            try? PairingKeychain.save(pairing)
            break
        }
    }
}
