import SwiftUI

enum PadHomeWork: Identifiable {
    case sheet(PaperDocument)
    case note(PadNotebookNote)

    var id: String {
        switch self {
        case .sheet(let item): return "sheet:\(item.id)"
        case .note(let item): return "note:\(item.id)"
        }
    }
    var title: String {
        switch self {
        case .sheet(let item): return item.title
        case .note(let item): return item.title
        }
    }
    var updatedAt: Date {
        switch self {
        case .sheet(let item): return item.updatedAt
        case .note(let item): return item.updatedAt
        }
    }
    static func recent(documents: [PaperDocument], notes: [PadNotebookNote]) -> [PadHomeWork] {
        (documents.map(Self.sheet) + notes.map(Self.note)).sorted {
            $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt
        }
    }
    static func resume(documents: [PaperDocument], notes: [PadNotebookNote], lastWork: String) -> PadHomeWork? {
        let items = recent(documents: documents, notes: notes)
        return items.first { $0.id == lastWork } ?? items.first
    }
}

struct HomeView: View {
    @EnvironmentObject private var store: DocumentStore
    @EnvironmentObject private var bridge: BridgeClient
    @EnvironmentObject private var notebooks: NotebookStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("padLastWorkV1") private var lastWork = ""
    @State private var document: PaperDocument?
    @State private var editingPage: PadNotebookPage?
    @State private var showPairing = false
    @State private var showHelp = false
    @State private var error: String?
    @State private var pendingDeletion: PaperDocument?
    @State private var deletingSheet = false
    @State private var recentFilter: RecentFilter = .all
    @State private var showAllWork = false
    @State private var showEarlierPrompts = false

    private enum RecentFilter: String, CaseIterable, Identifiable {
        case all = "All", notes = "Notes", study = "Study", tutor = "Tutor"
        var id: String { rawValue }
    }
    private var recentWork: [PadHomeWork] {
        PadHomeWork.recent(documents: store.documents, notes: notebooks.notes).filter { item in
            switch (recentFilter, item) {
            case (.all, _), (.notes, .note): return true
            case (.study, .sheet(let sheet)): return sheet.mode == .study
            case (.tutor, .sheet(let sheet)): return sheet.mode == .tutor
            default: return false
            }
        }
    }
    private var continuedWork: PadHomeWork? {
        PadHomeWork.resume(documents: store.documents, notes: notebooks.notes, lastWork: lastWork)
    }
    private var tutorSession: StudySession? {
        guard let session = bridge.tutorQuestionsSession, session.hasValidTutorBinding else { return nil }

        return session
    }
    private var continueTitle: String? {
        continuedWork?.title ?? tutorSession?.currentTutorProblem?.title ?? bridge.deskQuestions.first?.title
    }
    private var continueContext: String {
        if let work = continuedWork { return context(for: work) }
        if tutorSession?.currentTutorProblem != nil { return tutorSession?.tutorTitle ?? "Your tutor conversation" }
        return "From your Recall study desk"
    }
    private let rowInsets = EdgeInsets(top: 6, leading: 24, bottom: 6, trailing: 24)

    var body: some View {
        NavigationStack {
            List {
                deskIntroduction
                    .listRowInsets(EdgeInsets(top: 22, leading: 24, bottom: 18, trailing: 24))
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)

                if let title = continueTitle {
                    continueCard(title: title)
                        .listRowInsets(rowInsets).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }

                homeActions
                    .listRowInsets(EdgeInsets(top: 12, leading: 24, bottom: 14, trailing: 24))
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)

                if tutorSession?.currentTutorProblem != nil || !bridge.deskQuestions.isEmpty {
                    sectionHeading("From your Mac", label: bridge.connected ? "READY WHEN YOU ARE" : "SAVED QUESTIONS · OFFLINE")
                        .listRowInsets(EdgeInsets(top: 20, leading: 24, bottom: 5, trailing: 24))
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)

                    if let session = tutorSession, let problem = session.currentTutorProblem {
                        Button { openTutor(problem: problem, title: session.tutorTitle) } label: {
                            questionRow(title: problem.title, icon: "pencil.and.scribble", status: "Tutor", isCurrent: true, isTutor: true)
                        }
                        .buttonStyle(.plain).accessibilityIdentifier("tutor-problem-\(problem.id)")
                        .listRowInsets(rowInsets).listRowBackground(Color.clear).listRowSeparator(.hidden)
                    }
                    if let session = bridge.studyQuestionsSession {
                        ForEach(bridge.deskQuestions) { question in
                            Button { open(.study, question: question, handoffId: session.handoffId) } label: {
                                questionRow(title: question.title, icon: question.kind == "math" ? "function" : "book.closed", status: question.id == session.currentQuestionId ? "Study" : "Up next", isCurrent: question.id == session.currentQuestionId, isTutor: false)
                            }
                            .buttonStyle(.plain).accessibilityIdentifier("desk-question-\(question.id)")
                            .listRowInsets(rowInsets).listRowBackground(Color.clear).listRowSeparator(.hidden)
                        }
                    }
                }

                if let session = tutorSession, let problems = session.problems,
                   problems.contains(where: { $0.id != session.currentProblemId }) {
                    DisclosureGroup("Earlier tutor questions", isExpanded: $showEarlierPrompts) {
                        ForEach(problems.filter { $0.id != session.currentProblemId }) { problem in
                            Button { openTutor(problem: problem, title: session.tutorTitle) } label: {
                                questionRow(title: problem.title, icon: "pencil.and.scribble", status: "Earlier", isCurrent: false, isTutor: true)
                            }.buttonStyle(.plain).accessibilityIdentifier("tutor-problem-\(problem.id)")
                        }
                    }
                    .font(.subheadline).foregroundStyle(PadPalette.muted)
                    .listRowInsets(rowInsets).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }

                recentHeading
                    .listRowInsets(EdgeInsets(top: 24, leading: 24, bottom: 8, trailing: 24))
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)

                if recentWork.isEmpty {
                    ContentUnavailableView(recentFilter == .all ? "A fresh page awaits" : "No \(recentFilter.rawValue.lowercased()) here yet", systemImage: "pencil.tip.crop.circle", description: Text(recentFilter == .all ? "Start a private note, or open a question from your Mac. Your writing stays saved on this iPad." : "Choose All to see your other saved work."))
                        .listRowInsets(rowInsets).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(showAllWork ? recentWork : Array(recentWork.prefix(6))) { item in
                    recentRow(item)
                        .listRowInsets(rowInsets).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                if recentWork.count > 6 {
                    Button(showAllWork ? "Show recent work" : "Show all \(recentWork.count) saved items") { showAllWork.toggle() }
                        .font(.subheadline).accessibilityIdentifier("pad-show-all-work")
                        .listRowInsets(rowInsets).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain).scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 0)
            .frame(maxWidth: 1040).frame(maxWidth: .infinity)
            .background(PadPalette.background)
            .navigationTitle("Recall Pad").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink { NotebookLibraryView().navigationTitle("Notebooks") } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "books.vertical").accessibilityHidden(true)
                            Text("Notebooks")
                        }.font(.subheadline).fixedSize(horizontal: true, vertical: false)
                    }
                    .accessibilityIdentifier("pad-notebooks")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showPairing = true } label: {
                        Label(bridge.connected ? "Mac connected" : bridge.pairedMac == nil ? "Pair with Mac" : "Mac offline", systemImage: bridge.connected ? "link" : "link.badge.plus")
                    }
                    .labelStyle(.iconOnly).accessibilityIdentifier("mac-connection")
                    .accessibilityHint("Open pairing and connection settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Blank tutor sheet", systemImage: "doc.badge.plus") { openManualTutor() }
                        Button("Help & Privacy", systemImage: "questionmark.circle") { showHelp = true }
                            .accessibilityIdentifier("help-and-privacy")
                    } label: { Label("More", systemImage: "ellipsis.circle") }
                    .accessibilityIdentifier("pad-home-more")
                }
            }
            .fullScreenCover(item: $document) { PaperEditor(initialDocument: $0).environmentObject(store).environmentObject(bridge) }
            .fullScreenCover(item: $editingPage) { NotebookPageEditor(initialPage: $0) }
            .sheet(isPresented: $showPairing) { PairingView().environmentObject(bridge) }
            .sheet(isPresented: $showHelp) { HelpPrivacyView() }
            .alert("Your work is kept", isPresented: Binding(get: { error != nil || store.storageError != nil || notebooks.storageError != nil }, set: { if !$0 { error = nil; store.storageError = nil; notebooks.storageError = nil } })) {
                Button("OK") { error = nil; store.storageError = nil; notebooks.storageError = nil }
            } message: { Text(error ?? store.storageError ?? notebooks.storageError ?? "") }
        }.sheetDeletionConfirmation(item: $pendingDeletion, onDelete: delete)
    }

    private var deskIntroduction: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("YOUR WRITING DESK").font(.system(.caption2, design: .monospaced).weight(.medium)).tracking(2).foregroundStyle(PadPalette.accent)
            Text("A little space to think.").font(.system(.largeTitle, design: .serif)).foregroundStyle(PadPalette.text).accessibilityAddTraits(.isHeader)
            Text("Pick up where you left off, or start a fresh page.").font(.subheadline).foregroundStyle(PadPalette.muted)
        }
    }
    private func continueCard(title: String) -> some View {
        Button(action: continueWriting) {
            HStack(spacing: 18) {
                Image(systemName: "pencil.tip").font(.title2).foregroundStyle(PadPalette.accent)
                    .frame(width: 48, height: 54).background(PadPalette.accentSoft, in: RoundedRectangle(cornerRadius: 12)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text("CONTINUE").font(.system(.caption2, design: .monospaced).weight(.medium)).tracking(1.5).foregroundStyle(PadPalette.accent)
                    Text(title).font(.system(.title2, design: .serif)).foregroundStyle(PadPalette.text).lineLimit(3)
                    Text(continueContext).font(.caption).foregroundStyle(PadPalette.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.right").font(.subheadline).foregroundStyle(PadPalette.accent).accessibilityHidden(true)
            }
            .padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(PadPalette.border))
        }
        .buttonStyle(.plain).accessibilityElement(children: .combine)
        .accessibilityLabel("Continue \(title)").accessibilityIdentifier("pad-continue-work")
    }
    @ViewBuilder private var homeActions: some View {
        if horizontalSizeClass == .compact {
            VStack(alignment: .leading, spacing: 10) { newNoteButton; privacyCaption }
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 14) { newNoteButton; privacyCaption }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private var privacyCaption: some View {
        Text("Private until you choose to share.").font(.caption).foregroundStyle(PadPalette.muted)
    }
    private var newNoteButton: some View {
        Button(action: createNote) {
            HStack(spacing: 8) {
                Image(systemName: "plus").accessibilityHidden(true)
                Text("New note").lineLimit(1)
            }
            .font(.subheadline.weight(.medium))
            .fixedSize(horizontal: true, vertical: true)
            .padding(.horizontal, 16).frame(height: 44)
            .foregroundStyle(PadPalette.accentInk)
            .background(PadPalette.accent, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain).accessibilityLabel("New note")
        .accessibilityIdentifier("pad-new-note")
    }
    private func sectionHeading(_ title: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(.caption2, design: .monospaced)).tracking(1.5).foregroundStyle(PadPalette.muted)
            Text(title).font(.system(.title3, design: .serif)).foregroundStyle(PadPalette.text).accessibilityAddTraits(.isHeader)
        }
    }
    private func questionRow(title: String, icon: String, status: String, isCurrent: Bool, isTutor: Bool) -> some View {
        let ink = isTutor ? PadPalette.blueInk : PadPalette.accent
        let tint = isTutor ? PadPalette.bluePaper : PadPalette.accentSoft
        return HStack(spacing: 12) {
            Image(systemName: icon).font(.subheadline).foregroundStyle(ink).frame(width: 38, height: 38).background(tint, in: RoundedRectangle(cornerRadius: 9)).accessibilityHidden(true)
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(PadPalette.text)
            Spacer(minLength: 8)
            Text(status).font(.caption).foregroundStyle(isCurrent ? ink : PadPalette.muted).padding(.horizontal, 8).padding(.vertical, 5).background(isCurrent ? tint : Color.clear, in: Capsule())
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(PadPalette.muted).accessibilityHidden(true)
        }
        .padding(12).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border)).contentShape(Rectangle())
    }
    private var recentHeading: some View {
        HStack(alignment: .bottom, spacing: 12) {
            sectionHeading("Recent work", label: "SAVED ON THIS IPAD")
            Spacer(minLength: 0)
            Picker("Recent work type", selection: $recentFilter) {
                ForEach(RecentFilter.allCases) { filter in Text(filter.rawValue).tag(filter) }
            }.pickerStyle(.menu).labelsHidden().accessibilityLabel("Recent work type")
                .accessibilityIdentifier("recent-sheet-filter")
        }
    }
    @ViewBuilder private func recentRow(_ work: PadHomeWork) -> some View {
        switch work {
        case .sheet(let item):
            recentSheet(item)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button { confirmDeletion(of: item) } label: { Label("Delete", systemImage: "trash") }.tint(.red)
                        .accessibilityLabel("Delete \(item.title)").accessibilityIdentifier("swipe-delete-sheet-\(item.id)")
                }
                .contextMenu {
                    Button("Open sheet", systemImage: "doc.text") { openSaved(work) }
                    Button(role: .destructive) { confirmDeletion(of: item) } label: { Label("Delete sheet…", systemImage: "trash") }
                }
                .accessibilityAction(named: "Open sheet") { openSaved(work) }
                .accessibilityAction(named: "Delete sheet") { confirmDeletion(of: item) }
                .disabled(deletingSheet)
        case .note(let note):
            Button { openSaved(work) } label: {
                HStack(spacing: 14) {
                    Image(systemName: "note.text").font(.title3).foregroundStyle(PadPalette.accent)
                        .frame(width: 52, height: 62).background(PadPalette.accentSoft, in: RoundedRectangle(cornerRadius: 6)).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(note.title).font(.subheadline.weight(.medium)).foregroundStyle(PadPalette.text)
                        Text(context(for: work)).font(.caption).foregroundStyle(PadPalette.muted)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(PadPalette.muted).accessibilityHidden(true)
                }.padding(12).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
            }.buttonStyle(.plain).accessibilityIdentifier("recent-note-\(note.id)")
        }
    }
    private func recentSheet(_ item: PaperDocument) -> some View {
        HStack(spacing: 12) {
            Button { openSaved(.sheet(item)) } label: {
                HStack(spacing: 14) {
                    sheetThumbnail(item)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(PadPalette.text).lineLimit(2)
                        Text(context(for: .sheet(item))).font(.caption).foregroundStyle(item.mode == .study ? PadPalette.accent : PadPalette.blueInk)
                        if horizontalSizeClass == .compact {
                            Text(item.updatedAt, format: .dateTime.month(.abbreviated).day()).font(.caption2).foregroundStyle(PadPalette.muted)
                        }
                    }
                    Spacer(minLength: 4)
                    if horizontalSizeClass != .compact {
                        Text(item.updatedAt, style: .date).font(.caption2).foregroundStyle(PadPalette.muted)
                    }
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityHint("Open saved work. Swipe left or touch and hold for more actions.")
            Menu {
                Button("Open sheet", systemImage: "doc.text") { openSaved(.sheet(item)) }
                Button(role: .destructive) { confirmDeletion(of: item) } label: { Label("Delete sheet…", systemImage: "trash") }
            } label: { Image(systemName: "ellipsis").foregroundStyle(PadPalette.muted).frame(width: 44, height: 44).contentShape(Rectangle()) }
                .accessibilityLabel("Options for \(item.title)")
        }
        .padding(12).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
        .accessibilityElement(children: .contain).accessibilityIdentifier("recent-sheet-\(item.id)")
    }
    @ViewBuilder private func sheetThumbnail(_ item: PaperDocument) -> some View {
        if let image = store.thumbnail(for: item) {
            Image(uiImage: image).resizable().scaledToFit().frame(width: 52, height: 62).background(.white).clipShape(RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(PadPalette.border)).accessibilityHidden(true)
        } else {
            Image(systemName: item.mode == .study ? "book.closed" : "pencil.and.scribble").font(.title3).foregroundStyle(item.mode == .study ? PadPalette.accent : PadPalette.blueInk)
                .frame(width: 52, height: 62).background(item.mode == .study ? PadPalette.accentSoft : PadPalette.bluePaper, in: RoundedRectangle(cornerRadius: 6)).accessibilityHidden(true)
        }
    }
    private func context(for work: PadHomeWork) -> String {
        switch work {
        case .sheet(let item): return item.mode == .study ? "Recall study question" : item.tutorProblem != nil ? item.tutorTitle ?? "Tutor conversation" : "Manual tutor sheet · send to Mac"
        case .note(let note): return "Private note · \(notebooks.notebooks.first { $0.id == note.notebookId }?.title ?? "Notebook")"
        }
    }
    private func continueWriting() {
        if let work = continuedWork { openSaved(work) }
        else if let session = tutorSession, let problem = session.currentTutorProblem { openTutor(problem: problem, title: session.tutorTitle) }
        else if let session = bridge.studyQuestionsSession, let question = bridge.deskQuestions.first { open(.study, question: question, handoffId: session.handoffId) }
    }
    private func openSaved(_ work: PadHomeWork) {
        do {
            switch work {
            case .sheet(let item): document = item
            case .note(let note): editingPage = try notebooks.resumePage(for: note)
            }
            lastWork = work.id
        } catch { self.error = error.localizedDescription }
    }
    private func createNote() {
        do {
            let lastNote = notebooks.notes.first { "note:\($0.id)" == lastWork }
            let notebook: PadNotebook
            if let existing = notebooks.notebooks.first(where: { $0.id == lastNote?.notebookId })
                ?? notebooks.notebooks.sorted(by: { $0.updatedAt > $1.updatedAt }).first {
                notebook = existing
            } else {
                notebook = try notebooks.createNotebook(title: "My notebook")
            }
            let page = try notebooks.createNoteForWriting(in: notebook)
            lastWork = "note:\(page.noteId)"
            editingPage = page
        } catch { self.error = error.localizedDescription }
    }
    private func open(_ mode: PaperMode, question: QuestionPackage? = nil, handoffId: String? = nil) {
        do {
            var item = try store.open(mode: mode, question: question)
            item.handoffId = handoffId ?? item.handoffId
            lastWork = "sheet:\(item.id)"
            document = item
        } catch { self.error = error.localizedDescription }
    }
    private func openTutor(problem: TutorProblem, title: String?) {
        do {
            let item = try store.open(mode: .tutor, tutorProblem: problem, tutorTitle: title)
            lastWork = "sheet:\(item.id)"
            document = item
        } catch { self.error = error.localizedDescription }
    }
    private func openManualTutor() {
        do {
            let item = try store.open(mode: .tutor)
            lastWork = "sheet:\(item.id)"
            document = item
        } catch { self.error = error.localizedDescription }
    }
    private func confirmDeletion(of item: PaperDocument) {
        guard !deletingSheet else { return }

        pendingDeletion = item
    }
    private func delete(_ item: PaperDocument) throws {
        guard !deletingSheet else { return }

        deletingSheet = true
        defer { deletingSheet = false }
        try bridge.deleteSheet(item, from: store)
    }
}

enum PadHelpLinks {
    static let privacy = URL(string: "https://github.com/justslee/recall/blob/main/docs/PRIVACY.md")!
    static let setup = URL(string: "https://github.com/justslee/recall/blob/main/docs/SETUP.md#optional-ipad-companion")!
    static let overview = URL(string: "https://github.com/justslee/recall#recall")!
    static let support = URL(string: "https://github.com/justslee/recall/issues")!
}

private struct HelpPrivacyView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        Image(systemName: "book.closed").font(.title).foregroundStyle(PadPalette.accent)
                        Text("A little help for your desk.").font(.system(.title, design: .serif)).bold()
                        Text("Write offline. Connect when you need to. Keep control of your work.").foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Saved on this iPad", systemImage: "lock.shield").font(.headline)
                        Text("Your editable sheets and queued submissions are stored locally, including offline. Recall Pad has no required account or analytics.")
                        Divider()
                        Label("You choose what to send", systemImage: "paperplane").font(.headline)
                        Text("Pairing connects to your Mac over an authenticated local connection. Selected work transfers when you tap Send; queued submissions resume when the apps reconnect. You can also export or share your pages yourself.")
                        Divider()
                        Label("Feedback stays with your tutor", systemImage: "text.bubble").font(.headline)
                        Text("Recall Study feedback happens on your Mac. Tutor Pad work goes to your connected tutor session or Mac page tray. Optional AI feedback may send the selected work to your provider when you request it; API credentials are never sent to this iPad.")
                    }
                    .font(.subheadline)
                    .padding(22)
                    .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                    VStack(spacing: 0) {
                        helpLink("Privacy policy", icon: "hand.raised", destination: PadHelpLinks.privacy)
                        Divider().padding(.horizontal, 20)
                        helpLink("Set up & pair your Mac", icon: "ipad.and.arrow.forward", destination: PadHelpLinks.setup)
                        Divider().padding(.horizontal, 20)
                        helpLink("Explore Recall", icon: "book", destination: PadHelpLinks.overview)
                        Divider().padding(.horizontal, 20)
                        helpLink("Get help or report a problem", icon: "questionmark.bubble", destination: PadHelpLinks.support)
                    }
                    .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                    Text("These links open in your browser. For public support, leave out private work, pairing codes and credentials.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .padding(28)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(PadPalette.background)
            .navigationTitle("Help & Privacy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
    private func helpLink(_ title: String, icon: String, destination: URL) -> some View {
        Link(destination: destination) {
            HStack(spacing: 14) {
                Image(systemName: icon).frame(width: 24)
                Text(title)
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary)
            }.padding(20).contentShape(Rectangle())
        }
    }
}

struct PairingView: View {
    @EnvironmentObject private var bridge: BridgeClient
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var scanner = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Pair once, write anywhere", systemImage: "ipad.and.arrow.forward").font(.headline)
                    Text("In Recall on your Mac, open Settings → iPad & handwriting and show the pairing code. Both devices must be on the same local network.").foregroundStyle(.secondary)
                    Button("Scan pairing QR code", systemImage: "qrcode.viewfinder") { scanner = true }
                }
                Section("Or paste the pairing code") {
                    TextEditor(text: $code).frame(minHeight: 100).autocorrectionDisabled().textInputAutocapitalization(.never)
                    Button(bridge.pairing ? "Waiting for Mac confirmation…" : "Pair with Mac") { Task { await bridge.pair(code) } }.disabled(code.isEmpty || bridge.pairing)
                }
                if let message = bridge.message { Section { Text(message).foregroundStyle(.secondary) } }
                if bridge.pairedMac != nil {
                    Section("Paired Mac") {
                        Label(bridge.connected ? "Connected securely" : "Waiting for your Mac", systemImage: "lock.shield")
                        Text("Writing and saved questions work offline. Sending resumes while Recall and this app are open.").font(.footnote)
                        Button("Forget this Mac", role: .destructive) { bridge.forgetMac() }
                    }
                }
            }.navigationTitle("Connect your desk").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $scanner) {
                QRScanner { value in code = value; scanner = false; Task { await bridge.pair(value) } }
                    .ignoresSafeArea()
                    .overlay(alignment: .topTrailing) { Button("Cancel") { scanner = false }.buttonStyle(.borderedProminent).padding(24) }
            }
        }
    }
}
