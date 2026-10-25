# DrivePlay para Android

Aplicativo Android do DrivePlay, feito para celular e para a tela de capa do Galaxy Z Flip 6.

## O que ele faz

- Abre links compartilhados de vídeos do Google Drive (`/file/d/...`) no player em tela cheia.
- Abre pastas do Drive, lista os vídeos encontrados e toca em sequência.
- Permite escolher um vídeo local pelo seletor de arquivos do Android.
- Pula introdução (120 s) e encerramento (190 s), com tempos ajustáveis.
- Entra em tela cheia automaticamente após 5 s sem toque.
- Tem botão **Preencher** para usar toda a tela, mesmo que corte as bordas.
- Layout compacto para a tela de capa e suporte a `resizeableActivity`.

## Tela de capa (Z Flip 6)

1. Ative o acesso em **Ajustes → Recursos avançados → Labs** ou no **Good Lock → MultiStar**.
2. Dobre o celular, abra o DrivePlay pela tela de capa e toque em um vídeo.
3. Use o botão **Preencher** no topo do player para cobrir toda a tela externa.

O app usa `resizeableActivity` e CSS responsivo; a tela de capa é tratada como uma janela compacta.

## Login do Google

O Google pode bloquear o login dentro de WebViews (`disallowed_useragent`). O app usa um user agent móvel padrão para melhorar a compatibilidade, mas o fallback garantido é:

- usar um link compartilhado como “qualquer pessoa com o link”;
- ou tocar em **Chrome** no topo do player para abrir no navegador.

## Compilar

Requisitos: JDK 17, Android SDK platform 37 e build-tools 37.0.0.

```bash
./build-android.sh
```

O APK assinado sai em `build/DrivePlay-Android-1.1.0.apk`.

Para gerar com outro SDK:

```bash
PLATFORM_VERSION=37.0 TARGET_SDK=37 ./build-android.sh
```

## Versão

1.1.0
