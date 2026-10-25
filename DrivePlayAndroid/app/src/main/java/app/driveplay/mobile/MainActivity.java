package app.driveplay.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.MediaController;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final int REQ_PICK_VIDEO = 41;
    private static final String PREFS = "driveplay";
    private static final String USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; SM-F741B) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    private FrameLayout root;
    private WebView appView;
    private Handler handler;

    private View activeOverlay;
    private View activeTopBar;
    private TextView activeTitleView;
    private TextView activeFillButton;
    private WebView playerView;
    private WebView folderView;
    private VideoView localVideoView;
    private FrameLayout localVideoFrame;
    private MediaController localController;
    private MediaMetadataRetriever localMetadata;

    private View customView;
    private FrameLayout customHost;
    private WebChromeClient.CustomViewCallback customCallback;
    private boolean customFullscreen;
    private boolean chromeHidden;
    private boolean videoDetected;
    private boolean autoFullscreenSuppressed;
    private long lastActivity;

    private String settingsJson = "{}";
    private String currentFileId = "";
    private String currentTitle = "";
    private List<MediaItem> playlist = new ArrayList<>();
    private int playlistIndex = -1;
    private boolean fillScreen;

    private String pendingLink;
    private boolean pageReady;
    private boolean localPrepared;
    private float localAspect;

    private Runnable autoFullscreenLoop;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        handler = new Handler(Looper.getMainLooper());
        settingsJson = prefs().getString("settings", "{}");
        fillScreen = readFillScreen(settingsJson);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#0b0c10"));
        window.setNavigationBarColor(Color.parseColor("#0b0c10"));
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0c10"));
        setupInsets(root);

        appView = new WebView(this);
        configureWebView(appView);
        appView.addJavascriptInterface(new AppBridge(), "Android");
        appView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    openExternal(uri.toString());
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                appView.evaluateJavascript("window.__dpNativeReady && window.__dpNativeReady();", null);
                deliverPendingLink();
            }
        });
        appView.loadUrl("file:///android_asset/index.html");
        root.addView(appView, match());
        setContentView(root);

        setupAutoFullscreenLoop();
        root.requestApplyInsets();
        handleIntent(getIntent());
    }

    private void setupInsets(final FrameLayout container) {
        container.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                int left = 0;
                int top = 0;
                int right = 0;
                int bottom = 0;

                if (Build.VERSION.SDK_INT >= 30) {
                    Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                    );
                    Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    left = bars.left;
                    top = bars.top;
                    right = bars.right;
                    bottom = Math.max(bars.bottom, ime.bottom);
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }

                if (chromeHidden) {
                    view.setPadding(0, 0, 0, 0);
                } else if (view.getPaddingLeft() != left || view.getPaddingTop() != top ||
                    view.getPaddingRight() != right || view.getPaddingBottom() != bottom) {
                    view.setPadding(left, top, right, bottom);
                }
                return insets;
            }
        });
    }

    private void setupAutoFullscreenLoop() {
        autoFullscreenLoop = new Runnable() {
            @Override
            public void run() {
                if (activeOverlay != null && !customFullscreen && !autoFullscreenSuppressed &&
                    autoFullscreenEnabled()) {
                    if (videoDetected && !chromeHidden &&
                        SystemClock.elapsedRealtime() - lastActivity >= 5000) {
                        hideChromeAndBars();
                    }
                }
                handler.postDelayed(this, 900);
            }
        };
        handler.postDelayed(autoFullscreenLoop, 900);
    }

    private void configureWebView(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(USER_AGENT);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(Color.BLACK);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    private FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
    }

    private LinearLayout.LayoutParams linearMatch(int height) {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height);
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            getResources().getDisplayMetrics()
        ));
    }

    private void showPlayer(String fileId, String title, String playlistJson) {
        if (TextUtils.isEmpty(fileId)) {
            toast("Link de vídeo inválido.");
            return;
        }

        closeActiveOverlay();
        currentFileId = fileId;
        currentTitle = cleanTitle(title, "Vídeo do Drive");
        fillScreen = readFillScreen(settingsJson);
        playlist = parsePlaylist(playlistJson, fileId, currentTitle);
        playlistIndex = findPlaylistIndex(fileId);

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.BLACK);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.BLACK);

        activeTopBar = buildTopBar(
            currentTitle,
            new Runnable() { @Override public void run() { closeActiveOverlay(); } },
            new Runnable() { @Override public void run() { openCurrentInChrome(); } },
            new Runnable() { @Override public void run() { toggleChrome(); } },
            new Runnable() { @Override public void run() { toggleFillScreen(); } }
        );
        activeTitleView = (TextView) activeTopBar.findViewWithTag("title");

        playerView = new WebView(this);
        configureWebView(playerView);
        playerView.addJavascriptInterface(new PlayerBridge(), "PlayerBridge");
        playerView.setWebChromeClient(new PlayerChromeClient());
        playerView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handlePlayerUrl(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectPlayerScript();
            }
        });
        playerView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View view, android.view.MotionEvent event) {
                userTouched();
                return false;
            }
        });

        column.addView(activeTopBar, linearMatch(dp(56)));
        column.addView(playerView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ));
        overlay.addView(column, match());
        root.addView(overlay, match());

        activeOverlay = overlay;
        chromeHidden = false;
        videoDetected = false;
        autoFullscreenSuppressed = false;
        lastActivity = SystemClock.elapsedRealtime();
        updateFillButton();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        addLibraryToApp(fileId, currentTitle, "https://drive.google.com/file/d/" + fileId + "/view");
        loadPlayerFile(fileId, currentTitle);
    }

    private void loadPlayerFile(String fileId, String title) {
        currentFileId = fileId;
        currentTitle = cleanTitle(title, "Vídeo do Drive");
        if (activeTitleView != null) activeTitleView.setText(currentTitle);
        videoDetected = false;
        autoFullscreenSuppressed = false;
        lastActivity = SystemClock.elapsedRealtime();
        if (playerView != null) {
            playerView.loadUrl("https://drive.google.com/file/d/" + fileId + "/preview");
        }
    }

    private List<MediaItem> parsePlaylist(String json, String fileId, String title) {
        List<MediaItem> items = new ArrayList<>();
        if (!TextUtils.isEmpty(json)) {
            try {
                JSONArray array = new JSONArray(json);
                for (int i = 0; i < array.length(); i++) {
                    JSONObject object = array.optJSONObject(i);
                    if (object == null) continue;
                    String id = object.optString("id", "");
                    String name = object.optString("title", "Vídeo do Drive");
                    if (!TextUtils.isEmpty(id)) items.add(new MediaItem(id, cleanTitle(name, "Vídeo do Drive")));
                }
            } catch (Exception ignored) {
                /* A malformed playlist should never prevent the current video. */
            }
        }

        boolean found = false;
        for (MediaItem item : items) {
            if (fileId.equals(item.id)) {
                found = true;
                break;
            }
        }
        if (!found) items.add(0, new MediaItem(fileId, title));
        return items;
    }

    private int findPlaylistIndex(String fileId) {
        for (int i = 0; i < playlist.size(); i++) {
            if (fileId.equals(playlist.get(i).id)) return i;
        }
        return 0;
    }

    private void playNext() {
        if (playlistIndex >= 0 && playlistIndex + 1 < playlist.size()) {
            playlistIndex++;
            MediaItem next = playlist.get(playlistIndex);
            addLibraryToApp(next.id, next.title, "https://drive.google.com/file/d/" + next.id + "/view");
            loadPlayerFile(next.id, next.title);
        } else if (playerView != null) {
            playerView.evaluateJavascript(
                "(function(){var v=document.querySelector('video');if(v&&isFinite(v.duration)){v.currentTime=Math.max(0,v.duration-0.4);}})();",
                null
            );
        }
    }

    private View buildTopBar(String title, Runnable back, Runnable chrome, Runnable fullscreen, Runnable fill) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#16171c"));
        bar.setPadding(dp(5), 0, dp(7), 0);
        bar.setElevation(dp(6));

        TextView backView = new TextView(this);
        backView.setText("‹");
        backView.setTextSize(30);
        backView.setGravity(Gravity.CENTER);
        backView.setTextColor(Color.parseColor("#f3f4f7"));
        backView.setLayoutParams(new LinearLayout.LayoutParams(dp(40), ViewGroup.LayoutParams.MATCH_PARENT));
        backView.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { back.run(); }
        });
        bar.addView(backView);

        TextView titleView = new TextView(this);
        titleView.setTag("title");
        titleView.setText(title);
        titleView.setTextSize(14);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setTextColor(Color.parseColor("#f3f4f7"));
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setPadding(dp(3), 0, dp(6), 0);
        titleView.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        bar.addView(titleView);

        if (chrome != null) {
            TextView chromeView = topbarButton("Chrome");
            chromeView.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { chrome.run(); }
            });
            bar.addView(chromeView);
        }

        if (fill != null) {
            activeFillButton = topbarButton("Preencher");
            activeFillButton.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { fill.run(); }
            });
            bar.addView(activeFillButton);
        } else {
            activeFillButton = null;
        }

        if (fullscreen != null) {
            TextView fullscreenView = topbarButton("⛶");
            fullscreenView.setTextSize(20);
            fullscreenView.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { fullscreen.run(); }
            });
            bar.addView(fullscreenView);
        }

        return bar;
    }

    private TextView topbarButton(String text) {
        TextView button = new TextView(this);
        button.setText(text);
        button.setTextSize(11);
        button.setTextColor(Color.parseColor("#c9cdd8"));
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(9), 0, dp(9), 0);
        button.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        return button;
    }

    private void updateFillButton() {
        if (activeFillButton == null) return;
        activeFillButton.setText("Preencher");
        activeFillButton.setTextColor(fillScreen
            ? Color.parseColor("#8aa4ff")
            : Color.parseColor("#c9cdd8"));
        activeFillButton.setTypeface(null, fillScreen ? Typeface.BOLD : Typeface.NORMAL);
    }

    private void toggleFillScreen() {
        fillScreen = !fillScreen;
        lastActivity = SystemClock.elapsedRealtime();
        updateFillButton();
        persistFillScreen();

        if (playerView != null) {
            playerView.evaluateJavascript(
                "window.__dpSetFill && window.__dpSetFill(" + fillScreen + ");",
                null
            );
            toast(fillScreen
                ? "Tela preenchida — as bordas podem ser cortadas."
                : "Tamanho original restaurado.");
        } else if (localVideoView != null) {
            applyLocalFill();
            toast(fillScreen
                ? "Tela preenchida — as bordas podem ser cortadas."
                : "Tamanho original restaurado.");
        }
    }

    private void persistFillScreen() {
        try {
            JSONObject object = new JSONObject(settingsJson);
            object.put("fillScreen", fillScreen);
            settingsJson = object.toString();
            prefs().edit().putString("settings", settingsJson).apply();
        } catch (Exception ignored) {
            /* Keep the in-memory preference even if the JSON is malformed. */
        }
        if (appView != null) {
            appView.evaluateJavascript(
                "window.__dpFillSettingChanged && window.__dpFillSettingChanged(" + fillScreen + ");",
                null
            );
        }
    }

    private boolean readFillScreen(String json) {
        try {
            return new JSONObject(json).optBoolean("fillScreen", false);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void showFolder(String url, String title) {
        closeActiveOverlay();
        String folderUrl = normalizeFolderUrl(url);

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.BLACK);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.BLACK);

        activeTopBar = buildTopBar(
            cleanTitle(title, "Pasta do Drive"),
            new Runnable() { @Override public void run() { closeActiveOverlay(); } },
            new Runnable() { @Override public void run() { openExternal(folderUrl); } },
            null,
            null
        );
        activeTitleView = (TextView) activeTopBar.findViewWithTag("title");

        folderView = new WebView(this);
        configureWebView(folderView);
        folderView.addJavascriptInterface(new FolderBridge(), "FolderBridge");
        folderView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onReceivedTitle(WebView view, String receivedTitle) {
                if (activeTitleView != null && !TextUtils.isEmpty(receivedTitle)) {
                    activeTitleView.setText(receivedTitle);
                }
            }
        });
        folderView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleFolderUrl(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String loadedUrl) {
                injectFolderScript();
            }
        });
        folderView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View view, android.view.MotionEvent event) {
                lastActivity = SystemClock.elapsedRealtime();
                return false;
            }
        });

        column.addView(activeTopBar, linearMatch(dp(56)));
        column.addView(folderView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ));
        overlay.addView(column, match());
        root.addView(overlay, match());

        activeOverlay = overlay;
        chromeHidden = false;
        videoDetected = false;
        autoFullscreenSuppressed = false;
        lastActivity = SystemClock.elapsedRealtime();
        folderView.loadUrl(folderUrl);
    }

    private String normalizeFolderUrl(String url) {
        String value = url == null ? "" : url.trim();
        if (value.isEmpty()) return "https://drive.google.com";
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "https://" + value;
        }
        return value;
    }

    private void showLocalVideo(Uri uri, String title) {
        closeActiveOverlay();

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.BLACK);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.BLACK);

        fillScreen = readFillScreen(settingsJson);
        activeTopBar = buildTopBar(
            cleanTitle(title, "Vídeo local"),
            new Runnable() { @Override public void run() { closeActiveOverlay(); } },
            null,
            new Runnable() { @Override public void run() { toggleChrome(); } },
            new Runnable() { @Override public void run() { toggleFillScreen(); } }
        );
        activeTitleView = (TextView) activeTopBar.findViewWithTag("title");
        updateFillButton();

        localVideoFrame = new FrameLayout(this);
        localVideoFrame.setBackgroundColor(Color.BLACK);
        localVideoFrame.setClipChildren(true);
        localVideoFrame.setClipToPadding(true);

        localVideoView = new VideoView(this);
        localVideoView.setBackgroundColor(Color.BLACK);
        localController = new MediaController(this);
        localController.setAnchorView(localVideoView);
        localVideoView.setMediaController(localController);
        localVideoView.setVideoURI(uri);
        localVideoView.setOnPreparedListener(new android.media.MediaPlayer.OnPreparedListener() {
            @Override
            public void onPrepared(android.media.MediaPlayer mediaPlayer) {
                localPrepared = true;
                localAspect = readVideoAspect(uri);
                applyLocalFill();
                localVideoView.start();
                videoDetected = true;
                lastActivity = SystemClock.elapsedRealtime();
                if (localController != null) localController.show(0);
            }
        });
        localVideoView.setOnCompletionListener(new android.media.MediaPlayer.OnCompletionListener() {
            @Override
            public void onCompletion(android.media.MediaPlayer mediaPlayer) {
                videoDetected = false;
                showChromeAndBars();
                if (localController != null) localController.show(0);
            }
        });
        localVideoView.setOnErrorListener(new android.media.MediaPlayer.OnErrorListener() {
            @Override
            public boolean onError(android.media.MediaPlayer mediaPlayer, int what, int extra) {
                videoDetected = false;
                showChromeAndBars();
                toast("Não foi possível reproduzir este vídeo.");
                return true;
            }
        });
        localVideoView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View view, android.view.MotionEvent event) {
                userTouched();
                return false;
            }
        });

        localVideoFrame.addView(localVideoView, match());
        column.addView(activeTopBar, linearMatch(dp(56)));
        column.addView(localVideoFrame, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ));
        overlay.addView(column, match());
        root.addView(overlay, match());

        activeOverlay = overlay;
        chromeHidden = false;
        videoDetected = false;
        autoFullscreenSuppressed = false;
        lastActivity = SystemClock.elapsedRealtime();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private float readVideoAspect(Uri uri) {
        try {
            localMetadata = new MediaMetadataRetriever();
            localMetadata.setDataSource(this, uri);
            String width = localMetadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String height = localMetadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            float w = Float.parseFloat(width == null ? "0" : width);
            float h = Float.parseFloat(height == null ? "0" : height);
            if (w > 0 && h > 0) return w / h;
        } catch (Exception ignored) {
            /* Fall back to the view's own aspect. */
        }
        return 0f;
    }

    private void applyLocalFill() {
        if (localVideoView == null || localVideoFrame == null) return;
        if (!fillScreen || localAspect <= 0f) {
            localVideoView.setScaleX(1f);
            localVideoView.setScaleY(1f);
            return;
        }

        localVideoFrame.post(new Runnable() {
            @Override
            public void run() {
                if (localVideoView == null || localVideoFrame == null) return;
                float viewWidth = localVideoFrame.getWidth();
                float viewHeight = localVideoFrame.getHeight();
                if (viewWidth <= 0 || viewHeight <= 0) return;
                float viewAspect = viewWidth / viewHeight;
                float scale = localAspect > viewAspect
                    ? localAspect / viewAspect
                    : viewAspect / localAspect;
                scale = Math.min(2.6f, Math.max(1f, scale));
                localVideoView.setScaleX(scale);
                localVideoView.setScaleY(scale);
            }
        });
    }

    private void injectPlayerScript() {
        if (playerView == null) return;
        String script = buildPlayerScript(currentFileId, settingsJson);
        playerView.evaluateJavascript(script, null);
    }

    private String buildPlayerScript(String fileId, String settings) {
        return "(function(){\n" +
            "if (window.__dpPlayerTimer) return;\n" +
            "window.__dpPlayerTimer = true;\n" +
            "var settings = {};\n" +
            "try { settings = JSON.parse(" + JSONObject.quote(settings) + "); } catch(e) {}\n" +
            "window.__dpSettings = settings;\n" +
            "var fileId = " + JSONObject.quote(fileId) + ";\n" +
            "var introDone = false;\n" +
            "var endSent = false;\n" +
            "var resumeTried = false;\n" +
            "var lastTitle = '';\n" +
            "var lastSave = 0;\n" +
            "function findVideo(){\n" +
            "  var v = document.querySelector('video');\n" +
            "  if (v) return v;\n" +
            "  var frames = document.querySelectorAll('iframe');\n" +
            "  for (var i=0;i<frames.length;i++){ try { var d=frames[i].contentDocument; if(d){ var x=d.querySelector('video'); if(x) return x; } } catch(e){} }\n" +
            "  return null;\n" +
            "}\n" +
            "function notifyTitle(){\n" +
            "  var t = (document.title || '').replace(/\\s*[-–—]\\s*Google Drive\\s*$/i,'').trim();\n" +
            "  if (t && t !== lastTitle) { lastTitle = t; try { PlayerBridge.onTitle(t); } catch(e){} }\n" +
            "}\n" +
            "function resumeKey(){ return 'dp.resume.' + fileId; }\n" +
            "function saveResume(v){\n" +
            "  if (!settings.resumePlayback || !v || !isFinite(v.currentTime)) return;\n" +
            "  var now = Date.now();\n" +
            "  if (now - lastSave < 4000) return;\n" +
            "  lastSave = now;\n" +
            "  try { if (v.currentTime > 5) localStorage.setItem(resumeKey(), String(v.currentTime)); } catch(e){}\n" +
            "}\n" +
            "function tick(){\n" +
            "  var v = findVideo();\n" +
            "  if (v) {\n" +
            "    var dur = isFinite(v.duration) ? v.duration : 0;\n" +
            "    var pos = isFinite(v.currentTime) ? v.currentTime : 0;\n" +
            "    try { PlayerBridge.onVideoState(true, dur, pos, !!v.paused); } catch(e){}\n" +
            "    if (!resumeTried && settings.resumePlayback && dur > 0) {\n" +
            "      resumeTried = true;\n" +
            "      try { var saved = parseFloat(localStorage.getItem(resumeKey()) || '0'); if (saved > 8 && saved < dur - 12) v.currentTime = saved; } catch(e){}\n" +
            "    }\n" +
            "    if (settings.skipIntro && !introDone && settings.introSeconds > 0 && dur > settings.introSeconds + 15 && pos > 0.8 && pos < settings.introSeconds - 2) {\n" +
            "      try { v.currentTime = settings.introSeconds; introDone = true; } catch(e){}\n" +
            "    }\n" +
            "    if (settings.skipIntro && pos >= (settings.introSeconds || 0) - 1) introDone = true;\n" +
            "    if (settings.skipEnding && !endSent && dur > settings.endingSeconds + 60 && pos > 10 && (dur - pos) <= settings.endingSeconds) {\n" +
            "      endSent = true;\n" +
            "      try { localStorage.removeItem(resumeKey()); } catch(e){}\n" +
            "      if (settings.autoNext !== false) { try { PlayerBridge.next(); } catch(e){} }\n" +
            "      else { try { PlayerBridge.seekEnd(); } catch(e){} }\n" +
            "    }\n" +
            "    saveResume(v);\n" +
            "    notifyTitle();\n" +
            "  } else {\n" +
            "    try { PlayerBridge.onVideoState(false, 0, 0, true); } catch(e){}\n" +
            "  }\n" +
            "  setTimeout(tick, 900);\n" +
            "}\n" +
            "function activity(){ try { PlayerBridge.onActivity(); } catch(e){} }\n" +
            "['touchstart','mousedown','mousemove','keydown','wheel','scroll'].forEach(function(ev){\n" +
            "  document.addEventListener(ev, activity, {passive:true, capture:true});\n" +
            "});\n" +
            "window.__dpSetFill = function(on){\n" +
            "  var old = document.getElementById('dp-fill-style');\n" +
            "  if (!on) { if (old) old.textContent = ''; return; }\n" +
            "  var style = old;\n" +
            "  if (!style) { style = document.createElement('style'); style.id = 'dp-fill-style'; (document.head || document.documentElement).appendChild(style); }\n" +
            "  style.textContent = 'html,body{background:#000!important;overflow:hidden!important;}' +\n" +
            "    'video{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;object-fit:cover!important;z-index:2147483000!important;background:#000!important;}';\n" +
            "};\n" +
            "window.__dpTryFullscreen = function(){\n" +
            "  var v = findVideo(); if (!v) return;\n" +
            "  try { if (v.requestFullscreen) v.requestFullscreen(); else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); } catch(e){}\n" +
            "};\n" +
            "window.__dpSeekEnd = function(){ var v=findVideo(); if(v && isFinite(v.duration)) v.currentTime = Math.max(0, v.duration - 0.5); };\n" +
            "if (settings.fillScreen) setTimeout(function(){ window.__dpSetFill(true); }, 300);\n" +
            "setTimeout(tick, 500);\n" +
            "})();";
    }

    private void injectFolderScript() {
        if (folderView == null) return;
        String script =
            "(function(){\n" +
            "if (window.__dpFolderHooked) return;\n" +
            "window.__dpFolderHooked = true;\n" +
            "function idFrom(href){ var m = String(href||'').match(/\\/file\\/d\\/([a-zA-Z0-9_-]+)/); return m ? m[1] : null; }\n" +
            "function label(a){ var t = a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent || 'Vídeo do Drive'; t = t.replace(/\\s+/g,' ').trim(); return t || 'Vídeo do Drive'; }\n" +
            "function scan(){\n" +
            "  var links = document.querySelectorAll('a[href*=\"/file/d/\"]');\n" +
            "  var items = [];\n" +
            "  for (var i=0;i<links.length;i++){ var id=idFrom(links[i].href); if(id) items.push({id:id,title:label(links[i])}); }\n" +
            "  window.__dpFolderItems = items;\n" +
            "  for (var j=0;j<links.length;j++){\n" +
            "    var a=links[j]; if(a.__dpHooked) continue; a.__dpHooked=true;\n" +
            "    (function(el){\n" +
            "      el.addEventListener('click', function(e){\n" +
            "        var id=idFrom(el.href); if(!id) return;\n" +
            "        e.preventDefault(); e.stopPropagation();\n" +
            "        var list = window.__dpFolderItems || [];\n" +
            "        try { FolderBridge.openFile(id, label(el), JSON.stringify(list)); } catch(err) {}\n" +
            "      }, true);\n" +
            "    })(a);\n" +
            "  }\n" +
            "}\n" +
            "setInterval(scan, 1200);\n" +
            "scan();\n" +
            "window.__dpScanFolder = scan;\n" +
            "})();";
        folderView.evaluateJavascript(script, null);
    }

    private boolean handlePlayerUrl(Uri uri) {
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (host.endsWith("google.com") || host.endsWith("gstatic.com") ||
            host.endsWith("googleusercontent.com") || host.endsWith("youtube.com") ||
            host.endsWith("ytimg.com")) {
            return false;
        }
        openExternal(uri.toString());
        return true;
    }

    private boolean handleFolderUrl(Uri uri) {
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (host.endsWith("drive.google.com") || host.endsWith("docs.google.com")) {
            String id = extractFileId(uri.toString());
            if (id != null) {
                showPlayer(id, "Vídeo do Drive", null);
                return true;
            }
            return false;
        }
        if (host.endsWith("google.com") || host.endsWith("gstatic.com") ||
            host.endsWith("googleusercontent.com") || host.endsWith("youtube.com")) {
            return false;
        }
        openExternal(uri.toString());
        return true;
    }

    private String extractFileId(String url) {
        Pattern pattern = Pattern.compile("/file/d/([a-zA-Z0-9_-]{10,})");
        Matcher matcher = pattern.matcher(url == null ? "" : url);
        return matcher.find() ? matcher.group(1) : null;
    }

    private void userTouched() {
        lastActivity = SystemClock.elapsedRealtime();
        if (chromeHidden) {
            showChromeAndBars();
        } else if (localController != null) {
            localController.show(0);
        }
    }

    private void toggleChrome() {
        lastActivity = SystemClock.elapsedRealtime();
        if (chromeHidden) showChromeAndBars();
        else hideChromeAndBars();
    }

    private void hideChromeAndBars() {
        if (activeTopBar != null) activeTopBar.setVisibility(View.GONE);
        if (localController != null) localController.hide();
        chromeHidden = true;
        if (root != null) root.setPadding(0, 0, 0, 0);
        hideSystemBars();
    }

    private void showChromeAndBars() {
        if (activeTopBar != null) activeTopBar.setVisibility(View.VISIBLE);
        chromeHidden = false;
        autoFullscreenSuppressed = true;
        if (root != null) root.requestApplyInsets();
        if (localController != null) localController.show(0);
        showSystemBars();
        lastActivity = SystemClock.elapsedRealtime();
    }

    private void hideSystemBars() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    private void showSystemBars() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
    }

    private void closeActiveOverlay() {
        hideCustomViewInternal();

        if (activeOverlay != null) {
            root.removeView(activeOverlay);
            activeOverlay = null;
        }
        if (playerView != null) {
            playerView.loadUrl("about:blank");
            playerView.destroy();
            playerView = null;
        }
        if (folderView != null) {
            folderView.loadUrl("about:blank");
            folderView.destroy();
            folderView = null;
        }
        if (localVideoView != null) {
            try { localVideoView.stopPlayback(); } catch (Exception ignored) {}
            localVideoView = null;
        }
        if (localMetadata != null) {
            try { localMetadata.release(); } catch (Exception ignored) {}
            localMetadata = null;
        }
        localController = null;
        localVideoFrame = null;
        localPrepared = false;
        localAspect = 0f;

        activeTopBar = null;
        activeTitleView = null;
        activeFillButton = null;
        playlist = new ArrayList<>();
        playlistIndex = -1;
        currentFileId = "";
        currentTitle = "";
        videoDetected = false;
        chromeHidden = false;
        autoFullscreenSuppressed = false;
        customFullscreen = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showSystemBars();
        if (root != null) root.requestApplyInsets();
    }

    private void openCurrentInChrome() {
        if (!TextUtils.isEmpty(currentFileId)) {
            openExternal("https://drive.google.com/file/d/" + currentFileId + "/view");
        }
    }

    private void addLibraryToApp(String id, String title, String url) {
        if (appView == null || TextUtils.isEmpty(id)) return;
        appView.evaluateJavascript(
            "window.__dpAddLibrary && window.__dpAddLibrary('file'," +
                JSONObject.quote(id) + "," + JSONObject.quote(title) + "," +
                JSONObject.quote(url) + ");",
            null
        );
    }

    private void updateTitle(String title) {
        String clean = cleanTitle(title, currentTitle);
        if (TextUtils.isEmpty(clean)) return;
        currentTitle = clean;
        if (activeTitleView != null) activeTitleView.setText(clean);
        if (playlistIndex >= 0 && playlistIndex < playlist.size()) {
            playlist.get(playlistIndex).title = clean;
        }
        if (!TextUtils.isEmpty(currentFileId)) {
            addLibraryToApp(currentFileId, clean, "https://drive.google.com/file/d/" + currentFileId + "/view");
            if (appView != null) {
                appView.evaluateJavascript(
                    "window.__dpUpdateTitle && window.__dpUpdateTitle(" +
                        JSONObject.quote(currentFileId) + "," + JSONObject.quote(clean) + ");",
                    null
                );
            }
        }
    }

    private String cleanTitle(String title, String fallback) {
        String value = title == null ? "" : title.trim();
        value = value.replaceAll("(?i)\\s*[-–—]\\s*Google Drive\\s*$", "");
        value = value.replaceAll("(?i)^Google Drive\\s*[-–—]\\s*", "");
        value = value.replaceAll("\\s+", " ").trim();
        if (value.isEmpty() || value.equalsIgnoreCase("Google Drive")) {
            return fallback == null ? "Vídeo do Drive" : fallback;
        }
        return value;
    }

    private boolean autoFullscreenEnabled() {
        try {
            return new JSONObject(settingsJson).optBoolean("autoFullscreen", true);
        } catch (Exception ignored) {
            return true;
        }
    }

    private void hideCustomViewInternal() {
        if (customView == null) return;
        View view = customView;
        FrameLayout host = customHost;
        WebChromeClient.CustomViewCallback callback = customCallback;
        customView = null;
        customHost = null;
        customCallback = null;
        customFullscreen = false;
        if (host != null) root.removeView(host);
        if (callback != null) {
            try { callback.onCustomViewHidden(); } catch (Exception ignored) {}
        }
        if (view != null && view.getParent() instanceof ViewGroup) {
            ((ViewGroup) view.getParent()).removeView(view);
        }
        if (activeTopBar != null) activeTopBar.setVisibility(View.VISIBLE);
        showSystemBars();
    }

    private class PlayerChromeClient extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customCallback = callback;
            customFullscreen = true;
            customHost = new FrameLayout(MainActivity.this);
            customHost.setBackgroundColor(Color.BLACK);
            customHost.addView(view, match());
            root.addView(customHost, match());
            if (activeTopBar != null) activeTopBar.setVisibility(View.GONE);
            root.setPadding(0, 0, 0, 0);
            hideSystemBars();
        }

        @Override
        public void onHideCustomView() {
            hideCustomViewInternal();
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            updateTitle(title);
        }
    }

    private class PlayerBridge {
        @JavascriptInterface
        public void onVideoState(boolean hasVideo, double duration, double position, boolean paused) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (playerView == null) return;
                    if (hasVideo) {
                        if (!videoDetected) {
                            videoDetected = true;
                            lastActivity = SystemClock.elapsedRealtime();
                        }
                    } else {
                        videoDetected = false;
                    }
                }
            });
        }

        @JavascriptInterface
        public void onActivity() {
            runOnUiThread(new Runnable() {
                @Override public void run() { userTouched(); }
            });
        }

        @JavascriptInterface
        public void onTitle(final String title) {
            runOnUiThread(new Runnable() {
                @Override public void run() { updateTitle(title); }
            });
        }

        @JavascriptInterface
        public void next() {
            runOnUiThread(new Runnable() {
                @Override public void run() { playNext(); }
            });
        }

        @JavascriptInterface
        public void seekEnd() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (playerView != null) {
                        playerView.evaluateJavascript(
                            "(function(){var v=document.querySelector('video');if(v&&isFinite(v.duration))v.currentTime=Math.max(0,v.duration-0.5);})();",
                            null
                        );
                    }
                }
            });
        }

        @JavascriptInterface
        public void close() {
            runOnUiThread(new Runnable() {
                @Override public void run() { closeActiveOverlay(); }
            });
        }

        @JavascriptInterface
        public void fullscreen() {
            runOnUiThread(new Runnable() {
                @Override public void run() { toggleChrome(); }
            });
        }
    }

    private class FolderBridge {
        @JavascriptInterface
        public void openFile(final String id, final String title, final String playlistJson) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (TextUtils.isEmpty(id)) return;
                    showPlayer(id, cleanTitle(title, "Vídeo do Drive"), playlistJson);
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(new Runnable() {
                @Override public void run() { MainActivity.this.openExternal(url); }
            });
        }

        @JavascriptInterface
        public void close() {
            runOnUiThread(new Runnable() {
                @Override public void run() { closeActiveOverlay(); }
            });
        }
    }

    private class AppBridge {
        @JavascriptInterface
        public void openFile(final String id, final String title, final String settings,
                              final String playlistJson) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applySettings(settings);
                    showPlayer(id, title, playlistJson);
                }
            });
        }

        @JavascriptInterface
        public void openFile(String id, String title, String settings) {
            openFile(id, title, settings, null);
        }

        @JavascriptInterface
        public void openFolder(final String url, final String title, final String settings) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applySettings(settings);
                    showFolder(url, title);
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(new Runnable() {
                @Override public void run() { MainActivity.this.openExternal(url); }
            });
        }

        @JavascriptInterface
        public void pickVideo() {
            runOnUiThread(new Runnable() {
                @Override public void run() { pickLocalVideo(); }
            });
        }

        @JavascriptInterface
        public String readClipboard() {
            return readClipboardText();
        }

        @JavascriptInterface
        public String getSettings() {
            return settingsJson;
        }

        @JavascriptInterface
        public void setSettings(final String json) {
            if (json == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    settingsJson = json;
                    prefs().edit().putString("settings", json).apply();
                }
            });
        }

        @JavascriptInterface
        public String getLaunchLink() {
            String value = pendingLink == null ? "" : pendingLink;
            pendingLink = null;
            return value;
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override public void run() { MainActivity.this.toast(message); }
            });
        }
    }

    private void applySettings(String json) {
        if (json == null || json.isEmpty()) return;
        settingsJson = json;
        fillScreen = readFillScreen(settingsJson);
        prefs().edit().putString("settings", settingsJson).apply();
    }

    private void pickLocalVideo() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQ_PICK_VIDEO);
        } catch (Exception error) {
            toast("Nenhum seletor de vídeos disponível.");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK_VIDEO || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null) return;
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            /* Some document providers do not offer persistable permissions. */
        }
        showLocalVideo(uri, displayName(uri));
    }

    private String displayName(Uri uri) {
        String name = null;
        try (android.database.Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {
            /* Fall back to a generic title. */
        }
        return TextUtils.isEmpty(name) ? "Vídeo local" : name;
    }

    private void openExternal(String url) {
        if (TextUtils.isEmpty(url)) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception error) {
            toast("Nenhum navegador disponível.");
        }
    }

    private String readClipboardText() {
        final String[] result = new String[]{""};
        final CountDownLatch latch = new CountDownLatch(1);
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    ClipboardManager manager =
                        (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (manager != null && manager.hasPrimaryClip() && manager.getPrimaryClip() != null) {
                        ClipData clip = manager.getPrimaryClip();
                        if (clip.getItemCount() > 0 && clip.getItemAt(0).coerceToText(MainActivity.this) != null) {
                            result[0] = clip.getItemAt(0).coerceToText(MainActivity.this).toString();
                        }
                    }
                } catch (Exception ignored) {
                    /* Clipboard access can fail on some OEM builds. */
                } finally {
                    latch.countDown();
                }
            }
        });
        try {
            latch.await(1500, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        return result[0] == null ? "" : result[0];
    }

    private void toast(String message) {
        try {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
            /* Never let a toast failure break playback. */
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String link = null;

        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            link = intent.getData().toString();
        } else if (Intent.ACTION_SEND.equals(action)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (!TextUtils.isEmpty(text)) {
                Matcher matcher = Pattern.compile("https?://\\S+").matcher(text);
                link = matcher.find() ? matcher.group() : text.trim();
            }
        }

        if (!TextUtils.isEmpty(link)) {
            pendingLink = link;
            deliverPendingLink();
        }
    }

    private void deliverPendingLink() {
        if (!pageReady || pendingLink == null || appView == null) return;
        String link = pendingLink;
        pendingLink = null;
        appView.evaluateJavascript(
            "window.__dpOpenLink && window.__dpOpenLink(" + JSONObject.quote(link) + ");",
            null
        );
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomViewInternal();
            return;
        }
        if (activeOverlay != null) {
            closeActiveOverlay();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (localVideoView != null && localVideoView.isPlaying()) {
            localVideoView.pause();
        }
        if (playerView != null) playerView.onPause();
        if (folderView != null) folderView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (playerView != null) playerView.onResume();
        if (folderView != null) folderView.onResume();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && chromeHidden) {
            if (root != null) root.setPadding(0, 0, 0, 0);
            hideSystemBars();
        }
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (root != null) root.requestApplyInsets();
        if (localVideoView != null) applyLocalFill();
    }

    @Override
    protected void onDestroy() {
        if (handler != null) {
            if (autoFullscreenLoop != null) handler.removeCallbacks(autoFullscreenLoop);
            handler.removeCallbacksAndMessages(null);
        }
        closeActiveOverlay();
        if (appView != null) {
            appView.destroy();
            appView = null;
        }
        super.onDestroy();
    }

    private static class MediaItem {
        final String id;
        String title;

        MediaItem(String id, String title) {
            this.id = id;
            this.title = title;
        }
    }
}
