package app.driveplay.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.SurfaceTexture;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.MergingMediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native ExoPlayer-based playback for Google Drive files.
 *
 * <p>The WebView cannot render the YouTube/MSE iframe used by the Drive preview
 * (audio plays, video stays black) and the iframe exposes no subtitle or audio
 * track control. ExoPlayer decodes the original MKV straight from Drive, so the
 * phone's hardware decoders are used and every track stays available.</p>
 */
final class NativeVideoPlayer {

    interface Listener {
        void onState(String json);
        void onError(String message);
        void onInfo(String message);
    }

    private final Context context;
    private final FrameLayout layer;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private TextureView videoView;
    private Surface videoSurface;
    private SurfaceTexture pendingSurface;
    private boolean surfaceAttached;
    private ExoPlayer player;
    private Listener currentListener;

    private boolean destroyed;
    private boolean fill;
    private float aspect;
    /** Fraction of the coded frame actually occupied by the picture (baked-in bars). */
    private float contentFracW = 1f;
    private float contentFracH = 1f;
    private float barsWSum;
    private float barsHSum;
    private int barsCount;
    private int fullCount;
    private int lastWidth = -1;
    private int lastHeight = -1;
    private long lastBufferingMs;
    private long bufferingSince;
    private long lastBufferingRetry;
    private String lastError = "";
    private String lastCueText = "";
    private String pendingUrl;
    private String pendingTitle;
    private String pendingCookie;

    // Preview-stream fallback for the Drive download quota.
    private WebView probe;
    private boolean fallbackStarted;
    private boolean fallbackStartScheduled;
    private long probeStartedAt;
    private final TreeMap<Integer, String> streamVideos = new TreeMap<>();
    private final ArrayList<String> streamAudios = new ArrayList<>();
    private final ArrayList<Map.Entry<Integer, String>> fallbackQueue = new ArrayList<>();
    private int fallbackQueueIndex;
    private int currentFallbackItag = -1;
    private String bestVideoUrl;
    private String bestAudioUrl;
    private int bestVideoItag = -1;
    private String currentFileId;
    private boolean fallbackFromCache;
    private boolean retryInFlight;
    private static final long FALLBACK_CACHE_MS = 10 * 60 * 1000L;
    private static final java.util.LinkedHashMap<String, CachedFallback> FALLBACK_CACHE =
        new java.util.LinkedHashMap<String, CachedFallback>(8, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(java.util.Map.Entry<String, CachedFallback> eldest) {
                return size() > 12;
            }
        };

    private static final class CachedFallback {
        final String videoUrl;
        final String audioUrl;
        final int itag;
        final long expiresAt;

        CachedFallback(String videoUrl, String audioUrl, int itag, long expiresAt) {
            this.videoUrl = videoUrl;
            this.audioUrl = audioUrl;
            this.itag = itag;
            this.expiresAt = expiresAt;
        }
    }

    NativeVideoPlayer(Context context, FrameLayout layer, Listener listener) {
        this.context = context;
        this.layer = layer;
        this.listener = listener;
        this.currentListener = listener;
        layer.setClipChildren(true);
        layer.setBackgroundColor(0xFF000000);
        layer.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override public void onLayoutChange(View view, int left, int top, int right, int bottom,
                                                 int oldLeft, int oldTop, int oldRight, int oldBottom) {
                layoutVideo();
            }
        });
        videoView = new TextureView(context);
        videoView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        ));
        // ExoPlayer keeps a Surface; when the phone moves to the cover display
        // (or the window is recreated) the SurfaceTexture is destroyed and must
        // be re-attached, otherwise the video stays black with audio only.
        videoView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
                attachSurface(texture);
            }

            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {
                // The view layout handles the size.
            }

            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
                detachSurface();
                return true;
            }

            @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) {
                // Frames are rendered by ExoPlayer.
            }
        });
        layer.addView(videoView);
    }

    private void attachSurface(SurfaceTexture texture) {
        pendingSurface = texture;
        if (player == null || texture == null) return;
        releaseSurface();
        try {
            videoSurface = new Surface(texture);
            player.setVideoSurface(videoSurface);
            surfaceAttached = true;
            android.util.Log.d("DrivePlay", "surface attached");
        } catch (Throwable error) {
            surfaceAttached = false;
            android.util.Log.d("DrivePlay", "surface attach failed " + error.getMessage());
        }
    }

    private void detachSurface() {
        if (player != null) {
            try { player.clearVideoSurface(); } catch (Throwable ignored) {}
        }
        releaseSurface();
        surfaceAttached = false;
        android.util.Log.d("DrivePlay", "surface detached");
    }

    private void releaseSurface() {
        if (videoSurface == null) return;
        try { videoSurface.release(); } catch (Throwable ignored) {}
        videoSurface = null;
    }

    private FrameLayout.LayoutParams centerParams(int width, int height) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height, Gravity.CENTER);
        return params;
    }

    void setFill(boolean enabled) {
        fill = enabled;
        layoutVideo();
    }

    boolean isFill() {
        return fill;
    }

    /** Resolves the Drive URL in the background and starts playback. */
    void open(final String fileId, final String title, final String cookie) {
        pendingTitle = title;
        currentFileId = fileId;
        fallbackFromCache = false;
        retryInFlight = false;
        android.util.Log.d("DrivePlay", "native open " + fileId);
        main.post(new Runnable() {
            @Override public void run() {
                sendState(0, 0, true, false, "Preparando o vídeo…");
            }
        });
        io.execute(new Runnable() {
            @Override
            public void run() {
                final DriveMedia.Result result = DriveMedia.resolve(fileId, cookie);
                if (destroyed) return;
                android.util.Log.d("DrivePlay", "native resolve returned error=" + result.error);
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (destroyed) return;
                        if (result.error != null && result.error.contains("limite de downloads")) {
                            startPreviewFallback(fileId);
                            return;
                        }
                        if (result.error != null || TextUtils.isEmpty(result.url)) {
                            fail("Não foi possível abrir o vídeo do Drive. "
                                + (result.error == null ? "" : result.error));
                            return;
                        }
                        startPlayback(result.url, title);
                    }
                });
            }
        });
    }

    /**
     * Plays a content:// URI (local file or Google Drive provider selected via
     * the system picker) with the same native player used for Drive originals.
     * This keeps audio/subtitle track selection and cues available.
     */
    void openUri(final Uri uri, final String title) {
        if (uri == null) return;
        pendingTitle = title;
        currentFileId = "";
        fallbackStarted = false;
        fallbackFromCache = false;
        retryInFlight = false;
        android.util.Log.d("DrivePlay", "native open uri " + uri);
        main.post(new Runnable() {
            @Override public void run() {
                sendState(0, 0, true, false, "Preparando o vídeo…");
            }
        });
        try {
            releasePlayer();
            DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(context);
            createPlayer(dataSource);
            player.setMediaItem(MediaItem.fromUri(uri));
            player.prepare();
            player.play();
            resetContentDetection();
            startPump();
            scheduleContentDetection();
        } catch (Throwable error) {
            fail("Falha ao abrir o vídeo: " + error.getMessage());
        }
    }

    private void startPlayback(String url, String title) {
        releasePlayer();
        try {
            DefaultHttpDataSource.Factory http = buildHttp(url, false);
            DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(context, http);
            createPlayer(dataSource);
            player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
            player.prepare();
            player.play();
            pendingUrl = url;
            resetContentDetection();
            startPump();
            scheduleContentDetection();
        } catch (Throwable error) {
            fail("Falha ao iniciar o player: " + error.getMessage());
        }
    }

    private DefaultHttpDataSource.Factory buildHttp(String url, boolean streaming) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent(DriveApi.USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(20000)
            .setReadTimeoutMs(30000);

        Map<String, String> headers = new HashMap<>();
        // The Drive API answers 403 for a full download when the file quota is
        // exhausted, but 206 for a ranged request. Always start with a range;
        // ExoPlayer overrides it with the real range when seeking.
        headers.put("Range", "bytes=0-");
        if (streaming) {
            headers.put("Referer", "https://drive.google.com/");
            headers.put("Origin", "https://drive.google.com");
        } else {
            String cookie = DriveMedia.cookieFor(url);
            if (!TextUtils.isEmpty(cookie)) headers.put("Cookie", cookie);
        }
        http.setDefaultRequestProperties(headers);
        return http;
    }

    private void createPlayer(DefaultDataSource.Factory dataSource) {
        ProgressiveMediaSource.Factory source =
            new ProgressiveMediaSource.Factory(dataSource);
        player = new ExoPlayer.Builder(context)
            .setMediaSourceFactory(source)
            .setSeekBackIncrementMs(10000)
            .setSeekForwardIncrementMs(10000)
            .build();
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_NETWORK);
        if (videoView != null && videoView.getSurfaceTexture() != null) {
            attachSurface(videoView.getSurfaceTexture());
        } else if (pendingSurface != null) {
            attachSurface(pendingSurface);
        }
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_BUFFERING) lastBufferingMs = System.currentTimeMillis();
                if (state == Player.STATE_READY) lastError = "";
                if (state == Player.STATE_ENDED) {
                    pushState();
                    listener.onState(stateJson(true, true, null));
                } else {
                    pushState();
                }
            }

            @Override public void onIsPlayingChanged(boolean playing) {
                pushState();
            }

            @Override public void onVideoSizeChanged(VideoSize size) {
                android.util.Log.d("DrivePlay", "onVideoSizeChanged " + size.width + "x"
                    + size.height + " par=" + size.pixelWidthHeightRatio);
                if (size.width > 0 && size.height > 0) {
                    float ratio = size.pixelWidthHeightRatio > 0 ? size.pixelWidthHeightRatio : 1f;
                    aspect = (size.width * ratio) / size.height;
                    layoutVideo();
                }
                pushState();
            }

            @Override public void onTracksChanged(Tracks tracks) {
                pushState();
            }

            @Override public void onCues(CueGroup cueGroup) {
                lastCueText = cueText(cueGroup);
                listener.onState(cuesJson(cueGroup));
            }

            @Override public void onPlayerError(PlaybackException error) {
                android.util.Log.d("DrivePlay", "player error " + error.getErrorCodeName()
                    + " cause=" + error.getCause());
                if (fallbackStarted && retryLowerStream()) return;
                if (fallbackFromCache && !TextUtils.isEmpty(currentFileId)) {
                    // The signed preview URL expired or is no longer accepted:
                    // probe the preview again instead of failing the episode.
                    synchronized (FALLBACK_CACHE) {
                        FALLBACK_CACHE.remove(currentFileId);
                    }
                    fallbackFromCache = false;
                    fallbackStarted = false;
                    fallbackStartScheduled = false;
                    startPreviewFallback(currentFileId);
                    return;
                }
                lastError = describe(error);
                fail(lastError);
            }
        });
    }

    private void resetContentDetection() {
        contentFracW = 1f;
        contentFracH = 1f;
        barsWSum = 0f;
        barsHSum = 0f;
        barsCount = 0;
        fullCount = 0;
        lastWidth = -1;
        lastHeight = -1;
    }

    private void scheduleContentDetection() {
        main.postDelayed(new Runnable() {
            @Override public void run() { detectContentAspect(); }
        }, 600);
        main.postDelayed(new Runnable() {
            @Override public void run() { detectContentAspect(); }
        }, 1200);
        main.postDelayed(new Runnable() {
            @Override public void run() { detectContentAspect(); }
        }, 2500);
        main.postDelayed(new Runnable() {
            @Override public void run() { detectContentAspect(); }
        }, 4500);
        main.postDelayed(new Runnable() {
            @Override public void run() { detectContentAspect(); }
        }, 8000);
    }

    /**
     * Google Drive blocks the original download when a public file hits its
     * quota, but the preview player keeps streaming a transcoded copy. Grab the
     * signed video/audio URLs from the preview page and play them together.
     */
    private void startPreviewFallback(final String fileId) {
        long now = android.os.SystemClock.elapsedRealtime();
        CachedFallback cached;
        synchronized (FALLBACK_CACHE) {
            cached = FALLBACK_CACHE.get(fileId);
        }
        if (cached != null && cached.expiresAt > now) {
            final CachedFallback hit = cached;
            android.util.Log.d("DrivePlay", "fallback cache hit itag=" + hit.itag);
            io.execute(new Runnable() {
                @Override public void run() {
                    final boolean audioOk = isPlayableStream(hit.audioUrl);
                    main.post(new Runnable() {
                        @Override public void run() {
                            if (destroyed) return;
                            if (audioOk) {
                                fallbackFromCache = true;
                                fallbackStarted = true;
                                bestAudioUrl = hit.audioUrl;
                                fallbackQueue.clear();
                                fallbackQueue.add(
                                    new java.util.AbstractMap.SimpleEntry<>(hit.itag, hit.videoUrl));
                                fallbackQueueIndex = 0;
                                startStreamingPlayback(hit.videoUrl, hit.audioUrl,
                                    qualityLabel(hit.itag), hit.itag, 0);
                            } else {
                                synchronized (FALLBACK_CACHE) {
                                    FALLBACK_CACHE.remove(fileId);
                                }
                                startPreviewFallback(fileId);
                            }
                        }
                    });
                }
            });
            return;
        }

        main.post(new Runnable() {
            @Override public void run() {
                if (destroyed || probe != null) return;
                fallbackStarted = false;
                fallbackStartScheduled = false;
                probeStartedAt = android.os.SystemClock.elapsedRealtime();
                streamVideos.clear();
                streamAudios.clear();
                fallbackQueue.clear();
                fallbackQueueIndex = 0;
                currentFallbackItag = -1;
                bestVideoUrl = null;
                bestAudioUrl = null;
                bestVideoItag = -1;
                sendState(0, 0, true, false, "Drive no limite — abrindo streaming…");
                try {
                    WebView web = new WebView(context);
                    WebSettings settings = web.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setDomStorageEnabled(true);
                    settings.setMediaPlaybackRequiresUserGesture(false);
                    settings.setUserAgentString(DriveApi.USER_AGENT);
                    // The preview player picks its quality from the layout
                    // viewport. A 3240x1824 probe is 1080x608 CSS px at the
                    // phone's density, which makes it request the 1080p stream
                    // (itag 137). setInitialScale() is no longer available in
                    // the current WebView API.
                    settings.setUseWideViewPort(true);
                    settings.setLoadWithOverviewMode(true);
                    web.setAlpha(0.01f);
                    web.setBackgroundColor(0x00000000);
                    web.setClickable(false);
                    web.setFocusable(false);
                    layer.addView(web, 0, new FrameLayout.LayoutParams(1080, 1920));
                    probe = web;
                    web.setWebViewClient(new WebViewClient() {
                        @Override
                        public WebResourceResponse shouldInterceptRequest(
                            WebView view, WebResourceRequest request) {
                            String url = request.getUrl().toString();
                            try {
                                captureStream(url);
                                // Let the preview start normally for a moment so
                                // its audio URL is the valid playback one, then
                                // block the higher video itags to force a 480p
                                // fallback that ExoPlayer can always parse.
                                if (url.contains("videoplayback") && url.contains("mime=video")
                                    && intParam(url, "itag") > 134
                                    && bestAudioUrl != null
                                    && android.os.SystemClock.elapsedRealtime() - probeStartedAt > 1500) {
                                    WebResourceResponse blocked = new WebResourceResponse(
                                        "text/plain", "utf-8",
                                        new java.io.ByteArrayInputStream(new byte[0]));
                                    blocked.setStatusCodeAndReasonPhrase(403, "Forbidden");
                                    return blocked;
                                }
                            } catch (Throwable ignored) {
                                // Capture is best effort.
                            }
                            return null;
                        }
                    });
                    web.loadUrl("https://drive.google.com/file/d/" + fileId
                        + "/preview?autoplay=1");
                    main.postDelayed(new Runnable() {
                        @Override public void run() {
                            if (probe == web) clickPreviewPlay(web);
                        }
                    }, 2000);
                    // Grow the probe after the first streams are captured so the
                    // adaptive player also advertises its higher qualities.
                    main.postDelayed(new Runnable() {
                        @Override public void run() {
                            if (probe == web) {
                                web.setLayoutParams(new FrameLayout.LayoutParams(3240, 1824));
                                clickPreviewPlay(web);
                            }
                        }
                    }, 2500);
                    main.postDelayed(new Runnable() {
                        @Override public void run() {
                            if (probe == web && !fallbackStarted) {
                                destroyProbe();
                                fail("O Google Drive atingiu o limite de downloads deste "
                                    + "arquivo. Aguarde algumas horas (ou 24 h) e tente de "
                                    + "novo, ou abra no Chrome com uma conta Google.");
                            }
                        }
                    }, 15000);
                } catch (Throwable error) {
                    fail("Não foi possível abrir o streaming alternativo: "
                        + error.getMessage());
                }
            }
        });
    }

    private void clickPreviewPlay(WebView web) {
        try {
            web.evaluateJavascript(
                "(function(){var b=document.querySelector("
                    + "'button[aria-label*=\"Reproduzir\"],button[aria-label*=\"Play\"],"
                    + "button[aria-label*=\"Iniciar\"]');if(b){b.click();return true;}"
                    + "return false;})()",
                null
            );
        } catch (Throwable ignored) {
            // The autoplay flag usually starts it.
        }
    }

    private void captureStream(String url) {
        if (url == null || !url.contains("videoplayback") || fallbackStarted) return;
        boolean video = url.contains("mime=video");
        boolean audio = url.contains("mime=audio");
        if (!video && !audio) return;

        String clean = url
            .replaceAll("&range=[^&]*", "")
            .replaceAll("&rn=[^&]*", "")
            .replaceAll("&rbuf=[^&]*", "")
            .replaceAll("&ump=[^&]*", "");
        if (clean.startsWith("http://")) {
            clean = "https://" + clean.substring(7);
        }

        if (video) {
            int itag = intParam(url, "itag");
            android.util.Log.d("DrivePlay", "stream video itag=" + itag
                + " best=" + bestVideoItag);
            if (itag > 0) streamVideos.put(itag, clean);
            if (bestVideoUrl == null || itag > bestVideoItag) {
                bestVideoUrl = clean;
                bestVideoItag = itag;
            }
        } else if (audio) {
            if (!streamAudios.contains(clean)) streamAudios.add(clean);
            if (bestAudioUrl == null) bestAudioUrl = clean;
        }

        if (bestVideoUrl == null || bestAudioUrl == null) return;

        main.post(new Runnable() {
            @Override public void run() {
                if (fallbackStarted || fallbackStartScheduled) return;
                fallbackStartScheduled = true;
                // Start as soon as the preview exposes video and audio. If a
                // higher quality is a UMP-only URL, ExoPlayer retries the next
                // quality; waiting and validating every stream made startup
                // several seconds slower.
                main.postDelayed(new Runnable() {
                    @Override public void run() {
                        startFallbackNow();
                    }
                }, 900);
            }
        });
    }

    private void startFallbackNow() {
        if (fallbackStarted || destroyed) return;
        if (streamVideos.isEmpty() || bestAudioUrl == null) return;
        fallbackStarted = true;
        destroyProbe();
        final ArrayList<String> audioCandidates = new ArrayList<>(streamAudios);
        final ArrayList<Map.Entry<Integer, String>> queue =
            new ArrayList<>(new TreeMap<>(streamVideos).descendingMap().entrySet());
        io.execute(new Runnable() {
            @Override
            public void run() {
                if (destroyed) return;
                String audioChosen = null;
                for (String candidate : audioCandidates) {
                    if (isPlayableStream(candidate)) {
                        audioChosen = candidate;
                        break;
                    }
                }
                if (queue.isEmpty() || audioChosen == null) {
                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            fail("O Google Drive atingiu o limite de downloads e o "
                                + "streaming alternativo não respondeu. Aguarde algumas "
                                + "horas (ou 24 h) e tente de novo.");
                        }
                    });
                    return;
                }
                final String audioUrl = audioChosen;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (destroyed) return;
                        bestAudioUrl = audioUrl;
                        fallbackQueue.clear();
                        fallbackQueue.addAll(queue);
                        fallbackQueueIndex = 0;
                        fallbackFromCache = false;
                        Map.Entry<Integer, String> first = fallbackQueue.get(0);
                        synchronized (FALLBACK_CACHE) {
                            if (!TextUtils.isEmpty(currentFileId)) {
                                FALLBACK_CACHE.put(currentFileId, new CachedFallback(
                                    first.getValue(), audioUrl, first.getKey(),
                                    android.os.SystemClock.elapsedRealtime() + FALLBACK_CACHE_MS));
                            }
                        }
                        startStreamingPlayback(first.getValue(), audioUrl,
                            qualityLabel(first.getKey()), first.getKey(), 0);
                    }
                });
            }
        });
    }

    /** Retries with the next lower quality after a playback error. */
    private boolean retryLowerStream() {
        if (bestAudioUrl == null) return false;
        if (retryInFlight) return true;
        if (fallbackQueueIndex + 1 >= fallbackQueue.size()) return false;
        retryInFlight = true;
        final String audioUrl = bestAudioUrl;
        final long position = player == null ? 0 : Math.max(0, player.getCurrentPosition());
        final int startIndex = fallbackQueueIndex + 1;
        io.execute(new Runnable() {
            @Override
            public void run() {
                Map.Entry<Integer, String> chosen = null;
                int chosenIndex = -1;
                for (int i = startIndex; i < fallbackQueue.size(); i++) {
                    Map.Entry<Integer, String> candidate = fallbackQueue.get(i);
                    if (isPlayableStream(candidate.getValue())) {
                        chosen = candidate;
                        chosenIndex = i;
                        break;
                    }
                }
                final Map.Entry<Integer, String> pick = chosen;
                final int index = chosenIndex;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        retryInFlight = false;
                        if (destroyed) return;
                        if (pick == null) {
                            fail("O Google Drive atingiu o limite de downloads e o "
                                + "streaming alternativo não respondeu. Aguarde algumas "
                                + "horas (ou 24 h) e tente de novo.");
                            return;
                        }
                        fallbackQueueIndex = index;
                        startStreamingPlayback(pick.getValue(), audioUrl,
                            qualityLabel(pick.getKey()), pick.getKey(), position);
                    }
                });
            }
        });
        return true;
    }

    /** Rejects UMP-only/expired URLs before handing them to ExoPlayer. */
    private boolean isPlayableStream(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", DriveApi.USER_AGENT);
            connection.setRequestProperty("Referer", "https://drive.google.com/");
            connection.setRequestProperty("Origin", "https://drive.google.com");
            connection.setRequestProperty("Range", "bytes=0-1023");
            int status = connection.getResponseCode();
            String type = connection.getContentType();
            if (status != 200 && status != 206) {
                android.util.Log.d("DrivePlay", "stream rejected HTTP " + status + " " + type);
                return false;
            }
            InputStream input = connection.getInputStream();
            byte[] head = new byte[12];
            int read = 0;
            while (read < head.length) {
                int count = input.read(head, read, head.length - read);
                if (count <= 0) break;
                read += count;
            }
            input.close();
            boolean mp4 = read >= 8 && head[4] == 'f' && head[5] == 't'
                && head[6] == 'y' && head[7] == 'p';
            android.util.Log.d("DrivePlay", "stream check " + status + " " + type
                + " mp4=" + mp4);
            return mp4;
        } catch (Throwable error) {
            android.util.Log.d("DrivePlay", "stream check failed " + error.getMessage());
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String qualityLabel(int itag) {
        switch (itag) {
            case 137: return "1080p";
            case 136: return "720p";
            case 135: return "480p";
            case 134: return "360p";
            default: return "streaming";
        }
    }

    private static int intParam(String url, String name) {
        Matcher matcher = Pattern.compile("[?&]" + name + "=(\\d+)").matcher(url);
        return matcher.find() ? Integer.parseInt(matcher.group(1)) : -1;
    }

    private void startStreamingPlayback(final String videoUrl, final String audioUrl,
                                        final String quality, final int itag,
                                        final long startPositionMs) {
        if (destroyed) return;
        retryInFlight = false;
        releasePlayer();
        currentFallbackItag = itag;
        android.util.Log.d("DrivePlay", "stream start itag=" + itag
            + " url=" + videoUrl.substring(0, Math.min(150, videoUrl.length())));
        try {
            DefaultHttpDataSource.Factory http = buildHttp(videoUrl, true);
            DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(context, http);
            ProgressiveMediaSource.Factory factory = new ProgressiveMediaSource.Factory(dataSource);
            MediaSource video = factory.createMediaSource(MediaItem.fromUri(videoUrl));
            MediaSource audio = factory.createMediaSource(MediaItem.fromUri(audioUrl));
            createPlayer(dataSource);
            player.setMediaSource(new MergingMediaSource(video, audio));
            player.prepare();
            if (startPositionMs > 0) {
                player.seekTo(Math.max(0, startPositionMs));
            }
            player.play();
            listener.onInfo("Google Drive no limite de downloads: reproduzindo em "
                + "streaming " + quality + " (uma faixa de áudio, sem legendas).");
            resetContentDetection();
            startPump();
            scheduleContentDetection();
        } catch (Throwable error) {
            fail("Falha ao abrir o streaming alternativo: " + error.getMessage());
        }
    }

    private void destroyProbe() {
        WebView web = probe;
        probe = null;
        if (web == null) return;
        try {
            web.stopLoading();
            web.loadUrl("about:blank");
            if (web.getParent() instanceof ViewGroup) {
                ((ViewGroup) web.getParent()).removeView(web);
            }
            web.destroy();
        } catch (Throwable ignored) {
            // Already gone.
        }
    }

    private void fail(String message) {
        if (destroyed) return;
        lastError = message;
        listener.onError(message);
        sendState(0, 0, true, false, message);
    }

    private String describe(PlaybackException error) {
        if (error == null) return "Não foi possível reproduzir este vídeo.";
        String name = error.getErrorCodeName();
        if (error.errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) {
            return "O Drive recusou o download (cota). Toque em “Vídeo local” e escolha "
                + "o arquivo no Google Drive do celular para ter todas as faixas e legendas.";
        }
        if (error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
            || error.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED) {
            return "O celular não conseguiu decodificar o vídeo deste arquivo ("
                + name + ").";
        }
        if (error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED) {
            return "O arquivo recebido não é um vídeo válido. O Google Drive pode ter "
                + "devolvido uma página de erro (limite de downloads). Tente novamente "
                + "em alguns minutos ou abra no Chrome.";
        }
        if (error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            || error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT) {
            return "Falha de rede ao ler o vídeo do Drive. Verifique a conexão.";
        }
        return "Não foi possível reproduzir este vídeo (" + name + ").";
    }

    private final Runnable pump = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            pushState();
            main.postDelayed(this, 250);
        }
    };

    private void startPump() {
        main.removeCallbacks(pump);
        main.post(pump);
    }

    private void pushState() {
        if (destroyed || player == null) return;
        long duration = player.getDuration();
        long position = player.getCurrentPosition();
        boolean ended = player.getPlaybackState() == Player.STATE_ENDED;
        boolean buffering = player.getPlaybackState() == Player.STATE_BUFFERING;
        boolean ready = player.getPlaybackState() == Player.STATE_READY
            || player.getPlaybackState() == Player.STATE_ENDED;

        long now = android.os.SystemClock.elapsedRealtime();
        if (buffering) {
            if (bufferingSince == 0) {
                bufferingSince = now;
            } else if (fallbackStarted && now - bufferingSince > 7000
                && now - lastBufferingRetry > 7000) {
                // A signed preview URL can stall after a seek (especially just
                // after folding). Move to the next quality while keeping the
                // position instead of staying on a black frame forever.
                lastBufferingRetry = now;
                bufferingSince = 0;
                if (retryLowerStream()) return;
            }
        } else {
            bufferingSince = 0;
        }

        sendState(position, duration, !ready || buffering, ended, null);
    }

    private void sendState(long positionMs, long durationMs, boolean buffering,
                           boolean ended, String message) {
        listener.onState(stateJson(buffering, ended, message, positionMs, durationMs));
    }

    private String stateJson(boolean buffering, boolean ended, String message) {
        return stateJson(buffering, ended, message, -1, -1);
    }

    private String stateJson(boolean buffering, boolean ended, String message,
                             long positionMs, long durationMs) {
        try {
            JSONObject json = new JSONObject();
            boolean hasPlayer = player != null;
            long position = positionMs >= 0 ? positionMs : (hasPlayer ? player.getCurrentPosition() : 0);
            long duration = durationMs >= 0 ? durationMs : (hasPlayer ? player.getDuration() : 0);
            if (duration == C.TIME_UNSET) duration = 0;
            if (position == C.TIME_UNSET) position = 0;
            boolean paused = !hasPlayer || !player.isPlaying();
            json.put("ready", hasPlayer && !buffering && duration > 0);
            json.put("hasVideo", aspect > 0);
            json.put("currentTime", position / 1000.0);
            json.put("duration", duration / 1000.0);
            json.put("paused", paused);
            json.put("ended", ended);
            json.put("rate", hasPlayer ? player.getPlaybackParameters().speed : 1);
            json.put("buffering", buffering);
            json.put("aspect", aspect);
            json.put("message", message == null ? "" : message);
            json.put("error", lastError);
            json.put("audio", tracksJson(C.TRACK_TYPE_AUDIO));
            json.put("text", tracksJson(C.TRACK_TYPE_TEXT));
            return json.toString();
        } catch (Exception error) {
            return "{}";
        }
    }

    private String cuesJson(CueGroup group) {
        try {
            JSONObject json = new JSONObject();
            json.put("cues", cueText(group));
            return json.toString();
        } catch (Exception error) {
            return "{}";
        }
    }

    private String cueText(CueGroup group) {
        StringBuilder text = new StringBuilder();
        if (group != null) {
            for (Cue cue : group.cues) {
                if (cue.text != null) {
                    if (text.length() > 0) text.append('\n');
                    text.append(cue.text);
                }
            }
        }
        return text.toString();
    }

    private JSONArray tracksJson(int type) {
        JSONArray array = new JSONArray();
        if (player == null) return array;
        try {
            Tracks tracks = player.getCurrentTracks();
            for (Tracks.Group group : tracks.getGroups()) {
                if (group.getType() != type) continue;
                TrackGroup media = group.getMediaTrackGroup();
                for (int i = 0; i < media.length; i++) {
                    if (!group.isTrackSupported(i)) continue;
                    JSONObject item = new JSONObject();
                    String label = media.getFormat(i).label;
                    String language = media.getFormat(i).language;
                    item.put("index", array.length());
                    item.put("label", TextUtils.isEmpty(label)
                        ? (TextUtils.isEmpty(language) ? "Faixa " + (array.length() + 1) : language)
                        : label);
                    item.put("language", language == null ? "" : language);
                    item.put("selected", group.isTrackSelected(i));
                    array.put(item);
                }
            }
        } catch (Exception ignored) {
            // Tracks are best effort.
        }
        return array;
    }

    void play() {
        if (player != null) player.play();
    }

    boolean isPlaying() {
        return player != null && player.isPlaying();
    }

    double currentPositionSeconds() {
        return player == null ? 0 : player.getCurrentPosition() / 1000.0;
    }

    double durationSeconds() {
        if (player == null) return 0;
        long duration = player.getDuration();
        return duration == C.TIME_UNSET ? 0 : duration / 1000.0;
    }

    void pause() {
        if (player != null) player.pause();
    }

    void seekTo(double seconds) {
        if (player == null) return;
        long duration = player.getDuration();
        long target = Math.max(0, (long) (seconds * 1000));
        if (duration > 0) target = Math.min(target, duration - 500);
        player.seekTo(target);
    }

    void setRate(double rate) {
        if (player != null) player.setPlaybackSpeed((float) rate);
    }

    void selectAudio(int index) {
        selectTrack(C.TRACK_TYPE_AUDIO, index);
    }

    void selectText(int index) {
        selectTrack(C.TRACK_TYPE_TEXT, index);
    }

    private void selectTrack(int type, int wanted) {
        if (player == null) return;
        try {
            Tracks tracks = player.getCurrentTracks();
            TrackSelectionParameters.Builder builder =
                player.getTrackSelectionParameters().buildUpon();
            builder.clearOverridesOfType(type);
            if (type == C.TRACK_TYPE_TEXT) builder.setTrackTypeDisabled(type, wanted < 0);

            int seen = 0;
            for (Tracks.Group group : tracks.getGroups()) {
                if (group.getType() != type) continue;
                TrackGroup media = group.getMediaTrackGroup();
                for (int i = 0; i < media.length; i++) {
                    if (!group.isTrackSupported(i)) continue;
                    if (seen == wanted) {
                        builder.addOverride(new TrackSelectionOverride(media, i));
                        seen = Integer.MAX_VALUE;
                        break;
                    }
                    seen++;
                }
                if (seen == Integer.MAX_VALUE) break;
            }
            player.setTrackSelectionParameters(builder.build());
        } catch (Exception ignored) {
            // Selection is best effort.
        }
    }

    private void layoutVideo() {
        if (videoView == null || aspect <= 0) return;
        int width = layer.getWidth();
        int height = layer.getHeight();
        if (width <= 0 || height <= 0) return;

        // The decoded frame may contain baked-in black bars (4:3 picture inside
        // a 16:9 file, or a 2.39:1 movie inside 16:9). Size the surface from the
        // real picture area, then scale it up by the bar fraction so the bars are
        // pushed outside the (clipping) layer.
        float contentAspect = aspect * contentFracW / contentFracH;
        if (contentAspect <= 0) contentAspect = aspect;

        float containerAspect = (float) width / height;
        float contentWidth;
        float contentHeight;
        if (fill) {
            if (containerAspect > contentAspect) {
                contentWidth = width;
                contentHeight = width / contentAspect;
            } else {
                contentHeight = height;
                contentWidth = height * contentAspect;
            }
        } else {
            if (containerAspect > contentAspect) {
                contentHeight = height;
                contentWidth = height * contentAspect;
            } else {
                contentWidth = width;
                contentHeight = width / contentAspect;
            }
        }

        int targetWidth = Math.round(contentWidth / contentFracW);
        int targetHeight = Math.round(contentHeight / contentFracH);
        if (targetWidth == lastWidth && targetHeight == lastHeight) return;
        lastWidth = targetWidth;
        lastHeight = targetHeight;
        android.util.Log.d("DrivePlay", "layoutVideo layer=" + width + "x" + height
            + " aspect=" + aspect + " content=" + contentAspect
            + " frac=" + contentFracW + "x" + contentFracH
            + " fill=" + fill + " -> " + targetWidth + "x" + targetHeight);
        videoView.setLayoutParams(centerParams(targetWidth, targetHeight));
    }

    /**
     * Samples the rendered frame to find baked-in black bars. Many releases keep
     * a 4:3 picture inside a 16:9 container, which makes the video look boxed
     * even in "fit" mode and leaves bars in "fill" mode.
     */
    private void detectContentAspect() {
        if (destroyed || videoView == null || aspect <= 0) return;
        int viewWidth = videoView.getWidth();
        int viewHeight = videoView.getHeight();
        if (viewWidth <= 0 || viewHeight <= 0 || !videoView.isAvailable()) {
            scheduleDetect(1200);
            return;
        }

        Bitmap bitmap;
        try {
            int sampleWidth = 240;
            int sampleHeight = Math.max(32,
                Math.round((float) sampleWidth * viewHeight / viewWidth));
            bitmap = videoView.getBitmap(sampleWidth, sampleHeight);
        } catch (Throwable error) {
            bitmap = null;
        }
        if (bitmap == null) {
            scheduleDetect(1200);
            return;
        }

        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        if (w < 8 || h < 8) {
            bitmap.recycle();
            return;
        }
        int[] pixels = new int[w * h];
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h);
        bitmap.recycle();

        int[] colMax = new int[w];
        int[] rowMax = new int[h];
        for (int y = 0; y < h; y++) {
            int offset = y * w;
            for (int x = 0; x < w; x++) {
                int pixel = pixels[offset + x];
                int luma = (((pixel >> 16) & 0xff) * 77
                    + ((pixel >> 8) & 0xff) * 150
                    + (pixel & 0xff) * 29) >> 8;
                if (luma > colMax[x]) colMax[x] = luma;
                if (luma > rowMax[y]) rowMax[y] = luma;
            }
        }

        final int threshold = 36;
        int left = 0;
        while (left < w && colMax[left] < threshold) left++;
        int right = w - 1;
        while (right > left && colMax[right] < threshold) right--;
        int top = 0;
        while (top < h && rowMax[top] < threshold) top++;
        int bottom = h - 1;
        while (bottom > top && rowMax[bottom] < threshold) bottom--;
        if (left >= right || top >= bottom) {
            // Entirely black sample (fade in/out or seek). Try again later.
            scheduleDetect(1500);
            return;
        }

        float fracW = (right - left + 1) / (float) w;
        float fracH = (bottom - top + 1) / (float) h;
        if (fracW < 0.5f || fracH < 0.5f) return;
        // Bars are symmetric; asymmetric reads are usually dark scenes or logos.
        if (Math.abs(left - (w - 1 - right)) > Math.max(2, Math.round(w * 0.04f))) return;
        if (Math.abs(top - (h - 1 - bottom)) > Math.max(2, Math.round(h * 0.06f))) return;

        android.util.Log.d("DrivePlay", "detectContentAspect frame=" + w + "x" + h
            + " content=" + (right - left + 1) + "x" + (bottom - top + 1)
            + " frac=" + fracW + "x" + fracH);

        boolean hasBars = fracW < 0.985f || fracH < 0.985f;
        if (hasBars) {
            // Bars are baked into the file, so a single clean read is reliable.
            if (barsCount == 0) {
                barsWSum = fracW;
                barsHSum = fracH;
                barsCount = 1;
            } else {
                float avgW = barsWSum / barsCount;
                float avgH = barsHSum / barsCount;
                if (Math.abs(fracW - avgW) > 0.04f || Math.abs(fracH - avgH) > 0.04f) {
                    return;
                }
                barsWSum += fracW;
                barsHSum += fracH;
                barsCount++;
            }
            contentFracW = barsWSum / barsCount;
            contentFracH = barsHSum / barsCount;
        } else {
            // Dark scene: the whole frame reads as "content". Only trust it when
            // no sample ever found bars.
            fullCount++;
            if (barsCount > 0 || fullCount < 2) return;
            contentFracW = 1f;
            contentFracH = 1f;
        }

        lastWidth = -1;
        lastHeight = -1;
        layoutVideo();
    }

    private void scheduleDetect(long delayMs) {
        if (destroyed) return;
        main.postDelayed(new Runnable() {
            @Override public void run() { detectContentAspect(); }
        }, delayMs);
    }

    void onSizeChanged() {
        layoutVideo();
    }

    void destroy() {
        destroyed = true;
        main.removeCallbacks(pump);
        destroyProbe();
        io.shutdownNow();
        releasePlayer();
        if (videoView != null && videoView.getParent() == layer) {
            layer.removeView(videoView);
        }
        videoView = null;
    }

    private void releasePlayer() {
        lastCueText = "";
        if (player != null) {
            try {
                player.clearVideoSurface();
                player.release();
            } catch (Exception ignored) {
                // Already released.
            }
            player = null;
        }
        releaseSurface();
        surfaceAttached = false;
    }

    String lastError() {
        return lastError;
    }

    void refresh() {
        pushState();
        if (!TextUtils.isEmpty(lastCueText)) {
            try {
                JSONObject json = new JSONObject();
                json.put("cues", lastCueText);
                listener.onState(json.toString());
            } catch (Exception ignored) {
                // No cue to restore.
            }
        }
    }

    void detectNow() {
        detectContentAspect();
    }

    /** Re-attaches the current SurfaceTexture after a display/config change. */
    void refreshSurface() {
        if (surfaceAttached || videoView == null) return;
        SurfaceTexture texture = videoView.getSurfaceTexture();
        if (texture != null) attachSurface(texture);
    }

    /** Re-creates the video Surface after the window moved to another display. */
    void forceSurfaceRefresh() {
        if (videoView == null) return;
        detachSurface();
        videoView.requestLayout();
        videoView.invalidate();
        main.postDelayed(new Runnable() {
            @Override public void run() {
                reattachSurface();
            }
        }, 80);
        main.postDelayed(new Runnable() {
            @Override public void run() {
                reattachSurface();
            }
        }, 360);
    }

    private void reattachSurface() {
        if (destroyed || videoView == null) return;
        SurfaceTexture texture = videoView.getSurfaceTexture();
        if (texture != null) {
            attachSurface(texture);
        } else {
            videoView.requestLayout();
            videoView.invalidate();
        }
        layoutVideo();
    }
}
