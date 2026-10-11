import Foundation
import PencilKit
import UIKit

@MainActor
final class DocumentStore: ObservableObject {
    @Published private(set) var documents: [PaperDocument] = []
    @Published private(set) var attempts: [PaperAttempt] = []
    @Published var storageError: String?
    let directory: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var unreadableIndex = false
    private var deletions: [DeletedSheet] = []
    private let writeIndex: (Data, URL) throws -> Void
    private let removeItem: (URL) throws -> Void

    init(directory: URL? = nil,
         writeIndex: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) },
         removeItem: @escaping (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) }) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("RecallPad", isDirectory: true)
        self.writeIndex = writeIndex
        self.removeItem = removeItem
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
            try requireDirectory(self.directory)
            if try itemType(at: indexURL) != nil {
                let index = try readIndex()
                documents = index.documents
                attempts = index.attempts
                deletions = index.deletions ?? []
            }
        } catch {
            unreadableIndex = true
            storageError = "Saved work could not be read. Existing files have been kept. \(error.localizedDescription)"
        }
        if !unreadableIndex { finishDeletions() }
    }

    private struct DeletedSheet: Codable {
        let documentId: String
        let attemptIds: [String]
    }
    private struct Index: Codable {
        let version: Int
        let documents: [PaperDocument]
        let attempts: [PaperAttempt]
        let deletions: [DeletedSheet]?
    }
    private var indexURL: URL { directory.appendingPathComponent("index.json") }
    private func documentURL(_ id: String) -> URL { directory.appendingPathComponent(id, isDirectory: true) }
    func attemptURL(_ id: String) -> URL { directory.appendingPathComponent("attempts", isDirectory: true).appendingPathComponent(id, isDirectory: true) }

    private func persist() throws {
        guard !unreadableIndex else { throw PadError.rejected("The saved index is unreadable. Existing work is preserved; export the app’s files for recovery before creating more sheets.") }
        try requireDirectory(directory)
        if let type = try itemType(at: indexURL), type != .typeRegular {
            throw PadError.rejected("The saved index is not a regular file. Existing work has been preserved.")
        }
        try writeIndex(encoder.encode(currentIndex), indexURL)
    }

    private var currentIndex: Index { Index(version: 1, documents: documents, attempts: attempts, deletions: deletions) }

    private func requireIdentifier(_ id: String) throws {
        guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id else {
            throw PadError.rejected("A saved sheet or submission has an invalid identifier. Existing files have been kept.")
        }
    }

    private func itemType(at url: URL) throws -> FileAttributeType? {
        do { return try FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return nil }
    }

    private func requireDirectory(_ url: URL, allowMissing: Bool = false) throws {
        let type = try itemType(at: url)
        if allowMissing && type == nil { return }

        guard type == .typeDirectory else {
            throw PadError.rejected("A saved-work folder is missing or is a link. Existing files have been kept.")
        }
    }

    private func readIndex() throws -> Index {
        guard try itemType(at: indexURL) == .typeRegular else {
            throw PadError.rejected("The saved index is missing or is not a regular file. Existing work has been preserved.")
        }
        let index = try decoder.decode(Index.self, from: Data(contentsOf: indexURL))
        guard index.version == 1 else { throw PadError.rejected("This saved-work format is newer than this app. Update Recall Pad before opening it.") }

        let documentIds = index.documents.map(\.id)
        let attemptIds = index.attempts.map(\.id)
        let deleted = index.deletions ?? []
        let deletedDocumentIds = deleted.map(\.documentId)
        let deletedAttemptIds = deleted.flatMap(\.attemptIds)
        for id in documentIds + attemptIds + index.attempts.map(\.documentId) + deletedDocumentIds + deletedAttemptIds { try requireIdentifier(id) }
        guard Set(documentIds).count == documentIds.count,
              Set(attemptIds).count == attemptIds.count,
              Set(deletedDocumentIds).count == deletedDocumentIds.count,
              Set(deletedAttemptIds).count == deletedAttemptIds.count,
              Set(documentIds).isDisjoint(with: deletedDocumentIds),
              Set(attemptIds).isDisjoint(with: deletedAttemptIds),
              index.attempts.allSatisfy({ documentIds.contains($0.documentId) }),
              index.documents.allSatisfy({ document in
                  guard let problem = document.tutorProblem else { return true }
                  return document.mode == .tutor && document.questionPackage == nil && problem.isValid
                      && document.destination == "assistant" && document.handoffId == problem.sessionId
              }),
              index.attempts.allSatisfy({ attempt in
                  if attempt.version == 2 {
                      return attempt.mode == .tutor && attempt.deliveryTarget == "assistant" && attempt.destination == "assistant"
                          && attempt.questionPackageId == nil && attempt.tutorProblemId.flatMap(UUID.init(uuidString:)) != nil
                          && attempt.handoffId.flatMap(UUID.init(uuidString:)) != nil
                  }
                  guard attempt.version == 1, attempt.tutorProblemId == nil else { return false }
                  guard let target = attempt.deliveryTarget else { return true }
                  return attempt.mode == .tutor && ["clipboard", "chatgpt", "codex"].contains(target) && target == attempt.destination
              }),
              index.attempts.allSatisfy({ attempt in attempt.pages.allSatisfy { page in
                  !page.filename.isEmpty && !page.filename.hasPrefix(".")
                      && !page.filename.contains("/") && !page.filename.contains("\\")
              } }) else {
            throw PadError.rejected("The saved-work index has inconsistent records. Existing files have been kept.")
        }
        return index
    }

    private func verifyCurrentIndex() throws {
        do {
            let disk = try readIndex()
            let normalized = Index(version: disk.version, documents: disk.documents, attempts: disk.attempts, deletions: disk.deletions ?? [])
            guard try encoder.encode(normalized) == encoder.encode(currentIndex) else {
                throw PadError.rejected("The saved-work index changed outside this session. Reopen Recall Pad before deleting a sheet.")
            }
        } catch {
            unreadableIndex = true
            storageError = "Saved work needs recovery. Its index and files have not been overwritten."
            throw error
        }
    }

    private func deletionURLs(_ deletion: DeletedSheet) throws -> [URL] {
        try requireDirectory(directory)
        try requireIdentifier(deletion.documentId)
        for id in deletion.attemptIds { try requireIdentifier(id) }
        if !deletion.attemptIds.isEmpty { try requireDirectory(directory.appendingPathComponent("attempts", isDirectory: true), allowMissing: true) }
        return [documentURL(deletion.documentId)] + deletion.attemptIds.map(attemptURL)
    }

    private func validateDeletionTree(_ url: URL) throws {
        try requireDirectory(url, allowMissing: true)
        guard try itemType(at: url) != nil else { return }

        // Reject links before committing deletion. Removing a whole sheet must
        // never traverse another sheet, another container or external files.
        var enumerationError: Error?
        guard let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.isSymbolicLinkKey], options: [], errorHandler: { _, error in enumerationError = error; return false }) else {
            throw PadError.rejected("This sheet’s files could not be inspected safely. They have been kept.")
        }
        for case let child as URL in files {
            guard try itemType(at: child) != .typeSymbolicLink else {
                throw PadError.rejected("This sheet contains a linked file. Its files have been kept for recovery.")
            }
        }
        if let enumerationError { throw enumerationError }
    }

    func delete(_ document: PaperDocument) throws {
        guard !unreadableIndex else { throw PadError.rejected("Existing saved work needs recovery. The unreadable index has not been overwritten.") }
        try requireIdentifier(document.id)
        guard documents.contains(where: { $0.id == document.id }) else { return }
        try verifyCurrentIndex()
        let deletion = DeletedSheet(documentId: document.id, attemptIds: attempts.filter { $0.documentId == document.id }.map(\.id))
        for url in try deletionURLs(deletion) { try validateDeletionTree(url) }
        let previousDocuments = documents
        let previousAttempts = attempts
        let previousDeletions = deletions
        documents.removeAll { $0.id == document.id }
        attempts.removeAll { $0.documentId == document.id }
        deletions.append(deletion)
        do { try persist() }
        catch {
            documents = previousDocuments
            attempts = previousAttempts
            deletions = previousDeletions
            throw error
        }
        // The atomic index is the commit point. After it succeeds, the deleted
        // sheet cannot reappear or enter the outbox, even if cleanup is delayed.
        finishDeletions()
    }

    private func finishDeletions() {
        guard !deletions.isEmpty else { return }

        for deletion in deletions {
            do {
                let urls = try deletionURLs(deletion)
                for url in urls { try validateDeletionTree(url) }
                for url in urls where try itemType(at: url) != nil { try removeItem(url) }
                let previous = deletions
                deletions.removeAll { $0.documentId == deletion.documentId }
                do { try persist() }
                catch { deletions = previous; throw error }
            } catch {
                storageError = "The sheet was deleted. Some local files still need cleanup; reopen Recall Pad to retry. Other sheets and Mac copies are unchanged."
            }
        }
    }

    @discardableResult
    func open(mode: PaperMode, question: QuestionPackage? = nil, tutorProblem: TutorProblem? = nil, tutorTitle: String? = nil) throws -> PaperDocument {
        guard !unreadableIndex else { throw PadError.rejected("Existing saved work needs recovery. The unreadable index has not been overwritten.") }
        if let tutorProblem {
            guard mode == .tutor, question == nil, tutorProblem.isValid else { throw PadError.rejected("This tutor prompt has invalid session data. Existing work has been kept.") }

            if let existing = documents.first(where: { $0.tutorProblem?.id == tutorProblem.id }) {
                guard existing.tutorProblem == tutorProblem else { throw PadError.rejected("The saved tutor prompt differs from this revision. Existing work has been kept.") }

                return existing
            }
        }
        if let question, let existing = documents.first(where: { $0.questionPackage?.id == question.id }) { return existing }
        let document = PaperDocument(mode: mode, question: question, tutorProblem: tutorProblem, tutorTitle: tutorTitle)
        try FileManager.default.createDirectory(at: documentURL(document.id), withIntermediateDirectories: true)
        documents.insert(document, at: 0)
        do { try persist() } catch { documents.removeAll { $0.id == document.id }; throw error }
        return document
    }

    func openTutorWorkspace() throws -> PaperDocument {
        guard !unreadableIndex else { throw PadError.rejected("Existing saved work needs recovery. The unreadable index has not been overwritten.") }

        if let existing = documents.filter({ $0.mode == .tutor && $0.tutorProblem == nil }).max(by: { $0.updatedAt < $1.updatedAt }) {
            return existing
        }

        return try open(mode: .tutor)
    }

    func followTutorProblem(from document: PaperDocument, drawing: PKDrawing, in session: StudySession) throws -> PaperDocument? {
        guard let next = session.nextTutorProblem(after: document) else { return nil }

        _ = try save(document, drawing: drawing)
        return try open(mode: .tutor, tutorProblem: next, tutorTitle: session.tutorTitle)
    }

    func drawing(for document: PaperDocument) throws -> PKDrawing {
        try requireIdentifier(document.id)
        guard documents.contains(where: { $0.id == document.id }) else { throw PadError.rejected("This sheet was deleted or is no longer available.") }
        try requireDirectory(documentURL(document.id), allowMissing: true)
        let url = documentURL(document.id).appendingPathComponent("drawing.data")
        guard FileManager.default.fileExists(atPath: url.path) else { return PKDrawing() }
        return try PKDrawing(data: Data(contentsOf: url))
    }

    func save(_ document: PaperDocument, drawing: PKDrawing) throws -> PaperDocument {
        guard !unreadableIndex else { throw PadError.rejected("Existing saved work needs recovery. Its files have not been overwritten.") }
        try requireIdentifier(document.id)
        guard documents.contains(where: { $0.id == document.id }) else { throw PadError.rejected("This sheet was deleted or is no longer available. A stale edit has not recreated it.") }
        guard documents.first(where: { $0.id == document.id })?.tutorProblem == document.tutorProblem else {
            throw PadError.rejected("A saved sheet cannot be rebound to another tutor prompt. Its original work has been kept.")
        }
        if let problem = document.tutorProblem {
            guard document.destination == "assistant", document.handoffId == problem.sessionId else {
                throw PadError.rejected("A saved tutor sheet cannot be rebound to another conversation. Its original work has been kept.")
            }
        }
        let url = documentURL(document.id)
        try requireDirectory(url, allowMissing: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try drawing.dataRepresentation().write(to: url.appendingPathComponent("drawing.data"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var saved = document
        let latestDocumentRevision = documents.first(where: { $0.id == document.id })?.revision ?? 0
        let latestAttemptRevision = attempts.filter { $0.documentId == document.id }.map(\.documentRevision).max() ?? 0
        saved.revision = max(document.revision, latestDocumentRevision, latestAttemptRevision) + 1
        saved.updatedAt = Date()
        let inkBounds = drawing.strokes.isEmpty ? nil : drawing.bounds
        saved.canvasHeight = PaperGeometry.canvasHeight(current: document.canvasHeight, inkBounds: inkBounds)
        if let inkBounds, PaperGeometry.hasFiniteInkBounds(inkBounds) {
            let bounds = inkBounds.insetBy(dx: -16, dy: -16)
            let image = paperImage(drawing, bounds: bounds, scale: min(1, 320 / max(bounds.width, 1)))
            if let thumbnail = image.pngData() { try thumbnail.write(to: url.appendingPathComponent("thumbnail.png"), options: .atomic) }
        }
        let previous = documents
        if let index = documents.firstIndex(where: { $0.id == saved.id }) { documents[index] = saved }
        do { try persist() } catch { documents = previous; throw error }
        return saved
    }

    func submit(_ document: PaperDocument, drawing: PKDrawing) throws -> PaperAttempt {
        let assistant = document.tutorProblem != nil
        let deliveryTarget = document.mode == .tutor ? (assistant ? "assistant" : "clipboard") : nil
        if let problem = document.tutorProblem {
            guard document.mode == .tutor, document.questionPackage == nil, problem.isValid,
                  document.destination == "assistant", document.handoffId == problem.sessionId else {
                throw PadError.rejected("This sheet’s tutor context changed. Its original work has been kept; reopen the original sheet before sending.")
            }
        } else if document.mode == .tutor {
            guard let destination = document.destination, ["clipboard", "chatgpt", "codex"].contains(destination) else {
                throw PadError.rejected("This sheet has invalid saved transfer data. Its work has been kept; restore the sheet before sending.")
            }
        }
        guard !drawing.strokes.isEmpty else { throw PadError.blankSheet }
        let saved = try save(document, drawing: drawing)
        let id = UUID().uuidString.lowercased()
        let attemptDirectory = attemptURL(id)
        try FileManager.default.createDirectory(at: attemptDirectory, withIntermediateDirectories: true)
        let top = max(0, drawing.bounds.minY - 40)
        let strokeRanges = drawing.strokes.map { Double($0.renderBounds.minY - top)...Double($0.renderBounds.maxY - top) }
        let totalHeight = max(100, drawing.bounds.maxY + 40 - top)
        let ranges = PaperPagination.ranges(height: totalHeight, strokeRanges: strokeRanges)
        guard ranges.count <= 20 else { throw PadError.tooLarge }
        let width = max(800, drawing.bounds.maxX + 40)
        guard width * 1.5 <= 16384, width * 1400 * 2.25 <= 32_000_000 else { throw PadError.tooLarge }
        let editableDrawing = drawing.dataRepresentation()
        guard editableDrawing.count <= 32 * 1024 * 1024 else { throw PadError.tooLarge }
        var pages: [PaperPage] = []
        var byteCount = editableDrawing.count
        for range in ranges {
            guard strokeRanges.contains(where: { $0.overlaps(range) }) else { continue }
            let index = pages.count
            let rect = CGRect(x: 0, y: top + range.lowerBound, width: width, height: range.upperBound - range.lowerBound)
            let image = paperImage(drawing, bounds: rect, scale: 1.5)
            guard let data = image.pngData(), data.count <= 12 * 1024 * 1024 else { throw PadError.tooLarge }
            byteCount += data.count
            guard byteCount <= 64 * 1024 * 1024 else { throw PadError.tooLarge }
            let filename = "page-\(index + 1).png"
            try data.write(to: attemptDirectory.appendingPathComponent(filename), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            pages.append(PaperPage(id: UUID().uuidString.lowercased(), order: index + 1, filename: filename, mimeType: "image/png", sha256: data.sha256, byteLength: data.count, width: image.cgImage!.width, height: image.cgImage!.height))
        }
        try editableDrawing.write(to: attemptDirectory.appendingPathComponent("drawing.data"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let attempt = PaperAttempt(version: assistant ? 2 : 1, id: id, documentId: document.id, mode: document.mode, documentRevision: saved.revision, questionPackageId: document.questionPackage?.id, destination: document.mode == .tutor ? deliveryTarget : document.destination, handoffId: document.handoffId, createdAt: Date(), pages: pages, state: .waitingForMac, lastError: nil, retryAllowed: true, deliveryTarget: deliveryTarget, tutorProblemId: document.tutorProblem?.id)
        attempts.insert(attempt, at: 0)
        do { try persist() } catch { attempts.removeAll { $0.id == id }; throw error }
        return attempt
    }

    private func paperImage(_ drawing: PKDrawing, bounds: CGRect, scale: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: bounds.size, format: format)
        return renderer.image { context in
            // PencilKit adapts ink to the current appearance. Exported pages
            // and thumbnails always use dark ink on white paper.
            UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: bounds.size))
                drawing.image(from: bounds, scale: scale).draw(in: CGRect(origin: .zero, size: bounds.size))
            }
        }
    }

    func updateAttempt(_ id: String, state: DeliveryState, error: String? = nil, retryAllowed: Bool = true) throws {
        guard let index = attempts.firstIndex(where: { $0.id == id }) else { return }
        let previousAttempts = attempts
        let previousDocuments = documents
        attempts[index].state = state
        attempts[index].lastError = error
        attempts[index].retryAllowed = retryAllowed
        if let documentIndex = documents.firstIndex(where: { $0.id == attempts[index].documentId }) { documents[documentIndex].state = state }
        do { try persist() } catch { attempts = previousAttempts; documents = previousDocuments; throw error }
    }

    func retry(_ id: String) throws {
        guard let attempt = attempts.first(where: { $0.id == id }), attempt.state == .needsAttention else { return }
        try updateAttempt(id, state: .waitingForMac, retryAllowed: true)
    }

    func thumbnail(for document: PaperDocument) -> UIImage? { UIImage(contentsOfFile: documentURL(document.id).appendingPathComponent("thumbnail.png").path) }
    func pageURLs(for attempt: PaperAttempt) -> [URL] { attempt.pages.map { attemptURL(attempt.id).appendingPathComponent($0.filename) } }

    func cacheSession(_ session: StudySession) throws {
        try encoder.encode(session).write(to: directory.appendingPathComponent("session.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func cachedSession() -> StudySession? {
        try? decoder.decode(StudySession.self, from: Data(contentsOf: directory.appendingPathComponent("session.json")))
    }

    func cacheTutorSession(_ session: StudySession) throws {
        guard !unreadableIndex, session.mode == "idle" || session.hasValidTutorBinding else {
            throw PadError.rejected("The tutor session could not be saved safely. Existing work has been kept.")
        }
        try requireDirectory(directory)
        let url = directory.appendingPathComponent("tutor-session.json")
        if let type = try itemType(at: url), type != .typeRegular { throw PadError.rejected("The saved tutor session is not a regular file.") }

        try encoder.encode(session).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func cachedTutorSession() -> StudySession? {
        let url = directory.appendingPathComponent("tutor-session.json")
        guard (try? itemType(at: url)) == .typeRegular,
              let session = try? decoder.decode(StudySession.self, from: Data(contentsOf: url)),
              session.mode == "idle" || session.hasValidTutorBinding else { return nil }

        return session
    }

    func pdf(for attempt: PaperAttempt) throws -> URL {
        guard attempts.contains(where: { $0.id == attempt.id }) else { throw PadError.rejected("This local submission was deleted or is no longer available.") }
        try requireIdentifier(attempt.id)
        try requireDirectory(attemptURL(attempt.id))
        let url = attemptURL(attempt.id).appendingPathComponent("work.pdf")
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 800, height: 1120))
        try renderer.writePDF(to: url) { context in
            for page in pageURLs(for: attempt) {
                guard let image = UIImage(contentsOfFile: page.path) else { continue }
                context.beginPage()
                let size = image.size
                let scale = min(760 / size.width, 1080 / size.height)
                image.draw(in: CGRect(x: 20, y: 20, width: size.width * scale, height: size.height * scale))
            }
        }
        return url
    }
}
