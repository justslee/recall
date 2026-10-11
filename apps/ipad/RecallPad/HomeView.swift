import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: DocumentStore
    @EnvironmentObject private var bridge: BridgeClient
    @State private var document: PaperDocument?
    @State private var showPairing = false
    @State private var error: String?
    @State private var pendingDeletion: PaperDocument?
    @State private var deletingSheet = false
    private var hasTutorSheet: Bool { store.documents.contains { $0.mode == .tutor && $0.tutorProblem == nil } }
    private var tutorSession: StudySession? {
        guard let session = bridge.tutorQuestionsSession, session.hasValidTutorBinding else { return nil }

        return session
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("A little space to think.").font(.system(.largeTitle, design: .serif)).bold()
                        Text("Write it out. Keep the working. Send it when you’re ready.").foregroundStyle(.secondary)
                    }.padding(.top, 24)
                    HStack(alignment: .top, spacing: 18) {
                        modeCard(title: "Recall Study", subtitle: "A question from your study desk", icon: "rectangle.on.rectangle.angled") {
                            if let session = bridge.studyQuestionsSession, let question = bridge.deskQuestions.first {
                                open(.study, question: question, handoffId: session.handoffId)
                            } else { error = "Open a math or concept card in Recall on your Mac and choose Write on iPad. Cached questions remain available offline." }
                        }
                        modeCard(title: "Tutor Pad", subtitle: tutorSession?.currentTutorProblem != nil ? tutorSession?.tutorTitle ?? "Your tutor conversation" : hasTutorSheet ? "Continue your latest sheet" : "Write on iPad. Paste into any app on your Mac.", icon: "pencil.and.scribble", actionTitle: tutorSession?.currentTutorProblem != nil || hasTutorSheet ? "Continue" : "Open") { openTutor() }
                    }
                    if let session = tutorSession, let problems = session.problems, !problems.isEmpty {
                        Text(session.tutorTitle ?? "Your tutor session").font(.headline)
                        ForEach(problems) { problem in
                            Button { openTutor(problem: problem, title: session.tutorTitle) } label: {
                                HStack {
                                    Image(systemName: problem.kind == "note" ? "note.text" : "pencil.and.scribble")
                                    Text(problem.title)
                                    Spacer()
                                    Text(problem.id == session.currentProblemId ? "Current" : "Earlier").font(.caption).foregroundStyle(.secondary)
                                    Image(systemName: "chevron.right")
                                }.padding(16)
                            }.buttonStyle(.bordered)
                        }
                    }
                    if let session = bridge.studyQuestionsSession, !bridge.deskQuestions.isEmpty {
                        Text(bridge.connected ? "Questions on your desk" : "Saved questions · offline").font(.headline)
                        ForEach(bridge.deskQuestions) { question in
                            Button { open(.study, question: question, handoffId: session.handoffId) } label: {
                                HStack {
                                    Image(systemName: question.kind == "math" ? "function" : "book.closed")
                                    Text(question.title)
                                    Spacer()
                                    Text(question.id == session.currentQuestionId ? "Current" : "Up next").font(.caption).foregroundStyle(.secondary)
                                    Image(systemName: "chevron.right")
                                }.padding(16)
                            }.buttonStyle(.bordered)
                        }
                    }
                    Text("Recent sheets").font(.headline)
                    if store.documents.isEmpty {
                        ContentUnavailableView("Your working belongs here", systemImage: "pencil.tip.crop.circle", description: Text("Start a study question or a blank tutor sheet. Work saves on this iPad, even offline."))
                    }
                    ForEach(store.documents) { item in
                        HStack(spacing: 12) {
                            Button { document = item } label: {
                                HStack(spacing: 18) {
                                    if let image = store.thumbnail(for: item) { Image(uiImage: image).resizable().scaledToFit().frame(width: 64, height: 58).background(.white).clipShape(RoundedRectangle(cornerRadius: 8)) }
                                    else { Image(systemName: item.mode == .study ? "book.closed" : "pencil.and.scribble").frame(width: 64, height: 58).background(.thinMaterial).clipShape(RoundedRectangle(cornerRadius: 8)) }
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(item.title).foregroundStyle(.primary)
                                        Text(sheetCategory(item)).font(.caption).foregroundStyle(PadPalette.accent)
                                        Text(item.state.title).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(item.updatedAt, style: .date).font(.caption).foregroundStyle(.secondary)
                                }
                                .contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Menu {
                                Button("Open sheet", systemImage: "doc.text") { document = item }
                                Button { confirmDeletion(of: item) } label: { Label("Delete sheet…", systemImage: "trash").foregroundStyle(.red) }
                            } label: { Image(systemName: "ellipsis").frame(width: 36, height: 44) }
                            .accessibilityLabel("Options for \(item.title)")
                        }
                        .padding(12).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("recent-sheet-\(item.id)")
                        .contextMenu { Button { confirmDeletion(of: item) } label: { Label("Delete sheet…", systemImage: "trash").foregroundStyle(.red) } }
                        .disabled(deletingSheet)
                    }
                }.padding(32).frame(maxWidth: 1000, alignment: .leading).frame(maxWidth: .infinity)
            }
            .background(PadPalette.background)
            .navigationTitle("Recall Pad")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showPairing = true } label: { Label(bridge.connected ? "Connected" : bridge.pairedMac == nil ? "Pair with Mac" : "Offline", systemImage: bridge.connected ? "link" : "link.badge.plus") }
                }
            }
            .fullScreenCover(item: $document) { PaperEditor(initialDocument: $0).environmentObject(store).environmentObject(bridge) }
            .sheet(isPresented: $showPairing) { PairingView().environmentObject(bridge) }
            .alert("Your work is kept", isPresented: Binding(get: { error != nil || store.storageError != nil }, set: { if !$0 { error = nil; store.storageError = nil } })) { Button("OK") { error = nil; store.storageError = nil } } message: { Text(error ?? store.storageError ?? "") }
        }.sheetDeletionConfirmation(item: $pendingDeletion, onDelete: delete)
    }
    private func modeCard(title: String, subtitle: String, icon: String, actionTitle: String = "Open", action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: icon).font(.title).padding(12).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                Text(title).font(.system(.title2, design: .serif)).bold()
                Text(subtitle).foregroundStyle(.secondary)
                HStack { Text(actionTitle); Image(systemName: "arrow.right") }.font(.subheadline).bold()
            }.frame(maxWidth: .infinity, alignment: .leading).padding(24).background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 24)).overlay(RoundedRectangle(cornerRadius: 24).stroke(.primary.opacity(0.08)))
        }.buttonStyle(.plain)
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
