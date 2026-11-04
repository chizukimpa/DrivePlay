package app.driveplay.mobile;

import android.text.TextUtils;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Resolves a Google Drive file id to a direct, streamable media URL.
 *
 * <p>The WebView holds the user's Google session (cookies are HttpOnly, so the
 * page cannot read them). This class reuses {@link android.webkit.CookieManager}
 * to authenticate the same requests natively and follows Drive's redirect /
 * "download anyway" confirmation flow until it reaches the usercontent host
 * that serves the actual bytes with range support.</p>
 */
final class DriveMedia {

    private static final String UA = DriveApi.USER_AGENT;
    private static final int MAX_REDIRECTS = 8;
    private static final long CACHE_OK_MS = 10 * 60 * 1000L;
    private static final long CACHE_FAIL_MS = 30 * 1000L;
    /** Small ranges kept in memory so ExoPlayer does not pay another Drive round trip. */
    private static final int PREFETCH_HEAD_BYTES = 256 * 1024;
    private static final int PREFETCH_TAIL_BYTES = 128 * 1024;
    private static final Pattern CONFIRM = Pattern.compile("name=\"confirm\"\\s+value=\"([^\"]+)\"");
    private static final Pattern UUID = Pattern.compile("name=\"uuid\"\\s+value=\"([^\"]+)\"");
    private static String apiKey = "";
    private static String accessToken = "";
    private static final java.util.LinkedHashMap<String, CachedResult> CACHE =
        new java.util.LinkedHashMap<String, CachedResult>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(java.util.Map.Entry<String, CachedResult> eldest) {
                return size() > 24;
            }
        };
    /** One lock per file so a prefetch and the player never hit Drive twice. */
    private static final java.util.HashMap<String, Object> LOCKS =
        new java.util.HashMap<>();

    private static final java.util.LinkedHashMap<String, Prefetch> PREFETCH =
        new java.util.LinkedHashMap<String, Prefetch>(8, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(
                java.util.Map.Entry<String, Prefetch> eldest) {
                return size() > 4;
            }
        };

    static final class Prefetch {
        final long length;
        volatile ByteRange head;
        volatile ByteRange tail;
        final java.util.concurrent.CountDownLatch tailLatch =
            new java.util.concurrent.CountDownLatch(1);

        Prefetch(long length) {
            this.length = length;
        }
    }

    static final class ByteRange {
        final long start;
        final byte[] data;

        ByteRange(long start, byte[] data) {
            this.start = start;
            this.data = data;
        }

        boolean contains(long position) {
            return position >= start && position < start + data.length;
        }

        int offset(long position) {
            return (int) (position - start);
        }
    }

    private DriveMedia() {}

    static void setApiKey(String key) {
        apiKey = key == null ? "" : key.trim();
    }

    static void setAccessToken(String token) {
        accessToken = token == null ? "" : token.trim();
    }

    static String accessToken() {
        return accessToken;
    }

    static String apiKey() {
        return apiKey;
    }

    static final class Result {
        String url;
        String contentType;
        long length = -1;
        boolean rangeSupported;
        String error;
    }

    private static final class CachedResult {
        final Result result;
        final long expiresAt;

        CachedResult(Result result, long expiresAt) {
            this.result = result;
            this.expiresAt = expiresAt;
        }
    }

    private static Result copyOf(Result source) {
        Result result = new Result();
        result.url = source.url;
        result.contentType = source.contentType;
        result.length = source.length;
        result.rangeSupported = source.rangeSupported;
        result.error = source.error;
        return result;
    }

    static Result resolve(String fileId, String cookie) {
        if (TextUtils.isEmpty(fileId)) {
            Result result = new Result();
            result.error = "Arquivo sem id.";
            return result;
        }

        String cacheKey = fileId + "|" + (cookie == null ? "" : cookie.hashCode())
            + "|" + apiKey.hashCode();
        long now = android.os.SystemClock.elapsedRealtime();
        Result cached = cachedResult(cacheKey, now);
        if (cached != null) return cached;

        Object lock;
        synchronized (LOCKS) {
            lock = LOCKS.get(cacheKey);
            if (lock == null) {
                lock = new Object();
                LOCKS.put(cacheKey, lock);
            }
        }
        try {
            synchronized (lock) {
                // Another thread (the prefetch, usually) may have finished
                // while this one waited for the lock.
                cached = cachedResult(cacheKey, android.os.SystemClock.elapsedRealtime());
                if (cached != null) return cached;

                Result result = resolveUncached(fileId, cookie);
                synchronized (CACHE) {
                    CACHE.put(cacheKey, new CachedResult(
                        copyOf(result),
                        android.os.SystemClock.elapsedRealtime()
                            + (result.error == null ? CACHE_OK_MS : CACHE_FAIL_MS)
                    ));
                }
                return result;
            }
        } finally {
            synchronized (LOCKS) {
                if (LOCKS.get(cacheKey) == lock) LOCKS.remove(cacheKey);
            }
        }
    }

    private static Result cachedResult(String cacheKey, long now) {
        synchronized (CACHE) {
            CachedResult cached = CACHE.get(cacheKey);
            if (cached != null && cached.expiresAt > now) return copyOf(cached.result);
        }
        return null;
    }

    /**
     * Starts resolving a video while the player UI is still being built. The
     * real player open then finds the URL in the cache instead of paying for a
     * second round trip.
     */
    static void prefetch(String fileId, String cookie) {
        resolve(fileId, cookie);
    }

    private static Result resolveUncached(String fileId, String cookie) {
        Result result = resolveViaApi(fileId, cookie);
        if (result != null && result.error == null && !TextUtils.isEmpty(result.url)) {
            android.util.Log.d("DrivePlay", "resolve via OAuth Drive API ok");
            return result;
        }
        result = new Result();
        try {
            String url = "https://drive.google.com/uc?export=download&id=" + fileId;
            android.util.Log.d("DrivePlay", "resolve start " + fileId);
            HttpURLConnection connection = open(url, cookie, null);
            int status = connection.getResponseCode();
            String location = connection.getHeaderField("Location");
            String type = connection.getContentType();
            int hops = 0;

            while (status >= 300 && status < 400 && location != null && hops++ < MAX_REDIRECTS) {
                url = new URL(new URL(url), location).toString();
                connection.disconnect();
                connection = open(url, cookie, null);
                status = connection.getResponseCode();
                location = connection.getHeaderField("Location");
                type = connection.getContentType();
            }

            if (status >= 400) {
                result.error = "HTTP " + status;
                connection.disconnect();
                return result;
            }

            // Large files answer with an HTML "can't scan for viruses" page that
            // carries a one-time confirm token.
            if (type != null && type.contains("text/html")) {
                String html = readText(connection);
                Matcher confirm = CONFIRM.matcher(html);
                Matcher uuid = UUID.matcher(html);
                if (confirm.find()) {
                    String retry = "https://drive.usercontent.google.com/download?id=" + fileId
                        + "&export=download&confirm=" + confirm.group(1);
                    if (uuid.find()) retry += "&uuid=" + uuid.group(1);
                    connection.disconnect();
                    connection = open(retry, cookie, null);
                    status = connection.getResponseCode();
                    type = connection.getContentType();
                    location = connection.getHeaderField("Location");
                    while (status >= 300 && status < 400 && location != null && hops++ < MAX_REDIRECTS) {
                        url = new URL(new URL(retry), location).toString();
                        connection.disconnect();
                        connection = open(url, cookie, null);
                        status = connection.getResponseCode();
                        location = connection.getHeaderField("Location");
                        type = connection.getContentType();
                    }

                    if (status >= 400) {
                        result.error = "HTTP " + status;
                        connection.disconnect();
                        return result;
                    }
                    if (type != null && type.contains("text/html")) {
                        result.error = htmlError(readText(connection));
                        connection.disconnect();
                        return result;
                    }
                } else {
                    result.error = htmlError(html);
                    connection.disconnect();
                    return result;
                }
            }

            result.url = connection.getURL().toString();
            result.contentType = type;
            String length = connection.getHeaderField("Content-Length");
            if (length != null) {
                try { result.length = Long.parseLong(length); } catch (NumberFormatException ignored) {}
            }
            // No extra probe request here: the confirm page is the only HTML
            // response that needs handling, and ExoPlayer already reports a
            // clear error if the URL is not media. This removes a whole network
            // round trip from every video start.
            android.util.Log.d("DrivePlay", "resolve done error=" + result.error
                + " len=" + result.length + " type=" + type);
            connection.disconnect();
            return result;
        } catch (Exception error) {
            result.error = error.getClass().getSimpleName() + ": " + error.getMessage();
            android.util.Log.d("DrivePlay", "resolve exception " + result.error);
            return result;
        }
    }

    /**
     * Uses the official Drive API with an API key (created in Google Cloud).
     * This has its own project quota, so it is not affected by the anonymous
     * "too many users" download limit of the web endpoint. It works for files
     * shared with "anyone with the link", which is the case of the app folders.
     */
    private static Result resolveViaApi(String fileId, String cookie) {
        if (TextUtils.isEmpty(accessToken)) return null;
        Result result = new Result();
        HttpURLConnection connection = null;
        try {
            String url = "https://www.googleapis.com/drive/v3/files/" + fileId
                + "?alt=media&supportsAllDrives=true";
            connection = apiConnection(url);
            int status = connection.getResponseCode();
            String type = connection.getContentType();
            int hops = 0;
            // Follow the Drive redirect here and hand ExoPlayer the final
            // usercontent URL. Letting ExoPlayer repeat the 302 costs another
            // DNS/TLS round trip before the first byte of video.
            while (status >= 300 && status < 400 && hops++ < MAX_REDIRECTS) {
                String location = connection.getHeaderField("Location");
                if (TextUtils.isEmpty(location)) break;
                String next = new URL(new URL(url), location).toString();
                connection.disconnect();
                url = next;
                connection = apiConnection(url);
                status = connection.getResponseCode();
                type = connection.getContentType();
            }
            android.util.Log.d("DrivePlay", "OAuth API status=" + status
                + " type=" + type + " hops=" + hops);
            if (status >= 200 && status < 400
                && (type == null || !type.contains("text/html"))) {
                long total = -1;
                String contentRange = connection.getHeaderField("Content-Range");
                String contentLength = connection.getHeaderField("Content-Length");
                if (contentRange != null) {
                    int slash = contentRange.lastIndexOf('/');
                    if (slash > 0) {
                        try { total = Long.parseLong(contentRange.substring(slash + 1)); }
                        catch (NumberFormatException ignored) {}
                    }
                } else if (contentLength != null) {
                    try { total = Long.parseLong(contentLength); }
                    catch (NumberFormatException ignored) {}
                }

                // Start the cue-index request before reading the header body:
                // both then share the same network wait.
                startTailPrefetch(url, cookie, total);
                byte[] head = readBytes(connection, PREFETCH_HEAD_BYTES);
                if (looksLikeMedia(head) || (type != null && type.startsWith("video/"))) {
                    result.url = url;
                    result.contentType = type;
                    result.rangeSupported = status == 206;
                    result.length = total;
                    cacheHead(url, head);
                    return result;
                }
            }
            result.error = "API HTTP " + status;
        } catch (Exception error) {
            result.error = error.getClass().getSimpleName() + ": " + error.getMessage();
            android.util.Log.d("DrivePlay", "OAuth API exception " + result.error);
        } finally {
            if (connection != null) {
                try { connection.disconnect(); } catch (Exception ignored) {}
            }
        }
        return result;
    }

    private static HttpURLConnection apiConnection(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("User-Agent", UA);
        connection.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8");
        // The token only goes to the Drive API host; the usercontent URL it
        // redirects to is already signed and does not need it.
        if (url.contains("googleapis.com")) {
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        }
        connection.setRequestProperty("Range", "bytes=0-" + (PREFETCH_HEAD_BYTES - 1));
        return connection;
    }

    /**
     * Keeps the first and last chunks of the file in memory. ExoPlayer opens
     * separate range requests for the MKV header and for the cue index at the
     * end of the file; both are tiny, but each one costs a full Drive round
     * trip (650-1200 ms on this connection).
     */
    private static void startTailPrefetch(String url, String cookie, long length) {
        final Prefetch prefetch = new Prefetch(length);
        synchronized (PREFETCH) {
            PREFETCH.put(url, prefetch);
        }
        if (length <= 12) {
            prefetch.tailLatch.countDown();
            return;
        }
        final long start = Math.max(0, length - PREFETCH_TAIL_BYTES);
        final String tailUrl = url;
        final String tailCookie = cookie;
        Thread thread = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    byte[] tail = fetchRange(tailUrl, tailCookie, start, prefetch.length);
                    if (tail != null && tail.length > 0) {
                        prefetch.tail = new ByteRange(start, tail);
                        android.util.Log.d("DrivePlay", "prefetch tail " + tail.length + "B");
                    }
                } finally {
                    prefetch.tailLatch.countDown();
                }
            }
        }, "driveplay-tail-prefetch");
        thread.setDaemon(true);
        thread.start();
    }

    private static void cacheHead(String url, byte[] head) {
        if (head == null || head.length < 12) return;
        Prefetch prefetch;
        synchronized (PREFETCH) {
            prefetch = PREFETCH.get(url);
        }
        if (prefetch != null) prefetch.head = new ByteRange(0, head);
    }

    static ByteRange cachedRange(String url, long position) {
        if (url == null) return null;
        Prefetch prefetch;
        synchronized (PREFETCH) {
            prefetch = PREFETCH.get(url);
        }
        if (prefetch == null) return null;
        ByteRange head = prefetch.head;
        if (head != null && head.contains(position)) return head;
        ByteRange tail = prefetch.tail;
        if (tail != null && tail.contains(position)) return tail;
        return null;
    }

    static boolean isNearTail(String url, long position) {
        if (url == null) return false;
        Prefetch prefetch;
        synchronized (PREFETCH) {
            prefetch = PREFETCH.get(url);
        }
        return prefetch != null && prefetch.length > 0
            && position >= prefetch.length - PREFETCH_TAIL_BYTES;
    }

    static void awaitTail(String url, long timeoutMs) {
        if (url == null) return;
        Prefetch prefetch;
        synchronized (PREFETCH) {
            prefetch = PREFETCH.get(url);
        }
        if (prefetch == null) return;
        try {
            prefetch.tailLatch.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }

    private static byte[] fetchRange(String url, String cookie, long start, long end) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("User-Agent", UA);
            connection.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8");
            if (url.contains("googleapis.com") && !TextUtils.isEmpty(accessToken)) {
                connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            } else if (!TextUtils.isEmpty(cookie)) {
                connection.setRequestProperty("Cookie", cookie);
            }
            connection.setRequestProperty("Range", "bytes=" + start + "-" + (end - 1));
            int status = connection.getResponseCode();
            if (status != 206) {
                android.util.Log.d("DrivePlay", "tail prefetch status=" + status);
                return null;
            }
            String contentRange = connection.getHeaderField("Content-Range");
            if (contentRange != null && !contentRange.startsWith("bytes " + start + "-")) {
                android.util.Log.d("DrivePlay", "tail prefetch wrong range");
                return null;
            }
            int max = (int) Math.min(end - start, PREFETCH_TAIL_BYTES);
            return readBytes(connection, max);
        } catch (Exception error) {
            android.util.Log.d("DrivePlay", "tail prefetch failed "
                + error.getClass().getSimpleName());
            return null;
        } finally {
            if (connection != null) {
                try { connection.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    /** Explains the HTML pages Drive returns instead of the file. */
    private static String htmlError(String html) {
        String page = html == null ? "" : html.toLowerCase(java.util.Locale.ROOT);
        if (page.contains("limite ultrapassado") || page.contains("quota exceeded")
            || page.contains("too many users")
            || page.contains("can't view or download this file at this time")
            || page.contains("não é possível ver ou baixar")) {
            return "O Google Drive atingiu o limite de downloads deste arquivo. "
                + "Aguarde algumas horas (ou 24 h) e tente de novo, ou abra no Chrome "
                + "com uma conta Google.";
        }
        if (page.contains("fazer login") || page.contains("sign in")
            || page.contains("accounts.google.com")) {
            return "O Google Drive pediu login para este arquivo. "
                + "Abra no Chrome e entre na sua conta Google.";
        }
        if (page.contains("acesso negado") || page.contains("access denied")
            || page.contains("sem permissão") || page.contains("no permission")) {
            return "Você não tem permissão para abrir este arquivo. "
                + "Confira o compartilhamento no Google Drive.";
        }
        return "O Google Drive devolveu uma página em vez do vídeo. "
            + "Tente novamente em alguns minutos.";
    }

    private static boolean looksLikeMedia(byte[] head) {
        if (head == null || head.length < 12) return false;
        // Matroska / WebM (EBML)
        if ((head[0] & 0xff) == 0x1a && (head[1] & 0xff) == 0x45
            && (head[2] & 0xff) == 0xdf && (head[3] & 0xff) == 0xa3) return true;
        // MP4 / MOV / M4V
        if (head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p') return true;
        // AVI
        if (head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
            && head[8] == 'A' && head[9] == 'V' && head[10] == 'I') return true;
        // MPEG-TS
        if ((head[0] & 0xff) == 0x47) return true;
        // FLV
        if (head[0] == 'F' && head[1] == 'L' && head[2] == 'V') return true;
        return false;
    }

    private static byte[] readBytes(HttpURLConnection connection, int max) {
        try {
            InputStream input = connection.getInputStream();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while (output.size() < max && (read = input.read(buffer, 0,
                Math.min(buffer.length, max - output.size()))) > 0) {
                output.write(buffer, 0, read);
            }
            input.close();
            return output.toByteArray();
        } catch (Exception error) {
            return new byte[0];
        }
    }

    private static HttpURLConnection open(String url, String cookie, String range) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", UA);
        connection.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8");
        if (!TextUtils.isEmpty(cookie)) connection.setRequestProperty("Cookie", cookie);
        if (range != null) connection.setRequestProperty("Range", range);
        return connection;
    }

    private static String readText(HttpURLConnection connection) throws Exception {
        InputStream stream = connection.getInputStream();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        int total = 0;
        while ((read = stream.read(chunk)) > 0 && total < 512 * 1024) {
            buffer.write(chunk, 0, read);
            total += read;
        }
        stream.close();
        return new String(buffer.toByteArray(), "UTF-8");
    }

    static String probeJson(String fileId, String cookie) {
        Result result = resolve(fileId, cookie);
        try {
            JSONObject json = new JSONObject();
            json.put("ok", result.error == null);
            json.put("error", result.error);
            json.put("url", result.url);
            json.put("type", result.contentType);
            json.put("length", result.length);
            json.put("range", result.rangeSupported);
            return json.toString();
        } catch (Exception error) {
            return "{\"ok\":false,\"error\":\"json\"}";
        }
    }

    /**
     * Cookies from every Google host involved in the download flow. Merging
     * them means a session created in the login WebView is used for both the
     * resolve request and the usercontent download.
     */
    static String loginCookie() {
        try {
            android.webkit.CookieManager manager = android.webkit.CookieManager.getInstance();
            String[] urls = {
                "https://drive.google.com",
                "https://drive.usercontent.google.com",
                "https://accounts.google.com",
                "https://www.google.com"
            };
            java.util.LinkedHashMap<String, String> pairs = new java.util.LinkedHashMap<>();
            for (String url : urls) {
                String raw = manager.getCookie(url);
                if (TextUtils.isEmpty(raw)) continue;
                String[] parts = raw.split(";");
                for (String part : parts) {
                    String value = part == null ? "" : part.trim();
                    if (value.isEmpty()) continue;
                    int eq = value.indexOf('=');
                    String name = eq > 0 ? value.substring(0, eq) : value;
                    if (!pairs.containsKey(name)) pairs.put(name, value);
                }
            }
            StringBuilder merged = new StringBuilder();
            for (String value : pairs.values()) {
                if (merged.length() > 0) merged.append("; ");
                merged.append(value);
            }
            return merged.toString();
        } catch (Exception error) {
            return "";
        }
    }

    /** Cookie header the WebView session would send to this URL. */
    static String cookieFor(String url) {
        try {
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (TextUtils.isEmpty(cookie)) {
                cookie = android.webkit.CookieManager.getInstance()
                    .getCookie("https://drive.google.com");
            }
            return cookie == null ? "" : cookie;
        } catch (Exception error) {
            return "";
        }
    }
}