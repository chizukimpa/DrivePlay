import SwiftUI

enum PlaybackDefaults {
    static let skipIntro = true
    static let introSeconds = 120.0
    static let skipEnding = true
    static let endingSeconds = 190.0
    static let autoNext = true
    static let resumePlayback = true
    static let showSkipButtons = true
    static let autoFullscreen = true
}

struct PlaybackSettingsView: View {
    @AppStorage("skipIntro") private var skipIntro = PlaybackDefaults.skipIntro
    @AppStorage("introSeconds") private var introSeconds = PlaybackDefaults.introSeconds
    @AppStorage("skipEnding") private var skipEnding = PlaybackDefaults.skipEnding
    @AppStorage("endingSeconds") private var endingSeconds = PlaybackDefaults.endingSeconds
    @AppStorage("autoNext") private var autoNext = PlaybackDefaults.autoNext
    @AppStorage("resumePlayback") private var resumePlayback = PlaybackDefaults.resumePlayback
    @AppStorage("showSkipButtons") private var showSkipButtons = PlaybackDefaults.showSkipButtons
    @AppStorage("autoFullscreen") private var autoFullscreen = PlaybackDefaults.autoFullscreen

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Reprodução")
                .font(.system(size: 13, weight: .bold, design: .rounded))

            Toggle("Pular abertura automaticamente", isOn: $skipIntro)
                .toggleStyle(.switch)
                .controlSize(.mini)

            HStack {
                Text("Duração da abertura")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
                Stepper(value: $introSeconds, in: 5...300, step: 5) {
                    Text("\(Int(introSeconds)) s")
                        .font(.system(size: 11, design: .monospaced))
                }
                .controlSize(.small)
            }
            .disabled(!skipIntro)
            .opacity(skipIntro ? 1 : 0.45)

            Divider().overlay(Color.white.opacity(0.08))

            Toggle("Pular encerramento automaticamente", isOn: $skipEnding)
                .toggleStyle(.switch)
                .controlSize(.mini)

            HStack {
                Text("Encerramento (últimos)")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
                Stepper(value: $endingSeconds, in: 30...1200, step: 10) {
                    Text("\(Int(endingSeconds)) s")
                        .font(.system(size: 11, design: .monospaced))
                }
                .controlSize(.small)
            }
            .disabled(!skipEnding)
            .opacity(skipEnding ? 1 : 0.45)

            Divider().overlay(Color.white.opacity(0.08))

            Toggle("Avançar para o próximo episódio", isOn: $autoNext)
                .toggleStyle(.switch)
                .controlSize(.mini)

            Toggle("Retomar de onde parou", isOn: $resumePlayback)
                .toggleStyle(.switch)
                .controlSize(.mini)

            Toggle("Mostrar botões de pular", isOn: $showSkipButtons)
                .toggleStyle(.switch)
                .controlSize(.mini)

            Toggle("Entrar em tela cheia do vídeo após 5 s sem atividade", isOn: $autoFullscreen)
                .toggleStyle(.switch)
                .controlSize(.mini)

            Text("As escolhas ficam salvas. O botão “Pular” na barra inferior indica quando o pulo automático está ativo. Depois de sair manualmente da tela cheia, ela volta a entrar apenas no próximo episódio.")
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(width: 330)
        .background(Theme.background)
    }
}
