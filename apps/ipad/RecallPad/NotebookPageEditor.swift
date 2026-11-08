import SwiftUI
import PencilKit

/// Reuses the native writing surface while keeping personal pages out of live
/// question navigation, grading, chat binding and automatic capture.
struct NotebookPageEditor: View {
    let initialPage: PadNotebookPage
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @Environment(\.colorScheme) private var colorScheme
    @State private var page: PadNotebookPage
    @State private var drawing = PKDrawing()
    @State private var shapes: [NotebookShape] = []
    @State private var diagramTool: NotebookDiagramTool = .none
    @State private var selectedShapeId: String?
    @State private var height = 1800.0
    @State private var tool: PaperTool = .pen
    @State private var command: PaperCanvas.CanvasCommand?
    @State private var showToolSettings = false
    @State private var saveTask: Task<Void, Never>?
    @State private var dirty = false
    @State private var deleted = false
    @State private var loaded = false
    @State private var error: String?
    @State private var sendScope: NotebookSendScope?
    @State private var showDelete = false
    @State private var showRename = false
    @State private var pageTitle = ""
    @State private var showPages = false
    @State private var showSentReceipts = false
    @State private var editingNoteTitle = false
    @State private var noteTitleDraft = ""
    @State private var showShapes = false
    @State private var showDiagramTools = false
    @State private var showShapeStyle = false
    @State private var showShapeText = false
    @FocusState private var noteTitleFocused: Bool
    @FocusState private var shapeTextFocused: Bool
    @AppStorage("paperInkColorV1") private var inkColorName = PaperInkColor.graphite.rawValue
    @AppStorage("paperPenWidthV1") private var savedPenWidth = 2.5
    @AppStorage("paperEraserWidthV1") private var savedEraserWidth = 24.0
    @AppStorage("padLastWorkV1") private var lastWork = ""

    private var notebookKeyboardActionsEnabled: Bool { !editingNoteTitle && !showShapeText && !showShapeStyle && !showToolSettings && !showShapes && !showDiagramTools && !showRename && !showDelete && !showPages && sendScope == nil && error == nil }
    private var note: PadNotebookNote? { notebooks.notes.first { $0.id == page.noteId } }
    private var orderedPages: [PadNotebookPage] { note.map { notebooks.pages(in: $0) } ?? [] }
    private var pageIndex: Int { orderedPages.firstIndex { $0.id == page.id } ?? 0 }
    private var selectedShape: NotebookShape? { shapes.first { $0.id == selectedShapeId } }
    private var hasContent: Bool { !drawing.strokes.isEmpty || shapes.contains { $0.kind != .text || !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    private var inkColor: PaperInkColor { PaperInkColor(rawValue: inkColorName) ?? .graphite }
    private var penWidth: Double { PaperToolSizing.penWidth(savedPenWidth) }
    private var eraserWidth: Double { PaperToolSizing.eraserWidth(savedEraserWidth) }
    private var penWidthBinding: Binding<Double> { Binding(get: { penWidth }, set: { savedPenWidth = PaperToolSizing.penWidth($0) }) }
    private var eraserWidthBinding: Binding<Double> { Binding(get: { eraserWidth }, set: { savedEraserWidth = PaperToolSizing.eraserWidth($0) }) }

    init(initialPage: PadNotebookPage) {
        self.initialPage = initialPage
        _page = State(initialValue: initialPage)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                writingToolbar
                    .disabled(!loaded)
                PaperCanvas(drawing: $drawing, height: $height, style: page.paperStyle, tool: tool, onChanged: scheduleSave, command: command, inkColor: inkColor, penWidth: penWidth, eraserWidth: eraserWidth, shapes: $shapes, diagramTool: diagramTool, selectedShapeId: $selectedShapeId, onEditShapeText: editShapeText, continuous: true, onDiagramToolChanged: { diagramTool = $0 }, notebookKeyboardActionsEnabled: notebookKeyboardActionsEnabled)
                    .id(page.id)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border))
                    .overlay(alignment: .bottom) {
                        if diagramTool != .none, let shape = selectedShape {
                            shapeInspector(shape).padding(12)
                        }
                    }
                    .overlay(alignment: .top) {
                        if diagramTool != .none, selectedShape == nil {
                            Text(diagramInstruction).font(.caption).foregroundStyle(PadPalette.muted)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(.regularMaterial, in: Capsule()).padding(10)
                                .allowsHitTesting(false)
                        }
                    }
                    .padding(.horizontal, 12)
                    .disabled(!loaded)
                    .accessibilityIdentifier("notebook-writing-canvas")
                pageStrip
            }
            .background(PadPalette.background)
            .navigationTitle(note?.title ?? "Notebook page")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(PadPalette.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { if saveNow() { dismiss() } }.accessibilityIdentifier("notebook-editor-done") }
                ToolbarItem(placement: .principal) { noteTitleControl }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Pages", systemImage: "square.grid.2x2") { openPages() }
                        .labelStyle(.iconOnly).disabled(!loaded).accessibilityIdentifier("notebook-editor-pages")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Add another sheet", systemImage: "doc.badge.plus") { addPage() }
                            .disabled(!loaded).accessibilityIdentifier("notebook-editor-add-page")
                        Button("Rename page", systemImage: "pencil") { pageTitle = page.title; showRename = true }
                        Button("Add this note to Recall…", systemImage: "arrow.up.doc") { if saveNow() { sendScope = .note(page.noteId) } }.disabled(bridge.pairedMac == nil)
                        Divider()
                        Button("Delete page…", systemImage: "trash", role: .destructive) { showDelete = true }
                            .disabled(bridge.activeNotebookNoteId == page.noteId)
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("Notebook page options")
                }
            }
            .task { if !loaded { load(initialPage) } }
            .onChange(of: phase) { _, value in if value != .active { _ = saveNow() } }
            .onChange(of: noteTitleFocused) { _, focused in
                if !focused, editingNoteTitle, error == nil { _ = saveNoteTitle() }
            }
            .onChange(of: selectedShapeId) { _, _ in showShapeStyle = false }
            .onDisappear { saveTask?.cancel(); if !deleted { _ = saveNow() } }
            .sheet(isPresented: $showPages) {
                NotebookPageBrowser(noteId: page.noteId, currentPageId: page.id, showSent: showSentReceipts, onOpen: { selected in
                    guard saveNow() else { return false }
                    return load(selected)
                }, onDelete: { removed in
                    if removed.id == page.id {
                        saveTask?.cancel()
                        deleted = true
                        dirty = false
                        showPages = false
                        dismiss()
                    }
                })
            }
            .sheet(item: $sendScope) { NotebookSendPreview(scope: $0) }
            .sheet(isPresented: $showShapeText) { shapeTextEditor }
            .alert("Rename page", isPresented: $showRename) {
                TextField("Page title", text: $pageTitle)
                Button("Save") {
                    guard !pageTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                    page.title = pageTitle
                    dirty = true
                    _ = saveNow()
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Delete this page?", isPresented: $showDelete) {
                Button("Delete page", role: .destructive) { deletePage() }
                Button("Cancel", role: .cancel) {}
            } message: { Text("This page and any snapshot containing it that is still waiting to send will be removed from this iPad. Unsent writing will be lost. This cannot be undone. Earlier received Mac and KB copies remain.") }
            .alert("Your work is kept", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
            .interactiveDismissDisabled(dirty || editingNoteTitle || showDelete || showShapeText)
        }
    }

    @ViewBuilder private var noteTitleControl: some View {
        if editingNoteTitle {
            TextField("Note title", text: $noteTitleDraft)
                .font(.system(.headline, design: .serif)).multilineTextAlignment(.center)
                .frame(maxWidth: 280).focused($noteTitleFocused).submitLabel(.done)
                .onSubmit { _ = saveNoteTitle() }
                .accessibilityIdentifier("notebook-editor-title-field")
        } else {
            Button {
                noteTitleDraft = note?.title ?? "Untitled note"
                editingNoteTitle = true
                noteTitleFocused = true
            } label: {
                HStack(spacing: 6) {
                    Text(note?.title ?? "Untitled note").font(.system(.headline, design: .serif)).lineLimit(1)
                    Image(systemName: "pencil").font(.caption2).foregroundStyle(PadPalette.muted)
                }.foregroundStyle(PadPalette.text).frame(minHeight: 44).frame(maxWidth: 280)
            }
            .buttonStyle(.plain).disabled(!loaded).accessibilityLabel("Rename note")
            .accessibilityValue(note?.title ?? "Untitled note").accessibilityIdentifier("notebook-editor-title")
        }
    }

    private var pageStrip: some View {
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { pageNavigation; Spacer(minLength: 8); sendButton.fixedSize(horizontal: true, vertical: false) }
                VStack(alignment: .leading, spacing: 6) { pageNavigation; sendButton.frame(maxWidth: .infinity, alignment: .trailing) }
            }
            submissionReceipt
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(.thinMaterial)
        .overlay(alignment: .top) { Rectangle().fill(PadPalette.border).frame(height: 1) }
        .accessibilityIdentifier("notebook-page-strip")
    }

    private var submissionReceipt: some View {
        let receipt = NotebookWritingReceipt.resolve(page: page, submissions: notebooks.submissions, dirty: dirty)
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: receipt.symbol).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(receipt.title).font(.caption.weight(.medium))
                Text(bridge.pairedMac == nil && !receipt.hasSubmission ? "Pair with your Mac to share selected work. Writing stays private." : receipt.detail).font(.caption2)
            }
            Spacer(minLength: 4)
            if receipt.hasSubmission {
                Button("Details") { openPages(showSent: true) }
                    .font(.caption).frame(minHeight: 44)
                    .accessibilityLabel("View saved submission receipts")
            }
        }
        .foregroundStyle(PadPalette.muted)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notebook-inline-receipt")
    }

    private var pageNavigation: some View {
        HStack(spacing: 4) {
            if orderedPages.count > 1 {
                Button { navigate(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                    .disabled(pageIndex <= 0).accessibilityLabel("Previous notebook page")
            }
            Button { openPages() } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(orderedPages.count == 1 ? "Continuous sheet" : page.title).font(.subheadline.weight(.medium)).foregroundStyle(PadPalette.text).lineLimit(1)
                        Text(orderedPages.count == 1 ? (dirty ? "Saving…" : "Saved on iPad · Pinch to zoom") : "\(pageIndex + 1) of \(orderedPages.count) · \(dirty ? "Saving…" : "Saved on iPad")").font(.caption).foregroundStyle(PadPalette.muted)
                    }
                    Image(systemName: "chevron.down").font(.caption).foregroundStyle(PadPalette.muted)
                }.frame(minWidth: 115, minHeight: 44, alignment: .leading)
            }.accessibilityLabel("Browse pages").accessibilityIdentifier("notebook-editor-page-position")
            if orderedPages.count > 1 {
                Button { navigate(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                    .disabled(pageIndex + 1 >= orderedPages.count).accessibilityLabel("Next notebook page")
            }
        }.buttonStyle(.plain)
    }

    private var sendButton: some View {
        Button { if saveNow() { sendScope = .pages(noteId: page.noteId, pageIds: [page.id]) } } label: {
            Label("Add to Recall…", systemImage: "arrow.up.doc")
                .font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 12)
                .foregroundStyle(!hasContent || bridge.pairedMac == nil ? PadPalette.muted : PadPalette.accentInk)
                .background(!hasContent || bridge.pairedMac == nil ? PadPalette.raised : PadPalette.accent, in: Capsule())
        }
        .buttonStyle(.plain).disabled(!hasContent || bridge.pairedMac == nil)
        .accessibilityIdentifier("notebook-send-page")
    }

    private var writingToolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    writingToolButton("Write", icon: "pencil.tip", value: .pen, showTitle: true)
                    writingToolButton("Ink eraser", icon: "eraser", value: .eraser)
                    Button { command = .init(id: UUID(), undo: true) } label: { Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44) }.accessibilityLabel("Undo")
                    Divider().frame(height: 24).padding(.horizontal, 4)
                    Button { showDiagramTools.toggle() } label: {
                        Label(creationToolTitle, systemImage: "square.on.circle")
                            .font(.subheadline.weight(.medium)).frame(minHeight: 44).padding(.horizontal, 8)
                            .background(diagramTool != .none && diagramTool != .select ? PadPalette.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .accessibilityLabel("Shapes and text").accessibilityValue(creationToolTitle)
                    .accessibilityIdentifier("notebook-shapes-menu")
                    .popover(isPresented: $showDiagramTools) { creationTools.padding(16).frame(width: 280).presentationCompactAdaptation(.popover) }
                    diagramToolbarButton("Select objects", icon: "cursorarrow", value: .select)
                    Divider().frame(height: 24).padding(.horizontal, 4)
                    if diagramTool != .none || tool != .select {
                        Button { showToolSettings.toggle() } label: {
                            HStack(spacing: 5) {
                                if diagramTool != .none || tool == .pen { Circle().fill(inkColor.displayColor(for: colorScheme)).frame(width: 18, height: 18).overlay(Circle().strokeBorder(PadPalette.border)) }
                                else { Image(systemName: "eraser"); Text(eraserWidth.formatted(.number.precision(.fractionLength(0)))).font(.caption).monospacedDigit() }
                                Image(systemName: "chevron.down").font(.caption2)
                            }.frame(minWidth: 44, minHeight: 44)
                        }.accessibilityLabel(diagramTool != .none || tool == .pen ? "Ink color and line thickness" : "Eraser size")
                        .popover(isPresented: $showToolSettings) { toolSettings.padding(20).frame(width: 320).presentationCompactAdaptation(.popover) }
                    }
                    Menu {
                        Button("Redo", systemImage: "arrow.uturn.forward") { command = .init(id: UUID(), undo: false) }
                        Button("Select ink strokes", systemImage: "lasso") { chooseWritingTool(.select) }
                        Button("Objects on this sheet", systemImage: "square.stack.3d.up") { showShapes = true }
                        Menu("Paper", systemImage: "square.grid.3x3") {
                            ForEach(PaperStyle.allCases, id: \.self) { style in
                                Button { page.paperStyle = style; scheduleSave() } label: {
                                    if page.paperStyle == style { Label(style.rawValue.capitalized, systemImage: "checkmark") } else { Text(style.rawValue.capitalized) }
                                }
                            }
                        }
                    } label: {
                        Image(systemName: tool == .select && diagramTool == .none ? "lasso" : "ellipsis")
                            .frame(width: 44, height: 44)
                            .background(tool == .select && diagramTool == .none ? PadPalette.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                    }.accessibilityLabel("More tools, objects and paper").accessibilityIdentifier("notebook-more-tools")
                    .popover(isPresented: $showShapes) { shapesPalette.padding(16).frame(width: 300).presentationCompactAdaptation(.popover) }
                }
        }.frame(height: 44)
        .buttonStyle(.plain).foregroundStyle(PadPalette.text)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border))
        .padding(.horizontal, 12).padding(.vertical, 8)
        .onChange(of: tool) { _, _ in showToolSettings = false }
    }

    private func chooseWritingTool(_ value: PaperTool) {
        diagramTool = .none
        selectedShapeId = nil
        tool = value
        showToolSettings = false
        showShapeStyle = false
        showDiagramTools = false
    }

    private var creationToolTitle: String {
        switch diagramTool {
        case .none, .select: return "Shapes"
        case .ellipse: return "Circle"
        default: return diagramTool.rawValue.capitalized
        }
    }

    private var creationTools: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Shapes & text").font(.system(.headline, design: .serif))
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                creationTool("Rectangle", icon: "rectangle", value: .rectangle)
                creationTool("Circle", icon: "circle", value: .ellipse)
                creationTool("Diamond", icon: "diamond", value: .diamond)
                creationTool("Line", icon: "line.diagonal", value: .line)
                creationTool("Arrow", icon: "arrow.up.right", value: .arrow)
                creationTool("Text", icon: "textformat", value: .text)
            }
        }
        .foregroundStyle(PadPalette.text)
    }

    private func creationTool(_ title: String, icon: String, value: NotebookDiagramTool) -> some View {
        Button { chooseDiagramTool(value) } label: {
            Label(title, systemImage: icon).font(.subheadline)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .padding(.horizontal, 10)
                .background(diagramTool == value ? PadPalette.accentSoft : PadPalette.surface, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain).accessibilityAddTraits(diagramTool == value ? [.isSelected] : [])
        .accessibilityIdentifier("notebook-shape-\(value.rawValue)")
    }

    private func writingToolButton(_ title: String, icon: String, value: PaperTool, showTitle: Bool = false) -> some View {
        let active = diagramTool == .none && tool == value
        return Button { chooseWritingTool(value) } label: {
            Label(title, systemImage: icon).labelStyle(NotebookToolLabelStyle(showTitle: showTitle))
                .font(.subheadline.weight(.medium)).frame(minWidth: showTitle ? 76 : 44, minHeight: 44)
                .foregroundStyle(active ? PadPalette.accent : PadPalette.text)
                .background(active ? PadPalette.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: 10))
        }.accessibilityLabel(title).accessibilityAddTraits(active ? [.isSelected] : [])
            .accessibilityIdentifier(value == .pen ? "notebook-return-to-ink" : "notebook-ink-eraser").help(title)
    }

    private func diagramToolbarButton(_ title: String, icon: String, value: NotebookDiagramTool) -> some View {
        Button { chooseDiagramTool(value) } label: {
            Image(systemName: icon).frame(width: 44, height: 44)
                .foregroundStyle(diagramTool == value ? PadPalette.accent : PadPalette.text)
                .background(diagramTool == value ? PadPalette.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: 10))
        }.accessibilityLabel(title).accessibilityAddTraits(diagramTool == value ? [.isSelected] : [])
            .accessibilityIdentifier("notebook-shape-\(value.rawValue)").help(title)
    }

    private func chooseDiagramTool(_ value: NotebookDiagramTool) {
        diagramTool = value
        selectedShapeId = nil
        showShapes = false
        showToolSettings = false
        showShapeStyle = false
        showDiagramTools = false
    }

    private var diagramInstruction: String {
        switch diagramTool {
        case .none: return ""
        case .select: return "Corners resize · top circle rotates · line midpoint bends. Two fingers scroll."
        case .text: return "Tap the sheet to add text. Pinch to zoom."
        case .arrow, .line: return "Draw between shapes to connect. Drag the middle handle to curve the line."
        default: return "Drag on the sheet to draw a shape. Use two fingers to scroll."
        }
    }

    private var shapesPalette: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("On this sheet").font(.system(.headline, design: .serif))
            Text("Double-tap a shape to edit its label. Text moves with its shape.")
                .font(.footnote).foregroundStyle(PadPalette.muted)
            if !shapes.isEmpty {
                Divider()
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(Array(shapes.enumerated()), id: \.element.id) { index, shape in
                            Button {
                                diagramTool = .select
                                selectedShapeId = shape.id
                                showShapes = false
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(index + 1). \(shape.kind.rawValue.capitalized)").font(.subheadline.weight(.medium))
                                    if !shape.text.isEmpty {
                                        Text(shape.text).font(.caption).foregroundStyle(PadPalette.muted).lineLimit(2)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 8)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Select \(shape.kind.rawValue) \(index + 1)")
                            .accessibilityValue(String(shape.text.prefix(160)))
                            .accessibilityHint("Opens its text, color and object controls.")
                            .accessibilityIdentifier("notebook-select-object-\(shape.id)")
                        }
                    }
                }.frame(maxHeight: 180)
            } else { Text("No shapes yet. Open Shapes to draw one.").font(.footnote).foregroundStyle(PadPalette.muted) }
        }
    }

    private func shapeInspector(_ shape: NotebookShape) -> some View {
        NotebookSelectedObjectBar(editText: { editShapeText(shape.id) }, editStyle: { showShapeStyle = true }, duplicate: { duplicateShape(shape) }, delete: {
            let detached = NotebookArrowGeometry.detachingBindings(to: shape.id, in: shapes)
            shapes = detached.filter { $0.id != shape.id }
            selectedShapeId = nil
            scheduleSave()
        })
        .popover(isPresented: $showShapeStyle) { shapeStyleEditor.padding(20).frame(width: 320).presentationCompactAdaptation(.popover) }
    }

    private var shapeStyleEditor: some View {
        ScrollView {
            if let shape = selectedShape {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Shape style").font(.system(.headline, design: .serif))
                    if NotebookArrowGeometry.isConnector(shape) {
                        connectorStyleControls(shape)
                    } else {
                        rotationStyleControls(shape)
                    }
                    shapeColorControls(shape)
                    if shape.kind != .text {
                        HStack { Text("Line thickness"); Spacer(); Text("\(shape.lineWidth.formatted(.number.precision(.fractionLength(1)))) pt").monospacedDigit().foregroundStyle(PadPalette.muted) }
                        Slider(value: shapePropertyBinding(\.lineWidth), in: 0.5...24, step: 0.5).frame(minHeight: 44).accessibilityLabel("Shape line thickness")
                    }
                    if !NotebookArrowGeometry.isConnector(shape) && shape.kind != .text {
                        Toggle("Soft fill", isOn: Binding(get: { selectedShape?.filled ?? false }, set: { value in updateSelectedShape { $0.filled = value } })).frame(minHeight: 44)
                    }
                    HStack { Text("Text size"); Spacer(); Text("\(shape.fontSize.formatted(.number.precision(.fractionLength(0)))) pt").monospacedDigit().foregroundStyle(PadPalette.muted) }
                    Slider(value: shapePropertyBinding(\.fontSize), in: 8...96, step: 1).frame(minHeight: 44).accessibilityLabel("Shape text size")
                    Text("Text stays with its shape and wraps as you resize it.").font(.footnote).foregroundStyle(PadPalette.muted)
                }.foregroundStyle(PadPalette.text)
            }
        }.frame(maxHeight: 430)
    }

    @ViewBuilder
    private func connectorStyleControls(_ shape: NotebookShape) -> some View {
        Text(arrowConnectionDescription(shape)).font(.subheadline.weight(.medium))
        Text("Drag an endpoint circle near a shape to attach it, or away to disconnect. Filled circles show attached endpoints.")
            .font(.footnote).foregroundStyle(PadPalette.muted)
        if shape.startBinding != nil || shape.endBinding != nil {
            Button("Detach endpoints", systemImage: "link.badge.plus") { updateSelectedShape { $0.startBinding = nil; $0.endBinding = nil } }
                .frame(minHeight: 44).accessibilityIdentifier("notebook-arrow-detach")
        }
        Text("Drag the middle circle to bend. Connected ends stay anchored; detach them before rotating or resizing the entire line.")
            .font(.footnote).foregroundStyle(PadPalette.muted)
        if shape.bend != nil {
            Button("Straighten line", systemImage: "line.diagonal") { updateSelectedShape { $0.bend = nil } }
                .frame(minHeight: 44).accessibilityIdentifier("notebook-line-straighten")
        }
    }

    @ViewBuilder
    private func rotationStyleControls(_ shape: NotebookShape) -> some View {
        let radiansToDegrees = 180 / Double.pi
        let degrees = (shape.rotation ?? 0) * radiansToDegrees
        let label = degrees.formatted(.number.precision(.fractionLength(0))) + "°"
        let rotation = Binding<Double>(
            get: { (selectedShape?.rotation ?? 0) * radiansToDegrees },
            set: { degrees in
                updateSelectedShape { shape in
                    shape.rotation = abs(degrees) < 0.001 ? nil : degrees / radiansToDegrees
                }
            }
        )
        HStack {
            Text("Rotation")
            Spacer()
            Text(label).monospacedDigit().foregroundStyle(PadPalette.muted)
        }
        Slider(value: rotation, in: -180...180, step: 1)
            .frame(minHeight: 44).accessibilityLabel("Shape rotation in degrees")
    }

    private func shapeColorControls(_ shape: NotebookShape) -> some View {
        HStack(spacing: 2) {
            ForEach(PaperInkColor.allCases, id: \.self) { color in
                Button { updateSelectedShape { $0.color = color.rawValue } } label: {
                    Circle().fill(color.displayColor(for: colorScheme)).frame(width: 27, height: 27)
                        .overlay(Circle().strokeBorder(shape.color == color.rawValue ? PadPalette.text : PadPalette.border, lineWidth: shape.color == color.rawValue ? 3 : 1))
                        .frame(width: 44, height: 44)
                }.buttonStyle(.plain).accessibilityLabel("Shape color: \(color.name)")
                    .accessibilityAddTraits(shape.color == color.rawValue ? [.isSelected] : [])
            }
        }
    }

    private func shapePropertyBinding(_ property: WritableKeyPath<NotebookShape, Double>) -> Binding<Double> {
        Binding(get: { selectedShape?[keyPath: property] ?? 0 }, set: { value in updateSelectedShape { $0[keyPath: property] = value } })
    }

    private func arrowConnectionDescription(_ shape: NotebookShape) -> String {
        let count = [shape.startBinding, shape.endBinding].compactMap { $0 }.count
        switch count {
        case 2: return "Connected at both ends"
        case 1: return "Connected at one end"
        default: return shape.kind == .line ? "Free line" : "Free arrow"
        }
    }

    private var shapeTextEditor: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("A label that stays with your shape.").font(.subheadline).foregroundStyle(PadPalette.muted)
                TextEditor(text: shapeTextBinding).font(.system(size: 20)).scrollContentBackground(.hidden)
                    .focused($shapeTextFocused)
                    .padding(12).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
                    .accessibilityIdentifier("notebook-shape-text-editor")
                HStack {
                    Text(error != nil ? "Not saved yet" : dirty ? "Saving…" : "Saved on iPad").font(.caption).foregroundStyle(PadPalette.muted)
                    Spacer()
                    Text("\(selectedShape?.text.count ?? 0) / 4000").font(.caption).foregroundStyle(PadPalette.muted)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                    Button("Retry save", systemImage: "arrow.clockwise") { if saveNow() { self.error = nil } }
                        .buttonStyle(.bordered)
                }
            }.padding(20).background(PadPalette.background)
            .navigationTitle("Shape text").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { if saveNow() { shapeTextFocused = false; showShapeText = false } } } }
            .task {
                // Wait for the sheet to become the active text-input surface.
                try? await Task.sleep(for: .milliseconds(350))
                if !Task.isCancelled { shapeTextFocused = true }
            }
        }.presentationDetents([.medium, .large]).interactiveDismissDisabled(dirty)
    }

    private var shapeTextBinding: Binding<String> {
        Binding(get: { selectedShape?.text ?? "" }, set: { value in
            guard value.count <= 4000,
                  let position = shapes.firstIndex(where: { $0.id == selectedShapeId }) else { return }

            var shape = shapes[position]
            shape.text = value
            if !NotebookArrowGeometry.isConnector(shape) {
                let required = max(shape.height, NotebookShapeRenderer.requiredHeight(for: shape))
                guard shape.y + required <= 1_000_000 else { error = "This label needs more room. Move the shape up or use another sheet."; return }

                shape.height = required
            }
            var updated = shapes
            updated[position] = shape
            updated = NotebookArrowGeometry.resolvingBindings(in: updated)
            do { try NotebookArtwork.validate(shapes: updated) }
            catch { self.error = error.localizedDescription; return }
            shapes = updated
            scheduleSave()
        })
    }

    private func editShapeText(_ id: String) {
        guard saveNow(), shapes.contains(where: { $0.id == id }) else { return }
        selectedShapeId = id
        showShapeText = true
    }

    private func updateSelectedShape(_ update: (inout NotebookShape) -> Void) {
        guard let position = shapes.firstIndex(where: { $0.id == selectedShapeId }) else { return }

        var shape = shapes[position]
        update(&shape)
        if !NotebookArrowGeometry.isConnector(shape) { shape.height = max(shape.height, NotebookShapeRenderer.requiredHeight(for: shape)) }
        var updated = shapes
        updated[position] = shape
        updated = NotebookArrowGeometry.resolvingBindings(in: updated)
        do { try NotebookArtwork.validate(shapes: updated) }
        catch { self.error = error.localizedDescription; return }

        shapes = updated
        scheduleSave()
    }

    private func duplicateShape(_ shape: NotebookShape) {
        guard shapes.count < 500 else { error = "This sheet has 500 diagram objects. Start another sheet to add more."; return }
        var copy = shape
        copy.id = UUID().uuidString.lowercased()
        copy.startBinding = nil
        copy.endBinding = nil
        copy.x = min(10_000 - copy.width, copy.x + 32)
        copy.y = min(1_000_000 - copy.height, copy.y + 32)
        let label = NotebookShapeRenderer.labelRect(for: copy)
        if copy.y + label.maxY > 1_000_000 { copy.y = max(0, 1_000_000 - max(copy.height, label.maxY)) }
        do { try NotebookArtwork.validate(shapes: [copy]) }
        catch { self.error = error.localizedDescription; return }
        shapes = NotebookArrowGeometry.resolvingBindings(in: shapes + [copy])
        selectedShapeId = copy.id
        scheduleSave()
    }

    @ViewBuilder private var toolSettings: some View {
        if diagramTool != .none || tool == .pen {
            VStack(alignment: .leading, spacing: 18) {
                Text("Ink & line").font(.system(.headline, design: .serif))
                HStack(spacing: 2) {
                    ForEach(PaperInkColor.allCases, id: \.self) { color in
                        Button { inkColorName = color.rawValue } label: {
                            Circle().fill(color.displayColor(for: colorScheme)).frame(width: 27, height: 27)
                                .overlay(Circle().strokeBorder(inkColor == color ? PadPalette.text : PadPalette.border, lineWidth: inkColor == color ? 3 : 1))
                                .frame(width: 44, height: 44)
                        }.buttonStyle(.plain).accessibilityLabel(color.name).accessibilityAddTraits(color == inkColor ? [.isSelected] : [])
                    }
                }
                HStack { Text("Pen thickness").font(.headline); Spacer(); Text("\(penWidth.formatted(.number.precision(.fractionLength(1)))) pt").monospacedDigit().foregroundStyle(.secondary) }
                Slider(value: penWidthBinding, in: PaperToolSizing.penRange, step: 0.5).frame(minHeight: 44).accessibilityLabel("Pen thickness")
                HStack(spacing: 8) { widthPreset("Thin", width: 1.5); widthPreset("Medium", width: 2.5); widthPreset("Thick", width: 6) }
            }
        } else {
            VStack(alignment: .leading, spacing: 16) {
                HStack { Text("Eraser size").font(.headline); Spacer(); Text("\(eraserWidth.formatted(.number.precision(.fractionLength(0)))) pt").monospacedDigit().foregroundStyle(.secondary) }
                Slider(value: eraserWidthBinding, in: PaperToolSizing.eraserRange, step: 1).frame(minHeight: 44).accessibilityLabel("Eraser diameter")
                Text("Erases handwriting. To remove a shape, use Select → Delete.").font(.footnote).foregroundStyle(PadPalette.muted)
            }
        }
    }
    private func widthPreset(_ title: String, width: Double) -> some View {
        Button { savedPenWidth = PaperToolSizing.penWidth(width) } label: { Text(title).frame(maxWidth: .infinity, minHeight: 44) }
            .buttonStyle(.bordered).accessibilityAddTraits(abs(penWidth - width) < 0.01 ? [.isSelected] : [])
    }

    @discardableResult private func load(_ item: PadNotebookPage) -> Bool {
        saveTask?.cancel()
        do {
            let restored = try notebooks.drawing(for: item)
            let restoredShapes = try notebooks.shapes(for: item)
            try notebooks.rememberOpenedPage(item)
            page = notebooks.pages.first { $0.id == item.id } ?? item
            drawing = restored
            shapes = restoredShapes
            selectedShapeId = nil
            diagramTool = .none
            tool = .pen
            height = page.canvasHeight
            command = nil
            dirty = false
            loaded = true
            lastWork = "note:\(page.noteId)"
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private func scheduleSave() {
        guard loaded, !deleted else { return }
        dirty = true
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            _ = saveNow(commitTitle: false)
        }
    }
    @discardableResult private func saveNow(commitTitle: Bool = true) -> Bool {
        saveTask?.cancel()
        guard loaded, !deleted else { return !deleted }
        guard !commitTitle || saveNoteTitle() else { return false }
        guard dirty else { return true }
        do { page = try notebooks.savePage(page, drawing: drawing, style: page.paperStyle, canvasHeight: height, shapes: shapes); dirty = false; error = nil; return true }
        catch { self.error = error.localizedDescription; return false }
    }
    @discardableResult private func saveNoteTitle() -> Bool {
        guard editingNoteTitle else { return true }
        guard let note else { error = "This note is no longer available. Your other work is kept."; return false }
        do {
            try notebooks.renameNote(note, title: noteTitleDraft)
            editingNoteTitle = false
            noteTitleFocused = false
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private func openPages(showSent: Bool = false) {
        if saveNow() { showSentReceipts = showSent; showPages = true }
    }
    private func navigate(_ offset: Int) {
        let next = pageIndex + offset
        guard orderedPages.indices.contains(next), saveNow() else { return }
        load(orderedPages[next])
    }
    private func addPage() {
        guard saveNow(), let note else { return }
        do { load(try notebooks.addPage(to: note)) } catch { self.error = error.localizedDescription }
    }
    private func deletePage() {
        guard bridge.activeNotebookNoteId != page.noteId else { error = "This note is transferring. Wait for the transfer to finish before deleting a page."; return }
        saveTask?.cancel()
        do { try notebooks.delete(page); deleted = true; dirty = false; dismiss() } catch { self.error = error.localizedDescription }
    }
}

struct NotebookWritingReceipt: Equatable {
    let title: String
    let detail: String
    let symbol: String
    let hasSubmission: Bool

    static func resolve(page: PadNotebookPage, submissions: [NotebookSubmission], dirty: Bool) -> Self {
        let latest = submissions.filter { $0.noteId == page.noteId && $0.selectedPageIds.contains(page.id) }
            .max { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
        guard let latest else {
            return Self(title: "Private note", detail: "Only selected work is shared when you add it to Recall.", symbol: "lock", hasSubmission: false)
        }

        let changed = dirty || !latest.sourcePages.contains { $0.id == page.id && $0.revision == page.revision && $0.hash == page.contentHash }
        let changes = changed ? " Newer edits stay private." : ""
        if latest.receivedAt != nil {
            let attention = latest.lastError != nil || [.needsAttention, .paused].contains(latest.state)
            return Self(title: attention ? "Received on Mac · needs attention" : "Received on Mac", detail: "Latest submitted copy.\(changes) See Details for KB and card outcomes.", symbol: attention ? "exclamationmark.circle" : "checkmark.circle", hasSubmission: true)
        }
        if latest.lastError != nil || !latest.retryAllowed || [.needsAttention, .paused].contains(latest.state) {
            return Self(title: "Transfer needs attention", detail: "The submitted copy is saved on this iPad.\(changes) See Details for recovery options.", symbol: "exclamationmark.circle", hasSubmission: true)
        }
        return Self(title: "Waiting for Mac", detail: "The submitted copy is saved and will send when connected.\(changes)", symbol: "clock", hasSubmission: true)
    }
}

private struct NotebookToolLabelStyle: LabelStyle {
    let showTitle: Bool
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon
            if showTitle { configuration.title }
        }
    }
}

/// Selection actions float over the sheet so selecting an object never shifts
/// ink, changes the scroll position or replaces the PencilKit canvas.
struct NotebookSelectedObjectBar: View {
    let editText: () -> Void
    let editStyle: () -> Void
    let duplicate: () -> Void
    let delete: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 2) { textAction; styleAction; duplicateAction; deleteAction }
                .fixedSize(horizontal: true, vertical: false)
            VStack(spacing: 2) {
                HStack(spacing: 2) { textAction; styleAction }
                HStack(spacing: 2) { duplicateAction; deleteAction }
            }
        }
        .font(.subheadline.weight(.medium)).buttonStyle(.plain).foregroundStyle(PadPalette.text)
        .padding(6).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(PadPalette.border))
        .shadow(color: .black.opacity(0.08), radius: 8, y: 3)
        .accessibilityIdentifier("notebook-selected-object-actions")
    }

    private var textAction: some View {
        Button(action: editText) { actionLabel("Text", icon: "textformat") }
            .accessibilityLabel("Edit shape text").accessibilityIdentifier("notebook-shape-label")
    }
    private var styleAction: some View {
        Button(action: editStyle) { actionLabel("Style", icon: "slider.horizontal.3") }
            .accessibilityLabel("Shape style").accessibilityIdentifier("notebook-shape-style")
    }
    private var duplicateAction: some View {
        Button(action: duplicate) { actionLabel("Duplicate", icon: "plus.square.on.square") }
            .accessibilityLabel("Duplicate shape").accessibilityIdentifier("notebook-shape-duplicate")
    }
    private var deleteAction: some View {
        Button(role: .destructive, action: delete) { actionLabel("Delete", icon: "trash").foregroundStyle(.red) }
            .accessibilityLabel("Delete shape").accessibilityHint("Undo restores the shape and its text.")
            .accessibilityIdentifier("notebook-shape-delete")
    }
    private func actionLabel(_ title: String, icon: String) -> some View {
        Label(title, systemImage: icon).fixedSize().frame(minHeight: 44).padding(.horizontal, 10)
    }
}
