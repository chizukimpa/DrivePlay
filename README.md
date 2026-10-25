# DrivePlay

> Player de vídeos do Google Drive para macOS, Windows e Android.

## Sobre

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com três versões:

- **macOS e Windows** — app Electron com player nativo (ffmpeg + Chromium) a partir
  da 1.2.0 (`DrivePlayWindows/`). O app Swift 1.1.0 continua no repositório como
  versão anterior (`DrivePlay/`).
- **Android** — app WebView nativo, otimizado para celular e para a tela de capa do
  Galaxy Z Flip 6 via MultiStar (`DrivePlayAndroid/`).

O player nativo toca o **arquivo original do MKV**, com **faixas de áudio** e
**legendas embutidas**, sem instalar codecs. Quando o Drive bloqueia o download do
original, o app cai automaticamente no preview do Drive.

## Funcionalidades

- Reprodução de MKV, AVI e MP4 direto do Google Drive.
- **Player nativo (Windows/macOS)** com faixas de áudio e legendas embutidas,
  estilo de legenda, ±10 s, velocidade, preencher a tela e retomada.
- **Android** com player nativo (ExoPlayer), faixas de áudio, legendas e cache.
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

### Android 1.2.0

O Android deixou de ser só um atalho para o Drive e agora tem a mesma estrutura dos
apps de computador:

- **Início** com continuar assistindo, pastas e vídeos recentes.
- **Biblioteca** de coleções (pastas), com criar, renomear e excluir.
- **Fontes** por coleção: links de vídeo, pastas do Drive e vídeos locais.
- **Pastas do Drive** lidas dentro do app, com ordenação natural de episódios e
  navegação em subpastas.
- **Player próprio** sobre o preview do Drive: barra de progresso, ±10 s, velocidade,
  qualidade, episódio anterior/próximo, preencher a tela e retomada de progresso.
- **Vídeos locais** pelo seletor de arquivos, com registro persistente para reabrir
  pelos recentes. Também aceita `VIEW`/`SEND` de `video/*` de outros apps.
- Progresso e biblioteca gravados no aparelho (SharedPreferences + armazenamento do
  WebView), então nada se perde ao fechar o app.
- Interface em português, tema escuro e layout pensado para a tela de capa.

## Tecnologias

- **macOS e Windows:** Electron, JavaScript, HTML, CSS, ffmpeg e Chromium.
- **Android:** Java, ExoPlayer/Media3, WebView, HTML, CSS e JavaScript.
- **Google Drive:** arquivo original (download direto) com fallback para o preview.
- **GitHub Actions:** build e publicação das releases.

## Download e acesso

Baixe a versão mais recente na página de
**[Releases](https://github.com/chizukimpa/DrivePlay/releases/latest)**:

| Sistema | Arquivo | Observação |
| --- | --- | --- |
| Windows | `DrivePlay-Setup-1.2.0-x64.exe` | Instalador (recomendado). |
| Windows | `DrivePlay-Portable-1.2.0-x64.exe` | Portátil em um arquivo. |
| Windows | `DrivePlay-1.2.0-win32-x64-portable.zip` | Pasta portátil. |
| macOS | `DrivePlay-macOS-universal-1.2.0.zip` | App universal (Intel e Apple Silicon), macOS 14+, com player nativo. |
| Android | `DrivePlay-Android-1.2.0.apk` | Android 7+; biblioteca, pastas e player próprios, com tela de capa via MultiStar. |

Os builds não têm assinatura digital paga. No Windows, o SmartScreen pode pedir
**Mais informações → Executar assim mesmo**. No macOS, clique com o botão direito no
app → **Abrir** na primeira execução. No Android, permita a instalação de apps de
fontes desconhecidas para o APK.

### Android e tela de capa

O app já abre na biblioteca, sem passar pelo site do Drive. Para usar na tela de capa
do Galaxy Z Flip 6:

1. Ative o **MultiStar** (Good Lock) e permita o app na tela de capa.
2. Abra o DrivePlay pela tela de capa.
3. Escolha uma coleção ou pasta. Na capa, o player esconde velocidade, qualidade e
   Chrome da barra inferior (ficam no menu) e mantém anterior/próximo, −10 s, play e
   +10 s.
4. Ative **Preencher a tela** nos ajustes ou no menu do player para remover as faixas
   pretas.

O login do Google pode ser bloqueado dentro do WebView. Nesse caso, use um link
público/compartilhado ou abra o arquivo pelo Chrome; o DrivePlay mantém o fallback
para o navegador. Arquivos privados que já abrem no Chrome normalmente também abrem no
preview do Drive dentro do app.

## Como rodar

### macOS

```bash
cd DrivePlayWindows
npm install
npm run dist:mac
```

O app universal fica em `DrivePlayWindows/dist/DrivePlay-macOS-universal-*.zip`.
Requisitos: macOS 14+, Node.js 22+ e o ffmpeg em `tools/ffmpeg/darwin-x64/`
(`./scripts/fetch-ffmpeg.sh`).

O app Swift da versão 1.1.0 continua disponível em `DrivePlay/`:

```bash
cd DrivePlay
./build-universal.sh
```

### Windows

```bat
cd DrivePlayWindows
npm install
scripts\fetch-ffmpeg.sh
npm start
npm run dist:win
```

Os instaladores ficam em `DrivePlayWindows/dist`. Requisitos: Windows 10/11 64 bits,
Node.js 22+ e o ffmpeg em `tools/ffmpeg/win32-x64/`.

### Android

```bash
cd DrivePlayAndroid
./build-android.sh
```

O APK assinado fica em `DrivePlayAndroid/build/DrivePlay-Android-1.2.0.apk`.
Requisitos: Android SDK 37, JDK 17 e as ferramentas de build em
`$HOME/Library/Android/sdk`.

## Releases

### 1.2.0 — Android, Windows e macOS

- **Windows/macOS:** player nativo (ffmpeg + Chromium) com MKV original, faixas de
  áudio, legendas embutidas e estilo de legenda; abertura/encerramento automáticos
  em 120 s/190 s; fallback para o preview quando o Drive limita o download.
- **Android 1.2.0:** biblioteca, coleções, pastas do Drive, player próprio e
  suporte a vídeos locais.
- A próxima versão do Android (1.3.0) traz o player nativo com faixas e legendas,
  numeração absoluta dos episódios, correções de troca de tela e o menu de ações
  por episódio.

### 1.1.0 — macOS, Windows e Android

Preencher a tela, tela cheia automática, pulos de 120 s/190 s e a primeira versão
Android.

O workflow em `.github/workflows/release.yml` compila as versões quando uma tag
`v*` é enviada:

```bash
git tag v1.2.0
git push origin v1.2.0
```

Ele também pode ser executado manualmente em **Actions → Release → Run workflow**,
informando a tag. Os arquivos são publicados automaticamente na página de Releases.

## Estrutura

```
DrivePlay/            app macOS Swift (legado da 1.1.0)
DrivePlayWindows/     app Electron para Windows e macOS (player nativo)
DrivePlayAndroid/     app Android (Java/WebView)
.github/workflows/    build e publicação das releases
```

## Documentação

- [DrivePlay para macOS](DrivePlay/README.md)
- [DrivePlay para Windows](DrivePlayWindows/README.md)
- [DrivePlay para Android](DrivePlayAndroid/README.md)

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
