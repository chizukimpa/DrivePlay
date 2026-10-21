import Foundation

enum DriveTarget {
    case file(String)
    case folder(String)
}

/// Utilitários para extrair o ID de um arquivo ou pasta a partir de links do
/// Google Drive e montar as URLs usadas pelo app.
enum DriveLink {
    private static let idPattern = "[A-Za-z0-9_-]{10,}"

    /// Descobre se o link aponta para um arquivo ou para uma pasta.
    static func target(from input: String) -> DriveTarget? {
        if let folderID = folderID(from: input) { return .folder(folderID) }
        if let fileID = fileID(from: input) { return .file(fileID) }
        return nil
    }

    /// Aceita links de compartilhamento, links de preview, `open?id=` e o ID puro.
    static func fileID(from input: String) -> String? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        let patterns = [
            "/file/d/(\(idPattern))",
            "[?&]id=(\(idPattern))",
            "/d/(\(idPattern))"
        ]

        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(text.startIndex..., in: text)
            guard let match = regex.firstMatch(in: text, range: range),
                  match.numberOfRanges > 1,
                  let idRange = Range(match.range(at: 1), in: text) else { continue }
            return String(text[idRange])
        }

        if text.range(of: "^\(idPattern)$", options: .regularExpression) != nil {
            return text
        }
        return nil
    }

    /// Links de pasta: /drive/folders/<ID>, /drive/u/0/folders/<ID>, /folders/<ID>.
    static func folderID(from input: String) -> String? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        let patterns = [
            "/drive/folders/(\(idPattern))",
            "/folders/(\(idPattern))"
        ]

        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(text.startIndex..., in: text)
            guard let match = regex.firstMatch(in: text, range: range),
                  match.numberOfRanges > 1,
                  let idRange = Range(match.range(at: 1), in: text) else { continue }
            return String(text[idRange])
        }
        return nil
    }

    static func folderURL(id: String) -> URL {
        URL(string: "https://drive.google.com/drive/folders/\(id)")!
    }

    static func previewURL(id: String) -> URL {
        URL(string: "https://drive.google.com/file/d/\(id)/preview?autoplay=1")!
    }

    static func viewURL(id: String) -> URL {
        URL(string: "https://drive.google.com/file/d/\(id)/view")!
    }

    /// Link direto com `confirm=t`, que libera arquivos grandes sem a tela de
    /// aviso de vírus do Drive e suporta requisições por faixa (streaming).
    static func directURL(id: String) -> URL {
        URL(string: "https://drive.usercontent.google.com/download?id=\(id)&export=download&confirm=t")!
    }

    static func browserDownloadURL(id: String) -> URL {
        URL(string: "https://drive.google.com/uc?export=download&id=\(id)")!
    }

    /// Lê o nome do arquivo na página de visualização do Drive.
    static func fetchTitle(id: String) async -> String? {
        var request = URLRequest(url: viewURL(id: id))
        request.timeoutInterval = 15
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            forHTTPHeaderField: "User-Agent"
        )
        request.setValue("pt-BR,pt;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let html = String(data: data, encoding: .utf8) else { return nil }

        guard let start = html.range(of: "<title>"),
              let end = html.range(of: "</title>", range: start.upperBound..<html.endIndex) else {
            return nil
        }

        var title = String(html[start.upperBound..<end.lowerBound])
        title = title.replacingOccurrences(of: " - Google Drive", with: "")
        title = title.htmlDecoded.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
    }
}
