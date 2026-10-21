import AppKit
import Foundation

/// Baixa o arquivo original direto do Drive, com progresso e cancelamento.
final class DownloadManager: NSObject, ObservableObject {
    enum State: Equatable {
        case idle
        case downloading(Double)
        case finished(URL)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    private var task: URLSessionDownloadTask?
    private var session: URLSession?
    private var suggestedName: String?

    func start(id: String, filename: String) {
        cancel()

        suggestedName = filename.isEmpty ? "video.mkv" : filename
        state = .downloading(0)

        let configuration = URLSessionConfiguration.default
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        self.session = session

        let task = session.downloadTask(with: DriveLink.directURL(id: id))
        self.task = task
        task.resume()
    }

    func cancel() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        if case .downloading = state { state = .idle }
    }

    func reveal() {
        guard case .finished(let url) = state else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    func dismissError() {
        if case .failed = state { state = .idle }
    }
}

extension DownloadManager: URLSessionDownloadDelegate {
    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        if case .downloading = state {
            state = .downloading(progress)
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        let responseName = downloadTask.response?.suggestedFilename
        let rawName = suggestedName ?? responseName ?? "video.mkv"
        let filename = rawName.replacingOccurrences(of: "/", with: "-")

        if let mime = downloadTask.response?.mimeType, mime.contains("text/html") {
            state = .failed("O Drive devolveu uma página em vez do vídeo. Verifique se o arquivo está compartilhado como “qualquer pessoa com o link”.")
            return
        }

        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser
        let destination = uniqueDestination(in: downloads, filename: filename)

        do {
            try FileManager.default.moveItem(at: location, to: destination)
            state = .finished(destination)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        state = .failed(nsError.localizedDescription)
    }

    private func uniqueDestination(in directory: URL, filename: String) -> URL {
        var destination = directory.appendingPathComponent(filename)
        guard FileManager.default.fileExists(atPath: destination.path) else { return destination }

        let base = destination.deletingPathExtension().lastPathComponent
        let ext = destination.pathExtension
        var counter = 1
        while FileManager.default.fileExists(atPath: destination.path) {
            let name = ext.isEmpty ? "\(base) (\(counter))" : "\(base) (\(counter)).\(ext)"
            destination = directory.appendingPathComponent(name)
            counter += 1
        }
        return destination
    }
}
