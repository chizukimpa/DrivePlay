# DrivePlay

> Player de vídeos do Google Drive para macOS, Windows, Linux e Android.

## Sobre

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com quatro versões:

- **macOS, Windows e Linux** — app Electron com player nativo (ffmpeg + Chromium) a
  partir da 1.4.0 (`DrivePlayWindows/`). No Linux há pacotes **rpm (Fedora)**, **deb**
  (Debian/Ubuntu) e **AppImage** (qualquer distro). O app Swift 1.1.0 continua no
  repositório como versão anterior (`DrivePlay/`).
- **Android** — app WebView nativo, otimizado para celular e para a tela de capa do
  Galaxy Z Flip 6 via MultiStar (`DrivePlayAndroid/`), na versão 1.3.3.

O player nativo toca o **arquivo original do MKV**, com **faixas de áudio** e
**legendas embutidas**, sem instalar codecs. Quando o Drive bloqueia o download do
original, o app cai automaticamente no preview do Drive.

## Funcionalidades

- Reprodução de MKV, AVI e MP4 direto do Google Drive.
- **Player nativo (Windows/macOS/Linux)** com faixas de áudio e legendas embutidas,
  estilo de legenda, ±10 s, velocidade, preencher a tela e retomada.
- **Android** com player nativo (ExoPlayer), faixas de áudio, legendas e cache.
- **Chave da API do Drive** (opcional) para liberar o arquivo original quando a cota
  anônima do Google bloqueia o download.
- Navegação por pastas e subpastas, com busca e miniaturas.
- Episódio anterior/próximo e progresso por episódio.
- Pular abertura em **120 s** e encerramento em **190 s** por padrão, com opções de
  pulo automático, avanço automático, retomada e marcação de assistidos.
- **Tela cheia automática** após 4 segundos sem atividade, mostrando apenas o vídeo.
- **Preencher a tela**: amplia e corta as bordas do vídeo para ocupar toda a tela
  (útil em telas largas e na tela de capa do Z Flip 6).
- Biblioteca persistente de coleções e temporadas, com gerenciamento de fontes.
- Menu de contexto para reproduzir, marcar como assistido, resetar progresso, abrir no
  VLC, baixar, compartilhar e copiar links.
- Download do arquivo original e abertura do stream no VLC.
- Sessão persistente do Google para arquivos privados.

### Android 1.3.3

O Android tem a mesma estrutura dos apps de computador:

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
- A 1.3.3 corrige o **próximo episódio** no player nativo: o botão de avançar e o
  avanço automático (fim do vídeo ou pulo do encerramento) carregam o próximo item da
  playlist; o botão de episódio anterior também foi ligado.
- A 1.3.2 mantém a aba ao trocar entre a tela interna e a capa, aplica a densidade do
  painel atual e evita relançar a tela ao trocar de painel.

## Tecnologias

- **macOS, Windows e Linux:** Electron, JavaScript, HTML, CSS, ffmpeg e Chromium.
- **Android:** Java, ExoPlayer/Media3, WebView, HTML, CSS e JavaScript.
- **Google Drive:** arquivo original (download direto) com fallback para o preview.
- **GitHub Actions:** build e publicação das releases.

## Download e acesso

Baixe a versão mais recente na página de
**[Releases](https://github.com/chizukimpa/DrivePlay/releases/latest)**:

| Sistema | Arquivo | Observação |
| --- | --- | --- |
| Windows | `DrivePlay-Setup-1.4.1-x64.exe` | Instalador (recomendado). |
| Windows | `DrivePlay-Portable-1.4.1-x64.exe` | Portátil em um arquivo. |
| Windows | `DrivePlay-1.4.1-win32-x64-portable.zip` | Pasta portátil. |
| macOS | `DrivePlay-macOS-universal-1.4.1.zip` | App universal (Intel e Apple Silicon), macOS 14+, com player nativo. |
| Linux (Fedora) | `DrivePlay-Linux-1.4.1-x86_64.rpm` | Fedora 39+ (x86_64), com player nativo e ffmpeg incluído. |
| Linux (Debian/Ubuntu) | `DrivePlay-Linux-1.4.1-amd64.deb` | Debian 12+ / Ubuntu 22.04+, com player nativo e ffmpeg incluído. |
| Linux (geral) | `DrivePlay-Linux-1.4.1-x86_64.AppImage` | Qualquer distro x86_64; não precisa instalar. |
| Android | `DrivePlay-Android-1.3.3.apk` | Android 7+; biblioteca, pastas e player próprios, com tela de capa via MultiStar. |

Os builds não têm assinatura digital paga. No Windows, o SmartScreen pode pedir
**Mais informações → Executar assim mesmo**. No macOS, clique com o botão direito no
app → **Abrir** na primeira execução. No Linux, os pacotes são gerados sem chave GPG:
se o gerenciador pedir confirmação, aceite a instalação do pacote local. No Android,
permita a instalação de apps de fontes desconhecidas para o APK.

### Linux (Fedora, Debian/Ubuntu e AppImage)

Fedora 39 ou mais recente (x86_64):

```bash
sudo dnf install ./DrivePlay-Linux-1.4.1-x86_64.rpm
```

Debian/Ubuntu:

```bash
sudo apt install ./DrivePlay-Linux-1.4.1-amd64.deb
```

AppImage (sem instalar; funciona em Fedora, Debian, Ubuntu, Arch e outras distros):

```bash
chmod +x DrivePlay-Linux-1.4.1-x86_64.AppImage
./DrivePlay-Linux-1.4.1-x86_64.AppImage
```

O app usa a moldura nativa do GNOME/KDE, Wayland ou X11 (detecção automática) e grava
os dados em `~/.config/DrivePlay`. O ffmpeg do player nativo já vai dentro do pacote,
então não é preciso instalar codecs.

Para abrir o vídeo original em outro player, instale o VLC pelo RPM Fusion
(`sudo dnf install vlc`) ou pelo Flatpak
(`flatpak install flathub org.videolan.VLC`). O DrivePlay encontra os dois.

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

### Chave da API do Drive (opcional)

Quando o Google limita o download anônimo de um arquivo, o app usa o preview (uma
faixa de áudio, sem legendas). Para voltar a tocar o arquivo original, crie uma
chave da API no Google Cloud:

1. Abra https://console.cloud.google.com/apis/credentials.
2. Crie um projeto e ative a **Google Drive API** (APIs e serviços → Biblioteca).
3. Em **Credenciais**, crie uma **Chave de API**.
4. No app Android: **Ajustes → Chave da API do Drive** e salve.
   No desktop: **Ctrl+, → Google Drive → Chave da API do Drive**.
5. Abra o vídeo novamente. O player nativo volta a mostrar as faixas de áudio e as
   legendas embutidas.

A chave usa a cota do seu projeto, separada da cota anônima do site, e é gratuita
para uso pessoal. A pasta precisa estar compartilhada como “qualquer pessoa com o
link”.

### macOS

```bash
cd DrivePlayWindows
npm install
./scripts/fetch-ffmpeg.sh
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

### Linux (Fedora)

```bash
cd DrivePlayWindows
npm install
./scripts/fetch-ffmpeg.sh
npm start
npm run dist:linux
npm run dist:linux:rpm
```

`npm run dist:linux` gera o AppImage, o `.deb` e o `.rpm` em `DrivePlayWindows/dist`.
Requisitos: Fedora 39+ x86_64, Node.js 22+, `rpm-build` e `xz`
(`sudo dnf install -y rpm-build xz`) e o ffmpeg em `tools/ffmpeg/linux-x64/`.
Em Debian/Ubuntu, instale o `rpm` (`sudo apt install -y rpm`) para gerar o pacote
Fedora.

### Android

```bash
cd DrivePlayAndroid
./build-android.sh
```

O APK assinado fica em `DrivePlayAndroid/build/DrivePlay-Android-1.3.3.apk`.
Requisitos: Android SDK 37, JDK 17 e as ferramentas de build em
`$HOME/Library/Android/sdk`.

## Releases

### 1.4.1 — correção do carregamento infinito

- Corrige o player nativo que ficava **carregando para sempre** em episódios grandes
  do Google Drive (MKV de 1080p, cerca de 900 MB a 1,2 GB).
- O streaming do proxy agora usa o `fetch` do Node em vez do `session.fetch` do
  Chromium. O network service do Chromium estava caindo ao abrir várias faixas
  grandes ao mesmo tempo, e as requisições seguintes ficavam penduradas.
- As conexões com o Drive são canceladas assim que o ffmpeg ou o Chromium terminam
  de ler cada trecho, liberando o pool para o próximo range.
- Se o player nativo não conseguir abrir o vídeo em 20 s, ele cai automaticamente no
  player do Drive em vez de continuar carregando.
- Windows, macOS e Linux recebem a mesma correção; o Android está na 1.3.3.

### 1.3.3 — Android

- Corrige o **próximo episódio** no player nativo: o botão de avançar e o avanço
  automático (fim do vídeo ou pulo do encerramento) agora carregam o próximo item da
  playlist.
- O botão de episódio anterior também foi ligado.
- O resto das funções da 1.3.2 continua igual.

### 1.4.0 — Linux, Windows e macOS

- **Linux:** primeira versão estável do app Electron, com as mesmas funções do
  Windows e do macOS: player nativo com ffmpeg, faixas de áudio, legendas embutidas,
  tela cheia automática, preencher a tela, biblioteca, downloads e VLC.
- **Fedora:** pacote `.rpm` para x86_64, além de `.deb` e `.AppImage` para as demais
  distros.
- **Wayland e X11:** detecção automática, com a moldura nativa do GNOME/KDE.
- **VLC:** procura o VLC do sistema e o Flatpak (`org.videolan.VLC`).
- **Windows e macOS:** rebuild na 1.4.0 com o mesmo código do player e as correções
  de plataforma.
- **Android:** segue na 1.3.2.

### 1.3.2 — Android

- Início, Pastas e Ajustes voltam para a aba em que você estava ao trocar entre a tela
  interna e a capa.
- Ícones e layout usam a densidade do painel atual depois de trocar de tela.
- O app não relança mais a tela ao trocar de painel, o que evita o bloqueio dos itens
  recentes.

### 1.3.0 — macOS, Windows e Android

- Player nativo (ffmpeg + Chromium) com MKV original, faixas de áudio, legendas
  embutidas e estilo de legenda; abertura/encerramento automáticos em 120 s/190 s;
  fallback para o preview quando o Drive limita o download.
- macOS: tela cheia automática em 4 s e pinça no trackpad.
- Android 1.3.0: biblioteca, coleções, pastas do Drive, player próprio e suporte a
  vídeos locais.

### 1.2.0 — Android, Windows e macOS

- Primeira versão Electron para Windows e macOS com player nativo e legendas.
- A primeira versão Android com biblioteca, coleções, pastas e player próprios.

O workflow em `.github/workflows/release.yml` compila as versões quando uma tag
`v*` é enviada:

```bash
git tag v1.4.1
git push origin v1.4.1
```

Ele também pode ser executado manualmente em **Actions → Release → Run workflow**,
informando a tag. Os arquivos são publicados automaticamente na página de Releases.

## Estrutura

```
DrivePlay/            app macOS Swift (legado da 1.1.0)
DrivePlayWindows/     app Electron para Windows, macOS e Linux (player nativo)
DrivePlayAndroid/     app Android (Java/WebView)
.github/workflows/    build e publicação das releases
```

## Documentação

- [DrivePlay para macOS](DrivePlay/README.md)
- [DrivePlay para Windows, macOS e Linux](DrivePlayWindows/README.md)
- [DrivePlay para Android](DrivePlayAndroid/README.md)

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
