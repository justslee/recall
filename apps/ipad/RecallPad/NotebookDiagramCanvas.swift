import UIKit
import PencilKit
import SwiftUI

enum NotebookDiagramTool: String, CaseIterable {
    case none, select, rectangle, ellipse, diamond, line, arrow, text

    var shapeKind: NotebookShapeKind? {
        switch self {
        case .none, .select: return nil
        case .rectangle: return .rectangle
        case .ellipse: return .ellipse
        case .diamond: return .diamond
        case .line: return .line
        case .arrow: return .arrow
        case .text: return .text
        }
    }
}

/// Small vector layers in canonical paper coordinates. Scrolling and zooming
/// only change their presentation; ink and editable objects stay independent.
@MainActor
final class NotebookDiagramCanvas: NSObject, UIGestureRecognizerDelegate {
    private weak var canvas: GridCanvas?
    private let overlay = CALayer()
    private let selectionLayer = CAShapeLayer()
    private let resizeLayer = CAShapeLayer()
    private let startHandleLayer = CAShapeLayer()
    private let endHandleLayer = CAShapeLayer()
    private let bendHandleLayer = CAShapeLayer()
    private let rotationHandleLayer = CAShapeLayer()
    private let rotationStemLayer = CAShapeLayer()
    private let bindingLayer = CAShapeLayer()
    private var objectLayers: [String: DiagramObjectLayer] = [:]
    private(set) var shapes: [NotebookShape] = []
    private(set) var selectedShapeId: String?
    private(set) var tool: NotebookDiagramTool = .none
    private var color = PaperInkColor.graphite.rawValue
    private var lineWidth = 2.5
    private var didRestoreObjects = false
    private var interaction: Interaction?
    var onShapesChanged: ([NotebookShape]) -> Void = { _ in }
    var onSelectionChanged: (String?) -> Void = { _ in }
    var onEditShapeText: (String) -> Void = { _ in }
    var onToolChanged: (NotebookDiagramTool) -> Void = { _ in }

    private lazy var tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    private lazy var doubleTap: UITapGestureRecognizer = {
        let value = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        value.numberOfTapsRequired = 2
        return value
    }()
    private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))

    private enum Operation {
        case create(NotebookShape), move(String)
        case resize(String, NotebookResizeCorner, offset: CGPoint)
        case rotate(String, offset: CGPoint)
        case arrowEndpoint(String, start: Bool, offset: CGPoint)
        case bend(String, offset: CGPoint)
    }
    private struct Interaction {
        let start: CGPoint
        let original: [NotebookShape]
        let operation: Operation
    }

    init(canvas: GridCanvas) {
        self.canvas = canvas
        super.init()
        overlay.name = "notebook-diagram-overlay"
        overlay.zPosition = 10_000
        overlay.masksToBounds = false
        canvas.layer.addSublayer(overlay)
        selectionLayer.fillColor = nil
        selectionLayer.lineDashPattern = [5, 4]
        selectionLayer.name = "notebook-object-selection"
        resizeLayer.name = "notebook-object-resize-handle"
        startHandleLayer.name = "notebook-arrow-start-handle"
        endHandleLayer.name = "notebook-arrow-end-handle"
        bendHandleLayer.name = "notebook-line-bend-handle"
        rotationHandleLayer.name = "notebook-object-rotation-handle"
        rotationStemLayer.name = "notebook-object-rotation-stem"
        bindingLayer.name = "notebook-arrow-binding-targets"
        bindingLayer.fillColor = nil
        bindingLayer.lineWidth = 2
        overlay.addSublayer(bindingLayer)
        overlay.addSublayer(selectionLayer)
        overlay.addSublayer(resizeLayer)
        overlay.addSublayer(startHandleLayer)
        overlay.addSublayer(endHandleLayer)
        overlay.addSublayer(bendHandleLayer)
        overlay.addSublayer(rotationStemLayer)
        overlay.addSublayer(rotationHandleLayer)
        for gesture in [tap, doubleTap, pan] {
            gesture.delegate = self
            gesture.cancelsTouchesInView = true
            gesture.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue)]
            canvas.addGestureRecognizer(gesture)
        }
        pan.maximumNumberOfTouches = 1
        tap.require(toFail: doubleTap)
        canvas.pinchGestureRecognizer?.addTarget(self, action: #selector(canvasPinchChanged(_:)))
        setTool(.none)
    }

    func configure(shapes incoming: [NotebookShape], selectedShapeId: String?, tool: NotebookDiagramTool, color: String, lineWidth: Double) {
        if shapes != incoming {
            if didRestoreObjects { registerUndo(previous: shapes, name: "Edit diagram") }
            shapes = incoming
            // The initial empty SwiftUI view may receive its restored objects
            // after loading. That transition is not an editable undo action.
            if !incoming.isEmpty { didRestoreObjects = true }
        }
        self.selectedShapeId = incoming.contains { $0.id == selectedShapeId } ? selectedShapeId : nil
        self.color = color
        self.lineWidth = PaperToolSizing.penWidth(lineWidth)
        setTool(tool)
        redraw()
    }

    private func setTool(_ value: NotebookDiagramTool) {
        guard let canvas else { return }
        if tool != value, interaction != nil { cancelInteraction() }
        tool = value
        let active = value != .none
        tap.isEnabled = active
        doubleTap.isEnabled = active
        pan.isEnabled = active
        // One finger is reserved for editable objects in diagram mode. Two
        // fingers still pan, and the existing pinch recognizer stays enabled.
        canvas.panGestureRecognizer.minimumNumberOfTouches = active ? 2 : 1
        if canvas.drawingGestureRecognizer.isEnabled == active { canvas.drawingGestureRecognizer.isEnabled = !active }
    }

    func documentPoint(fromCanvasPoint point: CGPoint) -> CGPoint {
        let scale = max(canvas?.zoomScale ?? 1, 0.01)
        return CGPoint(x: point.x / scale, y: point.y / scale)
    }

    private func validPoint(_ point: CGPoint) -> Bool {
        point.x.isFinite && point.y.isFinite && abs(point.x) <= 1_000_000 && abs(point.y) <= 1_000_000
    }

    private func hitShape(at point: CGPoint) -> NotebookShape? {
        let tolerance = 12 / max(canvas?.zoomScale ?? 1, 0.01)
        return shapes.reversed().first { shape in
            guard shape.isValid else { return false }
            let local = NotebookShapeGeometry.localPoint(point, in: shape)
            let label = NotebookShapeRenderer.labelRect(for: shape)
            if !shape.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               !label.isEmpty, label.contains(local) { return true }
            if shape.kind == .text { return CGRect(origin: .zero, size: shape.frame.size).contains(local) }
            guard NotebookShapeRenderer.documentBounds(for: shape).insetBy(dx: -tolerance, dy: -tolerance).contains(point) else { return false }
            let path = NotebookShapeRenderer.path(for: shape)
            let onStroke = path.cgPath.copy(strokingWithWidth: max(CGFloat(shape.lineWidth), tolerance * 2), lineCap: .round, lineJoin: .round, miterLimit: 2).contains(local)
            if NotebookArrowGeometry.isConnector(shape) {
                return onStroke || (shape.kind == .arrow && shape.filled && NotebookShapeRenderer.headPath(for: shape).contains(local))
            }
            return path.contains(local) || onStroke
        }
    }

    private func canTransform(_ shape: NotebookShape) -> Bool {
        !NotebookArrowGeometry.isConnector(shape) || (shape.startBinding == nil && shape.endBinding == nil)
    }

    private func selectionCorners(for shape: NotebookShape) -> [NotebookResizeCorner: CGPoint] {
        guard NotebookArrowGeometry.isConnector(shape) else { return NotebookShapeGeometry.corners(of: shape) }

        // Separate frame controls from endpoint controls, even on a flat line.
        let gap = 22 / max(canvas?.zoomScale ?? 1, 0.01)
        let frame = shape.frame.insetBy(dx: -gap, dy: -gap)
        return [.topLeft: CGPoint(x: frame.minX, y: frame.minY), .topRight: CGPoint(x: frame.maxX, y: frame.minY),
                .bottomLeft: CGPoint(x: frame.minX, y: frame.maxY), .bottomRight: CGPoint(x: frame.maxX, y: frame.maxY)]
    }

    private func resizeHandle(at point: CGPoint, shape: NotebookShape) -> NotebookResizeCorner? {
        guard canTransform(shape) else { return nil }

        let tolerance = 18 / max(canvas?.zoomScale ?? 1, 0.01)
        return selectionCorners(for: shape).filter { hypot(point.x - $0.value.x, point.y - $0.value.y) <= tolerance }
            .min { hypot(point.x - $0.value.x, point.y - $0.value.y) < hypot(point.x - $1.value.x, point.y - $1.value.y) }?.key
    }

    func rotationHandle(for shape: NotebookShape) -> CGPoint {
        let gap = 32 / max(canvas?.zoomScale ?? 1, 0.01)
        let extra = NotebookArrowGeometry.isConnector(shape) ? 22 / max(canvas?.zoomScale ?? 1, 0.01) : 0
        return NotebookShapeGeometry.documentPoint(CGPoint(x: shape.width / 2, y: -gap - extra), in: shape)
    }

    private func hasBendHandle(_ shape: NotebookShape) -> Bool {
        guard NotebookArrowGeometry.isConnector(shape) else { return false }

        let start = NotebookArrowGeometry.startPoint(of: shape), end = NotebookArrowGeometry.endPoint(of: shape)
        return hypot(end.x - start.x, end.y - start.y) * (canvas?.zoomScale ?? 1) >= 44
    }

    private func arrowHandle(at point: CGPoint, shape: NotebookShape) -> Bool? {
        guard NotebookArrowGeometry.isConnector(shape) else { return nil }

        let tolerance = 18 / max(canvas?.zoomScale ?? 1, 0.01)
        let start = NotebookArrowGeometry.startPoint(of: shape)
        let end = NotebookArrowGeometry.endPoint(of: shape)
        let startDistance = hypot(point.x - start.x, point.y - start.y)
        let endDistance = hypot(point.x - end.x, point.y - end.y)
        if min(startDistance, endDistance) > tolerance { return nil }

        return startDistance < endDistance
    }

    private func attachingEndpoints(of arrow: NotebookShape, start: CGPoint, end: CGPoint, targets: [NotebookShape], changeStart: Bool = true, changeEnd: Bool = true) -> NotebookShape {
        var next = arrow
        let tolerance = 22 / max(canvas?.zoomScale ?? 1, 0.01)
        if changeStart { next.startBinding = NotebookArrowGeometry.nearestBinding(to: start, in: targets, excludingId: arrow.id, tolerance: tolerance, toward: end) }
        if changeEnd { next.endBinding = NotebookArrowGeometry.nearestBinding(to: end, in: targets, excludingId: arrow.id, tolerance: tolerance, toward: start) }
        if let startTarget = next.startBinding?.targetId, startTarget == next.endBinding?.targetId {
            // A straight segment cannot represent a loop around one shape.
            // Keep the untouched endpoint and leave the dragged end free.
            if changeStart && !changeEnd { next.startBinding = nil }
            else { next.endBinding = nil }
        }
        let snappedStart = next.startBinding.flatMap { NotebookArrowGeometry.bindingPoint($0, in: targets) } ?? start
        let snappedEnd = next.endBinding.flatMap { NotebookArrowGeometry.bindingPoint($0, in: targets) } ?? end
        return NotebookArrowGeometry.settingEndpoints(of: next, start: snappedStart, end: snappedEnd)
    }

    func select(at point: CGPoint) {
        guard validPoint(point) else { return }
        setSelection(hitShape(at: point)?.id)
    }

    private func setSelection(_ id: String?) {
        selectedShapeId = id
        onSelectionChanged(id)
        // Only an explicit canvas interaction takes keyboard focus. Updating
        // SwiftUI bindings must leave note-title and label text input alone.
        if id != nil, tool != .none, let canvas, canvas.window?.isKeyWindow == true, !canvas.isFirstResponder {
            _ = canvas.becomeFirstResponder()
        }
        redraw()
    }

    var canEditSelectedObject: Bool {
        tool == .select && interaction == nil && shapes.contains { $0.id == selectedShapeId }
    }

    @discardableResult
    func deleteSelectedObject() -> Bool {
        guard canEditSelectedObject, let id = selectedShapeId else { return false }

        let detached = NotebookArrowGeometry.detachingBindings(to: id, in: shapes)
        replaceShapes(detached.filter { $0.id != id }, registeringUndo: true, name: "Delete shape")
        setSelection(nil)
        return true
    }

    @discardableResult
    func duplicateSelectedObject() -> Bool {
        guard canEditSelectedObject, shapes.count < 500,
              var copy = shapes.first(where: { $0.id == selectedShapeId }) else { return false }

        copy.id = UUID().uuidString.lowercased()
        copy.x += 32
        copy.y += 32
        copy.startBinding = nil
        copy.endBinding = nil
        guard let validCopy = bounded(copy) else { return false }

        replaceShapes(shapes + [validCopy], registeringUndo: true, name: "Duplicate shape")
        guard shapes.contains(where: { $0.id == validCopy.id }) else { return false }

        setSelection(validCopy.id)
        return true
    }

    func insert(at point: CGPoint) {
        guard validPoint(point), let kind = tool.shapeKind, shapes.count < 500 else { return }
        let size: CGSize
        switch kind {
        case .rectangle, .ellipse: size = CGSize(width: 180, height: 100)
        case .diamond: size = CGSize(width: 150, height: 130)
        case .arrow, .line: size = CGSize(width: 180, height: 2)
        case .text: size = CGSize(width: 220, height: 60)
        }
        var candidate = NotebookShape(kind: kind, x: max(12, point.x - size.width / 2), y: max(12, point.y - size.height / 2), width: size.width, height: size.height, color: color, lineWidth: lineWidth)
        if NotebookArrowGeometry.isConnector(candidate) {
            candidate = attachingEndpoints(of: candidate, start: NotebookArrowGeometry.startPoint(of: candidate), end: NotebookArrowGeometry.endPoint(of: candidate), targets: shapes)
        }
        guard let shape = bounded(candidate) else { return }
        replaceShapes(shapes + [shape], registeringUndo: true, name: "Add \(kind.rawValue)")
        guard shapes.contains(where: { $0.id == shape.id }) else { return }
        setSelection(shape.id)
        finishCreatingObject()
        if kind == .text { onEditShapeText(shape.id) }
    }

    func beginInteraction(at point: CGPoint) {
        guard validPoint(point), tool != .none else { return }
        let operation: Operation
        let selected = shapes.first(where: { $0.id == selectedShapeId })
        let tolerance = 18 / max(canvas?.zoomScale ?? 1, 0.01)
        if let selected, let start = arrowHandle(at: point, shape: selected) {
            let anchor = start ? NotebookArrowGeometry.startPoint(of: selected) : NotebookArrowGeometry.endPoint(of: selected)
            operation = .arrowEndpoint(selected.id, start: start, offset: CGPoint(x: anchor.x - point.x, y: anchor.y - point.y))
        } else if let selected, hasBendHandle(selected),
                  hypot(point.x - NotebookArrowGeometry.bendPoint(of: selected).x, point.y - NotebookArrowGeometry.bendPoint(of: selected).y) <= tolerance {
            let anchor = NotebookArrowGeometry.bendPoint(of: selected)
            operation = .bend(selected.id, offset: CGPoint(x: anchor.x - point.x, y: anchor.y - point.y))
        } else if let selected, canTransform(selected),
                  hypot(point.x - rotationHandle(for: selected).x, point.y - rotationHandle(for: selected).y) <= tolerance {
            let anchor = rotationHandle(for: selected)
            operation = .rotate(selected.id, offset: CGPoint(x: anchor.x - point.x, y: anchor.y - point.y))
        } else if let selected, let corner = resizeHandle(at: point, shape: selected),
                  let anchor = NotebookShapeGeometry.corners(of: selected)[corner] {
            operation = .resize(selected.id, corner, offset: CGPoint(x: anchor.x - point.x, y: anchor.y - point.y))
        } else if let kind = tool.shapeKind {
            guard shapes.count < 500 else { return }
            operation = .create(NotebookShape(kind: kind, x: max(0, point.x), y: max(0, point.y), width: 24, height: kind == .arrow || kind == .line ? 2 : 24, color: color, lineWidth: lineWidth))
        } else if let hit = hitShape(at: point) {
            setSelection(hit.id)
            operation = .move(hit.id)
        } else {
            setSelection(nil)
            return
        }
        interaction = Interaction(start: point, original: shapes, operation: operation)
    }

    func updateInteraction(at point: CGPoint) {
        guard let interaction, validPoint(point) else { return }
        var next = interaction.original
        switch interaction.operation {
        case .create(var shape):
            if NotebookArrowGeometry.isConnector(shape) {
                shape = attachingEndpoints(of: shape, start: interaction.start, end: point, targets: interaction.original)
                guard let boundedShape = bounded(shape) else { return }

                next.append(boundedShape)
                selectedShapeId = shape.id
                break
            }
            let minimumHeight: Double = 24
            shape.x = max(0, min(interaction.start.x, point.x))
            shape.y = max(0, min(interaction.start.y, point.y))
            shape.width = max(24, abs(point.x - interaction.start.x))
            shape.height = max(minimumHeight, abs(point.y - interaction.start.y))
            guard let boundedShape = bounded(shape) else { return }
            next.append(boundedShape)
            selectedShapeId = shape.id
        case .move(let id):
            guard let position = next.firstIndex(where: { $0.id == id }) else { return }
            if NotebookArrowGeometry.isConnector(next[position]) {
                // Dragging the shaft moves a free arrow. Endpoint handles are
                // the explicit way to detach or reconnect a bound connector.
                let arrow = next[position]
                if arrow.startBinding != nil || arrow.endBinding != nil { return }

                let dx = point.x - interaction.start.x, dy = point.y - interaction.start.y
                let start = NotebookArrowGeometry.startPoint(of: arrow)
                let end = NotebookArrowGeometry.endPoint(of: arrow)
                let moved = NotebookArrowGeometry.settingEndpoints(of: arrow, start: CGPoint(x: start.x + dx, y: start.y + dy), end: CGPoint(x: end.x + dx, y: end.y + dy))
                guard let shape = bounded(moved) else { return }

                next[position] = shape
                break
            }
            next[position].x = max(0, next[position].x + point.x - interaction.start.x)
            next[position].y = max(0, next[position].y + point.y - interaction.start.y)
            guard let shape = bounded(next[position]) else { return }
            next[position] = shape
        case .arrowEndpoint(let id, let movingStart, let offset):
            guard let position = next.firstIndex(where: { $0.id == id }) else { return }

            let arrow = next[position]
            let movedPoint = CGPoint(x: point.x + offset.x, y: point.y + offset.y)
            let start = movingStart ? movedPoint : NotebookArrowGeometry.startPoint(of: arrow)
            let end = movingStart ? NotebookArrowGeometry.endPoint(of: arrow) : movedPoint
            let connected = attachingEndpoints(of: arrow, start: start, end: end, targets: interaction.original, changeStart: movingStart, changeEnd: !movingStart)
            guard let shape = bounded(connected) else { return }

            next[position] = shape
        case .bend(let id, let offset):
            guard let position = next.firstIndex(where: { $0.id == id }) else { return }

            next[position] = NotebookArrowGeometry.settingBend(of: next[position], through: CGPoint(x: point.x + offset.x, y: point.y + offset.y))
        case .rotate(let id, let offset):
            guard let position = next.firstIndex(where: { $0.id == id }) else { return }

            next[position] = NotebookShapeGeometry.rotating(next[position], to: CGPoint(x: point.x + offset.x, y: point.y + offset.y))
        case .resize(let id, let corner, let offset):
            guard let position = next.firstIndex(where: { $0.id == id }) else { return }

            next[position] = NotebookShapeGeometry.resizing(next[position], corner: corner, to: CGPoint(x: point.x + offset.x, y: point.y + offset.y))
        }
        replaceShapes(next, registeringUndo: false, name: "Edit diagram")
        onSelectionChanged(selectedShapeId)
    }

    func endInteraction() {
        guard let interaction else { return }
        self.interaction = nil
        if case .create(let created) = interaction.operation,
           let arrow = shapes.first(where: { $0.id == created.id && NotebookArrowGeometry.isConnector($0) }) {
            let start = NotebookArrowGeometry.startPoint(of: arrow)
            let end = NotebookArrowGeometry.endPoint(of: arrow)
            if hypot(end.x - start.x, end.y - start.y) < 4 / max(canvas?.zoomScale ?? 1, 0.01) {
                replaceShapes(interaction.original, registeringUndo: false, name: "Cancel tiny arrow")
                setSelection(nil)
                return
            }
        }
        if interaction.original != shapes { registerUndo(previous: interaction.original, name: "Edit diagram") }
        if case .create(let shape) = interaction.operation, shapes.contains(where: { $0.id == shape.id }) {
            finishCreatingObject()
            if shape.kind == .text { onEditShapeText(shape.id) }
        }
    }

    private func finishCreatingObject() {
        setTool(.select)
        onToolChanged(.select)
    }

    func cancelInteraction() {
        guard let interaction else { return }
        self.interaction = nil
        replaceShapes(interaction.original, registeringUndo: false, name: "Edit diagram")
        if !shapes.contains(where: { $0.id == selectedShapeId }) { setSelection(nil) }
    }

    private func replaceShapes(_ next: [NotebookShape], registeringUndo: Bool, name: String) {
        let resolved = NotebookArrowGeometry.resolvingBindings(in: next)
        guard resolved != shapes else { return }
        guard (try? NotebookArtwork.validate(shapes: resolved)) != nil else { return }
        if registeringUndo { registerUndo(previous: shapes, name: name) }
        shapes = resolved
        didRestoreObjects = true
        onShapesChanged(resolved)
        redraw()
    }

    private func bounded(_ original: NotebookShape) -> NotebookShape? {
        guard [original.x, original.y, original.width, original.height].allSatisfy(\.isFinite) else { return nil }
        var shape = original
        if NotebookArrowGeometry.isConnector(shape), shape.arrowStart != nil || shape.arrowEnd != nil {
            // Exact endpoints may form horizontal, vertical or short arrows.
            // Expanding their frame would shift the stored endpoint offsets.
            guard shape.isValid else { return nil }

            var geometryOnly = shape
            geometryOnly.startBinding = nil
            geometryOnly.endBinding = nil
            return (try? NotebookArtwork.validate(shapes: [geometryOnly])) != nil ? shape : nil
        }
        shape.width = min(10_000, max(24, shape.width))
        shape.height = min(1_000_000, max(NotebookArrowGeometry.isConnector(shape) ? 2 : 24, shape.height))
        shape.x = min(max(0, shape.x), 10_000 - shape.width)
        shape.y = min(max(0, shape.y), 1_000_000 - shape.height)
        if !NotebookArrowGeometry.isConnector(shape) {
            shape.height = min(1_000_000, max(shape.height, NotebookShapeRenderer.requiredHeight(for: shape)))
            shape.y = min(shape.y, 1_000_000 - shape.height)
        }
        let labelBottom = NotebookShapeRenderer.labelRect(for: shape).maxY
        shape.y = min(shape.y, max(0, 1_000_000 - max(shape.height, labelBottom)))
        return shape.isValid ? shape : nil
    }

    private func registerUndo(previous: [NotebookShape], name: String) {
        guard let manager = canvas?.undoManager else { return }
        manager.registerUndo(withTarget: self) { target in target.replaceShapes(previous, registeringUndo: true, name: name) }
        manager.setActionName(name)
    }

    func redraw() {
        guard let canvas, canvas.bounds.width.isFinite, canvas.bounds.height.isFinite, canvas.zoomScale.isFinite, canvas.zoomScale > 0 else { return }
        let scale = canvas.zoomScale
        let viewport = canvas.bounds.insetBy(dx: -100, dy: -100)
        let visible = shapes.filter { shape in
            guard shape.isValid else { return false }
            let bounds = NotebookShapeRenderer.documentBounds(for: shape)
            return CGRect(x: bounds.minX * scale, y: bounds.minY * scale, width: bounds.width * scale, height: bounds.height * scale).insetBy(dx: -40, dy: -40).intersects(viewport)
        }
        let ids = Set(visible.map(\.id))
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (id, layer) in objectLayers where !ids.contains(id) { layer.removeFromSuperlayer(); objectLayers.removeValue(forKey: id) }
        for (index, shape) in visible.enumerated() {
            let layer = objectLayers[shape.id] ?? DiagramObjectLayer()
            if objectLayers[shape.id] == nil { objectLayers[shape.id] = layer; overlay.addSublayer(layer) }
            layer.configure(shape, scale: scale, appearance: canvas.traitCollection.userInterfaceStyle, viewport: viewport)
            layer.zPosition = CGFloat(index)
        }
        let accent = PadPalette.accent
        let selectionColor = UIColor(accent).resolvedColor(with: canvas.traitCollection).cgColor
        selectionLayer.strokeColor = selectionColor
        selectionLayer.lineWidth = 1.5
        let freeColor = UIColor(PadPalette.surface).resolvedColor(with: canvas.traitCollection).cgColor
        for handle in [resizeLayer, startHandleLayer, endHandleLayer, bendHandleLayer, rotationHandleLayer] {
            handle.fillColor = freeColor
            handle.strokeColor = selectionColor
            handle.lineWidth = 1.8
            handle.zPosition = 1_001
            handle.path = nil
        }
        rotationStemLayer.fillColor = nil
        rotationStemLayer.strokeColor = selectionColor
        rotationStemLayer.lineWidth = 1
        rotationStemLayer.zPosition = 1_000
        rotationStemLayer.path = nil
        bindingLayer.strokeColor = selectionColor
        bindingLayer.zPosition = 900
        selectionLayer.zPosition = 1_000
        selectionLayer.path = nil
        bindingLayer.path = nil
        if tool != .none, let shape = shapes.first(where: { $0.id == selectedShapeId && $0.isValid }) {
            func displayed(_ point: CGPoint) -> CGPoint { CGPoint(x: point.x * scale, y: point.y * scale) }
            func circle(_ point: CGPoint, diameter: CGFloat = 14) -> CGPath {
                let point = displayed(point)
                return UIBezierPath(ovalIn: CGRect(x: point.x - diameter / 2, y: point.y - diameter / 2, width: diameter, height: diameter)).cgPath
            }
            let corners = selectionCorners(for: shape)
            let border = UIBezierPath()
            for (index, corner) in [NotebookResizeCorner.topLeft, .topRight, .bottomRight, .bottomLeft].enumerated() {
                guard let point = corners[corner] else { continue }

                if index == 0 { border.move(to: displayed(point)) } else { border.addLine(to: displayed(point)) }
            }
            border.close()
            selectionLayer.path = border.cgPath
            if canTransform(shape) {
                let handles = UIBezierPath()
                for corner in NotebookResizeCorner.allCases {
                    guard let point = corners[corner] else { continue }

                    let displayPoint = displayed(point)
                    handles.append(UIBezierPath(roundedRect: CGRect(x: displayPoint.x - 6, y: displayPoint.y - 6, width: 12, height: 12), cornerRadius: 3))
                }
                resizeLayer.path = handles.cgPath
                let rotationPoint = rotationHandle(for: shape)
                rotationHandleLayer.path = circle(rotationPoint)
                let top = NotebookShapeGeometry.documentPoint(CGPoint(x: shape.width / 2, y: 0), in: shape)
                let stem = UIBezierPath()
                stem.move(to: displayed(top)); stem.addLine(to: displayed(rotationPoint))
                rotationStemLayer.path = stem.cgPath
            }
            if NotebookArrowGeometry.isConnector(shape) {
                let start = NotebookArrowGeometry.startPoint(of: shape)
                let end = NotebookArrowGeometry.endPoint(of: shape)
                startHandleLayer.path = circle(start)
                endHandleLayer.path = circle(end)
                startHandleLayer.fillColor = shape.startBinding == nil ? freeColor : selectionColor
                endHandleLayer.fillColor = shape.endBinding == nil ? freeColor : selectionColor
                if hasBendHandle(shape) { bendHandleLayer.path = circle(NotebookArrowGeometry.bendPoint(of: shape), diameter: 12) }
                let targets = Set([shape.startBinding?.targetId, shape.endBinding?.targetId].compactMap { $0 })
                let targetPath = UIBezierPath()
                for target in shapes where targets.contains(target.id) {
                    var transform = CGAffineTransform(scaleX: scale, y: scale)
                    if let path = NotebookShapeRenderer.documentPath(for: target).cgPath.copy(using: &transform) { targetPath.append(UIBezierPath(cgPath: path)) }
                }
                bindingLayer.path = targetPath.cgPath
            }
        }
        CATransaction.commit()
    }

    var renderedObjectCount: Int { objectLayers.count }
    func renderedFrame(for id: String) -> CGRect? { objectLayers[id]?.frame }
    func renderedLabelFrame(for id: String) -> CGRect? { objectLayers[id]?.renderedLabelFrame }
    var renderedArrowStartHandle: CGRect? { startHandleLayer.path?.boundingBox }
    var renderedArrowEndHandle: CGRect? { endHandleLayer.path?.boundingBox }
    var renderedBendHandle: CGRect? { bendHandleLayer.path?.boundingBox }
    var renderedRotationHandle: CGRect? { rotationHandleLayer.path?.boundingBox }
    var renderedResizeHandleCount: Int { resizeLayer.path == nil ? 0 : 4 }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        guard let canvas else { return }
        let point = documentPoint(fromCanvasPoint: gesture.location(in: canvas))
        if tool == .select { select(at: point) } else { insert(at: point) }
    }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        guard let canvas, let shape = hitShape(at: documentPoint(fromCanvasPoint: gesture.location(in: canvas))) else { return }
        setSelection(shape.id)
        onEditShapeText(shape.id)
    }

    @objc private func panned(_ gesture: UIPanGestureRecognizer) {
        guard let canvas else { return }
        if canvas.pinchGestureRecognizer?.state == .began || canvas.pinchGestureRecognizer?.state == .changed {
            cancelInteraction()
            return
        }
        let location = gesture.location(in: canvas)
        switch gesture.state {
        case .began:
            let translation = gesture.translation(in: canvas)
            beginInteraction(at: documentPoint(fromCanvasPoint: CGPoint(x: location.x - translation.x, y: location.y - translation.y)))
        case .changed: updateInteraction(at: documentPoint(fromCanvasPoint: location))
        case .ended: updateInteraction(at: documentPoint(fromCanvasPoint: location)); endInteraction()
        case .cancelled, .failed: cancelInteraction()
        default: break
        }
    }

    @objc func canvasPinchChanged(_ gesture: UIPinchGestureRecognizer) {
        guard gesture.state == .began || gesture.state == .changed else { return }

        // Roll back an unfinished edit only when a real zoom gesture starts.
        // UIKit's simultaneous-recognition query can include a dormant pinch.
        cancelInteraction()
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        gestureRecognizer is UIPinchGestureRecognizer || otherGestureRecognizer is UIPinchGestureRecognizer
    }
}

private final class DiagramObjectLayer: CALayer {
    private let outline = CAShapeLayer()
    private let headFill = CAShapeLayer()
    private let label = DiagramTextLayer()
    override init() {
        super.init()
        masksToBounds = false
        addSublayer(outline)
        addSublayer(headFill)
        addSublayer(label)
    }
    required init?(coder: NSCoder) { fatalError("Use the programmatic object layer") }
    override init(layer: Any) { super.init(layer: layer) }
    var renderedLabelFrame: CGRect { label.isHidden ? .zero : label.frame }

    func configure(_ shape: NotebookShape, scale: CGFloat, appearance: UIUserInterfaceStyle, viewport: CGRect) {
        setAffineTransform(.identity)
        bounds = CGRect(x: 0, y: 0, width: shape.width * scale, height: shape.height * scale)
        position = CGPoint(x: shape.frame.midX * scale, y: shape.frame.midY * scale)
        setAffineTransform(CGAffineTransform(rotationAngle: shape.rotation ?? 0))
        let canonical = PaperInkColor(rawValue: shape.color)?.color ?? .black
        let ink = appearance == .dark ? PKInkingTool.convertColor(canonical, from: .light, to: .dark) : canonical
        var transform = CGAffineTransform(scaleX: scale, y: scale)
        outline.path = NotebookShapeRenderer.path(for: shape).cgPath.copy(using: &transform)
        outline.strokeColor = shape.kind == .text ? nil : ink.cgColor
        outline.fillColor = shape.filled && shape.kind != .text && !NotebookArrowGeometry.isConnector(shape) ? ink.withAlphaComponent(0.12).cgColor : nil
        headFill.path = shape.kind == .arrow && shape.filled ? NotebookShapeRenderer.headPath(for: shape).cgPath.copy(using: &transform) : nil
        headFill.fillColor = ink.cgColor
        headFill.strokeColor = nil
        outline.lineWidth = CGFloat(shape.lineWidth) * scale
        outline.lineCap = .round
        outline.lineJoin = .round
        label.contentsScale = UIScreen.main.scale
        let fontSize = CGFloat(shape.fontSize) * scale
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = .byWordWrapping
        let text = NSAttributedString(string: shape.text, attributes: [.font: NotebookShapeRenderer.font(for: shape).withSize(fontSize), .foregroundColor: ink, .paragraphStyle: paragraph])
        let rect = NotebookShapeRenderer.labelRect(for: shape)
        let fullRect = CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale)
        let viewportPoints = [CGPoint(x: viewport.minX, y: viewport.minY), CGPoint(x: viewport.maxX, y: viewport.minY),
                              CGPoint(x: viewport.minX, y: viewport.maxY), CGPoint(x: viewport.maxX, y: viewport.maxY)]
            .map { NotebookShapeGeometry.localPoint(CGPoint(x: $0.x / scale, y: $0.y / scale), in: shape) }
        let left = viewportPoints.map(\.x).min()! * scale, right = viewportPoints.map(\.x).max()! * scale
        let top = viewportPoints.map(\.y).min()! * scale, bottom = viewportPoints.map(\.y).max()! * scale
        let visible = fullRect.intersection(CGRect(x: left, y: top, width: right - left, height: bottom - top))
        label.isHidden = visible.isNull || visible.isEmpty
        if !label.isHidden {
            // A 4,000-character narrow label can be much taller than a screen.
            // Back only its visible slice; layout still uses the entire label.
            label.frame = visible
            label.configure(text: text, fullRect: fullRect.offsetBy(dx: -visible.minX, dy: -visible.minY))
        }
    }
}

private final class DiagramTextLayer: CALayer {
    private var text = NSAttributedString(string: "")
    private var fullRect = CGRect.zero
    override init() { super.init(); masksToBounds = true }
    required init?(coder: NSCoder) { fatalError("Use the programmatic text layer") }
    override init(layer: Any) { super.init(layer: layer) }
    func configure(text: NSAttributedString, fullRect: CGRect) {
        guard self.text != text || self.fullRect != fullRect else { return }
        self.text = text
        self.fullRect = fullRect
        setNeedsDisplay()
    }
    override func draw(in context: CGContext) {
        context.saveGState()
        // This UIKit-backed layer already receives a top-down drawing context.
        // Flipping it again turns editable labels upside down on the canvas.
        UIGraphicsPushContext(context)
        text.draw(with: fullRect, options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        UIGraphicsPopContext()
        context.restoreGState()
    }
}
