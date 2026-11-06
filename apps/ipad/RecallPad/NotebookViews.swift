import SwiftUI

/// Notebooks never join a live study or tutor session. The only route out of
/// this private workspace is a selected, immutable Send to Recall snapshot.
struct NotebookLibraryView: View {
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @State private var showCreate = false
    @State private var title = ""
    @State private var createdNotebookId: String?
    @State private var renaming: PadNotebook?
    @State private var deleting: PadNotebook?
    @State private var error: String?

    var body: some View {
        List {
            VStack(alignment: .leading, spacing: 10) {
                NotebookEyebrow("YOUR PRIVATE LIBRARY")
                Text("Keep a notebook.").font(.system(.largeTitle, design: .serif)).foregroundStyle(PadPalette.text)
                Text("Write freely. Add to Recall when you choose.").font(.subheadline).foregroundStyle(PadPalette.muted)
                Button { title = ""; showCreate = true } label: { Label("New notebook", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).foregroundStyle(PadPalette.accentInk).padding(.top, 4)
                    .accessibilityIdentifier("notebook-create")
            }.notebookListRow(top: 22, bottom: 20)

            if notebooks.notebooks.isEmpty {
                ContentUnavailableView("Your notes, your pace", systemImage: "books.vertical", description: Text("Notebooks stay on this iPad. Pairing and AI are optional until you decide to send selected work."))
                    .notebookListRow()
            }

            ForEach(notebooks.notebooks) { notebook in
                NavigationLink { NotebookDetailView(notebookId: notebook.id) } label: {
                    notebookCover(notebook)
                }
                .notebookListRow()
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button { deleting = notebook } label: { Label("Delete", systemImage: "trash") }.tint(.red).disabled(isTransferring(notebook))
                    Button { rename(notebook) } label: { Label("Rename", systemImage: "pencil") }.tint(PadPalette.accent)
                }
                .contextMenu {
                    Button("Rename notebook", systemImage: "pencil") { rename(notebook) }
                    Button("Delete notebook…", systemImage: "trash", role: .destructive) { deleting = notebook }.disabled(isTransferring(notebook))
                }
                .accessibilityIdentifier("notebook-\(notebook.id)")
            }
            Text("Your notebook is saved locally. Sending creates a snapshot; later writing stays private until you send again.")
                .font(.footnote).foregroundStyle(PadPalette.muted).notebookListRow(top: 16, bottom: 24)
        }
        .notebookListAppearance()
        .navigationDestination(item: $createdNotebookId) { NotebookDetailView(notebookId: $0) }
        .alert("New notebook", isPresented: $showCreate) {
            TextField("Notebook name", text: $title)
            Button("Create") { perform { createdNotebookId = try notebooks.createNotebook(title: title).id } }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Cancel", role: .cancel) {}
        } message: { Text("Give this part of your learning a home.") }
        .alert("Rename notebook", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Notebook name", text: $title)
            Button("Save") { if let item = renaming { perform { try notebooks.renameNotebook(item, title: title) } }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Delete notebook?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete notebook", role: .destructive) { if let item = deleting { perform { guard !isTransferring(item) else { throw PadError.rejected("A note in this notebook is transferring. Wait for it to finish before deleting.") }; try notebooks.delete(item) } }; deleting = nil }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: {
            if let item = deleting {
                Text("“\(item.title)” and its \(notebooks.notes(in: item).count) notes will be removed from this iPad. \(notebooks.syncSummary(for: item).hasChanges ? "Some writing has not been added to Recall. " : "")This cannot be undone. Existing Mac and KB copies remain.")
            }
        }
        .notebookError(error: $error, storageError: notebooks.storageError)
    }

    private func notebookCover(_ notebook: PadNotebook) -> some View {
        HStack(spacing: 16) {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 7).fill(PadPalette.accentSoft)
                Rectangle().fill(PadPalette.accent.opacity(0.35)).frame(width: 5).padding(.leading, 7)
                Image(systemName: "book.closed").font(.title2).foregroundStyle(PadPalette.accent).frame(maxWidth: .infinity)
            }.frame(width: 66, height: 86).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(notebook.title).font(.system(.title2, design: .serif)).foregroundStyle(PadPalette.text)
                Text("\(notebooks.notes(in: notebook).count) notes · Edited \(notebook.updatedAt.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption).foregroundStyle(PadPalette.muted)
                NotebookSyncLabel(summary: notebooks.syncSummary(for: notebook))
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(PadPalette.border))
    }
    private func rename(_ item: PadNotebook) { title = item.title; renaming = item }
    private func isTransferring(_ item: PadNotebook) -> Bool { notebooks.notes(in: item).contains { $0.id == bridge.activeNotebookNoteId } }
    private func perform(_ action: () throws -> Void) { do { try action() } catch { self.error = error.localizedDescription } }
}

struct NotebookDetailView: View {
    let notebookId: String
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @State private var title = ""
    @State private var editingPage: PadNotebookPage?
    @State private var renaming: PadNotebookNote?
    @State private var deleting: PadNotebookNote?
    @State private var sendScope: NotebookSendScope?
    @State private var error: String?
    private var notebook: PadNotebook? { notebooks.notebooks.first { $0.id == notebookId } }

    var body: some View {
        Group {
            if let notebook {
                List {
                    VStack(alignment: .leading, spacing: 10) {
                        NotebookEyebrow("NOTEBOOK")
                        Text(notebook.title).font(.system(.largeTitle, design: .serif)).foregroundStyle(PadPalette.text)
                        NotebookSyncLabel(summary: notebooks.syncSummary(for: notebook))
                        Text("Tap a note to keep writing. Its pages stay private until you send them.").font(.subheadline).foregroundStyle(PadPalette.muted)
                    }.notebookListRow(top: 22, bottom: 20)
                    if notebooks.notes(in: notebook).isEmpty {
                        ContentUnavailableView {
                            Label("Begin with one note", systemImage: "doc.text")
                        } description: {
                            Text("Start writing now. You can name your note on the pad.")
                        } actions: {
                            Button("New note", systemImage: "plus") { createNote(in: notebook) }
                                .buttonStyle(.borderedProminent).accessibilityIdentifier("notebook-first-note")
                        }.notebookListRow()
                    }
                    ForEach(Array(notebooks.notes(in: notebook).enumerated()), id: \.element.id) { index, note in
                        Button { open(note) } label: {
                            HStack(spacing: 14) {
                                Text(String(format: "%02d", index + 1)).font(.system(.caption, design: .monospaced)).foregroundStyle(PadPalette.accent).frame(width: 30)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(note.title).font(.system(.title3, design: .serif)).foregroundStyle(PadPalette.text)
                                    Text(notebooks.pages(in: note).count == 1 ? "Continuous sheet" : "\(notebooks.pages(in: note).count) sheets").font(.caption).foregroundStyle(PadPalette.muted)
                                    NotebookSyncLabel(summary: notebooks.syncSummary(for: note))
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "pencil.tip").foregroundStyle(PadPalette.accent).accessibilityHidden(true)
                            }.padding(16).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
                        }
                        .buttonStyle(.plain).notebookListRow()
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button { deleting = note } label: { Label("Delete", systemImage: "trash") }.tint(.red).disabled(bridge.activeNotebookNoteId == note.id)
                            Button { rename(note) } label: { Label("Rename", systemImage: "pencil") }.tint(PadPalette.accent)
                        }
                        .contextMenu {
                            Button("Rename note", systemImage: "pencil") { rename(note) }
                            Button("Send note to Recall…", systemImage: "arrow.up.doc") { sendScope = .note(note.id) }
                            Button("Delete note…", systemImage: "trash", role: .destructive) { deleting = note }.disabled(bridge.activeNotebookNoteId == note.id)
                        }
                        .accessibilityIdentifier("notebook-note-\(note.id)")
                    }
                }.notebookListAppearance()
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Send notebook to Recall…", systemImage: "arrow.up.doc") { sendScope = .notebook(notebook.id) }.disabled(notebooks.notes(in: notebook).isEmpty)
                        } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("Notebook options")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("New note", systemImage: "plus") { createNote(in: notebook) }
                            .accessibilityIdentifier("notebook-new-note")
                    }
                }
            } else { ContentUnavailableView("Notebook removed", systemImage: "book.closed", description: Text("Other notebooks and copies on your Mac are unchanged.")) }
        }
        .background(PadPalette.background)
        .navigationTitle(notebook?.title ?? "Notebook")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $editingPage) { NotebookPageEditor(initialPage: $0) }
        .sheet(item: $sendScope) { NotebookSendPreview(scope: $0) }
        .alert("Rename note", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Note title", text: $title)
            Button("Save") { if let item = renaming { perform { try notebooks.renameNote(item, title: title) } }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Delete note?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete note", role: .destructive) { if let item = deleting { perform { guard bridge.activeNotebookNoteId != item.id else { throw PadError.rejected("This note is transferring. Wait for it to finish before deleting.") }; try notebooks.delete(item) } }; deleting = nil }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: {
            if let item = deleting { Text("“\(item.title)” and its \(notebooks.pages(in: item).count) pages will be removed from this iPad. \(notebooks.syncSummary(for: item).hasChanges ? "There is writing not yet added to Recall. " : "")This cannot be undone. Mac and KB copies remain.") }
        }
        .notebookError(error: $error, storageError: notebooks.storageError)
    }
    private func createNote(in notebook: PadNotebook) { perform { editingPage = try notebooks.createNoteForWriting(in: notebook) } }
    private func open(_ note: PadNotebookNote) { perform { editingPage = try notebooks.resumePage(for: note) } }
    private func rename(_ item: PadNotebookNote) { title = item.title; renaming = item }
    private func perform(_ action: () throws -> Void) { do { try action() } catch { self.error = error.localizedDescription } }
}

/// Optional page navigation and receipts, reached from the canvas rather than
/// placed between a note in the library and its writing surface.
struct NotebookPageBrowser: View {
    let noteId: String
    let currentPageId: String
    let onOpen: (PadNotebookPage) -> Bool
    let onDelete: (PadNotebookPage) -> Void
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @Environment(\.dismiss) private var dismiss
    @State private var tab = BrowserTab.pages
    @State private var sendScope: NotebookSendScope?
    @State private var error: String?
    @State private var deletingPage: PadNotebookPage?
    private var note: PadNotebookNote? { notebooks.notes.first { $0.id == noteId } }
    private var submissions: [NotebookSubmission] { notebooks.submissions.filter { $0.noteId == noteId } }
    private enum BrowserTab: String, CaseIterable { case pages = "Pages", sent = "Sent snapshots" }

    var body: some View {
        NavigationStack {
            Group {
                if let note {
                    List {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(note.title).font(.system(.title, design: .serif)).foregroundStyle(PadPalette.text)
                            Picker("Browse note", selection: $tab) {
                                ForEach(BrowserTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                            }.pickerStyle(.segmented).accessibilityIdentifier("notebook-browser-tabs")
                        }.notebookListRow(top: 18, bottom: 16)
                        if tab == .pages {
                            ForEach(Array(notebooks.pages(in: note).enumerated()), id: \.element.id) { index, page in
                                Button { if onOpen(page) { dismiss() } } label: {
                                    HStack(spacing: 16) {
                                        NotebookPageThumbnail(page: page).frame(width: 56, height: 72)
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(page.title).font(.system(.headline, design: .serif)).foregroundStyle(PadPalette.text)
                                            Text("Page \(index + 1) · Saved on iPad").font(.caption).foregroundStyle(PadPalette.muted)
                                        }
                                        Spacer()
                                        if page.id == currentPageId { Image(systemName: "checkmark.circle.fill").foregroundStyle(PadPalette.accent) }
                                    }.padding(14).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(page.id == currentPageId ? PadPalette.accent : PadPalette.border))
                                }.buttonStyle(.plain).notebookListRow()
                                    .accessibilityAddTraits(page.id == currentPageId ? [.isSelected] : [])
                                    .accessibilityIdentifier("notebook-page-\(page.id)")
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        Button { deletingPage = page } label: { Label("Delete", systemImage: "trash") }
                                            .tint(.red).disabled(bridge.activeNotebookNoteId == note.id)
                                    }
                                    .contextMenu {
                                        Button("Send page to Recall…", systemImage: "arrow.up.doc") { sendScope = .pages(noteId: note.id, pageIds: [page.id]) }
                                        Button("Delete page…", systemImage: "trash", role: .destructive) { deletingPage = page }
                                            .disabled(bridge.activeNotebookNoteId == note.id)
                                    }
                            }
                            Button { addPage(note) } label: { Label("Add a page", systemImage: "doc.badge.plus").frame(maxWidth: .infinity, minHeight: 48) }
                                .buttonStyle(.bordered).notebookListRow(top: 14, bottom: 18).accessibilityIdentifier("notebook-add-page")
                        } else {
                            NotebookSyncLabel(summary: notebooks.syncSummary(for: note)).notebookListRow()
                            if submissions.isEmpty {
                                ContentUnavailableView("Nothing sent yet", systemImage: "arrow.up.doc", description: Text("Writing stays on this iPad until you choose Send to Recall.")).notebookListRow()
                            }
                            ForEach(submissions) { submission in
                                NotebookSubmissionRow(submission: submission).notebookListRow()
                            }
                        }
                    }
                    .notebookListAppearance()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Send note", systemImage: "arrow.up.doc") { sendScope = .note(note.id) }
                                .disabled(notebooks.pages(in: note).isEmpty)
                        }
                    }
                } else { ContentUnavailableView("Note removed", systemImage: "doc.text") }
            }
            .background(PadPalette.background)
            .navigationTitle("Your note").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } } }
            .sheet(item: $sendScope) { NotebookSendPreview(scope: $0) }
            .alert("Delete page?", isPresented: Binding(get: { deletingPage != nil }, set: { if !$0 { deletingPage = nil } })) {
                Button("Delete page", role: .destructive) { deletePage() }
                Button("Cancel", role: .cancel) { deletingPage = nil }
            } message: {
                Text("This page and any snapshot containing it that is still waiting to send will be removed from this iPad. Unsent writing will be lost. This cannot be undone. Earlier received Mac and KB copies remain.")
            }
            .notebookError(error: $error, storageError: notebooks.storageError)
        }
    }
    private func addPage(_ note: PadNotebookNote) {
        do { if onOpen(try notebooks.addPage(to: note)) { dismiss() } } catch { self.error = error.localizedDescription }
    }
    private func deletePage() {
        guard let page = deletingPage else { return }
        do {
            guard bridge.activeNotebookNoteId != page.noteId else { throw PadError.rejected("This note is transferring. Wait for it to finish before deleting a page.") }
            try notebooks.delete(page)
            deletingPage = nil
            onDelete(page)
        } catch { self.error = error.localizedDescription }
    }
}

enum NotebookSendScope: Identifiable {
    case notebook(String), note(String), pages(noteId: String, pageIds: [String])
    var id: String {
        switch self { case .notebook(let id): return "notebook-\(id)"; case .note(let id): return "note-\(id)"; case .pages(let id, let pages): return "pages-\(id)-\(pages.joined(separator: ","))" }
    }
}

/// One preview can commit at most one immutable selection. The brief suspension
/// lets SwiftUI paint the saving state before the MainActor renderer starts.
@MainActor
final class NotebookSendPreparation: ObservableObject {
    @Published private(set) var preparing = false
    @Published private(set) var submissionIds: [String] = []
    @Published private(set) var error: String?
    private var preparationTask: Task<Void, Never>?

    var prepared: Bool { !submissionIds.isEmpty }

    @discardableResult
    func start(commit: @escaping @MainActor () throws -> [NotebookSubmission], transfer: @escaping @MainActor () async -> Void) -> Task<Void, Never>? {
        guard !preparing, !prepared else { return nil }

        preparing = true
        error = nil
        let task = Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                try await Task.sleep(for: .milliseconds(80))
                try Task.checkCancellation()
                let snapshots = try commit()
                guard !snapshots.isEmpty else { throw PadError.rejected("No selected snapshot was saved. Your original notebook is kept.") }

                submissionIds = snapshots.map(\.id)
                preparing = false
                preparationTask = nil
                // Dismissing after a successful commit must not cancel its
                // durable outbox transfer; the bridge owns delivery lifecycle.
                await transfer()
            } catch is CancellationError {
                preparing = false
                preparationTask = nil
            } catch {
                self.error = error.localizedDescription
                preparing = false
                preparationTask = nil
            }
        }
        preparationTask = task
        return task
    }

    func cancelBeforeSaved() {
        guard !prepared else { return }

        preparationTask?.cancel()
    }
}

struct NotebookSendFeedback: Equatable {
    enum Kind: Equatable { case ready, preparing, saved, received, attention, failed }
    let kind: Kind
    let title: String
    let detail: String
    let symbol: String

    var warns: Bool { kind == .attention || kind == .failed }

    @MainActor
    static func resolve(preparation: NotebookSendPreparation, submissions: [NotebookSubmission], connected: Bool, paired: Bool, selectedCount: Int, selectionError: String? = nil) -> Self {
        if preparation.preparing {
            return Self(kind: .preparing, title: "Saving your snapshot…", detail: "Rendering all selected writing and diagrams. Keep Recall Pad open until this copy is saved.", symbol: "arrow.up.doc")
        }
        if let error = preparation.error ?? selectionError {
            return Self(kind: .failed, title: preparation.prepared ? "Transfer needs attention" : "Couldn’t save this selection", detail: String(error.prefix(400)), symbol: "exclamationmark.circle")
        }
        if preparation.prepared {
            let ids = Set(preparation.submissionIds)
            let saved = submissions.filter { ids.contains($0.id) }
            guard saved.count == ids.count else {
                return Self(kind: .attention, title: "Saved snapshot needs attention", detail: "One of this selection’s saved receipts is unavailable. Check Sent snapshots before sending a new selection.", symbol: "exclamationmark.circle")
            }
            let received = saved.filter { $0.receivedAt != nil }
            let imageCount = saved.reduce(0) { $0 + $1.pages.count }
            let count = "\(imageCount) image \(imageCount == 1 ? "page" : "pages") · \(received.count) of \(saved.count) \(saved.count == 1 ? "snapshot" : "snapshots") received"
            if let issue = saved.first(where: { $0.lastError != nil || [.needsAttention, .paused].contains($0.state) }) {
                return Self(kind: .attention, title: received.count == saved.count ? "Received on Mac · needs attention" : "Snapshot saved · transfer needs attention", detail: "\(count). \(String((issue.lastError ?? issue.state.title).prefix(300))) Your saved work is kept.", symbol: "exclamationmark.circle")
            }
            if received.count == saved.count {
                let completed = saved.allSatisfy { $0.state == .added || $0.state == .reviewed }
                return Self(kind: .received, title: completed ? "Prepared on Mac" : "Received on Mac", detail: "\(count). \(completed ? "See the saved KB and card outcomes in Sent snapshots." : "On your Mac: Recall → Settings & backups → Learning connections → From your notebooks → View pages. KB and card preparation is still separate.") Tap Done to return to writing.", symbol: "checkmark.circle.fill")
            }
            return Self(kind: .saved, title: connected ? "Snapshot saved · sending to Mac" : "Snapshot saved · waiting for Mac", detail: "\(count). You can tap Done; this saved copy stays queued until the Mac confirms receipt.", symbol: "checkmark.circle")
        }
        if !paired {
            return Self(kind: .ready, title: "Pair with a Mac to send", detail: "Your writing stays saved privately on this iPad.", symbol: "link")
        }
        if selectedCount == 0 {
            return Self(kind: .ready, title: "Choose a written page", detail: "Select at least one page with ink or diagrams. Blank pages are not sent.", symbol: "doc")
        }
        return Self(kind: .ready, title: "Ready to save and send", detail: "\(selectedCount) selected source \(selectedCount == 1 ? "page" : "pages"). Long sheets become several ordered images; thumbnails show each sheet’s beginning.", symbol: "arrow.up.doc")
    }
}

struct NotebookSendStatusPanel: View {
    let feedback: NotebookSendFeedback
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if feedback.kind == .preparing { ProgressView().padding(.top, 2) }
            else { Image(systemName: feedback.symbol).font(.title3).padding(.top, 1) }
            VStack(alignment: .leading, spacing: 5) {
                Text(feedback.title).font(.headline)
                Text(feedback.detail).font(.footnote).foregroundStyle(PadPalette.muted).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(feedback.warns ? Color.red : PadPalette.accent)
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("notebook-send-status")
    }
}

struct NotebookSendPreview: View {
    let scope: NotebookSendScope
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedIds: Set<String> = []
    @State private var eligibleIds: Set<String> = []
    @State private var writtenCounts: [String: Int] = [:]
    @State private var selectionInitialized = false
    @StateObject private var preparation = NotebookSendPreparation()
    @State private var error: String?

    private var preparing: Bool { preparation.preparing }
    private var prepared: Bool { preparation.prepared }
    private var feedback: NotebookSendFeedback {
        NotebookSendFeedback.resolve(preparation: preparation, submissions: notebooks.submissions, connected: bridge.connected, paired: bridge.pairedMac != nil, selectedCount: selectionCount, selectionError: error)
    }
    private var sentSubmissions: [NotebookSubmission] { notebooks.submissions.filter { preparation.submissionIds.contains($0.id) } }
    private var retryIds: [String] { sentSubmissions.filter { $0.receivedAt == nil && $0.lastError != nil && $0.retryAllowed }.map(\.id) }

    private var selectedNotebook: PadNotebook? {
        if case .notebook(let id) = scope { return notebooks.notebooks.first { $0.id == id } }
        return nil
    }
    private var selectedNote: PadNotebookNote? {
        switch scope { case .notebook: return nil; case .note(let id), .pages(let id, _): return notebooks.notes.first { $0.id == id } }
    }
    private var title: String { selectedNotebook?.title ?? selectedNote?.title ?? "Selected work" }
    private var isNotebook: Bool { selectedNotebook != nil }
    private var selectionCount: Int {
        if let notebook = selectedNotebook { return notebooks.notes(in: notebook).filter { selectedIds.contains($0.id) }.reduce(0) { $0 + (writtenCounts[$1.id] ?? 0) } }
        return selectedIds.count
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    NotebookSendStatusPanel(feedback: feedback)
                    if !retryIds.isEmpty {
                        Button("Retry this transfer", systemImage: "arrow.clockwise") { retryTransfer() }
                            .font(.subheadline).buttonStyle(.bordered)
                    }
                }.padding(.horizontal, 16).padding(.vertical, 10)
                List {
                    VStack(alignment: .leading, spacing: 10) {
                        NotebookEyebrow("CHOOSE WHAT TO SHARE")
                        Text(title).font(.system(.title, design: .serif)).foregroundStyle(PadPalette.text)
                        Text("\(selectionCount) selected pages · \(bridge.connected ? "Mac connected" : bridge.pairedMac == nil ? "Pair with a Mac before sending" : "Saved offline, sent when the Mac reconnects")").font(.subheadline).foregroundStyle(PadPalette.muted)
                    }.listRowBackground(PadPalette.surface)
                    if let notebook = selectedNotebook {
                        ForEach(notebooks.notes(in: notebook)) { note in
                            selectionRow(id: note.id) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(note.title).foregroundStyle(PadPalette.text)
                                    Text("\(writtenCounts[note.id] ?? 0) written pages · \(notebooks.pages(in: note).count - (writtenCounts[note.id] ?? 0)) blank").font(.caption).foregroundStyle(PadPalette.muted)
                                }
                            }
                        }
                    } else if let note = selectedNote {
                        ForEach(Array(notebooks.pages(in: note).enumerated()), id: \.element.id) { index, page in
                            selectionRow(id: page.id) {
                                HStack(spacing: 14) {
                                    NotebookPageThumbnail(page: page).frame(width: 52, height: 68)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(page.title).foregroundStyle(PadPalette.text)
                                        Text("Page \(index + 1)").font(.caption).foregroundStyle(PadPalette.muted)
                                        if !eligibleIds.contains(page.id) { Text("Blank page · not sent").font(.caption).foregroundStyle(PadPalette.muted) }
                                    }
                                }
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Label("An intentional handoff", systemImage: "arrow.up.doc").font(.headline).foregroundStyle(PadPalette.text)
                        Text("Recall saves only your selection on the Mac. An assistant reviews the handwriting, looks for existing concepts, and prepares KB changes and validated cards using your configured sources and permissions.")
                        Text("Handwriting may need clarification. Read-only sources remain read-only. Received pages are not proof that knowledge-base updates or cards are finished.")
                        Text("Preparing with your assistant shares these pages with its AI provider. Your notebook is never shared automatically.")
                        Text("Blank pages are excluded. Every selected note is saved as an ordered snapshot; long handwritten pages may export as several images.")
                    }.font(.footnote).foregroundStyle(PadPalette.muted).padding(.vertical, 6).listRowBackground(PadPalette.surface)
                    if prepared {
                        Section("This saved selection") {
                            ForEach(sentSubmissions) { submission in
                                NotebookSubmissionRow(submission: submission).listRowBackground(PadPalette.surface)
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden).background(PadPalette.background)
            }
            .background(PadPalette.background)
            .navigationTitle("Send to Recall").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(prepared ? "Done" : "Cancel") { dismiss() }.disabled(preparing) }
                ToolbarItem(placement: .confirmationAction) { Button(preparing ? "Saving…" : prepared ? "Saved" : preparation.error == nil ? "Send selected" : "Try again") { submit() }.disabled(preparing || prepared || selectedIds.isEmpty || bridge.pairedMac == nil).accessibilityIdentifier("notebook-send-confirm") }
            }
            .onAppear { selectInitial() }
            .onDisappear { preparation.cancelBeforeSaved() }
            .onChange(of: scenePhase) { _, phase in if phase != .active { preparation.cancelBeforeSaved() } }
            .interactiveDismissDisabled(preparing)
        }
    }
    private func selectionRow<Content: View>(id: String, @ViewBuilder content: () -> Content) -> some View {
        Button { if selectedIds.contains(id) { selectedIds.remove(id) } else { selectedIds.insert(id) } } label: {
            HStack(spacing: 14) {
                Image(systemName: selectedIds.contains(id) ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(selectedIds.contains(id) ? PadPalette.accent : PadPalette.muted)
                content()
                Spacer(minLength: 0)
            }.frame(minHeight: 44)
        }.buttonStyle(.plain).disabled(preparing || prepared || !eligibleIds.contains(id)).listRowBackground(PadPalette.surface)
        .accessibilityAddTraits(selectedIds.contains(id) ? [.isSelected] : [])
    }
    private func selectInitial() {
        guard !selectionInitialized else { return }
        selectionInitialized = true
        do {
            if let notebook = selectedNotebook {
                var counts: [String: Int] = [:]
                for note in notebooks.notes(in: notebook) { counts[note.id] = try notebooks.writtenPageIds(in: note).count }
                writtenCounts = counts
                eligibleIds = Set(counts.filter { $0.value > 0 }.map(\.key))
                selectedIds = eligibleIds
            } else if let note = selectedNote {
                eligibleIds = Set(try notebooks.writtenPageIds(in: note))
                if case .pages(_, let ids) = scope { selectedIds = Set(ids).intersection(eligibleIds) }
                else { selectedIds = eligibleIds }
            }
        } catch { self.error = error.localizedDescription }
    }
    private func submit() {
        guard !preparing, !prepared, let recipient = bridge.pairedMac?.installationId else { return }

        error = nil
        let notebook = selectedNotebook
        let note = selectedNote
        let selection = Array(selectedIds)
        preparation.start(commit: {
            if let notebook { return try notebooks.prepareSubmissions(notebook, selectedNoteIds: selection, recipientInstallationId: recipient) }
            if let note { return [try notebooks.prepareSubmission(note, selectedPageIds: selection, recipientInstallationId: recipient)] }
            throw PadError.rejected("This selected notebook or note is no longer available. Your other work is kept.")
        }, transfer: { await bridge.flushNotebookOutbox() })
    }
    private func retryTransfer() {
        do {
            for id in retryIds { try notebooks.retrySubmission(id) }
            error = nil
            Task { await bridge.flushNotebookOutbox() }
        } catch { self.error = error.localizedDescription }
    }
}

struct NotebookSubmissionRow: View {
    let submission: NotebookSubmission
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack { Text(submission.state.title).font(.subheadline.weight(.medium)); Spacer(); Text(submission.createdAt, style: .date).font(.caption) }
            Text("\(submission.sourcePages.count) source pages · saved snapshot").font(.caption)
            if let message = submission.lastError { Text(message).font(.footnote) }
            if let completed = submission.processedAt { Text("Processed \(completed.formatted(date: .abbreviated, time: .shortened))").font(.caption) }
            if let knowledge = submission.knowledgeStatus, !knowledge.isEmpty { Text("Knowledge base: \(knowledge)").font(.footnote) }
            if let cards = submission.cardIds, !cards.isEmpty { Text("\(cards.count) validated cards ready or reused").font(.caption).foregroundStyle(PadPalette.accent) }
            if submission.retryAllowed, submission.lastError != nil, submission.receivedAt == nil {
                Button("Retry transfer", systemImage: "arrow.clockwise") {
                    do { try notebooks.retrySubmission(submission.id); Task { await bridge.flushNotebookOutbox() } } catch { self.error = error.localizedDescription }
                }.font(.caption).buttonStyle(.bordered)
            }
            if submission.receivedAt != nil && [.awaitingAssistant, .needsAttention, .paused].contains(submission.state) { Text("On your Mac: Recall → Settings & backups → Learning connections → From your notebooks → View pages. Finish with assistant handles KB and card preparation.").font(.footnote) }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        }.foregroundStyle(PadPalette.muted).padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
    }
}

struct NotebookPageThumbnail: View {
    let page: PadNotebookPage
    @EnvironmentObject private var notebooks: NotebookStore
    var body: some View {
        Group {
            if let image = notebooks.thumbnail(for: page) { Image(uiImage: image).resizable().scaledToFit() }
            else { Image(systemName: "doc").font(.title2).foregroundStyle(PadPalette.accent).frame(maxWidth: .infinity, maxHeight: .infinity) }
        }.background(.white).clipShape(RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(PadPalette.border)).accessibilityHidden(true)
    }
}

struct NotebookSyncLabel: View {
    let summary: NotebookSyncSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(summary.title, systemImage: summary.pendingCount > 0 ? "clock" : summary.lastProcessedAt == nil ? "lock" : summary.hasChanges ? "pencil" : "checkmark.circle")
                .font(.caption).foregroundStyle(summary.lastProcessedAt != nil && !summary.hasChanges ? PadPalette.accent : PadPalette.muted)
            if let date = summary.lastProcessedAt { Text("Last added \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption2).foregroundStyle(PadPalette.muted) }
            if !summary.detail.isEmpty { Text(summary.detail).font(.caption2).foregroundStyle(PadPalette.muted).lineLimit(2) }
        }.accessibilityElement(children: .combine)
    }
}

struct NotebookEyebrow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.system(.caption2, design: .monospaced)).tracking(1.6).foregroundStyle(PadPalette.accent) }
}

private struct NotebookErrorPresentation: ViewModifier {
    @Binding var error: String?
    let storageError: String?
    func body(content: Content) -> some View {
        content.alert("Your work is kept", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
            .overlay(alignment: .bottom) {
                if let storageError { Label(storageError, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.red).padding(12).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).padding() }
            }
    }
}

private extension View {
    func notebookListRow(top: CGFloat = 6, bottom: CGFloat = 6) -> some View {
        listRowInsets(EdgeInsets(top: top, leading: 24, bottom: bottom, trailing: 24)).listRowBackground(Color.clear).listRowSeparator(.hidden)
    }
    func notebookListAppearance() -> some View {
        listStyle(.plain).scrollContentBackground(.hidden).environment(\.defaultMinListRowHeight, 0).frame(maxWidth: 1040).frame(maxWidth: .infinity).background(PadPalette.background)
    }
    func notebookError(error: Binding<String?>, storageError: String?) -> some View { modifier(NotebookErrorPresentation(error: error, storageError: storageError)) }
}
