import Foundation
import PencilKit
import UIKit

enum NotebookShapeKind: String, Codable, CaseIterable { case rectangle, ellipse, diamond, arrow, line, text }

/// A connector's local point is explicit so horizontal and vertical segments do
/// not acquire the legacy arrow's minimum-frame diagonal.
struct NotebookArrowPoint: Codable, Equatable {
    var x: Double
    var y: Double
    var point: CGPoint { CGPoint(x: x, y: y) }
    var isFinite: Bool { x.isFinite && y.isFinite }
}

/// Only container shapes can receive connectors. Normalized perimeter anchors
/// retain their location when a target moves or changes size.
struct NotebookArrowBinding: Codable, Equatable {
    var targetId: String
    var x: Double
    var y: Double
    var isValid: Bool {
        UUID(uuidString: targetId)?.uuidString.lowercased() == targetId
            && x.isFinite && y.isFinite && (0...1).contains(x) && (0...1).contains(y)
    }
}

struct NotebookShape: Codable, Identifiable, Equatable {
    var id: String
    var kind: NotebookShapeKind
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var text: String
    var color: String
    var lineWidth: Double
    var fontSize: Double
    var filled: Bool
    var flippedX: Bool
    var flippedY: Bool
    var arrowStart: NotebookArrowPoint?
    var arrowEnd: NotebookArrowPoint?
    var startBinding: NotebookArrowBinding?
    var endBinding: NotebookArrowBinding?
    /// Radians around the local frame center; absence preserves legacy bytes.
    var rotation: Double?
    /// Signed perpendicular offset of the visible curve midpoint from its chord.
    var bend: Double?

    init(id: String = UUID().uuidString.lowercased(), kind: NotebookShapeKind,
         x: Double = 80, y: Double = 80, width: Double = 220, height: Double = 140,
         text: String = "", color: String = PaperInkColor.graphite.rawValue,
         lineWidth: Double = 2.5, fontSize: Double = 20, filled: Bool = false,
         flippedX: Bool = false, flippedY: Bool = false,
         arrowStart: NotebookArrowPoint? = nil, arrowEnd: NotebookArrowPoint? = nil,
         startBinding: NotebookArrowBinding? = nil, endBinding: NotebookArrowBinding? = nil,
         rotation: Double? = nil, bend: Double? = nil) {
        self.id = id; self.kind = kind; self.x = x; self.y = y
        self.width = width; self.height = height; self.text = text; self.color = color
        self.lineWidth = lineWidth; self.fontSize = fontSize; self.filled = filled
        self.flippedX = flippedX; self.flippedY = flippedY
        self.arrowStart = arrowStart; self.arrowEnd = arrowEnd
        self.startBinding = startBinding; self.endBinding = endBinding
        self.rotation = rotation; self.bend = bend
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, x, y, width, height, text, color, lineWidth, fontSize, filled, flippedX, flippedY
        case arrowStart, arrowEnd, startBinding, endBinding, rotation, bend
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id); kind = try c.decode(NotebookShapeKind.self, forKey: .kind)
        x = try c.decode(Double.self, forKey: .x); y = try c.decode(Double.self, forKey: .y)
        width = try c.decode(Double.self, forKey: .width); height = try c.decode(Double.self, forKey: .height)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? PaperInkColor.graphite.rawValue
        lineWidth = try c.decodeIfPresent(Double.self, forKey: .lineWidth) ?? 2.5
        fontSize = try c.decodeIfPresent(Double.self, forKey: .fontSize) ?? 20
        filled = try c.decodeIfPresent(Bool.self, forKey: .filled) ?? false
        flippedX = try c.decodeIfPresent(Bool.self, forKey: .flippedX) ?? false
        flippedY = try c.decodeIfPresent(Bool.self, forKey: .flippedY) ?? false
        arrowStart = try c.decodeIfPresent(NotebookArrowPoint.self, forKey: .arrowStart)
        arrowEnd = try c.decodeIfPresent(NotebookArrowPoint.self, forKey: .arrowEnd)
        startBinding = try c.decodeIfPresent(NotebookArrowBinding.self, forKey: .startBinding)
        endBinding = try c.decodeIfPresent(NotebookArrowBinding.self, forKey: .endBinding)
        rotation = try c.decodeIfPresent(Double.self, forKey: .rotation)
        bend = try c.decodeIfPresent(Double.self, forKey: .bend)
    }

    var frame: CGRect { CGRect(x: x, y: y, width: width, height: height) }
    var hasVisibleContent: Bool { kind != .text || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var isValid: Bool {
        UUID(uuidString: id)?.uuidString.lowercased() == id
            && [x, y, width, height, lineWidth, fontSize].allSatisfy(\.isFinite)
            && x >= 0 && y >= 0 && width > 0 && height > 0
            && x + width <= 10_000 && y + height <= 1_000_000
            && (0.5...24).contains(lineWidth) && (8...96).contains(fontSize)
            && text.count <= 4000 && PaperInkColor(rawValue: color) != nil
            && rotation.map { $0.isFinite && abs($0) <= Double.pi } != false
            && bend.map { $0.isFinite && abs($0) <= 10_000 } != false
            && arrowMetadataIsValid
    }
    private var arrowMetadataIsValid: Bool {
        guard NotebookArrowGeometry.isConnector(self) else {
            return arrowStart == nil && arrowEnd == nil && startBinding == nil && endBinding == nil && bend == nil
        }

        guard rotation == nil, (arrowStart == nil) == (arrowEnd == nil),
              bend == nil || (arrowStart != nil && arrowEnd != nil),
              startBinding?.isValid != false, endBinding?.isValid != false,
              startBinding?.targetId != id, endBinding?.targetId != id else { return false }

        return [arrowStart, arrowEnd].compactMap { $0 }.allSatisfy {
            $0.isFinite && $0.x >= 0 && $0.y >= 0 && $0.x <= width && $0.y <= height
        }
    }
}

enum NotebookResizeCorner: String, CaseIterable {
    case topLeft, topRight, bottomLeft, bottomRight

    var horizontalSign: CGFloat { self == .topRight || self == .bottomRight ? 1 : -1 }
    var verticalSign: CGFloat { self == .bottomLeft || self == .bottomRight ? 1 : -1 }
    var opposite: NotebookResizeCorner {
        switch self {
        case .topLeft: return .bottomRight
        case .topRight: return .bottomLeft
        case .bottomLeft: return .topRight
        case .bottomRight: return .topLeft
        }
    }
}

/// Canonical geometry is independent of zoom. Container rotation is applied
/// around its center to paths, labels, handles and normalized connector anchors.
enum NotebookShapeGeometry {
    static func transform(for shape: NotebookShape) -> CGAffineTransform {
        let angle = CGFloat(shape.rotation ?? 0), c = cos(angle), s = sin(angle)
        let halfWidth = CGFloat(shape.width / 2), halfHeight = CGFloat(shape.height / 2)
        return CGAffineTransform(a: c, b: s, c: -s, d: c,
            tx: CGFloat(shape.x) + halfWidth - c * halfWidth + s * halfHeight,
            ty: CGFloat(shape.y) + halfHeight - s * halfWidth - c * halfHeight)
    }

    static func localPoint(_ point: CGPoint, in shape: NotebookShape) -> CGPoint {
        point.applying(transform(for: shape).inverted())
    }

    static func documentPoint(_ point: CGPoint, in shape: NotebookShape) -> CGPoint {
        point.applying(transform(for: shape))
    }

    static func corners(of shape: NotebookShape) -> [NotebookResizeCorner: CGPoint] {
        Dictionary(uniqueKeysWithValues: NotebookResizeCorner.allCases.map { corner in
            let local = CGPoint(x: corner.horizontalSign > 0 ? shape.width : 0,
                                y: corner.verticalSign > 0 ? shape.height : 0)
            return (corner, documentPoint(local, in: shape))
        })
    }

    /// The opposite corner remains stationary even for rotated rectangles.
    /// Crossing that corner reaches a minimum size instead of flipping a label.
    static func resizing(_ shape: NotebookShape, corner: NotebookResizeCorner, to point: CGPoint) -> NotebookShape {
        guard shape.isValid, point.x.isFinite, point.y.isFinite,
              let opposite = corners(of: shape)[corner.opposite] else { return shape }

        if NotebookArrowGeometry.isConnector(shape) {
            return proportionallyResizingConnector(shape, corner: corner, to: point, opposite: opposite)
        }

        let angle = CGFloat(shape.rotation ?? 0), c = cos(angle), s = sin(angle)
        let dx = point.x - opposite.x, dy = point.y - opposite.y
        let minimum: CGFloat = NotebookArrowGeometry.isConnector(shape) ? 1 : 24
        let width = max(minimum, (dx * c + dy * s) * corner.horizontalSign)
        var measured = shape
        measured.width = width
        let labelMinimum = NotebookArrowGeometry.isConnector(shape) ? minimum : max(minimum, CGFloat(NotebookShapeRenderer.requiredHeight(for: measured)))
        let height = max(labelMinimum, (-dx * s + dy * c) * corner.verticalSign)
        let center = CGPoint(x: opposite.x + (c * width * corner.horizontalSign - s * height * corner.verticalSign) / 2,
                             y: opposite.y + (s * width * corner.horizontalSign + c * height * corner.verticalSign) / 2)
        var result = shape
        result.x = center.x - width / 2; result.y = center.y - height / 2
        result.width = width; result.height = height
        return result
    }

    /// Quadratic midpoint curvature is closed under uniform scaling. Keeping
    /// that aspect ratio avoids silently distorting a curve with corner drags.
    private static func proportionallyResizingConnector(_ shape: NotebookShape, corner: NotebookResizeCorner,
                                                        to point: CGPoint, opposite: CGPoint) -> NotebookShape {
        guard shape.startBinding == nil, shape.endBinding == nil,
              let active = corners(of: shape)[corner] else { return shape }

        let dx = active.x - opposite.x, dy = active.y - opposite.y
        let denominator = dx * dx + dy * dy
        guard denominator > 0.000_001 else { return shape }

        let projection = ((point.x - opposite.x) * dx + (point.y - opposite.y) * dy) / denominator
        let scale = max(1 / max(shape.width, shape.height), projection)
        func scaled(_ point: CGPoint) -> CGPoint {
            CGPoint(x: opposite.x + (point.x - opposite.x) * scale,
                    y: opposite.y + (point.y - opposite.y) * scale)
        }
        var result = shape
        result.bend = shape.bend.map { $0 * scale }
        result = NotebookArrowGeometry.settingEndpoints(of: result,
            start: scaled(NotebookArrowGeometry.startPoint(of: shape)), end: scaled(NotebookArrowGeometry.endPoint(of: shape)))
        // Exact horizontal/vertical connectors retain a 1pt storage frame.
        // Its minimum dimension can round differently after scaling; keeping
        // the opposite frame corner fixed must not shift during that rounding.
        if let newOpposite = corners(of: result)[corner.opposite] {
            result.x += opposite.x - newOpposite.x
            result.y += opposite.y - newOpposite.y
        }
        return result
    }

    static func rotating(_ shape: NotebookShape, to point: CGPoint) -> NotebookShape {
        guard shape.isValid, point.x.isFinite, point.y.isFinite else { return shape }

        let center = CGPoint(x: shape.frame.midX, y: shape.frame.midY)
        guard hypot(point.x - center.x, point.y - center.y) > 0.000_001 else { return shape }

        return rotating(shape, radians: Double(atan2(point.y - center.y, point.x - center.x) + .pi / 2))
    }

    static func rotating(_ shape: NotebookShape, radians: Double) -> NotebookShape {
        guard shape.isValid, radians.isFinite else { return shape }

        var angle = radians.truncatingRemainder(dividingBy: 2 * .pi)
        if angle > .pi { angle -= 2 * .pi }
        if angle < -.pi { angle += 2 * .pi }
        var result = shape
        if NotebookArrowGeometry.isConnector(shape) {
            let center = CGPoint(x: shape.frame.midX, y: shape.frame.midY)
            func rotated(_ point: CGPoint) -> CGPoint {
                let dx = point.x - center.x, dy = point.y - center.y
                return CGPoint(x: center.x + dx * cos(angle) - dy * sin(angle),
                               y: center.y + dx * sin(angle) + dy * cos(angle))
            }
            result.startBinding = nil; result.endBinding = nil
            result = NotebookArrowGeometry.settingEndpoints(of: result,
                start: rotated(NotebookArrowGeometry.startPoint(of: shape)), end: rotated(NotebookArrowGeometry.endPoint(of: shape)))
        } else { result.rotation = abs(angle) < 0.000_000_001 ? nil : angle }
        return result
    }
}

enum NotebookArrowGeometry {
    static func isConnector(_ shape: NotebookShape) -> Bool { shape.kind == .arrow || shape.kind == .line }

    static func startPoint(of shape: NotebookShape) -> CGPoint {
        let local = shape.arrowStart?.point ?? CGPoint(x: shape.flippedX ? shape.width : 0, y: shape.flippedY ? shape.height : 0)
        return CGPoint(x: shape.x + local.x, y: shape.y + local.y)
    }

    static func endPoint(of shape: NotebookShape) -> CGPoint {
        let local = shape.arrowEnd?.point ?? CGPoint(x: shape.flippedX ? 0 : shape.width, y: shape.flippedY ? 0 : shape.height)
        return CGPoint(x: shape.x + local.x, y: shape.y + local.y)
    }

    static func bendPoint(of shape: NotebookShape) -> CGPoint {
        let start = startPoint(of: shape), end = endPoint(of: shape)
        let dx = end.x - start.x, dy = end.y - start.y, length = hypot(dx, dy)
        let offset = CGFloat(shape.bend ?? 0)
        guard length > 0.000_001 else { return start }

        return CGPoint(x: (start.x + end.x) / 2 - dy / length * offset,
                       y: (start.y + end.y) / 2 + dx / length * offset)
    }

    static func controlPoint(of shape: NotebookShape) -> CGPoint {
        let start = startPoint(of: shape), end = endPoint(of: shape), midpoint = bendPoint(of: shape)
        return CGPoint(x: 2 * midpoint.x - (start.x + end.x) / 2,
                       y: 2 * midpoint.y - (start.y + end.y) / 2)
    }

    /// A quadratic passes through this visible midpoint at t=1/2. Projecting
    /// onto the chord's normal avoids unstable off-axis handles or metadata.
    static func settingBend(of shape: NotebookShape, through point: CGPoint) -> NotebookShape {
        guard isConnector(shape), point.x.isFinite, point.y.isFinite else { return shape }

        let start = startPoint(of: shape), end = endPoint(of: shape)
        let dx = end.x - start.x, dy = end.y - start.y, length = hypot(dx, dy)
        guard length > 0.000_001 else { return shape }

        let offset = (point.x - (start.x + end.x) / 2) * -dy / length
            + (point.y - (start.y + end.y) / 2) * dx / length
        var result = shape
        result.bend = abs(offset) < 0.000_000_001 ? nil : Double(offset)
        return settingEndpoints(of: result, start: start, end: end)
    }

    /// Keeps binding metadata, labels, styles and signed curvature. Bounds use
    /// actual quadratic extrema, not its off-curve control point.
    static func settingEndpoints(of shape: NotebookShape, start: CGPoint, end: CGPoint) -> NotebookShape {
        guard isConnector(shape), [start.x, start.y, end.x, end.y].allSatisfy(\.isFinite) else { return shape }

        var result = shape
        let dx = end.x - start.x, dy = end.y - start.y, length = hypot(dx, dy)
        let offset = CGFloat(shape.bend ?? 0)
        let control = length > 0.000_001 ? CGPoint(x: (start.x + end.x) / 2 - 2 * dy / length * offset,
            y: (start.y + end.y) / 2 + 2 * dx / length * offset) : start
        var points = [start, end]
        func extrema(_ a: CGFloat, _ c: CGFloat, _ b: CGFloat) -> CGFloat? {
            let denominator = a - 2 * c + b
            guard abs(denominator) > 0.000_001 else { return nil }

            let t = (a - c) / denominator
            return t > 0 && t < 1 ? t : nil
        }
        for t in [extrema(start.x, control.x, end.x), extrema(start.y, control.y, end.y)].compactMap({ $0 }) {
            points.append(CGPoint(x: pow(1 - t, 2) * start.x + 2 * (1 - t) * t * control.x + t * t * end.x,
                                  y: pow(1 - t, 2) * start.y + 2 * (1 - t) * t * control.y + t * t * end.y))
        }
        result.x = min(points.map(\.x).min() ?? start.x, 9_999)
        result.y = min(points.map(\.y).min() ?? start.y, 999_999)
        result.width = max(1, (points.map(\.x).max() ?? end.x) - result.x)
        result.height = max(1, (points.map(\.y).max() ?? end.y) - result.y)
        result.arrowStart = NotebookArrowPoint(x: start.x - result.x, y: start.y - result.y)
        result.arrowEnd = NotebookArrowPoint(x: end.x - result.x, y: end.y - result.y)
        result.flippedX = end.x < start.x; result.flippedY = end.y < start.y
        result.rotation = nil
        return result
    }

    static func isBindable(_ shape: NotebookShape) -> Bool {
        shape.isValid && [.rectangle, .ellipse, .diamond].contains(shape.kind)
    }

    static func bindingPoint(_ binding: NotebookArrowBinding, in shapes: [NotebookShape]) -> CGPoint? {
        guard binding.isValid, let target = shapes.first(where: { $0.id == binding.targetId }), isBindable(target),
              isPerimeterAnchor(binding, for: target.kind) else { return nil }

        return NotebookShapeGeometry.documentPoint(CGPoint(x: target.width * binding.x, y: target.height * binding.y), in: target)
    }

    private static func isPerimeterAnchor(_ binding: NotebookArrowBinding, for kind: NotebookShapeKind) -> Bool {
        let nx = binding.x * 2 - 1, ny = binding.y * 2 - 1
        let epsilon = 0.000_001
        switch kind {
        case .rectangle: return min(min(binding.x, binding.y), min(1 - binding.x, 1 - binding.y)) <= epsilon
        case .ellipse: return abs(nx * nx + ny * ny - 1) <= epsilon
        case .diamond: return abs(abs(nx) + abs(ny) - 1) <= epsilon
        case .arrow, .line, .text: return false
        }
    }

    /// Snapping is an explicit gesture operation. Resolving a saved document
    /// never discovers or creates bindings for legacy unconnected arrows.
    static func nearestBinding(to point: CGPoint, in shapes: [NotebookShape], excludingId: String? = nil,
                               tolerance: CGFloat = 24, toward: CGPoint? = nil) -> NotebookArrowBinding? {
        guard point.x.isFinite, point.y.isFinite, tolerance.isFinite, tolerance > 0 else { return nil }

        var found: NotebookArrowBinding?
        var distance = CGFloat.infinity
        for target in shapes.reversed() where target.id != excludingId && isBindable(target) {
            let localPoint = NotebookShapeGeometry.localPoint(point, in: target)
            let localRect = CGRect(origin: .zero, size: target.frame.size)
            guard localRect.insetBy(dx: -tolerance, dy: -tolerance).contains(localPoint) else { continue }

            let perimeter = nearestPerimeterPoint(to: point, on: target)
            let nextDistance = hypot(perimeter.x - point.x, perimeter.y - point.y)
            let inside = contains(point, in: target)
            guard inside || nextDistance <= tolerance else { continue }

            if found == nil || nextDistance < distance {
                let anchor = inside ? directionalPerimeterPoint(from: point, toward: toward, on: target) ?? perimeter : perimeter
                let localAnchor = NotebookShapeGeometry.localPoint(anchor, in: target)
                found = NotebookArrowBinding(targetId: target.id, x: min(1, max(0, localAnchor.x / target.width)),
                                             y: min(1, max(0, localAnchor.y / target.height)))
                distance = nextDistance
            }
        }
        return found
    }

    /// Starting a connector inside a box uses its facing edge, rather than the
    /// nearest (often top) edge. This avoids crossing the target's interior.
    private static func directionalPerimeterPoint(from point: CGPoint, toward: CGPoint?, on target: NotebookShape) -> CGPoint? {
        guard let toward, toward.x.isFinite, toward.y.isFinite else { return nil }

        let point = NotebookShapeGeometry.localPoint(point, in: target)
        let localToward = NotebookShapeGeometry.localPoint(toward, in: target)
        let dx = localToward.x - point.x, dy = localToward.y - point.y
        guard hypot(dx, dy) > 0.000_001 else { return nil }

        let center = CGPoint(x: target.width / 2, y: target.height / 2)
        let u = (point.x - center.x) / (target.width / 2), v = (point.y - center.y) / (target.height / 2)
        let du = dx / (target.width / 2), dv = dy / (target.height / 2)
        var amount: CGFloat?
        if target.kind == .ellipse {
            let a = du * du + dv * dv, b = 2 * (u * du + v * dv), c = u * u + v * v - 1
            let discriminant = b * b - 4 * a * c
            guard a > 0, discriminant >= -0.000_001 else { return nil }

            amount = (-b + sqrt(max(0, discriminant))) / (2 * a)
        } else {
            let planes: [(CGFloat, CGFloat)] = target.kind == .diamond ? [(1, 1), (1, -1), (-1, 1), (-1, -1)] : [(1, 0), (-1, 0), (0, 1), (0, -1)]
            let candidates = planes.compactMap { sx, sy -> CGFloat? in
                let direction = sx * du + sy * dv
                guard direction > 0.000_001 else { return nil }

                let next = (1 - sx * u - sy * v) / direction
                return next >= -0.000_001 ? max(0, next) : nil
            }
            amount = candidates.min()
        }
        guard let amount, amount.isFinite, amount >= 0 else { return nil }

        return NotebookShapeGeometry.documentPoint(CGPoint(x: point.x + amount * dx, y: point.y + amount * dy), in: target)
    }

    private static func contains(_ point: CGPoint, in shape: NotebookShape) -> Bool {
        let point = NotebookShapeGeometry.localPoint(point, in: shape)
        let nx = point.x / shape.width * 2 - 1, ny = point.y / shape.height * 2 - 1
        switch shape.kind {
        case .rectangle: return CGRect(origin: .zero, size: shape.frame.size).contains(point)
        case .ellipse: return nx * nx + ny * ny <= 1
        case .diamond: return abs(nx) + abs(ny) <= 1
        case .arrow, .line, .text: return false
        }
    }

    /// Missing targets detach at the arrow's last materialized position. Other
    /// malformed references are retained so validation rejects corrupt input.
    static func resolvingBindings(in shapes: [NotebookShape]) -> [NotebookShape] {
        let ids = Set(shapes.map(\.id))
        return shapes.map { original in
            guard isConnector(original), original.startBinding != nil || original.endBinding != nil else { return original }

            var result = original
            var start = startPoint(of: original), end = endPoint(of: original)
            if let binding = original.startBinding {
                if !ids.contains(binding.targetId) { result.startBinding = nil }
                else if binding.targetId != original.id, let point = bindingPoint(binding, in: shapes) { start = point }
            }
            if let binding = original.endBinding {
                if !ids.contains(binding.targetId) { result.endBinding = nil }
                else if binding.targetId != original.id, let point = bindingPoint(binding, in: shapes) { end = point }
            }
            return settingEndpoints(of: result, start: start, end: end)
        }
    }

    /// Resolve while the target still exists, then detach its connectors. This
    /// preserves the current endpoint if a target changed just before deletion.
    static func detachingBindings(to targetId: String, in shapes: [NotebookShape]) -> [NotebookShape] {
        resolvingBindings(in: shapes).map { original in
            var result = original
            if result.startBinding?.targetId == targetId { result.startBinding = nil }
            if result.endBinding?.targetId == targetId { result.endBinding = nil }
            return result
        }
    }

    private static func nearestPerimeterPoint(to point: CGPoint, on target: NotebookShape) -> CGPoint {
        let point = NotebookShapeGeometry.localPoint(point, in: target)
        let rect = CGRect(origin: .zero, size: target.frame.size)
        func segment(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
            let dx = b.x - a.x, dy = b.y - a.y
            let amount = min(1, max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)))
            return CGPoint(x: a.x + amount * dx, y: a.y + amount * dy)
        }
        func nearest(_ points: [CGPoint]) -> CGPoint {
            points.min { hypot($0.x - point.x, $0.y - point.y) < hypot($1.x - point.x, $1.y - point.y) } ?? rect.origin
        }
        if target.kind == .rectangle {
            return NotebookShapeGeometry.documentPoint(nearest([segment(CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY)),
                            segment(CGPoint(x: rect.maxX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.maxY)),
                            segment(CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY)),
                            segment(CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.minY))]), in: target)
        }
        if target.kind == .diamond {
            let corners = [CGPoint(x: rect.midX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.midY),
                           CGPoint(x: rect.midX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.midY)]
            return NotebookShapeGeometry.documentPoint(nearest((0..<4).map { segment(corners[$0], corners[($0 + 1) % 4]) }), in: target)
        }

        // Search the ellipse's nearest perimeter rather than radially
        // projecting; eccentric ovals must snap close to the user's endpoint.
        func ellipse(_ angle: CGFloat) -> CGPoint {
            CGPoint(x: rect.midX + rect.width / 2 * cos(angle), y: rect.midY + rect.height / 2 * sin(angle))
        }
        func squaredDistance(_ angle: CGFloat) -> CGFloat {
            let candidate = ellipse(angle)
            return pow(candidate.x - point.x, 2) + pow(candidate.y - point.y, 2)
        }
        let step = 2 * CGFloat.pi / 96
        let best = (0..<96).min { squaredDistance(CGFloat($0) * step) < squaredDistance(CGFloat($1) * step) } ?? 0
        var low = CGFloat(best) * step - step, high = CGFloat(best) * step + step
        for _ in 0..<32 {
            let left = low + (high - low) / 3, right = high - (high - low) / 3
            if squaredDistance(left) < squaredDistance(right) { high = right } else { low = left }
        }
        return NotebookShapeGeometry.documentPoint(ellipse((low + high) / 2), in: target)
    }
}

/// Shared paths and label metrics keep live editable objects and exported work
/// identical. Text never truncates; complete labels contribute to page bounds.
enum NotebookShapeRenderer {
    static func path(for shape: NotebookShape) -> UIBezierPath {
        guard shape.isValid else { return UIBezierPath() }
        let rect = CGRect(origin: .zero, size: shape.frame.size)
        switch shape.kind {
        case .rectangle: return UIBezierPath(roundedRect: rect, cornerRadius: min(12, min(rect.width, rect.height) / 6))
        case .ellipse: return UIBezierPath(ovalIn: rect)
        case .diamond:
            let path = UIBezierPath()
            path.move(to: CGPoint(x: rect.midX, y: 0)); path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY)); path.addLine(to: CGPoint(x: 0, y: rect.midY)); path.close()
            return path
        case .arrow, .line:
            let path = shaftPath(for: shape)
            if shape.kind == .arrow { path.append(headPath(for: shape)) }
            return path
        case .text: return UIBezierPath()
        }
    }

    /// A separate shaft avoids filling the open quadratic when the arrowhead
    /// is solid. Canvas and export share these exact component paths.
    static func shaftPath(for shape: NotebookShape) -> UIBezierPath {
        guard shape.isValid, NotebookArrowGeometry.isConnector(shape) else { return UIBezierPath() }

        let start = NotebookArrowGeometry.startPoint(of: shape), end = NotebookArrowGeometry.endPoint(of: shape)
        guard hypot(end.x - start.x, end.y - start.y) > 0.000_001 else { return UIBezierPath() }

        let path = UIBezierPath()
        path.move(to: CGPoint(x: start.x - shape.x, y: start.y - shape.y))
        let localEnd = CGPoint(x: end.x - shape.x, y: end.y - shape.y)
        if shape.bend == nil || shape.bend == 0 { path.addLine(to: localEnd) }
        else {
            let control = NotebookArrowGeometry.controlPoint(of: shape)
            path.addQuadCurve(to: localEnd, controlPoint: CGPoint(x: control.x - shape.x, y: control.y - shape.y))
        }
        return path
    }

    static func headPath(for shape: NotebookShape) -> UIBezierPath {
        guard shape.isValid, shape.kind == .arrow else { return UIBezierPath() }

        let start = NotebookArrowGeometry.startPoint(of: shape), end = NotebookArrowGeometry.endPoint(of: shape)
        let length = hypot(end.x - start.x, end.y - start.y)
        guard length > 0.000_001 else { return UIBezierPath() }

        let control = NotebookArrowGeometry.controlPoint(of: shape)
        var dx = end.x - control.x, dy = end.y - control.y
        if hypot(dx, dy) < 0.000_001 { dx = end.x - start.x; dy = end.y - start.y }
        let tangentLength = hypot(dx, dy), ux = dx / tangentLength, uy = dy / tangentLength
        let head = min(24, length * 0.3), spread = min(head * 0.45, max(4, CGFloat(shape.lineWidth) * 1.5))
        let localEnd = CGPoint(x: end.x - shape.x, y: end.y - shape.y)
        let base = CGPoint(x: localEnd.x - ux * head, y: localEnd.y - uy * head)
        let path = UIBezierPath()
        path.move(to: CGPoint(x: base.x - uy * spread, y: base.y + ux * spread))
        path.addLine(to: localEnd)
        path.addLine(to: CGPoint(x: base.x + uy * spread, y: base.y - ux * spread))
        if shape.filled { path.close() }
        return path
    }

    static func documentPath(for shape: NotebookShape) -> UIBezierPath {
        guard shape.isValid else { return UIBezierPath() }

        let path = path(for: shape)
        path.apply(NotebookShapeGeometry.transform(for: shape))
        return path
    }

    static func documentLabelBounds(for shape: NotebookShape) -> CGRect {
        let label = labelRect(for: shape)
        return label.isEmpty ? .zero : label.applying(NotebookShapeGeometry.transform(for: shape))
    }

    static func documentBounds(for shape: NotebookShape) -> CGRect {
        let label = documentLabelBounds(for: shape)
        let path = documentPath(for: shape)
        guard !path.isEmpty else { return label }

        let outline = path.cgPath.boundingBoxOfPath.insetBy(dx: -shape.lineWidth / 2 - 2, dy: -shape.lineWidth / 2 - 2)
        return label.isEmpty ? outline : outline.union(label)
    }

    static func font(for shape: NotebookShape) -> UIFont { .systemFont(ofSize: shape.fontSize, weight: .medium) }
    private static func labelWidth(for shape: NotebookShape) -> CGFloat {
        switch shape.kind {
        case .ellipse: return max(1, shape.width * 0.65 - 24)
        case .diamond: return max(1, shape.width * 0.5 - 24)
        case .rectangle: return max(1, shape.width - 24)
        case .arrow, .line, .text: return max(1, shape.width)
        }
    }
    private static func measuredLabelHeight(for shape: NotebookShape) -> CGFloat {
        guard shape.isValid, !shape.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return 0 }
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center; paragraph.lineBreakMode = .byWordWrapping
        return ceil((shape.text as NSString).boundingRect(with: CGSize(width: labelWidth(for: shape), height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font(for: shape), .paragraphStyle: paragraph], context: nil).height)
    }
    static func requiredHeight(for shape: NotebookShape) -> Double {
        let height = Double(measuredLabelHeight(for: shape))
        switch shape.kind {
        case .arrow, .line: return shape.height
        case .text: return max(24, height)
        case .rectangle: return max(24, height + 24)
        case .ellipse: return max(24, (height + 24) / 0.65)
        case .diamond: return max(24, (height + 24) * 2)
        }
    }
    static func labelRect(for shape: NotebookShape) -> CGRect {
        let height = measuredLabelHeight(for: shape)
        guard height > 0 else { return .zero }
        let width = labelWidth(for: shape)
        let x = (shape.width - width) / 2
        if NotebookArrowGeometry.isConnector(shape) { return CGRect(x: x, y: shape.height + 8, width: width, height: height) }
        return CGRect(x: x, y: max(0, (shape.height - height) / 2), width: width, height: height)
    }

    static func draw(shape: NotebookShape, in context: CGContext, appearance: UIUserInterfaceStyle) {
        guard shape.isValid, shape.hasVisibleContent else { return }
        let savedColor = PaperInkColor(rawValue: shape.color)?.color ?? .black
        let color = appearance == .dark ? PKInkingTool.convertColor(savedColor, from: .light, to: .dark) : savedColor
        context.saveGState(); defer { context.restoreGState() }
        context.concatenate(NotebookShapeGeometry.transform(for: shape))
        if shape.kind != .text {
            context.setStrokeColor(color.cgColor); context.setLineWidth(shape.lineWidth)
            context.setLineCap(.round); context.setLineJoin(.round)
            if NotebookArrowGeometry.isConnector(shape) {
                context.addPath(shaftPath(for: shape).cgPath)
                context.strokePath()
                if shape.kind == .arrow {
                    context.addPath(headPath(for: shape).cgPath)
                    if shape.filled { context.setFillColor(color.cgColor); context.drawPath(using: .fillStroke) }
                    else { context.strokePath() }
                }
            } else {
                context.addPath(path(for: shape).cgPath)
                if shape.filled {
                    context.setFillColor(color.withAlphaComponent(0.12).cgColor)
                    context.drawPath(using: .fillStroke)
                } else { context.strokePath() }
            }
        }
        let label = labelRect(for: shape)
        if !label.isEmpty {
            let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center; paragraph.lineBreakMode = .byWordWrapping
            UIGraphicsPushContext(context); defer { UIGraphicsPopContext() }
            (shape.text as NSString).draw(with: label, options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: [.font: font(for: shape), .foregroundColor: color, .paragraphStyle: paragraph], context: nil)
        }
    }
}

enum NotebookArtwork {
    static func validate(shapes: [NotebookShape]) throws {
        guard shapes.count <= 500, Set(shapes.map(\.id)).count == shapes.count,
              shapes.allSatisfy(\.isValid) else { throw PadError.rejected("This page has an invalid or oversized diagram object. Existing work is kept.") }
        for shape in shapes {
            for binding in [shape.startBinding, shape.endBinding].compactMap({ $0 }) {
                guard binding.targetId != shape.id, NotebookArrowGeometry.bindingPoint(binding, in: shapes) != nil else {
                    throw PadError.rejected("This arrow has an invalid connection. Existing work is kept.")
                }
            }

            try validateGeometry(of: shape)
        }

        // Saved endpoints are a materialized cache. A later target transform
        // may put a curved connector beyond the page despite valid cached
        // bounds; reject that archive instead of silently dropping its curve.
        // Nil-bend legacy connectors retain their earlier load behavior.
        for shape in NotebookArrowGeometry.resolvingBindings(in: shapes)
            where shape.bend != nil && (shape.startBinding != nil || shape.endBinding != nil) {
            try validateGeometry(of: shape)
        }
    }

    private static func validateGeometry(of shape: NotebookShape) throws {
        guard shape.isValid else { throw PadError.rejected("This connected object has invalid resolved bounds. Existing work is kept.") }

        let label = NotebookShapeRenderer.documentLabelBounds(for: shape)
        guard label.isEmpty || (PaperGeometry.hasFiniteInkBounds(label) && label.maxY <= 1_000_000) else {
            throw PadError.rejected("This label is too large for the page. Shorten it or move the object upward.")
        }
        if shape.bend != nil {
            let shaft = NotebookShapeRenderer.shaftPath(for: shape)
            let bounds = shaft.cgPath.boundingBoxOfPath
            guard !shaft.isEmpty, !bounds.isNull, !bounds.isInfinite,
                  bounds.minX >= -0.000_001, bounds.minY >= -0.000_001,
                  bounds.maxX <= shape.width + 0.000_001, bounds.maxY <= shape.height + 0.000_001 else {
                throw PadError.rejected("This curve has invalid saved bounds. Existing work is kept.")
            }
        }
        if shape.rotation != nil || shape.bend != nil {
            let path = NotebookShapeRenderer.documentPath(for: shape)
            let pathBounds = path.cgPath.boundingBoxOfPath
            let geometry = path.isEmpty ? (label.isEmpty ? CGRect(origin: .zero, size: shape.frame.size).applying(NotebookShapeGeometry.transform(for: shape)) : label)
                : (label.isEmpty ? pathBounds : pathBounds.union(label))
            guard !geometry.isNull, !geometry.isInfinite, [geometry.minX, geometry.minY, geometry.maxX, geometry.maxY].allSatisfy(\.isFinite), geometry.minX >= -0.000_001,
                  geometry.minY >= -0.000_001, geometry.maxX <= 10_000, geometry.maxY <= 1_000_000 else {
                throw PadError.rejected("This rotated or curved object extends beyond the page. Move it inward or make it smaller.")
            }
        }
    }
    static func hasVisibleContent(drawing: PKDrawing, shapes: [NotebookShape]) -> Bool {
        !drawing.strokes.isEmpty || shapes.contains { $0.isValid && $0.hasVisibleContent }
    }
    static func contentBounds(drawing: PKDrawing, shapes: [NotebookShape]) -> CGRect? {
        var bounds: CGRect?
        func include(_ next: CGRect) {
            guard PaperGeometry.hasFiniteInkBounds(next) else { return }
            bounds = bounds.map { $0.union(next) } ?? next
        }
        if !drawing.strokes.isEmpty { include(drawing.bounds) }
        for shape in NotebookArrowGeometry.resolvingBindings(in: shapes) where shape.isValid && shape.hasVisibleContent {
            if shape.kind != .text {
                include(NotebookShapeRenderer.documentPath(for: shape).cgPath.boundingBoxOfPath
                    .insetBy(dx: -shape.lineWidth / 2 - 2, dy: -shape.lineWidth / 2 - 2))
            }
            include(NotebookShapeRenderer.documentLabelBounds(for: shape))
        }
        return bounds
    }
    static func render(drawing: PKDrawing, shapes: [NotebookShape], bounds: CGRect, scale: CGFloat) -> UIImage {
        let valid = PaperGeometry.hasFiniteInkBounds(bounds) && scale.isFinite && scale > 0 && scale <= 4
            && bounds.width * scale >= 1 && bounds.height * scale >= 1
            && bounds.width * scale <= 16384 && bounds.height * scale <= 16384
            && bounds.width * bounds.height * scale * scale <= 32_000_000
        let size = valid ? bounds.size : CGSize(width: 1, height: 1)
        let format = UIGraphicsImageRendererFormat(); format.scale = valid ? scale : 1; format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { result in
            UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
                UIColor.white.setFill(); result.fill(CGRect(origin: .zero, size: size))
                guard valid else { return }
                if !drawing.strokes.isEmpty { drawing.image(from: bounds, scale: scale).draw(in: CGRect(origin: .zero, size: bounds.size)) }
                result.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
                for shape in NotebookArrowGeometry.resolvingBindings(in: shapes) { NotebookShapeRenderer.draw(shape: shape, in: result.cgContext, appearance: .light) }
            }
        }
    }
}

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
    /// Local navigation only; missing in earlier indexes and never submitted.
    var lastOpenedPageId: String? = nil
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
