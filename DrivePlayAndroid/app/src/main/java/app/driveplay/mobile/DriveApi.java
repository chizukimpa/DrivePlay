package app.driveplay.mobile;

import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Small, dependency-free reader for the public Google Drive folder listing.
 *
 * <p>Google exposes a static HTML view of shared folders at
 * {@code /embeddedfolderview?id=...}. It is the same source used by the desktop
 * builds, works for folders shared as "anyone with the link" and does not
 * require OAuth. Private folders fall back to the browser/Drive app.</p>
 */
final class DriveApi {

    static final String USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    private static final Pattern TITLE = Pattern.compile("<title>(.*?)</title>", Pattern.DOTALL);
    private static final Pattern ENTRY_ID = Pattern.compile("id=\"entry-([^\"]+)\"");
    private static final Pattern ENTRY_TITLE = Pattern.compile(
        "flip-entry-title\">(.*?)</div>", Pattern.DOTALL);
    private static final Pattern ENTRY_MODIFIED = Pattern.compile(
        "flip-entry-last-modified\"><div>(.*?)</div>", Pattern.DOTALL);
    private static final Pattern ENTRY_THUMB = Pattern.compile(
        "flip-entry-thumb\"><img src=\"([^\"]+)\"", Pattern.DOTALL);
    private static final Pattern ENTRY_HREF = Pattern.compile(
        "href=\"([^\"]+)\"", Pattern.DOTALL);
    private static final Pattern MIME = Pattern.compile(
        "type/([a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+)");
    private static final Pattern TAGS = Pattern.compile("<[^>]+>");
    private static final Pattern NUMERIC_HEX = Pattern.compile("&#x([0-9a-fA-F]+);");
    private static final Pattern NUMERIC_DEC = Pattern.compile("&#([0-9]+);");

    private DriveApi() {
    }

    static final class FolderException extends Exception {
        FolderException(String message) {
            super(message);
        }
    }

    static JSONObject fetchFolder(String folderId, String cookie) throws Exception {
        if (TextUtils.isEmpty(folderId)) {
            throw new FolderException("Pasta inválida.");
        }

        String encoded = URLEncoder.encode(folderId, "UTF-8");
        String url = "https://drive.google.com/embeddedfolderview?id=" + encoded + "#list";

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(25000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            connection.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8");
            connection.setRequestProperty("Accept-Encoding", "gzip");
            if (!TextUtils.isEmpty(cookie)) {
                connection.setRequestProperty("Cookie", cookie);
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();
            if (stream == null) {
                throw new FolderException("O Google Drive não respondeu.");
            }

            String encoding = connection.getContentEncoding();
            if (encoding != null && encoding.toLowerCase(Locale.US).contains("gzip")) {
                stream = new GZIPInputStream(stream);
            }

            String html = readAll(stream);
            if (status >= 400) {
                throw new FolderException("O Drive respondeu com erro " + status + ".");
            }
            if (!html.contains("flip-entry") && !html.contains("id=\"flip-contents\"")) {
                throw new FolderException(
                    "Esta pasta não está pública. Compartilhe como “qualquer pessoa com o link”."
                );
            }

            JSONObject folder = new JSONObject();
            folder.put("id", folderId);
            folder.put("name", parseTitle(html));
            folder.put("entries", parseEntries(html));
            folder.put("fetched", System.currentTimeMillis());
            return folder;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    static String parseTitle(String html) {
        Matcher matcher = TITLE.matcher(html == null ? "" : html);
        if (!matcher.find()) return "Pasta do Drive";
        String name = cleanText(decodeEntities(matcher.group(1)));
        return TextUtils.isEmpty(name) ? "Pasta do Drive" : name;
    }

    static JSONArray parseEntries(String html) {
        JSONArray entries = new JSONArray();
        if (TextUtils.isEmpty(html)) return entries;

        String[] chunks = html.split("<div class=\"flip-entry\"");
        for (int i = 1; i < chunks.length; i++) {
            String chunk = chunks[i];

            Matcher idMatcher = ENTRY_ID.matcher(chunk);
            if (!idMatcher.find()) continue;
            String id = idMatcher.group(1);

            Matcher titleMatcher = ENTRY_TITLE.matcher(chunk);
            if (!titleMatcher.find()) continue;
            String name = cleanText(decodeEntities(titleMatcher.group(1)));
            if (TextUtils.isEmpty(name)) continue;

            boolean isFolder = chunk.contains("drive-sprite-folder")
                || chunk.contains("aria-label=\"Folder\"")
                || chunk.contains("/drive/folders/");

            String mime = null;
            Matcher mimeMatcher = MIME.matcher(chunk);
            if (mimeMatcher.find()) {
                mime = mimeMatcher.group(1).toLowerCase(Locale.US);
            }

            String extension = extensionOf(name);
            boolean isVideo = mime != null && mime.startsWith("video/")
                || isVideoExtension(extension);

            String modified = null;
            Matcher modifiedMatcher = ENTRY_MODIFIED.matcher(chunk);
            if (modifiedMatcher.find()) {
                modified = cleanText(decodeEntities(modifiedMatcher.group(1)));
            }

            String thumbnail = null;
            Matcher thumbMatcher = ENTRY_THUMB.matcher(chunk);
            if (thumbMatcher.find()) {
                thumbnail = decodeEntities(thumbMatcher.group(1));
            }

            String href = null;
            Matcher hrefMatcher = ENTRY_HREF.matcher(chunk);
            if (hrefMatcher.find()) {
                href = decodeEntities(hrefMatcher.group(1));
            }

            try {
                JSONObject entry = new JSONObject();
                entry.put("id", id);
                entry.put("title", name);
                entry.put("name", name);
                entry.put("isFolder", isFolder);
                entry.put("isVideo", isVideo && !isFolder);
                entry.put("mime", mime == null ? "" : mime);
                entry.put("modified", modified == null ? "" : modified);
                entry.put("thumbnail", thumbnail == null ? "" : thumbnail);
                entry.put("url", href == null ? "" : href);
                entry.put("extension", extension);
                entries.put(entry);
            } catch (Exception ignored) {
                // One malformed entry should never hide the rest of the folder.
            }
        }
        return entries;
    }

    static String decodeEntities(String value) {
        if (value == null || value.isEmpty()) return "";
        String text = value;

        Matcher hex = NUMERIC_HEX.matcher(text);
        StringBuffer hexBuffer = new StringBuffer();
        while (hex.find()) {
            try {
                hex.appendReplacement(hexBuffer,
                    Matcher.quoteReplacement(new String(Character.toChars(
                        Integer.parseInt(hex.group(1), 16)))));
            } catch (Exception ignored) {
                hex.appendReplacement(hexBuffer, "");
            }
        }
        hex.appendTail(hexBuffer);
        text = hexBuffer.toString();

        Matcher dec = NUMERIC_DEC.matcher(text);
        StringBuffer decBuffer = new StringBuffer();
        while (dec.find()) {
            try {
                dec.appendReplacement(decBuffer,
                    Matcher.quoteReplacement(new String(Character.toChars(
                        Integer.parseInt(dec.group(1), 10)))));
            } catch (Exception ignored) {
                dec.appendReplacement(decBuffer, "");
            }
        }
        dec.appendTail(decBuffer);
        text = decBuffer.toString();

        return text
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&nbsp;", " ");
    }

    static String cleanText(String value) {
        if (value == null) return "";
        return TAGS.matcher(value).replaceAll(" ").replaceAll("\\s+", " ").trim();
    }

    static boolean isVideoExtension(String extension) {
        if (extension == null) return false;
        switch (extension.toLowerCase(Locale.US)) {
            case "mkv":
            case "mp4":
            case "m4v":
            case "avi":
            case "mov":
            case "webm":
            case "ts":
            case "m2ts":
            case "mpg":
            case "mpeg":
            case "wmv":
            case "flv":
            case "ogv":
            case "3gp":
                return true;
            default:
                return false;
        }
    }

    private static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1);
    }

    private static String readAll(InputStream stream) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = stream.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }
}
