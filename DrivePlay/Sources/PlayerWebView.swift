import AppKit
import SwiftUI
import WebKit

/// Estado de reprodução compartilhado entre o JavaScript injetado e a interface.
final class PlayerController: ObservableObject {
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var hasEnded = false
    @Published private(set) var isReady = false
    @Published private(set) var hasVideo = false

    weak var webView: WKWebView?

    func attach(_ webView: WKWebView) {
        self.webView = webView
    }

    func reset() {
        currentTime = 0
        duration = 0
        isPlaying = false
        hasEnded = false
        isReady = false
        hasVideo = false
    }

    func seek(to seconds: Double) {
        send(["seek": seconds])
    }

    func send(_ command: [String: Any]) {
        if ProcessInfo.processInfo.environment["DRIVEPLAY_LOG_TICKS"] != nil {
            NSLog("DrivePlay comando: %@", String(describing: command))
        }
        guard let data = try? JSONSerialization.data(withJSONObject: command),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__driveplayCmd(\(json));", completionHandler: nil)
    }

    func handleTick(_ body: [String: Any]) {
        // Frames antigos (about:blank, login) continuam enviando ticks sem vídeo
        // depois da navegação; ignorá-los evita piscar o estado do player.
        guard let video = body["video"] as? [String: Any] else { return }

        let reportedDuration = (video["d"] as? NSNumber)?.doubleValue ?? 0

        // Um frame sem metadados (ou um vídeo oculto) não pode zerar o estado
        // do vídeo que já está tocando.
        if reportedDuration <= 1 && duration > 1 { return }

        hasVideo = true
        duration = reportedDuration
        currentTime = (video["t"] as? NSNumber)?.doubleValue ?? 0
        isPlaying = !((video["paused"] as? Bool) ?? true) && !((video["ended"] as? Bool) ?? false)
        hasEnded = (video["ended"] as? Bool) ?? false
        isReady = ((video["ready"] as? NSNumber)?.intValue ?? 0) >= 1

        if ProcessInfo.processInfo.environment["DRIVEPLAY_LOG_TICKS"] != nil {
            NSLog("DrivePlay tick: t=%.1f d=%.1f paused=%@ ended=%@ ready=%d",
                  currentTime, duration,
                  String(describing: !isPlaying), String(describing: hasEnded),
                  (video["ready"] as? NSNumber)?.intValue ?? 0)
        }
    }
}

/// Player integrado: carrega a página de preview do Google Drive, que
/// transcodifica o vídeo no servidor (por isso MKV funciona sem codecs locais).
///
/// O preview do Drive usa um iframe do YouTube. Um script injetado em todos os
/// frames encontra o elemento `<video>`, reporta tempo/duração e aceita comandos
/// de seek — é isso que permite pular abertura, retomar e avançar episódios.
struct PlayerWebView: NSViewRepresentable {
    let fileID: String
    let reloadToken: Int
    let controller: PlayerController
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    private static let controllerScript = """
    (function() {
      if (window.__driveplayInstalled) return;
      window.__driveplayInstalled = true;

      function collect(root, out) {
        try {
          root.querySelectorAll('video').forEach(function(v) { out.push(v); });
          root.querySelectorAll('*').forEach(function(el) {
            if (el.shadowRoot) collect(el.shadowRoot, out);
          });
        } catch (e) {}
      }

      function allVideos() {
        var out = [];
        collect(document, out);
        return out;
      }

      function primaryVideo() {
        var list = allVideos();
        var best = null;
        for (var i = 0; i < list.length; i++) {
          var v = list[i];
          var duration = isFinite(v.duration) ? v.duration : 0;
          var bestDuration = best && isFinite(best.duration) ? best.duration : 0;
          if (!best || duration > bestDuration) best = v;
        }
        return best;
      }

      function report() {
        var v = primaryVideo();
        var payload = { type: 'tick', href: location.href };
        if (v) {
          payload.video = {
            t: v.currentTime || 0,
            d: isFinite(v.duration) ? v.duration : 0,
            paused: !!v.paused,
            ended: !!v.ended,
            ready: v.readyState || 0
          };
        }
        try {
          window.webkit.messageHandlers.driveplay.postMessage(payload);
        } catch (e) {}
      }

      function forward(cmd) {
        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i++) {
          try { frames[i].contentWindow.postMessage({ __driveplay: cmd }, '*'); } catch (e) {}
        }
      }

      function apply(cmd) {
        var v = primaryVideo();
        if (!v) return;
        if (typeof cmd.seek === 'number' && isFinite(cmd.seek)) {
          try { v.currentTime = cmd.seek; } catch (e) {}
        }
        if (cmd.play === true) { try { v.play(); } catch (e) {} }
        if (cmd.pause === true) { try { v.pause(); } catch (e) {} }
      }

      window.__driveplayCmd = function(cmd) {
        apply(cmd);
        forward(cmd);
      };

      window.addEventListener('message', function(event) {
        var cmd = event && event.data && event.data.__driveplay;
        if (!cmd) return;
        apply(cmd);
        forward(cmd);
      });

      setInterval(report, 1000);
      setTimeout(report, 500);
    })();
    """

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.isElementFullscreenEnabled = true
        configuration.userContentController.add(context.coordinator, name: "driveplay")
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.controllerScript, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false

        controller.attach(webView)
        context.coordinator.webView = webView
        context.coordinator.load(id: fileID)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        controller.attach(webView)

        if context.coordinator.loadedID != fileID {
            context.coordinator.load(id: fileID)
        } else if context.coordinator.loadedToken != reloadToken {
            context.coordinator.loadedToken = reloadToken
            context.coordinator.parent.setLoading(true)
            context.coordinator.parent.setError(nil)
            webView.reload()
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: PlayerWebView
        var webView: WKWebView?
        var loadedID: String?
        var loadedToken = 0

        init(_ parent: PlayerWebView) {
            self.parent = parent
        }

        func load(id: String) {
            loadedID = id
            loadedToken = parent.reloadToken
            parent.setLoading(true)
            parent.setError(nil)
            parent.controller.reset()
            NSLog("DrivePlay: carregando preview de %@", id)
            webView?.load(URLRequest(url: DriveLink.previewURL(id: id)))
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.setLoading(true)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            NSLog("DrivePlay: preview carregado")
            parent.setLoading(false)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handle(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handle(error)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                NSWorkspace.shared.open(url)
            }
            return nil
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  (body["type"] as? String) == "tick" else { return }
            parent.controller.handleTick(body)
        }

        private func handle(_ error: Error) {
            parent.setLoading(false)
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else { return }
            NSLog("DrivePlay: erro de navegação %@", nsError.localizedDescription)
            parent.setError(nsError.localizedDescription)
        }
    }
}

private extension PlayerWebView {
    func setLoading(_ value: Bool) {
        DispatchQueue.main.async {
            if self.isLoading != value { self.isLoading = value }
        }
    }

    func setError(_ value: String?) {
        DispatchQueue.main.async {
            if self.errorMessage != value { self.errorMessage = value }
        }
    }
}
