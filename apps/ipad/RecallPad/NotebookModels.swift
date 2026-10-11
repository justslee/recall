import Foundation

struct PadNotebook: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    let createdAt: Date
    var updatedAt: Date
}

struct PadNotebookNote: Codable, Identifiable, Equatable {
    let id: String
    let notebookId: String
    var title: String
    var pageIds: [String]
    var revision: Int
    let createdAt: Date
    var updatedAt: Date
}

struct PadNotebookPage: Codable, Identifiable, Equatable {
    let id: String
    let noteId: String
    var title: String
    var revision: Int
    var contentHash: String
    var paperStyle: PaperStyle
    var canvasHeight: Double
    let createdAt: Date
    var updatedAt: Date
}

struct NotebookSourcePage: Codable, Equatable {
    let id: String
    let revision: Int
    let hash: String
}

struct NotebookSubmissionPage: Codable, Identifiable, Equatable {
    let id: String
    let order: Int
    let filename: String
    let mimeType: String
    let sha256: String
    let byteLength: Int
    let width: Int
    let height: Int
    let sourcePageId: String
    let sourceRevision: Int
    let sourceHash: String
}

struct NotebookDrawingAsset: Codable, Equatable {
    let sourcePageId: String
    let filename: String
    let hash: String
    let bytes: Int
}

struct NotebookSubmissionMetadata: Codable, Equatable {
    let id: String
    let title: String
    let noteId: String
    let noteTitle: String
    let revision: Int
    let selectedPageIds: [String]
    let sourcePages: [NotebookSourcePage]
    let contentHash: String
}

enum NotebookSubmissionState: String, Codable {
    case waitingForMac, received, awaitingAssistant, processing, added, reviewed, needsAttention, paused

    var title: String {
        switch self {
        case .waitingForMac: return "Waiting for Mac"
        case .received: return "Received on Mac"
        case .awaitingAssistant: return "Ready for your assistant"
        case .processing: return "Processing on Mac"
        case .added: return "Added to Recall"
        case .reviewed: return "Reviewed on Mac"
        case .needsAttention: return "Needs attention on Mac"
        case .paused: return "Capture paused on Mac"
        }
    }

    static func fromReceipt(_ value: String) -> NotebookSubmissionState? {
        switch value {
        case "received", "notebook_received": return .received
        case "awaiting_assistant": return .awaitingAssistant
        case "processing": return .processing
        case "added", "notebook_added": return .added
        case "reviewed", "notebook_reviewed": return .reviewed
        case "needs_attention", "notebook_needs_attention": return .needsAttention
        case "paused": return .paused
        default: return nil
        }
    }
}

struct NotebookSubmission: Codable, Identifiable, Equatable {
    let version: Int
    let id: String
    let notebookId: String
    let noteId: String
    let revision: Int
    let createdAt: Date
    let metadata: NotebookSubmissionMetadata
    let pages: [NotebookSubmissionPage]
    let drawings: [NotebookDrawingAsset]
    var state: NotebookSubmissionState
    var lastError: String?
    var retryAllowed: Bool
    var receivedAt: Date?
    var processedAt: Date?
    var inboxId: String?
    var cardIds: [String]?
    var knowledgeStatus: String?
    /// An explicitly queued notebook must never follow a later pairing to a
    /// different Mac. Older local queues with no recipient need a new send.
    var recipientInstallationId: String? = nil

    var contentHash: String { metadata.contentHash }
    var sourcePages: [NotebookSourcePage] { metadata.sourcePages }
    var selectedPageIds: [String] { metadata.selectedPageIds }

    var isPendingDelivery: Bool { state == .waitingForMac && retryAllowed }
    var isProcessed: Bool { state == .added && processedAt != nil }

    /// No provider call or transfer is performed while building this manifest.
    func manifest() -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        let frontPages: [[String: Any]] = pages.map { page in
            ["index": page.order - 1, "hash": page.sha256, "mime": page.mimeType,
             "name": page.filename, "width": page.width, "height": page.height,
             "sourcePageId": page.sourcePageId, "sourceRevision": page.sourceRevision,
             "sourceHash": page.sourceHash]
        }
        let editable: [[String: Any]] = drawings.map { ["sourcePageId": $0.sourcePageId, "hash": $0.hash, "bytes": $0.bytes] }
        let sources: [[String: Any]] = sourcePages.map { ["id": $0.id, "revision": $0.revision, "hash": $0.hash] }
        return ["version": 3, "id": id, "documentId": noteId, "revision": revision,
                "mode": "notebook", "questionId": NSNull(), "handoffId": NSNull(),
                "createdAt": formatter.string(from: createdAt), "evaluate": false,
                "pages": frontPages, "drawing": NSNull(), "drawings": editable,
                "notebook": ["id": metadata.id, "title": metadata.title,
                             "noteId": noteId, "noteTitle": metadata.noteTitle,
                             "revision": revision, "selectedPageIds": selectedPageIds,
                             "sourcePages": sources, "contentHash": contentHash]]
    }
}

struct NotebookSyncSummary: Equatable {
    let lastSentAt: Date?
    let lastProcessedAt: Date?
    let currentPageCount: Int
    let processedPageCount: Int
    let hasChanges: Bool
    let pendingCount: Int
    let title: String
    let detail: String
}
