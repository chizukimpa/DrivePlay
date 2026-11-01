# DrivePlay para Windows, macOS e Linux

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com a mesma
interface e as mesmas funções nas três plataformas.

Você cola o link de uma pasta ou de um vídeo e o conteúdo toca dentro do app, com
player próprio: **MKV toca direto**, inclusive com as **faixas de áudio** e as
**legendas embutidas**. Não é preciso instalar codecs nem converter nada. Se o
arquivo usar um codec que o player integrado não decodifica, o app abre
automaticamente o preview do Google Drive.

## Requisitos

- **Windows 10 ou 11**, 64 bits.
- **macOS 14 ou mais recente**, Intel ou Apple Silicon.
- **Linux x86_64** (Fedora 39+, Debian 12+, Ubuntu 22.04+ ou qualquer distro com
  AppImage), Wayland ou X11.
- VLC instalado (opcional; só para abrir o arquivo original em outro player).
- Conexão com a internet.

O ffmpeg do player nativo vai incluído no pacote. No Linux, o app usa a moldura
nativa do GNOME/KDE e grava os dados em `~/.config/DrivePlay`.

## Baixar e instalar

Na página de **Releases** do GitHub:

| Sistema | Arquivo | Como usar |
| --- | --- | --- |
| Windows | `DrivePlay-Setup-1.4.1-x64.exe` | **Instalador.** Instala em `Arquivos de Programas`, cria atalhos na área de trabalho e no menu Iniciar. Os dados ficam em `%APPDATA%\DrivePlay`. |
| Windows | `DrivePlay-Portable-1.4.1-x64.exe` | **Portátil em um único arquivo.** Não instala nada. Os dados ficam em `DrivePlayData` ao lado do `.exe`. |
| Windows | `DrivePlay-1.4.1-win32-x64-portable.zip` | **Pasta portátil.** Extraia e execute `DrivePlay.exe`. Os dados ficam em `DrivePlayData` dentro da pasta. |
| macOS | `DrivePlay-macOS-universal-1.4.1.zip` | **App universal.** Extraia e arraste o `DrivePlay.app` para `Aplicativos`. |
| Linux (Fedora) | `DrivePlay-Linux-1.4.1-x86_64.rpm` | `sudo dnf install ./DrivePlay-Linux-1.4.1-x86_64.rpm` |
| Linux (Debian/Ubuntu) | `DrivePlay-Linux-1.4.1-amd64.deb` | `sudo apt install ./DrivePlay-Linux-1.4.1-amd64.deb` |
| Linux (geral) | `DrivePlay-Linux-1.4.1-x86_64.AppImage` | `chmod +x` e execute. Não precisa instalar. |

> O app ainda não tem assinatura digital paga. Na primeira execução o Windows pode
> mostrar o **SmartScreen**: clique em **Mais informações → Executar assim mesmo**.
> No macOS, clique com o botão direito no app → **Abrir**. No Linux, confirme a
> instalação do pacote local quando o gerenciador avisar que ele não tem assinatura
> GPG. Isso é esperado para builds não assinados.

### Fedora

```bash
sudo dnf install ./DrivePlay-Linux-1.4.1-x86_64.rpm
```

Se preferir o VLC pelo Flatpak (comum no Fedora):

```bash
flatpak install flathub org.videolan.VLC
```

O DrivePlay encontra tanto o VLC do sistema (`/usr/bin/vlc`) quanto o Flatpak
(`org.videolan.VLC`).

## Usar

1. No Google Drive, compartilhe o **vídeo** ou a **pasta** com
   **Qualquer pessoa com o link** → **Copiar link**.
2. Abra o DrivePlay, cole o link no campo superior e clique em **Abrir**
   (ou use `Ctrl+Shift+V` / `Cmd+Shift+V` para colar e reproduzir na hora).
3. Se for uma pasta, a lista de episódios aparece ao lado; clique em um episódio
   para tocar.

O app lembra a última pasta e o último episódio: ao abrir de novo, ele volta para a
lista e retoma o episódio de onde você parou.

### Biblioteca de coleções

O botão **Biblioteca** (ou `Ctrl+B` / `Cmd+B`) abre uma biblioteca local de links.
É ali que você junta várias temporadas de um anime em uma única lista:

1. Clique em **Biblioteca** e escolha uma coleção (a padrão se chama
   **Minha biblioteca**; use **+** para criar outras, por exemplo “Bleach”).
2. Clique no **+** ao lado do nome da coleção e cole o link de uma pasta de
   temporada (ou de um vídeo). Repita para as outras temporadas.
3. Os episódios são unidos e ordenados por temporada/episódio, mesmo que as pastas
   tenham sido adicionadas fora de ordem: `S04E01…S04E28` → `S05E01…S05E18`.

Também dá para adicionar a pasta que está aberta: no cabeçalho da lista, clique no
ícone de **favorito** (ou use **Adicionar à biblioteca** na tela inicial da pasta) e
escolha a coleção.

Em **Gerenciar fontes** você vê as pastas/arquivos de cada coleção, remove uma fonte,
atualiza a lista para pegar episódios novos e **move** a fonte para outra coleção.
Nada é apagado do Google Drive: a biblioteca guarda apenas os links e os nomes dos
episódios.

Para levar a biblioteca entre computadores, feche os dois apps e copie o arquivo
`library.json` de:

- Windows instalado: `%APPDATA%\DrivePlay\library.json`
- Windows portátil: `DrivePlayData\library.json` ao lado do `DrivePlay.exe`
- macOS: `~/Library/Application Support/DrivePlay/library.json`
- Linux: `~/.config/DrivePlay/library.json`

O app aceita o formato antigo (lista) e o novo (coleções).

### Pastas e episódios

Ao abrir o link de uma pasta compartilhada, o app lista os vídeos com miniatura, nome
e data. A lista tem busca, navegação por subpastas (com botão de voltar) e mostra o
progresso de cada episódio:

- **✓** no canto da miniatura: episódio já assistido.
- **Barra colorida** na base da miniatura: quanto do episódio você já assistiu.

Use o botão de lista no rodapé (ou o cabeçalho) para mostrar/ocultar a lista, e
`Ctrl+←` / `Ctrl+→` (ou `Cmd+←` / `Cmd+→` no macOS) para voltar/avançar de episódio.

### Player integrado (MKV, áudio e legendas)

Ao abrir um vídeo, o app reproduz o **arquivo original do Drive** com um player
próprio em tela cheia:

- **Um clique** mostra os controles; outro clique esconde.
- Barra de progresso arrastável, **−10 s / +10 s**, play/pause e velocidade
  (0,5× a 2×).
- **Episódio anterior/próximo** e **Preencher a tela** (corta as bordas para remover
  as faixas pretas).
- No menu (⋮): **faixa de áudio** e **legendas embutidas** do MKV.
- **Estilo da legenda**: tamanho, cor (branco, amarelo ou ciano), contorno, fonte e
  fundo.
- **Abertura automática** e **encerramento automático** com os tempos padrão de
  **120 s** e **190 s**.
- **Abrir no Chrome** e **Fechar player**.

A primeira troca para uma faixa de áudio ou legenda alternativa prepara a faixa com
o ffmpeg incluído no app; isso leva alguns segundos e fica em cache. A faixa
principal toca imediatamente.

Se o Google Drive bloquear o download do arquivo original (limite de downloads) ou o
codec não for compatível, o app avisa e abre automaticamente o **player do Drive**,
que transcodifica no servidor. Nesse modo há uma faixa de áudio e não há legendas
embutidas; entrar na conta Google no player costuma liberar o arquivo original.

### Menu de botão direito

Clique com o botão direito em um episódio (na pasta ou na biblioteca) para acessar:

- **Reproduzir**
- **Marcar como assistido** / **Marcar como não assistido** (remove o ✓, mantendo
  onde você parou)
- **Resetar progresso** (zera o tempo assistido e o ✓)
- **Abrir no VLC**
- **Baixar**
- **Compartilhar…** (copiar link, e-mail, WhatsApp, Telegram, X ou navegador)
- **Abrir no navegador**
- **Copiar link de compartilhamento** / **Copiar link direto**
- **Gerenciar fontes…** (na biblioteca)

Em uma pasta, o botão direito também copia ou compartilha o link da pasta.

### Pular abertura e encerramento

Durante a reprodução aparecem botões sobre o vídeo:

- **Pular abertura** — aparece no começo do episódio.
- **Pular encerramento** — aparece nos minutos finais e já passa para o próximo.

No menu (⋮) do player você liga ou desliga o pulo automático:

- Pular abertura automaticamente (duração padrão: 120 s).
- Pular encerramento automaticamente (padrão: últimos 190 s).
- Avançar para o próximo episódio ao terminar (ligado por padrão).
- Retomar de onde parou (ligado por padrão).

As escolhas ficam salvas. O pulo automático começa **desligado** — ative quando
quiser.

### Botões do rodapé

O rodapé aparece no modo de compatibilidade (preview do Drive). No player integrado,
os controles ficam dentro do próprio vídeo e o rodapé fica oculto.

| Botão | O que faz |
| --- | --- |
| Lista | Mostra/oculta a lista de episódios. |
| ‹ / › | Episódio anterior / próximo. |
| Pular | Abre as opções de pulo de abertura/encerramento. |
| Download | Baixa o vídeo original para a pasta `Downloads`. |
| VLC | Abre o stream direto no VLC (legendas e qualidade original). |
| Navegador | Abre o arquivo no Google Drive no navegador. |
| Copiar | Copia o link de compartilhamento. |
| Recarregar | Recarrega o player. |
| Tela cheia | Entra/sai da tela cheia (`F11`). |

### Atalhos

No macOS, use `Cmd` no lugar de `Ctrl`. A tela cheia é `Ctrl+Cmd+F` no macOS e
`F11` no Windows/Linux.

| Atalho | Ação |
| --- | --- |
| `Ctrl+Shift+V` | Colar link e reproduzir |
| `Ctrl+B` | Abrir/fechar a biblioteca |
| `Ctrl+←` / `Ctrl+→` | Episódio anterior / próximo |
| `Ctrl+Shift+O` | Abrir no VLC |
| `Ctrl+R` | Recarregar o player |
| `Ctrl+,` | Configurações de reprodução |
| `F11` | Tela cheia |
| `F1` | Como usar |
| `Esc` | Fechar menus/janelas |

## Google Drive: login e limites

O player usa uma sessão persistente do Google dentro do app. Se o Drive pedir login,
entre na sua conta pelo menu **Arquivo → Entrar na conta Google…**; a sessão fica
salva para as próximas vezes e libera o arquivo original (com todas as faixas e
legendas) quando o download anônimo está limitado.

Se o Google bloquear o login no navegador embutido, use a **chave da API do Drive**:
em **Ctrl+, → Google Drive → Chave da API do Drive**, cole uma chave criada em
`https://console.cloud.google.com/apis/credentials` com a **Google Drive API**
ativada. A chave usa a cota do seu projeto, separada da cota anônima do site.

O player integrado pede ao Drive o **arquivo original** (com todas as faixas). Se o
Drive responder com a página de **“Limite ultrapassado”**, o app não insiste: abre o
preview do Drive e avisa. Nesse modo o Google transcodifica o vídeo no servidor, com
uma faixa de áudio e sem legendas embutidas.

Para arquivos privados, o player nativo, o download e o VLC usam a mesma sessão. Para
arquivos públicos, tudo funciona sem login (sujeito ao limite de downloads do Google).

## VLC

O botão **Abrir no VLC** procura o VLC nos caminhos padrão de cada sistema:

- **Windows:** `C:\Program Files\VideoLAN\VLC\vlc.exe`,
  `C:\Program Files (x86)\VideoLAN\VLC\vlc.exe`,
  `%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe` e o comando `vlc` no `PATH`.
- **macOS:** `/Applications/VLC.app/Contents/MacOS/VLC` e
  `~/Applications/VLC.app/Contents/MacOS/VLC`.
- **Linux:** `/usr/bin/vlc`, `/usr/local/bin/vlc`, `/snap/bin/vlc`,
  `/var/lib/flatpak/exports/bin/org.videolan.VLC`,
  `~/.local/share/flatpak/exports/bin/org.videolan.VLC` e o comando `vlc` no `PATH`.

Se não encontrar, o app oferece a página de download do VLC. O player integrado já
toca MKV com faixas de áudio e legendas embutidas; o VLC fica como opção para abrir o
arquivo original em outro programa.

## Compilar

Requisitos: Node.js 22 ou mais recente e npm. O player integrado usa um binário do
ffmpeg em `tools/ffmpeg/<plataforma>/` (não versionado no Git).

```bash
cd DrivePlayWindows
npm install
./scripts/fetch-ffmpeg.sh
npm start
```

### Windows

```bat
npm run dist:win
```

Isso gera, em `dist`:

- `DrivePlay-Setup-1.4.1-x64.exe` (instalador NSIS)
- `DrivePlay-Portable-1.4.1-x64.exe` (portátil em um arquivo)

Para gerar a pasta portátil com `@electron/packager`:

```bat
npm run pack:win
```

### macOS

```bash
npm run dist:mac
```

Gera o app universal (Intel e Apple Silicon) em
`dist/DrivePlay-macOS-universal-1.4.1.zip`.

### Linux (Fedora)

```bash
sudo dnf install -y rpm-build xz
npm run dist:linux
```

Gera em `dist`:

- `DrivePlay-Linux-1.4.1-x86_64.AppImage`
- `DrivePlay-Linux-1.4.1-amd64.deb`
- `DrivePlay-Linux-1.4.1-x86_64.rpm`

Também é possível gerar um alvo por vez:

```bash
npm run dist:linux:rpm
npm run dist:linux:deb
npm run dist:linux:appimage
```

Em Debian/Ubuntu, instale o `rpm` (`sudo apt install -y rpm`) para gerar o pacote do
Fedora. O ffmpeg é copiado para dentro do app (`Resources/ffmpeg`); para baixar os
binários usados nos builds, rode `./scripts/fetch-ffmpeg.sh` (baixa Windows, macOS
Intel/ARM e Linux x64/ARM64).

O GitHub Actions em `.github/workflows/release.yml` compila automaticamente as
versões do Windows, do macOS e do Linux quando uma tag `v*` é enviada, e publica os
arquivos na página de Releases.

## Estrutura

```
src/
  main.js              janela, IPC e player nativo
  preload.js           API segura do renderer
  player-preload.js    ponte do player (nativo e preview) para o app
  main/
    drive.js           leitura de pastas/títulos do Drive
    desktopMedia.js    resolução do Drive, servidor local e ffmpeg
    store.js           persistência em JSON
    downloads.js       download com progresso
    vlc.js             detecção e abertura do VLC
    menu.js            menu nativo e atalhos
  renderer/
    index.html         shell da interface
    styles.css         tema escuro e layout
    app.js             estado, telas e ações
    drive.js           links, ordenação e formatação
    library.js         coleções e fontes
    store.js           configurações/progresso/recentes
    player.js          webview do player (nativo ou preview)
    native/            player HTML/CSS/JS compartilhado
    icons.js           ícones SVG
```

## Solução de problemas

- **SmartScreen / “O Windows protegeu o computador”** — build sem assinatura; clique
  em **Mais informações → Executar assim mesmo**.
- **macOS bloqueou o app** — clique com o botão direito no `DrivePlay.app` → **Abrir**
  na primeira execução.
- **Linux: instalação do rpm** — builds não são assinados com GPG; confirme a
  instalação do pacote local. Se o AppImage não abrir, verifique `chmod +x` e, em
  distros sem FUSE 2, execute com `--appimage-extract-and-run`.
- **Linux: janela sem o tema certo no Wayland** — o app detecta Wayland/X11
  automaticamente; em GPUs problemáticas, rode com
  `--ozone-platform=x11` para usar XWayland.
- **“Faça login na sua Conta do Google…”** — entre na conta Google na janela do
  player; a sessão fica salva. Alternativamente, baixe o arquivo ou use o VLC.
- **VLC não encontrado** — instale o VLC (no Fedora, RPM Fusion ou Flatpak) ou marque
  “Adicionar ao PATH” na instalação do Windows.
- **“Carregando…” infinito em MKV grande** — corrigido na 1.4.1: o proxy agora usa o
  `fetch` do Node e cancela as conexões antigas com o Drive, e o player cai no preview
  em 20 s se o streaming falhar. Atualize para a 1.4.1.
- **Player em branco** — use **Recarregar** no rodapé ou `Ctrl+R`; verifique a
  conexão.
- **“Limite de downloads” do Drive** — o app cai sozinho no player do Drive. Para usar
  o arquivo original (com todas as faixas e legendas), entre na conta Google no player
  ou copie o arquivo para o seu próprio Drive.
- **Codec não suportado** — o app abre o preview do Drive automaticamente. Para
  imagem e faixas originais, use **Abrir no VLC**, **Baixar** ou **Abrir no
  navegador**.
- **Download não começa** — para arquivos privados, faça login no player; para
  públicos, verifique se o link permite download.

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
