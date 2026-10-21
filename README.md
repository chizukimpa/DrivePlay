# DrivePlay

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com duas versões:

- **macOS** — app nativo em Swift (`DrivePlay/`).
- **Windows** — app Electron com a mesma interface e funções (`DrivePlayWindows/`).

O Google Drive transcodifica o vídeo no servidor, então **MKV funciona sem instalar
codecs ou converter nada**. Para legendas embutidas, faixas de áudio e qualidade
original, use **Abrir no VLC**.

## Baixar

Baixe a versão mais recente na página de **Releases** do GitHub:

| Sistema | Arquivo | Observação |
| --- | --- | --- |
| Windows | `DrivePlay-Setup-1.0.0-x64.exe` | Instalador (recomendado). |
| Windows | `DrivePlay-Portable-1.0.0-x64.exe` | Portátil em um arquivo. |
| Windows | `DrivePlay-1.0.0-win32-x64-portable.zip` | Pasta portátil. |
| macOS | `DrivePlay-macOS-universal.zip` | App universal (Intel e Apple Silicon), macOS 14+. |

Os builds não têm assinatura digital paga. No Windows, o SmartScreen pode pedir
**Mais informações → Executar assim mesmo**. No macOS, clique com o botão direito no
app → **Abrir** na primeira execução.

## Documentação

- [DrivePlay para macOS](DrivePlay/README.md)
- [DrivePlay para Windows](DrivePlayWindows/README.md)

## Compilar

### macOS

```bash
cd DrivePlay
./build.sh
open build/DrivePlay.app
```

Para gerar um binário universal (Intel + Apple Silicon):

```bash
cd DrivePlay
./build-universal.sh
```

### Windows

```bat
cd DrivePlayWindows
npm install
npm start
npm run dist:win
```

Os instaladores ficam em `DrivePlayWindows/dist`.

## Releases automáticas

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

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
