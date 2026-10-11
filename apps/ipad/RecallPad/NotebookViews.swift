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
    @State private var showCreate = false
    @State private var title = ""
    @State private var createdNoteId: String?
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
                        Text("Every note has its own pages. Nothing is shared automatically.").font(.subheadline).foregroundStyle(PadPalette.muted)
                    }.notebookListRow(top: 22, bottom: 20)
                    if notebooks.notes(in: notebook).isEmpty {
                        ContentUnavailableView("Begin with one note", systemImage: "doc.text", description: Text("Add a note, then write across as many pages as you need.")).notebookListRow()
                    }
                    ForEach(Array(notebooks.notes(in: notebook).enumerated()), id: \.element.id) { index, note in
                        NavigationLink { NotebookNoteView(noteId: note.id) } label: {
                            HStack(spacing: 14) {
                                Text(String(format: "%02d", index + 1)).font(.system(.caption, design: .monospaced)).foregroundStyle(PadPalette.accent).frame(width: 30)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(note.title).font(.system(.title3, design: .serif)).foregroundStyle(PadPalette.text)
                                    Text("\(notebooks.pages(in: note).count) pages").font(.caption).foregroundStyle(PadPalette.muted)
                                    NotebookSyncLabel(summary: notebooks.syncSummary(for: note))
                                }
                                Spacer(minLength: 0)
                            }.padding(16).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
                        }
                        .notebookListRow()
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
                    ToolbarItem(placement: .topBarTrailing) { Button("New note", systemImage: "plus") { title = ""; showCreate = true } }
                }
            } else { ContentUnavailableView("Notebook removed", systemImage: "book.closed", description: Text("Other notebooks and copies on your Mac are unchanged.")) }
        }
        .background(PadPalette.background)
        .navigationTitle(notebook?.title ?? "Notebook")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $createdNoteId) { NotebookNoteView(noteId: $0) }
        .sheet(item: $sendScope) { NotebookSendPreview(scope: $0) }
        .alert("New note", isPresented: $showCreate) {
            TextField("Note title", text: $title)
            Button("Create") { if let notebook { perform { let note = try notebooks.createNote(in: notebook, title: title); _ = try notebooks.addPage(to: note); createdNoteId = note.id } } }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Cancel", role: .cancel) {}
        }
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
    private func rename(_ item: PadNotebookNote) { title = item.title; renaming = item }
    private func perform(_ action: () throws -> Void) { do { try action() } catch { self.error = error.localizedDescription } }
}

struct NotebookNoteView: View {
    let noteId: String
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @State private var editingPage: PadNotebookPage?
    @State private var deletingPage: PadNotebookPage?
    @State private var sendScope: NotebookSendScope?
    @State private var error: String?
    private var note: PadNotebookNote? { notebooks.notes.first { $0.id == noteId } }

    var body: some View {
        Group {
            if let note {
                List {
                    VStack(alignment: .leading, spacing: 10) {
                        NotebookEyebrow("YOUR PAGES")
                        Text(note.title).font(.system(.largeTitle, design: .serif)).foregroundStyle(PadPalette.text)
                        NotebookSyncLabel(summary: notebooks.syncSummary(for: note))
                    }.notebookListRow(top: 22, bottom: 18)
                    ForEach(Array(notebooks.pages(in: note).enumerated()), id: \.element.id) { index, page in
                        Button { editingPage = page } label: {
                            HStack(spacing: 16) {
                                NotebookPageThumbnail(page: page).frame(width: 68, height: 86)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(page.title).font(.system(.title3, design: .serif)).foregroundStyle(PadPalette.text)
                                    Text("Page \(index + 1)").font(.caption).foregroundStyle(PadPalette.muted)
                                    Text(page.updatedAt, style: .date).font(.caption).foregroundStyle(PadPalette.muted)
                                    Text("Saved on iPad").font(.caption).foregroundStyle(PadPalette.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(PadPalette.muted)
                            }.padding(14).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
                        }.buttonStyle(.plain).notebookListRow()
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button { deletingPage = page } label: { Label("Delete", systemImage: "trash") }.tint(.red).disabled(bridge.activeNotebookNoteId == note.id)
                        }
                        .contextMenu {
                            Button("Open page", systemImage: "pencil") { editingPage = page }
                            Button("Send page to Recall…", systemImage: "arrow.up.doc") { sendScope = .pages(noteId: note.id, pageIds: [page.id]) }
                            Button("Delete page…", systemImage: "trash", role: .destructive) { deletingPage = page }.disabled(bridge.activeNotebookNoteId == note.id)
                        }
                        .accessibilityIdentifier("notebook-page-\(page.id)")
                    }
                    Button { addPage(note) } label: { Label("Add a page", systemImage: "doc.badge.plus").frame(maxWidth: .infinity, minHeight: 48) }
                        .buttonStyle(.bordered).notebookListRow(top: 14, bottom: 18).accessibilityIdentifier("notebook-add-page")
                    if !notebooks.submissions.filter({ $0.noteId == note.id }).isEmpty {
                        NotebookEyebrow("SENT SNAPSHOTS").notebookListRow(top: 18)
                        ForEach(notebooks.submissions.filter { $0.noteId == note.id }) { submission in
                            NotebookSubmissionRow(submission: submission).notebookListRow()
                        }
                    }
                }.notebookListAppearance()
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Send to Recall", systemImage: "arrow.up.doc") { sendScope = .note(note.id) }.disabled(notebooks.pages(in: note).isEmpty) } }
            } else { ContentUnavailableView("Note removed", systemImage: "doc.text") }
        }
        .background(PadPalette.background)
        .navigationTitle(note?.title ?? "Note").navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $editingPage) { NotebookPageEditor(initialPage: $0) }
        .sheet(item: $sendScope) { NotebookSendPreview(scope: $0) }
        .alert("Delete page?", isPresented: Binding(get: { deletingPage != nil }, set: { if !$0 { deletingPage = nil } })) {
            Button("Delete page", role: .destructive) { if let item = deletingPage { do { guard bridge.activeNotebookNoteId != item.noteId else { throw PadError.rejected("This note is transferring. Wait for it to finish before deleting a page.") }; try notebooks.delete(item) } catch { self.error = error.localizedDescription } }; deletingPage = nil }
            Button("Cancel", role: .cancel) { deletingPage = nil }
        } message: { Text("This page and any snapshot containing it that is still waiting to send will be removed from this iPad. Unsent writing will be lost. This cannot be undone. Earlier received Mac and KB copies remain.") }
        .notebookError(error: $error, storageError: notebooks.storageError)
    }
    private func addPage(_ note: PadNotebookNote) { do { editingPage = try notebooks.addPage(to: note) } catch { self.error = error.localizedDescription } }
}

enum NotebookSendScope: Identifiable {
    case notebook(String), note(String), pages(noteId: String, pageIds: [String])
    var id: String {
        switch self { case .notebook(let id): return "notebook-\(id)"; case .note(let id): return "note-\(id)"; case .pages(let id, let pages): return "pages-\(id)-\(pages.joined(separator: ","))" }
    }
}

struct NotebookSendPreview: View {
    let scope: NotebookSendScope
    @EnvironmentObject private var notebooks: NotebookStore
    @EnvironmentObject private var bridge: BridgeClient
    @Environment(\.dismiss) private var dismiss
    @State private var selectedIds: Set<String> = []
    @State private var eligibleIds: Set<String> = []
    @State private var writtenCounts: [String: Int] = [:]
    @State private var selectionInitialized = false
    @State private var preparing = false
    @State private var prepared = false
    @State private var error: String?

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
                    Label(bridge.connected ? "Snapshot saved · transferring to Mac" : "Snapshot saved · waiting for Mac", systemImage: "checkmark.circle")
                        .foregroundStyle(PadPalette.accent).listRowBackground(PadPalette.surface)
                    Text("Continue writing freely. New edits stay private until you send again. Preparation and KB/card outcomes will appear in the submission receipt.")
                        .font(.footnote).foregroundStyle(PadPalette.muted).listRowBackground(PadPalette.surface)
                }
                if let error { Label(error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.red).listRowBackground(PadPalette.surface) }
            }
            .scrollContentBackground(.hidden).background(PadPalette.background)
            .navigationTitle("Send to Recall").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(prepared ? "Done" : "Cancel") { dismiss() }.disabled(preparing) }
                ToolbarItem(placement: .confirmationAction) { Button(preparing ? "Saving…" : "Send selected") { submit() }.disabled(preparing || prepared || selectedIds.isEmpty || bridge.pairedMac == nil).accessibilityIdentifier("notebook-send-confirm") }
            }
            .onAppear { selectInitial() }
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
        preparing = true
        do {
            if let notebook = selectedNotebook { _ = try notebooks.prepareSubmissions(notebook, selectedNoteIds: Array(selectedIds), recipientInstallationId: recipient) }
            else if let note = selectedNote { _ = try notebooks.prepareSubmission(note, selectedPageIds: Array(selectedIds), recipientInstallationId: recipient) }
            else { throw PadError.rejected("This selected notebook or note is no longer available. Your other work is kept.") }
            prepared = true
            preparing = false
            Task { await bridge.flushNotebookOutbox() }
        } catch { preparing = false; self.error = error.localizedDescription }
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
            if submission.receivedAt != nil && [.awaitingAssistant, .needsAttention, .paused].contains(submission.state) { Text("Continue in Recall’s learning inbox on your Mac. Receiving pages does not finish KB or card preparation.").font(.footnote) }
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
