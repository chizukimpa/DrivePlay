# DrivePlay

> Player de vídeos do Google Drive para macOS, Windows e Android.

## Sobre

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com três versões:

- **macOS** — app nativo em Swift (`DrivePlay/`).
- **Windows** — app Electron com a mesma interface e funções (`DrivePlayWindows/`).
- **Android** — app WebView nativo, otimizado para celular e para a tela de capa do
  Galaxy Z Flip 6 via MultiStar (`DrivePlayAndroid/`).

O Google Drive transcodifica o vídeo no servidor, então **MKV funciona sem instalar
codecs ou converter nada**. Para legendas embutidas, faixas de áudio e qualidade
original, use **Abrir no VLC**.

## Funcionalidades

- Reprodução de MKV, AVI e MP4 direto do Google Drive.
- Navegação por pastas e subpastas, com busca e miniaturas.
- Episódio anterior/próximo e progresso por episódio.
- Pular abertura em **120 s** e encerramento em **190 s** por padrão, com opções de
  pulo automático, avanço automático, retomada e marcação de assistidos.
- **Tela cheia automática** após 5 segundos sem atividade, mostrando apenas o vídeo.
- **Preencher a tela**: amplia e corta as bordas do vídeo para ocupar toda a tela
  (útil em telas largas e na tela de capa do Z Flip 6).
- Biblioteca persistente de coleções e temporadas, com gerenciamento de fontes.
- Menu de contexto para reproduzir, marcar como assistido, resetar progresso, abrir no
  VLC, baixar, compartilhar e copiar links.
- Download do arquivo original e abertura do stream no VLC.
- Sessão persistente do Google para arquivos privados.

## Tecnologias

- **macOS:** Swift, SwiftUI e WKWebView.
- **Windows:** Electron, JavaScript, HTML e CSS.
- **Android:** Java, WebView, HTML, CSS e JavaScript.
- **Google Drive:** player/preview e transcodificação no servidor.
- **VLC:** reprodução local opcional.
- **GitHub Actions:** build e publicação das releases.

## Download e acesso

Baixe a versão mais recente na página de
**[Releases](https://github.com/chizukimpa/DrivePlay/releases/latest)**:

| Sistema | Arquivo | Observação |
| --- | --- | --- |
| Windows | `DrivePlay-Setup-1.1.0-x64.exe` | Instalador (recomendado). |
| Windows | `DrivePlay-Portable-1.1.0-x64.exe` | Portátil em um arquivo. |
| Windows | `DrivePlay-1.1.0-win32-x64-portable.zip` | Pasta portátil. |
| macOS | `DrivePlay-macOS-universal-1.1.0.zip` | App universal (Intel e Apple Silicon), macOS 14+. |
| Android | `DrivePlay-Android-1.1.0.apk` | Android 7+; funciona no celular e na tela de capa via MultiStar. |

Os builds não têm assinatura digital paga. No Windows, o SmartScreen pode pedir
**Mais informações → Executar assim mesmo**. No macOS, clique com o botão direito no
app → **Abrir** na primeira execução. No Android, permita a instalação de apps de
fontes desconhecidas para o APK.

### Android e tela de capa

Para usar na tela de capa do Galaxy Z Flip 6:

1. Ative o **MultiStar** (Good Lock) e permita o app na tela de capa.
2. Abra o DrivePlay pela tela de capa.
3. Ative **Preencher a tela** nos ajustes ou no botão da barra superior para remover
   as faixas pretas.

O login do Google pode ser bloqueado dentro do WebView. Nesse caso, use um link
público/compartilhado ou abra o arquivo pelo Chrome; o DrivePlay mantém o fallback
para o navegador.

## Como rodar

### macOS

```bash
cd DrivePlay
./build.sh
open build/DrivePlay.app
```

Para instalar em Aplicativos:

```bash
./build.sh --install
```

Para gerar um binário universal (Intel + Apple Silicon):

```bash
./build-universal.sh
```

Requisitos: macOS 14+ e VLC opcional (recomendado para MKV).

### Windows

```bat
cd DrivePlayWindows
npm install
npm start
npm run dist:win
```

Os instaladores ficam em `DrivePlayWindows/dist`. Requisitos: Windows 10/11 64 bits,
Node.js e VLC opcional.

### Android

```bash
cd DrivePlayAndroid
./build-android.sh
```

O APK assinado fica em `DrivePlayAndroid/build/DrivePlay-Android-1.1.0.apk`.
Requisitos: Android SDK 37, JDK 17 e as ferramentas de build em
`$HOME/Library/Android/sdk`.

## Releases

O workflow em `.github/workflows/release.yml` compila as versões quando uma tag
`v*` é enviada:

```bash
git tag v1.1.0
git push origin v1.1.0
```

Ele também pode ser executado manualmente em **Actions → Release → Run workflow**,
informando a tag. Os arquivos são publicados automaticamente na página de Releases.

## Estrutura

```
DrivePlay/            app nativo macOS (Swift/SwiftUI)
DrivePlayWindows/     app Windows (Electron)
DrivePlayAndroid/     app Android (Java/WebView)
.github/workflows/    build e publicação das releases
```

## Documentação

- [DrivePlay para macOS](DrivePlay/README.md)
- [DrivePlay para Windows](DrivePlayWindows/README.md)
- [DrivePlay para Android](DrivePlayAndroid/README.md)

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
