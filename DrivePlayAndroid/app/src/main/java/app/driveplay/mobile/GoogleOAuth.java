package app.driveplay.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Google OAuth 2.0 for installed apps using the system browser and a loopback
 * redirect. This bypasses the WebView login block and uses the user's own Drive
 * quota, so the original file (with all audio/subtitle tracks) can be played.
 *
 * The user creates a "Desktop app" OAuth client in Google Cloud and pastes the
 * client id/secret in the app. The redirect goes to http://127.0.0.1:<port>.
 */
final class GoogleOAuth {

    private static final String PREFS = "driveplay";
    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String[] TOKEN_URLS = {
        "https://oauth2.googleapis.com/token",
        "https://www.googleapis.com/oauth2/v4/token",
        "https://accounts.google.com/o/oauth2/token",
    };
    private static final String SCOPE = "https://www.googleapis.com/auth/drive.readonly";

    interface Callback {
        void onSuccess(String accessToken);
        void onError(String message);
    }

    private GoogleOAuth() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String cachedToken(Context context) {
        SharedPreferences prefs = prefs(context);
        String token = prefs.getString("oauthAccessToken", "");
        long expires = prefs.getLong("oauthExpiresAt", 0);
        if (!TextUtils.isEmpty(token) && expires > System.currentTimeMillis() + 60000L) {
            return token;
        }
        return "";
    }

    static boolean hasAccount(Context context) {
        return !TextUtils.isEmpty(prefs(context).getString("oauthRefreshToken", ""));
    }

    static String clientId(Context context) {
        return prefs(context).getString("oauthClientId", "");
    }

    static String clientSecret(Context context) {
        return prefs(context).getString("oauthClientSecret", "");
    }

    static void saveClient(Context context, String id, String secret) {
        prefs(context).edit()
            .putString("oauthClientId", id == null ? "" : id.trim())
            .putString("oauthClientSecret", secret == null ? "" : secret.trim())
            .apply();
    }

    static void disconnect(Context context) {
        prefs(context).edit()
            .remove("oauthAccessToken")
            .remove("oauthRefreshToken")
            .remove("oauthExpiresAt")
            .apply();
    }

    /** Returns a valid access token, refreshing it if needed. May block on I/O. */
    static String accessToken(Context context) {
        String cached = cachedToken(context);
        if (!TextUtils.isEmpty(cached)) return cached;

        SharedPreferences prefs = prefs(context);
        String refresh = prefs.getString("oauthRefreshToken", "");
        String clientId = prefs.getString("oauthClientId", "");
        String secret = prefs.getString("oauthClientSecret", "");
        if (TextUtils.isEmpty(refresh) || TextUtils.isEmpty(clientId) || TextUtils.isEmpty(secret)) {
            return "";
        }

        try {
            String body = "client_id=" + enc(clientId)
                + "&client_secret=" + enc(secret)
                + "&refresh_token=" + enc(refresh)
                + "&grant_type=refresh_token";
            JSONObject json = postToken(body);
            String token = json.optString("access_token", "");
            long expiresIn = json.optLong("expires_in", 3600);
            String newRefresh = json.optString("refresh_token", "");
            if (!TextUtils.isEmpty(token)) {
                SharedPreferences.Editor editor = prefs.edit()
                    .putString("oauthAccessToken", token)
                    .putLong("oauthExpiresAt", System.currentTimeMillis() + expiresIn * 1000L);
                if (!TextUtils.isEmpty(newRefresh)) {
                    editor.putString("oauthRefreshToken", newRefresh);
                }
                editor.apply();
                return token;
            }
        } catch (Exception error) {
            android.util.Log.d("DrivePlay", "oauth refresh failed: " + error.getMessage());
        }
        return "";
    }

    static void connect(final Context context, final String clientId,
                        final String clientSecret, final Callback callback) {
        if (TextUtils.isEmpty(clientId) || TextUtils.isEmpty(clientSecret)) {
            callback.onError("Informe o Client ID e o Client secret do OAuth.");
            return;
        }
        saveClient(context, clientId, clientSecret);
        final Handler main = new Handler(Looper.getMainLooper());
        Thread thread = new Thread(new Runnable() {
            @Override public void run() {
                ServerSocket server = null;
                Socket socket = null;
                try {
                    server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
                    int port = server.getLocalPort();
                    final String redirect = "http://127.0.0.1:" + port + "/oauth2redirect";
                    final String verifier = randomToken(64);
                    final String challenge = base64Url(sha256(verifier));
                    final String state = randomToken(24);

                    String url = AUTH_URL
                        + "?client_id=" + enc(clientId)
                        + "&redirect_uri=" + enc(redirect)
                        + "&response_type=code"
                        + "&scope=" + enc(SCOPE)
                        + "&access_type=offline"
                        + "&prompt=consent"
                        + "&include_granted_scopes=true"
                        + "&state=" + enc(state)
                        + "&code_challenge=" + enc(challenge)
                        + "&code_challenge_method=S256";

                    main.post(new Runnable() {
                        @Override public void run() {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                context.startActivity(intent);
                            } catch (Exception error) {
                                main.post(new Runnable() {
                                    @Override public void run() {
                                        callback.onError("Não foi possível abrir o navegador.");
                                    }
                                });
                            }
                        }
                    });

                    server.setSoTimeout(180000);
                    socket = server.accept();
                    String firstLine = readLine(socket.getInputStream());
                    String target = "";
                    if (firstLine != null) {
                        String[] parts = firstLine.split(" ");
                        if (parts.length > 1) target = parts[1];
                    }
                    Uri redirectUri = Uri.parse("http://127.0.0.1" + target);
                    String code = redirectUri.getQueryParameter("code");
                    String error = redirectUri.getQueryParameter("error");
                    String returnedState = redirectUri.getQueryParameter("state");
                    respond(socket, code != null && error == null);
                    closeQuietly(socket);
                    socket = null;
                    closeQuietly(server);
                    server = null;

                    if (!TextUtils.isEmpty(error)) {
                        final String message = "Login cancelado: " + error;
                        main.post(new Runnable() {
                            @Override public void run() { callback.onError(message); }
                        });
                        return;
                    }
                    if (TextUtils.isEmpty(code)) {
                        main.post(new Runnable() {
                            @Override public void run() {
                                callback.onError("O Google não devolveu o código de login.");
                            }
                        });
                        return;
                    }
                    if (!state.equals(returnedState)) {
                        main.post(new Runnable() {
                            @Override public void run() {
                                callback.onError("Login inválido (state diferente). Tente de novo.");
                            }
                        });
                        return;
                    }

                    String body = "code=" + enc(code)
                        + "&client_id=" + enc(clientId)
                        + "&client_secret=" + enc(clientSecret)
                        + "&redirect_uri=" + enc(redirect)
                        + "&grant_type=authorization_code"
                        + "&code_verifier=" + enc(verifier);
                    JSONObject json = postToken(body);
                    String access = json.optString("access_token", "");
                    final String refresh = json.optString("refresh_token", "");
                    long expiresIn = json.optLong("expires_in", 3600);
                    if (TextUtils.isEmpty(access)) {
                        final String message = json.optString("error_description",
                            "Não foi possível concluir o login.");
                        main.post(new Runnable() {
                            @Override public void run() { callback.onError(message); }
                        });
                        return;
                    }
                    prefs(context).edit()
                        .putString("oauthAccessToken", access)
                        .putString("oauthRefreshToken", refresh)
                        .putLong("oauthExpiresAt", System.currentTimeMillis() + expiresIn * 1000L)
                        .putString("oauthClientId", clientId)
                        .putString("oauthClientSecret", clientSecret)
                        .apply();
                    final String token = access;
                    main.post(new Runnable() {
                        @Override public void run() { callback.onSuccess(token); }
                    });
                } catch (Exception error) {
                    final String message = isDnsError(error)
                        ? "Não foi possível falar com o Google (DNS). Verifique a internet "
                            + "ou o DNS privado do celular e toque em Conectar de novo."
                        : "Falha no login: " + error.getMessage();
                    main.post(new Runnable() {
                        @Override public void run() { callback.onError(message); }
                    });
                } finally {
                    closeQuietly(socket);
                    closeQuietly(server);
                }
            }
        }, "driveplay-oauth");
        thread.start();
    }

    private static JSONObject postToken(String body) throws Exception {
        Exception last = null;
        for (String endpoint : TOKEN_URLS) {
            try {
                return postToken(endpoint, body);
            } catch (Exception error) {
                if (!isDnsError(error)) throw error;
                last = error;
                android.util.Log.d("DrivePlay", "oauth token dns failed for " + endpoint);
            }
        }
        throw last == null ? new Exception("Não foi possível falar com o Google.") : last;
    }

    private static JSONObject postToken(String endpoint, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(30000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setRequestProperty("Accept", "application/json");
        OutputStream output = connection.getOutputStream();
        output.write(body.getBytes(StandardCharsets.UTF_8));
        output.close();

        int status = connection.getResponseCode();
        InputStream input = status >= 200 && status < 300
            ? connection.getInputStream() : connection.getErrorStream();
        String text = readAll(input);
        connection.disconnect();
        JSONObject json = new JSONObject(TextUtils.isEmpty(text) ? "{}" : text);
        if (status < 200 || status >= 300) {
            throw new Exception(json.optString("error_description",
                json.optString("error", "HTTP " + status)));
        }
        return json;
    }

    private static boolean isDnsError(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof java.net.UnknownHostException) return true;
            String message = current.getMessage();
            if (message != null) {
                String lower = message.toLowerCase(java.util.Locale.ROOT);
                if (lower.contains("unable to resolve host")
                    || lower.contains("no address associated with hostname")
                    || lower.contains("nodename nor servname")) {
                    return true;
                }
            }
            current = current.getCause();
        }
        return false;
    }

    private static void respond(Socket socket, boolean ok) {
        try {
            String html = ok
                ? "<html><body style='background:#0b0c10;color:#fff;font:16px sans-serif;text-align:center;padding:60px'>"
                    + "<h2>Login concluído</h2><p>Volte para o DrivePlay.</p></body></html>"
                : "<html><body style='background:#0b0c10;color:#fff;font:16px sans-serif;text-align:center;padding:60px'>"
                    + "<h2>Login não concluído</h2><p>Volte para o DrivePlay e tente novamente.</p></body></html>";
            byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
            String headers = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n";
            OutputStream output = socket.getOutputStream();
            output.write(headers.getBytes(StandardCharsets.UTF_8));
            output.write(bytes);
            output.flush();
        } catch (Exception ignored) {
            // The browser may have closed the connection.
        }
    }

    private static String readLine(InputStream input) {
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            int value;
            while ((value = input.read()) != -1) {
                if (value == '\n') break;
                if (value != '\r') buffer.write(value);
                if (buffer.size() > 8192) break;
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            return null;
        }
    }

    private static String readAll(InputStream input) {
        if (input == null) return "";
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = input.read(chunk)) > 0) buffer.write(chunk, 0, read);
            input.close();
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            return "";
        }
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) return;
        try { closeable.close(); } catch (Exception ignored) {}
    }

    private static String enc(String value) {
        try { return URLEncoder.encode(value == null ? "" : value, "UTF-8"); }
        catch (Exception error) { return ""; }
    }

    private static String randomToken(int bytes) {
        byte[] data = new byte[bytes];
        new SecureRandom().nextBytes(data);
        return Base64.encodeToString(data,
            Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static byte[] sha256(String value) throws Exception {
        return MessageDigest.getInstance("SHA-256")
            .digest(value.getBytes(StandardCharsets.US_ASCII));
    }

    private static String base64Url(byte[] data) {
        return Base64.encodeToString(data,
            Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
}
