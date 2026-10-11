import XCTest
import CoreGraphics
@testable import RecallPadCore

final class RecallPadCoreTests: XCTestCase {
    func testCanvasGeometryKeepsBlankAndInvalidBoundsFinite() {
        XCTAssertEqual(PaperGeometry.canvasHeight(current: 1800, inkBounds: .null), 1800)
        XCTAssertEqual(PaperGeometry.canvasHeight(current: 2400), 2400)
        XCTAssertEqual(PaperGeometry.canvasHeight(current: .infinity), 1800)
        XCTAssertEqual(PaperGeometry.canvasHeight(current: .nan, inkBounds: .infinite), 1800)
        let longInk = CGRect(x: 20, y: 5000, width: 300, height: 800)
        XCTAssertEqual(PaperGeometry.canvasHeight(current: 1800, inkBounds: longInk), 6400)
        XCTAssertEqual(PaperGeometry.canvasHeight(current: 9000, inkBounds: longInk), 9000)
    }

    func testReceiptNeverInfersAChatAttachmentFromStorageOrUnverifiedPaste() throws {
        XCTAssertEqual(DeliveryState.fromReceipt("received"), .receivedOnMac)
        XCTAssertEqual(DeliveryState.fromReceipt("needs_resume"), .needsResume)
        XCTAssertEqual(DeliveryState.fromReceipt("copied"), .copiedForTutor)
        XCTAssertEqual(DeliveryState.fromReceipt("manual-page-tray"), .manualPageTray)
        XCTAssertEqual(DeliveryState.fromReceipt("pasting"), .pasting)
        XCTAssertEqual(DeliveryState.fromReceipt("pasted_unverified"), .pasteUnverified)
        XCTAssertEqual(DeliveryState.fromReceipt("staged_in_chat"), .stagedInChat)
        XCTAssertEqual(DeliveryState.fromReceipt("queued"), .queuedOnMac)
        XCTAssertNil(DeliveryState.fromReceipt("staging"))
        XCTAssertNil(DeliveryState.fromReceipt("staged"))
        XCTAssertTrue(DeliveryState.receivedOnMac.detail(for: .tutor).contains("Nothing has been attached or sent to a chat"))
        XCTAssertTrue(DeliveryState.receivedOnMac.detail(for: .tutor).contains("Copy a page"))
        XCTAssertTrue(DeliveryState.copiedForTutor.detail(for: .tutor).contains("any app or conversation"))
        XCTAssertTrue(DeliveryState.pasteUnverified.detail(for: .tutor).contains("before retrying"))
        let encoded = try JSONEncoder().encode(DeliveryState.pasteUnverified)
        XCTAssertEqual(try JSONDecoder().decode(DeliveryState.self, from: encoded), .pasteUnverified)
    }

    func testPaginationPreservesCoverageAndUsesWhitespace() {
        XCTAssertEqual(PaperPagination.ranges(height: 0, strokeRanges: []), [])
        let spaces = PaperPagination.ranges(height: 3100, strokeRanges: [100...200, 1500...1600, 2800...3000])
        XCTAssertEqual(spaces.first, 0...1400)
        XCTAssertEqual(spaces.last?.upperBound, 3100)
        let ink = PaperPagination.ranges(height: 3000, strokeRanges: [0...3000])
        for index in 1..<ink.count { XCTAssertLessThan(ink[index].lowerBound, ink[index - 1].upperBound) }
        XCTAssertEqual(ink.last?.upperBound, 3000)
    }

    func testPairingRequiresUnexpiredHTTPSAndSHA256Pin() throws {
        let pin = Data(repeating: 7, count: 32).base64EncodedString()
        var code: [String: Any] = ["version": 1, "installationId": "mac", "endpoint": "https://192.168.1.2:6000", "spkiSha256": pin, "bootstrapSecret": "one-time", "expiresAt": "2099-01-01T00:00:00Z"]
        func decode() throws -> PairingCode { try PairingCode.decode(String(data: JSONSerialization.data(withJSONObject: code), encoding: .utf8)!) }
        XCTAssertEqual(try decode().spkiSha256, pin)
        code["expiresAt"] = "2099-01-01T00:00:00.123Z"
        XCTAssertEqual(try decode().spkiSha256, pin)
        code["endpoint"] = "http://192.168.1.2:6000"
        XCTAssertThrowsError(try decode())
        code["endpoint"] = "https://192.168.1.2:6000"
        code["expiresAt"] = "2000-01-01T00:00:00Z"
        XCTAssertThrowsError(try decode())
        code["expiresAt"] = "2099-01-01T00:00:00Z"
        code["spkiSha256"] = "trust-anything"
        XCTAssertThrowsError(try decode())
    }

    func testQuestionCacheCannotEncodeReferencesOrCredentials() throws {
        let question = QuestionPackage(id: "issued", cardId: "card", title: "Test", prompt: "Solve on paper", topic: "Math", kind: "math", referenceHash: "revision")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(question)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), Set(["id", "cardId", "title", "prompt", "topic", "kind", "referenceHash"]))
        XCTAssertNil(json["answer"])
        XCTAssertNil(json["credential"])
    }

    func testDeskQueueAdvancesWithoutRecyclingRetainedFronts() throws {
        let questions = (1...6).map { index in QuestionPackage(id: "q\(index)", cardId: "c\(index)", title: "Question \(index)", prompt: "Write your answer", topic: "Math", kind: "math", referenceHash: "revision") }
        func session(current: String?, pending: [String]?) -> StudySession {
            StudySession(version: 1, installationId: "mac", mode: "study", handoffId: "handoff", currentQuestionId: current, questions: questions, pendingQuestionIds: pending)
        }
        let first = session(current: "q2", pending: ["q2", "q3", "q4", "q5", "q6"])
        XCTAssertEqual(first.deskQuestions.map(\.id), ["q2", "q3", "q4"])
        let last = session(current: "q6", pending: ["q6"])
        XCTAssertEqual(last.deskQuestions.map(\.id), ["q6"])
        XCTAssertEqual(last.questions.count, 6)
        let cached = try JSONDecoder().decode(StudySession.self, from: JSONEncoder().encode(last))
        XCTAssertEqual(cached.deskQuestions.map(\.id), ["q6"])
        XCTAssertEqual(cached.questions.map(\.id), questions.map(\.id))
        XCTAssertTrue(session(current: nil, pending: []).deskQuestions.isEmpty)
        XCTAssertEqual(session(current: nil, pending: ["q4", "q5", "q6"]).deskQuestions.map(\.id), ["q4", "q5", "q6"], "While the Mac is on coding, show only upcoming writable questions")
    }

    func testDeskQueueHandlesOlderCachesAndInvalidQueueEntriesSafely() {
        let questions = (1...5).map { QuestionPackage(id: "q\($0)", cardId: "c\($0)", title: "Test", prompt: "Write", topic: "Math", kind: "math", referenceHash: "revision") }
        var legacy = StudySession(version: 1, installationId: "mac", mode: "study", handoffId: "handoff", currentQuestionId: "q4", questions: questions)
        XCTAssertEqual(legacy.deskQuestions.map(\.id), ["q4", "q5"])
        legacy.pendingQuestionIds = ["missing", "q4", "q4", "q5"]
        XCTAssertEqual(legacy.deskQuestions.map(\.id), ["q4", "q5"])
        XCTAssertTrue(StudySession(version: 1, installationId: "mac", mode: "idle", handoffId: nil, currentQuestionId: nil, questions: questions, pendingQuestionIds: ["q1"]).deskQuestions.isEmpty)
    }

    func testSavedOutboxRoundTripsStableIdentityAndHashes() throws {
        let offlineTutor = PaperDocument(mode: .tutor)
        XCTAssertEqual(offlineTutor.title, "Tutor sheet")
        XCTAssertEqual(offlineTutor.destination, "clipboard")
        XCTAssertNotNil(offlineTutor.handoffId.flatMap(UUID.init(uuidString:)))
        XCTAssertNil(PaperDocument(mode: .study).handoffId)
        let page = PaperPage(id: "page", order: 1, filename: "page-1.png", mimeType: "image/png", sha256: Data("image".utf8).sha256, byteLength: 5, width: 20, height: 20)
        let id = UUID().uuidString.lowercased()
        let attempt = PaperAttempt(version: 1, id: id, documentId: UUID().uuidString.lowercased(), mode: .tutor, documentRevision: 3, questionPackageId: nil, destination: "chatgpt", handoffId: UUID().uuidString.lowercased(), createdAt: Date(), pages: [page], state: .waitingForMac, lastError: nil, retryAllowed: true)
        let decoded = try JSONDecoder().decode(PaperAttempt.self, from: JSONEncoder().encode(attempt))
        XCTAssertEqual(decoded.id, id)
        XCTAssertEqual(decoded.pages[0].sha256, page.sha256)
        XCTAssertEqual(decoded.state, .waitingForMac)
        XCTAssertEqual(decoded.destination, "chatgpt", "An older saved submission keeps its original destination")
        XCTAssertNil(decoded.deliveryTarget, "An older submission never acquires a new wire target while decoding")
        XCTAssertEqual(Data("abc".utf8).sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    func testGenericAndLegacyTutorManifestTargetsRoundTripUnchanged() throws {
        let page = PaperPage(id: "page", order: 1, filename: "page-1.png", mimeType: "image/png", sha256: Data("image".utf8).sha256, byteLength: 5, width: 20, height: 20)
        for target in ["clipboard", "chatgpt", "codex"] {
            let attempt = PaperAttempt(version: 1, id: UUID().uuidString.lowercased(), documentId: UUID().uuidString.lowercased(), mode: .tutor, documentRevision: 3, questionPackageId: nil, destination: target, handoffId: UUID().uuidString.lowercased(), createdAt: Date(), pages: [page], state: .waitingForMac, lastError: nil, retryAllowed: true, deliveryTarget: target)
            let decoded = try JSONDecoder().decode(PaperAttempt.self, from: JSONEncoder().encode(attempt))
            XCTAssertEqual(decoded.id, attempt.id)
            XCTAssertEqual(decoded.deliveryTarget, target)
            XCTAssertEqual(decoded.destination, target)
            XCTAssertEqual(decoded.documentRevision, attempt.documentRevision)
            XCTAssertEqual(decoded.pages[0].sha256, page.sha256)
        }
    }

    func testAssistantPromptValidationAndFollowStayInsideTheOriginalSession() throws {
        let sessionId = UUID().uuidString.lowercased()
        let first = TutorProblem(id: UUID().uuidString.lowercased(), sessionId: sessionId, revision: 1, title: "First prompt", prompt: "<p>Show your working.</p>", kind: "problem", createdAt: "2026-01-01T00:00:00Z")
        let next = TutorProblem(id: UUID().uuidString.lowercased(), sessionId: sessionId, revision: 2, title: "Next prompt", prompt: "<p>Explain the method.</p>", kind: "note", createdAt: "2026-01-01T00:00:01.100Z")
        let document = PaperDocument(mode: .tutor, tutorProblem: first, tutorTitle: "Linear algebra")
        var session = StudySession(version: 1, installationId: "mac", mode: "tutor", handoffId: sessionId, currentQuestionId: nil, questions: [], target: "assistant", tutorTitle: "Linear algebra", currentProblemId: first.id, problems: [first])
        XCTAssertTrue(session.hasValidTutorBinding)
        XCTAssertEqual(session.tutorFrontCache?.currentTutorProblem, first)
        XCTAssertNil(session.nextTutorProblem(after: document), "Hints or discussion on the same prompt must keep its sheet")
        session.problems = [first, next]
        session.currentProblemId = next.id
        XCTAssertEqual(session.nextTutorProblem(after: document), next)
        XCTAssertNil(session.nextTutorProblem(after: document, following: false, connected: true), "A paused/reconnecting editor must not advance automatically")
        XCTAssertNil(session.nextTutorProblem(after: document, following: true, connected: false))
        let other = PaperDocument(mode: .tutor, tutorProblem: TutorProblem(id: UUID().uuidString.lowercased(), sessionId: UUID().uuidString.lowercased(), revision: 1, title: "Another chat", prompt: "<p>Keep this work.</p>", kind: "problem", createdAt: "2026-01-01T00:00:00Z"))
        XCTAssertNil(session.nextTutorProblem(after: other), "A different conversation must not replace this sheet")
        XCTAssertNil(session.nextTutorProblem(after: PaperDocument(mode: .tutor)))
        session.currentProblemId = UUID().uuidString.lowercased()
        XCTAssertFalse(session.hasValidTutorBinding)
        XCTAssertNil(session.currentTutorProblem)
        XCTAssertNil(session.tutorFrontCache)
        for target in ["clipboard", "chatgpt", "codex"] {
            let generic = StudySession(version: 1, installationId: "mac", mode: "tutor", handoffId: UUID().uuidString.lowercased(), currentQuestionId: nil, questions: [], target: target)
            XCTAssertEqual(generic.tutorFrontCache?.mode, "idle", "A generic live receiver must retire a stale assistant cache")
            XCTAssertNil(generic.tutorFrontCache?.currentTutorProblem)
        }
    }

    func testAssistantTransferContextAndLegacyRetriesKeepSeparateWireVersions() throws {
        let page = PaperPage(id: "page", order: 1, filename: "page-1.png", mimeType: "image/png", sha256: Data("image".utf8).sha256, byteLength: 5, width: 20, height: 20)
        let sessionId = UUID().uuidString.lowercased()
        let problemId = UUID().uuidString.lowercased()
        let assistant = PaperAttempt(version: 2, id: UUID().uuidString.lowercased(), documentId: UUID().uuidString.lowercased(), mode: .tutor, documentRevision: 3, questionPackageId: nil, destination: "assistant", handoffId: sessionId, createdAt: Date(), pages: [page], state: .waitingForMac, lastError: nil, retryAllowed: true, deliveryTarget: "assistant", tutorProblemId: problemId)
        let recovered = try JSONDecoder().decode(PaperAttempt.self, from: JSONEncoder().encode(assistant))
        let context = try recovered.transferContext()
        XCTAssertEqual(context.version, 2)
        XCTAssertEqual(context.questionId, problemId)
        XCTAssertEqual(context.handoffId, sessionId)
        XCTAssertEqual(context.target, "assistant")
        XCTAssertEqual(recovered.tutorProblemId, problemId)
        XCTAssertNil(recovered.questionPackageId)
        let targets: [String?] = [nil, "clipboard", "chatgpt", "codex"]
        for target in targets {
            let legacy = PaperAttempt(version: 1, id: UUID().uuidString.lowercased(), documentId: UUID().uuidString.lowercased(), mode: .tutor, documentRevision: 3, questionPackageId: nil, destination: target ?? "chatgpt", handoffId: sessionId, createdAt: Date(), pages: [page], state: .waitingForMac, lastError: nil, retryAllowed: true, deliveryTarget: target)
            let previous = try JSONDecoder().decode(PaperAttempt.self, from: JSONEncoder().encode(legacy))
            let old = try previous.transferContext()
            XCTAssertEqual(old.version, 1)
            XCTAssertNil(old.questionId)
            XCTAssertEqual(old.target, target)
            XCTAssertNil(previous.tutorProblemId)
        }
        var broken = assistant
        broken.tutorProblemId = nil
        XCTAssertThrowsError(try broken.transferContext())
    }

    func testAssistantReceiptDistinguishesDurableStorageFromTutorAccess() {
        XCTAssertEqual(DeliveryState.fromReceipt("received"), .receivedOnMac)
        XCTAssertEqual(DeliveryState.fromReceipt("available_to_tutor"), .availableToTutor)
        XCTAssertTrue(DeliveryState.receivedOnMac.detail(for: .tutor, boundToTutor: true).contains("waiting for your tutor"))
        XCTAssertTrue(DeliveryState.availableToTutor.detail(for: .tutor, boundToTutor: true).contains("does not mean your work has been evaluated"))
        XCTAssertTrue(DeliveryState.availableToTutor.detail(for: .tutor, boundToTutor: true).contains("chat message sent"))
        XCTAssertNil(DeliveryState.fromReceipt("tutor_evaluated"), "An unknown receipt must not imply assessment or mastery")
    }
}
