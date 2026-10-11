import Foundation
import CryptoKit
import CoreGraphics

enum PaperMode: String, Codable, CaseIterable { case study, tutor }
enum PaperStyle: String, Codable, CaseIterable { case plain, ruled, squared }

enum PaperGeometry {
    static let minimumHeight = 1800.0

    static func canvasHeight(current: Double, inkBounds: CGRect? = nil, margin: Double = 600) -> Double {
        let baseline = current.isFinite ? max(current, minimumHeight) : minimumHeight
        guard let inkBounds, hasFiniteInkBounds(inkBounds), margin.isFinite else { return baseline }

        let expanded = Double(inkBounds.maxY) + max(0, margin)
        guard expanded.isFinite else { return baseline }

        return max(baseline, expanded)
    }

    static func hasFiniteInkBounds(_ bounds: CGRect) -> Bool {
        !bounds.isNull && !bounds.isInfinite && !bounds.isEmpty
            && bounds.minX.isFinite && bounds.minY.isFinite
            && bounds.maxX.isFinite && bounds.maxY.isFinite
    }
}

enum DeliveryState: String, Codable {
    case savedOffline, waitingForMac, receivedOnMac, availableToTutor, needsResume, copiedForTutor, manualPageTray, pasting, pasteUnverified, stagedInChat, queuedOnMac, evaluating, feedbackReady, needsAttention
    var title: String {
        switch self {
        case .savedOffline: return "Saved offline"
        case .waitingForMac: return "Waiting for Mac"
        case .receivedOnMac: return "Received on Mac"
        case .availableToTutor: return "Available to tutor"
        case .needsResume: return "Pages ready on Mac"
        case .copiedForTutor: return "Copied on Mac"
        case .manualPageTray: return "Pages ready on Mac"
        case .pasting: return "Earlier handoff"
        case .pasteUnverified: return "Earlier paste unverified"
        case .stagedInChat: return "Earlier chat attachment"
        case .queuedOnMac: return "Queued on Mac"
        case .evaluating: return "Evaluating"
        case .feedbackReady: return "Feedback ready on Mac"
        case .needsAttention: return "Needs attention on Mac"
        }
    }

    static func fromReceipt(_ state: String) -> DeliveryState? {
        switch state {
        case "received": return .receivedOnMac
        case "available_to_tutor": return .availableToTutor
        case "needs_resume", "needs-resume": return .needsResume
        case "copied": return .copiedForTutor
        case "manual_page_tray", "manual-page-tray": return .manualPageTray
        case "pasting": return .pasting
        case "pasted_unverified", "pasted-unverified": return .pasteUnverified
        case "staged_in_chat", "staged-in-chat": return .stagedInChat
        case "queued": return .queuedOnMac
        case "evaluating": return .evaluating
        case "feedback_ready", "feedback-ready", "assessed": return .feedbackReady
        case "needs_attention", "needs-attention", "failed": return .needsAttention
        default: return nil
        }
    }

    func detail(for mode: PaperMode, boundToTutor: Bool = false) -> String {
        switch self {
        case .savedOffline:
            return "Your pages are saved on this iPad. They have not been sent to the Mac."
        case .waitingForMac:
            return "Your pages remain on this iPad. Recall has not confirmed saving them yet. Reconnect in the foreground to continue delivery."
        case .receivedOnMac:
            if boundToTutor { return "Your pages are saved on the Mac and waiting for your tutor to access them. Continue in the original conversation and ask the assistant to review this submission. Nothing has been evaluated or sent as a chat message." }

            return mode == .study
                ? "Recall saved your pages on the Mac. Check Recall there for assessment controls and feedback."
                : "Your pages are saved in Tutor Pad on your Mac. Copy a page there, then paste it into any app or conversation. Nothing has been attached or sent to a chat."
        case .availableToTutor:
            return "Your tutor has accessed the submitted pages for this prompt. Continue in the original conversation for feedback. This receipt does not mean your work has been evaluated or a chat message sent."
        case .needsResume:
            return mode == .study
                ? "Your pages are saved on the Mac. Open Recall there to continue or retry assessment. Your review rating remains your choice."
                : "Your earlier pages are saved on the Mac. Open Tutor Pad there to copy or export them, then paste them into any app or conversation. Nothing has been sent to a chat."
        case .copiedForTutor:
            return "A page is on your Mac clipboard. Paste it into any app or conversation yourself, then review it before sending."
        case .manualPageTray:
            return "Your ordered pages are saved on the Mac. Open the page tray in Recall to copy or export them for manual attachment."
        case .pasting:
            return "An earlier version recorded a paste request for this work. Its pages are kept on the Mac. Check the earlier draft before retrying, or copy the pages from Tutor Pad and paste them yourself. No new automatic paste is requested."
        case .pasteUnverified:
            return "An earlier paste request was not verified. Inspect the earlier draft before retrying to avoid duplicates. Your pages remain on the Mac; copy and paste them yourself when needed."
        case .stagedInChat:
            return "An earlier handoff recorded these pages as attached to a draft. Review that draft before attaching another copy. Recall has not sent a chat message; no new automatic paste is requested."
        case .queuedOnMac:
            return mode == .study
                ? "Recall saved your pages and queued their assessment on the Mac. Feedback will remain there."
                : "Recall saved your pages and queued further processing on the Mac. No chat attachment is confirmed."
        case .evaluating:
            return "Recall is evaluating your saved work on the Mac. Your pages remain available here; feedback stays on the Mac."
        case .feedbackReady:
            return "Feedback is ready in Recall on your Mac. This iPad keeps your written work; no review rating has been chosen."
        case .needsAttention:
            return mode == .study
                ? "Your written work is kept. Check the delivery message below or open Recall on your Mac to continue assessment."
                : "Your written work is kept. Check the delivery message below or open Recall on your Mac to continue. No chat attachment is confirmed by this receipt."
        }
    }
}

struct QuestionPackage: Codable, Identifiable, Equatable {
    let id: String
    let cardId: String
    let title: String
    let prompt: String
    let topic: String
    let kind: String
    let referenceHash: String
}

struct TutorProblem: Codable, Identifiable, Equatable {
    let id: String
    let sessionId: String
    let revision: Int
    let title: String
    let prompt: String
    let kind: String
    let createdAt: String

    var isValid: Bool {
        guard UUID(uuidString: id) != nil, UUID(uuidString: sessionId) != nil,
              revision > 0, !title.isEmpty, title.count <= 240,
              !prompt.isEmpty, prompt.utf8.count <= 64_000, ["problem", "note"].contains(kind) else { return false }

        let date = ISO8601DateFormatter()
        date.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return date.date(from: createdAt) != nil || ISO8601DateFormatter().date(from: createdAt) != nil
    }
}

struct StudySession: Codable {
    let version: Int
    let installationId: String
    let mode: String
    let handoffId: String?
    let currentQuestionId: String?
    let questions: [QuestionPackage]
    var target: String? = nil
    var pendingQuestionIds: [String]? = nil
    var tutorTitle: String? = nil
    var currentProblemId: String? = nil
    var problems: [TutorProblem]? = nil

    var currentTutorProblem: TutorProblem? {
        guard mode == "tutor", target == "assistant", let handoffId, let currentProblemId else { return nil }

        return problems?.first { $0.id == currentProblemId && $0.sessionId == handoffId && $0.isValid }
    }

    func nextTutorProblem(after document: PaperDocument, following: Bool = true, connected: Bool = true) -> TutorProblem? {
        guard following, connected, document.mode == .tutor, let previous = document.tutorProblem,
              previous.sessionId == handoffId, let current = currentTutorProblem,
              current.id != previous.id else { return nil }

        return current
    }

    var hasValidTutorBinding: Bool {
        guard mode == "tutor", target == "assistant", let handoffId,
              UUID(uuidString: handoffId) != nil, questions.isEmpty,
              let tutorTitle, !tutorTitle.isEmpty, tutorTitle.count <= 240,
              let problems, problems.count <= 4,
              Set(problems.map(\.id)).count == problems.count,
              problems.allSatisfy({ $0.isValid && $0.sessionId == handoffId }) else { return false }

        return currentProblemId == nil || currentTutorProblem != nil
    }

    var tutorFrontCache: StudySession? {
        if mode == "idle" { return self }
        guard mode == "tutor" else { return nil }

        if target == "assistant" { return hasValidTutorBinding ? self : nil }
        guard ["clipboard", "chatgpt", "codex"].contains(target ?? "") else { return nil }

        // A live generic receiver means no assistant session remains active.
        // Persist that fact so disconnecting cannot revive an older prompt.
        return StudySession(version: version, installationId: installationId, mode: "idle", handoffId: nil, currentQuestionId: nil, questions: [])
    }

    /// The desk shows a small live queue; the rest of the fronts remain cached
    /// for offline navigation and attempts submitted against older questions.
    var deskQuestions: [QuestionPackage] {
        guard mode == "study" else { return [] }

        if let pendingQuestionIds {
            var seen = Set<String>()
            return Array(pendingQuestionIds.compactMap { id -> QuestionPackage? in
                guard seen.insert(id).inserted else { return nil }
                return questions.first { $0.id == id }
            }.prefix(3))
        }
        // Older session caches have no explicit pending queue. Use their saved
        // cursor rather than showing every cached front from the beginning.
        guard let currentQuestionId, let index = questions.firstIndex(where: { $0.id == currentQuestionId }) else { return [] }

        return Array(questions[index...].prefix(3))
    }
}

struct PaperDocument: Codable, Identifiable {
    let id: String
    let mode: PaperMode
    var title: String
    var questionPackage: QuestionPackage?
    var tutorProblem: TutorProblem? = nil
    var tutorTitle: String? = nil
    var paperStyle: PaperStyle
    var revision: Int
    let createdAt: Date
    var updatedAt: Date
    var canvasHeight: Double
    var state: DeliveryState
    var destination: String?
    var handoffId: String?

    init(mode: PaperMode, question: QuestionPackage? = nil, tutorProblem: TutorProblem? = nil, tutorTitle: String? = nil) {
        id = UUID().uuidString.lowercased()
        self.mode = mode
        title = question?.title ?? tutorProblem?.title ?? (mode == .tutor ? "Tutor sheet" : "Untitled sheet")
        questionPackage = question
        self.tutorProblem = tutorProblem
        self.tutorTitle = tutorTitle
        paperStyle = .squared
        revision = 0
        createdAt = Date()
        updatedAt = Date()
        canvasHeight = PaperGeometry.minimumHeight
        state = .savedOffline
        destination = mode == .tutor ? (tutorProblem == nil ? "clipboard" : "assistant") : nil
        handoffId = tutorProblem?.sessionId ?? (mode == .tutor ? UUID().uuidString.lowercased() : nil)
    }
}

struct PaperPage: Codable, Identifiable {
    let id: String
    let order: Int
    let filename: String
    let mimeType: String
    let sha256: String
    let byteLength: Int
    let width: Int
    let height: Int
}

struct PaperAttempt: Codable, Identifiable {
    let version: Int
    let id: String
    let documentId: String
    let mode: PaperMode
    let documentRevision: Int
    let questionPackageId: String?
    let destination: String?
    let handoffId: String?
    let createdAt: Date
    let pages: [PaperPage]
    var state: DeliveryState
    var lastError: String?
    var retryAllowed: Bool
    // Older submissions omitted the destination from their wire manifest. Keep
    // their retries byte-compatible; only new submissions carry this field.
    var deliveryTarget: String? = nil
    var tutorProblemId: String? = nil

    func transferContext() throws -> (version: Int, questionId: String?, handoffId: String, target: String?) {
        guard let handoffId else { throw PadError.rejected("This saved work has no session. Its pages have been kept.") }

        if version == 2 {
            guard mode == .tutor, questionPackageId == nil, destination == "assistant", deliveryTarget == "assistant",
                  let tutorProblemId, UUID(uuidString: tutorProblemId) != nil, UUID(uuidString: handoffId) != nil else {
                throw PadError.rejected("This saved tutor submission has invalid session data. Its original pages have been kept.")
            }

            return (2, tutorProblemId, handoffId, "assistant")
        }

        guard version == 1, tutorProblemId == nil else { throw PadError.rejected("This saved submission needs a newer app. Its original pages have been kept.") }
        if let deliveryTarget {
            guard mode == .tutor, ["clipboard", "chatgpt", "codex"].contains(deliveryTarget) else {
                throw PadError.rejected("This saved submission has an invalid destination. Its original pages have been kept.")
            }
        }

        return (1, questionPackageId, handoffId, deliveryTarget)
    }
}

struct PairingCode: Codable {
    let version: Int
    let installationId: String
    let endpoint: String
    let bootstrapSecret: String
    let spkiSha256: String
    let expiresAt: String

    static func decode(_ text: String) throws -> PairingCode {
        let data: Data
        if let url = URL(string: text), url.scheme == "recall-pad",
           let encoded = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "data" })?.value {
            var base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            while base64.count % 4 != 0 { base64 += "=" }
            guard let decoded = Data(base64Encoded: base64) else { throw PadError.invalidPairing }
            data = decoded
        } else {
            data = Data(text.utf8)
        }
        let code = try JSONDecoder().decode(PairingCode.self, from: data)
        guard code.version == 1, let endpoint = URL(string: code.endpoint), endpoint.scheme == "https",
              endpoint.user == nil, endpoint.password == nil, endpoint.query == nil,
              Data(base64Encoded: code.spkiSha256)?.count == 32,
              let expiry = isoDate(code.expiresAt), expiry > Date() else {
            throw PadError.invalidPairing
        }
        return code
    }
    private static func isoDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct PairedMac: Codable {
    let installationId: String
    var endpoint: String
    let spkiSha256: String
    let deviceId: String
    let credential: String
}

struct DeliveryReceipt: Codable {
    let id: String
    let state: String
    let receivedAt: String?
}

enum PadError: LocalizedError {
    case invalidPairing, notPaired, blankSheet, tooLarge, rejected(String)
    var errorDescription: String? {
        switch self {
        case .invalidPairing: return "This pairing code is invalid or expired. Generate a new code in Recall on your Mac."
        case .notPaired: return "Pair this iPad with Recall on your Mac first. Your work is saved."
        case .blankSheet: return "Write something before sending this sheet."
        case .tooLarge: return "This sheet is too large to send at once. Your work is saved; export it or divide it into smaller sheets."
        case .rejected(let message): return message
        }
    }
}

enum PaperPagination {
    /// Choose a whitespace boundary near each page edge; overlap when ink crosses it.
    static func ranges(height: Double, pageHeight: Double = 1400, strokeRanges: [ClosedRange<Double>]) -> [ClosedRange<Double>] {
        guard height > 0, pageHeight > 100 else { return [] }
        var result: [ClosedRange<Double>] = []
        var start = 0.0
        while start < height {
            let idealEnd = min(start + pageHeight, height)
            if idealEnd == height {
                result.append(start...height)
                break
            }
            let candidates = stride(from: idealEnd, through: max(start + pageHeight * 0.65, start + 100), by: -8.0)
            let safeEnd = candidates.first { edge in !strokeRanges.contains { $0.lowerBound - 16 < edge && $0.upperBound + 16 > edge } }
            let end = safeEnd ?? idealEnd
            result.append(start...end)
            start = safeEnd == nil ? end - 64 : end
        }
        return result
    }
}

extension Data {
    var sha256: String { SHA256.hash(data: self).map { String(format: "%02x", $0) }.joined() }
}
