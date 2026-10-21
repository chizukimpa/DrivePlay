import Foundation

struct DriveItem: Identifiable, Codable, Hashable {
    var id: String
    var title: String
    var added: Date
}

/// Histórico de vídeos e pastas, persistido em UserDefaults.
final class Library: ObservableObject {
    @Published private(set) var items: [DriveItem] = []
    @Published private(set) var folders: [DriveItem] = []

    private let videosKey = "driveplay.history"
    private let foldersKey = "driveplay.folders"
    private let limit = 20

    init() {
        items = load(key: videosKey)
        folders = load(key: foldersKey)
    }

    // MARK: - Vídeos

    func add(id: String, title: String) {
        items = inserting(DriveItem(id: id, title: title, added: Date()), into: items)
        save(items, key: videosKey)
    }

    func updateTitle(id: String, title: String) {
        guard !title.isEmpty,
              let index = items.firstIndex(where: { $0.id == id }),
              items[index].title != title else { return }
        items[index].title = title
        save(items, key: videosKey)
    }

    func remove(id: String) {
        items.removeAll { $0.id == id }
        save(items, key: videosKey)
    }

    func clear() {
        items.removeAll()
        save(items, key: videosKey)
    }

    // MARK: - Pastas

    func addFolder(id: String, name: String) {
        folders = inserting(DriveItem(id: id, title: name, added: Date()), into: folders)
        save(folders, key: foldersKey)
    }

    func updateFolderName(id: String, name: String) {
        guard !name.isEmpty,
              let index = folders.firstIndex(where: { $0.id == id }),
              folders[index].title != name else { return }
        folders[index].title = name
        save(folders, key: foldersKey)
    }

    func removeFolder(id: String) {
        folders.removeAll { $0.id == id }
        save(folders, key: foldersKey)
    }

    func clearFolders() {
        folders.removeAll()
        save(folders, key: foldersKey)
    }

    func clearAll() {
        clear()
        clearFolders()
    }

    // MARK: - Persistência

    private func inserting(_ item: DriveItem, into list: [DriveItem]) -> [DriveItem] {
        var result = list

        if let index = result.firstIndex(where: { $0.id == item.id }) {
            var updated = result[index]
            if !item.title.isEmpty { updated.title = item.title }
            updated.added = item.added
            result.remove(at: index)
            result.insert(updated, at: 0)
        } else {
            result.insert(item, at: 0)
        }

        if result.count > limit {
            result = Array(result.prefix(limit))
        }
        return result
    }

    private func load(key: String) -> [DriveItem] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([DriveItem].self, from: data) else {
            return []
        }
        return decoded
    }

    private func save(_ list: [DriveItem], key: String) {
        guard let data = try? JSONEncoder().encode(list) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
