import Foundation

struct WatchState: Codable {
    var time: Double
    var duration: Double
    var watched: Bool
}

/// Progresso de cada episódio: onde parou e se já foi assistido.
final class ProgressStore: ObservableObject {
    @Published private(set) var states: [String: WatchState] = [:]

    private let storageKey = "driveplay.watch.v1"

    init() {
        load()
    }

    func isWatched(_ id: String) -> Bool {
        states[id]?.watched == true
    }

    func fraction(_ id: String) -> Double {
        guard let state = states[id], state.duration > 1 else { return 0 }
        return min(max(state.time / state.duration, 0), 1)
    }

    /// Retorna o ponto de retomada, ignorando vídeos já concluídos.
    func resumeTime(for id: String) -> Double? {
        guard let state = states[id], !state.watched, state.time > 5 else { return nil }
        if state.duration > 0 && state.time > state.duration - 15 { return nil }
        return state.time
    }

    func record(id: String, time: Double, duration: Double) {
        guard duration > 1 else { return }

        var state = states[id] ?? WatchState(time: 0, duration: duration, watched: false)

        // Evita zerar o progresso antes do seek de retomada acontecer.
        if time < 1 && state.time > 5 { return }

        state.duration = duration
        if state.watched {
            state.time = duration
        } else {
            state.time = min(max(time, 0), duration)
            if state.time >= duration - 15 || state.time / duration >= 0.95 {
                state.watched = true
                state.time = duration
            }
        }

        states[id] = state
        save()
    }

    func markWatched(id: String, duration: Double) {
        var state = states[id] ?? WatchState(time: duration, duration: duration, watched: true)
        state.watched = true
        if duration > 0 { state.duration = duration }
        state.time = max(state.time, duration)
        states[id] = state
        save()
    }

    /// Marca como assistido usando a duração já conhecida (se houver).
    func markWatched(id: String) {
        markWatched(id: id, duration: states[id]?.duration ?? 0)
    }

    /// Remove o ✓ de assistido, mas mantém onde o vídeo parou.
    func markUnwatched(id: String) {
        guard var state = states[id] else { return }
        state.watched = false
        states[id] = state
        save()
    }

    /// Zera o progresso e o ✓, como se o episódio nunca tivesse sido aberto.
    func resetProgress(id: String) {
        guard var state = states[id] else { return }
        state.time = 0
        state.watched = false
        states[id] = state
        save()
    }

    func remove(id: String) {
        states.removeValue(forKey: id)
        save()
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([String: WatchState].self, from: data) else {
            return
        }
        states = decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(states) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }
}
