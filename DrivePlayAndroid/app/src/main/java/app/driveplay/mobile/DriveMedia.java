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
    private static final Pattern CONFIRM = Pattern.compile("name=\"confirm\"\\s+value=\"([^\"]+)\"");
    private static final Pattern UUID = Pattern.compile("name=\"uuid\"\\s+value=\"([^\"]+)\"");
    private static final java.util.LinkedHashMap<String, CachedResult> CACHE =
        new java.util.LinkedHashMap<String, CachedResult>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(java.util.Map.Entry<String, CachedResult> eldest) {
                return size() > 24;
            }
        };

    private DriveMedia() {}

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

        String cacheKey = fileId + "|" + (cookie == null ? "" : cookie.hashCode());
        long now = android.os.SystemClock.elapsedRealtime();
        synchronized (CACHE) {
            CachedResult cached = CACHE.get(cacheKey);
            if (cached != null && cached.expiresAt > now) {
                return copyOf(cached.result);
            }
        }

        Result result = resolveUncached(fileId, cookie);
        synchronized (CACHE) {
            CACHE.put(cacheKey, new CachedResult(
                copyOf(result),
                now + (result.error == null ? CACHE_OK_MS : CACHE_FAIL_MS)
            ));
        }
        return result;
    }

    private static Result resolveUncached(String fileId, String cookie) {
        Result result = new Result();
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