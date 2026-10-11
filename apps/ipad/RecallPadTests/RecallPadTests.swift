import XCTest
import PencilKit
import Security
import SwiftUI
import AVFoundation
import Vision
@testable import RecallPad

final class RecallPadTests: XCTestCase {
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
