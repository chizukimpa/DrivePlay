import Foundation

// MARK: - Modelos

struct LibrarySource: Codable, Identifiable, Hashable {
    enum Kind: String, Codable {
        case folder
        case file
    }

    var id: String          // "folder:<driveID>" ou "file:<driveID>"
    var kind: Kind
    var driveID: String
    var name: String
    var addedAt: Date
    var entries: [DriveEntry]

    var videoCount: Int {
        entries.filter(\.isVideo).count
    }
}

struct LibraryCollection: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var createdAt: Date
    var isDefault: Bool
    var sources: [LibrarySource]
}

// MARK: - Ordenação de episódios

/// Ordena por temporada/episódio quando o nome tem S04E03, 4x03,
/// "Temporada 4 Episódio 3" etc. Sem esses dados, usa ordem natural
/// (para "Episódio 2" vir antes de "Episódio 10").
enum EpisodeSort {
    private static let patterns: [NSRegularExpression] = [
        try! NSRegularExpression(pattern: #"(?i)\bS(\d{1,2})\s*[._ -]?\s*E(\d{1,3})\b"#),
        try! NSRegularExpression(pattern: #"(?i)\b(\d{1,2})x(\d{1,3})\b"#),
        try! NSRegularExpression(pattern: #"(?i)\bT(?:EMPORADA)?\s*(\d{1,2})\s*(?:EP|E|EPIS[OÓ]DIO)\s*(\d{1,3})\b"#),
        try! NSRegularExpression(pattern: #"(?i)\bSEASON\s*(\d{1,2})\s*EPISODE\s*(\d{1,3})\b"#)
    ]

    static func key(for name: String) -> (season: Int?, episode: Int?) {
        let range = NSRange(name.startIndex..<name.endIndex, in: name)

        for regex in patterns {
            guard let match = regex.firstMatch(in: name, options: [], range: range),
                  match.numberOfRanges >= 3,
                  let seasonRange = Range(match.range(at: 1), in: name),
                  let episodeRange = Range(match.range(at: 2), in: name),
                  let season = Int(name[seasonRange]),
                  let episode = Int(name[episodeRange]) else { continue }
            return (season, episode)
        }

        return (nil, nil)
    }

    static func less(_ first: DriveEntry, _ second: DriveEntry) -> Bool {
        let a = key(for: first.name)
        let b = key(for: second.name)

        switch (a.season, b.season) {
        case let (seasonA?, seasonB?):
            if seasonA != seasonB { return seasonA < seasonB }
            let episodeA = a.episode ?? Int.max
            let episodeB = b.episode ?? Int.max
            if episodeA != episodeB { return episodeA < episodeB }
        case (.some, .none):
            return true
        case (.none, .some):
            return false
        case (.none, .none):
            break
        }

        let result = first.name.localizedStandardCompare(second.name)
        if result == .orderedSame { return first.id < second.id }
        return result == .orderedAscending
    }
}

// MARK: - Biblioteca persistente

/// Coleções locais de links do Drive. Cada coleção pode ter várias pastas
/// (temporadas) ou arquivos; os episódios são unidos e ordenados por
/// temporada/episódio, independentemente da ordem em que foram adicionados.
@MainActor
final class MediaLibrary: ObservableObject {
    @Published private(set) var collections: [LibraryCollection] = []
    @Published private(set) var isRefreshing = false
    @Published var selectedCollectionID: String? {
        didSet { saveSelection() }
    }

    private let selectionKey = "library.selectedCollectionID"
    private let fileURL: URL

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        let directory = support.appendingPathComponent("DrivePlay", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("library.json")

        load()

        if collections.isEmpty {
            let defaultCollection = LibraryCollection(
                id: UUID().uuidString,
                name: "Minha biblioteca",
                createdAt: Date(),
                isDefault: true,
                sources: []
            )
            collections = [defaultCollection]
            selectedCollectionID = defaultCollection.id
            save()
        } else {
            let saved = UserDefaults.standard.string(forKey: selectionKey)
            selectedCollectionID = collections.first(where: { $0.id == saved })?.id
                ?? collections.first?.id
        }
    }

    // MARK: Consultas

    var selectedCollection: LibraryCollection? {
        guard let selectedCollectionID else { return nil }
        return collections.first(where: { $0.id == selectedCollectionID })
    }

    var defaultCollection: LibraryCollection? {
        collections.first(where: \.isDefault) ?? collections.first
    }

    func collection(id: String) -> LibraryCollection? {
        collections.first(where: { $0.id == id })
    }

    /// Todos os vídeos das fontes da coleção, sem duplicatas e em ordem.
    func aggregateEntries(in collectionID: String?) -> [DriveEntry] {
        guard let collectionID,
              let collection = collections.first(where: { $0.id == collectionID }) else { return [] }

        var seen = Set<String>()
        var result: [DriveEntry] = []

        for source in collection.sources {
            for entry in source.entries where entry.isVideo && !entry.isFolder {
                if seen.insert(entry.id).inserted {
                    result.append(entry)
                }
            }
        }

        return result.sorted(by: EpisodeSort.less)
    }

    func episodeCount(in collectionID: String?) -> Int {
        aggregateEntries(in: collectionID).count
    }

    // MARK: Coleções

    @discardableResult
    func createCollection(name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let collection = LibraryCollection(
            id: UUID().uuidString,
            name: trimmed.isEmpty ? "Nova coleção" : trimmed,
            createdAt: Date(),
            isDefault: false,
            sources: []
        )
        collections.append(collection)
        selectedCollectionID = collection.id
        save()
        return collection.id
    }

    func renameCollection(id: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let index = collections.firstIndex(where: { $0.id == id }) else { return }
        collections[index].name = trimmed
        save()
    }

    @discardableResult
    func deleteCollection(id: String) -> Bool {
        guard let index = collections.firstIndex(where: { $0.id == id }),
              !collections[index].isDefault else { return false }

        collections.remove(at: index)

        if selectedCollectionID == id {
            selectedCollectionID = defaultCollection?.id ?? collections.first?.id
        }
        save()
        return true
    }

    func select(_ id: String?) {
        selectedCollectionID = id
    }

    // MARK: Fontes

    /// Adiciona uma pasta/arquivo. Se já existir, atualiza os itens e retorna false.
    @discardableResult
    func addSource(
        collectionID: String,
        kind: LibrarySource.Kind,
        driveID: String,
        name: String,
        entries: [DriveEntry]
    ) -> Bool {
        guard let index = collections.firstIndex(where: { $0.id == collectionID }) else { return false }

        let sourceID = "\(kind.rawValue):\(driveID)"

        if let existing = collections[index].sources.firstIndex(where: { $0.id == sourceID }) {
            collections[index].sources[existing].name = name
            collections[index].sources[existing].entries = entries
            save()
            return false
        }

        let source = LibrarySource(
            id: sourceID,
            kind: kind,
            driveID: driveID,
            name: name,
            addedAt: Date(),
            entries: entries
        )
        collections[index].sources.append(source)
        save()
        return true
    }

    func removeSource(collectionID: String, sourceID: String) {
        guard let index = collections.firstIndex(where: { $0.id == collectionID }) else { return }
        collections[index].sources.removeAll { $0.id == sourceID }
        save()
    }

    func moveSource(sourceID: String, from: String, to: String) {
        guard from != to,
              let fromIndex = collections.firstIndex(where: { $0.id == from }),
              let toIndex = collections.firstIndex(where: { $0.id == to }),
              let sourceIndex = collections[fromIndex].sources.firstIndex(where: { $0.id == sourceID }) else {
            return
        }

        let source = collections[fromIndex].sources.remove(at: sourceIndex)

        if !collections[toIndex].sources.contains(where: { $0.id == source.id }) {
            collections[toIndex].sources.append(source)
        }

        save()
    }

    /// Rebusca os itens das pastas (para pegar episódios novos).
    func refreshSources(in collectionID: String) async {
        guard let index = collections.firstIndex(where: { $0.id == collectionID }) else { return }

        isRefreshing = true
        defer { isRefreshing = false }

        var sources = collections[index].sources

        for sourceIndex in sources.indices where sources[sourceIndex].kind == .folder {
            let folderID = sources[sourceIndex].driveID
            guard let content = try? await DriveFolder.fetch(folderID: folderID) else { continue }
            sources[sourceIndex].entries = content.entries
            sources[sourceIndex].name = content.name
        }

        guard let currentIndex = collections.firstIndex(where: { $0.id == collectionID }) else { return }
        collections[currentIndex].sources = sources
        save()
    }

    // MARK: Persistência

    private func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let decoded = try? decoder.decode([LibraryCollection].self, from: data) else {
            NSLog("DrivePlay: não foi possível ler a biblioteca em %@", fileURL.path)
            return
        }
        collections = decoded
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        guard let data = try? encoder.encode(collections) else { return }
        do {
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSLog("DrivePlay: erro ao salvar biblioteca: %@", error.localizedDescription)
        }
    }

    private func saveSelection() {
        UserDefaults.standard.set(selectedCollectionID, forKey: selectionKey)
    }
}

// MARK: - Importação de links

enum LibraryImportError: LocalizedError {
    case invalidLink

    var errorDescription: String? {
        switch self {
        case .invalidLink:
            return "Link inválido. Cole um link de pasta ou de arquivo do Google Drive."
        }
    }
}

@MainActor
enum LibraryLinkImporter {
    /// Lê o link, busca os itens no Drive e adiciona à coleção.
    /// Retorna uma mensagem para mostrar ao usuário.
    static func importLink(_ input: String, into collectionID: String, media: MediaLibrary) async throws -> String {
        guard let target = DriveLink.target(from: input) else {
            throw LibraryImportError.invalidLink
        }

        switch target {
        case .folder(let folderID):
            let content = try await DriveFolder.fetch(folderID: folderID)
            let added = media.addSource(
                collectionID: collectionID,
                kind: .folder,
                driveID: folderID,
                name: content.name,
                entries: content.entries
            )
            return added
                ? "Pasta “\(content.name)” adicionada"
                : "Essa pasta já estava na coleção (itens atualizados)"

        case .file(let fileID):
            let title = await DriveLink.fetchTitle(id: fileID) ?? "Vídeo do Drive"
            let entry = DriveEntry(
                id: fileID,
                name: title,
                isFolder: false,
                isVideo: true,
                modified: nil,
                thumbnail: nil,
                mimeType: nil
            )
            let added = media.addSource(
                collectionID: collectionID,
                kind: .file,
                driveID: fileID,
                name: title,
                entries: [entry]
            )
            return added
                ? "“\(title)” adicionado"
                : "Esse vídeo já estava na coleção"
        }
    }
}
