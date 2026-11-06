import SwiftUI
import PencilKit

enum PaperTool: String, CaseIterable { case pen, eraser, select }

enum PaperInkColor: String, CaseIterable {
    case graphite, blue, green, red, purple, amber

    var name: String { rawValue.capitalized }

    // Store light-appearance ink. PencilKit adapts how it looks on dark paper;
    // converting saved colors back and forth would gradually change them.
    var color: UIColor {
        switch self {
        case .graphite: return .black
        case .blue: return UIColor(red: 0.12, green: 0.32, blue: 0.72, alpha: 1)
        case .green: return UIColor(red: 0.12, green: 0.42, blue: 0.28, alpha: 1)
        case .red: return UIColor(red: 0.72, green: 0.20, blue: 0.22, alpha: 1)
        case .purple: return UIColor(red: 0.46, green: 0.25, blue: 0.65, alpha: 1)
        case .amber: return UIColor(red: 0.60, green: 0.36, blue: 0.08, alpha: 1)
        }
    }

    func displayColor(for scheme: ColorScheme) -> Color {
        Color(uiColor: scheme == .dark
            ? PKInkingTool.convertColor(color, from: .light, to: .dark)
            : color)
    }
}

enum PaperToolSizing {
    static var penRange: ClosedRange<Double> {
        let supported = PKInkingTool.InkType.pen.validWidthRange
        return max(1, Double(supported.lowerBound))...min(12, Double(supported.upperBound))
    }

    static var eraserRange: ClosedRange<Double> {
        let supported = PKEraserTool.EraserType.fixedWidthBitmap.validWidthRange
        return max(8, Double(supported.lowerBound))...min(80, Double(supported.upperBound))
    }

    static func penWidth(_ value: Double) -> Double {
        clamp(value, to: penRange, fallback: 2.5)
    }

    static func eraserWidth(_ value: Double) -> Double {
        clamp(value, to: eraserRange, fallback: 24)
    }

    private static func clamp(_ value: Double, to range: ClosedRange<Double>, fallback: Double) -> Double {
        min(range.upperBound, max(range.lowerBound, value.isFinite ? value : fallback))
    }
}

enum PaperPalette {
    static let background = PadPalette.paperUIColor
    static let grid = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.63, green: 0.72, blue: 0.66, alpha: 0.14)
            : UIColor(red: 0.38, green: 0.47, blue: 0.41, alpha: 0.12)
    }
}

struct PaperCanvas: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    @Binding var height: Double
    var style: PaperStyle
    var tool: PaperTool
    var onChanged: () -> Void
    var command: CanvasCommand?
    var inkColor: PaperInkColor = .graphite
    var penWidth: Double = 2.5
    var eraserWidth: Double = 24
    @Binding var shapes: [NotebookShape]
    var diagramTool: NotebookDiagramTool = .none
    @Binding var selectedShapeId: String?
    var onEditShapeText: (String) -> Void = { _ in }
    var continuous = false
    var onDiagramToolChanged: (NotebookDiagramTool) -> Void = { _ in }
    var notebookKeyboardActionsEnabled = true

    init(drawing: Binding<PKDrawing>, height: Binding<Double>, style: PaperStyle, tool: PaperTool, onChanged: @escaping () -> Void, command: CanvasCommand?, inkColor: PaperInkColor = .graphite, penWidth: Double = 2.5, eraserWidth: Double = 24, shapes: Binding<[NotebookShape]> = .constant([]), diagramTool: NotebookDiagramTool = .none, selectedShapeId: Binding<String?> = .constant(nil), onEditShapeText: @escaping (String) -> Void = { _ in }, continuous: Bool = false, onDiagramToolChanged: @escaping (NotebookDiagramTool) -> Void = { _ in }, notebookKeyboardActionsEnabled: Bool = true) {
        _drawing = drawing
        _height = height
        self.style = style
        self.tool = tool
        self.onChanged = onChanged
        self.command = command
        self.inkColor = inkColor
        self.penWidth = penWidth
        self.eraserWidth = eraserWidth
        _shapes = shapes
        self.diagramTool = diagramTool
        _selectedShapeId = selectedShapeId
        self.onEditShapeText = onEditShapeText
        self.continuous = continuous
        self.onDiagramToolChanged = onDiagramToolChanged
        self.notebookKeyboardActionsEnabled = notebookKeyboardActionsEnabled
    }

    struct CanvasCommand: Equatable { let id: UUID; let undo: Bool }

    func makeUIView(context: Context) -> GridCanvas {
        let canvas = GridCanvas()
        canvas.delegate = context.coordinator
        canvas.drawingPolicy = .pencilOnly
        canvas.minimumZoomScale = continuous ? 0.35 : 0.5
        canvas.maximumZoomScale = continuous ? 3 : 2
        canvas.alwaysBounceVertical = true
        configureTool(on: canvas)
        context.coordinator.installInitialDrawing(drawing, on: canvas)
        canvas.configureDocumentGeometry(width: finiteWidth, height: finiteHeight, continuous: continuous)
        canvas.paperStyle = style
        context.coordinator.configureNotebook(on: canvas)
        return canvas
    }

    func updateUIView(_ canvas: GridCanvas, context: Context) {
        context.coordinator.parent = self
        context.coordinator.restore(drawing, on: canvas)
        canvas.paperStyle = style
        let width = canvas.bounds.width.isFinite ? max(canvas.bounds.width, finiteWidth) : finiteWidth
        canvas.configureDocumentGeometry(width: width, height: finiteHeight, continuous: continuous)
        configureTool(on: canvas)
        context.coordinator.configureNotebook(on: canvas)
        if let command { context.coordinator.enqueueCanvasCommand(command, on: canvas) }
        canvas.redrawPaper()
    }

    static func dismantleUIView(_ canvas: GridCanvas, coordinator: Coordinator) {
        coordinator.cancelCanvasCommands()
    }

    private var finiteHeight: Double {
        PaperGeometry.canvasHeight(current: height, inkBounds: shapes.isEmpty ? (drawing.strokes.isEmpty ? nil : drawing.bounds) : NotebookArtwork.contentBounds(drawing: drawing, shapes: shapes))
    }
    private var finiteWidth: Double {
        let bounds = shapes.isEmpty ? (drawing.strokes.isEmpty ? nil : drawing.bounds) : NotebookArtwork.contentBounds(drawing: drawing, shapes: shapes)
        return max(900, bounds?.maxX.isFinite == true ? Double(bounds!.maxX) + 40 : 900)
    }

    func configureTool(on canvas: PKCanvasView) {
        switch tool {
        case .pen:
            // PencilKit can bridge equivalent tools to unequal Swift values.
            // Compare their ink settings so a UI refresh leaves active ink alone.
            let width = CGFloat(PaperToolSizing.penWidth(penWidth))
            if let current = canvas.tool as? PKInkingTool,
               current.inkType == .pen, current.width == width,
               sameColor(current.color, inkColor.color) { return }

            canvas.tool = PKInkingTool(.pen, color: inkColor.color, width: width)
        case .eraser:
            let width = CGFloat(PaperToolSizing.eraserWidth(eraserWidth))
            if let current = canvas.tool as? PKEraserTool,
               current.eraserType == .fixedWidthBitmap, current.width == width { return }

            canvas.tool = PKEraserTool(.fixedWidthBitmap, width: width)
        case .select:
            if !(canvas.tool is PKLassoTool) { canvas.tool = PKLassoTool() }
        }
    }

    private func sameColor(_ first: UIColor, _ second: UIColor) -> Bool {
        var firstRed: CGFloat = 0, firstGreen: CGFloat = 0, firstBlue: CGFloat = 0, firstAlpha: CGFloat = 0
        var secondRed: CGFloat = 0, secondGreen: CGFloat = 0, secondBlue: CGFloat = 0, secondAlpha: CGFloat = 0
        guard first.getRed(&firstRed, green: &firstGreen, blue: &firstBlue, alpha: &firstAlpha),
              second.getRed(&secondRed, green: &secondGreen, blue: &secondBlue, alpha: &secondAlpha) else {
            return first.isEqual(second)
        }

        return abs(firstRed - secondRed) < 0.000001
            && abs(firstGreen - secondGreen) < 0.000001
            && abs(firstBlue - secondBlue) < 0.000001
            && abs(firstAlpha - secondAlpha) < 0.000001
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: PaperCanvas
        var lastCommand: CanvasCommand?
        private var queuedCommands: [CanvasCommand] = []
        private var commandTask: Task<Void, Never>?
        private weak var commandCanvas: GridCanvas?
        private var canvasWasDismantled = false
        private var restoringDrawing = false
        private var lastObservedDrawing: PKDrawing
        private var lastBoundDrawing: PKDrawing

        init(_ parent: PaperCanvas) {
            self.parent = parent
            lastObservedDrawing = parent.drawing
            lastBoundDrawing = parent.drawing
        }

        func enqueueCanvasCommand(_ command: CanvasCommand, on canvas: GridCanvas) {
            guard !canvasWasDismantled, command != lastCommand else { return }

            if let commandCanvas, commandCanvas !== canvas { cancelCanvasCommands(); return }
            commandCanvas = canvas
            lastCommand = command
            queuedCommands.append(command)
            guard commandTask == nil else { return }

            commandTask = Task { @MainActor [weak self, weak canvas] in
                // Undo writes the editor's shapes and drawing bindings. Doing
                // that inside updateUIView can discard SwiftUI's state update,
                // leaving a visible object absent from the saved object list.
                await Task.yield()
                guard let self, let canvas else { return }

                while !self.queuedCommands.isEmpty {
                    guard !Task.isCancelled, !self.canvasWasDismantled,
                          self.commandCanvas === canvas, canvas.window != nil else {
                        self.queuedCommands.removeAll()
                        break
                    }
                    let next = self.queuedCommands.removeFirst()
                    if next.undo { canvas.undoManager?.undo() }
                    else { canvas.undoManager?.redo() }
                    // Publish each committed binding before executing a later
                    // queued Redo or Undo; accepted commands keep their order.
                    await Task.yield()
                }
                self.commandTask = nil
            }
        }

        func cancelCanvasCommands() {
            canvasWasDismantled = true
            commandTask?.cancel()
            commandTask = nil
            commandCanvas = nil
            queuedCommands.removeAll()
        }

        func installInitialDrawing(_ drawing: PKDrawing, on canvas: PKCanvasView) {
            lastBoundDrawing = drawing
            applyRestoredDrawing(drawing, on: canvas)
        }

        func configureNotebook(on canvas: GridCanvas) {
            canvas.notebookKeyboardActionsEnabled = parent.notebookKeyboardActionsEnabled
            canvas.minimumZoomScale = parent.continuous ? 0.35 : 0.5
            canvas.maximumZoomScale = parent.continuous ? 3 : 2
            guard parent.continuous || !parent.shapes.isEmpty || parent.diagramTool != .none || canvas.diagramCanvas != nil else { return }
            let diagrams = canvas.diagramCanvas ?? NotebookDiagramCanvas(canvas: canvas)
            canvas.diagramCanvas = diagrams
            diagrams.onShapesChanged = { [weak self, weak canvas] objects in
                guard let self else { return }
                self.parent.shapes = objects
                self.parent.height = PaperGeometry.canvasHeight(current: self.parent.height, inkBounds: NotebookArtwork.contentBounds(drawing: self.parent.drawing, shapes: objects))
                canvas?.configureDocumentGeometry(width: self.parent.finiteWidth, height: self.parent.finiteHeight, continuous: self.parent.continuous)
                self.parent.onChanged()
            }
            diagrams.onSelectionChanged = { [weak self] id in self?.parent.selectedShapeId = id }
            diagrams.onEditShapeText = { [weak self] id in self?.parent.onEditShapeText(id) }
            diagrams.onToolChanged = { [weak self] value in self?.parent.onDiagramToolChanged(value) }
            diagrams.configure(shapes: parent.shapes, selectedShapeId: parent.selectedShapeId, tool: parent.diagramTool, color: parent.inkColor.rawValue, lineWidth: parent.penWidth)
        }

        func restore(_ drawing: PKDrawing, on canvas: PKCanvasView) {
            // SwiftUI can refresh for connection status before PencilKit reports
            // a completed stroke. An unchanged binding must not replace newer
            // ink already held by the canvas.
            guard !sameDrawing(drawing, lastBoundDrawing) else { return }

            lastBoundDrawing = drawing
            applyRestoredDrawing(drawing, on: canvas)
        }

        private func applyRestoredDrawing(_ drawing: PKDrawing, on canvas: PKCanvasView) {
            guard !sameDrawing(canvas.drawing, drawing) else {
                lastObservedDrawing = canvas.drawing
                return
            }

            // PencilKit may notify synchronously or after this assignment. Neither
            // callback should turn a restored sheet into a user edit.
            restoringDrawing = true
            lastObservedDrawing = drawing
            canvas.drawing = drawing
            restoringDrawing = false
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            guard !restoringDrawing else { return }

            guard !sameDrawing(canvasView.drawing, lastObservedDrawing) else {
                lastObservedDrawing = canvasView.drawing
                return
            }

            lastObservedDrawing = canvasView.drawing
            lastBoundDrawing = canvasView.drawing
            parent.drawing = canvasView.drawing
            parent.height = PaperGeometry.canvasHeight(current: parent.height, inkBounds: parent.shapes.isEmpty ? (canvasView.drawing.strokes.isEmpty ? nil : canvasView.drawing.bounds) : NotebookArtwork.contentBounds(drawing: canvasView.drawing, shapes: parent.shapes))
            parent.onChanged()
        }

        private func sameDrawing(_ first: PKDrawing, _ second: PKDrawing) -> Bool {
            // Independently created empty drawings can have different PencilKit
            // identities. They still represent the same untouched blank sheet.
            (first.strokes.isEmpty && second.strokes.isEmpty) || first == second
        }

        func extendContinuousPaperIfNeeded(_ canvas: GridCanvas) {
            guard parent.continuous, !canvas.updatingDocumentGeometry, canvas.zoomScale.isFinite, canvas.zoomScale > 0, canvas.bounds.height.isFinite, canvas.contentOffset.y.isFinite else { return }
            let visibleBottom = (canvas.contentOffset.y + canvas.bounds.height) / canvas.zoomScale
            let current = parent.finiteHeight
            guard visibleBottom >= current - 320, current < 1_000_000 else { return }
            let extensionHeight = max(1200, Double(canvas.bounds.height / canvas.zoomScale))
            let expanded = min(1_000_000, max(current + extensionHeight, Double(visibleBottom) + 800))
            guard expanded.isFinite, expanded > current else { return }
            parent.height = expanded
            canvas.configureDocumentGeometry(width: parent.finiteWidth, height: expanded, continuous: true)
            parent.onChanged()
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            guard let canvas = scrollView as? GridCanvas else { return }
            extendContinuousPaperIfNeeded(canvas)
            canvas.redrawPaper()
            canvas.diagramCanvas?.redraw()
        }
        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            guard let canvas = scrollView as? GridCanvas else { return }
            canvas.refreshDocumentGeometryForZoom()
            extendContinuousPaperIfNeeded(canvas)
            canvas.redrawPaper()
            canvas.diagramCanvas?.redraw()
        }
    }
}

final class GridCanvas: PKCanvasView {
    private let paperLayer = CAShapeLayer()
    var diagramCanvas: NotebookDiagramCanvas?
    var notebookKeyboardActionsEnabled = true
    private(set) var documentHeight: Double = PaperGeometry.minimumHeight
    private(set) var documentWidth: Double = 900
    private(set) var continuousPaper = false
    private(set) var updatingDocumentGeometry = false
    var paperStyle: PaperStyle = .squared { didSet { if oldValue != paperStyle { redrawPaper() } } }
    override init(frame: CGRect) {
        super.init(frame: frame)
        // PencilKit adapts canonical ink to the inherited appearance.
        // Match the paper to that appearance without rewriting saved strokes.
        backgroundColor = PaperPalette.background
        isOpaque = true
        layer.insertSublayer(paperLayer, at: 0)
        paperLayer.lineWidth = 0.6
        paperLayer.fillColor = nil
        updatePaperAppearance()
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (canvas: GridCanvas, _: UITraitCollection) in
            canvas.updatePaperAppearance()
        }
    }
    required init?(coder: NSCoder) { fatalError("Use the programmatic canvas initializer") }
    override func layoutSubviews() {
        super.layoutSubviews()
        // The viewport can widen after rotation or Split View without a new
        // SwiftUI drawing value. Grow the actual PencilKit paper at that size.
        refreshDocumentGeometryForZoom()
        redrawPaper()
        diagramCanvas?.redraw()
    }

    private var ownsNotebookKeyboardFocus: Bool {
        notebookKeyboardActionsEnabled && continuousPaper && diagramCanvas != nil && isFirstResponder && window?.isKeyWindow == true
    }

    override var keyCommands: [UIKeyCommand]? {
        let inherited = super.keyCommands ?? []
        guard ownsNotebookKeyboardFocus else { return inherited }

        var commands: [UIKeyCommand] = []
        if diagramCanvas?.canEditSelectedObject == true {
            commands.append(notebookKeyCommand(input: "\u{8}", action: #selector(deleteNotebookSelection(_:)), title: "Delete shape"))
            if UIKeyCommand.inputDelete != "\u{8}" {
                commands.append(notebookKeyCommand(input: UIKeyCommand.inputDelete, action: #selector(deleteNotebookSelection(_:)), title: "Delete shape"))
            }
            commands.append(notebookKeyCommand(input: "d", modifiers: .command, action: #selector(duplicateNotebookSelection(_:)), title: "Duplicate shape"))
        }
        if undoManager?.canUndo == true {
            commands.append(notebookKeyCommand(input: "z", modifiers: .command, action: #selector(undoNotebookEdit(_:)), title: "Undo"))
        }
        if undoManager?.canRedo == true {
            commands.append(notebookKeyCommand(input: "z", modifiers: [.command, .shift], action: #selector(redoNotebookEdit(_:)), title: "Redo"))
        }
        return commands + inherited.filter { inheritedCommand in
            !commands.contains { $0.input == inheritedCommand.input && $0.modifierFlags == inheritedCommand.modifierFlags }
        }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        switch action {
        case #selector(deleteNotebookSelection(_:)), #selector(duplicateNotebookSelection(_:)):
            return ownsNotebookKeyboardFocus && diagramCanvas?.canEditSelectedObject == true
        case #selector(undoNotebookEdit(_:)):
            return ownsNotebookKeyboardFocus && undoManager?.canUndo == true
        case #selector(redoNotebookEdit(_:)):
            return ownsNotebookKeyboardFocus && undoManager?.canRedo == true
        default:
            return super.canPerformAction(action, withSender: sender)
        }
    }

    private func notebookKeyCommand(input: String, modifiers: UIKeyModifierFlags = [], action: Selector, title: String) -> UIKeyCommand {
        let command = UIKeyCommand(input: input, modifierFlags: modifiers, action: action)
        command.discoverabilityTitle = title
        // Keep ordinary text editing and system shortcuts ahead of these local
        // canvas commands. Handlers repeat the focus guard before mutating work.
        command.wantsPriorityOverSystemBehavior = false
        return command
    }

    @objc func deleteNotebookSelection(_ sender: Any?) {
        guard ownsNotebookKeyboardFocus else { return }

        _ = diagramCanvas?.deleteSelectedObject()
    }

    @objc func duplicateNotebookSelection(_ sender: Any?) {
        guard ownsNotebookKeyboardFocus else { return }

        _ = diagramCanvas?.duplicateSelectedObject()
    }

    @objc func undoNotebookEdit(_ sender: Any?) {
        guard ownsNotebookKeyboardFocus, undoManager?.canUndo == true else { return }

        undoManager?.undo()
    }

    @objc func redoNotebookEdit(_ sender: Any?) {
        guard ownsNotebookKeyboardFocus, undoManager?.canRedo == true else { return }

        undoManager?.redo()
    }

    func configureDocumentGeometry(width: Double, height: Double, continuous: Bool) {
        let requestedWidth = width.isFinite ? max(900, width) : 900
        // A tool, connection or style refresh may still carry the older ink
        // extent. Never collapse notebook paper already exposed by zooming.
        documentWidth = continuous ? max(documentWidth, requestedWidth) : requestedWidth
        documentHeight = height.isFinite ? max(PaperGeometry.minimumHeight, height) : PaperGeometry.minimumHeight
        continuousPaper = continuous
        refreshDocumentGeometryForZoom()
    }

    func refreshDocumentGeometryForZoom() {
        guard !updatingDocumentGeometry else { return }
        let scale = continuousPaper && zoomScale.isFinite && zoomScale > 0 ? Double(zoomScale) : 1
        if continuousPaper, bounds.width.isFinite, bounds.maxX.isFinite, bounds.width > 0 {
            // PKCanvasView's opaque background fills its viewport even beyond
            // scrollable drawing content. At 35%, a 900pt sheet occupies only
            // 315 screen points. Make the entire visible paper genuine drawing
            // content by growing canonical width; keep all saved coordinates.
            let visibleRight = max(Double(bounds.width), Double(bounds.maxX))
            let requiredWidth = ceil(visibleRight / scale)
            if requiredWidth.isFinite { documentWidth = max(documentWidth, requiredWidth) }
        }
        let size = CGSize(width: documentWidth * scale, height: documentHeight * scale)
        guard size.width.isFinite, size.height.isFinite, contentSize != size else { return }
        updatingDocumentGeometry = true
        defer { updatingDocumentGeometry = false }
        let offset = contentOffset
        contentSize = size
        // Enlarging a sheet must not snap the reader back to its beginning.
        if contentOffset != offset { contentOffset = offset }
    }

    private func updatePaperAppearance() {
        // Core Animation colors are concrete, so resolve the dynamic grid color
        // again when system appearance changes. Leave pending Pencil edits alone.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        paperLayer.strokeColor = PaperPalette.grid.resolvedColor(with: traitCollection).cgColor
        CATransaction.commit()
        diagramCanvas?.redraw()
    }

    func redrawPaper() {
        guard paperStyle != .plain,
              contentSize.width.isFinite, contentSize.height.isFinite,
              contentSize.width > 0, contentSize.height > 0,
              bounds.width.isFinite, bounds.height.isFinite,
              bounds.minX.isFinite, bounds.minY.isFinite,
              bounds.width > 0, bounds.height > 0,
              zoomScale.isFinite, zoomScale > 0 else {
            paperLayer.path = nil
            return
        }

        // Keep only the visible grid (plus a small scrolling margin) in the
        // layer. Long sheets retain all their ink without allocating a path
        // proportional to the total document height.
        let spacing = CGFloat(32) * zoomScale
        let visible = bounds.insetBy(dx: -spacing * 2, dy: -spacing * 2)
            .intersection(CGRect(origin: .zero, size: contentSize))
        guard !visible.isNull, !visible.isEmpty,
              visible.maxX.isFinite, visible.maxY.isFinite,
              spacing.isFinite, spacing >= 1 else {
            paperLayer.path = nil
            return
        }

        let path = UIBezierPath()
        let firstY = (visible.minY / spacing).rounded(.up) * spacing
        for y in stride(from: firstY, through: visible.maxY, by: spacing) {
            path.move(to: CGPoint(x: visible.minX, y: y))
            path.addLine(to: CGPoint(x: visible.maxX, y: y))
        }
        if paperStyle == .squared {
            let firstX = (visible.minX / spacing).rounded(.up) * spacing
            for x in stride(from: firstX, through: visible.maxX, by: spacing) {
                path.move(to: CGPoint(x: x, y: visible.minY))
                path.addLine(to: CGPoint(x: x, y: visible.maxY))
            }
        }
        paperLayer.path = path.cgPath
    }
}
