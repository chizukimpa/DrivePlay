import Foundation

/// Estado do navegador de pastas: pilha de navegação, cache e busca.
@MainActor
final class FolderBrowser: ObservableObject {
    @Published private(set) var stack: [FolderContent] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?
    @Published var searchText = ""

    private var cache: [String: FolderContent] = [:]
    private(set) var lastFailedID: String?

    var current: FolderContent? { stack.last }
    var canGoBack: Bool { stack.count > 1 }

    var videos: [DriveEntry] {
        sorted((current?.entries ?? []).filter(\.isVideo))
    }

    var visibleEntries: [DriveEntry] {
        guard let current else { return [] }
        let base = searchText.isEmpty
            ? current.entries
            : current.entries.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
        return sorted(base)
    }

    private func sorted(_ entries: [DriveEntry]) -> [DriveEntry] {
        entries.sorted { first, second in
            if first.isFolder != second.isFolder { return first.isFolder }
            return first.name.localizedStandardCompare(second.name) == .orderedAscending
        }
    }

    func open(folderID: String) async {
        if let cached = cache[folderID] {
            stack = [cached]
            error = nil
            searchText = ""
            return
        }

        isLoading = true
        error = nil
        lastFailedID = folderID

        do {
            let content = try await DriveFolder.fetch(folderID: folderID)
            cache[folderID] = content
            stack = [content]
            searchText = ""
        } catch {
            stack = []
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func openSubfolder(_ entry: DriveEntry) async {
        guard entry.isFolder else { return }

        if let cached = cache[entry.id] {
            stack.append(cached)
            error = nil
            searchText = ""
            return
        }

        isLoading = true
        error = nil

        do {
            let content = try await DriveFolder.fetch(folderID: entry.id)
            cache[entry.id] = content
            stack.append(content)
            searchText = ""
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func goBack() {
        guard stack.count > 1 else { return }
        stack.removeLast()
        searchText = ""
        error = nil
    }

    func reload() async {
        guard let current else {
            if let lastFailedID {
                await open(folderID: lastFailedID)
            }
            return
        }

        cache[current.id] = nil
        await open(folderID: current.id)
    }

    func close() {
        stack = []
        error = nil
        searchText = ""
    }
}
