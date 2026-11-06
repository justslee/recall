import Foundation
import PencilKit
import UIKit

/// Personal notebooks have their own index and outbox. Saving ink never creates
/// a submission and never touches the live Study/Tutor document store.
@MainActor
final class NotebookStore: ObservableObject {
    @Published private(set) var notebooks: [PadNotebook] = []
    @Published private(set) var notes: [PadNotebookNote] = []
    @Published private(set) var pages: [PadNotebookPage] = []
    @Published private(set) var submissions: [NotebookSubmission] = []
    @Published var storageError: String?
    let directory: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let writeIndex: (Data, URL) throws -> Void
    private let removeItem: (URL) throws -> Void
    private var unreadableIndex = false
    private var deletions: [PendingDeletion] = []
    private static let artworkMarker = Data("RECALL_NOTEBOOK_ARTWORK_V1\0".utf8)
    private struct ArtworkArchive: Codable {
        let version: Int
        let ink: Data
        let shapes: [NotebookShape]
    }
    private struct PageArtwork {
        let drawing: PKDrawing
        let shapes: [NotebookShape]
    }

    private struct PendingDeletion: Codable {
        let id: String
        let pageIds: [String]
        let submissionIds: [String]
    }

    private struct Index: Codable {
        let version: Int
        let notebooks: [PadNotebook]
        var notes: [PadNotebookNote]
        let pages: [PadNotebookPage]
        let submissions: [NotebookSubmission]
        let deletions: [PendingDeletion]
    }

    init(directory: URL? = nil,
         writeIndex: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) },
         removeItem: @escaping (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) }) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RecallPad/notebooks", isDirectory: true)
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
            if try itemType(at: indexURL) != nil { assign(try readIndex()) }
        } catch {
            unreadableIndex = true
            storageError = "Your notebook index could not be read. Existing notes and ink have been kept. \(error.localizedDescription)"
        }
        if !unreadableIndex { finishDeletions() }
    }

    private var indexURL: URL { directory.appendingPathComponent("index.json") }
    private var currentIndex: Index { Index(version: 1, notebooks: notebooks, notes: notes, pages: pages, submissions: submissions, deletions: deletions) }
    private func pageDirectory(_ id: String) -> URL { directory.appendingPathComponent("pages", isDirectory: true).appendingPathComponent(id, isDirectory: true) }
    func submissionURL(_ id: String) -> URL { directory.appendingPathComponent("submissions", isDirectory: true).appendingPathComponent(id, isDirectory: true) }
    private func drawingURL(_ page: PadNotebookPage) -> URL { pageDirectory(page.id).appendingPathComponent("drawing-\(page.revision).data") }

    private func assign(_ index: Index) {
        notebooks = index.notebooks
        notes = index.notes
        pages = index.pages
        submissions = index.submissions
        deletions = index.deletions
    }

    private func identifier() -> String { UUID().uuidString.lowercased() }
    private func requireIdentifier(_ id: String) throws {
        guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id else {
            throw PadError.rejected("A saved notebook record has an invalid identifier. Its existing files have been kept.")
        }
    }

    private func isHash(_ value: String) -> Bool {
        value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private func safeFilename(_ value: String) -> Bool {
        !value.isEmpty && !value.hasPrefix(".") && !value.contains("/") && !value.contains("\\")
    }

    private func itemType(at url: URL) throws -> FileAttributeType? {
        do { return try FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return nil }
    }

    private func requireDirectory(_ url: URL, allowMissing: Bool = false) throws {
        let type = try itemType(at: url)
        if allowMissing && type == nil { return }

        guard type == .typeDirectory else { throw PadError.rejected("A notebook folder is missing or linked. Existing work has been kept.") }
    }

    private func readIndex() throws -> Index {
        guard try itemType(at: indexURL) == .typeRegular else { throw PadError.rejected("The notebook index is not a regular file. Existing work has been kept.") }
        var index = try decoder.decode(Index.self, from: Data(contentsOf: indexURL))
        guard index.version == 1 else { throw PadError.rejected("These notebooks need a newer Recall Pad. Existing work has been kept.") }
        let notebookIds = index.notebooks.map(\.id)
        let noteIds = index.notes.map(\.id)
        let pageIds = index.pages.map(\.id)
        let submissionIds = index.submissions.map(\.id)
        let deletedPageIds = index.deletions.flatMap(\.pageIds)
        let deletedSubmissionIds = index.deletions.flatMap(\.submissionIds)
        for id in notebookIds + noteIds + pageIds + submissionIds + deletedPageIds + deletedSubmissionIds + index.deletions.map(\.id) { try requireIdentifier(id) }
        guard Set(notebookIds).count == notebookIds.count, Set(noteIds).count == noteIds.count,
              Set(pageIds).count == pageIds.count, Set(submissionIds).count == submissionIds.count,
              Set(deletedPageIds).count == deletedPageIds.count, Set(deletedSubmissionIds).count == deletedSubmissionIds.count,
              Set(pageIds).isDisjoint(with: deletedPageIds), Set(submissionIds).isDisjoint(with: deletedSubmissionIds),
              index.notebooks.allSatisfy({ !$0.title.isEmpty && $0.title.count <= 240 }),
              index.notes.allSatisfy({ note in
                  notebookIds.contains(note.notebookId) && !note.title.isEmpty && note.title.count <= 240 && (1..<1_000_000_000).contains(note.revision)
                      && Set(note.pageIds).count == note.pageIds.count
                      && Set(note.pageIds) == Set(index.pages.filter { $0.noteId == note.id }.map(\.id))
              }),
              index.pages.allSatisfy({ page in
                  noteIds.contains(page.noteId) && index.notes.first { $0.id == page.noteId }?.pageIds.contains(page.id) == true
                      && (0..<1_000_000_000).contains(page.revision) && isHash(page.contentHash) && page.canvasHeight.isFinite
                      && page.canvasHeight >= PaperGeometry.minimumHeight
              }),
              index.submissions.allSatisfy({ validSubmission($0, notebookIds: notebookIds, noteIds: noteIds) }) else {
            throw PadError.rejected("The notebook index has inconsistent records. Existing notes and ink have been kept.")
        }
        // A navigation hint cannot invalidate otherwise recoverable ink. Older
        // indexes omit it; stale or cross-note pointers safely choose Page 1.
        for position in index.notes.indices {
            if let remembered = index.notes[position].lastOpenedPageId,
               !index.notes[position].pageIds.contains(remembered) {
                index.notes[position].lastOpenedPageId = index.notes[position].pageIds.first
            }
        }
        return index
    }

    private func validSubmission(_ submission: NotebookSubmission, notebookIds: [String], noteIds: [String]) -> Bool {
        let metadata = submission.metadata
        let selected = metadata.selectedPageIds
        guard submission.version == 3, submission.revision > 0, notebookIds.contains(submission.notebookId), noteIds.contains(submission.noteId),
              metadata.id == submission.notebookId, metadata.noteId == submission.noteId, metadata.revision == submission.revision,
              !metadata.title.isEmpty, metadata.title.count <= 240, !metadata.noteTitle.isEmpty, metadata.noteTitle.count <= 240,
              isHash(metadata.contentHash), !selected.isEmpty, selected.count <= 20, Set(selected).count == selected.count,
              selected == metadata.sourcePages.map(\.id), selected == submission.drawings.map(\.sourcePageId),
              selected.allSatisfy({ (try? requireIdentifier($0)) != nil }),
              metadata.sourcePages.allSatisfy({ $0.revision > 0 && isHash($0.hash) }),
              submission.drawings.allSatisfy({ safeFilename($0.filename) && isHash($0.hash) && $0.bytes > 0 && $0.bytes <= 32 * 1024 * 1024 }),
              !submission.pages.isEmpty, submission.pages.count <= 20,
              submission.pages.map(\.order) == Array(1...submission.pages.count),
              Set(submission.pages.map(\.filename)).count == submission.pages.count,
              submission.pages.allSatisfy({ page in
                  let source = metadata.sourcePages.first { $0.id == page.sourcePageId }
                  return safeFilename(page.filename) && isHash(page.sha256) && page.mimeType == "image/png"
                      && page.byteLength > 0 && page.byteLength <= 12 * 1024 * 1024 && page.width > 0 && page.height > 0
                      && source?.revision == page.sourceRevision && source?.hash == page.sourceHash
              }), Set(submission.pages.map(\.sourcePageId)) == Set(selected),
              submission.pages.reduce(0, { $0 + $1.byteLength }) + submission.drawings.reduce(0, { $0 + $1.bytes }) <= 64 * 1024 * 1024,
              submission.processedAt == nil || submission.state == .added else { return false }

        return true
    }

    private func persist() throws {
        guard !unreadableIndex else { throw PadError.rejected("Saved notebooks need recovery. Their unreadable index has not been overwritten.") }
        try requireDirectory(directory)
        if let type = try itemType(at: indexURL), type != .typeRegular { throw PadError.rejected("The notebook index is not a regular file. Existing files have been kept.") }
        try writeIndex(encoder.encode(currentIndex), indexURL)
    }

    private func verifyCurrentIndex() throws {
        guard !unreadableIndex else { throw PadError.rejected("Existing notebooks need recovery. Their index and ink have been preserved.") }
        if try itemType(at: indexURL) == nil {
            guard notebooks.isEmpty, notes.isEmpty, pages.isEmpty, submissions.isEmpty, deletions.isEmpty else {
                unreadableIndex = true
                throw PadError.rejected("The notebook index disappeared. Existing files have been kept for recovery.")
            }
            return
        }
        do {
            guard try encoder.encode(readIndex()) == encoder.encode(currentIndex) else { throw PadError.rejected("The notebook index changed outside this session. Reopen Recall Pad before editing it.") }
        } catch {
            unreadableIndex = true
            storageError = "Saved notebooks need recovery. The existing index and files have not been overwritten."
            throw error
        }
    }

    private func commit(_ mutation: () throws -> Void) throws {
        try verifyCurrentIndex()
        let previous = currentIndex
        do { try mutation(); try persist() }
        catch { assign(previous); throw error }
    }

    private func cleanTitle(_ value: String, fallback: String) -> String {
        let title = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? fallback : String(title.prefix(240))
    }

    @discardableResult func createNotebook(title: String) throws -> PadNotebook {
        let now = Date()
        let notebook = PadNotebook(id: identifier(), title: cleanTitle(title, fallback: "My notebook"), createdAt: now, updatedAt: now)
        try commit { notebooks.insert(notebook, at: 0) }
        return notebook
    }

    func renameNotebook(_ notebook: PadNotebook, title: String) throws {
        guard let position = notebooks.firstIndex(where: { $0.id == notebook.id }) else { throw PadError.rejected("This notebook is no longer available.") }
        let updated = cleanTitle(title, fallback: notebooks[position].title)
        guard updated != notebooks[position].title else { return }
        try commit { notebooks[position].title = updated; notebooks[position].updatedAt = Date() }
    }

    @discardableResult func createNote(in notebook: PadNotebook, title: String) throws -> PadNotebookNote {
        guard notebooks.contains(where: { $0.id == notebook.id }) else { throw PadError.rejected("This notebook is no longer available.") }
        let now = Date()
        let note = PadNotebookNote(id: identifier(), notebookId: notebook.id, title: cleanTitle(title, fallback: "Untitled note"), pageIds: [], revision: 1, createdAt: now, updatedAt: now)
        try commit { notes.insert(note, at: 0); touchNotebook(notebook.id, at: now) }
        return note
    }

    /// One tap opens a complete writable note. The note and first page enter
    /// the index together; failures never leave an empty row or orphan ink.
    @discardableResult func createNoteForWriting(in notebook: PadNotebook) throws -> PadNotebookPage {
        guard notebooks.contains(where: { $0.id == notebook.id }) else { throw PadError.rejected("This notebook is no longer available.") }
        try verifyCurrentIndex()
        let now = Date()
        let titles = Set(notes.filter { $0.notebookId == notebook.id }.map(\.title))
        var number = 1
        while titles.contains("Untitled note \(number)") { number += 1 }
        let noteId = identifier()
        let (page, data) = blankPage(noteId: noteId, number: 1, at: now)
        let note = PadNotebookNote(id: noteId, notebookId: notebook.id, title: "Untitled note \(number)", pageIds: [page.id], revision: 1, createdAt: now, updatedAt: now, lastOpenedPageId: page.id)
        try commitBlankPageAsset(page, data: data) {
            notes.insert(note, at: 0)
            pages.append(page)
            touchNotebook(notebook.id, at: now)
        }
        return page
    }

    func resumePage(for note: PadNotebookNote) throws -> PadNotebookPage {
        guard let latest = notes.first(where: { $0.id == note.id && $0.notebookId == note.notebookId }) else { throw PadError.rejected("This note is no longer available.") }
        let ordered = pages(in: latest)
        if let remembered = latest.lastOpenedPageId,
           let page = ordered.first(where: { $0.id == remembered }) { return page }
        if let first = ordered.first { return first }
        return try addPage(to: latest)
    }

    func rememberOpenedPage(_ page: PadNotebookPage) throws {
        guard pages.contains(where: { $0.id == page.id && $0.noteId == page.noteId }),
              let position = notes.firstIndex(where: { $0.id == page.noteId && $0.pageIds.contains(page.id) }) else {
            throw PadError.rejected("This notebook page is no longer available.")
        }
        guard notes[position].lastOpenedPageId != page.id else { return }
        try commit { notes[position].lastOpenedPageId = page.id }
    }

    func renameNote(_ note: PadNotebookNote, title: String) throws {
        guard let position = notes.firstIndex(where: { $0.id == note.id }) else { throw PadError.rejected("This note is no longer available.") }
        let updated = cleanTitle(title, fallback: notes[position].title)
        guard updated != notes[position].title else { return }
        try commit {
            notes[position].title = updated
            touchNote(note.id, at: Date())
        }
    }

    func renamePage(_ page: PadNotebookPage, title: String) throws {
        guard let latest = pages.first(where: { $0.id == page.id && $0.noteId == page.noteId }) else { throw PadError.rejected("This page is no longer available.") }
        var renamed = latest
        renamed.title = cleanTitle(title, fallback: latest.title)
        _ = try savePage(renamed, drawing: drawing(for: latest), style: latest.paperStyle, canvasHeight: latest.canvasHeight)
    }

    @discardableResult func addPage(to note: PadNotebookNote) throws -> PadNotebookPage {
        guard let latest = notes.first(where: { $0.id == note.id }) else { throw PadError.rejected("This note is no longer available.") }
        try verifyCurrentIndex()
        let now = Date()
        let (page, data) = blankPage(noteId: note.id, number: latest.pageIds.count + 1, at: now)
        try commitBlankPageAsset(page, data: data) {
            pages.append(page)
            if let position = notes.firstIndex(where: { $0.id == note.id }) {
                notes[position].pageIds.append(page.id)
                notes[position].lastOpenedPageId = page.id
            }
            touchNote(note.id, at: now)
        }
        return page
    }

    private func blankPage(noteId: String, number: Int, at date: Date) -> (PadNotebookPage, Data) {
        let data = PKDrawing().dataRepresentation()
        return (PadNotebookPage(id: identifier(), noteId: noteId, title: "Page \(number)", revision: 0, contentHash: data.sha256, paperStyle: .squared, canvasHeight: PaperGeometry.minimumHeight, createdAt: date, updatedAt: date), data)
    }

    private func commitBlankPageAsset(_ page: PadNotebookPage, data: Data, mutation: () throws -> Void) throws {
        let folder = pageDirectory(page.id)
        let parent = folder.deletingLastPathComponent()
        let parentWasMissing = try itemType(at: parent) == nil
        do {
            try ensureParent(folder)
            try data.write(to: drawingURL(page), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try commit(mutation)
        } catch {
            // Remove only this new UUID's safe local tree. Never follow a
            // substituted pages-directory link while recovering an error.
            if (try? requireDirectory(parent)) != nil,
               (try? itemType(at: folder)) == .typeDirectory,
               (try? validateDeletionTree(folder)) != nil { try? removeItem(folder) }
            if parentWasMissing, (try? requireDirectory(parent)) != nil,
               (try? FileManager.default.contentsOfDirectory(atPath: parent.path).isEmpty) == true { try? removeItem(parent) }
            throw error
        }
    }

    private func touchNotebook(_ id: String, at date: Date) {
        if let position = notebooks.firstIndex(where: { $0.id == id }) { notebooks[position].updatedAt = date }
    }

    private func touchNote(_ id: String, at date: Date) {
        guard let position = notes.firstIndex(where: { $0.id == id }) else { return }
        notes[position].revision += 1
        notes[position].updatedAt = date
        touchNotebook(notes[position].notebookId, at: date)
    }

    private func ensureParent(_ url: URL) throws {
        try requireDirectory(directory)
        let parent = url.deletingLastPathComponent()
        try requireDirectory(parent, allowMissing: true)
        if try itemType(at: parent) == nil { try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: false) }
        try requireDirectory(parent)
        try requireDirectory(url, allowMissing: true)
        if try itemType(at: url) == nil { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false) }
        try requireDirectory(url)
    }

    func notes(in notebook: PadNotebook) -> [PadNotebookNote] {
        notes.filter { $0.notebookId == notebook.id }.sorted { $0.updatedAt > $1.updatedAt }
    }

    func pages(in note: PadNotebookNote) -> [PadNotebookPage] {
        guard let latest = notes.first(where: { $0.id == note.id }) else { return [] }
        return latest.pageIds.compactMap { id in pages.first { $0.id == id && $0.noteId == latest.id } }
    }

    func hasInk(for page: PadNotebookPage) throws -> Bool {
        let artwork = try artwork(for: page)
        return NotebookArtwork.hasVisibleContent(drawing: artwork.drawing, shapes: artwork.shapes)
    }

    /// A missing/corrupt drawing is an error, never an empty page. The send
    /// preview can explicitly tell the user that genuine blank pages are omitted.
    func writtenPageIds(in note: PadNotebookNote) throws -> [String] {
        try pages(in: note).filter { try hasInk(for: $0) }.map(\.id)
    }

    func drawing(for page: PadNotebookPage) throws -> PKDrawing {
        try artwork(for: page).drawing
    }

    func shapes(for page: PadNotebookPage) throws -> [NotebookShape] { try artwork(for: page).shapes }

    private func artwork(for page: PadNotebookPage) throws -> PageArtwork { try decodeArtwork(drawingData(for: page)) }

    private func decodeArtwork(_ data: Data) throws -> PageArtwork {
        let ink: Data
        let shapes: [NotebookShape]
        if data.starts(with: Self.artworkMarker) {
            let saved = try PropertyListDecoder().decode(ArtworkArchive.self, from: Data(data.dropFirst(Self.artworkMarker.count)))
            guard saved.version == 1 else { throw PadError.rejected("This diagram page needs a newer Recall Pad. Existing work is kept.") }
            try NotebookArtwork.validate(shapes: saved.shapes)
            ink = saved.ink; shapes = saved.shapes
        } else { ink = data; shapes = [] }
        let drawing = try PKDrawing(data: ink)
        guard drawing.strokes.isEmpty || PaperGeometry.hasFiniteInkBounds(drawing.bounds) else { throw PadError.rejected("This page has invalid drawing bounds. Existing work is kept.") }
        return PageArtwork(drawing: drawing, shapes: shapes)
    }

    private func encodeArtwork(drawing: PKDrawing, shapes: [NotebookShape], keepCompound: Bool) throws -> Data {
        let ink = drawing.dataRepresentation()
        if shapes.isEmpty && !keepCompound { return ink }
        let encoder = PropertyListEncoder(); encoder.outputFormat = .binary
        return Self.artworkMarker + (try encoder.encode(ArtworkArchive(version: 1, ink: ink, shapes: shapes)))
    }

    private func drawingData(for page: PadNotebookPage) throws -> Data {
        guard let latest = pages.first(where: { $0.id == page.id && $0.noteId == page.noteId }) else { throw PadError.rejected("This notebook page was deleted or is no longer available.") }
        try requireIdentifier(latest.id)
        try requireDirectory(pageDirectory(latest.id).deletingLastPathComponent())
        try requireDirectory(pageDirectory(latest.id))
        let url = drawingURL(latest)
        guard try itemType(at: url) == .typeRegular else { throw PadError.rejected("This page’s ink file is missing or linked. Existing work has been kept.") }
        guard let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
              size.intValue <= 32 * 1024 * 1024 else { throw PadError.tooLarge }
        let data = try Data(contentsOf: url)
        guard data.sha256 == latest.contentHash else { throw PadError.rejected("This page’s ink failed its integrity check. Existing work has been kept.") }
        return data
    }

    @discardableResult func savePage(_ page: PadNotebookPage, drawing: PKDrawing, style: PaperStyle, canvasHeight: Double, shapes: [NotebookShape]? = nil) throws -> PadNotebookPage {
        guard let position = pages.firstIndex(where: { $0.id == page.id && $0.noteId == page.noteId }) else { throw PadError.rejected("This page was deleted. A stale edit has not recreated it.") }
        try verifyCurrentIndex()
        let latest = pages[position]
        guard latest.revision == page.revision else { throw PadError.rejected("This page has a newer saved revision. Reopen it before changing the ink.") }
        let earlierData = try drawingData(for: latest)
        let earlierArtwork = try decodeArtwork(earlierData)
        let savedShapes = shapes ?? earlierArtwork.shapes
        try NotebookArtwork.validate(shapes: savedShapes)
        guard drawing.strokes.isEmpty || PaperGeometry.hasFiniteInkBounds(drawing.bounds) else { throw PadError.rejected("This page has invalid drawing bounds. Existing work is kept.") }
        let sameInk = (drawing.strokes.isEmpty && earlierArtwork.drawing.strokes.isEmpty) || drawing == earlierArtwork.drawing
        let contentChanged = !sameInk || savedShapes != earlierArtwork.shapes
        let data = contentChanged ? try encodeArtwork(drawing: drawing, shapes: savedShapes, keepCompound: earlierData.starts(with: Self.artworkMarker)) : earlierData
        guard data.count <= 32 * 1024 * 1024 else { throw PadError.tooLarge }
        let height = PaperGeometry.canvasHeight(current: canvasHeight, inkBounds: NotebookArtwork.contentBounds(drawing: drawing, shapes: savedShapes))
        let title = cleanTitle(page.title, fallback: latest.title)
        // PencilKit serialization is not byte-stable after decoding. Compare
        // actual drawing content; keep the committed bytes for unchanged ink.
        let inkChanged = contentChanged || style != latest.paperStyle || title != latest.title
        guard inkChanged || height != latest.canvasHeight else { return latest }

        var saved = latest
        saved.title = title
        saved.paperStyle = style
        saved.canvasHeight = height
        if inkChanged {
            saved.revision += 1
            saved.contentHash = data.sha256
            saved.updatedAt = Date()
            try ensureParent(pageDirectory(saved.id))
            // Revision files are immutable; an index-write failure cannot
            // replace the drawing belonging to the last committed revision.
            try data.write(to: drawingURL(saved), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        try commit {
            pages[position] = saved
            if inkChanged { touchNote(saved.noteId, at: saved.updatedAt) }
        }
        // Only the committed current revision belongs to the editable page.
        // Explicit submissions have independent copies, so old autosaves can
        // be removed after the index commit without changing any sent work.
        if inkChanged, (try? itemType(at: drawingURL(latest))) == .typeRegular { try? removeItem(drawingURL(latest)) }
        return saved
    }

    func thumbnail(for page: PadNotebookPage) -> UIImage? {
        guard let artwork = try? artwork(for: page),
              let content = NotebookArtwork.contentBounds(drawing: artwork.drawing, shapes: artwork.shapes) else { return nil }
        var bounds = content.insetBy(dx: -16, dy: -16)
        // A cover is a readable first-content preview, not a coverage claim.
        // Full-height reduction makes a long continuous sheet a thin stripe.
        bounds.size.height = min(bounds.height, bounds.width * 1.3)
        return NotebookArtwork.render(drawing: artwork.drawing, shapes: artwork.shapes, bounds: bounds, scale: min(1, 320 / max(bounds.width, 1)))
    }

    @discardableResult func prepareSubmission(_ note: PadNotebookNote, selectedPageIds: [String]? = nil, recipientInstallationId: String? = nil) throws -> NotebookSubmission {
        try verifyCurrentIndex()
        let submission = try makeSubmission(note, selectedPageIds: selectedPageIds, recipientInstallationId: recipientInstallationId)
        do { try commit { submissions.insert(submission, at: 0) } }
        catch { try? removeItem(submissionURL(submission.id)); throw error }
        return submission
    }

    /// Preparing a whole notebook is all-or-nothing. A blank or oversized note
    /// cannot leave an earlier note silently queued for delivery.
    func prepareSubmissions(_ notebook: PadNotebook, selectedNoteIds: [String]? = nil, recipientInstallationId: String? = nil) throws -> [NotebookSubmission] {
        try verifyCurrentIndex()
        guard notebooks.contains(where: { $0.id == notebook.id }) else { throw PadError.rejected("This notebook is no longer available.") }
        let available = notes(in: notebook).sorted { $0.createdAt < $1.createdAt }
        let selected = selectedNoteIds ?? available.map(\.id)
        guard !selected.isEmpty, Set(selected).count == selected.count, Set(selected).isSubset(of: Set(available.map(\.id))) else {
            throw PadError.rejected("Choose one or more notes from this notebook before sending.")
        }
        var prepared: [NotebookSubmission] = []
        do {
            for note in available where selected.contains(note.id) {
                let writtenPages = try writtenPageIds(in: note)
                guard !writtenPages.isEmpty else { throw PadError.rejected("‘\(note.title)’ has no writing yet. Choose notes with written pages before sending.") }
                prepared.append(try makeSubmission(note, selectedPageIds: writtenPages, recipientInstallationId: recipientInstallationId))
            }
            try commit { submissions.insert(contentsOf: prepared.reversed(), at: 0) }
            return prepared
        } catch {
            for submission in prepared { try? removeItem(submissionURL(submission.id)) }
            throw error
        }
    }

    private func makeSubmission(_ note: PadNotebookNote, selectedPageIds: [String]?, recipientInstallationId: String?) throws -> NotebookSubmission {
        guard let latestNote = notes.first(where: { $0.id == note.id }), let notebook = notebooks.first(where: { $0.id == latestNote.notebookId }) else { throw PadError.rejected("This note is no longer available.") }
        let available = pages(in: latestNote)
        let selected = selectedPageIds ?? available.map(\.id)
        guard !selected.isEmpty, selected.count <= 20, Set(selected).count == selected.count, Set(selected).isSubset(of: Set(available.map(\.id))) else {
            throw PadError.rejected("Select between 1 and 20 pages from this note. Larger notes can be sent in separate selections.")
        }
        let sourcePages = available.filter { selected.contains($0.id) }
        let artworks = try sourcePages.map { page -> PageArtwork in
            let artwork = try self.artwork(for: page)
            guard NotebookArtwork.hasVisibleContent(drawing: artwork.drawing, shapes: artwork.shapes), page.revision > 0,
                  NotebookArtwork.contentBounds(drawing: artwork.drawing, shapes: artwork.shapes) != nil else { throw PadError.rejected("‘\(page.title)’ is blank. Select pages with writing before sending to Recall.") }
            return artwork
        }
        let sources = sourcePages.map { NotebookSourcePage(id: $0.id, revision: $0.revision, hash: $0.contentHash) }
        struct SnapshotHash: Codable {
            let notebookId: String
            let notebookTitle: String
            let noteId: String
            let noteTitle: String
            let revision: Int
            let sourcePages: [NotebookSourcePage]
        }
        let hash = try encoder.encode(SnapshotHash(notebookId: notebook.id, notebookTitle: notebook.title, noteId: latestNote.id, noteTitle: latestNote.title, revision: latestNote.revision, sourcePages: sources)).sha256
        let metadata = NotebookSubmissionMetadata(id: notebook.id, title: notebook.title, noteId: latestNote.id, noteTitle: latestNote.title, revision: latestNote.revision, selectedPageIds: sources.map(\.id), sourcePages: sources, contentHash: hash)
        let id = identifier()
        let directory = submissionURL(id)
        try ensureParent(directory)
        do {
            var images: [NotebookSubmissionPage] = []
            var editable: [NotebookDrawingAsset] = []
            var byteCount = 0
            for (page, artwork) in zip(sourcePages, artworks) {
                // Send the exact committed editable drawing, not a re-encoded
                // equivalent whose archive hash may differ after decoding.
                let drawingData = try self.drawingData(for: page)
                guard drawingData.count <= 32 * 1024 * 1024, drawingData.sha256 == page.contentHash else { throw PadError.tooLarge }
                byteCount += drawingData.count
                let drawingFilename = "drawing-\(page.id).data"
                try drawingData.write(to: directory.appendingPathComponent(drawingFilename), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                editable.append(NotebookDrawingAsset(sourcePageId: page.id, filename: drawingFilename, hash: drawingData.sha256, bytes: drawingData.count))
                guard let content = NotebookArtwork.contentBounds(drawing: artwork.drawing, shapes: artwork.shapes) else { throw PadError.rejected("The selected page has no visible work.") }
                let top = max(0, content.minY - 40)
                var strokeRanges = artwork.drawing.strokes.map { Double($0.renderBounds.minY - top)...Double($0.renderBounds.maxY - top) }
                for shape in artwork.shapes where shape.hasVisibleContent {
                    if let bounds = NotebookArtwork.contentBounds(drawing: PKDrawing(), shapes: [shape]) {
                        strokeRanges.append(Double(bounds.minY - top)...Double(bounds.maxY - top))
                    }
                }
                let totalHeight = max(100, content.maxY + 40 - top)
                let ranges = PaperPagination.ranges(height: totalHeight, strokeRanges: strokeRanges)
                let exportRanges = ranges.filter { range in strokeRanges.contains(where: { $0.overlaps(range) }) }
                guard exportRanges.count + images.count <= 20 else { throw PadError.rejected("This selection exports more than 20 image pages. Your ink is saved; select fewer notebook pages or split this long page before sending.") }
                let width = max(800, content.maxX + 40)
                guard width * 1.5 <= 16384, width * 1400 * 2.25 <= 32_000_000 else { throw PadError.tooLarge }
                for range in exportRanges {
                    let bounds = CGRect(x: 0, y: top + range.lowerBound, width: width, height: range.upperBound - range.lowerBound)
                    let image = NotebookArtwork.render(drawing: artwork.drawing, shapes: artwork.shapes, bounds: bounds, scale: 1.5)
                    guard let data = image.pngData(), let cgImage = image.cgImage, data.count <= 12 * 1024 * 1024 else { throw PadError.tooLarge }
                    byteCount += data.count
                    guard byteCount <= 64 * 1024 * 1024 else { throw PadError.tooLarge }
                    let filename = "page-\(images.count + 1).png"
                    try data.write(to: directory.appendingPathComponent(filename), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    images.append(NotebookSubmissionPage(id: identifier(), order: images.count + 1, filename: filename, mimeType: "image/png", sha256: data.sha256, byteLength: data.count, width: cgImage.width, height: cgImage.height, sourcePageId: page.id, sourceRevision: page.revision, sourceHash: page.contentHash))
                }
            }
            guard !images.isEmpty, byteCount <= 64 * 1024 * 1024 else { throw PadError.tooLarge }
            return NotebookSubmission(version: 3, id: id, notebookId: notebook.id, noteId: latestNote.id, revision: latestNote.revision, createdAt: Date(), metadata: metadata, pages: images, drawings: editable, state: .waitingForMac, lastError: nil, retryAllowed: true, receivedAt: nil, processedAt: nil, inboxId: nil, cardIds: nil, knowledgeStatus: nil, recipientInstallationId: recipientInstallationId)
        } catch {
            try? removeItem(directory)
            throw error
        }
    }

    private func paperImage(_ drawing: PKDrawing, bounds: CGRect, scale: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        return UIGraphicsImageRenderer(size: bounds.size, format: format).image { context in
            UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: bounds.size))
                drawing.image(from: bounds, scale: scale).draw(in: CGRect(origin: .zero, size: bounds.size))
            }
        }
    }

    func pageURLs(for submission: NotebookSubmission) -> [URL] { submission.pages.map { submissionURL(submission.id).appendingPathComponent($0.filename) } }
    func drawingURLs(for submission: NotebookSubmission) -> [URL] { submission.drawings.map { submissionURL(submission.id).appendingPathComponent($0.filename) } }

    func updateSubmission(_ id: String, receiptState: String, message: String? = nil, processedAt: Date? = nil, receivedAt: Date? = nil, inboxId: String? = nil, cardIds: [String]? = nil, knowledgeStatus: String? = nil, retryAllowed: Bool? = nil) throws {
        guard let position = submissions.firstIndex(where: { $0.id == id }), let state = NotebookSubmissionState.fromReceipt(receiptState) else { return }
        if submissions[position].isProcessed && state != .added { return }
        // A transfer receipt is not proof that the KB/cards workflow completed.
        let completed = state == .added ? processedAt : nil
        if state == .added && completed == nil { throw PadError.rejected("The Mac reported completion without a completed-work timestamp. The earlier receipt has been kept.") }
        try commit {
            submissions[position].state = state
            submissions[position].lastError = message.map { String($0.prefix(2000)) }
            if state != .waitingForMac, submissions[position].receivedAt == nil { submissions[position].receivedAt = receivedAt ?? Date() }
            submissions[position].processedAt = completed
            if let inboxId { submissions[position].inboxId = inboxId }
            if let cardIds { submissions[position].cardIds = cardIds }
            if let knowledgeStatus { submissions[position].knowledgeStatus = knowledgeStatus }
            if let retryAllowed { submissions[position].retryAllowed = retryAllowed }
        }
    }

    func markDeliveryInterrupted(_ id: String, message: String, retryAllowed: Bool = true) throws {
        guard let position = submissions.firstIndex(where: { $0.id == id }), submissions[position].state == .waitingForMac else { return }
        try commit { submissions[position].lastError = String(message.prefix(2000)); submissions[position].retryAllowed = retryAllowed }
    }

    func retrySubmission(_ id: String) throws {
        guard let position = submissions.firstIndex(where: { $0.id == id }), [.waitingForMac, .needsAttention].contains(submissions[position].state), submissions[position].receivedAt == nil else { return }
        try commit { submissions[position].state = .waitingForMac; submissions[position].retryAllowed = true; submissions[position].lastError = nil }
    }

    func syncSummary(for note: PadNotebookNote) -> NotebookSyncSummary { summary(pages: pages(in: note), submissions: submissions.filter { $0.noteId == note.id }) }
    func syncSummary(for notebook: PadNotebook) -> NotebookSyncSummary {
        let noteIds = Set(notes(in: notebook).map(\.id))
        return summary(pages: pages.filter { noteIds.contains($0.noteId) }, submissions: submissions.filter { $0.notebookId == notebook.id })
    }

    private func summary(pages currentPages: [PadNotebookPage], submissions captures: [NotebookSubmission]) -> NotebookSyncSummary {
        let lastSent = captures.max { $0.createdAt < $1.createdAt }
        let completed = captures.filter(\.isProcessed)
        let lastProcessed = completed.compactMap(\.processedAt).max()
        let covered = currentPages.filter { page in completed.contains { capture in capture.sourcePages.contains { $0.id == page.id && $0.revision == page.revision && $0.hash == page.contentHash } } }.count
        let pending = captures.filter { [.waitingForMac, .received, .awaitingAssistant, .processing, .paused].contains($0.state) }.count
        let hasChanges = currentPages.contains { page in
            let note = notes.first { $0.id == page.noteId }
            let notebook = notebooks.first { $0.id == note?.notebookId }
            return !captures.contains { sent in
                sent.metadata.noteTitle == note?.title && sent.metadata.title == notebook?.title
                    && sent.sourcePages.contains { $0.id == page.id && $0.revision == page.revision && $0.hash == page.contentHash }
            }
        }
        let title: String
        if let lastSent, lastSent.state == .needsAttention { title = "Needs attention" }
        else if let lastSent, lastSent.state == .waitingForMac { title = "Waiting for Mac" }
        else if pending > 0 { title = hasChanges ? "New changes · awaiting processing" : "Awaiting processing" }
        else if hasChanges && lastProcessed != nil { title = "Changes since last added" }
        else if covered > 0 && covered == currentPages.count { title = "Current pages previously added" }
        else if covered > 0 { title = "\(covered) of \(currentPages.count) pages previously added" }
        else if lastSent != nil { title = hasChanges ? "Changes since last sent" : "Sent · not yet added" }
        else { title = "Not sent to Recall" }
        let detail = covered > 0
            ? "\(covered) of \(currentPages.count) current page revisions were previously added. These are historical receipts; after restoring your Mac, send a fresh selection to confirm current coverage."
            : "Your notebook stays on this iPad. Saving and editing do not send pages to Recall."
        return NotebookSyncSummary(lastSentAt: lastSent?.createdAt, lastProcessedAt: lastProcessed, currentPageCount: currentPages.count, processedPageCount: covered, hasChanges: hasChanges, pendingCount: pending, title: title, detail: detail)
    }

    func delete(_ page: PadNotebookPage) throws { try deleteRecords(pageIds: [page.id], noteIds: [], notebookIds: []) }
    func delete(_ note: PadNotebookNote) throws { try deleteRecords(pageIds: pages.filter { $0.noteId == note.id }.map(\.id), noteIds: [note.id], notebookIds: []) }
    func delete(_ notebook: PadNotebook) throws {
        let noteIds = notes.filter { $0.notebookId == notebook.id }.map(\.id)
        try deleteRecords(pageIds: pages.filter { noteIds.contains($0.noteId) }.map(\.id), noteIds: noteIds, notebookIds: [notebook.id])
    }

    private func deletionURLs(_ deletion: PendingDeletion) throws -> [URL] {
        for id in deletion.pageIds + deletion.submissionIds { try requireIdentifier(id) }
        try requireDirectory(directory)
        if !deletion.pageIds.isEmpty { try requireDirectory(directory.appendingPathComponent("pages", isDirectory: true), allowMissing: true) }
        if !deletion.submissionIds.isEmpty { try requireDirectory(directory.appendingPathComponent("submissions", isDirectory: true), allowMissing: true) }
        return deletion.pageIds.map(pageDirectory) + deletion.submissionIds.map(submissionURL)
    }

    private func validateDeletionTree(_ url: URL) throws {
        try requireDirectory(url, allowMissing: true)
        guard try itemType(at: url) != nil else { return }
        var enumerationError: Error?
        guard let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.isSymbolicLinkKey], options: [], errorHandler: { _, error in enumerationError = error; return false }) else { throw PadError.rejected("This notebook’s files could not be inspected safely. They have been kept.") }
        for case let child as URL in files {
            guard try itemType(at: child) != .typeSymbolicLink else { throw PadError.rejected("This notebook contains a linked file. Its files have been kept for recovery.") }
        }
        if let enumerationError { throw enumerationError }
    }

    private func deleteRecords(pageIds: [String], noteIds: [String], notebookIds: [String]) throws {
        try verifyCurrentIndex()
        let knownPages = pageIds.filter { id in pages.contains { $0.id == id } }
        let knownNotes = noteIds.filter { id in notes.contains { $0.id == id } }
        let knownNotebooks = notebookIds.filter { id in notebooks.contains { $0.id == id } }
        guard !knownPages.isEmpty || !knownNotes.isEmpty || !knownNotebooks.isEmpty else { return }
        // An explicitly queued capture must not send deleted private work later.
        // Cancel its entire immutable selection rather than silently changing it.
        // Received revisions remain history until the whole note is deleted.
        let deletedSubmissions = submissions.filter { submission in
            knownNotes.contains(submission.noteId)
                || (submission.receivedAt == nil && submission.sourcePages.contains { knownPages.contains($0.id) })
        }.map(\.id)
        let deletion = PendingDeletion(id: identifier(), pageIds: knownPages, submissionIds: deletedSubmissions)
        for url in try deletionURLs(deletion) { try validateDeletionTree(url) }
        let touchedNoteIds = Set(pages.filter { knownPages.contains($0.id) && !knownNotes.contains($0.noteId) }.map(\.noteId))
        try commit {
            pages.removeAll { knownPages.contains($0.id) }
            notes.removeAll { knownNotes.contains($0.id) }
            notebooks.removeAll { knownNotebooks.contains($0.id) }
            submissions.removeAll { deletedSubmissions.contains($0.id) }
            for position in notes.indices {
                notes[position].pageIds.removeAll { knownPages.contains($0) }
                if let remembered = notes[position].lastOpenedPageId,
                   !notes[position].pageIds.contains(remembered) {
                    notes[position].lastOpenedPageId = notes[position].pageIds.first
                }
            }
            for id in touchedNoteIds { touchNote(id, at: Date()) }
            if !knownPages.isEmpty || !deletedSubmissions.isEmpty { deletions.append(deletion) }
        }
        finishDeletions()
    }

    private func finishDeletions() {
        guard !unreadableIndex else { return }
        for deletion in deletions {
            do {
                let urls = try deletionURLs(deletion)
                for url in urls { try validateDeletionTree(url) }
                for url in urls where try itemType(at: url) != nil { try removeItem(url) }
                let previous = deletions
                deletions.removeAll { $0.id == deletion.id }
                do { try persist() } catch { deletions = previous; throw error }
            } catch {
                storageError = "The selected notebook work was deleted. Some local files still need cleanup; reopen Recall Pad to retry. Other notes and Mac copies are unchanged."
            }
        }
    }
}
