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
    static let background = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.075, green: 0.11, blue: 0.095, alpha: 1)
            : UIColor(red: 0.99, green: 0.98, blue: 0.95, alpha: 1)
    }
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

    struct CanvasCommand: Equatable { let id: UUID; let undo: Bool }

    func makeUIView(context: Context) -> GridCanvas {
        let canvas = GridCanvas()
        canvas.delegate = context.coordinator
        canvas.drawingPolicy = .pencilOnly
        canvas.minimumZoomScale = 0.5
        canvas.maximumZoomScale = 2
        canvas.alwaysBounceVertical = true
        configureTool(on: canvas)
        context.coordinator.installInitialDrawing(drawing, on: canvas)
        canvas.contentSize = CGSize(width: 900, height: finiteHeight)
        canvas.paperStyle = style
        return canvas
    }

    func updateUIView(_ canvas: GridCanvas, context: Context) {
        context.coordinator.parent = self
        context.coordinator.restore(drawing, on: canvas)
        canvas.paperStyle = style
        let width = canvas.bounds.width.isFinite ? max(canvas.bounds.width, 900) : 900
        canvas.contentSize = CGSize(width: width, height: finiteHeight)
        configureTool(on: canvas)
        if let command, command != context.coordinator.lastCommand {
            context.coordinator.lastCommand = command
            if command.undo { canvas.undoManager?.undo() } else { canvas.undoManager?.redo() }
        }
        canvas.redrawPaper()
    }

    private var finiteHeight: Double {
        PaperGeometry.canvasHeight(current: height, inkBounds: drawing.strokes.isEmpty ? nil : drawing.bounds)
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
        private var restoringDrawing = false
        private var lastObservedDrawing: PKDrawing
        private var lastBoundDrawing: PKDrawing

        init(_ parent: PaperCanvas) {
            self.parent = parent
            lastObservedDrawing = parent.drawing
            lastBoundDrawing = parent.drawing
        }

        func installInitialDrawing(_ drawing: PKDrawing, on canvas: PKCanvasView) {
            lastBoundDrawing = drawing
            applyRestoredDrawing(drawing, on: canvas)
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
            parent.height = PaperGeometry.canvasHeight(current: parent.height, inkBounds: canvasView.drawing.strokes.isEmpty ? nil : canvasView.drawing.bounds)
            parent.onChanged()
        }

        private func sameDrawing(_ first: PKDrawing, _ second: PKDrawing) -> Bool {
            // Independently created empty drawings can have different PencilKit
            // identities. They still represent the same untouched blank sheet.
            (first.strokes.isEmpty && second.strokes.isEmpty) || first == second
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) { (scrollView as? GridCanvas)?.redrawPaper() }
        func scrollViewDidZoom(_ scrollView: UIScrollView) { (scrollView as? GridCanvas)?.redrawPaper() }
    }
}

final class GridCanvas: PKCanvasView {
    private let paperLayer = CAShapeLayer()
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
    override func layoutSubviews() { super.layoutSubviews(); redrawPaper() }

    private func updatePaperAppearance() {
        // Core Animation colors are concrete, so resolve the dynamic grid color
        // again when system appearance changes. Leave pending Pencil edits alone.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        paperLayer.strokeColor = PaperPalette.grid.resolvedColor(with: traitCollection).cgColor
        CATransaction.commit()
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
