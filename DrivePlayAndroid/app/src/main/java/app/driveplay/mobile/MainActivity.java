package app.driveplay.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
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
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final int REQ_PICK_VIDEO = 41;
    private static final String PREFS = "driveplay";
    private static final String MOBILE_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; SM-F741B) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    private static final String DESKTOP_USER_AGENT = DriveApi.USER_AGENT;

    private FrameLayout root;
    private WebView appView;
    private Handler handler;
    private ExecutorService io;
    private LibraryStore libraryStore;
    private final Map<String, String> assetCache = new HashMap<>();

    private FrameLayout playerOverlay;
    private WebView playerView;
    private WebView localPlayerView;
    private LinearLayout playerTopBar;
    private TextView playerTitleView;
    private TextView playerFillButton;
    private boolean playerIsLocal;
    private boolean playerOverlayActive;
    private boolean videoDetected;
    private boolean videoPlaying;
    private boolean chromeHidden;
    private boolean autoFullscreenSuppressed;
    private long lastActivity;

    private View customView;
    private FrameLayout customHost;
    private WebChromeClient.CustomViewCallback customCallback;
    private boolean customFullscreen;

    private String settingsJson = "{}";
    private String currentFileId = "";
    private String currentTitle = "";
    private List<MediaItem> playlist = new ArrayList<>();
    private int playlistIndex = -1;
    private boolean fillScreen;
    private boolean coverMode;

    private String pendingLink;
    private boolean pageReady;
    private boolean destroyed;

    private Runnable autoFullscreenLoop;
    private final Runnable resetAutoFullscreen = new Runnable() {
        @Override
        public void run() {
            autoFullscreenSuppressed = false;
            lastActivity = SystemClock.elapsedRealtime();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        handler = new Handler(Looper.getMainLooper());
        io = Executors.newSingleThreadExecutor();
        libraryStore = new LibraryStore(prefs());
        settingsJson = prefs().getString("settings", "{}");
        fillScreen = readFillScreen(settingsJson);
        coverMode = isCoverScreen();

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
        configureWebView(appView, false);
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
                appView.evaluateJavascript(
                    "window.__dpNativeReady && window.__dpNativeReady();", null);
                deliverPendingLink();
                applyCoverMode();
            }
        });
        appView.loadUrl("file:///android_asset/index.html");
        root.addView(appView, match());
        setContentView(root);

        setupAutoFullscreenLoop();
        root.requestApplyInsets();
        handleIntent(getIntent());
    }

    // ---------------------------------------------------------------------
    // Window, insets and cover screen
    // ---------------------------------------------------------------------

    private void setupInsets(final FrameLayout container) {
        container.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                int left;
                int top;
                int right;
                int bottom;

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

    private boolean isCoverScreen() {
        Configuration configuration = getResources().getConfiguration();
        int width = configuration.screenWidthDp;
        int height = configuration.screenHeightDp;
        if (width <= 0 || height <= 0) {
            width = Math.round(getResources().getDisplayMetrics().widthPixels /
                getResources().getDisplayMetrics().density);
            height = Math.round(getResources().getDisplayMetrics().heightPixels /
                getResources().getDisplayMetrics().density);
        }
        return width <= 430 && height <= 640 && width <= height + 100;
    }

    private void applyCoverMode() {
        coverMode = isCoverScreen();
        String command = "window.__dpSetCover && window.__dpSetCover(" + coverMode + ");";
        if (appView != null) {
            appView.evaluateJavascript(command, null);
        }
        if (playerView != null) {
            playerView.evaluateJavascript(command, null);
        }
        if (localPlayerView != null) {
            localPlayerView.evaluateJavascript(command, null);
        }
    }

    private void setupAutoFullscreenLoop() {
        autoFullscreenLoop = new Runnable() {
            @Override
            public void run() {
                if (destroyed) return;
                if (playerOverlay != null && videoDetected && videoPlaying && !chromeHidden &&
                    !autoFullscreenSuppressed && autoFullscreenEnabled() &&
                    SystemClock.elapsedRealtime() - lastActivity >= 5000) {
                    hideChromeAndBars();
                }
                handler.postDelayed(this, 800);
            }
        };
        handler.postDelayed(autoFullscreenLoop, 800);
    }

    private void configureWebView(WebView webView, boolean player) {
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
        settings.setUserAgentString(player ? DESKTOP_USER_AGENT : MOBILE_USER_AGENT);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

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

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            getResources().getDisplayMetrics()
        ));
    }

    // ---------------------------------------------------------------------
    // Player: Google Drive preview with a custom native + injected UI
    // ---------------------------------------------------------------------

    private void showPlayer(String fileId, String title, String playlistJson) {
        if (TextUtils.isEmpty(fileId)) {
            toast("Link de vídeo inválido.");
            return;
        }

        closePlayer();
        playerIsLocal = false;
        currentFileId = fileId;
        currentTitle = cleanTitle(title, "Vídeo do Drive");
        fillScreen = readFillScreen(settingsJson);
        playlist = parsePlaylist(playlistJson, fileId, currentTitle);
        playlistIndex = findPlaylistIndex(fileId);

        buildPlayerShell();

        playerView = new WebView(this);
        configureWebView(playerView, true);
        playerView.addJavascriptInterface(new PlayerBridge(), "PlayerBridge");
        playerView.setWebChromeClient(new PlayerChromeClient());
        playerView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handlePlayerUrl(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (destroyed || playerView == null) return;
                injectDrivePlayer();
                handler.postDelayed(new Runnable() {
                    @Override public void run() { injectDrivePlayer(); }
                }, 500);
                handler.postDelayed(new Runnable() {
                    @Override public void run() { injectDrivePlayer(); }
                }, 1500);
                handler.postDelayed(new Runnable() {
                    @Override public void run() { injectDrivePlayer(); }
                }, 3200);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    showPlayerErrorDialog("Não foi possível carregar o player do Google Drive.");
                }
            }
        });
        playerView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View view, MotionEvent event) {
                userTouched();
                return false;
            }
        });

        playerOverlay.addView(playerView, match());

        resetPlayerState();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        addLibraryToApp(fileId, currentTitle, fileUrl(fileId));
        playerView.loadUrl("https://drive.google.com/file/d/" + fileId + "/preview?autoplay=1");
    }

    private void buildPlayerShell() {
        playerOverlay = new FrameLayout(this);
        playerOverlay.setBackgroundColor(Color.BLACK);
        playerTopBar = buildPlayerTopBar();
        playerTitleView = (TextView) playerTopBar.findViewWithTag("title");
        playerFillButton = (TextView) playerTopBar.findViewWithTag("fill");
        root.addView(playerOverlay, match());
    }

    private FrameLayout.LayoutParams topBarParams() {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56),
            Gravity.TOP
        );
        return params;
    }

    private void resetPlayerState() {
        playerOverlayActive = false;
        videoDetected = false;
        videoPlaying = false;
        chromeHidden = false;
        autoFullscreenSuppressed = false;
        lastActivity = SystemClock.elapsedRealtime();
        if (playerTopBar != null) playerTopBar.setVisibility(View.VISIBLE);
        updateFillButton();
    }

    private void loadPlayerFile(String fileId, String title) {
        currentFileId = fileId;
        currentTitle = cleanTitle(title, "Vídeo do Drive");
        if (playerTitleView != null) playerTitleView.setText(currentTitle);
        playerOverlayActive = false;
        videoDetected = false;
        videoPlaying = false;
        autoFullscreenSuppressed = false;
        lastActivity = SystemClock.elapsedRealtime();
        if (playerTopBar != null) playerTopBar.setVisibility(View.VISIBLE);
        if (playerView != null) {
            playerView.loadUrl("https://drive.google.com/file/d/" + fileId + "/preview?autoplay=1");
        }
    }

    private void injectDrivePlayer() {
        if (playerView == null || playerIsLocal) return;
        String core = readAsset("player-core.js");
        String driver = readAsset("drive-player.js");
        String css = readAsset("player.css");
        if (TextUtils.isEmpty(driver) || TextUtils.isEmpty(core)) return;

        String script = core + "\n" + driver;
        script = script
            .replace("__DP_FILE_ID__", JSONObject.quote(currentFileId))
            .replace("__DP_TITLE__", JSONObject.quote(currentTitle))
            .replace("__DP_SETTINGS__", TextUtils.isEmpty(settingsJson) ? "{}" : settingsJson)
            .replace("__DP_PLAYLIST__", JSONObject.quote(playlistJson()))
            .replace("__DP_CSS__", JSONObject.quote(css))
            .replace("__DP_FILL__", String.valueOf(fillScreen))
            .replace("__DP_COVER__", String.valueOf(coverMode));
        playerView.evaluateJavascript(script, null);
    }

    private String playlistJson() {
        JSONArray array = new JSONArray();
        for (MediaItem item : playlist) {
            try {
                JSONObject object = new JSONObject();
                object.put("id", item.id);
                object.put("title", item.title);
                array.put(object);
            } catch (Exception ignored) {
                // Skip a malformed item.
            }
        }
        return array.toString();
    }

    private List<MediaItem> parsePlaylist(String json, String fileId, String title) {
        List<MediaItem> items = new ArrayList<>();
        if (!TextUtils.isEmpty(json)) {
            try {
                JSONArray array = new JSONArray(json);
                for (int i = 0; i < array.length() && items.size() < 800; i++) {
                    JSONObject object = array.optJSONObject(i);
                    if (object == null) continue;
                    String id = object.optString("id", "");
                    String name = object.optString("title", "Vídeo do Drive");
                    if (!TextUtils.isEmpty(id)) {
                        items.add(new MediaItem(id, cleanTitle(name, "Vídeo do Drive")));
                    }
                }
            } catch (Exception ignored) {
                // A malformed playlist should never prevent the current video.
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
            addLibraryToApp(next.id, next.title, fileUrl(next.id));
            loadPlayerFile(next.id, next.title);
            toast("Próximo: " + next.title);
        } else {
            toast("Este é o último episódio da lista.");
            if (playerView != null) {
                playerView.evaluateJavascript(
                    "window.__dpShowEnded && window.__dpShowEnded();", null);
            }
        }
    }

    private void playPrevious() {
        if (playlistIndex > 0) {
            playlistIndex--;
            MediaItem previous = playlist.get(playlistIndex);
            addLibraryToApp(previous.id, previous.title, fileUrl(previous.id));
            loadPlayerFile(previous.id, previous.title);
            toast("Anterior: " + previous.title);
        } else {
            toast("Este é o primeiro episódio da lista.");
        }
    }

    private LinearLayout buildPlayerTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), 0, dp(6), 0);

        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{0xD9000000, 0x00000000}
        );
        bar.setBackground(background);
        bar.setElevation(dp(4));

        TextView backView = new TextView(this);
        backView.setText("‹");
        backView.setTextSize(32);
        backView.setGravity(Gravity.CENTER);
        backView.setTextColor(Color.parseColor("#f3f4f7"));
        backView.setLayoutParams(new LinearLayout.LayoutParams(
            dp(42), ViewGroup.LayoutParams.MATCH_PARENT));
        backView.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { closePlayer(); }
        });
        bar.addView(backView);

        TextView titleView = new TextView(this);
        titleView.setTag("title");
        titleView.setText(currentTitle);
        titleView.setTextSize(14);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setTextColor(Color.parseColor("#f3f4f7"));
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setPadding(dp(2), 0, dp(6), 0);
        titleView.setLayoutParams(new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        bar.addView(titleView);

        TextView fillView = topbarButton("Preencher");
        fillView.setTag("fill");
        fillView.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { toggleFillScreen(); }
        });
        bar.addView(fillView);

        if (playlist.size() > 1) {
            TextView nextView = topbarButton("Próximo");
            nextView.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { playNext(); }
            });
            bar.addView(nextView);
        }

        TextView chromeView = topbarButton("Chrome");
        chromeView.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { openCurrentInChrome(); }
        });
        bar.addView(chromeView);

        return bar;
    }

    private TextView topbarButton(String text) {
        TextView button = new TextView(this);
        button.setText(text);
        button.setTextSize(11);
        button.setTextColor(Color.parseColor("#d7dbe6"));
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        return button;
    }

    private void updateFillButton() {
        if (playerFillButton == null) return;
        playerFillButton.setText(fillScreen ? "Original" : "Preencher");
        playerFillButton.setTextColor(fillScreen
            ? Color.parseColor("#8aa4ff")
            : Color.parseColor("#d7dbe6"));
        playerFillButton.setTypeface(null, fillScreen ? Typeface.BOLD : Typeface.NORMAL);
    }

    private void toggleFillScreen() {
        setFillScreen(!fillScreen);
        toast(fillScreen
            ? "Tela preenchida — as bordas podem ser cortadas."
            : "Tamanho original restaurado.");
    }

    private void setFillScreen(boolean enabled) {
        fillScreen = enabled;
        lastActivity = SystemClock.elapsedRealtime();
        updateFillButton();
        persistFillScreen();
        if (playerView != null) {
            playerView.evaluateJavascript(
                "window.__dpSetFill && window.__dpSetFill(" + enabled + ");", null);
        }
        if (localPlayerView != null) {
            localPlayerView.evaluateJavascript(
                "window.__dpSetFill && window.__dpSetFill(" + enabled + ");", null);
        }
    }

    private void persistFillScreen() {
        try {
            JSONObject object = new JSONObject(settingsJson);
            object.put("fillScreen", fillScreen);
            settingsJson = object.toString();
            prefs().edit().putString("settings", settingsJson).apply();
        } catch (Exception ignored) {
            // Keep the in-memory preference even if the JSON is malformed.
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

    private boolean autoFullscreenEnabled() {
        try {
            return new JSONObject(settingsJson).optBoolean("autoFullscreen", true);
        } catch (Exception ignored) {
            return true;
        }
    }

    private void userTouched() {
        lastActivity = SystemClock.elapsedRealtime();
        if (chromeHidden) {
            showChromeAndBars();
        } else {
            evaluatePlayerChrome(true);
        }
    }

    private void toggleChrome() {
        lastActivity = SystemClock.elapsedRealtime();
        if (chromeHidden) showChromeAndBars();
        else hideChromeAndBars();
    }

    private void hideChromeAndBars() {
        if (playerTopBar != null) playerTopBar.setVisibility(View.GONE);
        chromeHidden = true;
        if (root != null) root.setPadding(0, 0, 0, 0);
        hideSystemBars();
        evaluatePlayerChrome(false);
    }

    private void showChromeAndBars() {
        if (playerTopBar != null && !playerOverlayActive) {
            playerTopBar.setVisibility(View.VISIBLE);
        }
        chromeHidden = false;
        autoFullscreenSuppressed = true;
        handler.removeCallbacks(resetAutoFullscreen);
        handler.postDelayed(resetAutoFullscreen, 12000);
        if (root != null) root.requestApplyInsets();
        showSystemBars();
        evaluatePlayerChrome(true);
        lastActivity = SystemClock.elapsedRealtime();
    }

    private void evaluatePlayerChrome(boolean visible) {
        String command = "window.__dpSetChrome && window.__dpSetChrome(" + visible + ");";
        if (playerView != null) playerView.evaluateJavascript(command, null);
        if (localPlayerView != null) localPlayerView.evaluateJavascript(command, null);
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

    private void closePlayer() {
        hideCustomViewInternal();

        if (playerOverlay != null) {
            root.removeView(playerOverlay);
            playerOverlay = null;
        }
        if (playerView != null) {
            try {
                playerView.evaluateJavascript(
                    "window.__dpDestroy && window.__dpDestroy();", null);
                playerView.loadUrl("about:blank");
            } catch (Exception ignored) {
                // The WebView may already be gone.
            }
            playerView.destroy();
            playerView = null;
        }
        if (localPlayerView != null) {
            try {
                localPlayerView.evaluateJavascript(
                    "window.__dpDestroy && window.__dpDestroy();", null);
                localPlayerView.loadUrl("about:blank");
            } catch (Exception ignored) {
                // The WebView may already be gone.
            }
            localPlayerView.destroy();
            localPlayerView = null;
        }

        playerTopBar = null;
        playerTitleView = null;
        playerFillButton = null;
        playerOverlayActive = false;
        playerIsLocal = false;
        playlist = new ArrayList<>();
        playlistIndex = -1;
        currentFileId = "";
        currentTitle = "";
        videoDetected = false;
        videoPlaying = false;
        chromeHidden = false;
        autoFullscreenSuppressed = false;
        customFullscreen = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showSystemBars();
        if (root != null) root.requestApplyInsets();
        if (appView != null) {
            appView.evaluateJavascript(
                "window.__dpLibraryUpdated && window.__dpLibraryUpdated(" +
                    JSONObject.quote(libraryStore.load()) + ");", null);
            appView.evaluateJavascript(
                "window.__dpPlayerClosed && window.__dpPlayerClosed();", null);
        }
    }

    private void showPlayerErrorDialog(String message) {
        if (destroyed || isFinishing()) return;
        try {
            new AlertDialog.Builder(this)
                .setTitle("DrivePlay")
                .setMessage(message)
                .setPositiveButton("Tentar novamente", new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface dialog, int which) {
                        if (playerView != null && !TextUtils.isEmpty(currentFileId)) {
                            playerView.reload();
                        }
                    }
                })
                .setNeutralButton("Abrir no Chrome", new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface dialog, int which) {
                        openCurrentInChrome();
                    }
                })
                .setNegativeButton("Fechar", null)
                .show();
        } catch (Exception ignored) {
            toast(message);
        }
    }

    private void openCurrentInChrome() {
        if (TextUtils.isEmpty(currentFileId)) return;
        if (currentFileId.startsWith("local:")) {
            toast("Vídeo local: use o player do DrivePlay.");
            return;
        }
        openExternal(fileUrl(currentFileId));
    }

    private boolean handlePlayerUrl(Uri uri) {
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
        if (host.endsWith("google.com") || host.endsWith("gstatic.com") ||
            host.endsWith("googleusercontent.com") || host.endsWith("youtube.com") ||
            host.endsWith("ytimg.com") || host.endsWith("googleapis.com")) {
            return false;
        }
        openExternal(uri.toString());
        return true;
    }

    // ---------------------------------------------------------------------
    // Local videos
    // ---------------------------------------------------------------------

    private void showLocalVideo(Uri uri, String title) {
        closePlayer();
        playerIsLocal = true;
        currentFileId = "local:" + Integer.toHexString(uri.toString().hashCode());
        currentTitle = cleanTitle(title, "Vídeo local");
        rememberLocalUri(currentFileId, uri);
        fillScreen = readFillScreen(settingsJson);
        playlist = new ArrayList<>();
        playlist.add(new MediaItem(currentFileId, currentTitle));
        playlistIndex = 0;

        buildPlayerShell();

        localPlayerView = new WebView(this);
        configureWebView(localPlayerView, false);
        localPlayerView.addJavascriptInterface(new PlayerBridge(), "PlayerBridge");
        localPlayerView.addJavascriptInterface(new AppBridge(), "Android");
        localPlayerView.setWebChromeClient(new PlayerChromeClient());
        localPlayerView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handlePlayerUrl(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    toast("Não foi possível abrir o player local.");
                }
            }
        });
        localPlayerView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View view, MotionEvent event) {
                userTouched();
                return false;
            }
        });

        playerOverlay.addView(localPlayerView, match());
        resetPlayerState();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String url = "file:///android_asset/player.html" +
            "?id=" + Uri.encode(currentFileId) +
            "&title=" + Uri.encode(currentTitle) +
            "&src=" + Uri.encode(uri.toString());
        localPlayerView.loadUrl(url);
    }

    private float readVideoAspect(Uri uri) {
        // Kept for compatibility with old local-video metadata paths. The HTML
        // player uses the video element's intrinsic aspect ratio instead.
        return 0f;
    }

    private void pickLocalVideo() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
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
        persistUriPermission(uri);
        showLocalVideo(uri, displayName(uri));
    }

    private void persistUriPermission(Uri uri) {
        if (uri == null) return;
        try {
            getContentResolver().takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Some document providers do not offer persistable permissions.
        }
    }

    private void rememberLocalUri(String id, Uri uri) {
        try {
            JSONObject map = new JSONObject(prefs().getString("localUris", "{}"));
            map.put(id, uri.toString());
            prefs().edit().putString("localUris", map.toString()).apply();
        } catch (Exception ignored) {
            // Playback still works for this session.
        }
    }

    private boolean openLocalById(String id) {
        if (TextUtils.isEmpty(id)) return false;
        try {
            JSONObject map = new JSONObject(prefs().getString("localUris", "{}"));
            String raw = map.optString(id, "");
            if (TextUtils.isEmpty(raw)) return false;
            Uri uri = Uri.parse(raw);
            showLocalVideo(uri, displayName(uri));
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        try (android.database.Cursor cursor =
                 getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Fall back to a generic title.
        }
        return TextUtils.isEmpty(name) ? "Vídeo local" : name;
    }

    // ---------------------------------------------------------------------
    // Drive folder fetching and library bridge
    // ---------------------------------------------------------------------

    private void fetchFolder(final String folderId) {
        if (TextUtils.isEmpty(folderId)) return;
        io.execute(new Runnable() {
            @Override
            public void run() {
                final String cookie = CookieManager.getInstance()
                    .getCookie("https://drive.google.com");
                try {
                    final JSONObject folder = DriveApi.fetchFolder(folderId, cookie);
                    JSONObject result = new JSONObject();
                    result.put("ok", true);
                    result.put("folder", folder);
                    deliverFolderResult(folderId, result);
                } catch (Exception error) {
                    try {
                        JSONObject result = new JSONObject();
                        result.put("ok", false);
                        result.put("error", error.getMessage() == null
                            ? "Não foi possível abrir esta pasta."
                            : error.getMessage());
                        deliverFolderResult(folderId, result);
                    } catch (Exception ignored) {
                        // Nothing else to do.
                    }
                }
            }
        });
    }

    private void deliverFolderResult(final String folderId, final JSONObject result) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (destroyed || appView == null) return;
                appView.evaluateJavascript(
                    "window.__dpFolderResult && window.__dpFolderResult(" +
                        JSONObject.quote(folderId) + "," +
                        JSONObject.quote(result.toString()) + ");",
                    null
                );
            }
        });
    }

    private void addLibraryToApp(String id, String title, String url) {
        if (appView == null || TextUtils.isEmpty(id)) return;
        appView.evaluateJavascript(
            "window.__dpAddFile && window.__dpAddFile(" +
                JSONObject.quote(id) + "," + JSONObject.quote(title) + "," +
                JSONObject.quote(url) + ");",
            null
        );
    }

    private void updateTitle(String title) {
        String clean = cleanTitle(title, currentTitle);
        if (TextUtils.isEmpty(clean)) return;
        currentTitle = clean;
        if (playerTitleView != null) playerTitleView.setText(clean);
        if (playlistIndex >= 0 && playlistIndex < playlist.size()) {
            playlist.get(playlistIndex).title = clean;
        }
        if (!TextUtils.isEmpty(currentFileId) && !currentFileId.startsWith("local:")) {
            addLibraryToApp(currentFileId, clean, fileUrl(currentFileId));
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

    private String fileUrl(String fileId) {
        return "https://drive.google.com/file/d/" + fileId + "/view";
    }

    private String readAsset(String name) {
        if (assetCache.containsKey(name)) return assetCache.get(name);
        try (InputStream stream = getAssets().open(name)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) != -1) buffer.write(chunk, 0, read);
            String value = new String(buffer.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
            assetCache.put(name, value);
            return value;
        } catch (Exception ignored) {
            return "";
        }
    }

    private void applySettings(String json) {
        if (json == null || json.isEmpty()) return;
        settingsJson = json;
        fillScreen = readFillScreen(settingsJson);
        prefs().edit().putString("settings", settingsJson).apply();
        updateFillButton();
        if (playerView != null) {
            playerView.evaluateJavascript(
                "window.__dpUpdateSettings && window.__dpUpdateSettings(" + settingsJson + ");",
                null
            );
        }
        if (localPlayerView != null) {
            localPlayerView.evaluateJavascript(
                "window.__dpUpdateSettings && window.__dpUpdateSettings(" + settingsJson + ");",
                null
            );
        }
        applyCoverMode();
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
                    if (manager != null && manager.hasPrimaryClip() &&
                        manager.getPrimaryClip() != null) {
                        ClipData clip = manager.getPrimaryClip();
                        if (clip.getItemCount() > 0 &&
                            clip.getItemAt(0).coerceToText(MainActivity.this) != null) {
                            result[0] = clip.getItemAt(0)
                                .coerceToText(MainActivity.this).toString();
                        }
                    }
                } catch (Exception ignored) {
                    // Clipboard access can fail on some OEM builds.
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
            // Never let a toast failure break playback.
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
            return "1.2.0";
        }
    }

    // ---------------------------------------------------------------------
    // Intents and lifecycle
    // ---------------------------------------------------------------------

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String link = null;

        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            Uri data = intent.getData();
            String type = intent.getType();
            if (data.getScheme() != null &&
                ("content".equals(data.getScheme()) || "file".equals(data.getScheme())) &&
                (type == null || type.startsWith("video/"))) {
                persistUriPermission(data);
                showLocalVideo(data, displayName(data));
                return;
            }
            link = data.toString();
        } else if (Intent.ACTION_SEND.equals(action)) {
            String type = intent.getType();
            if (type != null && type.startsWith("video/")) {
                Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) {
                    persistUriPermission(stream);
                    showLocalVideo(stream, displayName(stream));
                    return;
                }
            }
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
        if (playerOverlay != null) {
            closePlayer();
            return;
        }
        if (appView != null) {
            appView.evaluateJavascript(
                "window.__dpBack ? window.__dpBack() : false",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        boolean handled = value != null &&
                            value.replace("\"", "").trim().equals("true");
                        if (!handled) finish();
                    }
                }
            );
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (playerView != null) {
            playerView.onPause();
            playerView.evaluateJavascript(
                "window.__dpPause && window.__dpPause();", null);
        }
        if (localPlayerView != null) {
            localPlayerView.onPause();
            localPlayerView.evaluateJavascript(
                "window.__dpPause && window.__dpPause();", null);
        }
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (playerView != null) playerView.onResume();
        if (localPlayerView != null) localPlayerView.onResume();
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
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (root != null) root.requestApplyInsets();
        applyCoverMode();
        if (playerView != null) {
            playerView.evaluateJavascript(
                "window.__dpResize && window.__dpResize();", null);
        }
        if (localPlayerView != null) {
            localPlayerView.evaluateJavascript(
                "window.__dpResize && window.__dpResize();", null);
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (handler != null) {
            if (autoFullscreenLoop != null) handler.removeCallbacks(autoFullscreenLoop);
            handler.removeCallbacksAndMessages(null);
        }
        closePlayer();
        if (io != null) io.shutdownNow();
        if (appView != null) {
            appView.destroy();
            appView = null;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------------
    // Fullscreen custom view (fallback for the Drive/YouTube player)
    // ---------------------------------------------------------------------

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
        if (playerTopBar != null) playerTopBar.setVisibility(View.VISIBLE);
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
            if (playerTopBar != null) playerTopBar.setVisibility(View.GONE);
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

    // ---------------------------------------------------------------------
    // JavaScript bridges
    // ---------------------------------------------------------------------

    private class AppBridge {
        @JavascriptInterface
        public String loadLibrary() {
            return libraryStore.load();
        }

        @JavascriptInterface
        public void saveLibrary(String json) {
            libraryStore.save(json);
        }

        @JavascriptInterface
        public String getSettings() {
            return settingsJson;
        }

        @JavascriptInterface
        public void setSettings(String json) {
            if (json == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applySettings(json);
                }
            });
        }

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
        public void fetchFolder(final String id) {
            fetchFolder(id);
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
        public void openLocal(final String id) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!openLocalById(id)) {
                        toast("Abra o vídeo local novamente pelo seletor de arquivos.");
                    }
                }
            });
        }

        @JavascriptInterface
        public String readClipboard() {
            return readClipboardText();
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

        @JavascriptInterface
        public boolean isCoverScreen() {
            return coverMode;
        }

        @JavascriptInterface
        public String getVersion() {
            return versionName();
        }

        @JavascriptInterface
        public String getProgress(String id) {
            return String.valueOf(libraryStore.getProgress(id));
        }

        @JavascriptInterface
        public void clearProgress(String id) {
            libraryStore.clearProgress(id);
            if (appView != null) {
                appView.evaluateJavascript(
                    "window.__dpLibraryUpdated && window.__dpLibraryUpdated(" +
                        JSONObject.quote(libraryStore.load()) + ");", null);
            }
        }

        @JavascriptInterface
        public void clearLibrary() {
            libraryStore.clear();
            if (appView != null) {
                appView.evaluateJavascript(
                    "window.__dpLibraryCleared && window.__dpLibraryCleared();", null);
            }
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                @Override public void run() { finishAndRemoveTask(); }
            });
        }
    }

    private class PlayerBridge {
        @JavascriptInterface
        public String getSettings() {
            return settingsJson;
        }

        @JavascriptInterface
        public String getResume(String id) {
            return String.valueOf(libraryStore.getProgress(id));
        }

        @JavascriptInterface
        public void saveProgress(final String id, final String title,
                                 final double position, final double duration) {
            final String json = libraryStore.saveProgress(id, title, position, duration);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (appView == null) return;
                    appView.evaluateJavascript(
                        "window.__dpProgress && window.__dpProgress(" +
                            JSONObject.quote(id) + "," + position + "," + duration + ");",
                        null
                    );
                }
            });
        }

        @JavascriptInterface
        public void clearProgress(final String id) {
            libraryStore.clearProgress(id);
        }

        @JavascriptInterface
        public void onState(final boolean hasVideo, final double duration,
                            final double position, final boolean paused,
                            final boolean ended) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (hasVideo && !videoDetected) {
                        lastActivity = SystemClock.elapsedRealtime();
                    }
                    videoDetected = hasVideo;
                    videoPlaying = hasVideo && !paused && !ended;
                    if (ended) {
                        videoPlaying = false;
                        showChromeAndBars();
                    }
                }
            });
        }

        @JavascriptInterface
        public void onControls(final boolean visible) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (visible) {
                        showChromeAndBars();
                    } else {
                        autoFullscreenSuppressed = false;
                        lastActivity = SystemClock.elapsedRealtime();
                    }
                }
            });
        }

        @JavascriptInterface
        public void onReady() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    playerOverlayActive = true;
                    if (playerTopBar != null) playerTopBar.setVisibility(View.GONE);
                    lastActivity = SystemClock.elapsedRealtime();
                }
            });
        }

        @JavascriptInterface
        public void onError(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!playerOverlayActive) {
                        showPlayerErrorDialog(message);
                    } else {
                        MainActivity.this.toast(message);
                    }
                }
            });
        }

        @JavascriptInterface
        public void onTitle(final String title) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { updateTitle(title); }
            });
        }

        @JavascriptInterface
        public void next() {
            runOnUiThread(new Runnable() {
                @Override public void run() { playNext(); }
            });
        }

        @JavascriptInterface
        public void previous() {
            runOnUiThread(new Runnable() {
                @Override public void run() { playPrevious(); }
            });
        }

        @JavascriptInterface
        public void close() {
            runOnUiThread(new Runnable() {
                @Override public void run() { closePlayer(); }
            });
        }

        @JavascriptInterface
        public void setFill(final boolean enabled) {
            runOnUiThread(new Runnable() {
                @Override public void run() { setFillScreen(enabled); }
            });
        }

        @JavascriptInterface
        public boolean getFill() {
            return fillScreen;
        }

        @JavascriptInterface
        public void fullscreen() {
            runOnUiThread(new Runnable() {
                @Override public void run() { toggleChrome(); }
            });
        }

        @JavascriptInterface
        public void openInChrome() {
            runOnUiThread(new Runnable() {
                @Override public void run() { openCurrentInChrome(); }
            });
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override public void run() { MainActivity.this.toast(message); }
            });
        }

        @JavascriptInterface
        public boolean isCover() {
            return coverMode;
        }

        @JavascriptInterface
        public String getPlaylist() {
            return playlistJson();
        }
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
