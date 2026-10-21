import AppKit
import SwiftUI

// MARK: - Prompt de texto (nova coleção / renomear)

struct LibraryTextPromptView: View {
    let title: String
    let message: String
    let placeholder: String
    let actionTitle: String
    let onConfirm: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @FocusState private var focused: Bool

    init(
        title: String,
        message: String,
        placeholder: String,
        actionTitle: String,
        initial: String = "",
        onConfirm: @escaping (String) -> Void
    ) {
        self.title = title
        self.message = message
        self.placeholder = placeholder
        self.actionTitle = actionTitle
        self.onConfirm = onConfirm
        _text = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 15, weight: .bold, design: .rounded))

            Text(message)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))
                .focused($focused)
                .onSubmit(confirm)

            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(actionTitle, action: confirm)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 390)
        .background(Theme.background)
        .onAppear { focused = true }
    }

    private func confirm() {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        onConfirm(value)
        dismiss()
    }
}

// MARK: - Adicionar link

struct AddLibraryLinkView: View {
    let collection: LibraryCollection
    let onAdd: (String) async throws -> String
    var onFinished: (String) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Adicionar à coleção")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Text(collection.name)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Fechar")
            }

            HStack(spacing: 8) {
                Image(systemName: "link")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)

                TextField("Link da pasta (temporada) ou do vídeo…", text: $text)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .focused($focused)
                    .onSubmit(add)

                Button("Colar") { paste() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.accent)
            }
            .padding(.horizontal, 11)
            .frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.field))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(focused ? Theme.accent.opacity(0.6) : Color.white.opacity(0.08))
            )

            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("Adicione quantas pastas quiser na mesma coleção. Os episódios são unidos e ordenados por temporada/episódio — S04E01…S05E12.")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Spacer()

                Button("Cancelar") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                Button {
                    add()
                } label: {
                    if busy {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 64)
                    } else {
                        Text("Adicionar")
                            .frame(width: 64)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 500)
        .background(Theme.background)
        .onAppear { focused = true }
    }

    private func paste() {
        if let value = NSPasteboard.general.string(forType: .string) {
            text = value
        }
    }

    private func add() {
        guard !busy else { return }
        let link = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !link.isEmpty else { return }

        busy = true
        error = nil

        Task {
            do {
                let message = try await onAdd(link)
                onFinished(message)
                dismiss()
            } catch {
                self.error = error.localizedDescription
                busy = false
            }
        }
    }
}

// MARK: - Gerenciar fontes

struct ManageSourcesView: View {
    @ObservedObject var media: MediaLibrary
    let collectionID: String

    @Environment(\.dismiss) private var dismiss
    @State private var showAdd = false
    @State private var status: String?

    private var collection: LibraryCollection? {
        media.collection(id: collectionID)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(collection?.name ?? "Coleção")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Text("\(collection?.sources.count ?? 0) fonte(s) · \(media.episodeCount(in: collectionID)) episódio(s)")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button("Concluir") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(16)

            Divider().overlay(Color.white.opacity(0.07))

            if let sources = collection?.sources, !sources.isEmpty {
                List {
                    ForEach(sources) { source in
                        HStack(spacing: 10) {
                            Image(systemName: source.kind == .folder ? "folder.fill" : "film.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.accent)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(source.name)
                                    .font(.system(size: 12, weight: .medium))
                                    .lineLimit(1)
                                Text("\(source.videoCount) episódio(s) · \(source.kind == .folder ? "pasta" : "arquivo")")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            Menu("Mover para") {
                                let others = media.collections.filter { $0.id != collectionID }
                                if others.isEmpty {
                                    Text("Nenhuma outra coleção")
                                } else {
                                    ForEach(others) { other in
                                        Button(other.name) {
                                            media.moveSource(sourceID: source.id, from: collectionID, to: other.id)
                                            status = "Movido para “\(other.name)”"
                                        }
                                    }
                                }
                            }
                            .menuStyle(.borderlessButton)
                            .fixedSize()

                            Button(role: .destructive) {
                                media.removeSource(collectionID: collectionID, sourceID: source.id)
                                status = "Fonte removida"
                            } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 11))
                            }
                            .buttonStyle(.plain)
                            .help("Remover da coleção")
                        }
                        .padding(.vertical, 4)
                    }
                }
                .listStyle(.inset)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "folder.badge.plus")
                        .font(.system(size: 26))
                        .foregroundStyle(.tertiary)
                    Text("Nenhuma fonte ainda")
                        .font(.system(size: 12, weight: .medium))
                    Text("Adicione o link de uma pasta de temporada ou de um vídeo.")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Divider().overlay(Color.white.opacity(0.07))

            HStack(spacing: 10) {
                Button {
                    showAdd = true
                } label: {
                    Label("Adicionar link", systemImage: "plus")
                }

                Button {
                    Task {
                        await media.refreshSources(in: collectionID)
                        status = "Fontes atualizadas"
                    }
                } label: {
                    Label("Atualizar", systemImage: "arrow.clockwise")
                }
                .disabled(media.isRefreshing)

                if media.isRefreshing {
                    ProgressView().controlSize(.small)
                }

                if let status {
                    Text(status)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()
            }
            .padding(12)
        }
        .frame(width: 620, height: 430)
        .background(Theme.background)
        .sheet(isPresented: $showAdd) {
            if let collection {
                AddLibraryLinkView(collection: collection) { link in
                    try await LibraryLinkImporter.importLink(link, into: collectionID, media: media)
                } onFinished: { message in
                    status = message
                }
            }
        }
    }
}
