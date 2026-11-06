import XCTest
import PencilKit
import Security
import SwiftUI
import AVFoundation
import Vision
import WebKit
@testable import RecallPad

final class RecallPadTests: XCTestCase {
    @MainActor
    func testTutorPromptRendersOfflineLatexInsteadOfRawDelimiters() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        let html = #"""
        Inline \(r_{p,t}\) and $x^2$. Display: \[\frac{1}{2}\] and $$\sum_t a_t$$.<br>
        Multiline:<br>$$
        R_p=\prod_{t=1}^{T}(1+r_{p,t})-1
        $$<br>\[
        \frac{x}{y}<2
        \]
        """#
        let host = UIHostingController(rootView: PaperPromptCard(html: html, mode: .tutor, expanded: .constant(true)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        defer { window.isHidden = true; window.rootViewController = nil }

        func webView(in view: UIView) -> WKWebView? {
            if let web = view as? WKWebView { return web }
            return view.subviews.lazy.compactMap { webView(in: $0) }.first
        }
        let web = try XCTUnwrap(webView(in: host.view))
        var state: [String: Any] = [:]
        for _ in 0..<100 {
            if let value = try? await web.evaluateJavaScript("({count:document.querySelectorAll('#question .katex').length, text:document.querySelector('#question')?.textContent || '', math:typeof renderMathInElement, sanitizer:typeof DOMPurify})") as? [String: Any] {
                state = value
                if value["count"] as? Int == 6 { break }
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertEqual(state["count"] as? Int, 6, "All four delimiters and multiline displays must render with bundled offline assets: \(state)")
        XCTAssertEqual(state["math"] as? String, "function")
        XCTAssertEqual(state["sanitizer"] as? String, "function")
    }

    @MainActor
    func testNotebookSendPublishesSavingBeforeCommittingAndIgnoresRepeatedConfirmation() async throws {
        let fixture = try notebookSendFixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let flow = NotebookSendPreparation()
        var commits = 0
        var transfers = 0
        let first = try XCTUnwrap(flow.start(commit: {
            commits += 1
            return [try fixture.store.prepareSubmission(fixture.note, recipientInstallationId: "synthetic-mac")]
        }, transfer: { transfers += 1 }))
        XCTAssertTrue(flow.preparing)
        XCTAssertEqual(commits, 0, "Saving must be published before rendering or durable writes begin")
        XCTAssertEqual(NotebookSendFeedback.resolve(preparation: flow, submissions: fixture.store.submissions, connected: true, paired: true, selectedCount: 1).kind, .preparing)
        XCTAssertNil(flow.start(commit: { XCTFail("Repeated confirmation must not commit"); return [] }, transfer: { XCTFail("Repeated confirmation must not transfer") }))

        await first.value
        XCTAssertEqual(commits, 1)
        XCTAssertEqual(transfers, 1)
        XCTAssertEqual(flow.submissionIds, fixture.store.submissions.map(\.id))
        XCTAssertTrue(flow.prepared)
        XCTAssertFalse(flow.preparing)
        XCTAssertNil(flow.start(commit: { XCTFail("An already-saved preview must not create a second snapshot"); return [] }, transfer: {}))
        XCTAssertEqual(NotebookStore(directory: fixture.directory).submissions.count, 1)
    }

    @MainActor
    func testNotebookSendFailureAllowsSafeRetryWithoutCapturingBlankWork() async throws {
        let fixture = try notebookSendFixture(written: false)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let flow = NotebookSendPreparation()
        var transfers = 0
        let originalPages = fixture.store.pages
        let failed = try XCTUnwrap(flow.start(commit: {
            [try fixture.store.prepareSubmission(fixture.note, recipientInstallationId: "synthetic-mac")]
        }, transfer: { transfers += 1 }))
        await failed.value
        XCTAssertNotNil(flow.error)
        XCTAssertTrue(flow.submissionIds.isEmpty)
        XCTAssertFalse(flow.preparing)
        XCTAssertEqual(fixture.store.pages, originalPages)
        XCTAssertTrue(fixture.store.submissions.isEmpty)
        XCTAssertEqual(transfers, 0)
        XCTAssertEqual(NotebookSendFeedback.resolve(preparation: flow, submissions: [], connected: true, paired: true, selectedCount: 1).kind, .failed)

        let page = try XCTUnwrap(fixture.store.pages.first)
        _ = try fixture.store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: 1800, shapes: [NotebookShape(kind: .rectangle, text: "A written diagram")])
        let retry = try XCTUnwrap(flow.start(commit: {
            [try fixture.store.prepareSubmission(fixture.note, recipientInstallationId: "synthetic-mac")]
        }, transfer: { transfers += 1 }))
        XCTAssertNil(flow.error)
        await retry.value
        XCTAssertTrue(flow.prepared)
        XCTAssertEqual(transfers, 1)
        XCTAssertEqual(fixture.store.submissions.count, 1, "Retrying a failed preparation creates one durable snapshot")
    }

    @MainActor
    func testNotebookSendAbandonedBeforeRenderingKeepsPrivateNoteUnsubmitted() async throws {
        let fixture = try notebookSendFixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let flow = NotebookSendPreparation()
        let before = fixture.store.pages
        let task = try XCTUnwrap(flow.start(commit: {
            XCTFail("Leaving before the saving transition must not commit hidden work")
            return [try fixture.store.prepareSubmission(fixture.note)]
        }, transfer: { XCTFail("An abandoned preparation must not transfer") }))
        flow.cancelBeforeSaved()
        await task.value
        XCTAssertFalse(flow.preparing)
        XCTAssertFalse(flow.prepared)
        XCTAssertNil(flow.error)
        XCTAssertEqual(fixture.store.pages, before)
        XCTAssertTrue(NotebookStore(directory: fixture.directory).submissions.isEmpty)
    }

    @MainActor
    func testNotebookSendFeedbackUsesCurrentSavedIdentityAndDurableMacReceipt() async throws {
        let fixture = try notebookSendFixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let earlier = try fixture.store.prepareSubmission(fixture.note)
        try fixture.store.updateSubmission(earlier.id, receiptState: "received", receivedAt: Date())
        let flow = NotebookSendPreparation()
        let task = try XCTUnwrap(flow.start(commit: { [try fixture.store.prepareSubmission(fixture.note)] }, transfer: {}))
        await task.value
        let currentId = try XCTUnwrap(flow.submissionIds.first)
        XCTAssertNotEqual(currentId, earlier.id)
        var feedback = NotebookSendFeedback.resolve(preparation: flow, submissions: fixture.store.submissions, connected: true, paired: true, selectedCount: 1)
        XCTAssertEqual(feedback.kind, .saved, "Connection and an earlier receipt cannot imply this selection was received")
        XCTAssertTrue(feedback.detail.contains("0 of 1"))

        try fixture.store.markDeliveryInterrupted(currentId, message: "Synthetic transfer interrupted")
        feedback = NotebookSendFeedback.resolve(preparation: flow, submissions: fixture.store.submissions, connected: true, paired: true, selectedCount: 1)
        XCTAssertEqual(feedback.kind, .attention)
        XCTAssertTrue(feedback.detail.contains("Synthetic transfer interrupted"))
        try fixture.store.retrySubmission(currentId)
        feedback = NotebookSendFeedback.resolve(preparation: flow, submissions: fixture.store.submissions, connected: false, paired: true, selectedCount: 1)
        XCTAssertEqual(feedback.kind, .saved)
        XCTAssertTrue(feedback.title.contains("waiting for Mac"))

        try fixture.store.updateSubmission(currentId, receiptState: "awaiting_assistant", receivedAt: Date())
        feedback = NotebookSendFeedback.resolve(preparation: flow, submissions: fixture.store.submissions, connected: false, paired: true, selectedCount: 1)
        XCTAssertEqual(feedback.kind, .received)
        XCTAssertEqual(feedback.title, "Received on Mac")
        XCTAssertTrue(feedback.detail.contains("KB and card preparation is still separate"))
        XCTAssertEqual(flow.submissionIds, [currentId])
        XCTAssertEqual(fixture.store.submissions.count, 2, "Transfer retries and receipt updates must not create another snapshot")
    }

    @MainActor
    func testNotebookSendStatusIsReadableWithoutScrollingInCompactAndDarkLayouts() async throws {
        let fixture = try notebookSendFixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let flow = NotebookSendPreparation()
        let task = try XCTUnwrap(flow.start(commit: { [try fixture.store.prepareSubmission(fixture.note)] }, transfer: {}))
        await task.value
        let id = try XCTUnwrap(flow.submissionIds.first)
        try fixture.store.updateSubmission(id, receiptState: "received", receivedAt: Date())
        let feedback = NotebookSendFeedback.resolve(preparation: flow, submissions: fixture.store.submissions, connected: false, paired: true, selectedCount: 1)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        defer { window.isHidden = true; window.rootViewController = nil }
        for (width, appearance) in [(768.0, UIUserInterfaceStyle.light), (320.0, .dark)] {
            let host = UIHostingController(rootView: NotebookSendStatusPanel(feedback: feedback).padding(16).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).background(PadPalette.background))
            window.frame = CGRect(x: 0, y: 0, width: width, height: 600)
            window.overrideUserInterfaceStyle = appearance
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(80))
            let text = try renderedText(in: host.view)
            XCTAssertTrue(text.contains("RECEIVED ON MAC"), "The receipt must be visible on the first screen in both appearances")
            XCTAssertTrue(text.contains("DONE"), "The saved confirmation must explain how to leave the preview")
            window.rootViewController = nil
        }
    }

    @MainActor
    private func notebookSendFixture(written: Bool = true) throws -> (store: NotebookStore, note: PadNotebookNote, directory: URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Synthetic send feedback")
        let page = try store.createNoteForWriting(in: notebook)
        if written { _ = try store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: 1800, shapes: [NotebookShape(kind: .rectangle, text: "Synthetic diagram")]) }
        let note = try XCTUnwrap(store.notes.first { $0.id == page.noteId })
        return (store, note, directory)
    }

    @MainActor
    func testContinuousNotebookExtendsBlankPaperAndPreservesScrolledZoomGeometry() {
        var height = 1800.0
        var changes = 0
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: Binding(get: { height }, set: { height = $0 }), style: .squared, tool: .pen, onChanged: { changes += 1 }, command: nil, continuous: true)
        let coordinator = paper.makeCoordinator()
        let canvas = GridCanvas(frame: CGRect(x: 0, y: 0, width: 900, height: 700))
        canvas.configureDocumentGeometry(width: 900, height: height, continuous: true)
        coordinator.configureNotebook(on: canvas)
        canvas.contentOffset = CGPoint(x: 0, y: 1050)
        let before = canvas.contentOffset
        coordinator.extendContinuousPaperIfNeeded(canvas)
        XCTAssertGreaterThan(height, 1800, "Reaching the bottom must extend blank paper without requiring a Pencil stroke")
        XCTAssertEqual(canvas.contentOffset, before)
        XCTAssertEqual(canvas.contentSize.height, height, accuracy: 0.1)
        XCTAssertEqual(changes, 1)
        XCTAssertTrue(canvas.drawing.strokes.isEmpty)

        canvas.zoomScale = 2
        coordinator.scrollViewDidZoom(canvas)
        XCTAssertEqual(canvas.contentSize.height, height * 2, accuracy: 0.1)
        XCTAssertEqual(canvas.documentHeight, height, accuracy: 0.1)
        XCTAssertTrue(canvas.contentSize.height.isFinite)
        let unchanged = height
        coordinator.scrollViewDidScroll(canvas)
        XCTAssertEqual(height, unchanged, "Repeated viewport refreshes must not grow a sheet that is no longer near its end")
    }

    @MainActor
    func testLiveCanvasDoesNotAdoptNotebookExtensionOrDiagramGestures() {
        var height = 1800.0
        var changes = 0
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: Binding(get: { height }, set: { height = $0 }), style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil)
        let coordinator = paper.makeCoordinator()
        let canvas = GridCanvas(frame: CGRect(x: 0, y: 0, width: 900, height: 700))
        canvas.configureDocumentGeometry(width: 900, height: height, continuous: false)
        coordinator.configureNotebook(on: canvas)
        canvas.contentOffset = CGPoint(x: 0, y: 1100)
        coordinator.scrollViewDidScroll(canvas)
        XCTAssertEqual(height, 1800)
        XCTAssertEqual(changes, 0)
        XCTAssertNil(canvas.diagramCanvas)
        XCTAssertEqual(canvas.minimumZoomScale, 0.5)
        XCTAssertEqual(canvas.maximumZoomScale, 2)
        XCTAssertTrue(canvas.drawingGestureRecognizer.isEnabled)
    }

    @MainActor
    func testZoomedOutNotebookExpandsActualPaperToTheRightEdgeAcrossViewportSizes() async throws {
        let originalInk = fixtureDrawing()
        let shape = NotebookShape(kind: .rectangle, x: 240, y: 180, width: 160, height: 100, text: "Same coordinates")
        var shapes = [shape]
        var selection: String? = shape.id
        let paper = PaperCanvas(drawing: .constant(originalInk), height: .constant(12_000), style: .squared, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        var widest = canvas.documentWidth
        for viewport in [CGSize(width: 768, height: 1024), CGSize(width: 1024, height: 768), CGSize(width: 320, height: 900)] {
            window.frame = CGRect(origin: .zero, size: viewport)
            canvas.frame = CGRect(origin: .zero, size: viewport)
            for scale in [0.75, 0.5, 0.35] {
                canvas.setZoomScale(scale, animated: false)
                canvas.contentOffset = CGPoint(x: 0, y: 80)
                coordinator.scrollViewDidZoom(canvas)
                canvas.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(40))
                let point = CGPoint(x: canvas.bounds.maxX - 20, y: canvas.bounds.minY + 120)
                let canonical = diagrams.documentPoint(fromCanvasPoint: point)
                XCTAssertGreaterThanOrEqual(canvas.contentSize.width + 0.1, canvas.bounds.maxX, "Paper at the viewport's right edge must not be only the opaque scroll-view background")
                XCTAssertGreaterThanOrEqual(canvas.documentWidth, canonical.x)
                XCTAssertGreaterThanOrEqual(canvas.documentWidth, widest, "Rotation and Split View may grow paper, never shrink its existing coordinates")
                widest = canvas.documentWidth
                let hit = try XCTUnwrap(canvas.hitTest(point, with: nil))
                XCTAssertTrue(hit !== canvas && hit.isDescendant(of: canvas), "The right edge must hit native drawing content rather than only the scroll-view background")
                let drawingTarget = try XCTUnwrap(canvas.drawingGestureRecognizer.view)
                let drawingPoint = canvas.convert(point, to: drawingTarget)
                XCTAssertTrue(drawingTarget.bounds.contains(drawingPoint), "The right-edge point must lie in PencilKit's drawing gesture surface")
                let zoomedPaper = try XCTUnwrap(canvas.subviews.first {
                    abs($0.transform.a - scale) < 0.0001 && abs($0.transform.d - scale) < 0.0001
                }, "PencilKit must have an actual zoomed content view at the requested scale")
                let nativePaperPoint = canvas.convert(point, to: zoomedPaper)
                XCTAssertTrue(zoomedPaper.bounds.contains(nativePaperPoint), "The native unscaled paper bounds must contain the visible right-edge point")
                XCTAssertEqual(nativePaperPoint.x, canonical.x, accuracy: 0.001, "Ink and diagram coordinates must agree with PencilKit's actual zoom transform")
                XCTAssertEqual(nativePaperPoint.y, canonical.y, accuracy: 0.001)
                XCTAssertEqual(canvas.drawing, originalInk)
                XCTAssertEqual(shapes, [shape])
                XCTAssertEqual(selection, shape.id)
                XCTAssertTrue(canvas.drawingGestureRecognizer.isEnabled)
                XCTAssertEqual(canvas.zoomScale, scale, accuracy: 0.0001)
                let originalWidth = canvas.documentWidth
                canvas.configureDocumentGeometry(width: 900, height: 12_000, continuous: true)
                coordinator.configureNotebook(on: canvas)
                paper.configureTool(on: canvas)
                canvas.paperStyle = .ruled
                canvas.layoutIfNeeded()
                XCTAssertGreaterThanOrEqual(canvas.documentWidth, originalWidth, "A stale ink extent, tool/style or connection refresh must preserve expanded paper")
                XCTAssertEqual(canvas.drawing, originalInk)
                XCTAssertEqual(shapes, [shape])
            }
        }
    }

    @MainActor
    func testFarRightNotebookInkAtSmallZoomSurvivesRefreshSaveExportAndNativeUndo() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Synthetic right-edge ink")
        let page = try store.createNoteForWriting(in: notebook)
        let initialInk = fixtureDrawing()
        var drawing = initialInk
        let shape = NotebookShape(kind: .rectangle, x: 240, y: 180, width: 160, height: 100, text: "Original shape")
        var shapes = [shape]
        var selection: String? = shape.id
        var changes = 0
        var paper = PaperCanvas(drawing: Binding(get: { drawing }, set: { drawing = $0 }), height: .constant(12_000), style: .squared, tool: .pen, onChanged: { changes += 1 }, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        canvas.frame = CGRect(x: 0, y: 0, width: 1024, height: 768)
        canvas.setZoomScale(0.35, animated: false)
        canvas.contentOffset = CGPoint(x: 0, y: 80)
        coordinator.scrollViewDidZoom(canvas)
        canvas.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(40))
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let target = diagrams.documentPoint(fromCanvasPoint: CGPoint(x: canvas.bounds.maxX - 24, y: canvas.bounds.minY + 120))
        XCTAssertGreaterThan(target.x, 900, "The fixture must exercise paper that was outside the original drawing extent")
        let points = [CGPoint(x: target.x - 12, y: target.y - 4), CGPoint(x: target.x, y: target.y + 12), CGPoint(x: target.x + 12, y: target.y - 4)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: TimeInterval(index) * 0.1, size: CGSize(width: 5, height: 5), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let rightStroke = PKStroke(ink: PKInk(.pen, color: PaperInkColor.blue.color), path: PKStrokePath(controlPoints: points, creationDate: Date()))
        let withRightInk = PKDrawing(strokes: initialInk.strokes + [rightStroke])
        XCTAssertLessThanOrEqual(withRightInk.bounds.maxX, canvas.documentWidth)
        canvas.delegate = nil
        canvas.drawing = withRightInk
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        undo.beginUndoGrouping()
        undo.registerUndo(withTarget: canvas) { targetCanvas in
            let redoDrawing = targetCanvas.drawing
            targetCanvas.drawing = initialInk
            targetCanvas.undoManager?.registerUndo(withTarget: targetCanvas) { $0.drawing = redoDrawing }
        }
        undo.endUndoGrouping()
        let offset = canvas.contentOffset
        let expandedWidth = canvas.documentWidth

        // These are the same stale-binding and style/tool refreshes that occur
        // while PencilKit is still finalizing pressure samples for a new stroke.
        paper.tool = .eraser
        paper.style = .ruled
        coordinator.parent = paper
        coordinator.restore(drawing, on: canvas)
        canvas.configureDocumentGeometry(width: 900, height: 12_000, continuous: true)
        coordinator.configureNotebook(on: canvas)
        paper.configureTool(on: canvas)
        canvas.paperStyle = paper.style
        canvas.layoutIfNeeded()
        XCTAssertEqual(canvas.drawing, withRightInk)
        XCTAssertEqual(drawing, initialInk)
        XCTAssertEqual(canvas.contentOffset, offset)
        XCTAssertGreaterThanOrEqual(canvas.documentWidth, expandedWidth)
        XCTAssertTrue(canvas.undoManager === undo)
        XCTAssertTrue(undo.canUndo)
        XCTAssertEqual(shapes, [shape])
        XCTAssertEqual(selection, shape.id)
        try await Task.sleep(for: .milliseconds(150))
        let liveInk = canvasSnapshot(canvas)
        let livePixels = try XCTUnwrap(liveInk.cgImage)
        let visibleRightRegion = CGRect(x: max(0, target.x * canvas.zoomScale - 24), y: 0, width: 48, height: CGFloat(livePixels.height))
            .intersection(CGRect(x: 0, y: 0, width: livePixels.width, height: livePixels.height))
        let liveRightPixels = try XCTUnwrap(livePixels.cropping(to: visibleRightRegion.integral))
        XCTAssertGreaterThan(chromaticPixelCount(UIImage(cgImage: liveRightPixels)), 2, "PencilKit must actually render the new right-edge ink in its live zoomed viewport")
        canvas.delegate = coordinator
        coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertEqual(drawing, withRightInk)
        XCTAssertEqual(changes, 1)
        let saved = try store.savePage(page, drawing: drawing, style: .ruled, canvasHeight: 12_000, shapes: shapes)
        let reopened = NotebookStore(directory: directory)
        let reopenedPage = try XCTUnwrap(reopened.pages.first { $0.id == saved.id })
        XCTAssertEqual(try reopened.drawing(for: reopenedPage), withRightInk)
        XCTAssertEqual(try reopened.shapes(for: reopenedPage), [shape])
        let note = try XCTUnwrap(reopened.notes.first { $0.id == saved.noteId })
        let submission = try reopened.prepareSubmission(note)
        let exported = try XCTUnwrap(reopened.pageURLs(for: submission).first)
        let image = try XCTUnwrap(UIImage(contentsOfFile: exported.path))
        let pixels = try XCTUnwrap(image.cgImage)
        XCTAssertGreaterThan(pixels.width, 1350, "Export must include far-right work, not crop back to the initial paper width")
        let region = CGRect(x: max(0, (rightStroke.renderBounds.minX - 20) * 1.5), y: 0, width: min(180, CGFloat(pixels.width)), height: CGFloat(pixels.height))
            .intersection(CGRect(x: 0, y: 0, width: pixels.width, height: pixels.height))
        let rightPixels = try XCTUnwrap(pixels.cropping(to: region.integral))
        XCTAssertGreaterThan(chromaticPixelCount(UIImage(cgImage: rightPixels)), 20, "The saved PNG must contain the modeled blue right-edge Pencil stroke")

        canvas.delegate = nil
        undo.undo()
        XCTAssertEqual(canvas.drawing, initialInk)
        undo.redo()
        XCTAssertEqual(canvas.drawing, withRightInk)
        XCTAssertEqual(shapes, [shape], "Pencil undo remains independent of stored editable object coordinates")
    }

    @MainActor
    func testDiagramLayersUsePaperCoordinatesAtZoomAndCullOffscreenObjects() throws {
        let visible = NotebookShape(kind: .rectangle, x: 120, y: 200, width: 180, height: 100, text: "A")
        let longLabel = NotebookShape(kind: .arrow, x: 360, y: 20, width: 70, height: 2, text: String(repeating: "A complete long label stays readable. ", count: 35))
        let offscreen = (0..<100).map { index in NotebookShape(kind: .ellipse, x: 100, y: Double(10_000 + index * 1000), width: 160, height: 80, text: "Saved object") }
        var shapes = [visible, longLabel] + offscreen
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(150_000), style: .plain, tool: .pen, onChanged: {}, command: nil, shapes: Binding(get: { shapes }, set: { shapes = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let original = shapes
        canvas.setZoomScale(2, animated: false)
        canvas.contentOffset = .zero
        diagrams.redraw()
        let frame = try XCTUnwrap(diagrams.renderedFrame(for: visible.id))
        XCTAssertEqual(frame.minX, 240, accuracy: 0.1)
        XCTAssertEqual(frame.minY, 400, accuracy: 0.1)
        XCTAssertEqual(frame.width, 360, accuracy: 0.1)
        XCTAssertEqual(diagrams.documentPoint(fromCanvasPoint: CGPoint(x: 300, y: 500)), CGPoint(x: 150, y: 250))
        XCTAssertLessThan(diagrams.renderedObjectCount, 5, "A long notebook must render only viewport objects")
        let labelFrame = try XCTUnwrap(diagrams.renderedLabelFrame(for: longLabel.id))
        XCTAssertLessThanOrEqual(labelFrame.height, canvas.bounds.height + 200, "A long label must back only its visible slice, not a full-sheet bitmap")
        canvas.contentOffset = CGPoint(x: 0, y: 2000)
        diagrams.redraw()
        XCTAssertNotNil(diagrams.renderedFrame(for: longLabel.id), "A label in view remains rendered even when its arrow is above the viewport")
        XCTAssertEqual(shapes, original, "Zoom changes presentation, never stored shape coordinates")
        XCTAssertTrue(canvas.drawing.strokes.isEmpty, "Editable shapes must not be flattened into ink")
    }

    @MainActor
    func testDiagramCreateMoveResizeAndNativeUndoKeepObjectsEditable() throws {
        var shapes: [NotebookShape] = []
        var selected: String?
        var changes = 0
        var paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil, shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .rectangle, selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        undo.beginUndoGrouping()
        diagrams.insert(at: CGPoint(x: 200, y: 200))
        undo.endUndoGrouping()
        let created = try XCTUnwrap(shapes.first)
        XCTAssertEqual(shapes.count, 1)
        XCTAssertEqual(selected, created.id)
        XCTAssertTrue(undo.canUndo)
        XCTAssertFalse(canvas.drawingGestureRecognizer.isEnabled)
        XCTAssertEqual(canvas.panGestureRecognizer.minimumNumberOfTouches, 2)

        paper.diagramTool = .select
        coordinator.parent = paper
        coordinator.configureNotebook(on: canvas)
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: CGPoint(x: created.frame.midX, y: created.frame.midY))
        diagrams.updateInteraction(at: CGPoint(x: created.frame.midX + 80, y: created.frame.midY + 120))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        let moved = try XCTUnwrap(shapes.first, "A completed move must retain the created object")
        XCTAssertEqual(moved.x, created.x + 80, accuracy: 0.1)
        XCTAssertEqual(moved.y, created.y + 120, accuracy: 0.1)
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: CGPoint(x: moved.frame.maxX, y: moved.frame.maxY))
        diagrams.updateInteraction(at: CGPoint(x: moved.frame.maxX + 90, y: moved.frame.maxY + 60))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        let resized = try XCTUnwrap(shapes.first, "A completed resize must retain the object")
        XCTAssertEqual(resized.width, moved.width + 90, accuracy: 0.1)
        XCTAssertEqual(resized.height, moved.height + 60, accuracy: 0.1)
        undo.undo()
        XCTAssertEqual(try XCTUnwrap(shapes.first, "Undoing resize must retain the previously moved object"), moved, "The toolbar’s shared native undo stack must undo geometry changes")
        undo.redo()
        var labeled = try XCTUnwrap(shapes.first, "Redo must recover the resized object")
        XCTAssertEqual(labeled.width, moved.width + 90, accuracy: 0.1)
        undo.beginUndoGrouping()
        labeled.text = String(repeating: "Wrapped words ", count: 20)
        shapes = [labeled]
        coordinator.configureNotebook(on: canvas)
        undo.endUndoGrouping()
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: CGPoint(x: labeled.frame.maxX, y: labeled.frame.maxY))
        diagrams.updateInteraction(at: CGPoint(x: labeled.x + 60, y: labeled.y + 24))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        let wrapped = try XCTUnwrap(shapes.first, "A label-aware resize must retain the object")
        XCTAssertGreaterThanOrEqual(wrapped.height, NotebookShapeRenderer.requiredHeight(for: wrapped), "Resizing may wrap a label but must not clip it")
        XCTAssertNoThrow(try NotebookArtwork.validate(shapes: shapes))
        XCTAssertGreaterThan(changes, 3)
        XCTAssertTrue(canvas.drawing.strokes.isEmpty)
    }

    @MainActor
    func testExternalDiagramLabelEditSharesUndoWithoutReplacingPendingPencilInk() throws {
        var drawing = PKDrawing()
        var shapes = [NotebookShape(kind: .rectangle, x: 100, y: 100, width: 180, height: 100, text: "Before")]
        var selected = shapes.first?.id
        var changes = 0
        var paper = PaperCanvas(drawing: Binding(get: { drawing }, set: { drawing = $0 }), height: .constant(1800), style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil, shapes: Binding(get: { shapes }, set: { shapes = $0 }), selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        let pending = fixtureDrawing()
        canvas.delegate = nil
        canvas.drawing = pending
        undo.beginUndoGrouping()
        var changed = try XCTUnwrap(shapes.first)
        changed.text = "A label changed through the inspector"
        shapes = [changed]
        coordinator.configureNotebook(on: canvas)
        undo.endUndoGrouping()
        XCTAssertEqual(changes, 0, "An external edit is saved by its editor, not reported as a duplicate canvas edit")
        XCTAssertEqual(canvas.drawing, pending)
        XCTAssertTrue(undo.canUndo)
        undo.undo()
        XCTAssertEqual(try XCTUnwrap(shapes.first, "Undoing an inspector edit must retain the original object").text, "Before")
        XCTAssertEqual(changes, 1)
        XCTAssertEqual(canvas.drawing, pending)
        paper.diagramTool = .none
        coordinator.parent = paper
        coordinator.configureNotebook(on: canvas)
        coordinator.restore(drawing, on: canvas)
        XCTAssertEqual(canvas.drawing, pending, "Switching back to writing must preserve ink awaiting its callback")
        XCTAssertTrue(canvas.drawingGestureRecognizer.isEnabled)
        XCTAssertEqual(canvas.panGestureRecognizer.minimumNumberOfTouches, 1)
        coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertEqual(drawing, pending)
    }

    @MainActor
    func testTextAndReversedArrowCreationKeepEditableLabelsAndDirections() throws {
        var shapes: [NotebookShape] = []
        var selected: String?
        var editRequests: [String] = []
        var paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil, shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .text, selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), onEditShapeText: { editRequests.append($0) }, continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        diagrams.insert(at: CGPoint(x: 180, y: 180))
        let text = try XCTUnwrap(shapes.first)
        XCTAssertEqual(text.kind, .text)
        XCTAssertEqual(editRequests, [text.id], "Text placement must commit an editable object before requesting its label editor")
        paper.diagramTool = .arrow
        coordinator.parent = paper
        coordinator.configureNotebook(on: canvas)
        diagrams.beginInteraction(at: CGPoint(x: 500, y: 400))
        diagrams.updateInteraction(at: CGPoint(x: 320, y: 260))
        diagrams.endInteraction()
        let arrow = try XCTUnwrap(shapes.last)
        XCTAssertEqual(arrow.kind, .arrow)
        XCTAssertTrue(arrow.flippedX)
        XCTAssertTrue(arrow.flippedY)
        XCTAssertEqual(arrow.x, 320, accuracy: 0.1)
        XCTAssertEqual(arrow.y, 260, accuracy: 0.1)
        XCTAssertTrue(canvas.drawing.strokes.isEmpty)
    }

    @MainActor
    func testCreationSelectsCommittedObjectOnlyAfterTheDragEnds() throws {
        var shapes: [NotebookShape] = []
        var selection: String?
        var toolChanges: [NotebookDiagramTool] = []
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .rectangle,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true,
            onDiagramToolChanged: { toolChanges.append($0) })
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        diagrams.beginInteraction(at: CGPoint(x: 100, y: 150))
        diagrams.updateInteraction(at: CGPoint(x: 330, y: 280))
        XCTAssertEqual(diagrams.tool, .rectangle)
        XCTAssertTrue(toolChanges.isEmpty, "Switching during the drag would interrupt creation")
        diagrams.endInteraction()
        XCTAssertEqual(diagrams.tool, .select)
        XCTAssertEqual(toolChanges, [.select])
        let created = try XCTUnwrap(shapes.first)
        XCTAssertEqual(selection, created.id)
        diagrams.beginInteraction(at: CGPoint(x: created.frame.midX, y: created.frame.midY))
        diagrams.updateInteraction(at: CGPoint(x: created.frame.midX + 60, y: created.frame.midY + 40))
        diagrams.endInteraction()
        XCTAssertEqual(shapes.count, 1, "The next drag moves the selected object, rather than creating another rectangle")
        XCTAssertEqual(try XCTUnwrap(shapes.first, "Moving the just-created object must retain it").x, created.x + 60, accuracy: 0.1)
    }

    @MainActor
    func testDormantPinchArbitrationKeepsDragCreationCommitUndoAndSavedInk() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Synthetic creation recovery")
        let blank = try store.createNoteForWriting(in: notebook)
        let originalInk = fixtureDrawing()
        let page = try store.savePage(blank, drawing: originalInk, style: .plain, canvasHeight: 1800)
        var shapes: [NotebookShape] = []
        var selection: String?
        var activeTool = NotebookDiagramTool.rectangle
        var paper = PaperCanvas(drawing: .constant(originalInk), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: activeTool,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true,
            onDiagramToolChanged: { activeTool = $0 })
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: CGPoint(x: 120, y: 250))
        diagrams.updateInteraction(at: CGPoint(x: 330, y: 360))
        let preview = try XCTUnwrap(shapes.first)
        let dormantPinch = UIPinchGestureRecognizer()
        XCTAssertEqual(dormantPinch.state, .possible)
        XCTAssertTrue(diagrams.gestureRecognizer(UIPanGestureRecognizer(), shouldRecognizeSimultaneouslyWith: dormantPinch))
        XCTAssertTrue(diagrams.gestureRecognizer(dormantPinch, shouldRecognizeSimultaneouslyWith: UIPanGestureRecognizer()))
        XCTAssertEqual(shapes, [preview], "A UIKit arbitration query is not an actual pinch and must not roll back the preview")
        diagrams.updateInteraction(at: CGPoint(x: 390, y: 420))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        let created = try XCTUnwrap(shapes.first)
        XCTAssertEqual(created.id, preview.id)
        XCTAssertEqual(created.width, 270, accuracy: 0.0001)
        XCTAssertEqual(created.height, 170, accuracy: 0.0001)
        XCTAssertEqual(selection, created.id)
        XCTAssertEqual(activeTool, .select)
        XCTAssertEqual(diagrams.tool, .select)
        paper.diagramTool = activeTool
        coordinator.parent = paper
        coordinator.configureNotebook(on: canvas)
        XCTAssertEqual(diagrams.shapes, [created], "An immediate editor refresh must keep the committed object")
        XCTAssertEqual(canvas.drawing, originalInk)
        let saved = try store.savePage(page, drawing: originalInk, style: .plain, canvasHeight: 1800, shapes: shapes)
        let reopened = NotebookStore(directory: directory)
        XCTAssertEqual(try reopened.shapes(for: saved), [created])
        XCTAssertEqual(try reopened.drawing(for: saved), originalInk)
        undo.undo()
        XCTAssertTrue(shapes.isEmpty, "One Undo must remove the entire newly created object")
        XCTAssertEqual(canvas.drawing, originalInk)
        XCTAssertFalse(undo.canUndo, "Preview refreshes must not register extra geometry actions")
    }

    @MainActor
    func testHostedDragCreationSurvivesDormantPinchAndReactiveReconfiguration() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Synthetic hosted creation")
        let blank = try store.createNoteForWriting(in: notebook)
        let ink = fixtureDrawing()
        let saved = try store.savePage(blank, drawing: ink, style: .plain, canvasHeight: 1800)
        let driver = NotebookToolbarTestDriver()
        let host = UIHostingController(rootView: NotebookToolbarTestView(page: saved, drawing: ink, shapes: [], store: store, driver: driver))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1024, height: 900)
        defer { driver.detach(); window.isHidden = true; window.rootViewController = nil }
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        let canvas = try XCTUnwrap(findCanvas(in: host.view) as? GridCanvas)
        let coordinator = try XCTUnwrap(canvas.delegate as? PaperCanvas.Coordinator)
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        driver.setTool(.rectangle)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(diagrams.tool, .rectangle)
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: CGPoint(x: 140, y: 270))
        diagrams.updateInteraction(at: CGPoint(x: 330, y: 380))
        // This yield runs real @State/UIViewRepresentable updates caused by the
        // preview, selected-object binding and its persisted thumbnail/index.
        try await Task.sleep(for: .milliseconds(150))
        let preview = try XCTUnwrap(driver.readShapes().first)
        XCTAssertEqual(diagrams.shapes, [preview])
        XCTAssertEqual(coordinator.parent.diagramTool, .rectangle)
        let dormantPinch = UIPinchGestureRecognizer()
        XCTAssertEqual(dormantPinch.state, .possible)
        XCTAssertTrue(diagrams.gestureRecognizer(UIPanGestureRecognizer(), shouldRecognizeSimultaneouslyWith: dormantPinch))
        XCTAssertTrue(diagrams.gestureRecognizer(dormantPinch, shouldRecognizeSimultaneouslyWith: UIPanGestureRecognizer()))
        XCTAssertEqual(driver.readShapes(), [preview])
        diagrams.updateInteraction(at: CGPoint(x: 440, y: 450))
        try await Task.sleep(for: .milliseconds(150))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        try await Task.sleep(for: .milliseconds(200))
        host.view.layoutIfNeeded()
        let created = try XCTUnwrap(driver.readShapes().first)
        XCTAssertEqual(created.id, preview.id)
        XCTAssertEqual(created.width, 300, accuracy: 0.0001)
        XCTAssertEqual(created.height, 180, accuracy: 0.0001)
        XCTAssertEqual(driver.readSelection(), created.id)
        XCTAssertEqual(driver.readTool(), .select)
        XCTAssertEqual(coordinator.parent.diagramTool, .select)
        XCTAssertEqual(diagrams.tool, .select)
        XCTAssertEqual(diagrams.shapes, [created])
        XCTAssertEqual(diagrams.renderedObjectCount, 1)
        XCTAssertEqual(driver.readDrawing(), ink)
        XCTAssertEqual(canvas.drawing, ink)
        XCTAssertNil(driver.saveError)
        let reopened = NotebookStore(directory: directory)
        let currentPage = try XCTUnwrap(reopened.pages.first { $0.id == saved.id })
        XCTAssertEqual(try reopened.shapes(for: currentPage), [created])
        XCTAssertEqual(try reopened.drawing(for: currentPage), ink)
        driver.issueCommand(.init(id: UUID(), undo: true))
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(driver.readShapes().isEmpty, "Toolbar Undo must remove a completed creation from real editor state")
        XCTAssertTrue(diagrams.shapes.isEmpty)
        XCTAssertEqual(driver.readDrawing(), ink)
        XCTAssertFalse(undo.canUndo)
        XCTAssertNil(driver.saveError)
        let afterUndo = NotebookStore(directory: directory)
        let undoPage = try XCTUnwrap(afterUndo.pages.first { $0.id == saved.id })
        XCTAssertTrue(try afterUndo.shapes(for: undoPage).isEmpty)
        XCTAssertEqual(try afterUndo.drawing(for: undoPage), ink)
    }

    @MainActor
    func testLiveDiagramTextOrientationMatchesItsSharedUIKitExport() throws {
        let shape = NotebookShape(kind: .text, x: 100, y: 100, width: 160, height: 90, text: "F", fontSize: 36)
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil, shapes: .constant([shape]), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        window.overrideUserInterfaceStyle = .light
        canvas.overrideUserInterfaceStyle = .light
        canvas.diagramCanvas?.redraw()
        func displayLayers(_ layer: CALayer) {
            layer.displayIfNeeded()
            for child in layer.sublayers ?? [] { displayLayers(child) }
        }
        displayLayers(canvas.layer)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        let live = UIGraphicsImageRenderer(size: canvas.bounds.size, format: format).image { result in canvas.layer.render(in: result.cgContext) }
        let textRect = NotebookShapeRenderer.labelRect(for: shape).offsetBy(dx: shape.x, dy: shape.y)
        let pixels = CGRect(x: textRect.minX * 2, y: textRect.minY * 2, width: textRect.width * 2, height: textRect.height * 2).integral
        let liveCrop = try XCTUnwrap(live.cgImage?.cropping(to: pixels))
        let expected = NotebookArtwork.render(drawing: PKDrawing(), shapes: [shape], bounds: textRect, scale: 2)
        let expectedImage = try XCTUnwrap(expected.cgImage)
        let actualRows = try diagramTextRowProfile(liveCrop)
        let expectedRows = try diagramTextRowProfile(expectedImage)
        XCTAssertGreaterThan(expectedRows.reduce(0, +), 20, "The fixture must contain visible text")
        XCTAssertGreaterThan(actualRows.reduce(0, +), 20, "Live text must actually render, not merely avoid an exception")
        let count = min(actualRows.count, expectedRows.count)
        let uprightDistance = (0..<count).reduce(0.0) { $0 + abs(actualRows[$1] - expectedRows[$1]) }
        let invertedDistance = (0..<count).reduce(0.0) { $0 + abs(actualRows[$1] - expectedRows[expectedRows.count - 1 - $1]) }
        XCTAssertLessThan(uprightDistance, invertedDistance * 0.5, "An asymmetric F must match the export orientation, not an upside-down version")
    }

    @MainActor
    func testArrowLabelOutsideTheShaftCanSelectAndMoveItsObject() throws {
        let arrow = NotebookShape(kind: .arrow, x: 120, y: 150, width: 180, height: 2, text: "Explain the next step")
        var shapes = [arrow]
        var selection: String?
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let label = NotebookShapeRenderer.labelRect(for: arrow).offsetBy(dx: arrow.x, dy: arrow.y)
        let labelPoint = CGPoint(x: label.midX, y: label.midY)
        XCTAssertFalse(arrow.frame.insetBy(dx: -12, dy: -12).contains(labelPoint), "The fixture must exercise the label outside the shaft’s old hit area")
        diagrams.select(at: labelPoint)
        XCTAssertEqual(selection, arrow.id, "Visible labels are part of their editable arrow’s hit target")
        diagrams.beginInteraction(at: labelPoint)
        diagrams.updateInteraction(at: CGPoint(x: labelPoint.x + 50, y: labelPoint.y + 70))
        diagrams.endInteraction()
        let moved = try XCTUnwrap(shapes.first)
        XCTAssertEqual(moved.id, arrow.id)
        XCTAssertEqual(moved.x, arrow.x + 50, accuracy: 0.1)
        XCTAssertEqual(moved.y, arrow.y + 70, accuracy: 0.1)
        XCTAssertEqual(moved.text, arrow.text)
        XCTAssertTrue(canvas.drawing.strokes.isEmpty)
    }

    @MainActor
    func testSelectedShapeKeyboardDeleteUndoAndRedoPreservePendingPencilInk() throws {
        let original = NotebookShape(kind: .rectangle, x: 120, y: 140, width: 240, height: 120, text: "Keep my ink")
        var shapes = [original]
        var selection: String? = original.id
        var changes = 0
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let pendingInk = fixtureDrawing(color: .blue, width: 5)
        canvas.delegate = nil
        canvas.drawing = pendingInk
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        XCTAssertTrue(canvas.isFirstResponder)
        XCTAssertTrue(canvas.canPerformAction(#selector(GridCanvas.deleteNotebookSelection(_:)), withSender: nil))
        XCTAssertTrue(canvas.keyCommands?.contains { $0.input == "\u{8}" && $0.action == #selector(GridCanvas.deleteNotebookSelection(_:)) } == true)

        undo.beginUndoGrouping()
        canvas.deleteNotebookSelection(nil)
        undo.endUndoGrouping()
        XCTAssertTrue(shapes.isEmpty)
        XCTAssertNil(selection)
        XCTAssertEqual(changes, 1)
        XCTAssertEqual(canvas.drawing, pendingInk)
        XCTAssertFalse(canvas.canPerformAction(#selector(GridCanvas.deleteNotebookSelection(_:)), withSender: nil))

        canvas.undoNotebookEdit(nil)
        XCTAssertEqual(shapes, [original], "Deleting a shape must remain a reversible native object edit")
        XCTAssertEqual(canvas.drawing, pendingInk, "Undoing an object deletion must leave unfinished Pencil ink intact")
        canvas.redoNotebookEdit(nil)
        XCTAssertTrue(shapes.isEmpty)
        XCTAssertEqual(canvas.drawing, pendingInk)
        XCTAssertEqual(changes, 3)
    }

    @MainActor
    func testShapeKeyboardActionsAndCanvasRefreshLeaveTextInputAlone() throws {
        let original = NotebookShape(kind: .rectangle, text: "Original label")
        var shapes = [original]
        var selection: String? = original.id
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let host = try XCTUnwrap(window.rootViewController)
        let title = UITextField(frame: CGRect(x: 10, y: 720, width: 220, height: 44))
        title.text = "Notebook title"
        let label = UITextView(frame: CGRect(x: 240, y: 720, width: 280, height: 100))
        label.text = "Editing an object label"
        host.view.addSubview(title)
        host.view.addSubview(label)
        let actions = [#selector(GridCanvas.deleteNotebookSelection(_:)), #selector(GridCanvas.duplicateNotebookSelection(_:)), #selector(GridCanvas.undoNotebookEdit(_:)), #selector(GridCanvas.redoNotebookEdit(_:))]

        for field in [title as UIView, label] {
            XCTAssertTrue(field.becomeFirstResponder())
            XCTAssertTrue(field.isFirstResponder)
            coordinator.configureNotebook(on: canvas)
            XCTAssertTrue(field.isFirstResponder, "An editor refresh must not steal the active title or label's keyboard focus")
            XCTAssertFalse(canvas.isFirstResponder)
            for action in actions {
                XCTAssertFalse(canvas.canPerformAction(action, withSender: nil))
                XCTAssertFalse(canvas.keyCommands?.contains { $0.action == action } == true)
            }
            canvas.deleteNotebookSelection(nil)
            canvas.duplicateNotebookSelection(nil)
            canvas.undoNotebookEdit(nil)
            canvas.redoNotebookEdit(nil)
            XCTAssertEqual(shapes, [original], "Even a directly delivered stale command must not mutate a shape while text is being edited")
            XCTAssertEqual(selection, original.id)
        }
        XCTAssertEqual(title.text, "Notebook title")
        XCTAssertEqual(label.text, "Editing an object label")
        window.endEditing(true)
        XCTAssertTrue(canvas.becomeFirstResponder())
        XCTAssertTrue(canvas.canPerformAction(#selector(GridCanvas.duplicateNotebookSelection(_:)), withSender: nil))
    }

    @MainActor
    func testSelectedLabelledShapeDuplicateIsBoundedAndSharesNativeUndo() throws {
        let original = NotebookShape(kind: .arrow, x: 9_760, y: 999_840, width: 240, height: 2, text: "An intact\nedge label", color: "green", lineWidth: 5, fontSize: 24, flippedX: true)
        XCTAssertNoThrow(try NotebookArtwork.validate(shapes: [original]))
        var shapes = [original]
        var selection: String? = original.id
        let paper = PaperCanvas(drawing: .constant(fixtureDrawing()), height: .constant(1_000_000), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let ink = canvas.drawing
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        XCTAssertTrue(canvas.keyCommands?.contains { $0.input == "d" && $0.modifierFlags == .command && $0.action == #selector(GridCanvas.duplicateNotebookSelection(_:)) } == true)

        undo.beginUndoGrouping()
        canvas.duplicateNotebookSelection(nil)
        undo.endUndoGrouping()
        XCTAssertEqual(shapes.count, 2)
        let copy = try XCTUnwrap(shapes.last)
        XCTAssertNotEqual(copy.id, original.id)
        XCTAssertEqual(copy.id, selection)
        XCTAssertEqual(copy.text, original.text)
        XCTAssertEqual(copy.color, original.color)
        XCTAssertEqual(copy.lineWidth, original.lineWidth)
        XCTAssertEqual(copy.flippedX, original.flippedX)
        XCTAssertLessThanOrEqual(copy.frame.maxX, 10_000)
        let label = NotebookShapeRenderer.labelRect(for: copy).offsetBy(dx: copy.x, dy: copy.y)
        XCTAssertLessThanOrEqual(label.maxY, 1_000_000)
        XCTAssertNoThrow(try NotebookArtwork.validate(shapes: shapes))
        canvas.undoNotebookEdit(nil)
        XCTAssertEqual(shapes, [original])
        canvas.redoNotebookEdit(nil)
        XCTAssertEqual(shapes, [original, copy])
        XCTAssertEqual(canvas.drawing, ink)
    }

    @MainActor
    func testDefaultNotebookWritingHasNoDestructiveObjectCommands() throws {
        let original = NotebookShape(kind: .rectangle, text: "Preserved diagram")
        var shapes = [original]
        let paper = PaperCanvas(drawing: .constant(fixtureDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), selectedShapeId: .constant(original.id), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        XCTAssertEqual(diagrams.tool, .none)
        XCTAssertTrue(canvas.drawingGestureRecognizer.isEnabled)
        XCTAssertEqual(canvas.panGestureRecognizer.minimumNumberOfTouches, 1)
        XCTAssertFalse(diagrams.canEditSelectedObject)
        XCTAssertFalse(canvas.canPerformAction(#selector(GridCanvas.deleteNotebookSelection(_:)), withSender: nil))
        XCTAssertFalse(canvas.canPerformAction(#selector(GridCanvas.duplicateNotebookSelection(_:)), withSender: nil))
        canvas.deleteNotebookSelection(nil)
        canvas.duplicateNotebookSelection(nil)
        XCTAssertEqual(shapes, [original], "A stale selection must never turn default Pencil writing into object editing")
    }

    @MainActor
    func testOpeningNotebookTextOrModalSuppressesCommandsBeforeFocusMoves() throws {
        let original = NotebookShape(kind: .rectangle, text: "Keep this object")
        var shapes = [original]
        var selection: String? = original.id
        var paper = PaperCanvas(drawing: .constant(fixtureDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        XCTAssertTrue(canvas.isFirstResponder)
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        undo.beginUndoGrouping()
        canvas.duplicateNotebookSelection(nil)
        undo.endUndoGrouping()
        XCTAssertEqual(shapes.count, 2)
        XCTAssertTrue(undo.canUndo)
        let committed = shapes

        paper.notebookKeyboardActionsEnabled = false
        coordinator.parent = paper
        coordinator.configureNotebook(on: canvas)
        XCTAssertTrue(canvas.isFirstResponder, "The fixture must cover the transition before a title or label has claimed focus")
        for action in [#selector(GridCanvas.deleteNotebookSelection(_:)), #selector(GridCanvas.duplicateNotebookSelection(_:)), #selector(GridCanvas.undoNotebookEdit(_:)), #selector(GridCanvas.redoNotebookEdit(_:))] {
            XCTAssertFalse(canvas.canPerformAction(action, withSender: nil))
            XCTAssertFalse(canvas.keyCommands?.contains { $0.action == action } == true)
        }
        canvas.deleteNotebookSelection(nil)
        canvas.duplicateNotebookSelection(nil)
        canvas.undoNotebookEdit(nil)
        canvas.redoNotebookEdit(nil)
        XCTAssertEqual(shapes, committed, "An open modal must suppress stale commands even before UIKit text focus changes")
        XCTAssertTrue(undo.canUndo, "Suppressing keyboard input must preserve the existing native edit history")
    }

    @MainActor
    func testSelectedObjectActionsExposeDeleteWithoutOverflowInCompactAndDarkLayouts() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        defer { window.isHidden = true; window.rootViewController = nil }
        for width in [320.0, 768.0] {
            for appearance in [UIUserInterfaceStyle.light, .dark] {
                let bar = NotebookSelectedObjectBar(editText: {}, editStyle: {}, duplicate: {}, delete: {})
                let host = UIHostingController(rootView: bar.padding(12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom).background(PadPalette.background))
                window.frame = CGRect(x: 0, y: 0, width: width, height: 500)
                window.overrideUserInterfaceStyle = appearance
                window.rootViewController = host
                window.makeKeyAndVisible()
                host.view.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(80))
                let text = try renderedText(in: host.view)
                for action in ["TEXT", "STYLE", "DUPLICATE", "DELETE"] {
                    XCTAssertTrue(text.contains(action), "\(action) must be readable without opening an overflow menu at \(width) pt in \(appearance)")
                }
                window.rootViewController = nil
            }
        }
    }

    @MainActor
    func testHostedNotebookToolbarUndoRestoresEditableAndPersistedObjectsWithoutReplacingPendingInk() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Synthetic undo recovery")
        let page = try store.createNoteForWriting(in: notebook)
        let originalInk = fixtureDrawing()
        let removed = NotebookShape(kind: .rectangle, x: 140, y: 120, width: 220, height: 140, text: "Restore this label")
        let kept = NotebookShape(kind: .ellipse, x: 440, y: 140, width: 200, height: 140, text: "Keep this label")
        let saved = try store.savePage(page, drawing: originalInk, style: .plain, canvasHeight: 1800, shapes: [removed, kept])
        let driver = NotebookToolbarTestDriver()
        let host = UIHostingController(rootView: NotebookToolbarTestView(page: saved, drawing: originalInk, shapes: [removed, kept], store: store, driver: driver))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1024, height: 900)
        defer { driver.detach(); window.isHidden = true; window.rootViewController = nil }
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(200))
        let canvas = try XCTUnwrap(findCanvas(in: host.view) as? GridCanvas)
        let coordinator = try XCTUnwrap(canvas.delegate as? PaperCanvas.Coordinator)
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let undo = try XCTUnwrap(canvas.undoManager)
        let pendingInk = PKDrawing(strokes: originalInk.strokes + fixtureDrawing(color: .blue, width: 5).strokes)
        canvas.delegate = nil
        canvas.drawing = pendingInk
        undo.removeAllActions()

        // Drive real @State bindings, as the visible selected-object Delete and
        // toolbar buttons do. A plain captured-variable binding cannot detect
        // writes discarded during UIViewRepresentable.updateUIView.
        driver.deleteObject(removed.id)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(driver.readShapes(), [kept])
        XCTAssertEqual(diagrams.shapes, [kept])
        XCTAssertTrue(undo.canUndo)
        driver.issueCommand(.init(id: UUID(), undo: true))
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(driver.readShapes(), [removed, kept], "Toolbar Undo must update the real editor state, not only redraw the engine's old layers")
        XCTAssertEqual(diagrams.shapes, [removed, kept])
        XCTAssertEqual(canvas.drawing, pendingInk)
        XCTAssertEqual(driver.readDrawing(), originalInk, "Restoring a shape must not fabricate a pending Pencil callback")
        XCTAssertNil(driver.saveError)
        let reopened = NotebookStore(directory: directory)
        let reopenedPage = try XCTUnwrap(reopened.pages.first { $0.id == saved.id })
        XCTAssertEqual(try reopened.shapes(for: reopenedPage), [removed, kept], "An undone deletion must survive closing and reopening the note")
        let listText = try renderedText(in: host.view)
        XCTAssertTrue(listText.contains("2 OBJECTS"), "The SwiftUI object list must agree with restored canvas layers")

        diagrams.select(at: CGPoint(x: removed.frame.midX, y: removed.frame.midY))
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertEqual(driver.readSelection(), removed.id, "A visually restored object must remain selectable through the real bound editor")
        canvas.delegate = coordinator
        coordinator.canvasViewDrawingDidChange(canvas)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(driver.readDrawing(), pendingInk)
        XCTAssertEqual(canvas.drawing, pendingInk)
        XCTAssertNil(driver.saveError)
        let savedAfterInk = NotebookStore(directory: directory)
        let savedAfterInkPage = try XCTUnwrap(savedAfterInk.pages.first { $0.id == saved.id })
        XCTAssertEqual(try savedAfterInk.drawing(for: savedAfterInkPage), pendingInk)
        XCTAssertEqual(try savedAfterInk.shapes(for: savedAfterInkPage), [removed, kept])

        driver.issueCommand(.init(id: UUID(), undo: false))
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(driver.readShapes(), [kept])
        XCTAssertEqual(diagrams.shapes, [kept])
        XCTAssertEqual(canvas.drawing, pendingInk)
    }

    @MainActor
    func testQueuedCanvasCommandsKeepOrderDeduplicateAndStopWhenDismantled() async throws {
        let original = NotebookShape(kind: .rectangle, text: "Queued commands")
        var shapes = [original]
        var selection: String? = original.id
        var changes = 0
        let paper = PaperCanvas(drawing: .constant(fixtureDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selection }, set: { selection = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        undo.beginUndoGrouping()
        XCTAssertTrue(try XCTUnwrap(canvas.diagramCanvas).deleteSelectedObject())
        undo.endUndoGrouping()
        let undoCommand = PaperCanvas.CanvasCommand(id: UUID(), undo: true)
        let redoCommand = PaperCanvas.CanvasCommand(id: UUID(), undo: false)
        coordinator.enqueueCanvasCommand(undoCommand, on: canvas)
        coordinator.enqueueCanvasCommand(undoCommand, on: canvas)
        coordinator.enqueueCanvasCommand(redoCommand, on: canvas)
        XCTAssertTrue(shapes.isEmpty, "Accepting a toolbar command must not mutate bindings inside the representable update")
        XCTAssertEqual(changes, 1)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(shapes.isEmpty, "Accepted Undo then Redo must execute in that order")
        XCTAssertEqual(changes, 3, "The same command identity must execute once")

        coordinator.enqueueCanvasCommand(.init(id: UUID(), undo: true), on: canvas)
        PaperCanvas.dismantleUIView(canvas, coordinator: coordinator)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(shapes.isEmpty, "Leaving a sheet must cancel a command still waiting for its MainActor turn")
        XCTAssertEqual(changes, 3)
    }

    @MainActor
    func testDrawnConnectorSnapsAtSmallZoomAndFollowsBoxMoveResizeUndo() throws {
        let left = NotebookShape(kind: .rectangle, x: 100, y: 100, width: 180, height: 120, text: "Source")
        let right = NotebookShape(kind: .rectangle, x: 480, y: 100, width: 180, height: 120, text: "Target")
        let ink = fixtureDrawing()
        var shapes = [left, right]
        var selected: String?
        var toolChanges: [NotebookDiagramTool] = []
        let paper = PaperCanvas(drawing: .constant(ink), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .arrow,
            selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true, onDiagramToolChanged: { toolChanges.append($0) })
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        canvas.setZoomScale(0.5, animated: false)
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        diagrams.beginInteraction(at: CGPoint(x: left.frame.maxX + 15, y: left.frame.midY))
        diagrams.updateInteraction(at: CGPoint(x: right.frame.minX - 15, y: right.frame.midY))
        diagrams.endInteraction()
        let arrow = try XCTUnwrap(shapes.last)
        XCTAssertEqual(arrow.kind, .arrow)
        XCTAssertEqual(arrow.startBinding?.targetId, left.id)
        XCTAssertEqual(arrow.endBinding?.targetId, right.id)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: arrow), CGPoint(x: left.frame.maxX, y: left.frame.midY))
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: arrow), CGPoint(x: right.frame.minX, y: right.frame.midY))
        XCTAssertEqual(toolChanges, [.select])
        XCTAssertEqual(selected, arrow.id)
        XCTAssertNotNil(diagrams.renderedArrowStartHandle)
        XCTAssertNotNil(diagrams.renderedArrowEndHandle)

        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        let beforeMove = shapes
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: CGPoint(x: left.x + 40, y: left.y + 40))
        diagrams.updateInteraction(at: CGPoint(x: left.x + 110, y: left.y + 130))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        let moved = try XCTUnwrap(shapes.first { $0.id == left.id })
        let movedArrow = try XCTUnwrap(shapes.first { $0.id == arrow.id })
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: movedArrow), CGPoint(x: moved.frame.maxX, y: moved.frame.midY))
        XCTAssertEqual(movedArrow.endBinding, arrow.endBinding)
        XCTAssertEqual(canvas.drawing, ink)
        undo.undo()
        XCTAssertEqual(shapes, beforeMove, "Undo must restore the box and both materialized connector endpoints together")
        undo.redo()
        XCTAssertEqual(shapes.first { $0.id == left.id }, moved)
        diagrams.select(at: CGPoint(x: moved.frame.midX, y: moved.frame.midY))
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: CGPoint(x: moved.frame.maxX, y: moved.frame.maxY))
        diagrams.updateInteraction(at: CGPoint(x: moved.frame.maxX + 100, y: moved.frame.maxY + 70))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        let resized = try XCTUnwrap(shapes.first { $0.id == left.id })
        let resizedArrow = try XCTUnwrap(shapes.first { $0.id == arrow.id })
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: resizedArrow), CGPoint(x: resized.frame.maxX, y: resized.frame.midY))
        XCTAssertEqual(resizedArrow.startBinding, arrow.startBinding)
        XCTAssertNoThrow(try NotebookArtwork.validate(shapes: shapes))
        XCTAssertEqual(canvas.drawing, ink)
    }

    @MainActor
    func testExistingFreeArrowEndpointCanAttachDetachAndReconnectWithoutMovingOtherEnd() throws {
        let box = NotebookShape(kind: .rectangle, x: 500, y: 100, width: 180, height: 120)
        let legacy = NotebookShape(kind: .arrow, x: 140, y: 160, width: 160, height: 2, text: "Existing arrow")
        var shapes = [box, legacy]
        var selected: String? = legacy.id
        let paper = PaperCanvas(drawing: .constant(fixtureDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        XCTAssertNil(shapes.last?.endBinding, "Opening an old arrow must not connect it automatically")
        let originalStart = NotebookArrowGeometry.startPoint(of: legacy)
        diagrams.beginInteraction(at: NotebookArrowGeometry.endPoint(of: legacy))
        diagrams.updateInteraction(at: CGPoint(x: box.frame.minX - 10, y: box.frame.midY))
        diagrams.endInteraction()
        let attached = try XCTUnwrap(shapes.last)
        XCTAssertEqual(attached.endBinding?.targetId, box.id)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: attached), originalStart)
        let endHandle = try XCTUnwrap(diagrams.renderedArrowEndHandle)
        XCTAssertEqual(endHandle.midX, NotebookArrowGeometry.endPoint(of: attached).x * canvas.zoomScale, accuracy: 0.01)
        XCTAssertEqual(endHandle.midY, NotebookArrowGeometry.endPoint(of: attached).y * canvas.zoomScale, accuracy: 0.01)

        diagrams.beginInteraction(at: NotebookArrowGeometry.endPoint(of: attached))
        diagrams.updateInteraction(at: CGPoint(x: 340, y: 420))
        diagrams.endInteraction()
        let detached = try XCTUnwrap(shapes.last)
        XCTAssertNil(detached.endBinding)
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: detached), CGPoint(x: 340, y: 420))
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: detached), originalStart)
        diagrams.beginInteraction(at: NotebookArrowGeometry.endPoint(of: detached))
        diagrams.updateInteraction(at: CGPoint(x: box.frame.minX - 10, y: box.frame.midY))
        diagrams.endInteraction()
        XCTAssertEqual(shapes.last?.endBinding?.targetId, box.id)
    }

    @MainActor
    func testDeletingConnectedBoxDetachesArrowAndUndoRestoresRelationship() throws {
        let box = NotebookShape(kind: .rectangle, x: 500, y: 100, width: 180, height: 120)
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow, text: "Kept connector"), start: CGPoint(x: 160, y: 160), end: CGPoint(x: 500, y: 160))
        arrow.endBinding = NotebookArrowBinding(targetId: box.id, x: 0, y: 0.5)
        var shapes = [box, arrow]
        var selected: String? = box.id
        let paper = PaperCanvas(drawing: .constant(fixtureDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        undo.beginUndoGrouping()
        XCTAssertTrue(diagrams.deleteSelectedObject())
        undo.endUndoGrouping()
        XCTAssertEqual(shapes.count, 1)
        XCTAssertNil(shapes.first?.endBinding)
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: try XCTUnwrap(shapes.first)), CGPoint(x: 500, y: 160))
        XCTAssertEqual(shapes.first?.text, "Kept connector")
        XCTAssertNoThrow(try NotebookArtwork.validate(shapes: shapes))
        undo.undo()
        XCTAssertEqual(shapes, [box, arrow])
        XCTAssertEqual(shapes.last?.endBinding?.targetId, box.id)
    }

    private func diagramTextRowProfile(_ image: CGImage) throws -> [Double] {
        let width = image.width, height = image.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        return try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return (0..<height).map { row in
                Double((0..<width).reduce(0) { count, column in
                    let offset = (row * width + column) * 4
                    return count + (buffer[offset] < 100 && buffer[offset + 1] < 100 && buffer[offset + 2] < 100 ? 1 : 0)
                })
            }
        }
    }

    @MainActor
    func testFourCornerHandlesResizeRotatedShapesWithoutJumpingOrMovingTheOppositeCorner() throws {
        for angle in [0.0, 0.65] {
            for corner in NotebookResizeCorner.allCases {
                for zoom in [0.35, 1.0, 3.0] {
                    let original = NotebookShape(kind: .rectangle, x: 360, y: 280, width: 180, height: 120, text: "Kept label", rotation: angle == 0 ? nil : angle)
                    var shapes = [original]
                    var selected: String? = original.id
                    let ink = fixtureDrawing()
                    let paper = PaperCanvas(drawing: .constant(ink), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
                        shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
                        selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
                    let (canvas, coordinator, window) = diagramFixture(paper)
                    defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
                    canvas.setZoomScale(zoom, animated: false)
                    let diagrams = try XCTUnwrap(canvas.diagramCanvas)
                    diagrams.redraw()
                    XCTAssertEqual(diagrams.renderedResizeHandleCount, 4)
                    XCTAssertEqual(try XCTUnwrap(diagrams.renderedRotationHandle).width, 14, accuracy: 0.1)
                    let handle = try XCTUnwrap(NotebookShapeGeometry.corners(of: original)[corner])
                    let opposite = try XCTUnwrap(NotebookShapeGeometry.corners(of: original)[corner.opposite])
                    let touchOffset = CGPoint(x: 3 / zoom, y: 4 / zoom)
                    let touch = CGPoint(x: handle.x + touchOffset.x, y: handle.y + touchOffset.y)
                    diagrams.beginInteraction(at: touch)
                    diagrams.updateInteraction(at: touch)
                    XCTAssertEqual(shapes[0].x, original.x, accuracy: 0.0001, "Grabbing inside the handle must not jump")
                    XCTAssertEqual(shapes[0].y, original.y, accuracy: 0.0001)
                    let local = CGPoint(x: corner.horizontalSign > 0 ? original.width + 45 : -45,
                                        y: corner.verticalSign > 0 ? original.height + 30 : -30)
                    let target = NotebookShapeGeometry.documentPoint(local, in: original)
                    diagrams.updateInteraction(at: CGPoint(x: target.x + touchOffset.x, y: target.y + touchOffset.y))
                    diagrams.endInteraction()
                    let after = try XCTUnwrap(NotebookShapeGeometry.corners(of: shapes[0])[corner.opposite])
                    XCTAssertEqual(after.x, opposite.x, accuracy: 0.0001)
                    XCTAssertEqual(after.y, opposite.y, accuracy: 0.0001)
                    XCTAssertGreaterThan(shapes[0].width, original.width)
                    XCTAssertGreaterThan(shapes[0].height, original.height)
                    XCTAssertEqual(shapes[0].rotation, original.rotation)
                    XCTAssertEqual(shapes[0].text, original.text)
                    XCTAssertEqual(canvas.drawing, ink)
                }
            }
        }
    }

    @MainActor
    func testRotationHandleUpdatesConnectedArrowAndUndoRestoresTheWholeDiagram() throws {
        let box = NotebookShape(kind: .rectangle, x: 300, y: 300, width: 160, height: 100, text: "Source")
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow), start: CGPoint(x: 460, y: 350), end: CGPoint(x: 720, y: 350))
        arrow.startBinding = NotebookArrowBinding(targetId: box.id, x: 1, y: 0.5)
        var shapes = [box, arrow]
        var selected: String? = box.id
        let ink = fixtureDrawing()
        let paper = PaperCanvas(drawing: .constant(ink), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        let handle = diagrams.rotationHandle(for: box)
        let radius = hypot(handle.x - box.frame.midX, handle.y - box.frame.midY)
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: handle)
        let angle = 0.8
        diagrams.updateInteraction(at: CGPoint(x: box.frame.midX + sin(angle) * radius, y: box.frame.midY - cos(angle) * radius))
        diagrams.endInteraction()
        undo.endUndoGrouping()
        XCTAssertEqual(try XCTUnwrap(shapes[0].rotation), angle, accuracy: 0.0001)
        let expected = CGPoint(x: box.frame.midX + cos(angle) * box.width / 2, y: box.frame.midY + sin(angle) * box.width / 2)
        let endpoint = NotebookArrowGeometry.startPoint(of: shapes[1])
        XCTAssertEqual(endpoint.x, expected.x, accuracy: 0.0001)
        XCTAssertEqual(endpoint.y, expected.y, accuracy: 0.0001)
        XCTAssertEqual(shapes[1].startBinding, arrow.startBinding)
        XCTAssertEqual(canvas.drawing, ink)
        let rotated = shapes
        undo.undo()
        XCTAssertEqual(shapes, [box, arrow])
        undo.redo()
        XCTAssertEqual(shapes, rotated)
        diagrams.select(at: NotebookShapeGeometry.documentPoint(CGPoint(x: 20, y: 20), in: shapes[0]))
        XCTAssertEqual(selected, box.id, "Hit testing must follow the visible rotation")
        diagrams.beginInteraction(at: diagrams.rotationHandle(for: shapes[0]))
        diagrams.updateInteraction(at: CGPoint(x: box.frame.midX - radius, y: box.frame.midY))
        diagrams.cancelInteraction()
        XCTAssertEqual(shapes, rotated, "Interrupted manipulation must retain the committed revision")
    }

    @MainActor
    func testBendHandleCurvesLinesAndBoundArrowsWithoutDetachingEndpoints() throws {
        for kind in [NotebookShapeKind.line, .arrow] {
            let box = NotebookShape(kind: .rectangle, x: 100, y: 280, width: 160, height: 100)
            var line = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: kind), start: CGPoint(x: 260, y: 330), end: CGPoint(x: 640, y: 330))
            line.startBinding = NotebookArrowBinding(targetId: box.id, x: 1, y: 0.5)
            var shapes = [box, line]
            var selected: String? = line.id
            let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
                shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
                selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
            let (canvas, coordinator, window) = diagramFixture(paper)
            defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
            let diagrams = try XCTUnwrap(canvas.diagramCanvas)
            XCTAssertNotNil(diagrams.renderedBendHandle)
            XCTAssertNil(diagrams.renderedRotationHandle, "Connected endpoints must not silently detach during whole-line transforms")
            let midpoint = NotebookArrowGeometry.bendPoint(of: line)
            diagrams.beginInteraction(at: midpoint)
            diagrams.updateInteraction(at: CGPoint(x: midpoint.x, y: midpoint.y + 120))
            diagrams.endInteraction()
            let bent = shapes[1]
            XCTAssertEqual(try XCTUnwrap(bent.bend), 120, accuracy: 0.0001)
            XCTAssertEqual(bent.startBinding, line.startBinding)
            XCTAssertEqual(NotebookArrowGeometry.startPoint(of: bent), NotebookArrowGeometry.startPoint(of: line))
            XCTAssertEqual(NotebookArrowGeometry.endPoint(of: bent), NotebookArrowGeometry.endPoint(of: line))
            XCTAssertEqual(try XCTUnwrap(diagrams.renderedBendHandle).midY, midpoint.y + 120, accuracy: 0.1)
            diagrams.select(at: CGPoint(x: midpoint.x, y: midpoint.y + 120))
            XCTAssertEqual(selected, line.id, "The curve must remain selectable outside the old endpoint frame")
            XCTAssertGreaterThan(try XCTUnwrap(NotebookArtwork.contentBounds(drawing: PKDrawing(), shapes: shapes)).maxY, line.frame.maxY + 100)
            XCTAssertNoThrow(try NotebookArtwork.validate(shapes: shapes))
        }
    }

    @MainActor
    func testOnlyRecognizedPinchCancelsAnUncommittedObjectTransform() throws {
        let shape = NotebookShape(kind: .rectangle, x: 250, y: 220, width: 150, height: 100)
        let ink = fixtureDrawing()
        var shapes = [shape]
        var selected: String? = shape.id
        let paper = PaperCanvas(drawing: .constant(ink), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: Binding(get: { shapes }, set: { shapes = $0 }), diagramTool: .select,
            selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        let undo = try XCTUnwrap(canvas.undoManager)
        undo.removeAllActions()
        while undo.groupingLevel > 0 { undo.endUndoGrouping() }
        undo.groupsByEvent = false
        let pinch = ControlledPinchGestureRecognizer()
        let originalCenter = CGPoint(x: shape.frame.midX, y: shape.frame.midY)
        let drag = CGPoint(x: originalCenter.x + 70, y: originalCenter.y + 50)
        for recognizedState in [UIGestureRecognizer.State.began, .changed] {
            diagrams.beginInteraction(at: originalCenter)
            diagrams.updateInteraction(at: drag)
            let preview = shapes
            XCTAssertNotEqual(preview, [shape])
            for dormantState in [UIGestureRecognizer.State.possible, .ended, .cancelled, .failed] {
                pinch.reportedState = dormantState
                diagrams.canvasPinchChanged(pinch)
                XCTAssertEqual(shapes, preview, "A non-recognized pinch state must leave pending object work intact")
                XCTAssertEqual(canvas.drawing, ink)
            }
            pinch.reportedState = recognizedState
            XCTAssertTrue(diagrams.gestureRecognizer(UIPanGestureRecognizer(), shouldRecognizeSimultaneouslyWith: pinch))
            XCTAssertTrue(diagrams.gestureRecognizer(pinch, shouldRecognizeSimultaneouslyWith: UIPanGestureRecognizer()))
            XCTAssertEqual(shapes, preview, "Even recognition arbitration must have no mutation side effects")
            diagrams.canvasPinchChanged(pinch)
            XCTAssertEqual(shapes, [shape], "An actual begun/changed pinch must cancel the uncommitted move before zooming")
            diagrams.endInteraction()
            XCTAssertEqual(shapes, [shape])
            XCTAssertEqual(canvas.drawing, ink)
            XCTAssertFalse(undo.canUndo, "A canceled preview must not become an undoable edit")
        }
        undo.beginUndoGrouping()
        diagrams.beginInteraction(at: originalCenter)
        diagrams.updateInteraction(at: drag)
        let committed = shapes
        diagrams.endInteraction()
        undo.endUndoGrouping()
        XCTAssertNotEqual(committed, [shape])
        for state in [UIGestureRecognizer.State.possible, .began, .changed, .ended, .cancelled, .failed] {
            pinch.reportedState = state
            diagrams.canvasPinchChanged(pinch)
            XCTAssertEqual(shapes, committed, "Pinching after the drag ends cannot roll back a committed object")
        }
        undo.undo()
        XCTAssertEqual(shapes, [shape])
        XCTAssertEqual(canvas.drawing, ink)
    }

    @MainActor
    func testCurveAndRotatedTextDoNotInterceptTapsInTheirEmptyBoundingAreas() throws {
        let underneath = NotebookShape(kind: .rectangle, x: 410, y: 365, width: 80, height: 40)
        var curve = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .line), start: CGPoint(x: 260, y: 330), end: CGPoint(x: 640, y: 330))
        curve = NotebookArrowGeometry.settingBend(of: curve, through: CGPoint(x: 450, y: 450))
        let text = NotebookShape(kind: .text, x: 300, y: 100, width: 120, height: 70, text: "F", rotation: .pi / 4)
        let behindText = NotebookShape(kind: .rectangle, x: 299, y: 77, width: 25, height: 25)
        var selected: String?
        let paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil,
            shapes: .constant([underneath, curve, behindText, text]), diagramTool: .select,
            selectedShapeId: Binding(get: { selected }, set: { selected = $0 }), continuous: true)
        let (canvas, coordinator, window) = diagramFixture(paper)
        defer { withExtendedLifetime(coordinator) {}; window.isHidden = true; window.rootViewController = nil }
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        diagrams.select(at: CGPoint(x: 450, y: 385))
        XCTAssertEqual(selected, underneath.id, "Only the visible curved stroke should intercept taps, not its implicitly closed bow")
        let emptyCorner = CGPoint(x: 311, y: 88)
        XCTAssertFalse(CGRect(origin: .zero, size: text.frame.size).contains(NotebookShapeGeometry.localPoint(emptyCorner, in: text)))
        diagrams.select(at: emptyCorner)
        XCTAssertEqual(selected, behindText.id, "Empty triangular corners around rotated text should remain tappable")
    }

    @MainActor
    func testHostedEditorRendersRotatedSelectionAndCurveControlsWithSyntheticWork() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Diagram study")
        let page = try store.createNoteForWriting(in: notebook)
        let note = try XCTUnwrap(store.notes.first)
        try store.renameNote(note, title: "Shapes & connections")
        let left = NotebookShape(kind: .rectangle, x: 180, y: 160, width: 200, height: 120, text: "Start here", color: "green", filled: true, rotation: 0.25)
        let right = NotebookShape(kind: .ellipse, x: 560, y: 190, width: 180, height: 110, text: "Next idea", color: "blue")
        let start = try XCTUnwrap(NotebookArrowGeometry.bindingPoint(NotebookArrowBinding(targetId: left.id, x: 1, y: 0.5), in: [left]))
        let end = CGPoint(x: right.x, y: right.frame.midY)
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow, color: "blue"), start: start, end: end)
        arrow.startBinding = NotebookArrowBinding(targetId: left.id, x: 1, y: 0.5)
        arrow.endBinding = NotebookArrowBinding(targetId: right.id, x: 0, y: 0.5)
        arrow = NotebookArrowGeometry.settingBend(of: arrow, through: CGPoint(x: 470, y: 365))
        let saved = try store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: 1800, shapes: [left, right, arrow])
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1024, height: 900)
        defer { window.isHidden = true; window.rootViewController = nil }
        let host = UIHostingController(rootView: NotebookPageEditor(initialPage: saved).environmentObject(store).environmentObject(BridgeClient()))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let canvas = try XCTUnwrap(findCanvas(in: host.view) as? GridCanvas)
        let coordinator = try XCTUnwrap(canvas.delegate as? PaperCanvas.Coordinator)
        coordinator.parent.onDiagramToolChanged(.select)
        try await Task.sleep(for: .milliseconds(100))
        let diagrams = try XCTUnwrap(canvas.diagramCanvas)
        for appearance in [UIUserInterfaceStyle.light, .dark] {
            window.overrideUserInterfaceStyle = appearance
            for (name, point) in [("corners-rotation", CGPoint(x: left.frame.midX, y: left.frame.midY)),
                                  ("curve-midpoint", NotebookArrowGeometry.bendPoint(of: arrow))] {
                diagrams.select(at: point)
                try await Task.sleep(for: .milliseconds(100))
                host.view.layoutIfNeeded()
                diagrams.redraw()
                if name == "corners-rotation" {
                    XCTAssertEqual(diagrams.renderedResizeHandleCount, 4)
                    XCTAssertNotNil(diagrams.renderedRotationHandle)
                } else {
                    XCTAssertNotNil(diagrams.renderedBendHandle)
                    XCTAssertNotNil(diagrams.renderedArrowStartHandle)
                    XCTAssertNotNil(diagrams.renderedArrowEndHandle)
                }
                let text = try renderedText(in: host.view)
                XCTAssertTrue(text.contains("DELETE"))
                XCTAssertTrue(text.contains("STYLE"))
                let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
                let image = UIGraphicsImageRenderer(size: host.view.bounds.size, format: format).image { _ in
                    host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
                }
                let attachment = XCTAttachment(image: image)
                attachment.name = "notebook-\(name)-\(appearance == .dark ? "dark" : "light")"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
        XCTAssertTrue(store.submissions.isEmpty, "Visual verification must never transfer or prepare learning")
        XCTAssertEqual(try store.shapes(for: saved), [left, right, arrow])
    }

    @MainActor
    private func diagramFixture(_ paper: PaperCanvas) -> (GridCanvas, PaperCanvas.Coordinator, UIWindow) {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map(UIWindow.init(windowScene:)) ?? UIWindow()
        window.frame = CGRect(x: 0, y: 0, width: 1024, height: 900)
        let host = UIViewController()
        window.rootViewController = host
        window.makeKeyAndVisible()
        let canvas = GridCanvas(frame: CGRect(x: 0, y: 0, width: 900, height: 700))
        host.view.addSubview(canvas)
        let coordinator = paper.makeCoordinator()
        canvas.delegate = coordinator
        canvas.drawingPolicy = .pencilOnly
        canvas.configureDocumentGeometry(width: 900, height: paper.height, continuous: paper.continuous)
        coordinator.installInitialDrawing(paper.drawing, on: canvas)
        coordinator.configureNotebook(on: canvas)
        host.view.layoutIfNeeded()
        canvas.becomeFirstResponder()
        return (canvas, coordinator, window)
    }

    @MainActor
    func testNotebookCanvasRestoresInkAndTitleInCompactAndDarkLayouts() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Synthetic notebook")
        let first = try store.createNoteForWriting(in: notebook)
        let note = try XCTUnwrap(store.notes.first { $0.id == first.noteId })
        try store.renameNote(note, title: "Linear algebra")
        let ink = fixtureDrawing()
        let saved = try store.savePage(first, drawing: ink, style: .squared, canvasHeight: 1800)
        let revision = try XCTUnwrap(store.notes.first { $0.id == first.noteId }).revision
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 768, height: 1024))
        defer { window.isHidden = true; window.rootViewController = nil }

        for (width, appearance) in [(768.0, UIUserInterfaceStyle.light), (320.0, .dark)] {
            let editor = NotebookPageEditor(initialPage: saved).environmentObject(store).environmentObject(BridgeClient())
            let host = UIHostingController(rootView: editor)
            window.frame = CGRect(x: 0, y: 0, width: width, height: 1024)
            window.overrideUserInterfaceStyle = appearance
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(250))
            let canvas = try XCTUnwrap(findCanvas(in: host.view))
            XCTAssertEqual(canvas.drawing, ink, "Direct entry must restore the committed ink")
            XCTAssertEqual((canvas.tool as? PKInkingTool)?.inkType, .pen, "The actual notebook editor must open in writing mode")
            let grid = try XCTUnwrap(canvas as? GridCanvas)
            XCTAssertEqual(grid.diagramCanvas?.tool, NotebookDiagramTool.none, "Reopening a note must never leave object selection active")
            XCTAssertTrue(canvas.drawingGestureRecognizer.isEnabled)
            XCTAssertEqual(canvas.panGestureRecognizer.minimumNumberOfTouches, 1)
            XCTAssertGreaterThan(canvas.bounds.height, 500, "Writing remains the main surface in Split View")
            XCTAssertTrue(canvas.contentSize.height.isFinite)
            XCTAssertEqual(store.notes.first?.lastOpenedPageId, saved.id)
            XCTAssertEqual(store.notes.first?.revision, revision, "Opening a note is not a content edit")
            XCTAssertTrue(store.submissions.isEmpty, "Opening and laying out a note must not submit it")
            XCTAssertNil(store.storageError)
            window.rootViewController = nil
        }
    }

    @MainActor
    func testScannerPreviewHasBoundsBeforeLateCameraPermission() async throws {
        var permission: ((Bool) -> Void)?
        var authorizationStatus = AVAuthorizationStatus.notDetermined
        let capture = FakeScannerCapture()
        let controller = ScannerController(scanned: { _ in }, authorization: ScannerAuthorization(status: { authorizationStatus }, requestAccess: { permission = $0 }), capture: capture, applicationIsActive: { true })
        defer { controller.shutdown() }
        controller.loadViewIfNeeded()
        controller.view.frame = CGRect(x: 0, y: 0, width: 1024, height: 768)
        controller.view.layoutIfNeeded()
        controller.viewDidAppear(false)

        XCTAssertGreaterThan(controller.previewView.bounds.width, 0)
        XCTAssertGreaterThan(controller.previewView.bounds.height, 0)
        XCTAssertTrue(controller.previewView.layer is AVCaptureVideoPreviewLayer)
        XCTAssertEqual(capture.configureCount, 0)
        authorizationStatus = .authorized
        try XCTUnwrap(permission)(true)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(capture.configureCount, 1)
        XCTAssertEqual(capture.runningRequests.last, true)
    }

    @MainActor
    func testScannerDismissalBeforePermissionOrConfigurationNeverStartsCamera() async throws {
        var permission: ((Bool) -> Void)?
        var authorizationStatus = AVAuthorizationStatus.notDetermined
        let capture = FakeScannerCapture()
        let controller = ScannerController(scanned: { _ in }, authorization: ScannerAuthorization(status: { authorizationStatus }, requestAccess: { permission = $0 }), capture: capture, applicationIsActive: { true })
        defer { controller.shutdown() }
        controller.loadViewIfNeeded()
        controller.viewDidAppear(false)
        controller.viewDidDisappear(false)
        authorizationStatus = .authorized
        try XCTUnwrap(permission)(true)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(capture.configureCount, 0)
        XCTAssertFalse(capture.runningRequests.contains(true))

        let pendingCapture = FakeScannerCapture()
        pendingCapture.automaticallyConfigure = false
        let pending = authorizedScanner(capture: pendingCapture)
        defer { pending.shutdown() }
        pending.loadViewIfNeeded()
        pending.viewDidAppear(false)
        pending.viewDidDisappear(false)
        try XCTUnwrap(pendingCapture.configureCompletion)(.success(()))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertFalse(pendingCapture.runningRequests.contains(true))

        let failingCapture = FakeScannerCapture()
        failingCapture.automaticallyConfigure = false
        let failing = authorizedScanner(capture: failingCapture)
        defer { failing.shutdown() }
        failing.loadViewIfNeeded()
        failing.viewDidAppear(false)
        failing.viewDidDisappear(false)
        try XCTUnwrap(failingCapture.configureCompletion)(.failure(.configurationFailed))
        try await Task.sleep(for: .milliseconds(30))
        failingCapture.automaticallyConfigure = true
        failing.viewDidAppear(false)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(failingCapture.configureCount, 2)
        XCTAssertEqual(failingCapture.runningRequests.last, true)
    }

    @MainActor
    func testScannerRestartsAfterReopeningAndForegroundReturn() async throws {
        let capture = FakeScannerCapture()
        let controller = authorizedScanner(capture: capture)
        defer { controller.shutdown() }
        controller.loadViewIfNeeded()
        controller.viewDidAppear(false)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(capture.runningRequests.last, true)
        controller.viewDidDisappear(false)
        XCTAssertEqual(capture.runningRequests.last, false)
        controller.viewDidAppear(false)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(capture.runningRequests.last, true)
        controller.setApplicationActive(false)
        XCTAssertEqual(capture.runningRequests.last, false)
        controller.setApplicationActive(true)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(capture.runningRequests.last, true)
        XCTAssertEqual(capture.configureCount, 1)
    }

    @MainActor
    func testScannerDeniedPermissionAndUnavailableCameraShowRecovery() async throws {
        let capture = FakeScannerCapture()
        let denied = ScannerController(scanned: { _ in }, authorization: ScannerAuthorization(status: { .denied }, requestAccess: { _ in XCTFail("Denied access must not request permission again") }), capture: capture, applicationIsActive: { true })
        defer { denied.shutdown() }
        denied.loadViewIfNeeded()
        denied.viewDidAppear(false)
        XCTAssertNotNil(denied.messageText)
        XCTAssertTrue(denied.messageText?.contains("Settings") == true)
        XCTAssertEqual(capture.configureCount, 0)

        let unavailableCapture = FakeScannerCapture()
        unavailableCapture.configurationResult = .failure(.unavailable)
        let unavailable = authorizedScanner(capture: unavailableCapture)
        defer { unavailable.shutdown() }
        unavailable.loadViewIfNeeded()
        unavailable.viewDidAppear(false)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertNotNil(unavailable.messageText)
        XCTAssertFalse(unavailableCapture.runningRequests.contains(true))
    }

    @MainActor
    func testScannerRecoversFromInterruptionAndReportsRuntimeFailure() async throws {
        let capture = FakeScannerCapture()
        let controller = authorizedScanner(capture: capture)
        defer { controller.shutdown() }
        controller.loadViewIfNeeded()
        controller.viewDidAppear(false)
        try await Task.sleep(for: .milliseconds(30))
        capture.onEvent?(.interrupted("Camera interrupted for testing"))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(controller.messageText, "Camera interrupted for testing")
        XCTAssertEqual(capture.runningRequests.last, false)
        capture.onEvent?(.resumed)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(capture.runningRequests.last, true)
        capture.onEvent?(.failed("Camera could not restart"))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(controller.messageText, "Camera could not restart")
        XCTAssertEqual(capture.runningRequests.last, false)
    }

    @MainActor
    func testScannerAcceptsOneCodeAndStopsAfterCompletion() async throws {
        let capture = FakeScannerCapture()
        var scanned: [String] = []
        let controller = ScannerController(scanned: { scanned.append($0) }, authorization: ScannerAuthorization(status: { .authorized }, requestAccess: { _ in }), capture: capture, applicationIsActive: { true })
        defer { controller.shutdown() }
        controller.loadViewIfNeeded()
        controller.viewDidAppear(false)
        try await Task.sleep(for: .milliseconds(30))
        controller.receiveCode("")
        XCTAssertTrue(scanned.isEmpty)
        controller.receiveCode("synthetic-pairing-test")
        controller.receiveCode("synthetic-pairing-test")
        XCTAssertEqual(scanned, ["synthetic-pairing-test"])
        XCTAssertEqual(capture.runningRequests.last, false)
        controller.viewDidDisappear(false)
        capture.onCode?("late-code")
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(scanned.count, 1)
    }

    @MainActor
    private func authorizedScanner(capture: FakeScannerCapture) -> ScannerController {
        ScannerController(scanned: { _ in }, authorization: ScannerAuthorization(status: { .authorized }, requestAccess: { _ in }), capture: capture, applicationIsActive: { true })
    }

    @MainActor
    func testTutorEditorPresentsBlankCanvasAndCanReopenIt() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let document = try store.open(mode: .tutor)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1024, height: 768))
        defer { window.isHidden = true; window.rootViewController = nil }

        for _ in 0..<2 {
            let editor = PaperEditor(initialDocument: document).environmentObject(store).environmentObject(BridgeClient())
            let host = UIHostingController(rootView: editor)
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(200))
            XCTAssertTrue(try XCTUnwrap(findCanvas(in: host.view)).contentSize.height.isFinite)
            let text = try renderedText(in: host.view)
            XCTAssertTrue(text.contains("SEND TO MAC"), "Tutor Pad must name the Mac transfer, not an automatic chat handoff. Rendered: \(text)")
            XCTAssertFalse(text.contains("CODEX"))
            XCTAssertFalse(text.contains("CHATGPT"))
            XCTAssertFalse(text.contains("SEND TO CHAT"))
            XCTAssertNil(store.storageError)
            XCTAssertEqual(store.documents.first?.revision, 0, "Opening a blank sheet must not save phantom edits")
            window.rootViewController = nil
        }
    }

    @MainActor
    func testBlankCanvasOpensWithoutInfiniteHeightOrPhantomEdits() {
        var drawing = PKDrawing()
        var height = 1800.0
        var changes = 0
        let paper = PaperCanvas(
            drawing: Binding(get: { drawing }, set: { drawing = $0 }),
            height: Binding(get: { height }, set: { height = $0 }),
            style: .squared, tool: .pen, onChanged: { changes += 1 }, command: nil
        )
        let canvas = GridCanvas(frame: CGRect(x: 0, y: 0, width: 900, height: 700))
        canvas.contentSize = CGSize(width: 900, height: height)
        canvas.drawing = PKDrawing()
        paper.makeCoordinator().canvasViewDrawingDidChange(canvas)

        XCTAssertTrue(height.isFinite)
        XCTAssertEqual(height, 1800)
        XCTAssertEqual(changes, 0)
        canvas.setNeedsLayout()
        canvas.layoutIfNeeded()
    }

    @MainActor
    func testErasingAllInkKeepsSheetHeightAndSavesRecoverableBlankWork() throws {
        var drawing = fixtureDrawing()
        var height = 2400.0
        var changes = 0
        let paper = PaperCanvas(
            drawing: Binding(get: { drawing }, set: { drawing = $0 }),
            height: Binding(get: { height }, set: { height = $0 }),
            style: .squared, tool: .pen, onChanged: { changes += 1 }, command: nil
        )
        let canvas = PKCanvasView()
        canvas.drawing = PKDrawing()
        paper.makeCoordinator().canvasViewDrawingDidChange(canvas)

        XCTAssertTrue(drawing.strokes.isEmpty)
        XCTAssertEqual(height, 2400)
        XCTAssertEqual(changes, 1)

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var document = try store.open(mode: .tutor)
        document.canvasHeight = height
        let saved = try store.save(document, drawing: drawing)
        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertEqual(reload.documents[0].canvasHeight, saved.canvasHeight)
        XCTAssertEqual(saved.canvasHeight, height)
        XCTAssertTrue(try reload.drawing(for: saved).strokes.isEmpty)
    }

    @MainActor
    func testBlankTutorDraftCanSaveReloadAndRecoverInvalidHeight() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var document = try store.open(mode: .tutor)
        document.canvasHeight = .infinity
        let saved = try store.save(document, drawing: PKDrawing())
        XCTAssertTrue(saved.canvasHeight.isFinite)
        XCTAssertEqual(saved.canvasHeight, 1800)
        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertEqual(reload.documents.first?.id, document.id)
        XCTAssertEqual(reload.documents.first?.canvasHeight, 1800)
    }

    @MainActor
    func testLongDrawingExpandsCanvasWithoutTruncatingInk() {
        var drawing = PKDrawing()
        var height = 1800.0
        let paper = PaperCanvas(
            drawing: Binding(get: { drawing }, set: { drawing = $0 }),
            height: Binding(get: { height }, set: { height = $0 }),
            style: .squared, tool: .pen, onChanged: {}, command: nil
        )
        let canvas = PKCanvasView()
        canvas.drawing = fixtureDrawing().transformed(using: CGAffineTransform(translationX: 0, y: 5000))
        paper.makeCoordinator().canvasViewDrawingDidChange(canvas)

        XCTAssertTrue(height.isFinite)
        XCTAssertGreaterThanOrEqual(height, canvas.drawing.bounds.maxY + 600)
        XCTAssertEqual(drawing.strokes.count, 1)
        let grid = GridCanvas(frame: CGRect(x: 0, y: 0, width: 900, height: 700))
        grid.contentSize = CGSize(width: 900, height: height)
        grid.contentOffset = CGPoint(x: 0, y: 5000)
        grid.setNeedsLayout()
        grid.layoutIfNeeded()
    }

    @MainActor
    func testRestoringInkDoesNotTriggerAnEditAndLongGridStaysBounded() throws {
        var drawing = PKDrawing()
        var height = 50_000.0
        var changes = 0
        let paper = PaperCanvas(
            drawing: Binding(get: { drawing }, set: { drawing = $0 }),
            height: Binding(get: { height }, set: { height = $0 }),
            style: .squared, tool: .pen, onChanged: { changes += 1 }, command: nil
        )
        let coordinator = paper.makeCoordinator()
        let canvas = GridCanvas(frame: CGRect(x: 0, y: 0, width: 900, height: 700))
        canvas.delegate = coordinator
        coordinator.restore(fixtureDrawing(), on: canvas)
        coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertEqual(changes, 0)

        canvas.contentSize = CGSize(width: 900, height: height)
        canvas.contentOffset = CGPoint(x: 0, y: 20_000)
        canvas.redrawPaper()
        let layer = try XCTUnwrap(canvas.layer.sublayers?.compactMap { $0 as? CAShapeLayer }.first)
        let path = try XCTUnwrap(layer.path)
        var elements = 0
        path.applyWithBlock { _ in elements += 1 }
        XCTAssertLessThan(elements, 200, "Grid work must depend on the viewport, not total sheet length")
        XCTAssertGreaterThan(path.boundingBox.minY, 19_000)
        XCTAssertLessThan(path.boundingBox.maxY, 21_000)
    }

    @MainActor
    func testConnectionRefreshDoesNotOverwriteInkBeforePencilCallback() {
        var drawing = PKDrawing()
        var height = 1800.0
        let paper = PaperCanvas(
            drawing: Binding(get: { drawing }, set: { drawing = $0 }),
            height: Binding(get: { height }, set: { height = $0 }),
            style: .squared, tool: .pen, onChanged: {}, command: nil
        )
        let coordinator = paper.makeCoordinator()
        let canvas = PKCanvasView()
        canvas.drawing = fixtureDrawing()

        // A bridge refresh can update SwiftUI before PencilKit publishes the
        // finalized stroke. The binding still contains the previous drawing.
        coordinator.restore(drawing, on: canvas)
        XCTAssertEqual(canvas.drawing.strokes.count, 1)
        coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertEqual(drawing.strokes.count, 1)
    }

    @MainActor
    func testChangingInkAndEraserSettingsPreservesPendingDrawing() throws {
        var drawing = fixtureDrawing()
        var height = 1800.0
        var changes = 0
        var paper = PaperCanvas(
            drawing: Binding(get: { drawing }, set: { drawing = $0 }),
            height: Binding(get: { height }, set: { height = $0 }),
            style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil,
            inkColor: .blue, penWidth: 5, eraserWidth: 30
        )
        let coordinator = paper.makeCoordinator()
        let canvas = PKCanvasView()
        let pending = fixtureDrawing(color: PaperInkColor.blue.color, width: 5)
        canvas.drawing = pending
        paper.configureTool(on: canvas)
        let pen = try XCTUnwrap(canvas.tool as? PKInkingTool)
        XCTAssertEqual(pen.inkType, .pen)
        XCTAssertEqual(Double(pen.width), PaperToolSizing.penWidth(5), accuracy: 0.001)
        assertColorEqual(pen.color, PaperInkColor.blue.color)
        paper.configureTool(on: canvas)
        XCTAssertEqual(canvas.tool as? PKInkingTool, pen, "An unrelated refresh must not replace an equivalent pen")

        paper.inkColor = .red
        paper.penWidth = 7
        paper.configureTool(on: canvas)
        let changedPen = try XCTUnwrap(canvas.tool as? PKInkingTool)
        assertColorEqual(changedPen.color, PaperInkColor.red.color)
        XCTAssertEqual(Double(changedPen.width), PaperToolSizing.penWidth(7), accuracy: 0.001)
        coordinator.restore(drawing, on: canvas)
        XCTAssertEqual(canvas.drawing, pending, "Changing tool settings must not replace ink awaiting its Pencil callback")
        XCTAssertEqual(changes, 0)

        paper.tool = .eraser
        paper.configureTool(on: canvas)
        let eraser = try XCTUnwrap(canvas.tool as? PKEraserTool)
        XCTAssertEqual(eraser.eraserType, .fixedWidthBitmap)
        XCTAssertEqual(Double(eraser.width), PaperToolSizing.eraserWidth(30), accuracy: 0.001)
        paper.configureTool(on: canvas)
        XCTAssertEqual(canvas.tool as? PKEraserTool, eraser, "An unrelated refresh must not replace an equivalent eraser")
        paper.eraserWidth = PaperToolSizing.eraserRange.upperBound
        paper.configureTool(on: canvas)
        XCTAssertEqual(Double(try XCTUnwrap(canvas.tool as? PKEraserTool).width), PaperToolSizing.eraserRange.upperBound, accuracy: 0.001)
        XCTAssertEqual(canvas.drawing, pending)
        coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertEqual(drawing, pending)
        XCTAssertEqual(changes, 1)
    }

    @MainActor
    func testToolWidthsRejectNonfinitePreferencesAndClampToSupportedSizes() throws {
        for invalid in [Double.nan, .infinity, -.infinity] {
            XCTAssertEqual(PaperToolSizing.penWidth(invalid), 2.5)
            XCTAssertEqual(PaperToolSizing.eraserWidth(invalid), 24)
        }
        XCTAssertEqual(PaperToolSizing.penWidth(PaperToolSizing.penRange.lowerBound - 1), PaperToolSizing.penRange.lowerBound)
        XCTAssertEqual(PaperToolSizing.penWidth(PaperToolSizing.penRange.upperBound + 1), PaperToolSizing.penRange.upperBound)
        XCTAssertEqual(PaperToolSizing.eraserWidth(PaperToolSizing.eraserRange.lowerBound - 1), PaperToolSizing.eraserRange.lowerBound)
        XCTAssertEqual(PaperToolSizing.eraserWidth(PaperToolSizing.eraserRange.upperBound + 1), PaperToolSizing.eraserRange.upperBound)

        var paper = PaperCanvas(drawing: .constant(PKDrawing()), height: .constant(1800), style: .plain, tool: .pen, onChanged: {}, command: nil, penWidth: .nan, eraserWidth: .infinity)
        let canvas = PKCanvasView()
        paper.configureTool(on: canvas)
        XCTAssertEqual(try XCTUnwrap(canvas.tool as? PKInkingTool).width, 2.5, accuracy: 0.001)
        paper.tool = .eraser
        paper.configureTool(on: canvas)
        XCTAssertEqual(try XCTUnwrap(canvas.tool as? PKEraserTool).width, 24, accuracy: 0.001)
    }

    @MainActor
    func testInkColorsSurviveEditableStorageAndExportOnWhitePaper() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let colors: [PaperInkColor] = [.graphite, .blue, .green, .red, .purple, .amber]
        for color in colors {
            let document = try store.open(mode: .tutor)
            let drawing = fixtureDrawing(color: color.color, width: 7)
            let saved = try store.save(document, drawing: drawing)
            let reload = DocumentStore(directory: directory)
            let restored = try reload.drawing(for: saved)
            XCTAssertEqual(restored.strokes.count, 1)
            assertColorEqual(try XCTUnwrap(restored.strokes.first).ink.color, color.color)
            XCTAssertEqual(restored.strokes.first?.path.first?.size.width, 7)
            for appearance in [UIUserInterfaceStyle.light, .dark] {
                var result: Result<PaperAttempt, Error>!
                UITraitCollection(userInterfaceStyle: appearance).performAsCurrent {
                    result = Result { try store.submit(saved, drawing: restored) }
                }
                let attempt = try result.get()
                let page = try XCTUnwrap(UIImage(contentsOfFile: store.pageURLs(for: attempt)[0].path))
                let thumbnail = try XCTUnwrap(store.thumbnail(for: saved))
                if color == .graphite {
                    XCTAssertGreaterThan(darkPixelCount(page), 20)
                } else {
                    XCTAssertGreaterThan(chromaticPixelCount(page), 20, "Colored ink must remain visible in exported pages")
                    XCTAssertGreaterThan(chromaticPixelCount(thumbnail), 20, "Colored ink must remain visible in saved thumbnails")
                }
                XCTAssertGreaterThan(brightPixelCount(page), page.cgImage!.width * page.cgImage!.height * 9 / 10)
            }
        }
    }

    @MainActor
    func testColoredCanvasInkRemainsVisibleAcrossSystemAppearances() async throws {
        let original = fixtureDrawing(color: PaperInkColor.blue.color, width: 7)
        var drawing = original
        var height = 1800.0
        var changes = 0
        let paper = PaperCanvas(drawing: Binding(get: { drawing }, set: { drawing = $0 }), height: Binding(get: { height }, set: { height = $0 }), style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil, inkColor: .blue, penWidth: 7)
        let host = UIHostingController(rootView: paper)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 240)
        defer { window.isHidden = true; window.rootViewController = nil }
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        let canvas = try XCTUnwrap(findCanvas(in: host.view))

        for appearance in [UIUserInterfaceStyle.light, .dark, .light] {
            window.overrideUserInterfaceStyle = appearance
            host.overrideUserInterfaceStyle = appearance
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(250))
            XCTAssertTrue(findCanvas(in: host.view) === canvas)
            XCTAssertEqual(canvas.drawing, original)
            XCTAssertEqual(drawing, original)
            XCTAssertEqual(changes, 0)
            assertColorEqual(try XCTUnwrap(canvas.tool as? PKInkingTool).color, PaperInkColor.blue.color)
            XCTAssertGreaterThan(chromaticPixelCount(canvasSnapshot(canvas)), 20, "Colored ink must remain visible on the actual displayed paper")
        }
    }

    @MainActor
    func testExportsKeepDarkInkOnWhitePaperUnderBothAppearances() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let document = try store.open(mode: .tutor)
        for appearance in [UIUserInterfaceStyle.light, .dark] {
            var result: Result<PaperAttempt, Error>!
            UITraitCollection(userInterfaceStyle: appearance).performAsCurrent {
                result = Result { try store.submit(document, drawing: fixtureDrawing()) }
            }
            let attempt = try result.get()
            let page = try XCTUnwrap(UIImage(contentsOfFile: store.pageURLs(for: attempt)[0].path))
            let thumbnail = try XCTUnwrap(store.thumbnail(for: document))
            XCTAssertGreaterThan(darkPixelCount(page), 20)
            XCTAssertGreaterThan(darkPixelCount(thumbnail), 20)
            XCTAssertGreaterThan(brightPixelCount(page), page.cgImage!.width * page.cgImage!.height * 9 / 10)
        }
    }

    @MainActor
    func testSystemAppearanceChangesPaperAndVisibleInkWithoutEditingDrawing() async throws {
        let original = fixtureDrawing()
        var drawing = original
        var height = 1800.0
        var changes = 0
        let paper = PaperCanvas(drawing: Binding(get: { drawing }, set: { drawing = $0 }), height: Binding(get: { height }, set: { height = $0 }), style: .plain, tool: .pen, onChanged: { changes += 1 }, command: nil)
        let host = UIHostingController(rootView: paper)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 240)
        defer { window.isHidden = true; window.rootViewController = nil }
        window.overrideUserInterfaceStyle = .light
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        let canvas = try XCTUnwrap(findCanvas(in: host.view) as? GridCanvas)
        let originalTool = try XCTUnwrap(canvas.tool as? PKInkingTool)

        for appearance in [UIUserInterfaceStyle.light, .dark, .light] {
            window.overrideUserInterfaceStyle = appearance
            host.overrideUserInterfaceStyle = appearance
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(250))
            XCTAssertTrue(findCanvas(in: host.view) === canvas, "Appearance must not replace the writing surface")
            XCTAssertEqual(canvas.overrideUserInterfaceStyle, .unspecified)
            XCTAssertEqual(canvas.traitCollection.userInterfaceStyle, appearance)
            XCTAssertEqual(canvas.backgroundColor?.resolvedColor(with: canvas.traitCollection), PaperPalette.background.resolvedColor(with: canvas.traitCollection))
            XCTAssertEqual(canvas.layer.backgroundColor, PaperPalette.background.resolvedColor(with: canvas.traitCollection).cgColor)
            XCTAssertEqual(canvas.tool as? PKInkingTool, originalTool, "Appearance changes must not reassign an equivalent pen")
            let grid = try XCTUnwrap(canvas.layer.sublayers?.compactMap { $0 as? CAShapeLayer }.first)
            XCTAssertEqual(grid.strokeColor, PaperPalette.grid.resolvedColor(with: canvas.traitCollection).cgColor)
            XCTAssertEqual(canvas.drawing, original)
            XCTAssertEqual(drawing, original)
            XCTAssertEqual(changes, 0, "Changing appearance must not become a user edit")
            let image = canvasSnapshot(canvas)
            let pixelTotal = image.cgImage!.width * image.cgImage!.height
            if appearance == .dark {
                XCTAssertGreaterThan(darkPixelCount(image), pixelTotal * 9 / 10, "The rendered paper must actually be dark")
                XCTAssertGreaterThan(brightPixelCount(image), 20, "Existing ink must remain visible on dark paper")
            } else {
                XCTAssertGreaterThan(brightPixelCount(image), pixelTotal * 9 / 10, "The rendered paper must actually be light")
                XCTAssertGreaterThan(darkPixelCount(image), 20, "Existing ink must remain visible on light paper")
            }
        }
    }

    @MainActor
    func testInitiallyDarkCanvasKeepsNewInkThroughAppearanceRefresh() async throws {
        var drawing = PKDrawing()
        var height = 1800.0
        let paper = PaperCanvas(drawing: Binding(get: { drawing }, set: { drawing = $0 }), height: Binding(get: { height }, set: { height = $0 }), style: .squared, tool: .pen, onChanged: {}, command: nil)
        let host = UIHostingController(rootView: paper)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 240)
        defer { window.isHidden = true; window.rootViewController = nil }
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        let canvas = try XCTUnwrap(findCanvas(in: host.view) as? GridCanvas)
        XCTAssertEqual(canvas.traitCollection.userInterfaceStyle, .dark)
        let ink = try XCTUnwrap((canvas.tool as? PKInkingTool)?.color)
        var red: CGFloat = 1, green: CGFloat = 1, blue: CGFloat = 1, alpha: CGFloat = 0
        XCTAssertTrue(ink.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
        XCTAssertEqual(red + green + blue, 0, accuracy: 0.001, "PencilKit adapts canonical ink; do not store a white pen")
        XCTAssertEqual(alpha, 1)
        let newInk = fixtureDrawing()
        canvas.drawing = newInk
        window.overrideUserInterfaceStyle = .light
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(canvas.drawing, newInk, "A trait refresh must preserve ink awaiting its Pencil callback")
        XCTAssertEqual(drawing, newInk)
        XCTAssertEqual(height, 1800)
    }

    func testPaginationUsesWhitespaceAndRetainsCrossingInk() {
        let whitespace = PaperPagination.ranges(height: 3100, strokeRanges: [100...200, 1500...1600, 2800...3000])
        XCTAssertEqual(whitespace.first, 0...1400)
        XCTAssertEqual(whitespace.last?.upperBound, 3100)
        let continuous = PaperPagination.ranges(height: 2800, strokeRanges: [0...2800])
        XCTAssertTrue(continuous.count > 1)
        XCTAssertLessThan(continuous[1].lowerBound, continuous[0].upperBound)
        XCTAssertEqual(continuous.last?.upperBound, 2800)
    }

    func testPairCodeRejectsExpiredAndNonTLSCodes() throws {
        let pin = Data(repeating: 1, count: 32).base64EncodedString()
        func code(endpoint: String, expiresAt: String) throws -> String {
            let value: [String: Any] = ["version": 1, "installationId": UUID().uuidString, "endpoint": endpoint, "bootstrapSecret": "bootstrap", "spkiSha256": pin, "expiresAt": expiresAt]
            return String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8)!
        }
        XCTAssertThrowsError(try PairingCode.decode(code(endpoint: "http://192.168.1.2:5555", expiresAt: "2099-01-01T00:00:00Z")))
        XCTAssertThrowsError(try PairingCode.decode(code(endpoint: "https://192.168.1.2:5555", expiresAt: "2000-01-01T00:00:00Z")))
        XCTAssertEqual(try PairingCode.decode(code(endpoint: "https://192.168.1.2:5555", expiresAt: "2099-01-01T00:00:00Z")).spkiSha256, pin)
        XCTAssertEqual(try PairingCode.decode(code(endpoint: "https://192.168.1.2:5555", expiresAt: "2099-01-01T00:00:00.123Z")).spkiSha256, pin)
    }

    @MainActor
    func testDraftAndImmutableSubmissionSurviveReload() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var document = try store.open(mode: .tutor)
        document.handoffId = UUID().uuidString.lowercased()
        let drawing = fixtureDrawing()
        let saved = try store.save(document, drawing: drawing)
        let attempt = try store.submit(saved, drawing: drawing)
        let staleEditorSave = try store.save(saved, drawing: drawing)
        XCTAssertGreaterThan(staleEditorSave.revision, attempt.documentRevision)
        let originalPage = try Data(contentsOf: store.pageURLs(for: attempt)[0])
        let reload = DocumentStore(directory: directory)
        XCTAssertEqual(reload.documents.count, 1)
        XCTAssertEqual(try reload.drawing(for: reload.documents[0]).strokes.count, 1)
        XCTAssertEqual(reload.attempts[0].id, attempt.id)
        XCTAssertEqual(reload.attempts[0].state, .waitingForMac)
        _ = try reload.save(reload.documents[0], drawing: PKDrawing())
        XCTAssertEqual(try Data(contentsOf: reload.pageURLs(for: attempt)[0]), originalPage)
        XCTAssertEqual(originalPage.sha256, attempt.pages[0].sha256)
    }

    @MainActor
    func testBlankAttemptDoesNotEnterOutboxAndCorruptIndexIsPreserved() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let document = try store.open(mode: .tutor)
        XCTAssertThrowsError(try store.submit(document, drawing: PKDrawing()))
        XCTAssertTrue(store.attempts.isEmpty)
        let corrupt = Data("not json".utf8)
        try corrupt.write(to: directory.appendingPathComponent("index.json"))
        let reload = DocumentStore(directory: directory)
        XCTAssertNotNil(reload.storageError)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), corrupt)
        XCTAssertThrowsError(try reload.open(mode: .tutor))
        XCTAssertThrowsError(try reload.openTutorWorkspace())
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), corrupt)
    }

    @MainActor
    func testTutorWorkspaceResumesWithoutChangingSavedWorkOrSubmissions() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = DocumentStore(directory: directory)
        var document = try original.open(mode: .tutor)
        document.destination = "codex"
        document.title = "Linear algebra working"
        document.paperStyle = .ruled
        let drawing = fixtureDrawing()
        let attempt = try original.submit(document, drawing: drawing)
        try rewriteLegacyAttemptTargets(in: directory, targets: [attempt.id: "codex"])
        let store = DocumentStore(directory: directory)
        let saved = try XCTUnwrap(store.documents.first)
        let indexURL = directory.appendingPathComponent("index.json")
        let drawingURL = directory.appendingPathComponent(saved.id).appendingPathComponent("drawing.data")
        let indexBefore = try Data(contentsOf: indexURL)
        let drawingBefore = try Data(contentsOf: drawingURL)
        let pageBefore = try Data(contentsOf: store.pageURLs(for: attempt)[0])

        for _ in 0..<3 {
            let resumed = try store.openTutorWorkspace()
            XCTAssertEqual(resumed.id, saved.id)
            XCTAssertEqual(resumed.title, saved.title)
            XCTAssertEqual(resumed.paperStyle, saved.paperStyle)
            XCTAssertEqual(resumed.revision, saved.revision)
            XCTAssertEqual(resumed.updatedAt, saved.updatedAt)
            XCTAssertEqual(resumed.destination, "codex")
            XCTAssertEqual(resumed.handoffId, saved.handoffId)
        }

        XCTAssertEqual(store.documents.count, 1)
        XCTAssertEqual(store.attempts.map(\.id), [attempt.id])
        XCTAssertEqual(store.attempts.first?.deliveryTarget, "codex")
        XCTAssertEqual(try Data(contentsOf: indexURL), indexBefore)
        XCTAssertEqual(try Data(contentsOf: drawingURL), drawingBefore)
        XCTAssertEqual(try Data(contentsOf: store.pageURLs(for: attempt)[0]), pageBefore)
        XCTAssertEqual(try store.drawing(for: saved).strokes.count, drawing.strokes.count)
        let reload = DocumentStore(directory: directory)
        XCTAssertEqual(try reload.openTutorWorkspace().id, saved.id)
        XCTAssertEqual(try Data(contentsOf: indexURL), indexBefore)
    }

    @MainActor
    func testTutorWorkspaceUsesLatestSavedTutorInsteadOfCreationOrderOrStudy() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var firstTutor = try store.open(mode: .tutor)
        firstTutor.destination = "codex"
        firstTutor = try store.save(firstTutor, drawing: PKDrawing())
        let secondTutor = try store.open(mode: .tutor)
        let study = try store.open(mode: .study)
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var documents = try XCTUnwrap(index["documents"] as? [[String: Any]])
        for position in documents.indices {
            let id = documents[position]["id"] as? String
            documents[position]["updatedAt"] = id == firstTutor.id ? "2002-01-01T00:00:00Z" : id == study.id ? "2003-01-01T00:00:00Z" : "2001-01-01T00:00:00Z"
        }
        index["documents"] = documents
        try JSONSerialization.data(withJSONObject: index).write(to: indexURL)

        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertEqual(reload.documents.map(\.id), [study.id, secondTutor.id, firstTutor.id])
        let indexBefore = try Data(contentsOf: indexURL)
        let resumed = try reload.openTutorWorkspace()
        XCTAssertEqual(resumed.id, firstTutor.id)
        XCTAssertEqual(resumed.destination, "codex")
        XCTAssertEqual(reload.documents.count, 3)
        XCTAssertEqual(try Data(contentsOf: indexURL), indexBefore)
    }

    @MainActor
    func testFirstTutorWorkspaceCreatesOneGenericBlankAndExplicitNewSheetStillCreates() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let study = try store.open(mode: .study)
        let first = try store.openTutorWorkspace()
        XCTAssertEqual(first.destination, "clipboard")
        XCTAssertEqual(first.title, "Tutor sheet")
        XCTAssertEqual(first.revision, 0)
        XCTAssertTrue(try store.drawing(for: first).strokes.isEmpty)
        XCTAssertNotNil(first.handoffId.flatMap(UUID.init(uuidString:)))
        XCTAssertEqual(store.documents.map(\.id), [first.id, study.id])
        XCTAssertTrue(store.attempts.isEmpty)
        XCTAssertEqual(try store.openTutorWorkspace().id, first.id)
        XCTAssertEqual(store.documents.count, 2)

        let reload = DocumentStore(directory: directory)
        XCTAssertEqual(try reload.openTutorWorkspace().destination, "clipboard")
        let newSheet = try reload.open(mode: .tutor)
        XCTAssertNotEqual(newSheet.id, first.id)
        XCTAssertEqual(newSheet.destination, "clipboard")
        XCTAssertEqual(newSheet.title, "Tutor sheet")
        XCTAssertEqual(newSheet.revision, 0)
        XCTAssertEqual(reload.documents.count, 3)
    }

    @MainActor
    func testTutorWorkspaceIgnoresObsoleteDestinationPreference() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let defaults = UserDefaults.standard
        let previous = defaults.object(forKey: "tutorDestinationV1")
        defer {
            if let previous { defaults.set(previous, forKey: "tutorDestinationV1") }
            else { defaults.removeObject(forKey: "tutorDestinationV1") }
        }
        for destination in ["chatgpt", "codex", "unknown"] {
            defaults.set(destination, forKey: "tutorDestinationV1")
            let store = DocumentStore(directory: directory.appendingPathComponent(UUID().uuidString))
            let document = try store.openTutorWorkspace()
            XCTAssertEqual(document.destination, "clipboard")
            XCTAssertEqual(document.title, "Tutor sheet")
            XCTAssertEqual(document.revision, 0)
            XCTAssertEqual(store.documents.count, 1)
            XCTAssertTrue(store.attempts.isEmpty)
            XCTAssertTrue(try store.drawing(for: document).strokes.isEmpty)
        }
    }

    @MainActor
    func testTutorWorkspaceFallsBackAfterDeletionWithoutResurrectingSheets() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let first = try store.open(mode: .tutor)
        let second = try store.open(mode: .tutor)
        let selected = try store.openTutorWorkspace()
        let other = selected.id == first.id ? second : first

        try store.delete(selected)
        XCTAssertEqual(try store.openTutorWorkspace().id, other.id)
        XCTAssertEqual(store.documents.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(selected.id).path))
        try store.delete(other)
        let replacement = try store.openTutorWorkspace()
        XCTAssertNotEqual(replacement.id, selected.id)
        XCTAssertNotEqual(replacement.id, other.id)
        XCTAssertEqual(replacement.destination, "clipboard")
        XCTAssertEqual(replacement.revision, 0)
        XCTAssertEqual(store.documents.map(\.id), [replacement.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(selected.id).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(other.id).path))
    }

    @MainActor
    func testAssistantTutorAttemptKeepsItsProblemAndConversationOffline() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let problem = tutorFixture()
        let document = try store.open(mode: .tutor, tutorProblem: problem, tutorTitle: "Linear algebra")
        let attempt = try store.submit(document, drawing: fixtureDrawing())
        XCTAssertEqual(attempt.version, 2)
        XCTAssertEqual(attempt.destination, "assistant")
        XCTAssertEqual(attempt.deliveryTarget, "assistant")
        XCTAssertNil(attempt.questionPackageId, "Tutor prompts must not become Recall card references")
        XCTAssertEqual(attempt.tutorProblemId, problem.id)
        XCTAssertEqual(attempt.handoffId, problem.sessionId)
        let pageBefore = try Data(contentsOf: store.pageURLs(for: attempt)[0])
        let restored = DocumentStore(directory: directory)
        let saved = try XCTUnwrap(restored.documents.first)
        XCTAssertEqual(saved.tutorProblem, problem)
        XCTAssertEqual(saved.tutorTitle, "Linear algebra")
        XCTAssertEqual(try restored.drawing(for: saved).strokes.count, 1)
        let pending = try XCTUnwrap(restored.attempts.first)
        let context = try pending.transferContext()
        XCTAssertEqual(context.version, 2)
        XCTAssertEqual(context.questionId, problem.id)
        XCTAssertEqual(context.handoffId, problem.sessionId)
        XCTAssertEqual(context.target, "assistant")
        try restored.updateAttempt(pending.id, state: .needsAttention)
        try restored.retry(pending.id)
        let retry = try XCTUnwrap(DocumentStore(directory: directory).attempts.first)
        XCTAssertEqual(retry.id, attempt.id)
        XCTAssertEqual(retry.tutorProblemId, problem.id)
        XCTAssertEqual(retry.handoffId, problem.sessionId)
        XCTAssertEqual(retry.pages.map(\.sha256), attempt.pages.map(\.sha256))
        XCTAssertEqual(try Data(contentsOf: restored.pageURLs(for: retry)[0]), pageBefore)
        XCTAssertEqual(retry.state, .waitingForMac)
    }

    @MainActor
    func testFollowingTutorPromptSavesPendingInkAndRestoresEarlierSheets() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let first = tutorFixture()
        let second = tutorFixture(sessionId: first.sessionId)
        let document = try store.open(mode: .tutor, tutorProblem: first, tutorTitle: "Linear algebra")
        let pendingInk = fixtureDrawing(color: .blue, width: 5)
        let next = try XCTUnwrap(store.followTutorProblem(from: document, drawing: pendingInk, in: assistantFixture(current: second, earlier: [first])))
        XCTAssertEqual(next.tutorProblem, second)
        XCTAssertNotEqual(next.id, document.id)
        XCTAssertTrue(try store.drawing(for: next).strokes.isEmpty)
        let restored = DocumentStore(directory: directory)
        let earlier = try restored.open(mode: .tutor, tutorProblem: first, tutorTitle: "Different display title")
        XCTAssertEqual(earlier.id, document.id)
        XCTAssertEqual(earlier.tutorTitle, "Linear algebra", "Reopening must preserve the original session metadata")
        let ink = try restored.drawing(for: earlier)
        XCTAssertEqual(ink.strokes.count, 1)
        XCTAssertEqual(ink.strokes[0].ink.color, pendingInk.strokes[0].ink.color)
        XCTAssertEqual(restored.documents.count, 2)
        XCTAssertTrue(restored.attempts.isEmpty, "Following a prompt must not submit or evaluate work")
    }

    @MainActor
    func testTutorHintsAndOtherConversationsDoNotAdvanceOrRebindWork() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let problem = tutorFixture()
        let document = try store.open(mode: .tutor, tutorProblem: problem, tutorTitle: "Original tutor")
        let other = tutorFixture()
        let indexURL = directory.appendingPathComponent("index.json")
        let before = try Data(contentsOf: indexURL)
        XCTAssertNil(try store.followTutorProblem(from: document, drawing: fixtureDrawing(), in: assistantFixture(current: problem)))
        XCTAssertNil(try store.followTutorProblem(from: document, drawing: fixtureDrawing(), in: assistantFixture(current: other)))
        XCTAssertEqual(try Data(contentsOf: indexURL), before)
        XCTAssertEqual(store.documents.count, 1)
        var rebound = document
        rebound.tutorProblem = other
        rebound.handoffId = other.sessionId
        XCTAssertThrowsError(try store.save(rebound, drawing: fixtureDrawing()))
        rebound = document
        rebound.handoffId = other.sessionId
        XCTAssertThrowsError(try store.save(rebound, drawing: fixtureDrawing()))
        XCTAssertThrowsError(try store.submit(rebound, drawing: fixtureDrawing()))
        XCTAssertEqual(try Data(contentsOf: indexURL), before)
        XCTAssertTrue(store.attempts.isEmpty)
        XCTAssertTrue(try store.drawing(for: document).strokes.isEmpty)
    }

    @MainActor
    func testTutorFollowStopsOnSaveFailureWithoutOpeningTheNextSheet() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var failWrite = false
        let store = DocumentStore(directory: directory, writeIndex: { data, url in
            if failWrite { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
        })
        let first = tutorFixture()
        let second = tutorFixture(sessionId: first.sessionId)
        let current = try store.open(mode: .tutor, tutorProblem: first, tutorTitle: "Linear algebra")
        let indexURL = directory.appendingPathComponent("index.json")
        let before = try Data(contentsOf: indexURL)
        failWrite = true
        XCTAssertThrowsError(try store.followTutorProblem(from: current, drawing: fixtureDrawing(), in: assistantFixture(current: second, earlier: [first])))
        XCTAssertEqual(store.documents.map(\.id), [current.id])
        XCTAssertEqual(try Data(contentsOf: indexURL), before)
        XCTAssertFalse(store.documents.contains { $0.tutorProblem?.id == second.id })
        XCTAssertTrue(store.attempts.isEmpty)
    }

    @MainActor
    func testTutorSessionFrontsCacheOfflineAndAnEndedSessionStaysEnded() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let problem = tutorFixture(kind: "note")
        let session = assistantFixture(current: problem)
        try store.cacheTutorSession(session)
        let recovered = try XCTUnwrap(DocumentStore(directory: directory).cachedTutorSession())
        XCTAssertEqual(recovered.currentTutorProblem, problem)
        XCTAssertEqual(recovered.tutorTitle, "Linear algebra")
        let document = try store.open(mode: .tutor, tutorProblem: problem, tutorTitle: recovered.tutorTitle)
        _ = try store.save(document, drawing: fixtureDrawing())
        var invalid = session
        invalid.currentProblemId = UUID().uuidString.lowercased()
        XCTAssertThrowsError(try store.cacheTutorSession(invalid))
        XCTAssertEqual(store.cachedTutorSession()?.currentTutorProblem, problem)
        let generic = StudySession(version: 1, installationId: "synthetic-mac", mode: "tutor", handoffId: UUID().uuidString.lowercased(), currentQuestionId: nil, questions: [], target: "clipboard")
        try store.cacheTutorSession(try XCTUnwrap(generic.tutorFrontCache))
        XCTAssertNil(DocumentStore(directory: directory).cachedTutorSession()?.currentTutorProblem, "Switching to the generic receiver must not revive the prior assistant prompt offline")
        let ended = StudySession(version: 1, installationId: "synthetic-mac", mode: "idle", handoffId: nil, currentQuestionId: nil, questions: [])
        try store.cacheTutorSession(ended)
        let afterEnd = DocumentStore(directory: directory)
        XCTAssertNil(afterEnd.cachedTutorSession()?.currentTutorProblem)
        XCTAssertEqual(afterEnd.documents.first?.tutorProblem, problem, "Ending the desk session must keep saved/offline working recoverable")
        XCTAssertEqual(try afterEnd.drawing(for: try XCTUnwrap(afterEnd.documents.first)).strokes.count, 1)
    }

    @MainActor
    func testGenericTutorWorkspaceDoesNotReuseOrRenameABoundSheet() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let problem = tutorFixture()
        let bound = try store.open(mode: .tutor, tutorProblem: problem, tutorTitle: "Linear algebra")
        _ = try store.save(bound, drawing: fixtureDrawing())
        let generic = try store.openTutorWorkspace()
        XCTAssertNil(generic.tutorProblem)
        XCTAssertEqual(generic.title, "Tutor sheet")
        XCTAssertEqual(generic.destination, "clipboard")
        XCTAssertNotEqual(generic.id, bound.id)
        XCTAssertEqual(try store.openTutorWorkspace().id, generic.id)
        XCTAssertEqual(store.documents.count, 2)
        XCTAssertEqual(store.documents.first { $0.id == bound.id }?.tutorProblem, problem)
    }

    @MainActor
    func testBoundTutorEditorShowsSessionAndExplicitTutorSubmission() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let document = try store.open(mode: .tutor, tutorProblem: tutorFixture(), tutorTitle: "Linear algebra")
        let host = UIHostingController(rootView: PaperEditor(initialDocument: document).environmentObject(store).environmentObject(BridgeClient()))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1024, height: 768))
        defer { window.isHidden = true; window.rootViewController = nil }
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(300))
        let text = try renderedText(in: host.view)
        XCTAssertTrue(text.contains("SEND TO TUTOR"), "Bound work must return to its tutor session. Rendered: \(text)")
        XCTAssertTrue(text.contains("LINEAR ALGEBRA"))
        XCTAssertFalse(text.contains("SEND FOR FEEDBACK"))
        XCTAssertFalse(text.contains("CODEX"))
        XCTAssertFalse(text.contains("CHATGPT"))
        XCTAssertEqual(store.documents.count, 1)
        XCTAssertTrue(store.attempts.isEmpty)
    }

    @MainActor
    func testPromptLayoutPreservesCanvasPendingInkAndNativeUndo() async throws {
        let original = fixtureDrawing()
        let state = PromptCanvasTestState(drawing: original)
        var changes = 0
        let host = UIHostingController(rootView: PromptCanvasTestView(state: state, onChanged: { changes += 1 }))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1024, height: 768)
        defer { window.isHidden = true; window.rootViewController = nil }
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let canvas = try XCTUnwrap(findCanvas(in: host.view))
        let coordinator = try XCTUnwrap(canvas.delegate as? PaperCanvas.Coordinator)
        let undoManager = try XCTUnwrap(canvas.undoManager)
        let initialCanvasHeight = canvas.bounds.height
        XCTAssertEqual(canvas.drawing, original)

        // Reproduce the interval before PencilKit's drawing callback: the canvas
        // has newer ink while the editor's SwiftUI binding still holds the saved drawing.
        let pending = PKDrawing(strokes: original.strokes + fixtureDrawing(color: .blue, width: 5).strokes)
        canvas.delegate = nil
        canvas.drawing = pending
        undoManager.removeAllActions()
        undoManager.beginUndoGrouping()
        undoManager.registerUndo(withTarget: canvas) { target in
            let redoDrawing = target.drawing
            target.drawing = original
            target.undoManager?.registerUndo(withTarget: target) { redoTarget in redoTarget.drawing = redoDrawing }
        }
        undoManager.endUndoGrouping()
        XCTAssertTrue(undoManager.canUndo)

        // Drive the public binding used by the real prompt component. SwiftUI's
        // AX elements are not vended inside an in-process UIHostingController test.
        state.expanded = false
        try await Task.sleep(for: .milliseconds(150))
        host.view.layoutIfNeeded()
        XCTAssertTrue(findCanvas(in: host.view) === canvas, "Collapsing the prompt must not remount PencilKit")
        XCTAssertGreaterThan(canvas.bounds.height, initialCanvasHeight + 80, "Collapsing the prompt must give the working more room")
        XCTAssertEqual(canvas.drawing.dataRepresentation(), pending.dataRepresentation(), "A prompt refresh must not overwrite ink awaiting its callback")
        XCTAssertTrue(canvas.undoManager === undoManager)
        XCTAssertTrue(undoManager.canUndo, "The existing undo stack must survive prompt layout changes")

        state.expanded = true
        try await Task.sleep(for: .milliseconds(150))
        host.view.layoutIfNeeded()
        XCTAssertTrue(findCanvas(in: host.view) === canvas)
        XCTAssertEqual(canvas.bounds.height, initialCanvasHeight, accuracy: 1)
        XCTAssertEqual(canvas.drawing.dataRepresentation(), pending.dataRepresentation())
        XCTAssertEqual(state.drawing, original, "Layout alone must not rewrite the editor's drawing binding")
        XCTAssertEqual(changes, 0, "Showing or hiding a prompt must not become a Pencil edit")

        // Complete the delayed callback, then exercise the same native canvas
        // commands used by the toolbar against its retained undo group.
        canvas.delegate = coordinator
        coordinator.canvasViewDrawingDidChange(canvas)
        XCTAssertEqual(state.drawing, pending)
        XCTAssertEqual(changes, 1)
        state.command = .init(id: UUID(), undo: true)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(findCanvas(in: host.view) === canvas)
        XCTAssertEqual(canvas.drawing, original)
        XCTAssertTrue(undoManager.canRedo)
        state.command = .init(id: UUID(), undo: false)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(canvas.drawing, pending)

        window.frame = CGRect(x: 0, y: 0, width: 320, height: 800)
        host.traitOverrides.horizontalSizeClass = .compact
        host.view.frame = window.bounds
        state.expanded = false
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(findCanvas(in: host.view) === canvas, "A compact collapsed prompt must keep the existing PencilKit view")
        XCTAssertGreaterThanOrEqual(canvas.bounds.height, 400, "Collapsing the compact prompt must leave ample writing space")
        XCTAssertEqual(canvas.drawing, pending)
    }

    @MainActor
    func testCompactEditorKeepsSendControlsVisibleForEveryMode() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let question = QuestionPackage(id: "compact-question", cardId: "compact-card", title: "Explain a derivative", prompt: "<p>What does a derivative measure?</p>", topic: "Mathematics", kind: "concept", referenceHash: "synthetic-front-reference")
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let configurations: [(mode: PaperMode, bound: Bool, expectedSend: String)] = [(.study, false, "SEND FOR FEEDBACK"), (.tutor, true, "SEND TO TUTOR"), (.tutor, false, "SEND TO MAC")]

        for appearance in [UIUserInterfaceStyle.light, .dark] {
            for configuration in configurations {
                let store = DocumentStore(directory: directory.appendingPathComponent(UUID().uuidString))
                var document = try store.open(mode: configuration.mode, question: configuration.mode == .study ? question : nil, tutorProblem: configuration.bound ? tutorFixture() : nil, tutorTitle: configuration.bound ? "Linear algebra" : nil)
                document = try store.save(document, drawing: fixtureDrawing())
                let host = UIHostingController(rootView: PaperEditor(initialDocument: document).environmentObject(store).environmentObject(BridgeClient()))
                // A real 320-point iPad split view has compact horizontal traits.
                // Resizing a unit-test UIWindow alone retains the device's regular trait.
                host.traitOverrides.horizontalSizeClass = .compact
                let window = UIWindow(windowScene: scene)
                window.frame = CGRect(x: 0, y: 0, width: 320, height: 800)
                window.overrideUserInterfaceStyle = appearance
                host.overrideUserInterfaceStyle = appearance
                window.rootViewController = host
                window.makeKeyAndVisible()
                host.view.frame = window.bounds
                host.view.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(250))
                let attachment = XCTAttachment(image: canvasSnapshot(host.view))
                attachment.name = "Compact editor \(configuration.expectedSend) \(appearance == .dark ? "dark" : "light")"
                attachment.lifetime = .keepAlways
                add(attachment)
                let text = try renderedText(in: host.view)
                XCTAssertTrue(text.contains(configuration.expectedSend), "The full send label must remain visible at split-view width in both appearances. Rendered: \(text)")
                let canvas = try XCTUnwrap(findCanvas(in: host.view))
                XCTAssertGreaterThanOrEqual(canvas.bounds.height, 300, "Compact writing needs a useful sheet while reading the expanded prompt")
                XCTAssertTrue(store.attempts.isEmpty, "Layout verification must not send the synthetic work")
                XCTAssertEqual(store.documents.first?.revision, document.revision, "Resizing the editor must not create a phantom edit")
                window.isHidden = true
                window.rootViewController = nil
            }
        }
    }

    @MainActor
    func testSheetDeletionConfirmationIsCenteredAndReadableInLightPortrait() async throws {
        try await assertDeletionConfirmation(size: CGSize(width: 820, height: 1180), appearance: .light)
    }

    @MainActor
    func testSheetDeletionConfirmationIsCenteredAndReadableInDarkPortrait() async throws {
        try await assertDeletionConfirmation(size: CGSize(width: 820, height: 1180), appearance: .dark)
    }

    @MainActor
    func testSheetDeletionConfirmationIsCenteredAndReadableInLightLandscape() async throws {
        try await assertDeletionConfirmation(size: CGSize(width: 1180, height: 820), appearance: .light)
    }

    @MainActor
    func testSheetDeletionConfirmationIsCenteredAndReadableInDarkLandscape() async throws {
        try await assertDeletionConfirmation(size: CGSize(width: 1180, height: 820), appearance: .dark)
    }

    @MainActor
    func testOfflineDeletionRemovesRenderedRecentRowAndKeepsOtherWork() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var kept = try store.open(mode: .tutor)
        kept.title = "KEEP TARGET SHEET"
        let keptAttempt = try store.submit(kept, drawing: fixtureDrawing())
        var deleted = try store.open(mode: .tutor)
        deleted.title = "DELETE TARGET SHEET"
        _ = try store.submit(deleted, drawing: fixtureDrawing())
        let bridge = BridgeClient() // No connection activation is needed to delete local work.
        let host = UIHostingController(rootView: HomeView().environmentObject(store).environmentObject(bridge))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1024, height: 1366)
        defer { window.isHidden = true; window.rootViewController = nil }
        window.rootViewController = host
        window.overrideUserInterfaceStyle = .light
        host.overrideUserInterfaceStyle = .light
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let scroll = try XCTUnwrap(findScrollView(in: host.view))
        scrollToBottom(scroll)
        try await Task.sleep(for: .milliseconds(150))
        let before = try renderedText(in: host.view)
        XCTAssertTrue(before.contains(deleted.title), "The synthetic deletion target must be visibly rendered before the action. Rendered: \(before)")
        XCTAssertTrue(before.contains(kept.title), "The retained synthetic sheet must be visibly rendered before the action. Rendered: \(before)")

        try bridge.deleteSheet(deleted, from: store)
        XCTAssertEqual(store.documents.map(\.id), [kept.id], "Deletion publishes the row change immediately")
        try await Task.sleep(for: .milliseconds(250))
        host.view.layoutIfNeeded()
        scrollToBottom(scroll)
        try await Task.sleep(for: .milliseconds(150))
        let after = try renderedText(in: host.view)
        XCTAssertFalse(after.contains(deleted.title), "Home must remove the visible target without reopening the app")
        XCTAssertTrue(after.contains(kept.title), "Other visible sheets must remain after deletion. Rendered: \(after)")
        XCTAssertEqual(store.attempts.map(\.id), [keptAttempt.id])
        XCTAssertThrowsError(try store.save(deleted, drawing: fixtureDrawing()))
        XCTAssertEqual(DocumentStore(directory: directory).documents.map(\.id), [kept.id])
    }

    @MainActor
    func testDeletingPopulatedSheetRemovesOnlyItsLocalWorkAndSurvivesReload() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let deleted = try store.open(mode: .tutor)
        let first = try store.submit(deleted, drawing: fixtureDrawing())
        let second = try store.submit(deleted, drawing: fixtureDrawing())
        try store.updateAttempt(first.id, state: .receivedOnMac)
        try store.updateAttempt(second.id, state: .needsAttention)
        _ = try store.pdf(for: first)
        let kept = try store.open(mode: .tutor)
        let keptAttempt = try store.submit(kept, drawing: fixtureDrawing())
        let keptDrawing = try Data(contentsOf: directory.appendingPathComponent(kept.id).appendingPathComponent("drawing.data"))
        let keptPage = try Data(contentsOf: store.pageURLs(for: keptAttempt)[0])
        let keptThumbnail = try Data(contentsOf: directory.appendingPathComponent(kept.id).appendingPathComponent("thumbnail.png"))

        try store.delete(deleted)
        XCTAssertEqual(store.documents.map(\.id), [kept.id])
        XCTAssertEqual(store.attempts.map(\.id), [keptAttempt.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(deleted.id).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.attemptURL(first.id).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.attemptURL(second.id).path))
        XCTAssertThrowsError(try store.save(deleted, drawing: fixtureDrawing()), "A delayed editor save must not resurrect deleted work")
        XCTAssertThrowsError(try store.submit(deleted, drawing: fixtureDrawing()))
        XCTAssertThrowsError(try store.pdf(for: first))
        try store.delete(deleted) // Safe repeat; no other work is affected.

        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertEqual(reload.documents.map(\.id), [kept.id])
        XCTAssertEqual(reload.attempts.map(\.id), [keptAttempt.id])
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent(kept.id).appendingPathComponent("drawing.data")), keptDrawing)
        XCTAssertEqual(try Data(contentsOf: reload.pageURLs(for: keptAttempt)[0]), keptPage)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent(kept.id).appendingPathComponent("thumbnail.png")), keptThumbnail)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(deleted.id).path))
    }

    @MainActor
    func testDeletePersistenceFailureKeepsIndexRecordsAndFiles() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var failWrite = false
        let store = DocumentStore(directory: directory, writeIndex: { data, url in
            if failWrite { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
        })
        let document = try store.open(mode: .tutor)
        let attempt = try store.submit(document, drawing: fixtureDrawing())
        let indexBefore = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        let pageBefore = try Data(contentsOf: store.pageURLs(for: attempt)[0])
        failWrite = true

        XCTAssertThrowsError(try store.delete(document))
        XCTAssertEqual(store.documents.map(\.id), [document.id])
        XCTAssertEqual(store.attempts.map(\.id), [attempt.id])
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBefore)
        XCTAssertEqual(try Data(contentsOf: store.pageURLs(for: attempt)[0]), pageBefore)
        XCTAssertEqual(try store.drawing(for: document).strokes.count, 1)
        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertEqual(reload.documents.map(\.id), [document.id])
        XCTAssertEqual(reload.attempts.map(\.id), [attempt.id])
    }

    @MainActor
    func testInterruptedDeleteCleanupUsesDurableTombstoneWithoutResurrection() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var failedAttemptId: String?
        let store = DocumentStore(directory: directory, removeItem: { url in
            if url.lastPathComponent == failedAttemptId { throw CocoaError(.fileWriteNoPermission) }
            try FileManager.default.removeItem(at: url)
        })
        let deleted = try store.open(mode: .tutor)
        let attempt = try store.submit(deleted, drawing: fixtureDrawing())
        let kept = try store.open(mode: .tutor)
        let keptAttempt = try store.submit(kept, drawing: fixtureDrawing())
        let keptPage = try Data(contentsOf: store.pageURLs(for: keptAttempt)[0])
        failedAttemptId = attempt.id

        try store.delete(deleted)
        XCTAssertNotNil(store.storageError)
        XCTAssertEqual(store.documents.map(\.id), [kept.id])
        XCTAssertEqual(store.attempts.map(\.id), [keptAttempt.id], "A deleted pending submission must not remain in the outbox")
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(deleted.id).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.attemptURL(attempt.id).path))
        let committed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("index.json"))) as? [String: Any])
        XCTAssertEqual((committed["deletions"] as? [[String: Any]])?.count, 1)

        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertEqual(reload.documents.map(\.id), [kept.id])
        XCTAssertEqual(reload.attempts.map(\.id), [keptAttempt.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.attemptURL(attempt.id).path))
        XCTAssertEqual(try Data(contentsOf: reload.pageURLs(for: keptAttempt)[0]), keptPage)
        let cleaned = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("index.json"))) as? [String: Any])
        XCTAssertEqual((cleaned["deletions"] as? [[String: Any]])?.count, 0)
    }

    @MainActor
    func testDeletionFailsClosedForUnreadableOrChangedIndex() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let document = try store.open(mode: .tutor)
        let attempt = try store.submit(document, drawing: fixtureDrawing())
        let page = try Data(contentsOf: store.pageURLs(for: attempt)[0])
        let corrupt = Data("not an index".utf8)
        try corrupt.write(to: directory.appendingPathComponent("index.json"))

        XCTAssertThrowsError(try store.delete(document), "A live store must not overwrite an index that became unreadable")
        let reload = DocumentStore(directory: directory)
        XCTAssertNotNil(reload.storageError)
        XCTAssertThrowsError(try reload.delete(document))
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), corrupt)
        XCTAssertEqual(try Data(contentsOf: store.pageURLs(for: attempt)[0]), page)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent(document.id).path))
    }

    @MainActor
    func testPersistedTraversalIdentifierIsRejectedWithoutRemovingOutsideWork() throws {
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let directory = parent.appendingPathComponent("store")
        defer { try? FileManager.default.removeItem(at: parent) }
        let store = DocumentStore(directory: directory)
        _ = try store.open(mode: .tutor)
        let outside = parent.appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        let marker = Data("other work".utf8)
        try marker.write(to: outside.appendingPathComponent("drawing.data"))
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var documents = try XCTUnwrap(index["documents"] as? [[String: Any]])
        documents[0]["id"] = "../outside"
        index["documents"] = documents
        let malformed = try JSONSerialization.data(withJSONObject: index)
        try malformed.write(to: indexURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let document = try decoder.decode(PaperDocument.self, from: JSONSerialization.data(withJSONObject: documents[0]))
        let reload = DocumentStore(directory: directory)

        XCTAssertNotNil(reload.storageError)
        XCTAssertThrowsError(try reload.delete(document))
        XCTAssertEqual(try Data(contentsOf: outside.appendingPathComponent("drawing.data")), marker)
        XCTAssertEqual(try Data(contentsOf: indexURL), malformed)
    }

    @MainActor
    func testLinkedSheetFolderCannotDeleteOtherSheet() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let linked = try store.open(mode: .tutor)
        let kept = try store.open(mode: .tutor)
        let keptAttempt = try store.submit(kept, drawing: fixtureDrawing())
        let keptPage = try Data(contentsOf: store.pageURLs(for: keptAttempt)[0])
        let linkedURL = directory.appendingPathComponent(linked.id)
        try FileManager.default.removeItem(at: linkedURL)
        try FileManager.default.createSymbolicLink(at: linkedURL, withDestinationURL: directory.appendingPathComponent(kept.id))
        let indexBefore = try Data(contentsOf: directory.appendingPathComponent("index.json"))

        XCTAssertThrowsError(try store.delete(linked))
        XCTAssertEqual(store.documents.count, 2)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBefore)
        XCTAssertEqual(try Data(contentsOf: store.pageURLs(for: keptAttempt)[0]), keptPage)
        XCTAssertEqual(try store.drawing(for: kept).strokes.count, 1)
    }

    @MainActor
    func testLegacyIndexWithoutDeletionFieldStillLoads() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let document = try store.open(mode: .tutor)
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        index.removeValue(forKey: "deletions")
        try JSONSerialization.data(withJSONObject: index).write(to: indexURL)
        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertEqual(reload.documents.map(\.id), [document.id])
        try reload.delete(reload.documents[0])
        XCTAssertTrue(DocumentStore(directory: directory).documents.isEmpty)
    }

    @MainActor
    func testNewGenericTutorSubmissionPreservesEarlierTargetsAndRetries() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var document = try store.open(mode: .tutor)
        document.title = "My existing tutor working"
        document.destination = "chatgpt"
        let chatgpt = try store.submit(document, drawing: fixtureDrawing())
        document.destination = "codex"
        let codex = try store.submit(document, drawing: fixtureDrawing())
        try rewriteLegacyAttemptTargets(in: directory, targets: [chatgpt.id: "chatgpt", codex.id: "codex"])
        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        let existing = try reload.openTutorWorkspace()
        let oldPage = try Data(contentsOf: reload.pageURLs(for: chatgpt)[0])
        let generic = try reload.submit(existing, drawing: fixtureDrawing())
        XCTAssertEqual(generic.destination, "clipboard")
        XCTAssertEqual(generic.deliveryTarget, "clipboard")
        XCTAssertEqual(generic.documentId, existing.id)
        XCTAssertEqual(reload.documents.first?.title, "My existing tutor working")
        XCTAssertEqual(reload.documents.first?.destination, "codex", "Sending a new revision must not rewrite the old sheet’s metadata")
        try reload.updateAttempt(chatgpt.id, state: .needsAttention)
        try reload.retry(chatgpt.id)
        let first = try XCTUnwrap(reload.attempts.first { $0.id == chatgpt.id })
        let second = try XCTUnwrap(reload.attempts.first { $0.id == codex.id })
        XCTAssertEqual(first.deliveryTarget, "chatgpt")
        XCTAssertEqual(first.destination, "chatgpt")
        XCTAssertEqual(first.state, .waitingForMac)
        XCTAssertEqual(second.deliveryTarget, "codex")
        XCTAssertEqual(second.destination, "codex")
        XCTAssertEqual(first.pages.map(\.sha256), chatgpt.pages.map(\.sha256))
        XCTAssertEqual(second.pages.map(\.sha256), codex.pages.map(\.sha256))
        XCTAssertEqual(first.documentRevision, chatgpt.documentRevision)
        XCTAssertEqual(second.documentRevision, codex.documentRevision)
        XCTAssertEqual(try Data(contentsOf: reload.pageURLs(for: first)[0]), oldPage)
        let recovered = DocumentStore(directory: directory)
        XCTAssertNil(recovered.storageError)
        XCTAssertEqual(recovered.documents.count, 1)
        XCTAssertEqual(recovered.attempts.count, 3)
        XCTAssertEqual(recovered.attempts.first { $0.id == generic.id }?.deliveryTarget, "clipboard")
        XCTAssertEqual(recovered.attempts.first { $0.id == chatgpt.id }?.deliveryTarget, "chatgpt")
        XCTAssertEqual(recovered.attempts.first { $0.id == codex.id }?.deliveryTarget, "codex")
    }

    @MainActor
    func testLegacyAttemptsNeverAcquireANewWireTargetDuringRetry() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let document = try store.open(mode: .tutor)
        let attempt = try store.submit(document, drawing: fixtureDrawing())
        try store.updateAttempt(attempt.id, state: .needsAttention)
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var attempts = try XCTUnwrap(index["attempts"] as? [[String: Any]])
        attempts[0].removeValue(forKey: "deliveryTarget")
        attempts[0]["destination"] = "chatgpt"
        index["attempts"] = attempts
        try JSONSerialization.data(withJSONObject: index).write(to: indexURL)

        let reload = DocumentStore(directory: directory)
        XCTAssertNil(reload.storageError)
        XCTAssertNil(reload.attempts.first?.deliveryTarget)
        XCTAssertEqual(reload.attempts.first?.destination, "chatgpt")
        try reload.retry(attempt.id)
        let retried = DocumentStore(directory: directory)
        XCTAssertNil(retried.storageError)
        XCTAssertNil(retried.attempts.first?.deliveryTarget, "A retry must not change an already-received manifest")
        XCTAssertEqual(retried.attempts.first?.state, .waitingForMac)
    }

    @MainActor
    func testTutorTargetValidationPrecedesSavingOrCreatingAttemptAssets() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var document = try store.open(mode: .tutor)
        let indexBefore = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        let invalidDestinations: [String?] = [nil, "unknown"]
        for destination in invalidDestinations {
            document.destination = destination
            XCTAssertThrowsError(try store.submit(document, drawing: fixtureDrawing()))
        }
        XCTAssertTrue(store.attempts.isEmpty)
        XCTAssertEqual(store.documents.first?.revision, 0)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBefore)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("attempts").path))
        XCTAssertTrue(try store.drawing(for: document).strokes.isEmpty)

        let study = try store.open(mode: .study)
        let studyAttempt = try store.submit(study, drawing: fixtureDrawing())
        XCTAssertNil(studyAttempt.deliveryTarget, "Recall Study must not target an external tutor")
    }

    @MainActor
    func testSessionCacheContainsOnlyQuestionFronts() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        let session = StudySession(version: 1, installationId: "mac", mode: "study", handoffId: "handoff", currentQuestionId: "question", questions: [QuestionPackage(id: "question", cardId: "card", title: "A question", prompt: "What is a derivative?", topic: "Math", kind: "concept", referenceHash: "hash")])
        try store.cacheSession(session)
        XCTAssertEqual(store.cachedSession()?.questions[0].prompt, session.questions[0].prompt)
        let json = try String(contentsOf: directory.appendingPathComponent("session.json"), encoding: .utf8)
        XCTAssertFalse(json.contains("answer"))
        XCTAssertFalse(json.contains("credential"))
        XCTAssertFalse(json.contains("schedule"))
    }


    func testNodeCertificateSPKIPinMatchesSecurityFramework() throws {
        // Public synthetic certificate generated by the actual Mac bridge.
        let der = try XCTUnwrap(Data(base64Encoded: "MIIBgjCCASmgAwIBAgIRAK1sSxsr3rgWMuRYAYVho1IwCgYIKoZIzj0EAwIwFTETMBEGA1UEAxMKUmVjYWxsIFBhZDAeFw0yNjEwMTAyMDE1MzlaFw0yNzEwMTAyMDIwMzlaMBUxEzARBgNVBAMTClJlY2FsbCBQYWQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQ0Aji2E2Y1b9X6CZnSHeDRpnrPBCqYrqLjeauwlkIj/eV5MknUWqHKnCHEMknUeuIDzK1ToOSBRDkhRVuP1yL+o1owWDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDAWBgNVHSUBAf8EDDAKBggrBgEFBQcDATAgBgNVHREEGTAXgglsb2NhbGhvc3SHBH8AAAGHBMCoAQIwCgYIKoZIzj0EAwIDRwAwRAIgcCQpgFMSPP3kLDB/0U0x4q/qgeSILbFvrdM68qcskDUCIGQjc6ghYJA78PtA1kTQBdMRFKyixPEPJZV9uKzK1qgo"))
        let certificate = try XCTUnwrap(SecCertificateCreateWithData(nil, der as CFData))
        var trust: SecTrust?
        XCTAssertEqual(SecTrustCreateWithCertificates(certificate, SecPolicyCreateSSL(true, "192.168.1.2" as CFString), &trust), errSecSuccess)
        XCTAssertEqual(PublicKeyPin.fingerprint(of: try XCTUnwrap(trust)), "n7HkoiJbQGfqAGKqCjArh+pDxdnbjPx+K+/UDhTd7Jo=")
    }

    private func tutorFixture(sessionId: String = UUID().uuidString.lowercased(), kind: String = "problem") -> TutorProblem {
        TutorProblem(id: UUID().uuidString.lowercased(), sessionId: sessionId, revision: 1, title: "A tutor prompt", prompt: "<p>Explain your reasoning for \\(2x = 6\\).</p>", kind: kind, createdAt: "2026-01-01T00:00:00Z")
    }

    private func assistantFixture(current: TutorProblem, earlier: [TutorProblem] = []) -> StudySession {
        StudySession(version: 1, installationId: "synthetic-mac", mode: "tutor", handoffId: current.sessionId, currentQuestionId: nil, questions: [], target: "assistant", tutorTitle: "Linear algebra", currentProblemId: current.id, problems: earlier + [current])
    }

    private func rewriteLegacyAttemptTargets(in directory: URL, targets: [String: String]) throws {
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var attempts = try XCTUnwrap(index["attempts"] as? [[String: Any]])
        for position in attempts.indices {
            guard let id = attempts[position]["id"] as? String, let target = targets[id] else { continue }

            attempts[position]["destination"] = target
            attempts[position]["deliveryTarget"] = target
        }
        index["attempts"] = attempts
        try JSONSerialization.data(withJSONObject: index).write(to: indexURL)
    }

    private func fixtureDrawing(color: UIColor = .black, width: CGFloat = 3) -> PKDrawing {
        let points = [CGPoint(x: 40, y: 80), CGPoint(x: 120, y: 100), CGPoint(x: 200, y: 80)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: TimeInterval(index) * 0.1, size: CGSize(width: width, height: width), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: color), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
    }

    @MainActor
    private func assertDeletionConfirmation(size: CGSize, appearance: UIUserInterfaceStyle, file: StaticString = #filePath, line: UInt = #line) async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DocumentStore(directory: directory)
        var document = try store.open(mode: .tutor)
        document.title = "LINEAR ALGEBRA NOTES"
        document = try store.save(document, drawing: fixtureDrawing())
        let attempt = try store.submit(document, drawing: fixtureDrawing())
        let indexURL = directory.appendingPathComponent("index.json")
        let drawingURL = directory.appendingPathComponent(document.id).appendingPathComponent("drawing.data")
        let beforeIndex = try Data(contentsOf: indexURL)
        let beforeDrawing = try Data(contentsOf: drawingURL)
        let beforePage = try Data(contentsOf: try XCTUnwrap(store.pageURLs(for: attempt).first))
        var cancelCalls = 0
        var deleteCalls = 0
        let confirmation = SheetDeletionConfirmation(document: document, onCancel: { cancelCalls += 1 }, onDelete: { deleteCalls += 1 })
            .environment(\.colorScheme, appearance == .dark ? .dark : .light)
        let host = UIHostingController(rootView: confirmation)
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        defer { window.isHidden = true; window.rootViewController = nil }
        window.overrideUserInterfaceStyle = appearance
        host.overrideUserInterfaceStyle = appearance
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = CGRect(origin: .zero, size: size)
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))

        let image = canvasSnapshot(host.view)
        let attachment = XCTAttachment(image: image)
        attachment.name = "Deletion confirmation \(appearance == .dark ? "dark" : "light") \(size.width < size.height ? "portrait" : "landscape")"
        add(attachment)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: try XCTUnwrap(image.cgImage), options: [:]).perform([request])
        let rendered = (request.results ?? []).compactMap { observation -> (text: String, bounds: CGRect, confidence: VNConfidence)? in
            guard let candidate = observation.topCandidates(1).first else { return nil }

            return (candidate.string.uppercased(), observation.boundingBox, candidate.confidence)
        }
        let allText = rendered.map(\.text).joined(separator: " ")
        let title = try XCTUnwrap(rendered.first { $0.text.contains("DELETE THIS SHEET") }, "The full confirmation title must be visible. Rendered: \(allText)", file: file, line: line)
        let sheet = try XCTUnwrap(rendered.first { $0.text.contains(document.title) }, "The exact target sheet must be visibly named. Rendered: \(allText)", file: file, line: line)
        let cancel = try XCTUnwrap(rendered.first { $0.text == "CANCEL" }, "Cancel must be readable. Rendered: \(allText)", file: file, line: line)
        let delete = try XCTUnwrap(rendered.first { $0.text == "DELETE SHEET" }, "The destructive action must be readable. Rendered: \(allText)", file: file, line: line)
        let controls = [title, sheet, cancel, delete]
        let cluster = controls.reduce(CGRect.null) { $0.union($1.bounds) }

        XCTAssertEqual(host.view.bounds.width, size.width, accuracy: 1, file: file, line: line)
        XCTAssertEqual(host.view.bounds.height, size.height, accuracy: 1, file: file, line: line)
        XCTAssertEqual(cluster.midX, 0.5, accuracy: 0.12, "The visible dialog must be horizontally centered", file: file, line: line)
        XCTAssertEqual(cluster.midY, 0.5, accuracy: 0.16, "The title and both actions must be near the center, never a top-anchored pill", file: file, line: line)
        XCTAssertGreaterThan(1 - title.bounds.maxY, 0.2, "The confirmation title must not be attached to the top edge", file: file, line: line)
        for control in controls {
            XCTAssertGreaterThan(control.confidence, 0.4, "The visible \(control.text) label must retain readable contrast", file: file, line: line)
            XCTAssertGreaterThan(control.bounds.minX, 0.05, file: file, line: line)
            XCTAssertLessThan(control.bounds.maxX, 0.95, file: file, line: line)
            XCTAssertGreaterThan(control.bounds.minY, 0.05, file: file, line: line)
            XCTAssertLessThan(control.bounds.maxY, 0.95, file: file, line: line)
        }
        XCTAssertEqual(cancelCalls, 0, "Presenting the confirmation must not imply cancellation or deletion", file: file, line: line)
        XCTAssertEqual(deleteCalls, 0, file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: indexURL), beforeIndex, file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: drawingURL), beforeDrawing, file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: try XCTUnwrap(store.pageURLs(for: attempt).first)), beforePage, file: file, line: line)
        XCTAssertEqual(store.documents.map(\.id), [document.id], file: file, line: line)
        XCTAssertEqual(store.attempts.map(\.id), [attempt.id], file: file, line: line)
    }

    @MainActor
    private func renderedText(in view: UIView) throws -> String {
        view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(size: view.bounds.size).image { _ in
            XCTAssertTrue(view.drawHierarchy(in: view.bounds, afterScreenUpdates: true))
        }
        add(XCTAttachment(image: image))
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        let pixels = try XCTUnwrap(image.cgImage)
        try VNImageRequestHandler(cgImage: pixels, options: [:]).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ").uppercased()
    }

    @MainActor
    private func scrollToBottom(_ view: UIScrollView) {
        view.layoutIfNeeded()
        view.setContentOffset(CGPoint(x: view.contentOffset.x, y: max(-view.adjustedContentInset.top, view.contentSize.height - view.bounds.height + view.adjustedContentInset.bottom)), animated: false)
        view.layoutIfNeeded()
    }

    @MainActor
    private func findScrollView(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView { return scroll }
        for child in view.subviews {
            if let scroll = findScrollView(in: child) { return scroll }
        }
        return nil
    }

    @MainActor
    private func findCanvas(in view: UIView) -> PKCanvasView? {
        if let canvas = view as? PKCanvasView { return canvas }
        for child in view.subviews {
            if let canvas = findCanvas(in: child) { return canvas }
        }
        return nil
    }

    private func darkPixelCount(_ image: UIImage) -> Int {
        pixelCount(image) { $0 < 100 && $1 < 100 && $2 < 100 }
    }

    private func brightPixelCount(_ image: UIImage) -> Int {
        pixelCount(image) { $0 > 220 && $1 > 220 && $2 > 220 }
    }

    private func assertColorEqual(_ actual: UIColor, _ expected: UIColor, file: StaticString = #filePath, line: UInt = #line) {
        var actualRed: CGFloat = 0, actualGreen: CGFloat = 0, actualBlue: CGFloat = 0, actualAlpha: CGFloat = 0
        var expectedRed: CGFloat = 0, expectedGreen: CGFloat = 0, expectedBlue: CGFloat = 0, expectedAlpha: CGFloat = 0
        XCTAssertTrue(actual.getRed(&actualRed, green: &actualGreen, blue: &actualBlue, alpha: &actualAlpha), file: file, line: line)
        XCTAssertTrue(expected.getRed(&expectedRed, green: &expectedGreen, blue: &expectedBlue, alpha: &expectedAlpha), file: file, line: line)
        XCTAssertEqual(actualRed, expectedRed, accuracy: 0.005, file: file, line: line)
        XCTAssertEqual(actualGreen, expectedGreen, accuracy: 0.005, file: file, line: line)
        XCTAssertEqual(actualBlue, expectedBlue, accuracy: 0.005, file: file, line: line)
        XCTAssertEqual(actualAlpha, expectedAlpha, accuracy: 0.005, file: file, line: line)
    }

    private func chromaticPixelCount(_ image: UIImage) -> Int {
        pixelCount(image) { red, green, blue in
            let low = min(red, green, blue)
            let high = max(red, green, blue)
            return Int(high) - Int(low) > 40
        }
    }

    @MainActor
    private func canvasSnapshot(_ canvas: UIView) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        var image: UIImage!
        canvas.traitCollection.performAsCurrent {
            image = UIGraphicsImageRenderer(size: canvas.bounds.size, format: format).image { _ in
                canvas.drawHierarchy(in: CGRect(origin: .zero, size: canvas.bounds.size), afterScreenUpdates: true)
            }
        }
        return image
    }

    private func pixelCount(_ image: UIImage, matching: (UInt8, UInt8, UInt8) -> Bool) -> Int {
        guard let cgImage = image.cgImage else { return 0 }
        let width = cgImage.width
        let height = cgImage.height
        var pixels = [UInt8](repeating: 255, count: width * height * 4)
        pixels.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        return stride(from: 0, to: pixels.count, by: 4).filter { matching(pixels[$0], pixels[$0 + 1], pixels[$0 + 2]) }.count
    }
}

@MainActor
private final class PromptCanvasTestState: ObservableObject {
    @Published var drawing: PKDrawing
    @Published var height = 1800.0
    @Published var expanded = true
    @Published var command: PaperCanvas.CanvasCommand?

    init(drawing: PKDrawing) { self.drawing = drawing }
}

private struct PromptCanvasTestView: View {
    @ObservedObject var state: PromptCanvasTestState
    let onChanged: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            PaperPromptCard(html: "<p>Explain your reasoning for 2x = 6.</p>", mode: .tutor, expanded: $state.expanded)
            PaperCanvas(drawing: $state.drawing, height: $state.height, style: .squared, tool: .pen, onChanged: onChanged, command: state.command)
        }
    }
}

@MainActor
private final class NotebookToolbarTestDriver {
    var deleteObject: (String) -> Void = { _ in }
    var issueCommand: (PaperCanvas.CanvasCommand) -> Void = { _ in }
    var readShapes: () -> [NotebookShape] = { [] }
    var readDrawing: () -> PKDrawing = { PKDrawing() }
    var readSelection: () -> String? = { nil }
    var setTool: (NotebookDiagramTool) -> Void = { _ in }
    var readTool: () -> NotebookDiagramTool = { .select }
    var saveError: Error?

    func detach() {
        deleteObject = { _ in }
        issueCommand = { _ in }
        readShapes = { [] }
        readDrawing = { PKDrawing() }
        readSelection = { nil }
        setTool = { _ in }
        readTool = { .select }
    }
}

private struct NotebookToolbarTestView: View {
    @State private var page: PadNotebookPage
    @State private var drawing: PKDrawing
    @State private var shapes: [NotebookShape]
    @State private var selection: String?
    @State private var height = 1800.0
    @State private var command: PaperCanvas.CanvasCommand?
    @State private var diagramTool = NotebookDiagramTool.select
    let store: NotebookStore
    let driver: NotebookToolbarTestDriver

    init(page: PadNotebookPage, drawing: PKDrawing, shapes: [NotebookShape], store: NotebookStore, driver: NotebookToolbarTestDriver) {
        _page = State(initialValue: page)
        _drawing = State(initialValue: drawing)
        _shapes = State(initialValue: shapes)
        self.store = store
        self.driver = driver
    }

    var body: some View {
        VStack {
            PaperCanvas(drawing: $drawing, height: $height, style: .plain, tool: .pen, onChanged: save, command: command,
                shapes: $shapes, diagramTool: diagramTool, selectedShapeId: $selection, continuous: true,
                onDiagramToolChanged: { diagramTool = $0 })
            Text("\(shapes.count) objects").font(.title2).padding(12)
        }
        .onAppear {
            driver.deleteObject = { id in shapes.removeAll { $0.id == id }; selection = nil; save() }
            driver.issueCommand = { command = $0 }
            driver.readShapes = { shapes }
            driver.readDrawing = { drawing }
            driver.readSelection = { selection }
            driver.setTool = { diagramTool = $0 }
            driver.readTool = { diagramTool }
        }
        .onChange(of: shapes) { _, _ in save() }
        .onChange(of: drawing) { _, _ in save() }
    }

    private func save() {
        do { page = try store.savePage(page, drawing: drawing, style: .plain, canvasHeight: height, shapes: shapes) }
        catch { driver.saveError = error }
    }
}

/// Controlled native recognizer state exercises the target/action boundary
/// without pretending that an arbitration query is a physical pinch gesture.
private final class ControlledPinchGestureRecognizer: UIPinchGestureRecognizer {
    var reportedState = UIGestureRecognizer.State.possible
    override var state: UIGestureRecognizer.State {
        get { reportedState }
        set { reportedState = newValue }
    }
}

private final class FakeScannerCapture: ScannerCaptureDriving {
    let previewSession: AVCaptureSession? = AVCaptureSession()
    var onEvent: ((ScannerCaptureEvent) -> Void)?
    var onCode: ((String) -> Void)?
    var configureCount = 0
    var runningRequests: [Bool] = []
    var automaticallyConfigure = true
    var configurationResult: Result<Void, ScannerCameraError> = .success(())
    var configureCompletion: ((Result<Void, ScannerCameraError>) -> Void)?

    func configure(completion: @escaping (Result<Void, ScannerCameraError>) -> Void) {
        configureCount += 1
        configureCompletion = completion
        if automaticallyConfigure { completion(configurationResult) }
    }

    func setRunning(_ running: Bool) { runningRequests.append(running) }
}
