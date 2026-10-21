# DrivePlay para Windows

Leitor de vídeos (MKV, AVI, MP4…) hospedados no **Google Drive**, com a mesma
interface e as mesmas funções do DrivePlay para macOS.

Você cola o link de uma pasta ou de um vídeo e o conteúdo toca dentro do app. Como o
Google Drive transcodifica o vídeo no servidor, **MKV funciona sem instalar codecs ou
converter nada**. Para legendas embutidas, faixas de áudio e qualidade original, use
**Abrir no VLC**.

## Requisitos

- Windows 10 ou 11, 64 bits
- VLC instalado (opcional, recomendado para MKV) —
  https://www.videolan.org/vlc/download-windows.html
- Conexão com a internet

## Baixar e instalar

Na página de **Releases** do GitHub:

| Arquivo | Como usar |
| --- | --- |
| `DrivePlay-Setup-1.0.0-x64.exe` | **Instalador.** Instala em `Arquivos de Programas`, cria atalhos na área de trabalho e no menu Iniciar. Os dados ficam em `%APPDATA%\DrivePlay`. |
| `DrivePlay-Portable-1.0.0-x64.exe` | **Portátil em um único arquivo.** Não instala nada. Os dados ficam em `DrivePlayData` ao lado do `.exe`. |
| `DrivePlay-1.0.0-win32-x64-portable.zip` | **Pasta portátil.** Extraia e execute `DrivePlay.exe`. Os dados ficam em `DrivePlayData` dentro da pasta. |

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
entre na sua conta Google na própria janela do player; a sessão fica salva para as
próximas vezes. Isso também ajuda quando o Drive mostra o aviso
“Você atingiu o limite para pessoas que não fizeram login”.

Para arquivos privados, o download e o VLC usam a mesma sessão do player. Para
arquivos públicos, tudo funciona sem login.

## VLC

O botão **Abrir no VLC** procura o VLC nos caminhos padrão do Windows:

- `C:\Program Files\VideoLAN\VLC\vlc.exe`
- `C:\Program Files (x86)\VideoLAN\VLC\vlc.exe`
- `%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe`
- onde o comando `vlc` estiver no `PATH`

Se não encontrar, o app oferece a página de download do VLC. O VLC é necessário para
legendas embutidas, troca de faixas de áudio e qualidade original; o player integrado
não instala codecs.

## Compilar

Requisitos: Node.js 22 ou mais recente e npm.

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

- `DrivePlay-Setup-1.0.0-x64.exe` (instalador NSIS)
- `DrivePlay-Portable-1.0.0-x64.exe` (portátil em um arquivo)

Para gerar a pasta portátil com `@electron/packager`:

```bat
npm run pack:win
```

O GitHub Actions em `.github/workflows/release.yml` compila automaticamente as
versões do Windows e do macOS quando uma tag `v*` é enviada, e publica os arquivos
na página de Releases.

## Estrutura

```
src/
  main.js              janela, IPC, injeção no player do Drive
  preload.js           API segura do renderer
  player-preload.js    ponte de ticks do webview para o app
  main/
    drive.js           leitura de pastas/títulos do Drive
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
    player.js          webview do player
    icons.js           ícones SVG
```

## Solução de problemas

- **SmartScreen / “O Windows protegeu o computador”** — build sem assinatura;
  clique em **Mais informações → Executar assim mesmo**.
- **“Faça login na sua Conta do Google…”** — entre na conta Google na janela do
  player; a sessão fica salva. Alternativamente, baixe o arquivo ou use o VLC.
- **VLC não encontrado** — instale o VLC ou marque “Adicionar ao PATH” na instalação.
- **Player em branco** — use **Recarregar** no rodapé ou `Ctrl+R`; verifique a conexão.
- **Download não começa** — para arquivos privados, faça login no player; para
  públicos, verifique se o link permite download.

## Licença

MIT. Projeto não afiliado ao Google, ao YouTube ou à VideoLAN.
