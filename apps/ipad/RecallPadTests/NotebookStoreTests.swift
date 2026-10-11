import XCTest
import PencilKit
import UIKit
@testable import RecallPad

final class NotebookStoreTests: XCTestCase {
    @MainActor
    func testSavingAndReloadingNotebooksNeverQueuesOrTouchesLiveSheets() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let live = DocumentStore(directory: directory)
        let sheet = try live.open(mode: .tutor)
        let attempt = try live.submit(sheet, drawing: ink())
        let liveIndex = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        let liveImage = try Data(contentsOf: live.pageURLs(for: attempt)[0])
        let store = NotebookStore(directory: directory.appendingPathComponent("notebooks"))
        let notebook = try store.createNotebook(title: "Linear algebra")
        let note = try store.createNote(in: notebook, title: "Vector spaces")
        let first = try store.addPage(to: note)
        let saved = try store.savePage(first, drawing: ink(), style: .ruled, canvasHeight: 1800)
        let second = try store.addPage(to: note)
        _ = try store.savePage(second, drawing: ink(y: 600), style: .plain, canvasHeight: 2100)

        XCTAssertTrue(store.submissions.isEmpty, "Autosave must never submit a notebook")
        let reopened = NotebookStore(directory: directory.appendingPathComponent("notebooks"))
        XCTAssertNil(reopened.storageError)
        XCTAssertEqual(reopened.notebooks.map(\.id), [notebook.id])
        XCTAssertEqual(reopened.pages(in: note).map(\.id), [first.id, second.id])
        XCTAssertEqual(reopened.pages(in: note)[0].paperStyle, .ruled)
        XCTAssertEqual(try reopened.drawing(for: saved).strokes.count, 1)
        XCTAssertTrue(reopened.submissions.isEmpty)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), liveIndex)
        XCTAssertEqual(try Data(contentsOf: live.pageURLs(for: attempt)[0]), liveImage)
        XCTAssertEqual(DocumentStore(directory: directory).attempts.first?.id, attempt.id)
    }

    @MainActor
    func testNoOpSaveKeepsPageAndNoteRevisionsStable() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let drawing = try store.drawing(for: fixture.page)
        let noteBefore = try XCTUnwrap(store.notes.first)
        let saved = try store.savePage(fixture.page, drawing: drawing, style: fixture.page.paperStyle, canvasHeight: fixture.page.canvasHeight)
        XCTAssertEqual(saved.revision, fixture.page.revision)
        XCTAssertEqual(saved.contentHash, fixture.page.contentHash)
        XCTAssertEqual(store.notes.first?.revision, noteBefore.revision)
        XCTAssertTrue(store.submissions.isEmpty)
        _ = try store.savePage(saved, drawing: drawing, style: .ruled, canvasHeight: saved.canvasHeight)
        XCTAssertEqual(store.notes.first?.revision, noteBefore.revision + 1)
    }

    @MainActor
    func testImmutableSubmissionPreservesAllSelectedDrawingsAcrossLaterEdits() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let second = try store.addPage(to: fixture.note)
        let savedSecond = try store.savePage(second, drawing: ink(y: 1800), style: .squared, canvasHeight: 2600)
        let destination = UUID().uuidString.lowercased()
        let submission = try store.prepareSubmission(fixture.note, selectedPageIds: [savedSecond.id, fixture.page.id], recipientInstallationId: destination)
        let capturedImages = try store.pageURLs(for: submission).map { try Data(contentsOf: $0) }
        let capturedDrawings = try store.drawingURLs(for: submission).map { try Data(contentsOf: $0) }
        _ = try store.savePage(fixture.page, drawing: ink(y: 400), style: .plain, canvasHeight: 1800)

        XCTAssertEqual(submission.selectedPageIds, [fixture.page.id, second.id], "Notebook order controls submitted page order")
        XCTAssertEqual(submission.drawings.count, 2)
        XCTAssertEqual(submission.recipientInstallationId, destination)
        XCTAssertEqual(try store.pageURLs(for: submission).map { try Data(contentsOf: $0) }, capturedImages)
        XCTAssertEqual(try store.drawingURLs(for: submission).map { try Data(contentsOf: $0) }, capturedDrawings)
        let reload = NotebookStore(directory: directory)
        let restored = try XCTUnwrap(reload.submissions.first)
        XCTAssertEqual(restored.id, submission.id)
        XCTAssertEqual(restored.contentHash, submission.contentHash)
        XCTAssertEqual(restored.recipientInstallationId, destination)
        XCTAssertEqual(restored.state, .waitingForMac)
        XCTAssertTrue(reload.syncSummary(for: fixture.note).hasChanges)
    }

    @MainActor
    func testNotebookManifestCannotEvaluateOrControlLiveStudy() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let submission = try store.prepareSubmission(fixture.note)
        let manifest = submission.manifest()
        XCTAssertEqual(manifest["version"] as? Int, 3)
        XCTAssertEqual(manifest["mode"] as? String, "notebook")
        XCTAssertEqual(manifest["documentId"] as? String, fixture.note.id)
        XCTAssertEqual(manifest["evaluate"] as? Bool, false)
        XCTAssertTrue(manifest["questionId"] is NSNull)
        XCTAssertTrue(manifest["handoffId"] is NSNull)
        XCTAssertTrue(manifest["drawing"] is NSNull)
        XCTAssertEqual((manifest["drawings"] as? [[String: Any]])?.count, 1)
        let metadata = try XCTUnwrap(manifest["notebook"] as? [String: Any])
        XCTAssertEqual(metadata["selectedPageIds"] as? [String], [fixture.page.id])
        let page = try XCTUnwrap((manifest["pages"] as? [[String: Any]])?.first)
        XCTAssertEqual(page["sourcePageId"] as? String, fixture.page.id)
        XCTAssertEqual(page["sourceRevision"] as? Int, fixture.page.revision)
        XCTAssertFalse(manifest.keys.contains("answer"))
        XCTAssertFalse(manifest.keys.contains("credential"))
        XCTAssertFalse(manifest.keys.contains("rating"))
    }

    @MainActor
    func testReceivedAndReviewedAreNotProcessedAndPartialCoverageIsHonest() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let second = try store.addPage(to: fixture.note)
        _ = try store.savePage(second, drawing: ink(y: 500), style: .squared, canvasHeight: 1800)
        let submission = try store.prepareSubmission(fixture.note, selectedPageIds: [fixture.page.id])
        try store.updateSubmission(submission.id, receiptState: "notebook_received")
        XCTAssertNil(store.syncSummary(for: fixture.note).lastProcessedAt)
        XCTAssertEqual(store.syncSummary(for: fixture.note).processedPageCount, 0)
        try store.updateSubmission(submission.id, receiptState: "notebook_reviewed")
        XCTAssertNil(store.submissions.first?.processedAt)
        XCTAssertThrowsError(try store.updateSubmission(submission.id, receiptState: "notebook_added"))
        let processedAt = Date(timeIntervalSince1970: 1_800_000_000)
        try store.updateSubmission(submission.id, receiptState: "notebook_added", processedAt: processedAt)
        XCTAssertEqual(store.syncSummary(for: fixture.note).lastProcessedAt, processedAt)
        XCTAssertEqual(store.syncSummary(for: fixture.note).processedPageCount, 1)
        XCTAssertEqual(store.syncSummary(for: fixture.note).currentPageCount, 2)
        XCTAssertEqual(store.syncSummary(for: fixture.notebook).processedPageCount, 1)
        XCTAssertTrue(store.syncSummary(for: fixture.note).hasChanges)
        try store.updateSubmission(submission.id, receiptState: "notebook_received")
        XCTAssertEqual(store.submissions.first?.state, .added, "Late transport receipts must not erase confirmed completion")
        _ = try store.savePage(fixture.page, drawing: ink(y: 700), style: .squared, canvasHeight: 1800)
        XCTAssertEqual(store.syncSummary(for: fixture.note).processedPageCount, 0, "Earlier completed work cannot certify later ink")
        XCTAssertEqual(store.syncSummary(for: fixture.note).lastProcessedAt, processedAt)
    }

    @MainActor
    func testCompletedCoverageIsAnExplicitHistoricalReceiptAcrossReload() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let submission = try store.prepareSubmission(fixture.note)
        let completedAt = Date(timeIntervalSince1970: 1_800_000_000)
        try store.updateSubmission(submission.id, receiptState: "notebook_added", processedAt: completedAt)

        let reopened = NotebookStore(directory: directory)
        let summary = reopened.syncSummary(for: fixture.note)
        XCTAssertEqual(summary.title, "Current pages previously added")
        XCTAssertEqual(summary.lastProcessedAt, completedAt)
        XCTAssertFalse(summary.hasChanges)
        XCTAssertTrue(summary.detail.contains("historical receipts"))
        XCTAssertEqual(reopened.submissions.count, 1, "Reloading a historical receipt must never queue a fresh submission")
        XCTAssertFalse(reopened.submissions[0].isPendingDelivery)

        _ = try reopened.savePage(fixture.page, drawing: ink(y: 400), style: .squared, canvasHeight: 1800)
        XCTAssertEqual(reopened.syncSummary(for: fixture.note).processedPageCount, 0)
        XCTAssertTrue(reopened.syncSummary(for: fixture.note).hasChanges)
        XCTAssertEqual(reopened.syncSummary(for: fixture.note).lastProcessedAt, completedAt)
    }

    @MainActor
    func testBlankPagesAreExplicitlyExcludedFromNotebookBatchButUnreadableInkIsNot() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let blank = try store.addPage(to: fixture.note)
        XCTAssertEqual(try store.writtenPageIds(in: fixture.note), [fixture.page.id])
        let batch = try store.prepareSubmissions(fixture.notebook)
        XCTAssertEqual(batch.count, 1)
        XCTAssertEqual(batch[0].selectedPageIds, [fixture.page.id])
        XCTAssertEqual(store.pages(in: fixture.note).count, 2)
        XCTAssertThrowsError(try store.prepareSubmission(fixture.note, selectedPageIds: [blank.id]))
        let drawingURL = directory.appendingPathComponent("pages/\(blank.id)/drawing-0.data")
        try FileManager.default.removeItem(at: drawingURL)
        XCTAssertThrowsError(try store.writtenPageIds(in: fixture.note), "A missing ink file must never be treated as an intentional blank")
    }

    @MainActor
    func testNotebookBatchFailureDoesNotPartiallyEnqueueEarlierNotes() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let blankNote = try store.createNote(in: fixture.notebook, title: "Unfinished")
        _ = try store.addPage(to: blankNote)
        XCTAssertThrowsError(try store.prepareSubmissions(fixture.notebook))
        XCTAssertTrue(store.submissions.isEmpty)
        XCTAssertTrue(NotebookStore(directory: directory).submissions.isEmpty)
        let batch = try store.prepareSubmissions(fixture.notebook, selectedNoteIds: [fixture.note.id])
        XCTAssertEqual(batch.count, 1)
    }

    @MainActor
    func testLongPageExportCapturesOffscreenInkAndRejectsOversizedSelections() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let longDrawing = PKDrawing(strokes: ink().strokes + ink(y: 2500).strokes)
        let longPage = try store.savePage(fixture.page, drawing: longDrawing, style: .plain, canvasHeight: 3100)
        let submission = try store.prepareSubmission(fixture.note)
        XCTAssertGreaterThan(submission.pages.count, 1)
        XCTAssertTrue(submission.pages.allSatisfy { $0.sourcePageId == longPage.id })
        XCTAssertEqual(try PKDrawing(data: Data(contentsOf: store.drawingURLs(for: submission)[0])).strokes.count, 2)
        let oversized = PKDrawing(strokes: ink().strokes + ink(y: 31000).strokes)
        _ = try store.savePage(longPage, drawing: oversized, style: .plain, canvasHeight: 32000)
        XCTAssertThrowsError(try store.prepareSubmission(fixture.note))
        XCTAssertEqual(store.submissions.count, 1, "Oversized work stays local and must not be truncated into a new queued submission")
        XCTAssertEqual(try store.drawing(for: longPage).strokes.count, 2)
    }

    @MainActor
    func testIndexWriteFailureKeepsPreviousDrawingRevisionAndQueuedSnapshot() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var rejectWrite = false
        let store = NotebookStore(directory: directory, writeIndex: { data, url in
            if rejectWrite { throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError) }
            try data.write(to: url, options: .atomic)
        })
        let fixture = try writtenNote(in: store)
        let submission = try store.prepareSubmission(fixture.note)
        let image = try Data(contentsOf: store.pageURLs(for: submission)[0])
        let earlierURL = directory.appendingPathComponent("pages/\(fixture.page.id)/drawing-\(fixture.page.revision).data")
        let earlier = try Data(contentsOf: earlierURL)
        rejectWrite = true
        XCTAssertThrowsError(try store.savePage(fixture.page, drawing: ink(y: 600), style: .ruled, canvasHeight: 2200))
        XCTAssertEqual(store.pages.first?.revision, fixture.page.revision)
        let reload = NotebookStore(directory: directory)
        XCTAssertEqual(try Data(contentsOf: earlierURL), earlier)
        XCTAssertEqual(try reload.drawing(for: fixture.page), try PKDrawing(data: earlier))
        XCTAssertEqual(try Data(contentsOf: reload.pageURLs(for: submission)[0]), image)
        XCTAssertEqual(reload.submissions.first?.id, submission.id)
    }

    @MainActor
    func testCorruptNotebookIndexCannotOverwriteInkOrLiveWork() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let drawingURL = directory.appendingPathComponent("pages/\(fixture.page.id)/drawing-\(fixture.page.revision).data")
        let inkBefore = try Data(contentsOf: drawingURL)
        try Data("unreadable index".utf8).write(to: directory.appendingPathComponent("index.json"))
        XCTAssertThrowsError(try store.savePage(fixture.page, drawing: ink(y: 500), style: .plain, canvasHeight: 1800))
        XCTAssertThrowsError(try store.delete(fixture.notebook))
        let reopened = NotebookStore(directory: directory)
        XCTAssertNotNil(reopened.storageError)
        XCTAssertThrowsError(try reopened.createNotebook(title: "Do not overwrite"))
        XCTAssertEqual(try Data(contentsOf: drawingURL), inkBefore)
        XCTAssertEqual(try String(contentsOf: directory.appendingPathComponent("index.json"), encoding: .utf8), "unreadable index")
    }

    @MainActor
    func testDeletingSourcePageKeepsCapturedRevisionAndDeletesNoteWithTombstone() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let submission = try store.prepareSubmission(fixture.note)
        let queuedImage = try Data(contentsOf: store.pageURLs(for: submission)[0])
        try store.updateSubmission(submission.id, receiptState: "notebook_received")
        try store.delete(fixture.page)
        XCTAssertTrue(store.pages(in: fixture.note).isEmpty)
        XCTAssertEqual(store.submissions.first?.id, submission.id)
        XCTAssertEqual(try Data(contentsOf: store.pageURLs(for: submission)[0]), queuedImage)
        XCTAssertThrowsError(try store.savePage(fixture.page, drawing: ink(), style: .plain, canvasHeight: 1800))
        let reopened = NotebookStore(directory: directory)
        XCTAssertNil(reopened.storageError)
        XCTAssertEqual(reopened.submissions.first?.id, submission.id)
        try reopened.delete(fixture.note)
        XCTAssertTrue(reopened.submissions.isEmpty)
        XCTAssertTrue(reopened.notes.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: reopened.submissionURL(submission.id).path))
        XCTAssertTrue(NotebookStore(directory: directory).notes.isEmpty)
    }

    @MainActor
    func testDeletingPageCancelsQueuedSelectionWithoutSendingOtherSelectedPages() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let second = try store.addPage(to: fixture.note)
        let kept = try store.savePage(second, drawing: ink(y: 400), style: .plain, canvasHeight: 1800)
        let submission = try store.prepareSubmission(fixture.note)
        try store.delete(fixture.page)
        XCTAssertTrue(store.submissions.isEmpty, "A queued selection must not send deleted personal work later")
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.submissionURL(submission.id).path))
        XCTAssertEqual(store.pages(in: fixture.note).map(\.id), [kept.id])
        XCTAssertEqual(try store.drawing(for: kept).strokes.count, 1)
        let reopened = NotebookStore(directory: directory)
        XCTAssertTrue(reopened.submissions.isEmpty)
        XCTAssertEqual(reopened.pages(in: fixture.note).map(\.id), [kept.id])
    }

    @MainActor
    func testDeletionRejectsLinkedFilesAndFailedCleanupCannotReviveQueue() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let submission = try store.prepareSubmission(fixture.note)
        let outside = directory.appendingPathComponent("keep.data")
        try Data("keep".utf8).write(to: outside)
        let link = directory.appendingPathComponent("pages/\(fixture.page.id)/outside-link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
        XCTAssertThrowsError(try store.delete(fixture.notebook))
        XCTAssertEqual(store.pages.count, 1)
        XCTAssertEqual(store.submissions.first?.id, submission.id)
        XCTAssertEqual(try String(contentsOf: outside, encoding: .utf8), "keep")
        try FileManager.default.removeItem(at: link)
        let failingCleanup = NotebookStore(directory: directory, removeItem: { _ in throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError) })
        try failingCleanup.delete(fixture.notebook)
        XCTAssertTrue(failingCleanup.notebooks.isEmpty)
        XCTAssertTrue(failingCleanup.submissions.isEmpty)
        XCTAssertNotNil(failingCleanup.storageError)
        let reopened = NotebookStore(directory: directory)
        XCTAssertTrue(reopened.notebooks.isEmpty)
        XCTAssertTrue(reopened.submissions.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: reopened.submissionURL(submission.id).path))
        XCTAssertEqual(try String(contentsOf: outside, encoding: .utf8), "keep")
    }

    private func temporaryDirectory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("notebook-test-\(UUID().uuidString)", isDirectory: true) }

    @MainActor
    private func writtenNote(in store: NotebookStore) throws -> (notebook: PadNotebook, note: PadNotebookNote, page: PadNotebookPage) {
        let notebook = try store.createNotebook(title: "Synthetic notebook")
        let note = try store.createNote(in: notebook, title: "A synthetic note")
        let page = try store.addPage(to: note)
        let saved = try store.savePage(page, drawing: ink(), style: .squared, canvasHeight: 1800)
        return (notebook, note, saved)
    }

    private func ink(y: CGFloat = 80) -> PKDrawing {
        let points = [CGPoint(x: 40, y: y), CGPoint(x: 120, y: y + 20), CGPoint(x: 200, y: y)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: TimeInterval(index) * 0.1, size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
    }
}
