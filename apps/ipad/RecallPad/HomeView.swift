import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: DocumentStore
    @EnvironmentObject private var bridge: BridgeClient
    @State private var document: PaperDocument?
    @State private var showPairing = false
    @State private var showHelp = false
    @State private var error: String?
    @State private var pendingDeletion: PaperDocument?
    @State private var deletingSheet = false
    @State private var recentFilter: RecentFilter = .all
    @State private var workspace: Workspace = .live

    private enum Workspace: String, CaseIterable, Identifiable {
        case live = "Live", notebooks = "Notebooks"
        var id: String { rawValue }
    }

    private enum RecentFilter: String, CaseIterable, Identifiable {
        case all = "All", study = "Study", tutor = "Tutor"
        var id: String { rawValue }
    }

    private var hasTutorSheet: Bool { store.documents.contains { $0.mode == .tutor && $0.tutorProblem == nil } }
    private var recentDocuments: [PaperDocument] {
        store.documents.filter { item in
            switch recentFilter {
            case .all: return true
            case .study: return item.mode == .study
            case .tutor: return item.mode == .tutor
            }
        }
    }
    private let rowInsets = EdgeInsets(top: 6, leading: 24, bottom: 6, trailing: 24)
    private var tutorSession: StudySession? {
        guard let session = bridge.tutorQuestionsSession, session.hasValidTutorBinding else { return nil }

        return session
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Writing workspace", selection: $workspace) {
                    ForEach(Workspace.allCases) { item in Text(item.rawValue).tag(item) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 340)
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .padding(.bottom, 4)
                .accessibilityIdentifier("pad-workspace-picker")

                if workspace == .live {
                    List {
                deskIntroduction
                    .listRowInsets(EdgeInsets(top: 22, leading: 24, bottom: 16, trailing: 24))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                modeCards
                    .listRowInsets(rowInsets)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                if let session = tutorSession, let problems = session.problems, !problems.isEmpty {
                    sectionHeading(session.tutorTitle ?? "Your tutor session", label: "IN CONVERSATION")
                        .listRowInsets(EdgeInsets(top: 24, leading: 24, bottom: 4, trailing: 24))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)

                    ForEach(problems) { problem in
                        Button { openTutor(problem: problem, title: session.tutorTitle) } label: {
                            questionRow(title: problem.title, icon: problem.kind == "note" ? "note.text" : "pencil.and.scribble", status: problem.id == session.currentProblemId ? "Current" : "Earlier", isCurrent: problem.id == session.currentProblemId, isTutor: true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("tutor-problem-\(problem.id)")
                        .listRowInsets(rowInsets)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }

                if let session = bridge.studyQuestionsSession, !bridge.deskQuestions.isEmpty {
                    sectionHeading(bridge.connected ? "Questions on your desk" : "Saved questions · offline", label: "RECALL STUDY")
                        .listRowInsets(EdgeInsets(top: 24, leading: 24, bottom: 4, trailing: 24))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)

                    ForEach(bridge.deskQuestions) { question in
                        Button { open(.study, question: question, handoffId: session.handoffId) } label: {
                            questionRow(title: question.title, icon: question.kind == "math" ? "function" : "book.closed", status: question.id == session.currentQuestionId ? "Current" : "Up next", isCurrent: question.id == session.currentQuestionId, isTutor: false)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("desk-question-\(question.id)")
                        .listRowInsets(rowInsets)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }

                recentHeading
                    .listRowInsets(EdgeInsets(top: 26, leading: 24, bottom: 8, trailing: 24))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                if recentDocuments.isEmpty {
                    ContentUnavailableView(store.documents.isEmpty ? "Your working belongs here" : "No \(recentFilter.rawValue.lowercased()) sheets yet", systemImage: "pencil.tip.crop.circle", description: Text(store.documents.isEmpty ? "Start a study question or a blank tutor sheet. Work saves on this iPad, even offline." : "Choose All to see your other saved work, or open a sheet above."))
                        .listRowInsets(rowInsets)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                ForEach(recentDocuments) { item in
                    recentSheet(item)
                        .listRowInsets(rowInsets)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button { confirmDeletion(of: item) } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            .tint(.red)
                            .accessibilityLabel("Delete \(item.title)")
                            .accessibilityIdentifier("swipe-delete-sheet-\(item.id)")
                        }
                        .contextMenu {
                            Button("Open sheet", systemImage: "doc.text") { document = item }
                            Button(role: .destructive) { confirmDeletion(of: item) } label: { Label("Delete sheet…", systemImage: "trash") }
                        }
                        .accessibilityAction(named: "Open sheet") { document = item }
                        .accessibilityAction(named: "Delete sheet") { confirmDeletion(of: item) }
                        .disabled(deletingSheet)
                }

                Label("Swipe a sheet for actions, or touch and hold.", systemImage: "hand.draw")
                    .font(.footnote)
                    .foregroundStyle(PadPalette.muted)
                    .padding(.vertical, 8)
                    .listRowInsets(rowInsets)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 0)
            .frame(maxWidth: 1040)
            .frame(maxWidth: .infinity)
            .background(PadPalette.background)
                } else {
                    NotebookLibraryView()
                }
            }
            .background(PadPalette.background)
            .navigationTitle("Recall Pad")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showHelp = true } label: { Label("Help & Privacy", systemImage: "questionmark.circle") }
                        .accessibilityIdentifier("help-and-privacy")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showPairing = true } label: {
                        Label(bridge.connected ? "Connected" : bridge.pairedMac == nil ? "Pair with Mac" : "Offline", systemImage: bridge.connected ? "link" : "link.badge.plus")
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(PadPalette.accentSoft, in: Capsule())
                    }
                    .accessibilityIdentifier("mac-connection")
                    .accessibilityHint("Open pairing and connection settings")
                }
            }
            .fullScreenCover(item: $document) { PaperEditor(initialDocument: $0).environmentObject(store).environmentObject(bridge) }
            .sheet(isPresented: $showPairing) { PairingView().environmentObject(bridge) }
            .sheet(isPresented: $showHelp) { HelpPrivacyView() }
            .alert("Your work is kept", isPresented: Binding(get: { error != nil || store.storageError != nil }, set: { if !$0 { error = nil; store.storageError = nil } })) { Button("OK") { error = nil; store.storageError = nil } } message: { Text(error ?? store.storageError ?? "") }
        }.sheetDeletionConfirmation(item: $pendingDeletion, onDelete: delete)
    }

    private var deskIntroduction: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("YOUR WRITING DESK")
                .font(.system(.caption2, design: .monospaced).weight(.medium))
                .tracking(2)
                .foregroundStyle(PadPalette.accent)
            Text("A little space to think.")
                .font(.system(.largeTitle, design: .serif))
                .foregroundStyle(PadPalette.text)
                .accessibilityAddTraits(.isHeader)
            Text("Write it out. Keep the working. Send it when you’re ready.")
                .font(.subheadline)
                .foregroundStyle(PadPalette.muted)
        }
    }

    private var modeCards: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) {
                studyModeCard.frame(minWidth: 290)
                tutorModeCard.frame(minWidth: 290)
            }
            VStack(spacing: 12) {
                studyModeCard
                tutorModeCard
            }
        }
    }

    private var studyModeCard: some View {
        modeCard(title: "Recall Study", subtitle: "A question from your study desk", icon: "rectangle.on.rectangle.angled", index: "01", isTutor: false, actionTitle: "Open study") {
            if let session = bridge.studyQuestionsSession, let question = bridge.deskQuestions.first {
                open(.study, question: question, handoffId: session.handoffId)
            } else {
                error = "Open a math or concept card in Recall on your Mac and choose Write on iPad. Cached questions remain available offline."
            }
        }
        .accessibilityIdentifier("open-recall-study")
    }

    private var tutorModeCard: some View {
        modeCard(title: "Tutor Pad", subtitle: tutorSession?.currentTutorProblem != nil ? tutorSession?.tutorTitle ?? "Your tutor conversation" : hasTutorSheet ? "Continue your latest sheet" : "A blank sheet, or a problem from your tutor.", icon: "pencil.and.scribble", index: "02", isTutor: true, actionTitle: tutorSession?.currentTutorProblem != nil || hasTutorSheet ? "Continue writing" : "Open pad") { openTutor() }
            .accessibilityIdentifier("open-tutor-pad")
    }

    private func modeCard(title: String, subtitle: String, icon: String, index: String, isTutor: Bool, actionTitle: String, action: @escaping () -> Void) -> some View {
        let ink = isTutor ? PadPalette.blueInk : PadPalette.accent
        let tint = isTutor ? PadPalette.bluePaper : PadPalette.accentSoft

        return Button(action: action) {
            VStack(alignment: .leading, spacing: 15) {
                HStack {
                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .regular))
                        .frame(width: 40, height: 40)
                        .background(tint, in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityHidden(true)
                    Spacer()
                    Text(index)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(PadPalette.muted)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.system(.title2, design: .serif)).foregroundStyle(PadPalette.text)
                    Text(subtitle).font(.subheadline).foregroundStyle(PadPalette.muted)
                }
                Divider().overlay(PadPalette.border)
                HStack {
                    Text(actionTitle).font(.subheadline.weight(.medium))
                    Spacer()
                    Image(systemName: "arrow.right").font(.subheadline)
                }
            }
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 16))
            .overlay(alignment: .top) { RoundedRectangle(cornerRadius: 2).fill(ink.opacity(0.55)).frame(width: 44, height: 3).padding(.top, 1) }
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(PadPalette.border))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
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
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(ink)
                .frame(width: 38, height: 38)
                .background(tint, in: RoundedRectangle(cornerRadius: 9))
                .accessibilityHidden(true)
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(PadPalette.text)
            Spacer(minLength: 8)
            Text(status)
                .font(.caption)
                .foregroundStyle(isCurrent ? ink : PadPalette.muted)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(isCurrent ? tint : Color.clear, in: Capsule())
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(PadPalette.muted).accessibilityHidden(true)
        }
        .padding(12)
        .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
        .contentShape(Rectangle())
    }

    private var recentHeading: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: 24) {
                sectionHeading("Recent sheets", label: "YOUR SAVED WORK").fixedSize(horizontal: true, vertical: false)
                Spacer(minLength: 16)
                recentFilterPicker.frame(width: 250)
            }
            VStack(alignment: .leading, spacing: 12) {
                sectionHeading("Recent sheets", label: "YOUR SAVED WORK")
                recentFilterPicker
            }
        }
    }

    private var recentFilterPicker: some View {
        Picker("Recent sheet type", selection: $recentFilter) {
            ForEach(RecentFilter.allCases) { filter in Text(filter.rawValue).tag(filter) }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("recent-sheet-filter")
    }

    private func recentSheet(_ item: PaperDocument) -> some View {
        HStack(spacing: 12) {
            Button { document = item } label: {
                HStack(spacing: 14) {
                    sheetThumbnail(item)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(PadPalette.text)
                        Text(sheetCategory(item)).font(.caption).foregroundStyle(item.mode == .study ? PadPalette.accent : PadPalette.blueInk)
                        Text(item.state.title).font(.caption).foregroundStyle(PadPalette.muted)
                    }
                    Spacer(minLength: 4)
                    Text(item.updatedAt, style: .date).font(.caption2).foregroundStyle(PadPalette.muted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Open saved work. Swipe left or touch and hold for more actions.")
            Menu {
                Button("Open sheet", systemImage: "doc.text") { document = item }
                Button(role: .destructive) { confirmDeletion(of: item) } label: { Label("Delete sheet…", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundStyle(PadPalette.muted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Options for \(item.title)")
        }
        .padding(12)
        .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PadPalette.border))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("recent-sheet-\(item.id)")
    }

    @ViewBuilder
    private func sheetThumbnail(_ item: PaperDocument) -> some View {
        if let image = store.thumbnail(for: item) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: 52, height: 62)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(PadPalette.border))
                .accessibilityHidden(true)
        } else {
            Image(systemName: item.mode == .study ? "book.closed" : "pencil.and.scribble")
                .font(.title3)
                .foregroundStyle(item.mode == .study ? PadPalette.accent : PadPalette.blueInk)
                .frame(width: 52, height: 62)
                .background(item.mode == .study ? PadPalette.accentSoft : PadPalette.bluePaper, in: RoundedRectangle(cornerRadius: 6))
                .accessibilityHidden(true)
        }
    }
    private func open(_ mode: PaperMode, question: QuestionPackage? = nil, handoffId: String? = nil) {
        do { var item = try store.open(mode: mode, question: question); item.handoffId = handoffId ?? item.handoffId; document = item }
        catch { self.error = error.localizedDescription }
    }
    private func openTutor() {
        do {
            if let session = tutorSession, let problem = session.currentTutorProblem {
                document = try store.open(mode: .tutor, tutorProblem: problem, tutorTitle: session.tutorTitle)
            } else {
                document = try store.openTutorWorkspace()
            }
        } catch { self.error = error.localizedDescription }
    }
    private func openTutor(problem: TutorProblem, title: String?) {
        do { document = try store.open(mode: .tutor, tutorProblem: problem, tutorTitle: title) }
        catch { self.error = error.localizedDescription }
    }
    private func sheetCategory(_ item: PaperDocument) -> String {
        item.mode == .study ? "Recall Study" : item.tutorProblem != nil ? item.tutorTitle ?? "Tutor conversation" : "Tutor Pad"
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
