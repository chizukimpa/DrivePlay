import Foundation

struct DriveEntry: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let isFolder: Bool
    let isVideo: Bool
    let modified: String?
    let thumbnail: URL?
    let mimeType: String?

    var fileExtension: String {
        (name as NSString).pathExtension.uppercased()
    }

    var subtitle: String {
        var parts: [String] = []
        if isFolder {
            parts.append("Pasta")
        } else if !fileExtension.isEmpty {
            parts.append(fileExtension)
        }
        if let modified, !modified.isEmpty {
            parts.append(modified)
        }
        return parts.joined(separator: " · ")
    }
}

struct FolderContent: Identifiable {
    let id: String
    let name: String
    let entries: [DriveEntry]
}

enum DriveFolderError: LocalizedError {
    case notPublic
    case unreadable

    var errorDescription: String? {
        switch self {
        case .notPublic:
            return "Não foi possível abrir a pasta. Compartilhe como “qualquer pessoa com o link”."
        case .unreadable:
            return "A pasta não pôde ser lida. Verifique a conexão e tente novamente."
        }
    }
}

/// Lê a listagem de uma pasta pública do Drive pelo endpoint de visualização
/// incorporada, que devolve HTML simples (sem precisar de API key).
enum DriveFolder {
    private static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

    private static let videoExtensions: Set<String> = [
        "mkv", "mp4", "m4v", "avi", "mov", "webm", "ts", "m2ts",
        "mpg", "mpeg", "wmv", "flv", "ogv", "3gp"
    ]

    static func fetch(folderID: String) async throws -> FolderContent {
        var components = URLComponents(string: "https://drive.google.com/embeddedfolderview")!
        components.queryItems = [URLQueryItem(name: "id", value: folderID)]

        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 20
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("pt-BR,pt;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let html = String(data: data, encoding: .utf8) else {
            throw DriveFolderError.unreadable
        }

        guard html.contains("id=\"flip-contents\"") || html.contains("flip-entry") else {
            throw DriveFolderError.notPublic
        }

        let name = parseTitle(html) ?? "Google Drive"
        return FolderContent(id: folderID, name: name, entries: parseEntries(html))
    }

    private static func parseTitle(_ html: String) -> String? {
        guard let raw = firstMatch("<title>(.*?)</title>", in: html) else { return nil }
        let name = raw.htmlDecoded.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? nil : name
    }

    private static func parseEntries(_ html: String) -> [DriveEntry] {
        var entries: [DriveEntry] = []
        let chunks = html.components(separatedBy: "<div class=\"flip-entry\"").dropFirst()

        for chunk in chunks {
            guard let id = firstMatch("id=\"entry-([^\"]+)\"", in: chunk),
                  let rawName = firstMatch("flip-entry-title\">(.*?)</div>", in: chunk) else {
                continue
            }

            let name = rawName.htmlDecoded.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }

            let isFolder = chunk.contains("drive-sprite-folder") || chunk.contains("aria-label=\"Folder\"")
            let mime = firstMatch("type/([a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+)", in: chunk)
            let ext = (name as NSString).pathExtension.lowercased()
            let isVideo = mime?.hasPrefix("video/") == true || videoExtensions.contains(ext)

            let modified = firstMatch("flip-entry-last-modified\"><div>(.*?)</div>", in: chunk)?.htmlDecoded
            let thumbString = firstMatch("flip-entry-thumb\"><img src=\"([^\"]+)\"", in: chunk)?.htmlDecoded
            let thumbnail = thumbString.flatMap { URL(string: $0) }

            entries.append(
                DriveEntry(
                    id: id,
                    name: name,
                    isFolder: isFolder,
                    isVideo: isVideo,
                    modified: modified,
                    thumbnail: thumbnail,
                    mimeType: mime
                )
            )
        }

        return entries
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) else {
            return nil
        }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > 1,
              let valueRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return String(text[valueRange])
    }
}

extension String {
    var htmlDecoded: String {
        let entities = [
            "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&nbsp;": " "
        ]
        var result = self
        for (entity, value) in entities {
            result = result.replacingOccurrences(of: entity, with: value)
        }
        return result
    }
}
