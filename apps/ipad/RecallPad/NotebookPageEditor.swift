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
    @AppStorage("paperInkColorV1") private var inkColorName = PaperInkColor.graphite.rawValue
    @AppStorage("paperPenWidthV1") private var savedPenWidth = 2.5
    @AppStorage("paperEraserWidthV1") private var savedEraserWidth = 24.0

    private var note: PadNotebookNote? { notebooks.notes.first { $0.id == page.noteId } }
    private var orderedPages: [PadNotebookPage] { note.map { notebooks.pages(in: $0) } ?? [] }
    private var pageIndex: Int { orderedPages.firstIndex { $0.id == page.id } ?? 0 }
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
                PaperCanvas(drawing: $drawing, height: $height, style: page.paperStyle, tool: tool, onChanged: scheduleSave, command: command, inkColor: inkColor, penWidth: penWidth, eraserWidth: eraserWidth)
                    .id(page.id)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border))
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add page", systemImage: "doc.badge.plus") { addPage() }.disabled(!loaded).accessibilityIdentifier("notebook-editor-add-page")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Rename page", systemImage: "pencil") { pageTitle = page.title; showRename = true }
                        Button("Send this note…", systemImage: "arrow.up.doc") { if saveNow() { sendScope = .note(page.noteId) } }.disabled(bridge.pairedMac == nil)
                        Divider()
                        Button("Delete page…", systemImage: "trash", role: .destructive) { showDelete = true }
                            .disabled(bridge.activeNotebookNoteId == page.noteId)
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("Notebook page options")
                }
            }
            .task { if !loaded { load(initialPage) } }
            .onChange(of: phase) { _, value in if value != .active { _ = saveNow() } }
            .onDisappear { saveTask?.cancel(); if !deleted { _ = saveNow() } }
            .sheet(item: $sendScope) { NotebookSendPreview(scope: $0) }
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
            .interactiveDismissDisabled(dirty || showDelete)
        }
    }

    private var pageStrip: some View {
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { pageNavigation; Spacer(minLength: 8); sendButton.fixedSize(horizontal: true, vertical: false) }
                VStack(alignment: .leading, spacing: 6) { pageNavigation; sendButton.frame(maxWidth: .infinity, alignment: .trailing) }
            }
            if let note { NotebookSyncLabel(summary: notebooks.syncSummary(for: note)) }
            if bridge.pairedMac == nil { Text("Pair with a Mac to add selected work to Recall. Writing stays private and works offline.").font(.caption).foregroundStyle(PadPalette.muted) }
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(.thinMaterial)
        .overlay(alignment: .top) { Rectangle().fill(PadPalette.border).frame(height: 1) }
        .accessibilityIdentifier("notebook-page-strip")
    }

    private var pageNavigation: some View {
        HStack(spacing: 4) {
            Button { navigate(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .disabled(pageIndex <= 0).accessibilityLabel("Previous notebook page")
            VStack(alignment: .leading, spacing: 2) {
                Text(page.title).font(.subheadline.weight(.medium)).foregroundStyle(PadPalette.text).lineLimit(1)
                Text("\(pageIndex + 1) of \(orderedPages.count) · \(dirty ? "Saving ink…" : "Saved on iPad")").font(.caption).foregroundStyle(PadPalette.muted)
            }.frame(minWidth: 115, alignment: .leading)
            Button { navigate(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .disabled(pageIndex + 1 >= orderedPages.count).accessibilityLabel("Next notebook page")
        }.buttonStyle(.plain)
    }

    private var sendButton: some View {
        Button { if saveNow() { sendScope = .pages(noteId: page.noteId, pageIds: [page.id]) } } label: {
            Label("Send to Recall", systemImage: "arrow.up.doc")
                .font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 12)
                .foregroundStyle(drawing.strokes.isEmpty || bridge.pairedMac == nil ? PadPalette.muted : PadPalette.accentInk)
                .background(drawing.strokes.isEmpty || bridge.pairedMac == nil ? PadPalette.raised : PadPalette.accent, in: Capsule())
        }
        .buttonStyle(.plain).disabled(drawing.strokes.isEmpty || bridge.pairedMac == nil)
        .accessibilityIdentifier("notebook-send-page")
    }

    private var writingToolbar: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Picker("Writing tool", selection: $tool) {
                        Image(systemName: "pencil.tip").accessibilityLabel("Pen").tag(PaperTool.pen)
                        Image(systemName: "eraser").accessibilityLabel("Eraser").tag(PaperTool.eraser)
                        Image(systemName: "lasso").accessibilityLabel("Select strokes").tag(PaperTool.select)
                    }.pickerStyle(.segmented).frame(width: 156, height: 44)
                    if tool != .select {
                        Button { showToolSettings.toggle() } label: {
                            HStack(spacing: 5) {
                                if tool == .pen { Circle().fill(inkColor.displayColor(for: colorScheme)).frame(width: 18, height: 18).overlay(Circle().strokeBorder(PadPalette.border)) }
                                else { Image(systemName: "eraser"); Text(eraserWidth.formatted(.number.precision(.fractionLength(0)))).font(.caption).monospacedDigit() }
                                Image(systemName: "chevron.down").font(.caption2)
                            }.frame(minWidth: 44, minHeight: 44)
                        }.accessibilityLabel(tool == .pen ? "Ink color and pen thickness" : "Eraser size")
                        .popover(isPresented: $showToolSettings) { toolSettings.padding(20).frame(width: 320).presentationCompactAdaptation(.popover) }
                    }
                    Button { command = .init(id: UUID(), undo: true) } label: { Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44) }.accessibilityLabel("Undo")
                    Button { command = .init(id: UUID(), undo: false) } label: { Image(systemName: "arrow.uturn.forward").frame(width: 44, height: 44) }.accessibilityLabel("Redo")
                    Menu {
                        ForEach(PaperStyle.allCases, id: \.self) { style in
                            Button { page.paperStyle = style; scheduleSave() } label: {
                                if page.paperStyle == style { Label(style.rawValue.capitalized, systemImage: "checkmark") } else { Text(style.rawValue.capitalized) }
                            }
                        }
                    } label: { Image(systemName: "square.grid.3x3").frame(width: 44, height: 44) }.accessibilityLabel("Paper style")
                }
            }.frame(height: 44)
            Image(systemName: "lock").font(.caption).foregroundStyle(PadPalette.muted).padding(.trailing, 8).accessibilityLabel("Private notebook page")
        }
        .buttonStyle(.plain).foregroundStyle(PadPalette.text)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border))
        .padding(.horizontal, 12).padding(.vertical, 8)
        .onChange(of: tool) { _, _ in showToolSettings = false }
    }

    @ViewBuilder private var toolSettings: some View {
        if tool == .pen {
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
                Text("Erase just the ink you touch.").font(.footnote).foregroundStyle(PadPalette.muted)
            }
        }
    }
    private func widthPreset(_ title: String, width: Double) -> some View {
        Button { savedPenWidth = PaperToolSizing.penWidth(width) } label: { Text(title).frame(maxWidth: .infinity, minHeight: 44) }
            .buttonStyle(.bordered).accessibilityAddTraits(abs(penWidth - width) < 0.01 ? [.isSelected] : [])
    }

    private func load(_ item: PadNotebookPage) {
        saveTask?.cancel()
        do {
            let restored = try notebooks.drawing(for: item)
            page = notebooks.pages.first { $0.id == item.id } ?? item
            drawing = restored
            height = page.canvasHeight
            command = nil
            dirty = false
            loaded = true
        } catch { self.error = error.localizedDescription }
    }
    private func scheduleSave() {
        guard loaded, !deleted else { return }
        dirty = true
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            _ = saveNow()
        }
    }
    @discardableResult private func saveNow() -> Bool {
        saveTask?.cancel()
        guard loaded, !deleted else { return !deleted }
        guard dirty else { return true }
        do { page = try notebooks.savePage(page, drawing: drawing, style: page.paperStyle, canvasHeight: height); dirty = false; return true }
        catch { self.error = error.localizedDescription; return false }
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
