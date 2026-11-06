import XCTest
import PencilKit
import UIKit
@testable import RecallPad

final class NotebookStoreTests: XCTestCase {
    @MainActor
    func testRotationAndCurveMetadataRemainAbsentInLegacyEncoding() throws {
        for kind in [NotebookShapeKind.rectangle, .ellipse, .diamond, .arrow, .text] {
            let legacy = NotebookShape(kind: kind, text: "A legacy label")
            let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
            let original = try encoder.encode(legacy)
            let dictionary = try XCTUnwrap(try JSONSerialization.jsonObject(with: original) as? [String: Any])
            XCTAssertNil(dictionary["rotation"])
            XCTAssertNil(dictionary["bend"])
            let decoded = try JSONDecoder().decode(NotebookShape.self, from: original)
            XCTAssertNil(decoded.rotation); XCTAssertNil(decoded.bend)
            XCTAssertEqual(try encoder.encode(decoded), original)
        }
    }

    @MainActor
    func testFourCornerResizeKeepsOppositeFixedInRotatedLocalAxes() throws {
        for angle in [0.0, Double.pi / 3, -Double.pi / 2] {
            let shape = NotebookShape(kind: .rectangle, x: 600, y: 700, width: 180, height: 120, rotation: angle == 0 ? nil : angle)
            for corner in NotebookResizeCorner.allCases {
                let opposite = try XCTUnwrap(NotebookShapeGeometry.corners(of: shape)[corner.opposite])
                let c = cos(angle), sinAngle = sin(angle), width = 270.0, height = 210.0
                let drag = CGPoint(x: opposite.x + c * width * corner.horizontalSign - sinAngle * height * corner.verticalSign,
                                   y: opposite.y + sinAngle * width * corner.horizontalSign + c * height * corner.verticalSign)
                let resized = NotebookShapeGeometry.resizing(shape, corner: corner, to: drag)
                try NotebookArtwork.validate(shapes: [resized])
                let after = try XCTUnwrap(NotebookShapeGeometry.corners(of: resized)[corner.opposite])
                XCTAssertEqual(after.x, opposite.x, accuracy: 0.000_001)
                XCTAssertEqual(after.y, opposite.y, accuracy: 0.000_001)
                XCTAssertEqual(resized.width, width, accuracy: 0.000_001)
                XCTAssertEqual(resized.height, height, accuracy: 0.000_001)
                XCTAssertEqual(resized.rotation, shape.rotation)
                let active = try XCTUnwrap(NotebookShapeGeometry.corners(of: resized)[corner])
                XCTAssertEqual(active.x, drag.x, accuracy: 0.000_001)
                XCTAssertEqual(active.y, drag.y, accuracy: 0.000_001)
            }
        }
        let labeled = NotebookShape(kind: .rectangle, x: 4600, y: 8000, width: 300, height: 120,
            text: "A label must remain complete when a rotated corner is made narrower.", rotation: .pi / 4)
        let opposite = try XCTUnwrap(NotebookShapeGeometry.corners(of: labeled)[.bottomRight])
        let narrow = NotebookShapeGeometry.resizing(labeled, corner: .topLeft, to: opposite)
        let fixed = try XCTUnwrap(NotebookShapeGeometry.corners(of: narrow)[.bottomRight])
        XCTAssertEqual(fixed.x, opposite.x, accuracy: 0.000_001)
        XCTAssertEqual(fixed.y, opposite.y, accuracy: 0.000_001)
        XCTAssertGreaterThanOrEqual(narrow.height, NotebookShapeRenderer.requiredHeight(for: narrow))
        XCTAssertEqual(narrow.width, 24)
        XCTAssertGreaterThan(narrow.height, 120)
        try NotebookArtwork.validate(shapes: [narrow])
    }

    @MainActor
    func testConnectorCornerResizeScalesCurveProportionallyWithOppositeFixed() throws {
        var curved = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow), start: CGPoint(x: 600, y: 700), end: CGPoint(x: 1000, y: 900))
        curved = NotebookArrowGeometry.settingBend(of: curved, through: CGPoint(x: 760, y: 880))
        let flat = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .line), start: CGPoint(x: 600, y: 700), end: CGPoint(x: 1000, y: 700))
        for original in [curved, flat] {
            for corner in NotebookResizeCorner.allCases {
                let opposite = try XCTUnwrap(NotebookShapeGeometry.corners(of: original)[corner.opposite])
                let active = try XCTUnwrap(NotebookShapeGeometry.corners(of: original)[corner])
                let point = CGPoint(x: opposite.x + (active.x - opposite.x) * 1.5,
                                    y: opposite.y + (active.y - opposite.y) * 1.5)
                let result = NotebookShapeGeometry.resizing(original, corner: corner, to: point)
                try NotebookArtwork.validate(shapes: [result])
                let fixed = try XCTUnwrap(NotebookShapeGeometry.corners(of: result)[corner.opposite])
                XCTAssertEqual(fixed.x, opposite.x, accuracy: 0.000_001)
                XCTAssertEqual(fixed.y, opposite.y, accuracy: 0.000_001)
                let beforeStart = NotebookArrowGeometry.startPoint(of: original), beforeEnd = NotebookArrowGeometry.endPoint(of: original)
                let afterStart = NotebookArrowGeometry.startPoint(of: result), afterEnd = NotebookArrowGeometry.endPoint(of: result)
                XCTAssertEqual(afterEnd.x - afterStart.x, (beforeEnd.x - beforeStart.x) * 1.5, accuracy: 0.000_001)
                XCTAssertEqual(afterEnd.y - afterStart.y, (beforeEnd.y - beforeStart.y) * 1.5, accuracy: 0.000_001)
                XCTAssertEqual(result.bend ?? 0, (original.bend ?? 0) * 1.5, accuracy: 0.000_001)
            }
        }
    }

    @MainActor
    func testRotationTransformMatchesCornersLabelsAndPinnedArrowEndpoints() throws {
        for kind in [NotebookShapeKind.rectangle, .ellipse, .diamond, .text] {
            let shape = NotebookShape(kind: kind, x: 600, y: 700, width: 240, height: 140, text: "Rotated label")
            let rotated = NotebookShapeGeometry.rotating(shape, to: CGPoint(x: shape.frame.midX + 200, y: shape.frame.midY))
            XCTAssertEqual(try XCTUnwrap(rotated.rotation), .pi / 2, accuracy: 0.000_001)
            let local = CGPoint(x: 73, y: 41)
            let document = NotebookShapeGeometry.documentPoint(local, in: rotated)
            let roundtrip = NotebookShapeGeometry.localPoint(document, in: rotated)
            XCTAssertEqual(roundtrip.x, local.x, accuracy: 0.000_001)
            XCTAssertEqual(roundtrip.y, local.y, accuracy: 0.000_001)
            let bounds = try XCTUnwrap(NotebookArtwork.contentBounds(drawing: PKDrawing(), shapes: [rotated]))
            XCTAssertTrue(bounds.contains(NotebookShapeRenderer.documentLabelBounds(for: rotated)))
            let image = NotebookArtwork.render(drawing: PKDrawing(), shapes: [rotated], bounds: bounds.insetBy(dx: -20, dy: -20), scale: 1)
            XCTAssertGreaterThan(try coloredPixels(image), 100)
            if kind != .text {
                let binding = NotebookArrowBinding(targetId: shape.id, x: 1, y: 0.5)
                let point = try XCTUnwrap(NotebookArrowGeometry.bindingPoint(binding, in: [rotated]))
                XCTAssertEqual(point.x, rotated.frame.midX, accuracy: 0.000_001)
                XCTAssertEqual(point.y, rotated.frame.midY + rotated.width / 2, accuracy: 0.000_001)
                let snapped = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: point, in: [rotated], tolerance: 2))
                XCTAssertEqual(snapped.x, 1, accuracy: 0.000_001)
                XCTAssertEqual(snapped.y, 0.5, accuracy: 0.000_001)
            }
        }
    }

    @MainActor
    func testRotatedOvalAndDiamondInsideSnapUseLocalFacingPerimeter() throws {
        for kind in [NotebookShapeKind.rectangle, .ellipse, .diamond] {
            let shape = NotebookShape(kind: kind, x: 400, y: 500, width: 220, height: 140, rotation: -.pi / 3)
            let center = NotebookShapeGeometry.documentPoint(CGPoint(x: 110, y: 70), in: shape)
            let toward = NotebookShapeGeometry.documentPoint(CGPoint(x: 400, y: 70), in: shape)
            let binding = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: center, in: [shape], tolerance: 2, toward: toward))
            XCTAssertEqual(binding.x, 1, accuracy: 0.000_001)
            XCTAssertEqual(binding.y, 0.5, accuracy: 0.000_001)
            let expected = NotebookShapeGeometry.documentPoint(CGPoint(x: 220, y: 70), in: shape)
            let point = try XCTUnwrap(NotebookArrowGeometry.bindingPoint(binding, in: [shape]))
            XCTAssertEqual(point.x, expected.x, accuracy: 0.000_001)
            XCTAssertEqual(point.y, expected.y, accuracy: 0.000_001)
        }
    }

    @MainActor
    func testCurvedLinesAndArrowsPassThroughVisibleBendAndUseTrueExtrema() throws {
        for kind in [NotebookShapeKind.line, .arrow] {
            var shape = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: kind), start: CGPoint(x: 100, y: 500), end: CGPoint(x: 500, y: 500))
            shape = NotebookArrowGeometry.settingBend(of: shape, through: CGPoint(x: 350, y: 580))
            try NotebookArtwork.validate(shapes: [shape])
            XCTAssertEqual(try XCTUnwrap(shape.bend), 80, accuracy: 0.000_001)
            XCTAssertEqual(NotebookArrowGeometry.bendPoint(of: shape), CGPoint(x: 300, y: 580), "Only perpendicular displacement changes curvature")
            XCTAssertEqual(NotebookArrowGeometry.controlPoint(of: shape), CGPoint(x: 300, y: 660))
            XCTAssertEqual(shape.frame.maxY, 580, accuracy: 0.000_001)
            let shaft = NotebookShapeRenderer.shaftPath(for: shape).cgPath
            XCTAssertEqual(shaft.boundingBoxOfPath.maxY + shape.y, 580, accuracy: 0.000_001)
            let midpoint = CGPoint(x: 300 - shape.x, y: 580 - shape.y)
            let stroked = shaft.copy(strokingWithWidth: 8, lineCap: .round, lineJoin: .round, miterLimit: 2)
            XCTAssertTrue(stroked.contains(midpoint), "Export and selection path must meet the visible middle handle")
            XCTAssertFalse(stroked.contains(CGPoint(x: 300 - shape.x, y: 500 - shape.y)))
            if kind == .line { XCTAssertTrue(NotebookShapeRenderer.headPath(for: shape).isEmpty) }
            let moved = NotebookArrowGeometry.settingEndpoints(of: shape, start: CGPoint(x: 100, y: 900), end: CGPoint(x: 500, y: 1100))
            XCTAssertEqual(moved.bend, shape.bend)
            let start = NotebookArrowGeometry.startPoint(of: moved), end = NotebookArrowGeometry.endPoint(of: moved), control = NotebookArrowGeometry.controlPoint(of: moved)
            let middle = CGPoint(x: start.x / 4 + control.x / 2 + end.x / 4, y: start.y / 4 + control.y / 2 + end.y / 4)
            let visible = NotebookArrowGeometry.bendPoint(of: moved)
            XCTAssertEqual(middle.x, visible.x, accuracy: 0.000_001)
            XCTAssertEqual(middle.y, visible.y, accuracy: 0.000_001)
            XCTAssertEqual(try JSONDecoder().decode(NotebookShape.self, from: JSONEncoder().encode(moved)), moved)
        }
    }

    @MainActor
    func testFilledCurvedArrowFillsOnlyHeadWithTangentDirection() throws {
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow, lineWidth: 3, filled: true), start: CGPoint(x: 100, y: 200), end: CGPoint(x: 500, y: 200))
        arrow = NotebookArrowGeometry.settingBend(of: arrow, through: CGPoint(x: 300, y: 300))
        var points: [CGPoint] = []
        NotebookShapeRenderer.headPath(for: arrow).cgPath.applyWithBlock { element in
            if [.moveToPoint, .addLineToPoint].contains(element.pointee.type) { points.append(element.pointee.points[0]) }
        }
        XCTAssertEqual(points.count, 3)
        let base = CGPoint(x: (points[0].x + points[2].x) / 2, y: (points[0].y + points[2].y) / 2)
        let end = NotebookArrowGeometry.endPoint(of: arrow), control = NotebookArrowGeometry.controlPoint(of: arrow)
        let length = hypot(end.x - control.x, end.y - control.y)
        XCTAssertEqual(base.x + arrow.x, end.x - (end.x - control.x) / length * 24, accuracy: 0.000_001)
        XCTAssertEqual(base.y + arrow.y, end.y - (end.y - control.y) / length * 24, accuracy: 0.000_001)
        let image = NotebookArtwork.render(drawing: PKDrawing(), shapes: [arrow], bounds: CGRect(x: 0, y: 0, width: 600, height: 420), scale: 1)
        let pixels = try coloredPixels(image)
        XCTAssertGreaterThan(pixels, 700)
        XCTAssertLessThan(pixels, 4000, "Filling a closed curve wedge would color tens of thousands of pixels")
    }

    @MainActor
    func testRotationCurveAndLineSaveRecoveryKeepsQueuedSubmissionImmutable() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Transformed diagrams")
        var page = try store.createNoteForWriting(in: notebook)
        let box = NotebookShape(kind: .rectangle, x: 200, y: 400, width: 240, height: 120, text: "Capture", filled: true)
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow), start: CGPoint(x: 440, y: 460), end: CGPoint(x: 800, y: 460))
        arrow.startBinding = NotebookArrowBinding(targetId: box.id, x: 1, y: 0.5)
        page = try store.savePage(page, drawing: PKDrawing(), style: .plain, canvasHeight: 1800, shapes: [box, arrow])
        let queued = try store.prepareSubmission(try XCTUnwrap(store.notes.first))
        let oldImages = try store.pageURLs(for: queued).map { try Data(contentsOf: $0) }
        let oldArchive = try Data(contentsOf: store.drawingURLs(for: queued)[0])
        let rotated = NotebookShapeGeometry.rotating(box, radians: .pi / 3)
        arrow = NotebookArrowGeometry.settingBend(of: arrow, through: CGPoint(x: 620, y: 540))
        let line = NotebookArrowGeometry.settingBend(of: NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .line, text: "A curved connection"), start: CGPoint(x: 200, y: 3200), end: CGPoint(x: 700, y: 3400)), through: CGPoint(x: 450, y: 3430))
        let updated = NotebookArrowGeometry.resolvingBindings(in: [rotated, arrow, line])
        page = try store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: 1800, shapes: updated)
        let reopened = NotebookStore(directory: directory)
        XCTAssertEqual(try reopened.shapes(for: page), updated)
        let currentBytes = try Data(contentsOf: pageDrawingURL(page, in: reopened))
        let noOp = try reopened.savePage(page, drawing: PKDrawing(), style: page.paperStyle, canvasHeight: page.canvasHeight, shapes: updated)
        XCTAssertEqual(noOp.id, page.id); XCTAssertEqual(noOp.noteId, page.noteId)
        XCTAssertEqual(noOp.title, page.title); XCTAssertEqual(noOp.revision, page.revision)
        XCTAssertEqual(noOp.contentHash, page.contentHash); XCTAssertEqual(noOp.paperStyle, page.paperStyle)
        XCTAssertEqual(noOp.canvasHeight, page.canvasHeight)
        // The existing .iso8601 index encoding stores whole seconds. Reloading
        // must retain those exact seconds without rewriting artwork/revisions.
        XCTAssertEqual(noOp.createdAt.timeIntervalSince1970, floor(page.createdAt.timeIntervalSince1970))
        XCTAssertEqual(noOp.updatedAt.timeIntervalSince1970, floor(page.updatedAt.timeIntervalSince1970))
        XCTAssertEqual(try Data(contentsOf: pageDrawingURL(noOp, in: reopened)), currentBytes)
        let latest = try reopened.prepareSubmission(try XCTUnwrap(reopened.notes.first))
        XCTAssertGreaterThan(latest.pages.count, 1)
        XCTAssertNotEqual(latest.contentHash, queued.contentHash)
        for url in try reopened.pageURLs(for: latest) {
            XCTAssertGreaterThan(try coloredPixels(try XCTUnwrap(UIImage(contentsOfFile: url.path))), 80)
        }
        XCTAssertEqual(try reopened.pageURLs(for: queued).map { try Data(contentsOf: $0) }, oldImages)
        XCTAssertEqual(try Data(contentsOf: reopened.drawingURLs(for: queued)[0]), oldArchive)
        XCTAssertEqual(oldArchive.sha256, queued.drawings[0].hash)
    }

    @MainActor
    func testInvalidTransformMetadataCannotReplaceSavedWorkOrRecoverAsBlank() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let indexBefore = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        let original = NotebookShape(kind: .rectangle, x: 400, y: 500, text: "Keep my explanation")
        var cases: [NotebookShape] = []
        for angle in [Double.nan, .infinity, .pi * 2] { var shape = original; shape.rotation = angle; cases.append(shape) }
        for bend in [Double.nan, .infinity, 10_001] { var shape = NotebookShape(kind: .line); shape.bend = bend; cases.append(shape) }
        var misplaced = original; misplaced.bend = 20; cases.append(misplaced)
        var missingEndpoints = NotebookShape(kind: .line); missingEndpoints.bend = 20; cases.append(missingEndpoints)
        var invalidCurveFrame = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .line), start: CGPoint(x: 100, y: 500), end: CGPoint(x: 500, y: 500))
        invalidCurveFrame.bend = 100; cases.append(invalidCurveFrame)
        var connector = NotebookShape(kind: .arrow); connector.rotation = 0.2; cases.append(connector)
        let offPage = NotebookShape(kind: .rectangle, x: 0, y: 0, width: 220, height: 140, rotation: .pi / 4)
        cases.append(offPage)
        for invalid in cases {
            XCTAssertThrowsError(try NotebookArtwork.validate(shapes: [invalid]))
            XCTAssertThrowsError(try store.savePage(fixture.page, drawing: store.drawing(for: fixture.page), style: .plain, canvasHeight: 1800, shapes: [invalid]))
        }
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBefore)
        let saved = try store.savePage(fixture.page, drawing: store.drawing(for: fixture.page), style: .plain, canvasHeight: 1800, shapes: [original])
        let queued = try store.prepareSubmission(try XCTUnwrap(store.notes.first))
        let queuedBytes = try Data(contentsOf: store.drawingURLs(for: queued)[0])
        let file = pageDrawingURL(saved, in: store), marker = Data("RECALL_NOTEBOOK_ARTWORK_V1\0".utf8)
        var archive = try XCTUnwrap(try PropertyListSerialization.propertyList(from: Data(Data(contentsOf: file).dropFirst(marker.count)), options: [], format: nil) as? [String: Any])
        var rows = try XCTUnwrap(archive["shapes"] as? [[String: Any]])
        rows[0]["rotation"] = Double.nan; archive["shapes"] = rows
        let corrupt = marker + (try PropertyListSerialization.data(fromPropertyList: archive, format: .binary, options: 0))
        try corrupt.write(to: file, options: .atomic)
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var pages = try XCTUnwrap(index["pages"] as? [[String: Any]])
        let pageIndex = try XCTUnwrap(pages.firstIndex { $0["id"] as? String == saved.id })
        pages[pageIndex]["contentHash"] = corrupt.sha256; index["pages"] = pages
        try JSONSerialization.data(withJSONObject: index, options: .sortedKeys).write(to: indexURL, options: .atomic)
        let reopened = NotebookStore(directory: directory)
        XCTAssertThrowsError(try reopened.shapes(for: saved))
        XCTAssertThrowsError(try reopened.prepareSubmission(try XCTUnwrap(reopened.notes.first)))
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
        XCTAssertEqual(try Data(contentsOf: reopened.drawingURLs(for: queued)[0]), queuedBytes)
    }

    @MainActor
    func testResolvedBoundCurveOutsidePageRejectsSaveAndCorruptRecoveryWithoutLosingWork() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Resolved geometry")
        let page = try store.createNoteForWriting(in: notebook)
        var box = NotebookShape(kind: .rectangle, x: 200, y: 1000, width: 100, height: 100)
        var curve = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow), start: CGPoint(x: 300, y: 1050), end: CGPoint(x: 800, y: 1050))
        curve = NotebookArrowGeometry.settingBend(of: curve, through: CGPoint(x: 550, y: 1850))
        curve.startBinding = NotebookArrowBinding(targetId: box.id, x: 1, y: 0.5)
        let saved = try store.savePage(page, drawing: PKDrawing(), style: .plain, canvasHeight: 1800, shapes: [box, curve])
        let queued = try store.prepareSubmission(try XCTUnwrap(store.notes.first))
        let queuedArchive = try Data(contentsOf: store.drawingURLs(for: queued)[0])
        let queuedImages = try store.pageURLs(for: queued).map { try Data(contentsOf: $0) }
        let indexURL = directory.appendingPathComponent("index.json")
        let originalIndex = try Data(contentsOf: indexURL)
        let file = pageDrawingURL(saved, in: store)
        let originalArtwork = try Data(contentsOf: file)
        box.x = 9900; box.y = 0; box.width = 80
        XCTAssertTrue(box.isValid)
        XCTAssertTrue(curve.isValid, "Its cached endpoints still describe a valid curve")
        let resolved = try XCTUnwrap(NotebookArrowGeometry.resolvingBindings(in: [box, curve]).last)
        XCTAssertFalse(resolved.isValid, "Following the target bends part of the curve above the page")
        XCTAssertThrowsError(try NotebookArtwork.validate(shapes: [box, curve]))
        XCTAssertThrowsError(try store.savePage(saved, drawing: PKDrawing(), style: .plain, canvasHeight: 1800, shapes: [box, curve]))
        XCTAssertEqual(try Data(contentsOf: indexURL), originalIndex)
        XCTAssertEqual(try Data(contentsOf: file), originalArtwork)
        let marker = Data("RECALL_NOTEBOOK_ARTWORK_V1\0".utf8)
        var archive = try XCTUnwrap(try PropertyListSerialization.propertyList(from: Data(originalArtwork.dropFirst(marker.count)), options: [], format: nil) as? [String: Any])
        var rows = try XCTUnwrap(archive["shapes"] as? [[String: Any]])
        let position = try XCTUnwrap(rows.firstIndex { $0["id"] as? String == box.id })
        rows[position]["x"] = box.x; rows[position]["y"] = box.y; rows[position]["width"] = box.width
        archive["shapes"] = rows
        let corrupt = marker + (try PropertyListSerialization.data(fromPropertyList: archive, format: .binary, options: 0))
        try corrupt.write(to: file, options: .atomic)
        var index = try XCTUnwrap(try JSONSerialization.jsonObject(with: originalIndex) as? [String: Any])
        var pages = try XCTUnwrap(index["pages"] as? [[String: Any]])
        let pageIndex = try XCTUnwrap(pages.firstIndex { $0["id"] as? String == saved.id })
        pages[pageIndex]["contentHash"] = corrupt.sha256; index["pages"] = pages
        try JSONSerialization.data(withJSONObject: index, options: .sortedKeys).write(to: indexURL, options: .atomic)
        let reopened = NotebookStore(directory: directory)
        XCTAssertThrowsError(try reopened.shapes(for: saved))
        XCTAssertThrowsError(try reopened.prepareSubmission(try XCTUnwrap(reopened.notes.first)))
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
        XCTAssertEqual(try Data(contentsOf: reopened.drawingURLs(for: queued)[0]), queuedArchive)
        XCTAssertEqual(try reopened.pageURLs(for: queued).map { try Data(contentsOf: $0) }, queuedImages)
    }

    @MainActor
    func testLegacyFreeArrowsKeepCornerGeometryAndExactArchiveWithoutAutoBinding() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Legacy connectors")
        let page = try store.createNoteForWriting(in: notebook)
        let box = NotebookShape(kind: .rectangle, x: 100, y: 100, width: 200, height: 120)
        let legacy = NotebookShape(kind: .arrow, x: 120, y: 140, width: 180, height: 2, flippedX: true)
        let encoded = try JSONEncoder().encode(legacy)
        let dictionary = try XCTUnwrap(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertNil(dictionary["startBinding"])
        XCTAssertNil(dictionary["endBinding"])
        XCTAssertNil(dictionary["arrowStart"])
        XCTAssertNil(dictionary["rotation"])
        XCTAssertNil(dictionary["bend"])
        let decoded = try JSONDecoder().decode(NotebookShape.self, from: encoded)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: decoded), CGPoint(x: 300, y: 140))
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: decoded), CGPoint(x: 120, y: 142))
        XCTAssertEqual(NotebookArrowGeometry.resolvingBindings(in: [box, decoded]), [box, decoded])
        let saved = try store.savePage(page, drawing: PKDrawing(), style: .plain, canvasHeight: 1800, shapes: [box, decoded])
        let bytes = try Data(contentsOf: pageDrawingURL(saved, in: store))
        let reopened = NotebookStore(directory: directory)
        let restored = try reopened.shapes(for: saved)
        let noOp = try reopened.savePage(saved, drawing: reopened.drawing(for: saved), style: saved.paperStyle, canvasHeight: saved.canvasHeight, shapes: restored)
        XCTAssertEqual(restored, [box, legacy])
        XCTAssertEqual(noOp.revision, saved.revision)
        XCTAssertEqual(try Data(contentsOf: pageDrawingURL(noOp, in: reopened)), bytes)
    }

    @MainActor
    func testArrowSnappingUsesContainersInsideOrNearPerimeterAndTopmostTies() throws {
        let box = NotebookShape(kind: .rectangle, x: 100, y: 100, width: 200, height: 100)
        let inside = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 280, y: 150), in: [box], tolerance: 2))
        XCTAssertEqual(inside.targetId, box.id)
        XCTAssertEqual(inside.x, 1, accuracy: 0.000_001)
        XCTAssertEqual(inside.y, 0.5, accuracy: 0.000_001)
        XCTAssertEqual(NotebookArrowGeometry.bindingPoint(inside, in: [box]), CGPoint(x: 300, y: 150))
        XCTAssertNotNil(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 321, y: 150), in: [box], tolerance: 22))
        XCTAssertNil(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 323, y: 150), in: [box], tolerance: 22))
        XCTAssertNil(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 280, y: 150), in: [box], excludingId: box.id))
        var top = box; top.id = UUID().uuidString.lowercased()
        XCTAssertEqual(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 321, y: 150), in: [box, top], tolerance: 22)?.targetId, top.id)
        let text = NotebookShape(kind: .text, x: 100, y: 100, width: 200, height: 100, text: "Not a connector target")
        XCTAssertNil(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 280, y: 150), in: [text]))
        let oval = NotebookShape(kind: .ellipse, x: 500, y: 200, width: 220, height: 120)
        let ovalBinding = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 705, y: 260), in: [oval], tolerance: 1))
        XCTAssertNotNil(NotebookArrowGeometry.bindingPoint(ovalBinding, in: [oval]))
        let diamond = NotebookShape(kind: .diamond, x: 100, y: 350, width: 200, height: 160)
        let diamondBinding = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 250, y: 390), in: [diamond], tolerance: 22))
        XCTAssertNotNil(NotebookArrowGeometry.bindingPoint(diamondBinding, in: [diamond]))
        XCTAssertNil(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: CGFloat.nan, y: 20), in: [box]))
    }

    @MainActor
    func testInsideConnectorAnchorsFaceOtherBoxAndUseActualOvalAndDiamondPerimeters() throws {
        let left = NotebookShape(kind: .rectangle, x: 100, y: 100, width: 200, height: 100)
        let right = NotebookShape(kind: .rectangle, x: 500, y: 100, width: 200, height: 100)
        let start = CGPoint(x: 200, y: 150), end = CGPoint(x: 600, y: 150)
        let startBinding = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: start, in: [left, right], tolerance: 22, toward: end))
        let endBinding = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: end, in: [left, right], tolerance: 22, toward: start))
        XCTAssertEqual(NotebookArrowGeometry.bindingPoint(startBinding, in: [left, right]), CGPoint(x: 300, y: 150))
        XCTAssertEqual(NotebookArrowGeometry.bindingPoint(endBinding, in: [left, right]), CGPoint(x: 500, y: 150))
        let nearOutside = CGPoint(x: 321, y: 150)
        XCTAssertEqual(NotebookArrowGeometry.nearestBinding(to: nearOutside, in: [left], tolerance: 22, toward: CGPoint(x: 1000, y: 1000)),
                       NotebookArrowGeometry.nearestBinding(to: nearOutside, in: [left], tolerance: 22), "Directional aiming must not change outside near-edge snapping")
        let oval = NotebookShape(kind: .ellipse, x: 500, y: 200, width: 220, height: 120)
        let ovalBinding = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 610, y: 260), in: [oval], tolerance: 1, toward: CGPoint(x: 830, y: 380)))
        XCTAssertEqual(pow(ovalBinding.x * 2 - 1, 2) + pow(ovalBinding.y * 2 - 1, 2), 1, accuracy: 0.000_001)
        XCTAssertNotNil(NotebookArrowGeometry.bindingPoint(ovalBinding, in: [oval]))
        let diamond = NotebookShape(kind: .diamond, x: 100, y: 350, width: 200, height: 160)
        let diamondBinding = try XCTUnwrap(NotebookArrowGeometry.nearestBinding(to: CGPoint(x: 200, y: 430), in: [diamond], tolerance: 1, toward: CGPoint(x: 400, y: 590)))
        XCTAssertEqual(abs(diamondBinding.x * 2 - 1) + abs(diamondBinding.y * 2 - 1), 1, accuracy: 0.000_001)
        XCTAssertNotNil(NotebookArrowGeometry.bindingPoint(diamondBinding, in: [diamond]))
        XCTAssertNotNil(NotebookArrowGeometry.nearestBinding(to: start, in: [left], toward: start), "Coincident direction falls back to a safe nearest perimeter")
    }

    @MainActor
    func testExactHorizontalVerticalAndCoincidentArrowEndpointsRenderWithoutNaNs() throws {
        let base = NotebookShape(kind: .arrow, text: "Connection")
        let horizontal = NotebookArrowGeometry.settingEndpoints(of: base, start: CGPoint(x: 100, y: 200), end: CGPoint(x: 400, y: 200))
        let vertical = NotebookArrowGeometry.settingEndpoints(of: base, start: CGPoint(x: 400, y: 500), end: CGPoint(x: 400, y: 100))
        let coincident = NotebookArrowGeometry.settingEndpoints(of: base, start: CGPoint(x: 10_000, y: 1_000_000), end: CGPoint(x: 10_000, y: 1_000_000))
        XCTAssertTrue(horizontal.isValid)
        XCTAssertTrue(vertical.isValid)
        XCTAssertTrue(coincident.isValid)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: horizontal).y, NotebookArrowGeometry.endPoint(of: horizontal).y)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: vertical).x, NotebookArrowGeometry.endPoint(of: vertical).x)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: coincident), CGPoint(x: 10_000, y: 1_000_000))
        XCTAssertTrue(NotebookShapeRenderer.path(for: coincident).isEmpty)
        let image = NotebookArtwork.render(drawing: PKDrawing(), shapes: [horizontal, vertical], bounds: CGRect(x: 0, y: 0, width: 600, height: 650), scale: 1)
        XCTAssertGreaterThan(try coloredPixels(image), 400)
        let outOfBounds = NotebookArrowGeometry.settingEndpoints(of: base, start: CGPoint(x: -10, y: 100), end: CGPoint(x: 400, y: 100))
        XCTAssertFalse(outOfBounds.isValid)
    }

    @MainActor
    func testBoundEndpointsFollowEachMovedAndResizedTargetWithoutMovingFreeEndpoint() throws {
        var left = NotebookShape(kind: .rectangle, x: 100, y: 100, width: 120, height: 100)
        var right = NotebookShape(kind: .rectangle, x: 500, y: 100, width: 120, height: 100)
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow), start: CGPoint(x: 220, y: 150), end: CGPoint(x: 500, y: 150))
        arrow.startBinding = NotebookArrowBinding(targetId: left.id, x: 1, y: 0.5)
        arrow.endBinding = NotebookArrowBinding(targetId: right.id, x: 0, y: 0.5)
        left.x = 150; left.y = 180; left.width = 240; left.height = 180
        right.x = 700; right.y = 450; right.width = 220; right.height = 300
        let followed = try XCTUnwrap(NotebookArrowGeometry.resolvingBindings(in: [left, right, arrow]).last)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: followed), CGPoint(x: 390, y: 270))
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: followed), CGPoint(x: 700, y: 600))
        try NotebookArtwork.validate(shapes: [left, right, followed])
        arrow.endBinding = nil
        let partial = try XCTUnwrap(NotebookArrowGeometry.resolvingBindings(in: [left, right, arrow]).last)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: partial), CGPoint(x: 390, y: 270))
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: partial), CGPoint(x: 500, y: 150))
        XCTAssertEqual(partial.startBinding, arrow.startBinding)
        XCTAssertNil(partial.endBinding)
    }

    @MainActor
    func testDeletingTargetDetachesAtResolvedPointAndRemainingConnectionStillFollows() throws {
        var target = NotebookShape(kind: .rectangle, x: 100, y: 100, width: 120, height: 100)
        var other = NotebookShape(kind: .rectangle, x: 600, y: 100, width: 120, height: 100)
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow, text: "Keep the connector"), start: CGPoint(x: 220, y: 150), end: CGPoint(x: 600, y: 150))
        arrow.startBinding = NotebookArrowBinding(targetId: target.id, x: 1, y: 0.5)
        arrow.endBinding = NotebookArrowBinding(targetId: other.id, x: 0, y: 0.5)
        target.x = 200; target.y = 300
        let beforeDelete = [target, other, arrow]
        let detached = NotebookArrowGeometry.detachingBindings(to: target.id, in: beforeDelete).filter { $0.id != target.id }
        let connector = try XCTUnwrap(detached.last)
        XCTAssertNil(connector.startBinding)
        XCTAssertNotNil(connector.endBinding)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: connector), CGPoint(x: 320, y: 350))
        XCTAssertEqual(connector.text, "Keep the connector")
        other.y = 700
        let followed = try XCTUnwrap(NotebookArrowGeometry.resolvingBindings(in: [other, connector]).last)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: followed), CGPoint(x: 320, y: 350))
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: followed), CGPoint(x: 600, y: 750))
        try NotebookArtwork.validate(shapes: [other, followed])
        XCTAssertEqual(NotebookArrowGeometry.resolvingBindings(in: beforeDelete).last?.startBinding, arrow.startBinding, "An undo snapshot retains the original target relationship")
    }

    @MainActor
    func testMalformedArrowBindingsRejectSaveAndPreservePreviousWork() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let oldIndex = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        let box = NotebookShape(kind: .rectangle)
        var arrow = NotebookShape(kind: .arrow)
        func reject(_ shapes: [NotebookShape]) throws {
            XCTAssertThrowsError(try NotebookArtwork.validate(shapes: shapes))
            XCTAssertThrowsError(try store.savePage(fixture.page, drawing: store.drawing(for: fixture.page), style: .plain, canvasHeight: 1800, shapes: shapes))
        }
        arrow.startBinding = NotebookArrowBinding(targetId: UUID().uuidString.lowercased(), x: 1, y: 0.5)
        try reject([box, arrow])
        arrow.startBinding = NotebookArrowBinding(targetId: arrow.id, x: 1, y: 0.5)
        try reject([box, arrow])
        let text = NotebookShape(kind: .text, text: "A label")
        arrow.startBinding = NotebookArrowBinding(targetId: text.id, x: 1, y: 0.5)
        try reject([text, arrow])
        let otherArrow = NotebookShape(kind: .arrow)
        arrow.startBinding = NotebookArrowBinding(targetId: otherArrow.id, x: 1, y: 0.5)
        try reject([otherArrow, arrow])
        for point in [NotebookArrowPoint(x: 0.5, y: 0.5), NotebookArrowPoint(x: 1.1, y: 0.5), NotebookArrowPoint(x: .nan, y: 0.5)] {
            arrow.startBinding = NotebookArrowBinding(targetId: box.id, x: point.x, y: point.y)
            try reject([box, arrow])
        }
        arrow.startBinding = nil
        arrow.arrowStart = NotebookArrowPoint(x: 0, y: 0)
        try reject([box, arrow])
        var nonArrow = box
        nonArrow.startBinding = NotebookArrowBinding(targetId: box.id, x: 1, y: 0.5)
        try reject([nonArrow])
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), oldIndex)
        XCTAssertEqual(try store.drawing(for: fixture.page).strokes.count, 1)
    }

    @MainActor
    func testSavedBindingsRecoverAndMovedTargetsChangeExportWithoutChangingQueuedSnapshot() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Connected explanations")
        var page = try store.createNoteForWriting(in: notebook)
        var left = NotebookShape(kind: .rectangle, x: 80, y: 120, width: 180, height: 100, text: "Capture")
        var right = NotebookShape(kind: .rectangle, x: 480, y: 120, width: 180, height: 100, text: "Self-test")
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow), start: CGPoint(x: 260, y: 170), end: CGPoint(x: 480, y: 170))
        arrow.startBinding = NotebookArrowBinding(targetId: left.id, x: 1, y: 0.5)
        arrow.endBinding = NotebookArrowBinding(targetId: right.id, x: 0, y: 0.5)
        let objects = [left, right, arrow]
        page = try store.savePage(page, drawing: PKDrawing(), style: .plain, canvasHeight: 1800, shapes: objects)
        let note = try XCTUnwrap(store.notes.first)
        let oldSubmission = try store.prepareSubmission(note)
        let oldImages = try store.pageURLs(for: oldSubmission).map { try Data(contentsOf: $0) }
        let oldArchive = try Data(contentsOf: store.drawingURLs(for: oldSubmission)[0])
        let reopened = NotebookStore(directory: directory)
        XCTAssertEqual(try reopened.shapes(for: page), objects)
        XCTAssertEqual(oldArchive.sha256, oldSubmission.drawings[0].hash)
        left.y = 3000; right.y = 3300
        let updated = NotebookArrowGeometry.resolvingBindings(in: [left, right, arrow])
        let connector = try XCTUnwrap(updated.last)
        XCTAssertEqual(NotebookArrowGeometry.startPoint(of: connector), CGPoint(x: 260, y: 3050))
        XCTAssertEqual(NotebookArrowGeometry.endPoint(of: connector), CGPoint(x: 480, y: 3350))
        page = try reopened.savePage(page, drawing: PKDrawing(), style: .plain, canvasHeight: 1800, shapes: updated)
        let newSubmission = try reopened.prepareSubmission(try XCTUnwrap(reopened.notes.first))
        let newImages = try reopened.pageURLs(for: newSubmission).map { try Data(contentsOf: $0) }
        XCTAssertNotEqual(newImages, oldImages, "Offscreen moved boxes and their connector must render in the new export")
        XCTAssertEqual(try reopened.pageURLs(for: oldSubmission).map { try Data(contentsOf: $0) }, oldImages)
        XCTAssertEqual(try Data(contentsOf: reopened.drawingURLs(for: oldSubmission)[0]), oldArchive)
        XCTAssertEqual(try NotebookStore(directory: directory).shapes(for: page), updated)
        let staleBounds = try XCTUnwrap(NotebookArtwork.contentBounds(drawing: PKDrawing(), shapes: [left, right, arrow]))
        XCTAssertGreaterThan(staleBounds.minY, 2900, "Shared geometry resolves bindings for rendering even before endpoint caches are materialized")
    }

    @MainActor
    func testCorruptPersistedBindingIsRejectedRatherThanDetachedDuringRecovery() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Recover connections")
        let page = try store.createNoteForWriting(in: notebook)
        let box = NotebookShape(kind: .rectangle)
        var arrow = NotebookArrowGeometry.settingEndpoints(of: NotebookShape(kind: .arrow), start: CGPoint(x: 300, y: 150), end: CGPoint(x: 500, y: 150))
        arrow.startBinding = NotebookArrowBinding(targetId: box.id, x: 1, y: 0.5)
        let objects = NotebookArrowGeometry.resolvingBindings(in: [box, arrow])
        let saved = try store.savePage(page, drawing: PKDrawing(), style: .plain, canvasHeight: 1800, shapes: objects)
        let note = try XCTUnwrap(store.notes.first)
        let queued = try store.prepareSubmission(note)
        let queuedArchive = try Data(contentsOf: store.drawingURLs(for: queued)[0])
        let file = pageDrawingURL(saved, in: store)
        let marker = Data("RECALL_NOTEBOOK_ARTWORK_V1\0".utf8)
        var archive = try XCTUnwrap(try PropertyListSerialization.propertyList(from: Data(Data(contentsOf: file).dropFirst(marker.count)), options: [], format: nil) as? [String: Any])
        var shapeRows = try XCTUnwrap(archive["shapes"] as? [[String: Any]])
        let arrowIndex = try XCTUnwrap(shapeRows.firstIndex { $0["id"] as? String == arrow.id })
        shapeRows[arrowIndex]["startBinding"] = ["targetId": UUID().uuidString.lowercased(), "x": 1.0, "y": 0.5]
        archive["shapes"] = shapeRows
        let corrupt = marker + (try PropertyListSerialization.data(fromPropertyList: archive, format: .binary, options: 0))
        try corrupt.write(to: file, options: .atomic)
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var pages = try XCTUnwrap(index["pages"] as? [[String: Any]])
        let pageIndex = try XCTUnwrap(pages.firstIndex { $0["id"] as? String == page.id })
        pages[pageIndex]["contentHash"] = corrupt.sha256; index["pages"] = pages
        try JSONSerialization.data(withJSONObject: index, options: .sortedKeys).write(to: indexURL, options: .atomic)
        let reopened = NotebookStore(directory: directory)
        let currentPage = try XCTUnwrap(reopened.pages.first)
        XCTAssertThrowsError(try reopened.shapes(for: currentPage))
        XCTAssertThrowsError(try reopened.prepareSubmission(note))
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
        XCTAssertEqual(try Data(contentsOf: reopened.drawingURLs(for: queued)[0]), queuedArchive)
    }

    @MainActor
    func testLegacyDrawingBytesAndQueuedAssetsSurviveObjectSupportAndNoOpSaves() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let rawURL = pageDrawingURL(fixture.page, in: store)
        let raw = try Data(contentsOf: rawURL)
        let submitted = try store.prepareSubmission(fixture.note)
        let queued = try Data(contentsOf: store.drawingURLs(for: submitted)[0])
        let restoredInk = try store.drawing(for: fixture.page)
        XCTAssertEqual(try store.shapes(for: fixture.page), [])
        let noOp = try store.savePage(fixture.page, drawing: restoredInk, style: fixture.page.paperStyle, canvasHeight: fixture.page.canvasHeight)
        XCTAssertEqual(noOp.revision, fixture.page.revision)
        XCTAssertEqual(try Data(contentsOf: rawURL), raw)
        XCTAssertEqual(noOp.contentHash, raw.sha256)

        let object = NotebookShape(kind: .rectangle, text: "A labeled vector object", color: PaperInkColor.blue.rawValue, filled: true)
        let edited = try store.savePage(noOp, drawing: restoredInk, style: noOp.paperStyle, canvasHeight: noOp.canvasHeight, shapes: [object])
        XCTAssertGreaterThan(edited.revision, noOp.revision)
        XCTAssertEqual(try store.shapes(for: edited), [object])
        XCTAssertEqual(try store.drawing(for: edited), restoredInk)
        XCTAssertTrue(try Data(contentsOf: pageDrawingURL(edited, in: store)).starts(with: Data("RECALL_NOTEBOOK_ARTWORK_V1\0".utf8)))
        XCTAssertEqual(try Data(contentsOf: store.drawingURLs(for: submitted)[0]), queued)
        XCTAssertEqual(queued, raw, "Previously sent raw PencilKit remains an immutable legacy asset")
        XCTAssertEqual(NotebookStore(directory: directory).submissions.first?.contentHash, submitted.contentHash)
    }

    @MainActor
    func testCompoundArtworkNilPreservationRenameAndObjectEditsAreRevisioned() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        var object = NotebookShape(kind: .ellipse, text: "Vector space", color: PaperInkColor.green.rawValue)
        var saved = try store.savePage(fixture.page, drawing: store.drawing(for: fixture.page), style: .squared, canvasHeight: 1800, shapes: [object])
        let compound = try Data(contentsOf: pageDrawingURL(saved, in: store))
        let noOp = try store.savePage(saved, drawing: store.drawing(for: saved), style: saved.paperStyle, canvasHeight: saved.canvasHeight)
        XCTAssertEqual(noOp, saved)
        XCTAssertEqual(try Data(contentsOf: pageDrawingURL(noOp, in: store)), compound)
        try store.renamePage(saved, title: "Diagram and ink")
        saved = try XCTUnwrap(store.pages.first)
        XCTAssertEqual(try store.shapes(for: saved), [object])
        XCTAssertEqual(try Data(contentsOf: pageDrawingURL(saved, in: store)), compound, "Metadata-only changes preserve exact compound drawing bytes")
        object.text = "A subspace closed under linear combination"
        object.x += 30; object.color = PaperInkColor.purple.rawValue; object.filled = true
        let edited = try store.savePage(saved, drawing: store.drawing(for: saved), style: saved.paperStyle, canvasHeight: saved.canvasHeight, shapes: [object])
        XCTAssertEqual(edited.revision, saved.revision + 1)
        XCTAssertNotEqual(edited.contentHash, saved.contentHash)
        let reopened = NotebookStore(directory: directory)
        XCTAssertEqual(try reopened.shapes(for: edited), [object])
        XCTAssertEqual(try reopened.drawing(for: edited).strokes.count, 1)
    }

    @MainActor
    func testShapeOnlyPagesAreWrittenButEmptyTextBoxesAreNotSent() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Shapes only")
        var page = try store.createNoteForWriting(in: notebook)
        let note = try XCTUnwrap(store.notes.first)
        let emptyText = NotebookShape(kind: .text, text: " \n ")
        page = try store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: 1800, shapes: [emptyText])
        XCTAssertFalse(try store.hasInk(for: page))
        XCTAssertNil(store.thumbnail(for: page))
        XCTAssertThrowsError(try store.prepareSubmission(note))
        let object = NotebookShape(kind: .rectangle, x: 100, y: 120, text: "Explain this mechanism", color: PaperInkColor.red.rawValue, filled: true)
        page = try store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: 1800, shapes: [object])
        XCTAssertTrue(try store.hasInk(for: page))
        XCTAssertEqual(try store.writtenPageIds(in: note), [page.id])
        let cover = try XCTUnwrap(store.thumbnail(for: page))
        XCTAssertGreaterThan(try coloredPixels(cover), 100)
        let submission = try store.prepareSubmission(note)
        XCTAssertEqual(submission.version, 3)
        XCTAssertEqual(submission.drawings[0].hash, page.contentHash)
        XCTAssertEqual(submission.sourcePages[0].hash, page.contentHash)
        XCTAssertTrue(try store.drawing(for: page).strokes.isEmpty)
        XCTAssertGreaterThan(try coloredPixels(try XCTUnwrap(UIImage(contentsOfFile: store.pageURLs(for: submission)[0].path))), 100)
    }

    @MainActor
    func testHeightOnlyEmptyCanvasAndCompoundAutosavesDoNotCreateSemanticChanges() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Continuous paper")
        var page = try store.createNoteForWriting(in: notebook)
        let blankNote = try XCTUnwrap(store.notes.first)
        let blankBytes = try Data(contentsOf: pageDrawingURL(page, in: store))
        page = try store.savePage(page, drawing: PKDrawing(), style: page.paperStyle, canvasHeight: 5400, shapes: [])
        XCTAssertEqual(page.revision, 0)
        XCTAssertEqual(store.notes.first?.revision, blankNote.revision)
        XCTAssertEqual(store.notes.first?.updatedAt, blankNote.updatedAt)
        XCTAssertEqual(try Data(contentsOf: pageDrawingURL(page, in: store)), blankBytes)
        let objects = [NotebookShape(kind: .diamond, text: "A concept")]
        page = try store.savePage(page, drawing: PKDrawing(), style: page.paperStyle, canvasHeight: 5400, shapes: objects)
        let noteBefore = try XCTUnwrap(store.notes.first)
        let compound = try Data(contentsOf: pageDrawingURL(page, in: store))
        let submission = try store.prepareSubmission(noteBefore)
        let resized = try store.savePage(page, drawing: PKDrawing(), style: page.paperStyle, canvasHeight: 8100, shapes: objects)
        XCTAssertEqual(resized.revision, page.revision)
        XCTAssertEqual(resized.contentHash, page.contentHash)
        XCTAssertEqual(resized.updatedAt, page.updatedAt)
        XCTAssertEqual(store.notes.first?.revision, noteBefore.revision)
        XCTAssertEqual(store.notes.first?.updatedAt, noteBefore.updatedAt)
        XCTAssertEqual(try Data(contentsOf: pageDrawingURL(resized, in: store)), compound)
        XCTAssertEqual(store.submissions, [submission])
    }

    @MainActor
    func testInvalidObjectsAndCorruptCompoundArchivesNeverBecomeBlankWork() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let previousIndex = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        var invalid = NotebookShape(kind: .rectangle)
        invalid.x = .nan
        XCTAssertThrowsError(try store.savePage(fixture.page, drawing: store.drawing(for: fixture.page), style: .squared, canvasHeight: 1800, shapes: [invalid]))
        invalid = NotebookShape(kind: .text, text: String(repeating: "a", count: 4001))
        XCTAssertThrowsError(try store.savePage(fixture.page, drawing: store.drawing(for: fixture.page), style: .squared, canvasHeight: 1800, shapes: [invalid]))
        XCTAssertThrowsError(try NotebookArtwork.validate(shapes: (0...500).map { _ in NotebookShape(kind: .rectangle) }))
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), previousIndex)
        let saved = try store.savePage(fixture.page, drawing: store.drawing(for: fixture.page), style: .squared, canvasHeight: 1800, shapes: [NotebookShape(kind: .rectangle, text: "Keep this object")])
        let file = pageDrawingURL(saved, in: store)
        let marker = Data("RECALL_NOTEBOOK_ARTWORK_V1\0".utf8)
        var archive = try XCTUnwrap(try PropertyListSerialization.propertyList(from: Data(Data(contentsOf: file).dropFirst(marker.count)), options: [], format: nil) as? [String: Any])
        archive.removeValue(forKey: "shapes")
        let corrupt = marker + (try PropertyListSerialization.data(fromPropertyList: archive, format: .binary, options: 0))
        try corrupt.write(to: file, options: .atomic)
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var pageRows = try XCTUnwrap(index["pages"] as? [[String: Any]])
        pageRows[0]["contentHash"] = corrupt.sha256; index["pages"] = pageRows
        try JSONSerialization.data(withJSONObject: index, options: .sortedKeys).write(to: indexURL, options: .atomic)
        let reopened = NotebookStore(directory: directory)
        XCTAssertThrowsError(try reopened.shapes(for: saved))
        XCTAssertThrowsError(try reopened.drawing(for: saved))
        XCTAssertThrowsError(try reopened.hasInk(for: saved))
        XCTAssertThrowsError(try reopened.prepareSubmission(fixture.note))
        XCTAssertTrue(reopened.submissions.isEmpty)
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
    }

    @MainActor
    func testSparseContinuousObjectsExportBothEndsWithoutBlankChunksAndKeepImmutableArchive() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Long continuous page")
        var page = try store.createNoteForWriting(in: notebook)
        let note = try XCTUnwrap(store.notes.first)
        var objects = [NotebookShape(kind: .text, x: 80, y: 80, text: "First visible explanation", color: PaperInkColor.blue.rawValue),
                       NotebookShape(kind: .text, x: 100, y: 30_000, text: "Last visible explanation", color: PaperInkColor.red.rawValue)]
        page = try store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: 1800, shapes: objects)
        let submission = try store.prepareSubmission(note)
        XCTAssertEqual(submission.pages.count, 2, "Sparse continuous pages send their nonempty chunks, not blank intervening paper")
        let images = try store.pageURLs(for: submission).map { try Data(contentsOf: $0) }
        let compound = try Data(contentsOf: store.drawingURLs(for: submission)[0])
        for image in images { XCTAssertGreaterThan(try coloredPixels(try XCTUnwrap(UIImage(data: image))), 50) }
        XCTAssertEqual(try store.shapes(for: page), objects)
        XCTAssertEqual(compound.sha256, submission.drawings[0].hash)
        XCTAssertGreaterThan(try coloredPixels(try XCTUnwrap(store.thumbnail(for: page))), 50, "Long-page covers retain readable first content")
        objects[0].text = "A later private edit"; objects.removeLast()
        _ = try store.savePage(page, drawing: PKDrawing(), style: .squared, canvasHeight: page.canvasHeight, shapes: objects)
        XCTAssertEqual(try store.pageURLs(for: submission).map { try Data(contentsOf: $0) }, images)
        XCTAssertEqual(try Data(contentsOf: store.drawingURLs(for: submission)[0]), compound)
    }

    @MainActor
    func testFullWrappedLabelsRenderOnWhitePaperUnderDarkAppearance() throws {
        let text = String(repeating: "A linear combination adds scaled vectors. ", count: 20)
        let shape = NotebookShape(kind: .text, x: 80, y: 80, width: 260, height: 24, text: text, fontSize: 24)
        XCTAssertGreaterThan(NotebookShapeRenderer.requiredHeight(for: shape), shape.height)
        let content = try XCTUnwrap(NotebookArtwork.contentBounds(drawing: PKDrawing(), shapes: [shape]))
        XCTAssertGreaterThan(content.maxY, shape.frame.maxY)
        let bounds = CGRect(x: 0, y: 0, width: 500, height: content.maxY + 40)
        let light = NotebookArtwork.render(drawing: PKDrawing(), shapes: [shape], bounds: bounds, scale: 1)
        var dark: UIImage?
        UITraitCollection(userInterfaceStyle: .dark).performAsCurrent {
            dark = NotebookArtwork.render(drawing: PKDrawing(), shapes: [shape], bounds: bounds, scale: 1)
        }
        let lightPixels = try rgbaPixels(light)
        let darkPixels = try rgbaPixels(try XCTUnwrap(dark))
        XCTAssertEqual(lightPixels, darkPixels, "Export is canonical light ink on white, independent of device appearance")
        XCTAssertEqual(Array(lightPixels.prefix(4)), [255, 255, 255, 255])
        let width = try XCTUnwrap(light.cgImage).width
        let height = try XCTUnwrap(light.cgImage).height
        let bottomQuarter = Array(lightPixels.suffix(width * (height / 4) * 4))
        XCTAssertGreaterThan(nonwhitePixels(bottomQuarter), 100, "The end of a long wrapped label must actually render")
        let arrow = NotebookShape(kind: .arrow, x: 40, y: 0, width: 220, height: 2, text: text, flippedX: true)
        XCTAssertEqual(NotebookShapeRenderer.requiredHeight(for: arrow), arrow.height)
        XCTAssertGreaterThanOrEqual(NotebookShapeRenderer.labelRect(for: arrow).minY, arrow.height)
        XCTAssertGreaterThan(try XCTUnwrap(NotebookArtwork.contentBounds(drawing: PKDrawing(), shapes: [arrow])).maxY, arrow.frame.maxY)
    }

    @MainActor
    func testOneTapCreationPersistsNumberedNoteAndFirstBlankPageTogether() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Synthetic notebook")
        _ = try store.createNote(in: notebook, title: "Untitled note 1")
        let first = try store.createNoteForWriting(in: notebook)
        let second = try store.createNoteForWriting(in: notebook)
        let note = try XCTUnwrap(store.notes.first { $0.id == first.noteId })
        XCTAssertEqual(note.title, "Untitled note 2")
        XCTAssertEqual(store.notes.first { $0.id == second.noteId }?.title, "Untitled note 3")
        XCTAssertEqual(note.pageIds, [first.id])
        XCTAssertEqual(note.lastOpenedPageId, first.id)
        XCTAssertEqual(note.revision, 1)
        XCTAssertEqual(first.title, "Page 1")
        XCTAssertTrue(try store.drawing(for: first).strokes.isEmpty)
        XCTAssertTrue(store.submissions.isEmpty, "Opening a new note never sends work")
        let reopened = NotebookStore(directory: directory)
        XCTAssertNil(reopened.storageError)
        XCTAssertEqual(try reopened.resumePage(for: note).id, first.id)
        XCTAssertEqual(reopened.notes.count, 3)
        XCTAssertEqual(reopened.pages.count, 2)
    }

    @MainActor
    func testOneTapCreationIndexFailureKeepsEarlierStateAndCleansNewPageAssets() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var rejectWrite = false
        let store = NotebookStore(directory: directory, writeIndex: { data, url in
            if rejectWrite { throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError) }
            try data.write(to: url, options: .atomic)
        })
        let notebook = try store.createNotebook(title: "Keep this notebook")
        let indexBefore = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        rejectWrite = true
        XCTAssertThrowsError(try store.createNoteForWriting(in: notebook))
        XCTAssertEqual(store.notebooks, [notebook])
        XCTAssertTrue(store.notes.isEmpty)
        XCTAssertTrue(store.pages.isEmpty)
        XCTAssertTrue(store.submissions.isEmpty)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBefore)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("pages").path), "A failed creation must clean its new orphan asset tree")
        let reopened = NotebookStore(directory: directory)
        XCTAssertNil(reopened.storageError)
        XCTAssertTrue(reopened.notes.isEmpty)
        XCTAssertTrue(reopened.pages.isEmpty)
    }

    @MainActor
    func testOneTapCreationFilesystemFailurePreservesNotebookAndBlockingFile() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let notebook = try store.createNotebook(title: "Keep this notebook")
        let indexBefore = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        let blocker = directory.appendingPathComponent("pages")
        let marker = Data("A synthetic protected non-directory".utf8)
        try marker.write(to: blocker)
        XCTAssertThrowsError(try store.createNoteForWriting(in: notebook))
        XCTAssertEqual(store.notebooks, [notebook])
        XCTAssertTrue(store.notes.isEmpty)
        XCTAssertTrue(store.pages.isEmpty)
        XCTAssertEqual(try Data(contentsOf: blocker), marker)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBefore)
    }

    @MainActor
    func testRememberedNavigationSurvivesReopenWithoutChangingSemanticStateOrSnapshot() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let second = try store.addPage(to: fixture.note)
        _ = try store.savePage(second, drawing: ink(y: 500), style: .plain, canvasHeight: 1800)
        let submission = try store.prepareSubmission(fixture.note)
        let noteBefore = try XCTUnwrap(store.notes.first)
        let notebookBefore = store.notebooks
        let pagesBefore = store.pages
        let summaryBefore = store.syncSummary(for: fixture.note)
        let imagesBefore = try store.pageURLs(for: submission).map { try Data(contentsOf: $0) }
        let drawingsBefore = try store.drawingURLs(for: submission).map { try Data(contentsOf: $0) }

        try store.rememberOpenedPage(fixture.page)
        let noteAfter = try XCTUnwrap(store.notes.first)
        XCTAssertEqual(noteAfter.lastOpenedPageId, fixture.page.id)
        XCTAssertEqual(noteAfter.revision, noteBefore.revision)
        XCTAssertEqual(noteAfter.updatedAt, noteBefore.updatedAt)
        XCTAssertEqual(noteAfter.pageIds, noteBefore.pageIds)
        XCTAssertEqual(store.notebooks, notebookBefore)
        XCTAssertEqual(store.pages, pagesBefore)
        XCTAssertEqual(store.syncSummary(for: fixture.note), summaryBefore)
        XCTAssertEqual(store.submissions, [submission])
        XCTAssertEqual(try store.pageURLs(for: submission).map { try Data(contentsOf: $0) }, imagesBefore)
        XCTAssertEqual(try store.drawingURLs(for: submission).map { try Data(contentsOf: $0) }, drawingsBefore)
        let indexBeforeNoOp = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        try store.rememberOpenedPage(fixture.page)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBeforeNoOp)

        let reopened = NotebookStore(directory: directory)
        XCTAssertNil(reopened.storageError)
        XCTAssertEqual(try reopened.resumePage(for: fixture.note).id, fixture.page.id)
        XCTAssertEqual(reopened.submissions.first?.contentHash, submission.contentHash)
        XCTAssertEqual(reopened.pages.count, 2, "Resuming a note must not add a page")
    }

    @MainActor
    func testNavigationIndexFailureKeepsPreviouslyRememberedPageAndSemanticState() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var rejectWrite = false
        let store = NotebookStore(directory: directory, writeIndex: { data, url in
            if rejectWrite { throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError) }
            try data.write(to: url, options: .atomic)
        })
        let fixture = try writtenNote(in: store)
        let second = try store.addPage(to: fixture.note)
        let noteBefore = try XCTUnwrap(store.notes.first)
        let indexBefore = try Data(contentsOf: directory.appendingPathComponent("index.json"))
        rejectWrite = true
        XCTAssertThrowsError(try store.rememberOpenedPage(fixture.page))
        XCTAssertEqual(store.notes.first, noteBefore)
        XCTAssertEqual(try store.resumePage(for: fixture.note).id, second.id)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("index.json")), indexBefore)
    }

    @MainActor
    func testLegacyMissingAndStaleRememberedPointersFallBackWithoutLosingInk() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        _ = try store.addPage(to: fixture.note)
        let noteBefore = try XCTUnwrap(store.notes.first)
        let indexURL = directory.appendingPathComponent("index.json")
        var index = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        var legacyNotes = try XCTUnwrap(index["notes"] as? [[String: Any]])
        legacyNotes[0].removeValue(forKey: "lastOpenedPageId")
        index["notes"] = legacyNotes
        try JSONSerialization.data(withJSONObject: index, options: .sortedKeys).write(to: indexURL, options: .atomic)
        let legacy = NotebookStore(directory: directory)
        XCTAssertNil(legacy.storageError)
        XCTAssertNil(legacy.notes.first?.lastOpenedPageId)
        XCTAssertEqual(try legacy.resumePage(for: fixture.note).id, fixture.page.id)
        XCTAssertEqual(try legacy.drawing(for: fixture.page).strokes.count, 1)

        legacyNotes[0]["lastOpenedPageId"] = "stale navigation, not an ink identifier"
        index["notes"] = legacyNotes
        try JSONSerialization.data(withJSONObject: index, options: .sortedKeys).write(to: indexURL, options: .atomic)
        let recovered = NotebookStore(directory: directory)
        XCTAssertNil(recovered.storageError)
        XCTAssertEqual(recovered.notes.first?.lastOpenedPageId, fixture.page.id)
        XCTAssertEqual(try recovered.resumePage(for: fixture.note).id, fixture.page.id)
        XCTAssertEqual(recovered.notes.first?.revision, noteBefore.revision)
        XCTAssertEqual(recovered.pages.count, 2)
        XCTAssertTrue(recovered.submissions.isEmpty)
    }

    @MainActor
    func testDeletingRememberedPageChoosesSurvivorAndEmptyNoteResumesSafely() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotebookStore(directory: directory)
        let fixture = try writtenNote(in: store)
        let second = try store.addPage(to: fixture.note)
        try store.rememberOpenedPage(fixture.page)
        try store.delete(fixture.page)
        XCTAssertEqual(store.notes.first?.lastOpenedPageId, second.id)
        let reopened = NotebookStore(directory: directory)
        XCTAssertNil(reopened.storageError)
        XCTAssertEqual(try reopened.resumePage(for: fixture.note).id, second.id)
        try reopened.delete(second)
        XCTAssertNil(reopened.notes.first?.lastOpenedPageId)
        XCTAssertTrue(reopened.pages.isEmpty)
        let blank = try reopened.resumePage(for: fixture.note)
        XCTAssertEqual(blank.title, "Page 1")
        XCTAssertEqual(reopened.notes.first?.lastOpenedPageId, blank.id)
        XCTAssertTrue(try reopened.drawing(for: blank).strokes.isEmpty)
        XCTAssertTrue(reopened.submissions.isEmpty)
    }

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
        let oversized = verticalInk(height: 31_000)
        _ = try store.savePage(longPage, drawing: oversized, style: .plain, canvasHeight: 32000)
        XCTAssertThrowsError(try store.prepareSubmission(fixture.note))
        XCTAssertEqual(store.submissions.count, 1, "Oversized work stays local and must not be truncated into a new queued submission")
        XCTAssertEqual(try store.drawing(for: longPage).strokes.count, 1)
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
    private func pageDrawingURL(_ page: PadNotebookPage, in store: NotebookStore) -> URL {
        store.directory.appendingPathComponent("pages/\(page.id)/drawing-\(page.revision).data")
    }

    private func rgbaPixels(_ image: UIImage) throws -> [UInt8] {
        let cg = try XCTUnwrap(image.cgImage)
        var pixels = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        let success = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(data: bytes.baseAddress, width: cg.width, height: cg.height, bitsPerComponent: 8,
                                          bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
            return true
        }
        XCTAssertTrue(success)
        return pixels
    }

    private func nonwhitePixels(_ pixels: [UInt8]) -> Int {
        stride(from: 0, to: pixels.count, by: 4).filter { pixels[$0] < 240 || pixels[$0 + 1] < 240 || pixels[$0 + 2] < 240 }.count
    }
    private func coloredPixels(_ image: UIImage) throws -> Int { nonwhitePixels(try rgbaPixels(image)) }

    private func verticalInk(height: CGFloat) -> PKDrawing {
        let points = [CGPoint(x: 100, y: 80), CGPoint(x: 100, y: height)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: TimeInterval(index), size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
    }

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
