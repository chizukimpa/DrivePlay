# DrivePlay para Android

Aplicativo Android do DrivePlay, feito para celular e para a tela de capa do Galaxy Z
Flip 6. A partir da 1.2.0 ele tem biblioteca, pastas e player próprios, sem abrir o
site do Google Drive.

## O que ele faz

- **Início** com continuar assistindo, pastas recentes e vídeos recentes.
- **Biblioteca** de coleções (pastas), com criar, renomear e excluir.
- **Fontes** por coleção: link de vídeo do Drive, pasta do Drive ou vídeo local.
- **Pastas do Drive** lidas dentro do app (`embeddedfolderview`), com miniaturas,
  ordenação natural dos episódios (E01, E02… E10) e navegação em subpastas.
- **Player próprio** sobre o preview do Drive: barra de progresso arrastável, ±10 s,
  play/pause, velocidade (0,5x–2x), qualidade, episódio anterior/próximo, preencher a
  tela, retomada de progresso e pular abertura/encerramento.
- **Vídeos locais** pelo seletor de arquivos, com registro persistente para reabrir
  pelos recentes. Também aceita `VIEW` e `SEND` de `video/*` vindos de outros apps.
- Pula introdução (120 s) e encerramento (190 s), com tempos ajustáveis.
- Entra em tela cheia automaticamente após 5 s sem toque, mostrando só o vídeo.
- Tem **Preencher** para usar toda a tela, mesmo que corte as bordas.
- Biblioteca, recentes e progresso gravados no aparelho (SharedPreferences como
  espelho do armazenamento do WebView).
- Layout compacto para a tela de capa e suporte a `resizeableActivity`.

## Tela de capa (Z Flip 6)

1. Ative o acesso em **Ajustes → Recursos avançados → Labs** ou no **Good Lock →
   MultiStar**.
2. Dobre o celular, abra o DrivePlay pela tela de capa e toque em uma coleção ou pasta.
3. Na capa, o player mantém anterior/próximo, −10 s, play e +10 s; velocidade,
   qualidade, Chrome e preencher ficam no menu (☰).
4. Use **Preencher** para cobrir toda a tela externa.

O app usa `resizeableActivity` e CSS responsivo; a tela de capa é tratada como uma
janela compacta.

## Login do Google

O Google pode bloquear o login dentro de WebViews (`disallowed_useragent`). O app usa
um user agent de desktop no player e um móvel na biblioteca para melhorar a
compatibilidade, mas o fallback garantido é:

- usar um link compartilhado como “qualquer pessoa com o link”;
- ou tocar em **Chrome** no menu do player para abrir no navegador.

## Compilar

Requisitos: JDK 17, Android SDK platform 37 e build-tools 37.0.0.

```bash
./build-android.sh
```

O APK assinado sai em `build/DrivePlay-Android-1.2.0.apk`.

Para gerar com outro SDK:

```bash
PLATFORM_VERSION=37.0 TARGET_SDK=37 ./build-android.sh
```

Para outra versão:

```bash
VERSION_NAME=1.3.0 VERSION_CODE=4 ./build-android.sh
```

## Estrutura

```
app/src/main/assets/index.html       interface (Início, Pastas, Ajustes)
app/src/main/assets/app.js           biblioteca, coleções, fontes e pastas
app/src/main/assets/styles.css       tema escuro e breakpoints da tela de capa
app/src/main/assets/player-core.js   UI e lógica comum do player
app/src/main/assets/drive-player.js  controle do iframe do preview do Drive
app/src/main/assets/local-player.js  backend de vídeo local
app/src/main/assets/player.css       estilos do player
app/src/main/java/.../MainActivity.java  shell, bridges e ciclo de vida
app/src/main/java/.../DriveApi.java      leitura das pastas públicas do Drive
app/src/main/java/.../LibraryStore.java  persistência nativa da biblioteca
```

## Versão

1.2.0 (versionCode 3)
