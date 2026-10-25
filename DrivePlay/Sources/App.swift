import SwiftUI

@main
struct DrivePlayApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @AppStorage("skipIntro") private var skipIntro = PlaybackDefaults.skipIntro
    @AppStorage("skipEnding") private var skipEnding = PlaybackDefaults.skipEnding
    @AppStorage("autoNext") private var autoNext = PlaybackDefaults.autoNext
    @AppStorage("resumePlayback") private var resumePlayback = PlaybackDefaults.resumePlayback
    @AppStorage("autoFullscreen") private var autoFullscreen = PlaybackDefaults.autoFullscreen
    @AppStorage("fillScreen") private var fillScreen = false

    private static var launchLink: String? {
        CommandLine.arguments.dropFirst().first { DriveLink.target(from: $0) != nil }
    }

    var body: some Scene {
        WindowGroup("DrivePlay") {
            ContentView(initialLink: Self.launchLink)
                .frame(minWidth: 900, minHeight: 600)
                .preferredColorScheme(.dark)
        }
        .defaultSize(width: 1120, height: 740)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {}

            CommandGroup(after: .newItem) {
                Button("Colar link e reproduzir") {
                    NotificationCenter.default.post(name: .pasteAndPlay, object: nil)
                }
                .keyboardShortcut("v", modifiers: [.command, .shift])

                Button("Reproduzir novamente") {
                    NotificationCenter.default.post(name: .reloadPlayer, object: nil)
                }
                .keyboardShortcut("r", modifiers: .command)

                Button("Abrir no VLC") {
                    NotificationCenter.default.post(name: .openInVLC, object: nil)
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])

                Divider()

                Button("Episódio anterior") {
                    NotificationCenter.default.post(name: .previousEpisode, object: nil)
                }
                .keyboardShortcut(.leftArrow, modifiers: .command)

                Button("Próximo episódio") {
                    NotificationCenter.default.post(name: .nextEpisode, object: nil)
                }
                .keyboardShortcut(.rightArrow, modifiers: .command)
            }

            CommandMenu("Reprodução") {
                Toggle("Pular abertura automaticamente", isOn: $skipIntro)
                Toggle("Pular encerramento automaticamente", isOn: $skipEnding)
                Toggle("Avançar para o próximo episódio", isOn: $autoNext)
                Toggle("Retomar de onde parou", isOn: $resumePlayback)
                Toggle("Tela cheia do vídeo após 5 s sem atividade", isOn: $autoFullscreen)
                Toggle("Preencher a tela (pode cortar as bordas)", isOn: $fillScreen)
                    .keyboardShortcut("f", modifiers: [.command, .shift])
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

extension Notification.Name {
    static let pasteAndPlay = Notification.Name("driveplay.pasteAndPlay")
    static let reloadPlayer = Notification.Name("driveplay.reload")
    static let openInVLC = Notification.Name("driveplay.openVLC")
    static let nextEpisode = Notification.Name("driveplay.nextEpisode")
    static let previousEpisode = Notification.Name("driveplay.previousEpisode")
}
