# DrivePlay para Windows

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com a mesma
interface e as mesmas funções do DrivePlay para macOS.

Você cola o link de uma pasta ou de um vídeo e o conteúdo toca dentro do app, com
player próprio: **MKV toca direto**, inclusive com as **faixas de áudio** e as
**legendas embutidas**. Não é preciso instalar codecs nem converter nada. Se o
arquivo usar um codec que o player integrado não decodifica, o app abre
automaticamente o preview do Google Drive.

## Requisitos

- Windows 10 ou 11, 64 bits
- VLC instalado (opcional; só para abrir o arquivo original em outro player) —
  https://www.videolan.org/vlc/download-windows.html
- Conexão com a internet

## Baixar e instalar

Na página de **Releases** do GitHub:

| Arquivo | Como usar |
| --- | --- |
| `DrivePlay-Setup-1.2.0-x64.exe` | **Instalador.** Instala em `Arquivos de Programas`, cria atalhos na área de trabalho e no menu Iniciar. Os dados ficam em `%APPDATA%\DrivePlay`. |
| `DrivePlay-Portable-1.2.0-x64.exe` | **Portátil em um único arquivo.** Não instala nada. Os dados ficam em `DrivePlayData` ao lado do `.exe`. |
| `DrivePlay-1.2.0-win32-x64-portable.zip` | **Pasta portátil.** Extraia e execute `DrivePlay.exe`. Os dados ficam em `DrivePlayData` dentro da pasta. |

> O app ainda não tem assinatura digital paga. Na primeira execução o Windows pode
> mostrar o **SmartScreen**: clique em **Mais informações → Executar assim mesmo**.
> Isso é esperado para builds não assinados.

## Usar

1. No Google Drive, compartilhe o **vídeo** ou a **pasta** com
   **Qualquer pessoa com o link** → **Copiar link**.
2. Abra o DrivePlay, cole o link no campo superior e clique em **Abrir**
   (ou use `Ctrl+Shift+V` para colar e reproduzir na hora).
3. Se for uma pasta, a lista de episódios aparece ao lado; clique em um episódio
   para tocar.

O app lembra a última pasta e o último episódio: ao abrir de novo, ele volta para a
lista e retoma o episódio de onde você parou.

### Biblioteca de coleções

O botão **Biblioteca** (ou `Ctrl+B`) abre uma biblioteca local de links. É ali que
você junta várias temporadas de um anime em uma única lista:

1. Clique em **Biblioteca** e escolha uma coleção (a padrão se chama
   **Minha biblioteca**; use **+** para criar outras, por exemplo “Bleach”).
2. Clique no **+** ao lado do nome da coleção e cole o link de uma pasta de
   temporada (ou de um vídeo). Repita para as outras temporadas.
3. Os episódios são unidos e ordenados por temporada/episódio, mesmo que as pastas
   tenham sido adicionadas fora de ordem: `S04E01…S04E28` → `S05E01…S05E18`.

Também dá para adicionar a pasta que está aberta: no cabeçalho da lista, clique no
ícone de **favorito** (ou use **Adicionar à biblioteca** na tela inicial da pasta)
e escolha a coleção.

Em **Gerenciar fontes** você vê as pastas/arquivos de cada coleção, remove uma fonte,
atualiza a lista para pegar episódios novos e **move** a fonte para outra coleção.
Nada é apagado do Google Drive: a biblioteca guarda apenas os links e os nomes dos
episódios.

Para levar a biblioteca do DrivePlay do macOS para o Windows, feche os dois apps e
copie o arquivo `library.json` de `~/Library/Application Support/DrivePlay/` para:

- instalador: `%APPDATA%\DrivePlay\library.json`
- portátil: `DrivePlayData\library.json` ao lado do `DrivePlay.exe`

O app aceita o formato antigo (lista) e o novo (coleções).

### Pastas e episódios

Ao abrir o link de uma pasta compartilhada, o app lista os vídeos com miniatura,
nome e data. A lista tem busca, navegação por subpastas (com botão de voltar) e
mostra o progresso de cada episódio:

- **✓** no canto da miniatura: episódio já assistido.
- **Barra colorida** na base da miniatura: quanto do episódio você já assistiu.

Use o botão de lista no rodapé (ou o cabeçalho) para mostrar/ocultar a lista, e
`Ctrl+←` / `Ctrl+→` (ou as setas no rodapé) para voltar/avançar de episódio.

### Player integrado (MKV, áudio e legendas)

Ao abrir um vídeo, o app reproduz o **arquivo original do Drive** com um player
próprio em tela cheia:

- **Um clique** mostra os controles; outro clique esconde.
- Barra de progresso arrastável, **−10 s / +10 s**, play/pause e velocidade
  (0,5× a 2×).
- **Episódio anterior/próximo** e **Preencher a tela** (corta as bordas para
  remover as faixas pretas).
- No menu (⋮): **faixa de áudio** e **legendas embutidas** do MKV.
- **Estilo da legenda**: tamanho, cor (branco, amarelo ou ciano), contorno,
  fonte e fundo.
- **Abertura automática** e **encerramento automático** com os tempos padrão de
  **120 s** e **190 s**.
- **Abrir no Chrome** e **Fechar player**.

A primeira troca para uma faixa de áudio ou legenda alternativa prepara a faixa
com o ffmpeg incluído no app; isso leva alguns segundos e fica em cache. A faixa
principal toca imediatamente.

Se o Google Drive bloquear o download do arquivo original (limite de downloads)
ou o codec não for compatível, o app avisa e abre automaticamente o **player do
Drive**, que transcodifica no servidor. Nesse modo há uma faixa de áudio e não há
legendas embutidas; entrar na conta Google no player costuma liberar o arquivo
original.

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

O rodapé aparece no modo de compatibilidade (preview do Drive). No player
integrado, os controles ficam dentro do próprio vídeo e o rodapé fica oculto.

| Botão | O que faz |
| --- | --- |
| Lista | Mostra/oculta a lista de episódios. |
| ‹ / › | Episódio anterior / próximo. |
| Pular | Abre as opções de pulo de abertura/encerramento. |
| Download | Baixa o vídeo original para `Downloads`. |
| VLC | Abre o stream direto no VLC (legendas e qualidade original). |
| Navegador | Abre o arquivo no Google Drive no navegador. |
| Copiar | Copia o link de compartilhamento. |
| Recarregar | Recarrega o player. |
| Tela cheia | Entra/sai da tela cheia (`F11`). |

### Atalhos

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

O player integrado pede ao Drive o **arquivo original** (com todas as faixas). Se o
Drive responder com a página de **“Limite ultrapassado”**, o app não insiste: abre o
preview do Drive e avisa. Nesse modo o Google transcodifica o vídeo no servidor,
com uma faixa de áudio e sem legendas embutidas.

Para arquivos privados, o player nativo, o download e o VLC usam a mesma sessão.
Para arquivos públicos, tudo funciona sem login (sujeito ao limite de downloads do
Google).

## VLC

O botão **Abrir no VLC** procura o VLC nos caminhos padrão do Windows:

- `C:\Program Files\VideoLAN\VLC\vlc.exe`
- `C:\Program Files (x86)\VideoLAN\VLC\vlc.exe`
- `%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe`
- onde o comando `vlc` estiver no `PATH`

Se não encontrar, o app oferece a página de download do VLC. O player integrado
já toca MKV com faixas de áudio e legendas embutidas; o VLC fica como opção para
abrir o arquivo original em outro programa.

## Compilar

Requisitos: Node.js 22 ou mais recente e npm. O player integrado usa um binário
do ffmpeg em `tools/ffmpeg/<plataforma>/` (não versionado no Git).

```bat
cd DrivePlayWindows
npm install
npm start
```

Para gerar os executáveis no Windows:

```bat
npm run dist:win
```

Isso gera, em `dist`:

- `DrivePlay-Setup-1.2.0-x64.exe` (instalador NSIS)
- `DrivePlay-Portable-1.2.0-x64.exe` (portátil em um arquivo)

Para gerar a pasta portátil com `@electron/packager`:

```bat
npm run pack:win
```

Para gerar o app universal do macOS (Intel e Apple Silicon):

```bash
npm run dist:mac
```

O ffmpeg é copiado para dentro do app (`Resources/ffmpeg`). Para baixar os
binários usados nos builds, rode `./scripts/fetch-ffmpeg.sh`.

O GitHub Actions em `.github/workflows/release.yml` compila automaticamente as
versões do Windows e do macOS quando uma tag `v*` é enviada, e publica os arquivos
na página de Releases.

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

- **SmartScreen / “O Windows protegeu o computador”** — build sem assinatura;
  clique em **Mais informações → Executar assim mesmo**.
- **“Faça login na sua Conta do Google…”** — entre na conta Google na janela do
  player; a sessão fica salva. Alternativamente, baixe o arquivo ou use o VLC.
- **VLC não encontrado** — instale o VLC ou marque “Adicionar ao PATH” na instalação.
- **Player em branco** — use **Recarregar** no rodapé ou `Ctrl+R`; verifique a conexão.
- **“Limite de downloads” do Drive** — o app cai sozinho no player do Drive. Para
  usar o arquivo original (com todas as faixas e legendas), entre na conta Google no
  player ou copie o arquivo para o seu próprio Drive.
- **Codec não suportado** — o app abre o preview do Drive automaticamente. Para
  imagem e faixas originais, use **Abrir no VLC**, **Baixar** ou **Abrir no navegador**.
- **Download não começa** — para arquivos privados, faça login no player; para
  públicos, verifique se o link permite download.

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
