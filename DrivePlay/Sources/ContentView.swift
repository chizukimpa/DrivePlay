import AppKit
import SwiftUI

enum Theme {
    static let background = Color(red: 0.055, green: 0.06, blue: 0.075)
    static let surface = Color(red: 0.085, green: 0.09, blue: 0.11)
    static let field = Color.white.opacity(0.055)
    static let accent = Color(red: 0.36, green: 0.55, blue: 1.0)
}

struct AlertInfo: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

struct ContentView: View {
    @StateObject private var library = Library()
    @StateObject private var downloads = DownloadManager()
    @StateObject private var browser = FolderBrowser()
    @StateObject private var player = PlayerController()
    @StateObject private var progress = ProgressStore()
    @StateObject private var media = MediaLibrary()

    @AppStorage("skipIntro") private var skipIntro = PlaybackDefaults.skipIntro
    @AppStorage("introSeconds") private var introSeconds = PlaybackDefaults.introSeconds
    @AppStorage("skipEnding") private var skipEnding = PlaybackDefaults.skipEnding
    @AppStorage("endingSeconds") private var endingSeconds = PlaybackDefaults.endingSeconds
    @AppStorage("autoNext") private var autoNext = PlaybackDefaults.autoNext
    @AppStorage("resumePlayback") private var resumePlayback = PlaybackDefaults.resumePlayback
    @AppStorage("showSkipButtons") private var showSkipButtons = PlaybackDefaults.showSkipButtons
    @AppStorage("autoFullscreen") private var autoFullscreen = PlaybackDefaults.autoFullscreen
    @AppStorage("fillScreen") private var fillScreen = false
    @AppStorage("libraryMode") private var libraryMode = false

    @State private var linkText = ""
    @State private var currentID: String?
    @State private var currentTitle = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var reloadToken = 0
    @State private var showHelp = false
    @State private var showSettings = false
    @State private var alertInfo: AlertInfo?
    @State private var selectedEntryID: String?
    @State private var showSidebar = true

    @State private var librarySearch = ""
    @State private var showNewCollection = false
    @State private var newCollectionName = ""
    @State private var addFolderAfterCreating = false
    @State private var showAddLibraryLink = false
    @State private var showManageSources = false
    @State private var showRenameCollection = false
    @State private var renameText = ""
    @State private var renamingCollectionID: String?
    @State private var showDeleteCollection = false
    @State private var deletingCollectionID: String?
    @State private var sharingPicker: NSSharingServicePicker?

    @State private var didResume = false
    @State private var didSkipIntro = false
    @State private var didAdvance = false
    @State private var resumeTarget: Double?
    @State private var lastSavedTick: Double = 0
    @State private var toast: String?
    @State private var toastToken = 0
    @State private var videoFullscreen = false

    @FocusState private var linkFocused: Bool

    private let initialLink: String?

    init(initialLink: String?) {
        self.initialLink = initialLink
    }

    var body: some View {
        VStack(spacing: 0) {
            if !videoFullscreen {
                header
                Divider().overlay(Color.white.opacity(0.07))
            }

            HStack(spacing: 0) {
                if !videoFullscreen && (browser.current != nil || libraryMode) && showSidebar {
                    sidebar
                    Divider().overlay(Color.white.opacity(0.07))
                }
                content
            }

            if !videoFullscreen && currentID != nil {
                Divider().overlay(Color.white.opacity(0.07))
                footer
            }
        }
        .background(Theme.background)
        .navigationTitle(windowTitle)
        .onAppear(perform: prepare)
        .onReceive(NotificationCenter.default.publisher(for: .pasteAndPlay)) { _ in pasteAndPlay() }
        .onReceive(NotificationCenter.default.publisher(for: .reloadPlayer)) { _ in reload() }
        .onReceive(NotificationCenter.default.publisher(for: .openInVLC)) { _ in openInVLC() }
        .onReceive(NotificationCenter.default.publisher(for: .nextEpisode)) { _ in playNext() }
        .onReceive(NotificationCenter.default.publisher(for: .previousEpisode)) { _ in playPrevious() }
        .onChange(of: player.currentTime) { handlePlaybackTick() }
        .onChange(of: player.hasEnded) { handlePlaybackTick() }
        .onChange(of: fillScreen) { player.setFill(fillScreen) }
        .modifier(AutoFullscreenOnIdle(
            enabled: autoFullscreen,
            videoID: currentID,
            hasVideo: player.hasVideo,
            hasEnded: player.hasEnded,
            isLoading: isLoading,
            onFullscreenChange: { videoFullscreen = $0 }
        ))
        .sheet(isPresented: $showHelp) { HelpView() }
        .sheet(isPresented: $showAddLibraryLink) {
            if let collection = media.selectedCollection {
                AddLibraryLinkView(collection: collection) { link in
                    try await LibraryLinkImporter.importLink(link, into: collection.id, media: media)
                } onFinished: { message in
                    showToast(message)
                }
            }
        }
        .sheet(isPresented: $showManageSources) {
            if let collection = media.selectedCollection {
                ManageSourcesView(media: media, collectionID: collection.id)
            }
        }
        .sheet(isPresented: $showNewCollection) {
            LibraryTextPromptView(
                title: "Nova coleção",
                message: "Dê um nome para a coleção (por exemplo, o nome do anime). Você pode adicionar várias temporadas dentro dela.",
                placeholder: "Nome da coleção",
                actionTitle: "Criar"
            ) { name in
                let id = media.createCollection(name: name)
                if addFolderAfterCreating, let folder = browser.current {
                    media.addSource(
                        collectionID: id,
                        kind: .folder,
                        driveID: folder.id,
                        name: folder.name,
                        entries: folder.entries
                    )
                    showToast("Pasta adicionada à nova coleção")
                } else {
                    showToast("Coleção criada")
                }
                addFolderAfterCreating = false
            }
        }
        .sheet(isPresented: $showRenameCollection) {
            LibraryTextPromptView(
                title: "Renomear coleção",
                message: "Escolha um novo nome para a coleção.",
                placeholder: "Nome da coleção",
                actionTitle: "Salvar",
                initial: media.collection(id: renamingCollectionID ?? "")?.name ?? ""
            ) { name in
                if let id = renamingCollectionID {
                    media.renameCollection(id: id, name: name)
                    showToast("Coleção renomeada")
                }
            }
        }
        .confirmationDialog(
            "Excluir coleção?",
            isPresented: $showDeleteCollection,
            titleVisibility: .visible
        ) {
            Button("Excluir", role: .destructive) {
                if let id = deletingCollectionID, media.deleteCollection(id: id) {
                    showToast("Coleção excluída")
                }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Os links saem só da biblioteca; nada é apagado do Google Drive.")
        }
        .alert(item: $alertInfo) { info in
            Alert(
                title: Text(info.title),
                message: Text(info.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    private var windowTitle: String {
        if !currentTitle.isEmpty { return currentTitle }
        if libraryMode, let collection = media.selectedCollection { return collection.name }
        if let folder = browser.current { return folder.name }
        return "DrivePlay"
    }

    // MARK: - Cabeçalho

    private var header: some View {
        HStack(spacing: 14) {
            logo

            HStack(spacing: 8) {
                Image(systemName: "link")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)

                TextField("Cole o link de uma pasta ou de um vídeo do Drive…", text: $linkText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .focused($linkFocused)
                    .onSubmit(openFromField)

                if !linkText.isEmpty {
                    Button {
                        linkText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Limpar")
                }
            }
            .padding(.horizontal, 11)
            .frame(height: 34)
            .background(RoundedRectangle(cornerRadius: 9).fill(Theme.field))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(linkFocused ? Theme.accent.opacity(0.65) : Color.white.opacity(0.08), lineWidth: 1)
            )

            Button(action: openFromField) {
                Label("Abrir", systemImage: "play.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Theme.accent)

            if browser.current != nil || libraryMode {
                Button {
                    showSidebar.toggle()
                } label: {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 14))
                        .foregroundStyle(showSidebar ? Theme.accent : .secondary)
                }
                .buttonStyle(.plain)
                .help(showSidebar ? "Ocultar lista de episódios" : "Mostrar lista de episódios")
            }

            Button {
                libraryMode.toggle()
                if libraryMode { showSidebar = true }
            } label: {
                Label("Biblioteca", systemImage: "books.vertical")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(libraryMode ? Theme.accent : Color.secondary)
            .keyboardShortcut("b", modifiers: .command)
            .help(libraryMode ? "Voltar para a pasta do Drive (⌘B)" : "Abrir a biblioteca de coleções (⌘B)")

            recentsMenu

            Button {
                showHelp = true
            } label: {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Como usar")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(Theme.surface)
    }

    private var logo: some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(
                        LinearGradient(
                            colors: [Color(red: 0.32, green: 0.52, blue: 1.0), Color(red: 0.46, green: 0.28, blue: 0.95)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 30, height: 30)

                Image(systemName: "play.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .offset(x: 1)
            }

            VStack(alignment: .leading, spacing: 1) {
                Text("DrivePlay")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                Text("MKV do Drive")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            .fixedSize()
        }
    }

    private var recentsMenu: some View {
        Menu {
            if library.folders.isEmpty && library.items.isEmpty {
                Text("Nenhum item recente")
            } else {
                if !library.folders.isEmpty {
                    Section("Pastas") {
                        ForEach(library.folders) { folder in
                            Button(folder.title.isEmpty ? "Pasta do Drive" : folder.title) {
                                openFolder(id: folder.id)
                            }
                        }
                    }
                }

                if !library.items.isEmpty {
                    Section("Vídeos") {
                        ForEach(library.items) { item in
                            Button(item.title.isEmpty ? "Vídeo do Drive" : item.title) {
                                linkText = DriveLink.viewURL(id: item.id).absoluteString
                                open(id: item.id, title: item.title)
                            }
                        }
                    }
                }

                Divider()
                Button("Limpar recentes") { library.clearAll() }
            }
        } label: {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .frame(width: 24)
        .help("Recentes")
    }

    // MARK: - Lista de episódios

    private var sidebar: some View {
        VStack(spacing: 0) {
            if libraryMode {
                librarySidebarHeader
                libraryCollectionPicker
                librarySearchBar

                if media.isRefreshing {
                    ProgressView()
                        .progressViewStyle(.linear)
                        .tint(Theme.accent)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 6)
                }

                entryList
            } else {
                sidebarHeader
                searchBar

                if browser.isLoading {
                    ProgressView()
                        .progressViewStyle(.linear)
                        .tint(Theme.accent)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 6)
                }

                if let error = browser.error {
                    errorBanner(error)
                }

                if browser.isLoading && browser.current == nil {
                    Spacer()
                    ProgressView().controlSize(.small)
                    Spacer()
                } else {
                    entryList
                }
            }
        }
        .frame(width: 320)
        .background(Theme.surface)
    }

    private var librarySidebarHeader: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Biblioteca")
                    .font(.system(size: 13, weight: .semibold))
                Text(media.collections.count == 1 ? "1 coleção" : "\(media.collections.count) coleções")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 4)

            Button {
                newCollectionName = ""
                addFolderAfterCreating = false
                showNewCollection = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Nova coleção")

            Menu {
                Button("Gerenciar fontes…") { showManageSources = true }
                Button("Renomear coleção…") {
                    renamingCollectionID = media.selectedCollectionID
                    showRenameCollection = true
                }
                Divider()
                Button("Excluir coleção", role: .destructive) {
                    deletingCollectionID = media.selectedCollectionID
                    showDeleteCollection = true
                }
                .disabled(media.selectedCollection?.isDefault != false)
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 20)
            .help("Opções da coleção")

            Button {
                libraryMode = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Voltar para a pasta do Drive")
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var libraryCollectionPicker: some View {
        HStack(spacing: 6) {
            Menu {
                ForEach(media.collections) { collection in
                    Button {
                        media.select(collection.id)
                    } label: {
                        if collection.id == media.selectedCollectionID {
                            Label(collection.name, systemImage: "checkmark")
                        } else {
                            Text(collection.name)
                        }
                    }
                }

                Divider()

                Button("Nova coleção…") {
                    newCollectionName = ""
                    addFolderAfterCreating = false
                    showNewCollection = true
                }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.accent)

                    Text(media.selectedCollection?.name ?? "Coleção")
                        .font(.system(size: 11.5, weight: .semibold))
                        .lineLimit(1)

                    Spacer(minLength: 2)

                    Text("\(media.episodeCount(in: media.selectedCollectionID)) eps")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)

                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 9)
                .frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(0.06)))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.white.opacity(0.06)))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                showAddLibraryLink = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(0.06)))
                    .contentShape(RoundedRectangle(cornerRadius: 7))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.accent)
            .help("Adicionar link à coleção")
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var librarySearchBar: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            TextField("Buscar na biblioteca…", text: $librarySearch)
                .textFieldStyle(.plain)
                .font(.system(size: 11))

            if !librarySearch.isEmpty {
                Button {
                    librarySearch = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 9)
        .frame(height: 28)
        .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.white.opacity(0.06)))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var sidebarHeader: some View {
        HStack(spacing: 8) {
            if browser.canGoBack {
                Button(action: goBackFolder) {
                    Image(systemName: "chevron.backward")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Voltar para a pasta anterior")
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(browser.current?.name ?? "Pasta")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text("\(browser.current?.entries.count ?? 0) itens")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 4)

            Menu {
                Section("Adicionar pasta à biblioteca") {
                    ForEach(media.collections) { collection in
                        Button(collection.name) {
                            addCurrentFolder(to: collection.id)
                        }
                    }
                }

                Divider()

                Button("Nova coleção…") {
                    newCollectionName = ""
                    addFolderAfterCreating = true
                    showNewCollection = true
                }
            } label: {
                Image(systemName: "bookmark")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 20)
            .help("Adicionar esta pasta à biblioteca")

            Button {
                Task { await browser.reload() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Atualizar pasta")

            Button(action: closeFolder) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Fechar pasta")
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var searchBar: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            TextField("Buscar episódio…", text: $browser.searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 11))

            if !browser.searchText.isEmpty {
                Button {
                    browser.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 9)
        .frame(height: 28)
        .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.white.opacity(0.06)))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10))
                .foregroundStyle(.orange)

            Text(message)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 7).fill(Color.orange.opacity(0.08)))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    private var entryList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(activeEntries) { entry in
                    entryRow(entry)
                }

                if activeEntries.isEmpty && !isActiveListLoading {
                    Text(emptyListMessage)
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                        .padding(.top, 24)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
    }

    private var activeEntries: [DriveEntry] {
        if libraryMode {
            let entries = media.aggregateEntries(in: media.selectedCollectionID)
            guard !librarySearch.isEmpty else { return entries }
            return entries.filter { $0.name.localizedCaseInsensitiveContains(librarySearch) }
        }
        return browser.visibleEntries
    }

    private var isActiveListLoading: Bool {
        libraryMode ? media.isRefreshing : browser.isLoading
    }

    private var emptyListMessage: String {
        if libraryMode {
            if media.selectedCollection?.sources.isEmpty != false {
                return "Adicione uma pasta de temporada"
            }
            return librarySearch.isEmpty ? "Nenhum vídeo na coleção" : "Nada encontrado"
        }
        return browser.searchText.isEmpty ? "Pasta vazia" : "Nada encontrado"
    }

    private func entryRow(_ entry: DriveEntry) -> some View {
        let watched = progress.isWatched(entry.id)
        let fraction = progress.fraction(entry.id)

        return Button {
            select(entry)
        } label: {
            HStack(spacing: 9) {
                thumbnail(for: entry)
                    .overlay(alignment: .topTrailing) {
                        if watched {
                            Image(systemName: "checkmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, Theme.accent)
                                .font(.system(size: 12))
                                .padding(3)
                        }
                    }
                    .overlay(alignment: .bottom) {
                        if !watched && fraction > 0.02 {
                            GeometryReader { geometry in
                                ZStack(alignment: .leading) {
                                    Rectangle().fill(Color.black.opacity(0.4))
                                    Rectangle()
                                        .fill(Theme.accent)
                                        .frame(width: geometry.size.width * fraction)
                                }
                            }
                            .frame(height: 3)
                            .clipShape(RoundedRectangle(cornerRadius: 1.5))
                            .padding(.horizontal, 3)
                            .padding(.bottom, 3)
                        }
                    }

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.name)
                        .font(.system(size: 11.5, weight: .medium))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    Text(entry.subtitle)
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .padding(6)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(selectedEntryID == entry.id ? Theme.accent.opacity(0.22) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if entry.isFolder {
                Button {
                    select(entry)
                } label: {
                    Label("Abrir pasta", systemImage: "folder")
                }

                Button {
                    copyFolderLink(id: entry.id)
                } label: {
                    Label("Copiar link da pasta", systemImage: "link")
                }

                Button {
                    share(url: DriveLink.folderURL(id: entry.id))
                } label: {
                    Label("Compartilhar pasta…", systemImage: "square.and.arrow.up")
                }
            } else if entry.isVideo {
                Button {
                    select(entry)
                } label: {
                    Label("Reproduzir", systemImage: "play.fill")
                }

                Divider()

                if progress.isWatched(entry.id) {
                    Button {
                        markUnwatched(entry)
                    } label: {
                        Label("Marcar como não assistido", systemImage: "checkmark.circle.badge.xmark")
                    }
                } else {
                    Button {
                        markWatched(entry)
                    } label: {
                        Label("Marcar como assistido", systemImage: "checkmark.circle")
                    }
                }

                Button {
                    resetProgress(entry)
                } label: {
                    Label("Resetar progresso", systemImage: "arrow.counterclockwise")
                }
                .disabled(progress.states[entry.id] == nil)

                Divider()

                Button {
                    openInVLC(id: entry.id)
                } label: {
                    Label("Abrir no VLC", systemImage: "play.tv.fill")
                }

                Button {
                    startDownload(id: entry.id, filename: entry.name)
                } label: {
                    Label("Baixar", systemImage: "arrow.down.circle")
                }

                Button {
                    share(id: entry.id)
                } label: {
                    Label("Compartilhar…", systemImage: "square.and.arrow.up")
                }

                Divider()

                Button {
                    openInBrowser(id: entry.id)
                } label: {
                    Label("Abrir no navegador", systemImage: "safari")
                }

                Button {
                    copyShareLink(id: entry.id)
                } label: {
                    Label("Copiar link de compartilhamento", systemImage: "link")
                }

                Button {
                    copyDirectLink(id: entry.id)
                } label: {
                    Label("Copiar link direto", systemImage: "doc.on.doc")
                }
            } else {
                Button {
                    select(entry)
                } label: {
                    Label("Abrir no Drive", systemImage: "safari")
                }

                Button {
                    copyShareLink(id: entry.id)
                } label: {
                    Label("Copiar link", systemImage: "link")
                }
            }

            if libraryMode {
                Divider()
                Button {
                    showManageSources = true
                } label: {
                    Label("Gerenciar fontes…", systemImage: "slider.horizontal.3")
                }
            }
        }
    }

    @ViewBuilder
    private func thumbnail(for entry: DriveEntry) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.white.opacity(0.06))

            if entry.isFolder {
                Image(systemName: "folder.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.accent.opacity(0.85))
            } else if let url = entry.thumbnail {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image
                            .resizable()
                            .scaledToFill()
                    } else {
                        placeholderIcon(for: entry)
                    }
                }
            } else {
                placeholderIcon(for: entry)
            }
        }
        .frame(width: 76, height: 43)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.white.opacity(0.06)))
    }

    private func placeholderIcon(for entry: DriveEntry) -> some View {
        Image(systemName: entry.isVideo ? "film" : "doc")
            .font(.system(size: 14))
            .foregroundStyle(.secondary)
    }

    // MARK: - Player

    @ViewBuilder
    private var content: some View {
        ZStack {
            if let id = currentID {
                PlayerWebView(
                    fileID: id,
                    reloadToken: reloadToken,
                    controller: player,
                    isLoading: $isLoading,
                    errorMessage: $errorMessage
                )

                if isLoading {
                    loadingOverlay
                }

                if let errorMessage {
                    errorOverlay(errorMessage)
                }

                if !isLoading && errorMessage == nil {
                    playbackOverlay
                }
            } else if libraryMode {
                libraryIdleState
            } else if browser.current != nil {
                folderIdleState
            } else {
                emptyState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.72)
            VStack(spacing: 14) {
                ProgressView()
                    .controlSize(.large)
                Text("Carregando do Google Drive…")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .transition(.opacity)
    }

    private var playbackOverlay: some View {
        ZStack {
            VStack {
                if let toast {
                    Text(toast)
                        .font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 13)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(Color.black.opacity(0.8)))
                        .overlay(Capsule().stroke(Color.white.opacity(0.14)))
                        .padding(.top, 18)
                        .transition(.opacity)
                }
                Spacer()
            }

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    VStack(alignment: .trailing, spacing: 8) {
                        if showEndingButton {
                            skipButton("Pular encerramento") { skipEndingNow() }
                        }
                        if showIntroButton {
                            skipButton("Pular abertura") { skipIntroNow() }
                        }
                    }
                }
                .padding(.trailing, 24)
                .padding(.bottom, 150)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: toast)
    }

    private func skipButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: "forward.end.fill")
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 18)
                .padding(.vertical, 11)
                .background(Capsule().fill(Color.black.opacity(0.86)))
                .overlay(Capsule().stroke(Color.white.opacity(0.28), lineWidth: 1))
                .foregroundStyle(.white)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(0.5), radius: 8, y: 3)
    }

    private var showIntroButton: Bool {
        guard showSkipButtons, currentID != nil, player.hasVideo, !player.hasEnded, !isLoading else { return false }
        return introSeconds >= 5
            && player.duration > introSeconds + 20
            && player.currentTime > 0.8
            && player.currentTime < introSeconds - 1
    }

    private var showEndingButton: Bool {
        guard showSkipButtons, currentID != nil, player.hasVideo, !player.hasEnded, !isLoading else { return false }
        return endingSeconds >= 5
            && player.duration > endingSeconds + 20
            && player.currentTime >= player.duration - endingSeconds
    }

    private func errorOverlay(_ message: String) -> some View {
        ZStack {
            Color.black.opacity(0.86)
            VStack(spacing: 14) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(.orange)
                Text("Não foi possível carregar o player")
                    .font(.system(size: 15, weight: .semibold))
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
                HStack(spacing: 10) {
                    Button("Tentar novamente", action: reload)
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                    Button("Abrir no VLC", action: openInVLC)
                    Button("Baixar arquivo", action: startDownload)
                }
            }
            .padding(28)
        }
    }

    private var folderIdleState: some View {
        VStack(spacing: 14) {
            Image(systemName: "rectangle.stack.badge.play")
                .font(.system(size: 40))
                .foregroundStyle(Theme.accent.opacity(0.85))

            Text(browser.current?.name ?? "Pasta")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .multilineTextAlignment(.center)
                .frame(maxWidth: 460)

            if browser.videos.isEmpty {
                Text("Nenhum vídeo nesta pasta. Abra uma subpasta na lista ao lado.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            } else {
                Text("\(browser.videos.count) vídeo(s) nesta pasta. Escolha um episódio na lista ao lado.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)

                Button {
                    if let first = browser.videos.first { select(first) }
                } label: {
                    Label("Reproduzir primeiro", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Theme.accent)
                .padding(.top, 2)
            }

            Menu {
                Section("Adicionar esta pasta à biblioteca") {
                    ForEach(media.collections) { collection in
                        Button(collection.name) {
                            addCurrentFolder(to: collection.id)
                        }
                    }
                }

                Divider()

                Button("Nova coleção…") {
                    newCollectionName = ""
                    addFolderAfterCreating = true
                    showNewCollection = true
                }
            } label: {
                Label("Adicionar à biblioteca", systemImage: "bookmark")
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(0.08)))
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .padding(.top, 4)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Theme.background, Color.black],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var libraryIdleState: some View {
        let collection = media.selectedCollection
        let entries = media.aggregateEntries(in: collection?.id)

        return VStack(spacing: 14) {
            Image(systemName: "books.vertical.fill")
                .font(.system(size: 40))
                .foregroundStyle(Theme.accent.opacity(0.85))

            Text(collection?.name ?? "Biblioteca")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .multilineTextAlignment(.center)
                .frame(maxWidth: 460)

            if entries.isEmpty {
                Text("Adicione o link de uma pasta de temporada ou de um vídeo para começar. Você pode juntar várias temporadas na mesma coleção.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 460)

                HStack(spacing: 10) {
                    Button {
                        showAddLibraryLink = true
                    } label: {
                        Label("Adicionar link", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(Theme.accent)

                    Button {
                        showManageSources = true
                    } label: {
                        Label("Gerenciar fontes", systemImage: "slider.horizontal.3")
                    }
                }
                .padding(.top, 2)
            } else {
                Text("\(entries.count) \(entries.count == 1 ? "episódio" : "episódios") · \(collection?.sources.count ?? 0) \(collection?.sources.count == 1 ? "fonte" : "fontes"). Escolha um episódio na lista ao lado.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)

                HStack(spacing: 10) {
                    Button {
                        if let first = entries.first { select(first) }
                    } label: {
                        Label("Reproduzir primeiro", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(Theme.accent)

                    Button {
                        showAddLibraryLink = true
                    } label: {
                        Label("Adicionar link", systemImage: "plus")
                    }

                    Button {
                        showManageSources = true
                    } label: {
                        Label("Fontes", systemImage: "slider.horizontal.3")
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Theme.background, Color.black],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var emptyState: some View {
        ScrollView {
            VStack(spacing: 26) {
                VStack(spacing: 14) {
                    ZStack {
                        Circle()
                            .fill(Theme.accent.opacity(0.12))
                            .frame(width: 92, height: 92)
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(Theme.accent)
                    }

                    Text("Seus MKV do Drive, sem converter nada")
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .multilineTextAlignment(.center)

                    Text("Cole o link de uma pasta para ver todos os episódios numa lista, ou o link de um arquivo para tocar direto. O Google Drive transcodifica o vídeo no servidor, então MKV, AVI e outros formatos funcionam — e você ainda pode abrir no VLC com legendas e qualidade original.")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 540)
                        .lineSpacing(3)

                    HStack(spacing: 10) {
                        Button(action: pasteAndPlay) {
                            Label("Colar da área de transferência", systemImage: "doc.on.clipboard")
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .tint(Theme.accent)

                        Button {
                            showHelp = true
                        } label: {
                            Label("Como usar", systemImage: "questionmark.circle")
                        }
                        .controlSize(.large)
                    }
                    .padding(.top, 4)

                    if let error = browser.error {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(.orange)
                            Text(error)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.08)))
                        .frame(maxWidth: 480)
                    }
                }

                if !library.folders.isEmpty || !library.items.isEmpty {
                    recentList
                }
            }
            .padding(40)
            .frame(maxWidth: .infinity)
        }
        .background(
            LinearGradient(
                colors: [Theme.background, Color.black],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var recentList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Recentes")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                    .tracking(0.6)

                Spacer()

                Button("Limpar") { library.clearAll() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 1) {
                ForEach(library.folders) { folder in
                    Button {
                        openFolder(id: folder.id)
                    } label: {
                        recentRow(id: folder.id, title: folder.title, isFolder: true)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Remover dos recentes", role: .destructive) {
                            library.removeFolder(id: folder.id)
                        }
                    }
                }

                ForEach(library.items) { item in
                    Button {
                        linkText = DriveLink.viewURL(id: item.id).absoluteString
                        open(id: item.id, title: item.title)
                    } label: {
                        recentRow(id: item.id, title: item.title, isFolder: false)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Remover dos recentes", role: .destructive) {
                            library.remove(id: item.id)
                        }
                    }
                }
            }
            .padding(5)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.035)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.05)))
        }
        .frame(maxWidth: 620)
    }

    private func recentRow(id: String, title: String, isFolder: Bool) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 7)
                .fill(Theme.accent.opacity(0.14))
                .frame(width: 30, height: 30)
                .overlay(
                    Image(systemName: isFolder ? "folder.fill" : "film")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.accent)
                )

            VStack(alignment: .leading, spacing: 1) {
                Text(title.isEmpty ? (isFolder ? "Pasta do Drive" : "Vídeo do Drive") : title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Text(isFolder ? "Pasta" : id)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    // MARK: - Rodapé

    private var footer: some View {
        HStack(spacing: 12) {
            Image(systemName: "film.fill")
                .font(.system(size: 12))
                .foregroundStyle(Theme.accent)

            VStack(alignment: .leading, spacing: 1) {
                Text(currentTitle.isEmpty ? "Vídeo do Drive" : currentTitle)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Text(currentID ?? "")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if browser.current != nil || libraryMode {
                footerButton(
                    showSidebar ? "Ocultar lista de reprodução" : "Mostrar lista de reprodução",
                    "list.bullet",
                    action: { showSidebar.toggle() }
                )
            }

            if !playlistEntries.isEmpty {
                footerButton("Episódio anterior (⌘←)", "chevron.backward", action: playPrevious)
                footerButton("Próximo episódio (⌘→)", "chevron.forward", action: playNext)
            }

            Rectangle()
                .fill(Color.white.opacity(0.1))
                .frame(width: 1, height: 20)

            skipSettingsButton

            downloadControl

            Button(action: openInVLC) {
                Label("VLC", systemImage: "play.tv.fill")
                    .font(.system(size: 11, weight: .medium))
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.white.opacity(0.14), lineWidth: 1)
            )
            .help("Abrir no VLC — legendas e qualidade original")

            footerButton("Abrir no navegador", "safari", action: openInBrowser)
            footerButton("Copiar link direto", "doc.on.doc", action: copyDirectLink)
            footerButton("Recarregar", "arrow.clockwise", action: reload)
            Button(action: toggleFillScreen) {
                Image(systemName: "aspectratio")
                    .font(.system(size: 13))
                    .frame(width: 26, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(fillScreen ? Theme.accent : Color.secondary)
            .help(fillScreen ? "Voltar ao tamanho original" : "Preencher a tela (pode cortar as bordas)")
            footerButton("Tela cheia", "arrow.up.left.and.arrow.down.right", action: toggleFullScreen)
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .background(Theme.surface)
    }

    @ViewBuilder
    private var downloadControl: some View {
        switch downloads.state {
        case .idle:
            footerButton("Baixar arquivo", "arrow.down.circle", action: startDownload)

        case .downloading(let progress):
            HStack(spacing: 7) {
                ProgressView(value: progress)
                    .frame(width: 70)
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, alignment: .trailing)
                Button {
                    downloads.cancel()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Cancelar download")
            }

        case .finished:
            Button {
                downloads.reveal()
            } label: {
                Label("Mostrar no Finder", systemImage: "folder.fill")
                    .font(.system(size: 11, weight: .medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.accent)
            .help("Mostrar arquivo baixado no Finder")

        case .failed(let message):
            Button {
                alertInfo = AlertInfo(title: "Download falhou", message: message)
                downloads.dismissError()
            } label: {
                Label("Download falhou", systemImage: "exclamationmark.circle")
                    .font(.system(size: 11, weight: .medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.orange)
        }
    }

    private func footerButton(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .frame(width: 26, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .help(title)
    }

    private var skipSettingsButton: some View {
        Button {
            showSettings.toggle()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "forward.end")
                    .font(.system(size: 11, weight: .semibold))
                Text(skipIntro || skipEnding ? "Pular ativo" : "Pular")
                    .font(.system(size: 11, weight: .semibold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .bold))
                    .opacity(0.7)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(
                Capsule().fill((skipIntro || skipEnding) ? Theme.accent.opacity(0.2) : Color.white.opacity(0.06))
            )
            .overlay(
                Capsule().stroke(
                    (skipIntro || skipEnding) ? Theme.accent.opacity(0.55) : Color.white.opacity(0.12),
                    lineWidth: 1
                )
            )
            .foregroundStyle((skipIntro || skipEnding) ? Theme.accent : Color.secondary)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showSettings, arrowEdge: .bottom) {
            PlaybackSettingsView()
        }
        .help("Pular abertura/ending automaticamente")
    }

    // MARK: - Ações

    private func migratePlaybackDefaults() {
        let defaults = UserDefaults.standard
        let key = "driveplay.playbackDefaultsRevision"
        guard defaults.integer(forKey: key) < 2 else { return }

        if introSeconds == 90 { introSeconds = 120 }
        if endingSeconds == 180 { endingSeconds = 190 }
        defaults.set(2, forKey: key)
    }

    private func prepare() {
        migratePlaybackDefaults()
        player.configureFill(fillScreen)

        if ProcessInfo.processInfo.environment["DRIVEPLAY_LOG_TICKS"] != nil {
            NSLog(
                "DrivePlay config: skipIntro=%@ intro=%.0f skipEnding=%@ ending=%.0f autoNext=%@ resume=%@",
                String(skipIntro), introSeconds, String(skipEnding), endingSeconds,
                String(autoNext), String(resumePlayback)
            )
        }

        if let initialLink, let target = DriveLink.target(from: initialLink) {
            linkText = initialLink
            switch target {
            case .file(let id):
                open(id: id)
            case .folder(let id):
                openFolder(id: id, autoplayLast: true)
            }
            return
        }

        if libraryMode {
            showSidebar = true
            return
        }

        if let folderID = UserDefaults.standard.string(forKey: "lastFolderID") {
            openFolder(id: folderID, autoplayLast: true)
        } else if let last = UserDefaults.standard.string(forKey: "lastFileID") {
            open(id: last)
        } else {
            linkFocused = true
        }
    }

    private func openFromField() {
        guard let target = DriveLink.target(from: linkText) else {
            alertInfo = AlertInfo(
                title: "Link inválido",
                message: "Cole um link de pasta ou de arquivo do Google Drive, por exemplo:\nhttps://drive.google.com/drive/folders/ID_DA_PASTA\nhttps://drive.google.com/file/d/ID_DO_ARQUIVO/view"
            )
            linkFocused = true
            return
        }

        switch target {
        case .file(let id):
            open(id: id)
        case .folder(let id):
            openFolder(id: id)
        }
    }

    private func openFolder(id: String, autoplayLast: Bool = false) {
        libraryMode = false

        if let oldID = currentID, player.duration > 1 {
            progress.record(id: oldID, time: player.currentTime, duration: player.duration)
        }

        currentID = nil
        currentTitle = ""
        errorMessage = nil
        isLoading = false
        selectedEntryID = nil
        showSidebar = true
        linkText = DriveLink.folderURL(id: id).absoluteString
        UserDefaults.standard.set(id, forKey: "lastFolderID")
        library.addFolder(id: id, name: "")

        Task { @MainActor in
            await browser.open(folderID: id)
            guard let current = browser.current else { return }

            library.updateFolderName(id: id, name: current.name)
            linkText = DriveLink.folderURL(id: id).absoluteString

            guard let last = UserDefaults.standard.string(forKey: "lastFileID"),
                  let entry = current.entries.first(where: { $0.id == last }) else { return }

            selectedEntryID = entry.id
            if autoplayLast && entry.isVideo {
                open(id: entry.id, title: entry.name)
            }
        }
    }

    private func goBackFolder() {
        browser.goBack()
        guard let current = browser.current else { return }
        linkText = DriveLink.folderURL(id: current.id).absoluteString
        UserDefaults.standard.set(current.id, forKey: "lastFolderID")
        selectedEntryID = nil
    }

    private func closeFolder() {
        browser.close()
        selectedEntryID = nil
        showSidebar = true
        UserDefaults.standard.removeObject(forKey: "lastFolderID")
    }

    private func addCurrentFolder(to collectionID: String) {
        guard let folder = browser.current else { return }

        let added = media.addSource(
            collectionID: collectionID,
            kind: .folder,
            driveID: folder.id,
            name: folder.name,
            entries: folder.entries
        )

        let collectionName = media.collection(id: collectionID)?.name ?? "biblioteca"
        showToast(added
            ? "“\(folder.name)” adicionada a \(collectionName)"
            : "Essa pasta já está em \(collectionName)"
        )
    }

    private func select(_ entry: DriveEntry) {
        if entry.isFolder {
            libraryMode = false
            selectedEntryID = nil
            Task { @MainActor in
                await browser.openSubfolder(entry)
                guard let current = browser.current else { return }
                linkText = DriveLink.folderURL(id: current.id).absoluteString
                UserDefaults.standard.set(current.id, forKey: "lastFolderID")
                library.addFolder(id: current.id, name: current.name)
            }
        } else if entry.isVideo {
            selectedEntryID = entry.id
            open(id: entry.id, title: entry.name)
        } else {
            NSWorkspace.shared.open(DriveLink.viewURL(id: entry.id))
        }
    }

    private func open(id: String, title: String? = nil) {
        if let oldID = currentID, oldID != id, player.duration > 1 {
            progress.record(id: oldID, time: player.currentTime, duration: player.duration)
        }

        let knownTitle = title ?? library.items.first(where: { $0.id == id })?.title
        currentID = id
        currentTitle = knownTitle ?? "Carregando informações…"
        errorMessage = nil
        isLoading = true
        linkFocused = false
        selectedEntryID = id

        didResume = false
        didSkipIntro = false
        didAdvance = false
        lastSavedTick = 0
        resumeTarget = resumePlayback ? progress.resumeTime(for: id) : nil
        player.reset()

        UserDefaults.standard.set(id, forKey: "lastFileID")
        library.add(id: id, title: knownTitle ?? "")

        Task { @MainActor in
            guard let fetched = await DriveLink.fetchTitle(id: id) else {
                NSLog("DrivePlay: não foi possível obter o título de %@", id)
                return
            }
            NSLog("DrivePlay: título %@", fetched)
            guard currentID == id else { return }
            currentTitle = fetched
            library.updateTitle(id: id, title: fetched)
        }
    }

    private func reload() {
        guard currentID != nil else { return }
        errorMessage = nil
        isLoading = true
        reloadToken += 1
    }

    private func pasteAndPlay() {
        guard let text = NSPasteboard.general.string(forType: .string),
              let target = DriveLink.target(from: text) else {
            linkFocused = true
            alertInfo = AlertInfo(
                title: "Nada para colar",
                message: "Copie o link de uma pasta ou de um arquivo no Google Drive e tente novamente."
            )
            return
        }

        linkText = text
        switch target {
        case .file(let id):
            open(id: id)
        case .folder(let id):
            openFolder(id: id)
        }
    }

    private func playNext() {
        guard let next = nextEntry(wrapping: true) else { return }
        play(next)
    }

    private func playPrevious() {
        guard let previous = previousEntry(wrapping: true) else { return }
        play(previous)
    }

    private func play(_ entry: DriveEntry) {
        selectedEntryID = entry.id
        open(id: entry.id, title: entry.name)
    }

    private func nextEntry(wrapping: Bool) -> DriveEntry? {
        let videos = playlistEntries
        guard !videos.isEmpty else { return nil }

        guard let currentID, let index = videos.firstIndex(where: { $0.id == currentID }) else {
            return videos.first
        }

        if index + 1 < videos.count { return videos[index + 1] }
        return wrapping ? videos.first : nil
    }

    private func previousEntry(wrapping: Bool) -> DriveEntry? {
        let videos = playlistEntries
        guard !videos.isEmpty else { return nil }

        guard let currentID, let index = videos.firstIndex(where: { $0.id == currentID }) else {
            return videos.last
        }

        if index > 0 { return videos[index - 1] }
        return wrapping ? videos.last : nil
    }

    private var playlistEntries: [DriveEntry] {
        if libraryMode {
            return media.aggregateEntries(in: media.selectedCollectionID)
        }
        return browser.videos
    }

    private func handlePlaybackTick() {
        guard let id = currentID, !isLoading, player.hasVideo, player.duration > 1 else { return }

        let time = player.currentTime
        let duration = player.duration

        // Retomada
        if !didResume, player.isReady {
            didResume = true
            if let target = resumeTarget, target > 5, target < duration - 10, abs(time - target) > 3 {
                player.seek(to: target)
                showToast("Retomando de \(formatTime(target))")
            }
            resumeTarget = nil
        }

        // Progresso (a cada ~5 segundos)
        if abs(time - lastSavedTick) >= 5 {
            lastSavedTick = time
            progress.record(id: id, time: time, duration: duration)
        }

        // Pular abertura
        if introSeconds >= 5, duration > introSeconds + 20, time > 0.5, time < introSeconds - 1 {
            if skipIntro, player.isPlaying, !didSkipIntro {
                didSkipIntro = true
                player.seek(to: introSeconds)
                showToast("Abertura pulada")
            }
        }

        // Pular encerramento / fim do episódio
        let inEnding = endingSeconds >= 5
            && duration > endingSeconds + 20
            && time >= duration - endingSeconds

        if !didAdvance && (player.hasEnded || time >= duration - 1.2 || (skipEnding && player.isPlaying && inEnding)) {
            didAdvance = true
            finishCurrentEpisode(autoAdvance: autoNext)
        }
    }

    private func finishCurrentEpisode(autoAdvance: Bool) {
        guard let id = currentID else { return }
        let duration = player.duration
        progress.markWatched(id: id, duration: duration)

        if autoAdvance, let next = nextEntry(wrapping: false) {
            showToast("Próximo episódio…")
            play(next)
        } else if player.currentTime < duration - 1.5 {
            player.seek(to: max(duration - 0.6, 0))
        }
    }

    private func skipIntroNow() {
        guard player.duration > introSeconds + 20 else { return }
        didSkipIntro = true
        player.seek(to: introSeconds)
        showToast("Abertura pulada")
    }

    private func skipEndingNow() {
        guard let id = currentID else { return }
        didAdvance = true
        progress.markWatched(id: id, duration: player.duration)

        if let next = nextEntry(wrapping: false) {
            showToast("Próximo episódio…")
            play(next)
        } else {
            player.seek(to: max(player.duration - 0.6, 0))
        }
    }

    private func formatTime(_ seconds: Double) -> String {
        let total = max(Int(seconds.rounded()), 0)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }

    private func showToast(_ text: String) {
        toast = text
        toastToken += 1
        let token = toastToken

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            if toastToken == token {
                toast = nil
            }
        }
    }

    private func openInVLC() {
        guard let id = currentID else { return }
        openInVLC(id: id)
    }

    private func openInVLC(id: String) {
        let vlcApp = URL(fileURLWithPath: "/Applications/VLC.app")
        guard FileManager.default.fileExists(atPath: vlcApp.path) else {
            let alert = NSAlert()
            alert.messageText = "VLC não encontrado"
            alert.informativeText = "O player integrado já toca o vídeo. Para MKV com legendas e qualidade original, instale o VLC (grátis)."
            alert.addButton(withTitle: "Baixar VLC")
            alert.addButton(withTitle: "Cancelar")
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(URL(string: "https://www.videolan.org/vlc/download-macosx.html")!)
            }
            return
        }

        let configuration = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.open([DriveLink.directURL(id: id)], withApplicationAt: vlcApp, configuration: configuration) { _, error in
            guard let error else { return }
            DispatchQueue.main.async {
                alertInfo = AlertInfo(title: "Não foi possível abrir o VLC", message: error.localizedDescription)
            }
        }
    }

    private func openInBrowser() {
        guard let id = currentID else { return }
        openInBrowser(id: id)
    }

    private func openInBrowser(id: String) {
        NSWorkspace.shared.open(DriveLink.viewURL(id: id))
    }

    private func copyDirectLink() {
        guard let id = currentID else { return }
        copyDirectLink(id: id)
    }

    private func copyDirectLink(id: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(DriveLink.directURL(id: id).absoluteString, forType: .string)
        alertInfo = AlertInfo(
            title: "Link direto copiado",
            message: "Cole no VLC, IINA ou em outro player compatível com MKV."
        )
    }

    private func copyShareLink(id: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(DriveLink.viewURL(id: id).absoluteString, forType: .string)
        showToast("Link de compartilhamento copiado")
    }

    private func copyFolderLink(id: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(DriveLink.folderURL(id: id).absoluteString, forType: .string)
        showToast("Link da pasta copiado")
    }

    private func share(id: String) {
        share(url: DriveLink.viewURL(id: id))
    }

    private func share(url: URL) {
        guard let window = NSApp.keyWindow, let view = window.contentView else {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(url.absoluteString, forType: .string)
            showToast("Link copiado")
            return
        }

        let picker = NSSharingServicePicker(items: [url])
        sharingPicker = picker

        let windowPoint = window.convertPoint(fromScreen: NSEvent.mouseLocation)
        let localPoint = view.convert(windowPoint, from: nil)
        picker.show(
            relativeTo: NSRect(x: localPoint.x, y: localPoint.y, width: 1, height: 1),
            of: view,
            preferredEdge: .minY
        )
    }

    private func startDownload() {
        guard let id = currentID else { return }
        startDownload(id: id, filename: currentTitle)
    }

    private func startDownload(id: String, filename: String) {
        var name = filename.isEmpty ? "video.mkv" : filename
        if !name.contains(".") { name += ".mkv" }
        downloads.start(id: id, filename: name)
        showToast("Baixando \(name)…")
    }

    private func markWatched(_ entry: DriveEntry) {
        let duration = progress.states[entry.id]?.duration
            ?? (currentID == entry.id ? player.duration : 0)
        progress.markWatched(id: entry.id, duration: duration)
        showToast("Marcado como assistido")
    }

    private func markUnwatched(_ entry: DriveEntry) {
        progress.markUnwatched(id: entry.id)
        showToast("Marcado como não assistido")
    }

    private func resetProgress(_ entry: DriveEntry) {
        progress.resetProgress(id: entry.id)
        showToast("Progresso resetado")
    }

    private func toggleFullScreen() {
        NSApp.keyWindow?.toggleFullScreen(nil)
    }

    private func toggleFillScreen() {
        fillScreen.toggle()
        player.setFill(fillScreen)
        showToast(
            fillScreen
                ? "Tela preenchida — as bordas podem ser cortadas."
                : "Tamanho original restaurado."
        )
    }
}

// MARK: - Tela cheia automática

private final class IdleFullscreenController: ObservableObject {
    private var enabled = true
    private var videoID: String?
    private var hasVideo = false
    private var hasEnded = false
    private var isLoading = false
    private var suppressed = false
    private var token = 0
    private var eventMonitor: Any?
    private var observers: [NSObjectProtocol] = []
    private let delay: TimeInterval = 5
    var onFullscreenChange: ((Bool) -> Void)?

    private var mainWindow: NSWindow? {
        NSApp.mainWindow ?? NSApp.windows.first {
            $0.isVisible && $0.styleMask.contains(.titled)
        }
    }

    private var canAutoFullscreen: Bool {
        enabled && videoID != nil && hasVideo && !hasEnded && !isLoading
            && !suppressed && NSApp.isActive
    }

    func update(
        enabled: Bool,
        videoID: String?,
        hasVideo: Bool,
        hasEnded: Bool,
        isLoading: Bool
    ) {
        if enabled && !self.enabled {
            suppressed = false
        }
        if self.videoID != videoID {
            suppressed = false
        }

        self.enabled = enabled
        self.videoID = videoID
        self.hasVideo = hasVideo
        self.hasEnded = hasEnded
        self.isLoading = isLoading

        if ProcessInfo.processInfo.environment["DRIVEPLAY_LOG_TICKS"] != nil {
            NSLog(
                "DrivePlay idle update: enabled=%@ video=%@ hasVideo=%@ ended=%@ loading=%@ can=%@ active=%@",
                String(enabled), videoID ?? "nil", String(hasVideo), String(hasEnded),
                String(isLoading), String(canAutoFullscreen), String(NSApp.isActive)
            )
        }

        if canAutoFullscreen {
            schedule()
        } else {
            cancel()
        }
    }

    func install() {
        guard eventMonitor == nil else { return }

        let mask: NSEvent.EventTypeMask = [
            .mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel, .keyDown, .flagsChanged,
            .magnify, .rotate, .swipe, .gesture, .pressure
        ]
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            self?.noteActivity()
            return event
        }

        let center = NotificationCenter.default
        observers = [
            center.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.noteActivity() },
            center.addObserver(
                forName: NSApplication.didResignActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.cancel() },
            center.addObserver(
                forName: NSWindow.didEnterFullScreenNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.onFullscreenChange?(true)
                self?.cancel()
            },
            center.addObserver(
                forName: NSWindow.didExitFullScreenNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.onFullscreenChange?(false)
                self?.suppressed = true
                self?.cancel()
            },
            center.addObserver(
                forName: NSWindow.didMiniaturizeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.cancel() },
            center.addObserver(
                forName: NSWindow.didDeminiaturizeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.noteActivity() }
        ]

        noteActivity()
    }

    func teardown() {
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
            self.eventMonitor = nil
        }
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
        observers = []
        cancel()
    }

    private func noteActivity() {
        if canAutoFullscreen {
            schedule()
        } else {
            cancel()
        }
    }

    private func schedule() {
        guard canAutoFullscreen else {
            cancel()
            return
        }
        if let mainWindow, mainWindow.styleMask.contains(.fullScreen) {
            cancel()
            return
        }

        token += 1
        let currentToken = token

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, currentToken == self.token, self.canAutoFullscreen else {
                if ProcessInfo.processInfo.environment["DRIVEPLAY_LOG_TICKS"] != nil {
                    NSLog("DrivePlay idle timer: cancelado ou inválido")
                }
                return
            }
            guard let window = self.mainWindow,
                  NSApp.keyWindow === window,
                  window.isVisible,
                  !window.isMiniaturized,
                  !window.styleMask.contains(.fullScreen) else {
                if ProcessInfo.processInfo.environment["DRIVEPLAY_LOG_TICKS"] != nil {
                    NSLog("DrivePlay idle timer: janela indisponível ou não é a principal")
                }
                return
            }
            if ProcessInfo.processInfo.environment["DRIVEPLAY_LOG_TICKS"] != nil {
                NSLog("DrivePlay idle timer: entrando em tela cheia")
            }
            window.toggleFullScreen(nil)
        }
    }

    private func cancel() {
        token += 1
    }
}

private struct AutoFullscreenOnIdle: ViewModifier {
    let enabled: Bool
    let videoID: String?
    let hasVideo: Bool
    let hasEnded: Bool
    let isLoading: Bool
    let onFullscreenChange: (Bool) -> Void

    @StateObject private var controller = IdleFullscreenController()

    func body(content: Content) -> some View {
        content
            .onAppear {
                controller.onFullscreenChange = onFullscreenChange
                update()
                controller.install()
            }
            .onDisappear {
                controller.teardown()
            }
            .onChange(of: enabled) { update() }
            .onChange(of: videoID) { update() }
            .onChange(of: hasVideo) { update() }
            .onChange(of: hasEnded) { update() }
            .onChange(of: isLoading) { update() }
    }

    private func update() {
        controller.update(
            enabled: enabled,
            videoID: videoID,
            hasVideo: hasVideo,
            hasEnded: hasEnded,
            isLoading: isLoading
        )
    }
}

// MARK: - Ajuda

struct HelpView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Como usar o DrivePlay")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                Spacer()
                Button("Fechar") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }

            VStack(alignment: .leading, spacing: 12) {
                helpRow(
                    "folder",
                    "Cole o link da pasta",
                    "No Google Drive, compartilhe a pasta como “Qualquer pessoa com o link” e copie o link. Todos os episódios aparecem na lista ao lado, com busca e miniaturas."
                )
                helpRow(
                    "books.vertical",
                    "Biblioteca de temporadas",
                    "Use o botão “Biblioteca” (ou ⌘B) para juntar os links de várias temporadas na mesma coleção. Os episódios são unidos e ordenados por temporada/episódio (S04E01…S05E12). Crie coleções, adicione links pelo “+” e mova as fontes em “Gerenciar fontes”."
                )
                helpRow(
                    "play.rectangle",
                    "Player integrado",
                    "Clique em um episódio para tocar dentro do app. O player do Drive converte MKV no servidor; não é preciso instalar codecs."
                )
                helpRow(
                    "arrow.up.left.and.arrow.down.right",
                    "Tela cheia automática",
                    "Com um vídeo aberto, se você não mexer no mouse ou no teclado por 5 segundos, o app entra em tela cheia. Você pode desativar em Reprodução → Configurações. Depois de sair manualmente da tela cheia, ela volta a entrar apenas no próximo episódio."
                )
                helpRow(
                    "chevron.forward.2",
                    "Próximo episódio",
                    "Use as setas no rodapé ou ⌘← / ⌘→ para pular de episódio. Ao terminar (ou pular o encerramento), o próximo começa sozinho."
                )
                helpRow(
                    "forward.end",
                    "Pular abertura e encerramento",
                    "Os botões aparecem sobre o vídeo, acima da linha do tempo. O botão “Pular” no rodapé abre as opções: pulo automático, duração da abertura/encerramento e avanço para o próximo episódio. A escolha fica salva."
                )
                helpRow(
                    "checkmark.circle",
                    "Retomar e assistidos",
                    "O app salva onde você parou e retoma ao abrir o episódio de novo. Episódios concluídos ganham um ✓ na lista."
                )
                helpRow(
                    "cursorarrow.click",
                    "Botão direito no episódio",
                    "Clique com o botão direito em qualquer episódio para marcar como assistido/não assistido, resetar o progresso, abrir no VLC, baixar, compartilhar ou copiar o link."
                )
                helpRow(
                    "play.tv",
                    "VLC para MKV completo",
                    "Para legendas embutidas, faixas de áudio e qualidade original, use “Abrir no VLC”. O app envia o stream direto para o VLC instalado."
                )
                helpRow(
                    "arrow.down.circle",
                    "Baixar",
                    "Salva o arquivo original em Downloads. Útil para assistir offline ou abrir em outro player."
                )
            }

            Divider().overlay(Color.white.opacity(0.08))

            VStack(alignment: .leading, spacing: 6) {
                Text("Atalhos")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                shortcutRow("⇧⌘V", "Colar link e reproduzir")
                shortcutRow("⌘R", "Recarregar player")
                shortcutRow("⇧⌘O", "Abrir no VLC")
                shortcutRow("⌘← / ⌘→", "Episódio anterior / próximo")
                shortcutRow("⌃⌘F", "Tela cheia")
            }

            Text("As pastas e arquivos precisam estar públicos (“qualquer pessoa com o link”) ou na conta com sessão iniciada no player.")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(24)
        .frame(width: 580)
        .background(Theme.background)
    }

    private func helpRow(_ icon: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(Theme.accent)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Text(text)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func shortcutRow(_ keys: String, _ action: String) -> some View {
        HStack(spacing: 10) {
            Text(keys)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)))
            Text(action)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }
}
