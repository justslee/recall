import SwiftUI
import PencilKit

struct PaperEditor: View {
    let initialDocument: PaperDocument
    @EnvironmentObject private var store: DocumentStore
    @EnvironmentObject private var bridge: BridgeClient
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var document: PaperDocument
    @State private var drawing = PKDrawing()
    @State private var tool: PaperTool = .pen
    @State private var height = 1800.0
    @State private var saveTask: Task<Void, Never>?
    @State private var error: String?
    @State private var preview: PaperAttempt?
    @State private var command: PaperCanvas.CanvasCommand?
    @State private var showDisclosure = false
    @State private var followMac = true
    @State private var followTutor = false
    @State private var shareItems: [URL] = []
    @State private var showShare = false
    @State private var dirty = false
    @State private var pendingDeletion: PaperDocument?
    @State private var deletingSheet = false
    @State private var deleted = false
    @State private var showTutorHelp = false
    @State private var showRename = false
    @State private var sheetName = ""
    @State private var showToolSettings = false
    @State private var promptExpanded = true
    @AppStorage("assessmentDisclosureV1") private var disclosureAccepted = false
    @AppStorage("paperInkColorV1") private var inkColorName = PaperInkColor.graphite.rawValue
    @AppStorage("paperPenWidthV1") private var savedPenWidth = 2.5
    @AppStorage("paperEraserWidthV1") private var savedEraserWidth = 24.0
    private var inkColor: PaperInkColor { PaperInkColor(rawValue: inkColorName) ?? .graphite }
    private var penWidth: Double { PaperToolSizing.penWidth(savedPenWidth) }
    private var eraserWidth: Double { PaperToolSizing.eraserWidth(savedEraserWidth) }
    private var penWidthBinding: Binding<Double> {
        Binding(get: { penWidth }, set: { savedPenWidth = PaperToolSizing.penWidth($0) })
    }
    private var eraserWidthBinding: Binding<Double> {
        Binding(get: { eraserWidth }, set: { savedEraserWidth = PaperToolSizing.eraserWidth($0) })
    }
    private var tutorTarget: String { document.tutorProblem == nil ? "clipboard" : "assistant" }
    private var belongsToTutor: Bool { document.tutorProblem != nil }
    private var latestSubmission: PaperAttempt? { store.attempts.first { $0.documentId == document.id } }
    private var promptHTML: String? {
        document.mode == .study ? document.questionPackage?.prompt : document.tutorProblem?.prompt
    }
    private var sendTitle: String {
        document.mode == .study ? "Send for feedback" : belongsToTutor ? "Send to tutor" : "Send to Mac"
    }

    init(initialDocument: PaperDocument) {
        self.initialDocument = initialDocument
        _document = State(initialValue: initialDocument)
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let promptHTML { promptCard(html: promptHTML) }
                writingToolbar
                PaperCanvas(drawing: $drawing, height: $height, style: document.paperStyle, tool: tool, onChanged: scheduleSave, command: command, inkColor: inkColor, penWidth: penWidth, eraserWidth: eraserWidth)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border, lineWidth: 1))
                    .padding(.horizontal, 12)
                    .accessibilityIdentifier("paper-writing-canvas")
                answerStrip
            }
            .background(PadPalette.background)
            .navigationTitle(document.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(PadPalette.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { if saveNow() { dismiss() } }.accessibilityIdentifier("paper-editor-done") }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if document.mode == .tutor { Button(belongsToTutor ? "Blank sheet" : "New sheet", systemImage: "doc.badge.plus") { newSheet() } }
                    Button { exportCurrent() } label: { Image(systemName: "square.and.arrow.up") }
                        .disabled(drawing.strokes.isEmpty)
                        .accessibilityLabel("Preview and export current work")
                        .accessibilityIdentifier("paper-export-work")
                    Menu {
                        Button("Rename sheet", systemImage: "pencil") { sheetName = document.title; showRename = true }
                        ForEach(store.attempts.filter { $0.documentId == document.id }) { attempt in
                            Button("Revision \(attempt.documentRevision) · \(attempt.state.title)") { preview = attempt }
                        }
                        Button("Export current work") { exportCurrent() }.disabled(drawing.strokes.isEmpty)
                        Divider()
                        Button { pendingDeletion = document } label: { Label("Delete sheet…", systemImage: "trash").foregroundStyle(.red) }
                    } label: { Image(systemName: "ellipsis.circle") }
                        .accessibilityLabel("Sheet options, submissions and export")
                        .accessibilityIdentifier("paper-sheet-options")
                }
            }
            .task { load(initialDocument); if document.mode == .tutor && bridge.connected { await connectTutor() } }
            .onChange(of: phase) { _, value in if value != .active { _ = saveNow() } }
            .onChange(of: bridge.connected) { _, connected in
                if !connected { followTutor = false }
                guard connected, !deleted, !deletingSheet, document.mode == .tutor else { return }

                Task { await connectTutor() }
            }
            .onChange(of: bridge.studyQuestionsSession?.currentQuestionId) { _, _ in followCurrentMacQuestion() }
            .onChange(of: bridge.currentTutorSession?.currentProblemId) { _, _ in followCurrentTutorProblem() }
            .onChange(of: followTutor) { _, enabled in if enabled { followCurrentTutorProblem() } }
            .onChange(of: pendingDeletion?.id) { _, id in if id == nil { followCurrentMacQuestion(); followCurrentTutorProblem() } }
            .onChange(of: bridge.tutorSession(for: tutorTarget)?.handoffId) { _, handoffId in
                guard !deleted, !deletingSheet, document.mode == .tutor, !belongsToTutor, let handoffId else { return }
                if document.handoffId != handoffId { document.handoffId = handoffId; scheduleSave() }
            }
            .onDisappear { saveTask?.cancel(); if !deleted { _ = saveNow() } }
            .sheet(item: $preview) { attempt in AttemptPreview(attempt: attempt, store: store) { urls in shareItems = urls; preview = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { showShare = true } } }
            .sheet(isPresented: $showShare) { ShareSheet(items: shareItems) }
            .alert("Before sending for feedback", isPresented: $showDisclosure) {
                Button("Send for feedback") { disclosureAccepted = true; submit() }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Recall saves these pages on your Mac. If handwriting assessment is enabled there, it sends your pages, this question and its reference answer to OpenAI. Internet and API billing apply. Your review rating is always your choice.") }
            .alert("Name this sheet", isPresented: $showRename) {
                TextField("Sheet name", text: $sheetName)
                Button("Save") {
                    let name = sheetName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return }

                    document.title = String(name.prefix(160))
                    scheduleSave()
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Your working is kept", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
            .safeAreaInset(edge: .top) { if let message = bridge.message { Text(message).font(.caption).padding(10).frame(maxWidth: .infinity).background(.thinMaterial) } }
        }.disabled(deletingSheet).interactiveDismissDisabled(dirty || deletingSheet || pendingDeletion != nil)
            .sheetDeletionConfirmation(item: $pendingDeletion, onDelete: deleteSheet)
    }

    private func promptCard(html: String) -> some View {
        PaperPromptCard(html: html, mode: document.mode, expanded: $promptExpanded)
    }

    private var answerStrip: some View {
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    sessionControls.fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 8)
                    sendButton.fixedSize(horizontal: true, vertical: false)
                }
                VStack(alignment: .leading, spacing: 6) {
                    sessionControls
                    sendButton.frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            if let latestSubmission {
                Button { preview = latestSubmission } label: {
                    Label(document.mode == .tutor ? tutorDeliverySummary(latestSubmission.state) : latestSubmission.state.title,
                          systemImage: latestSubmission.state == .needsAttention ? "exclamationmark.circle" : "doc.badge.clock")
                        .font(.caption)
                        .foregroundStyle(PadPalette.muted)
                        .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("View latest submission: \(latestSubmission.state.title)")
                .accessibilityIdentifier("paper-latest-submission")
            } else if document.mode == .tutor && !belongsToTutor {
                Text("Copy on Mac, then paste anywhere · receiver required")
                    .font(.caption)
                    .foregroundStyle(PadPalette.muted)
            }
            if belongsToTutor {
                Text(horizontalSizeClass == .compact ? "Tutor access shares pages with its AI provider." : "Pages reach your assistant and its AI provider when the tutor reads them.")
                    .font(.caption)
                    .foregroundStyle(PadPalette.muted)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(.thinMaterial)
        .overlay(alignment: .top) { Rectangle().fill(PadPalette.border).frame(height: 1) }
        .accessibilityIdentifier("paper-send-strip")
    }

    @ViewBuilder private var sessionControls: some View {
        if document.mode == .tutor {
            HStack(spacing: 10) {
                Label(belongsToTutor ? document.tutorTitle ?? "Your tutor" : "Mac page tray", systemImage: belongsToTutor ? "bubble.left.and.bubble.right" : "macbook")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(PadPalette.text)
                    .lineLimit(1)
                    .frame(maxWidth: 200, alignment: .leading)
                if belongsToTutor {
                    Toggle("Follow tutor", isOn: $followTutor)
                        .toggleStyle(.button)
                        .font(.caption.weight(.medium))
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("paper-follow-tutor")
                }
                Button { showTutorHelp = true } label: {
                    Image(systemName: "info.circle").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Sending pages to your Mac")
                .accessibilityIdentifier("paper-delivery-help")
                .popover(isPresented: $showTutorHelp) { tutorHelp }
            }
        } else {
            HStack(spacing: 6) {
                Toggle("Follow Mac", isOn: $followMac)
                    .toggleStyle(.button)
                    .font(.subheadline.weight(.medium))
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("paper-follow-mac")
                Button { navigateQuestion(-1) } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Previous saved question")
                .accessibilityIdentifier("paper-previous-question")
                Button { navigateQuestion(1) } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Next saved question")
                .accessibilityIdentifier("paper-next-question")
            }
        }
    }

    private var sendButton: some View {
        Button {
            if document.mode == .study && !disclosureAccepted { showDisclosure = true } else { submit() }
        } label: {
            Label(sendTitle, systemImage: "arrow.up")
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 32)
                .padding(.horizontal, 4)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 12))
        .tint(PadPalette.accent)
        .foregroundStyle(drawing.strokes.isEmpty ? PadPalette.muted : PadPalette.accentInk)
        .disabled(drawing.strokes.isEmpty)
        .accessibilityIdentifier("paper-send-work")
    }

    private var tutorHelp: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            Label(belongsToTutor ? "Your tutor. This prompt." : "Write here. Paste anywhere.", systemImage: belongsToTutor ? "bubble.left.and.bubble.right" : "doc.on.clipboard")
                .font(.system(.headline, design: .serif))
            if belongsToTutor {
                Text("Send to tutor saves these pages for this prompt in the original conversation’s session. Your assistant can access them when you ask it to review your work.")
                Text("When the tutor reads them, the page images are shared with that assistant and its AI provider. You can also copy or export the saved pages on your Mac and paste them yourself.")
                Text("Received on Mac means your work is saved and waiting. Available to tutor means the assistant has accessed a page; it does not promise feedback or send a chat message.")
                Text("Follow tutor saves your working before the next published prompt appears. Hints and discussion keep the same sheet. Reconnecting leaves your current work open; turn Follow tutor on to continue.")
            } else {
                Text("Send to Mac saves your pages in Tutor Pad on your Mac. Copy a page there, then paste it into any app or conversation with ⌘V.")
                Text("Review the attachment and press Send yourself. Tutor Pad does not select a chat, paste automatically or send messages.")
            }
            Text("Keep the Mac receiver running. Offline work waits safely on this iPad. No Recall card or handwriting assessment is used.")
                .font(.footnote)
                .foregroundStyle(PadPalette.muted)
        }
        .padding(24)
        .frame(maxWidth: 360)
        .foregroundStyle(PadPalette.text)
        }
        .frame(maxHeight: 520)
        .scrollBounceBehavior(.basedOnSize)
        .presentationCompactAdaptation(.popover)
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
                        .accessibilityIdentifier("paper-writing-tools")
                    if tool != .select {
                        Button { showToolSettings.toggle() } label: {
                            HStack(spacing: 5) {
                                if tool == .pen {
                                    Circle().fill(inkColor.displayColor(for: colorScheme)).frame(width: 18, height: 18)
                                        .overlay(Circle().strokeBorder(PadPalette.border, lineWidth: 1))
                                } else {
                                    Image(systemName: "eraser")
                                    Text(eraserWidth.formatted(.number.precision(.fractionLength(0))))
                                        .font(.caption).monospacedDigit()
                                }
                                Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                            }.frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel(tool == .pen ? "Ink color and pen thickness" : "Eraser size")
                        .accessibilityValue(tool == .pen ? "\(inkColor.name), \(penWidth.formatted(.number.precision(.fractionLength(1)))) points" : "\(eraserWidth.formatted(.number.precision(.fractionLength(0)))) points")
                        .accessibilityIdentifier("paper-tool-settings")
                        .popover(isPresented: $showToolSettings) {
                            toolSettings.padding(20).frame(width: 320)
                                .presentationCompactAdaptation(.popover)
                        }
                    }
                    Button { command = .init(id: UUID(), undo: true) } label: {
                        Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44)
                    }.accessibilityLabel("Undo").accessibilityIdentifier("paper-undo")
                    Button { command = .init(id: UUID(), undo: false) } label: {
                        Image(systemName: "arrow.uturn.forward").frame(width: 44, height: 44)
                    }.accessibilityLabel("Redo").accessibilityIdentifier("paper-redo")
                    Menu {
                        ForEach(PaperStyle.allCases, id: \.self) { style in
                            Button { document.paperStyle = style; scheduleSave() } label: {
                                if style == document.paperStyle {
                                    Label(style.rawValue.capitalized, systemImage: "checkmark")
                                } else {
                                    Text(style.rawValue.capitalized)
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "square.grid.3x3").frame(width: 44, height: 44)
                    }.accessibilityLabel("Paper style").accessibilityIdentifier("paper-style-menu")
                }
            }.frame(height: 44)
            ViewThatFits(in: .horizontal) {
                Label(dirty ? "Saving ink…" : bridge.connected ? "Mac connected" : "Saved on iPad", systemImage: dirty ? "pencil.tip" : bridge.connected ? "link" : "checkmark.circle")
                Image(systemName: dirty ? "pencil.tip" : bridge.connected ? "link" : "checkmark.circle")
            }
            .font(.caption).foregroundStyle(PadPalette.muted)
            .padding(.trailing, 8)
            .accessibilityLabel(dirty ? "Saving your ink" : bridge.connected ? "Mac connected" : "Saved on iPad")
            .accessibilityIdentifier("paper-connection-status")
        }
        .buttonStyle(.plain)
        .foregroundStyle(PadPalette.text)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border, lineWidth: 1))
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .onChange(of: tool) { _, _ in showToolSettings = false }
    }

    @ViewBuilder private var toolSettings: some View {
        if tool == .pen {
            VStack(alignment: .leading, spacing: 18) {
                Text("Ink & line").font(.system(.headline, design: .serif))
                HStack(spacing: 2) {
                    ForEach(PaperInkColor.allCases, id: \.self) { color in
                        Button { inkColorName = color.rawValue } label: {
                            ZStack {
                                Circle().fill(color.displayColor(for: colorScheme)).frame(width: 27, height: 27)
                                    .overlay(Circle().strokeBorder(.primary.opacity(0.2), lineWidth: 1))
                                if color == inkColor {
                                    Circle().strokeBorder(.primary, lineWidth: 2).frame(width: 38, height: 38)
                                    Image(systemName: "checkmark.circle.fill").font(.system(size: 13))
                                        .foregroundStyle(.primary, .background).offset(x: 13, y: 13)
                                }
                            }.frame(width: 44, height: 44)
                        }.buttonStyle(.plain)
                        .accessibilityLabel(color.name)
                        .accessibilityAddTraits(color == inkColor ? [.isSelected] : [])
                    }
                }
                HStack {
                    Text("Pen thickness").font(.headline)
                    Spacer()
                    Text("\(penWidth.formatted(.number.precision(.fractionLength(1)))) pt").monospacedDigit().foregroundStyle(.secondary)
                }
                RoundedRectangle(cornerRadius: penWidth / 2)
                    .fill(inkColor.displayColor(for: colorScheme))
                    .frame(height: max(1, penWidth)).frame(height: 28)
                    .accessibilityHidden(true)
                Slider(value: penWidthBinding, in: PaperToolSizing.penRange, step: 0.5)
                    .frame(minHeight: 44).accessibilityLabel("Pen thickness")
                    .accessibilityValue("\(penWidth.formatted(.number.precision(.fractionLength(1)))) points")
                HStack(spacing: 8) {
                    widthPreset("Thin", width: 1.5)
                    widthPreset("Medium", width: 2.5)
                    widthPreset("Thick", width: 6)
                }
            }
        } else if tool == .eraser {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Eraser size").font(.headline)
                    Spacer()
                    Text("\(eraserWidth.formatted(.number.precision(.fractionLength(0)))) pt").monospacedDigit().foregroundStyle(.secondary)
                }
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(.secondary.opacity(0.08))
                    Circle().fill(.background).overlay(Circle().strokeBorder(.secondary, lineWidth: 1.5))
                        .frame(width: eraserWidth, height: eraserWidth)
                }.frame(height: 94).accessibilityHidden(true)
                Slider(value: eraserWidthBinding, in: PaperToolSizing.eraserRange, step: 1)
                    .frame(minHeight: 44).accessibilityLabel("Eraser diameter")
                    .accessibilityValue("\(eraserWidth.formatted(.number.precision(.fractionLength(0)))) points")
                Text("Erase just the ink you touch.").font(.footnote).foregroundStyle(PadPalette.muted)
            }
        }
    }

    private func widthPreset(_ title: String, width: Double) -> some View {
        Button { savedPenWidth = PaperToolSizing.penWidth(width) } label: {
            Text(title).frame(maxWidth: .infinity, minHeight: 44)
        }.buttonStyle(.bordered)
            .accessibilityLabel("\(title) pen, \(width.formatted(.number.precision(.fractionLength(1)))) points")
            .accessibilityAddTraits(abs(penWidth - width) < 0.01 ? [.isSelected] : [])
    }

    private func load(_ item: PaperDocument) {
        do {
            drawing = try store.drawing(for: item)
            if document.id != item.id { promptExpanded = true }
            document = item
            followTutor = item.tutorProblem != nil && bridge.connected
                && bridge.currentTutorSession?.handoffId == item.tutorProblem?.sessionId
                && bridge.currentTutorSession?.currentProblemId == item.tutorProblem?.id
            height = item.canvasHeight
            dirty = false
        } catch { self.error = error.localizedDescription }
    }
    private func scheduleSave() {
        guard !deleted, !deletingSheet else { return }

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
        guard !deleted, !deletingSheet else { return deleted }

        guard dirty else { return true }
        do { document.canvasHeight = height; document = try store.save(document, drawing: drawing); dirty = false; return true }
        catch { self.error = "Your latest strokes could not be saved. Keep this sheet open and retry. \(error.localizedDescription)"; return false }
    }
    private func submit() {
        guard saveNow() else { return }
        do {
            if document.mode == .tutor, !belongsToTutor, let session = bridge.tutorSession(for: tutorTarget) {
                document.handoffId = session.handoffId
            } else if document.mode == .study, document.handoffId == nil,
                      let session = bridge.studyQuestionsSession,
                      session.questions.contains(where: { $0.id == document.questionPackage?.id }) {
                document.handoffId = session.handoffId
            }
            let attempt = try store.submit(document, drawing: drawing)
            dirty = false
            if document.mode == .study { preview = attempt }
            Task { await bridge.flushOutbox() }
        } catch { self.error = error.localizedDescription }
    }
    private func exportCurrent() {
        guard saveNow() else { return }
        do {
            // Local export does not enter the network outbox.
            let attempt = try store.submit(document, drawing: drawing)
            try store.updateAttempt(attempt.id, state: .savedOffline, retryAllowed: false)
            preview = attempt
        } catch { self.error = error.localizedDescription }
    }
    private func newSheet() {
        guard saveNow() else { return }
        do {
            var item = try store.open(mode: .tutor)
            if !belongsToTutor { item.handoffId = document.handoffId }
            item = try store.save(item, drawing: PKDrawing())
            load(item)
        }
        catch { self.error = error.localizedDescription }
    }
    private func switchQuestion(_ question: QuestionPackage, handoffId: String?) {
        guard saveNow() else { return }
        do { var item = try store.open(mode: .study, question: question); item.handoffId = handoffId; load(item) }
        catch { self.error = error.localizedDescription }
    }
    private func navigateQuestion(_ direction: Int) {
        guard let session = bridge.studyQuestionsSession, let index = session.questions.firstIndex(where: { $0.id == document.questionPackage?.id }) else { return }
        let target = index + direction
        guard session.questions.indices.contains(target) else { return }
        followMac = false
        switchQuestion(session.questions[target], handoffId: session.handoffId)
    }
    private func connectTutor() async {
        guard bridge.connected, !deleted, !deletingSheet, !belongsToTutor else { return }

        let target = tutorTarget
        let documentId = document.id
        if bridge.tutorSession(for: target) == nil { await bridge.startTutor(target: target) }
        guard !deleted, !deletingSheet, document.id == documentId, tutorTarget == target,
              let session = bridge.tutorSession(for: target) else { return }

        if document.handoffId != session.handoffId { document.handoffId = session.handoffId; scheduleSave() }
    }
    private func followCurrentTutorProblem() {
        guard bridge.connected, !deleted, !deletingSheet, pendingDeletion == nil, followTutor,
              let session = bridge.currentTutorSession,
              session.nextTutorProblem(after: document, following: followTutor, connected: bridge.connected) != nil else { return }

        saveTask?.cancel()
        do {
            if let next = try store.followTutorProblem(from: document, drawing: drawing, in: session) { load(next) }
        } catch {
            followTutor = false
            self.error = "Your working could not be saved before switching prompts. Keep this sheet open and retry. \(error.localizedDescription)"
        }
    }
    private func followCurrentMacQuestion() {
        guard !deleted, !deletingSheet, pendingDeletion == nil, followMac, document.mode == .study,
              let session = bridge.studyQuestionsSession,
              let question = session.questions.first(where: { $0.id == session.currentQuestionId }),
              question.id != document.questionPackage?.id else { return }

        switchQuestion(question, handoffId: session.handoffId)
    }
    private func tutorDeliverySummary(_ state: DeliveryState) -> String {
        switch state {
        case .savedOffline: return "Saved on iPad · not sent"
        case .waitingForMac: return "Waiting for Mac · your pages are saved"
        case .receivedOnMac, .queuedOnMac: return belongsToTutor ? "Received on Mac · waiting for tutor" : "Received on Mac · check the Tutor Pad page tray"
        case .availableToTutor: return "Available to tutor · continue in the original chat"
        case .needsResume: return "Pages ready on Mac · open Tutor Pad"
        case .copiedForTutor: return "Copied on Mac · paste into any app"
        case .manualPageTray: return "Pages ready on Mac · copy them from Tutor Pad"
        case .pasting: return "Earlier handoff · pages saved on Mac"
        case .pasteUnverified: return "Earlier paste unverified · check your Mac"
        case .stagedInChat: return "Earlier chat attachment · review on Mac"
        case .needsAttention: return "Delivery needs attention · your work is kept"
        case .evaluating, .feedbackReady: return "Saved on Mac · feedback stays in your tutor"
        }
    }
    private func deleteSheet(_ item: PaperDocument) throws {
        guard !deleted, !deletingSheet else { return }

        let isCurrentSheet = item.id == document.id
        if isCurrentSheet { saveTask?.cancel() }
        deletingSheet = true
        do {
            try bridge.deleteSheet(item, from: store)
            deletingSheet = false
            if isCurrentSheet {
                deleted = true
                dirty = false
                dismiss()
            }
        } catch {
            deletingSheet = false
            if isCurrentSheet && dirty { scheduleSave() }
            throw error
        }
    }
}

struct PaperPromptCard: View {
    let html: String
    let mode: PaperMode
    @Binding var expanded: Bool
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        VStack(spacing: 0) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 10) {
                    Image(systemName: mode == .study ? "rectangle.on.rectangle" : "text.bubble")
                        .font(.subheadline)
                        .foregroundStyle(PadPalette.accent)
                    Text(mode == .study ? "The question" : "Tutor prompt")
                        .font(.system(.headline, design: .serif))
                        .foregroundStyle(PadPalette.text)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(expanded ? "Hide" : "Show")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(PadPalette.muted)
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PadPalette.muted)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(expanded ? "Collapse question prompt" : "Expand question prompt")
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .accessibilityHint("Makes more room for your writing without changing the sheet")
            .accessibilityIdentifier("paper-prompt-toggle")
            if expanded {
                Divider().overlay(PadPalette.border)
                QuestionView(html: html)
                    .frame(height: horizontalSizeClass == .compact ? 92 : 116)
                    .accessibilityIdentifier("paper-question-prompt")
            }
        }
        .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border, lineWidth: 1))
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }
}

struct AttemptPreview: View {
    let attempt: PaperAttempt
    @ObservedObject var store: DocumentStore
    let share: ([URL]) -> Void
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var bridge: BridgeClient
    @State private var error: String?
    private var currentAttempt: PaperAttempt { store.attempts.first(where: { $0.id == attempt.id }) ?? attempt }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("REVISION \(currentAttempt.documentRevision)", systemImage: "doc.text")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(PadPalette.accent)
                        Text(currentAttempt.mode == .study && currentAttempt.state == .needsResume ? "Continue on Mac" : currentAttempt.state.title)
                            .font(.system(.title2, design: .serif).weight(.semibold))
                            .foregroundStyle(PadPalette.text)
                        Text(currentAttempt.state.detail(for: currentAttempt.mode, boundToTutor: currentAttempt.deliveryTarget == "assistant"))
                            .font(.subheadline)
                            .foregroundStyle(PadPalette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                    .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(PadPalette.border, lineWidth: 1))
                    ForEach(Array(store.pageURLs(for: attempt).enumerated()), id: \.offset) { index, url in
                        if let image = UIImage(contentsOfFile: url.path) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Page \(index + 1)")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(PadPalette.muted)
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFit()
                                    .background(.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border, lineWidth: 1))
                                    .accessibilityLabel("Submitted work, page \(index + 1)")
                            }
                        }
                    }
                    if let detail = store.attempts.first(where: { $0.id == attempt.id })?.lastError { Text(detail).foregroundStyle(.secondary) }
                    if let current = store.attempts.first(where: { $0.id == attempt.id }), current.state == .needsAttention, current.lastError != nil {
                        Button("Retry delivery") {
                            do { try store.retry(attempt.id); Task { await bridge.flushOutbox() } }
                            catch { self.error = error.localizedDescription }
                        }.buttonStyle(.bordered)
                    }
                    if let error { Text(error).foregroundStyle(.red) }
                }.padding(24).frame(maxWidth: 820).frame(maxWidth: .infinity)
            }
            .background(PadPalette.background)
            .navigationTitle("Your working")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(PadPalette.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) { Menu {
                    Button("Share PNG pages") { share(store.pageURLs(for: attempt)) }
                    Button("Share PDF") { do { share([try store.pdf(for: attempt)]) } catch { self.error = error.localizedDescription } }
                } label: { Image(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("Share submitted pages or PDF")
                    .accessibilityIdentifier("paper-preview-share")
                }
            }
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [URL]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
