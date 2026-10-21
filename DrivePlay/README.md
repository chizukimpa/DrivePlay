# DrivePlay

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, feito para macOS.

Você cola o link de compartilhamento e o vídeo toca dentro do app. Como o Google Drive
transcodifica o vídeo no servidor, **MKV funciona sem instalar codecs ou converter nada**.
Para legendas embutidas, faixas de áudio e qualidade original, um clique abre o stream
direto no **VLC**.

## Requisitos

- macOS 14 (Sonoma) ou mais recente
- VLC instalado (opcional, recomendado para MKV) — https://www.videolan.org/vlc/download-macosx.html

## Compilar

```bash
cd DrivePlay
./build.sh
```

O app fica em `build/DrivePlay.app`. Para abrir:

```bash
open build/DrivePlay.app
```

Para instalar em Aplicativos:

```bash
./build.sh --install
```

Ou simplesmente arraste `build/DrivePlay.app` para a pasta **Aplicativos**.

## Usar

1. No Google Drive, compartilhe o **vídeo** ou a **pasta** com
   **Qualquer pessoa com o link** → **Copiar link**.
2. Abra o DrivePlay, cole o link no campo superior e clique em **Abrir**
   (ou use `⇧⌘V` para colar e reproduzir na hora).
3. Se for uma pasta, a lista de episódios aparece ao lado; clique em um episódio
   para tocar.

O app lembra a última pasta e o último episódio: ao abrir de novo, ele volta para a
lista e retoma o episódio de onde você parou.

### Biblioteca de coleções

O botão **Biblioteca** (ou `⌘B`) abre uma biblioteca local de links. É ali que você
junta várias temporadas de um anime em uma única lista:

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

### Pastas e episódios

Ao abrir o link de uma pasta compartilhada, o app lista os vídeos com miniatura,
nome e data. A lista tem busca, navegação por subpastas (com botão de voltar) e
mostra o progresso de cada episódio:

- **✓** no canto da miniatura: episódio já assistido.
- **Barra colorida** na base da miniatura: quanto do episódio você já assistiu.

Use o botão de lista no rodapé (ou o cabeçalho) para mostrar/ocultar a lista, e
`⌘←` / `⌘→` (ou as setas no rodapé) para voltar/avançar de episódio.

### Menu de botão direito

Clique com o botão direito em um episódio (na pasta ou na biblioteca) para acessar:

- **Reproduzir**
- **Marcar como assistido** / **Marcar como não assistido** (remove o ✓, mantendo
  onde você parou)
- **Resetar progresso** (zera o tempo assistido e o ✓)
- **Abrir no VLC**
- **Baixar**
- **Compartilhar…** (menu de compartilhamento do macOS)
- **Abrir no navegador**
- **Copiar link de compartilhamento** / **Copiar link direto**
- **Gerenciar fontes…** (na biblioteca)

Em uma pasta, o botão direito também copia ou compartilha o link da pasta.

### Pular abertura e encerramento

Durante a reprodução aparecem botões sobre o vídeo:

- **Pular abertura** — aparece no começo do episódio.
- **Pular encerramento** — aparece nos minutos finais e já passa para o próximo.

No botão **Pular** do rodapé você configura o pulo automático:

- Pular abertura automaticamente (duração padrão: 90 s, ajustável de 5 em 5 s).
- Pular encerramento automaticamente (padrão: últimos 180 s, ajustável).
- Avançar para o próximo episódio ao terminar (ligado por padrão).
- Retomar de onde parou (ligado por padrão).
- Mostrar os botões de pular (ligado por padrão).

As escolhas ficam salvas. O botão **Pular** fica azul (“Pular ativo”) quando algum
pulo automático está ligado. O pulo automático começa **desligado** — ative quando
quiser.

### Botões do rodapé

| Botão | O que faz |
| --- | --- |
| ☰ | Mostra/oculta a lista de reprodução |
| ‹ › | Episódio anterior / próximo |
| Pular | Configurações de pulo de abertura/encerramento e próximo episódio |
| ⬇︎ | Baixa o arquivo original para a pasta Downloads |
| VLC | Abre o stream direto no VLC (legendas, áudio original, melhor qualidade) |
| Safari | Abre o arquivo no Google Drive no navegador |
| ⧉ | Copia o link direto (para colar em IINA, mpv etc.) |
| ↻ | Recarrega o player |
| ⛶ | Tela cheia |

Atalhos: `⇧⌘V` colar e reproduzir · `⌘R` recarregar · `⇧⌘O` abrir no VLC ·
`⌘←` / `⌘→` episódio anterior/próximo · `⌘B` biblioteca · `⌃⌘F` tela cheia.

## Como funciona

O macOS não tem suporte nativo a MKV: o AVFoundation/QuickTime recusa o formato
(`This media format is not supported`). Por isso o app não usa `AVPlayer`.

Em vez disso, ele carrega `https://drive.google.com/file/d/<ID>/preview` dentro de um
`WKWebView`. O Drive converte o MKV para um formato que o WebKit reproduz, mantendo
busca, pausa, volume, velocidade e tela cheia.

A lista de uma pasta vem de `https://drive.google.com/embeddedfolderview?id=<ID>`,
que devolve HTML com nome, data, tipo e miniatura de cada arquivo — sem precisar de
chave de API.

O preview do Drive usa um iframe do YouTube. O app injeta um script em todos os
frames que localiza o elemento `<video>`, informa tempo/duração a cada segundo e
aceita comandos de seek. É isso que permite pular abertura/encerramento, retomar de
onde parou e avançar para o próximo episódio.

O botão **VLC** usa o link direto
`https://drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t`,
que aceita requisições por faixa (HTTP Range) — ou seja, faz streaming de verdade,
sem baixar o arquivo inteiro antes.

## Limitações

- Precisa de internet; o vídeo é transcodificado pelo Google.
- O arquivo ou a pasta precisa estar público (“qualquer pessoa com o link”) ou
  acessível na conta usada no player. A lista de pastas só funciona com link público.
- Alguns arquivos podem não ter preview no Drive (raro para vídeos). Nesse caso use
  **Baixar** ou **VLC**.
- O player integrado é o do Google: a qualidade é a do preview do Drive. Para a
  qualidade original e legendas embutidas, use o VLC.
- O pulo de abertura/encerramento usa uma duração fixa (90 s / 180 s por padrão,
  configurável). Se um episódio tiver abertura ou encerramento muito diferente,
  ajuste no botão **⏩** ou desligue o pulo automático.
- O progresso é salvo a cada ~5 segundos; se o app for encerrado à força, os
  últimos segundos podem não ser gravados.
- A biblioteca guarda os links e a lista de episódios localmente
  (`~/Library/Application Support/DrivePlay/library.json`). Se episódios novos
  forem adicionados à pasta no Drive, use **Atualizar** em **Gerenciar fontes**
  para atualizar a lista.

## Estrutura

```
DrivePlay/
├── Sources/
│   ├── App.swift              # entrada do app, menu e atalhos
│   ├── ContentView.swift      # interface (cabeçalho, lista, player, rodapé, ajuda)
│   ├── DriveLink.swift        # parsing de links e URLs do Drive
│   ├── DriveFolder.swift      # leitura do HTML da pasta e modelo dos arquivos
│   ├── FolderBrowser.swift    # navegação, cache e busca nas pastas
│   ├── MediaLibrary.swift     # coleções, fontes, união e ordenação de episódios
│   ├── LibraryViews.swift     # adicionar link, nova coleção e gerenciar fontes
│   ├── PlayerWebView.swift    # WKWebView + controle do <video> por JavaScript
│   ├── ProgressStore.swift    # retomada e episódios assistidos
│   ├── PlaybackSettingsView.swift # opções de pulo e avanço automático
│   ├── DownloadManager.swift  # download com progresso
│   └── Library.swift          # histórico de links e pastas
├── Resources/Info.plist
├── Tools/make_icon.swift      # gera o ícone .icns
├── build.sh
└── README.md
```
