import SwiftUI

/// Kept in the existing view hierarchy so confirming or canceling never reloads a writing canvas.
struct SheetDeletionConfirmation: View {
    let document: PaperDocument
    let onCancel: () -> Void
    let onDelete: () throws -> Void
    @Environment(\.colorScheme) private var colorScheme
    @AccessibilityFocusState private var titleFocused: Bool
    @State private var deletionError: String?
    @State private var deleting = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(colorScheme == .dark ? 0.5 : 0.3)
                    .ignoresSafeArea()
                ViewThatFits(in: .vertical) {
                    confirmationCard
                    ScrollView { confirmationCard }
                        .scrollBounceBehavior(.basedOnSize)
                }
                .frame(maxWidth: 420, maxHeight: max(160, geometry.size.height - 48))
                .padding(24)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sheet-deletion-confirmation")
        .accessibilityAction(.escape) { if !deleting { onCancel() } }
        .onAppear { titleFocused = true }
    }

    private var confirmationCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: "trash")
                    .font(.title3)
                    .foregroundStyle(.red)
                    .frame(width: 44, height: 44)
                    .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
                Text("Delete this sheet?")
                    .font(.system(.title2, design: .serif).weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($titleFocused)
            }
            Text(document.title).font(.headline).textSelection(.disabled)
            Text("Its ink, saved submissions and anything waiting to send will be removed from this iPad. This can’t be undone.")
                .foregroundStyle(.secondary)
            Text("Copies on your Mac or in a chat will stay there.")
                .font(.footnote).foregroundStyle(.secondary)
            if let deletionError {
                Label(deletionError, systemImage: "exclamationmark.circle")
                    .font(.footnote).foregroundStyle(.red)
                    .accessibilityIdentifier("sheet-deletion-error")
            }
            HStack(spacing: 12) {
                Button(action: onCancel) {
                    Text("Cancel").fontWeight(.semibold)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("cancel-sheet-deletion")
                Button(role: .destructive, action: confirm) {
                    Text("Delete sheet").fontWeight(.semibold)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundStyle(.white)
                        .background(Color(red: 0.72, green: 0.18, blue: 0.17), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("confirm-sheet-deletion")
            }.disabled(deleting)
        }
        .padding(24)
        .fixedSize(horizontal: false, vertical: true)
        .background(PadPalette.surface, in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.primary.opacity(0.08)))
        .shadow(color: .black.opacity(0.15), radius: 24, y: 8)
    }

    private func confirm() {
        guard !deleting else { return }

        deleting = true
        defer { deleting = false }
        do { try onDelete() }
        catch { deletionError = error.localizedDescription }
    }
}

private struct SheetDeletionPresentation: ViewModifier {
    @Binding var item: PaperDocument?
    let onDelete: (PaperDocument) throws -> Void

    func body(content: Content) -> some View {
        content
            .disabled(item != nil)
            .accessibilityHidden(item != nil)
            .overlay {
                if let item {
                    SheetDeletionConfirmation(document: item, onCancel: { self.item = nil }) {
                        try onDelete(item)
                        self.item = nil
                    }
                }
            }
    }
}

extension View {
    func sheetDeletionConfirmation(item: Binding<PaperDocument?>, onDelete: @escaping (PaperDocument) throws -> Void) -> some View {
        modifier(SheetDeletionPresentation(item: item, onDelete: onDelete))
    }
}
