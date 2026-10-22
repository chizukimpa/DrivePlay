# DrivePlay

> Player de vídeos do Google Drive para macOS e Windows.

## Sobre

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com duas versões:

- **macOS** — app nativo em Swift (`DrivePlay/`).
- **Windows** — app Electron com a mesma interface e funções (`DrivePlayWindows/`).

O Google Drive transcodifica o vídeo no servidor, então **MKV funciona sem instalar
codecs ou converter nada**. Para legendas embutidas, faixas de áudio e qualidade
original, use **Abrir no VLC**.

## Funcionalidades

- Reprodução de MKV, AVI e MP4 direto do Google Drive.
- Navegação por pastas e subpastas, com busca e miniaturas.
- Episódio anterior/próximo e progresso por episódio.
- Pular abertura e encerramento, com opções de pulo automático, avanço automático,
  retomada e marcação de assistidos.
- Biblioteca persistente de coleções e temporadas, com gerenciamento de fontes.
- Menu de contexto para reproduzir, marcar como assistido, resetar progresso, abrir no
  VLC, baixar, compartilhar e copiar links.
- Download do arquivo original e abertura do stream no VLC.
- Sessão persistente do Google para arquivos privados.

## Tecnologias

- **macOS:** Swift, SwiftUI e WKWebView.
- **Windows:** Electron, JavaScript, HTML e CSS.
- **Google Drive:** player/preview e transcodificação no servidor.
- **VLC:** reprodução local opcional.
- **GitHub Actions:** build e publicação das releases.

## Download e acesso

Baixe a versão mais recente na página de
**[Releases](https://github.com/chizukimpa/DrivePlay/releases/latest)**:

| Sistema | Arquivo | Observação |
| --- | --- | --- |
| Windows | `DrivePlay-Setup-1.0.0-x64.exe` | Instalador (recomendado). |
| Windows | `DrivePlay-Portable-1.0.0-x64.exe` | Portátil em um arquivo. |
| Windows | `DrivePlay-1.0.0-win32-x64-portable.zip` | Pasta portátil. |
| macOS | `DrivePlay-macOS-universal.zip` | App universal (Intel e Apple Silicon), macOS 14+. |

Os builds não têm assinatura digital paga. No Windows, o SmartScreen pode pedir
**Mais informações → Executar assim mesmo**. No macOS, clique com o botão direito no
app → **Abrir** na primeira execução.

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

## Releases

O workflow em `.github/workflows/release.yml` compila as duas versões quando uma tag
`v*` é enviada:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Ele também pode ser executado manualmente em **Actions → Release → Run workflow**,
informando a tag. Os arquivos são publicados automaticamente na página de Releases.

## Estrutura

```
DrivePlay/            app nativo macOS (Swift/SwiftUI)
DrivePlayWindows/     app Windows (Electron)
.github/workflows/    build e publicação das releases
```

## Documentação

- [DrivePlay para macOS](DrivePlay/README.md)
- [DrivePlay para Windows](DrivePlayWindows/README.md)

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
