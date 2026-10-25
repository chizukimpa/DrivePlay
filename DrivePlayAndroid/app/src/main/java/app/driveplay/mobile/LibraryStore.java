package app.driveplay.mobile;

import android.content.SharedPreferences;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native backup for the library, the recents list and per-episode progress.
 *
 * <p>The WebView owns the library UI, but Android can clear WebView storage.
 * Keeping the same JSON document in SharedPreferences means collections,
 * sources and resume points survive a storage wipe or an app update.</p>
 *
 * <p>Progress is owned by the native side: the player writes it while the
 * library page may be paused, so {@link #save(String)} never lets a stale page
 * overwrite it.</p>
 */
final class LibraryStore {

    private static final String KEY_LIBRARY = "library_v3";
    private static final String EMPTY_LIBRARY =
        "{\"collections\":[],\"recents\":{\"folders\":[],\"items\":[]},\"progress\":{}}";

    private final SharedPreferences preferences;
    private String cached = EMPTY_LIBRARY;

    LibraryStore(SharedPreferences preferences) {
        this.preferences = preferences;
        String stored = preferences.getString(KEY_LIBRARY, null);
        if (!TextUtils.isEmpty(stored)) {
            try {
                new JSONObject(stored);
                cached = stored;
            } catch (Exception ignored) {
                cached = EMPTY_LIBRARY;
            }
        }
    }

    synchronized String load() {
        return cached;
    }

    synchronized void save(String json) {
        if (TextUtils.isEmpty(json)) return;
        try {
            JSONObject incoming = new JSONObject(json);
            JSONObject current = new JSONObject(cached);
            JSONObject progress = current.optJSONObject("progress");
            incoming.put("progress", progress == null ? new JSONObject() : progress);
            if (incoming.optJSONObject("recents") == null) {
                JSONObject recents = current.optJSONObject("recents");
                incoming.put("recents", recents == null ? emptyRecents() : recents);
            }
            cached = incoming.toString();
            preferences.edit().putString(KEY_LIBRARY, cached).apply();
        } catch (Exception ignored) {
            // Keep the previous valid copy.
        }
    }

    synchronized void clear() {
        cached = EMPTY_LIBRARY;
        preferences.edit().putString(KEY_LIBRARY, EMPTY_LIBRARY).apply();
    }

    synchronized double getProgress(String id) {
        if (TextUtils.isEmpty(id)) return 0;
        try {
            JSONObject progress = new JSONObject(cached).optJSONObject("progress");
            JSONObject item = progress == null ? null : progress.optJSONObject(id);
            if (item == null) return 0;
            if (item.optBoolean("watched", false)) return 0;
            double time = item.optDouble("time", 0);
            double duration = item.optDouble("duration", 0);
            if (!isFinite(time) || time <= 5) return 0;
            if (duration > 0 && time > duration - 15) return 0;
            return time;
        } catch (Exception ignored) {
            return 0;
        }
    }

    synchronized void clearProgress(String id) {
        if (TextUtils.isEmpty(id)) return;
        try {
            JSONObject document = new JSONObject(cached);
            JSONObject progress = document.optJSONObject("progress");
            if (progress != null) progress.remove(id);
            cached = document.toString();
            preferences.edit().putString(KEY_LIBRARY, cached).apply();
        } catch (Exception ignored) {
            // Nothing else to do.
        }
    }

    /**
     * Updates the resume point, keeps the recents list in sync and returns the
     * refreshed document so the WebView can re-render without another call.
     */
    synchronized String saveProgress(String id, String title, double position, double duration) {
        if (TextUtils.isEmpty(id)) return cached;
        if (!isFinite(position)) position = 0;
        if (!isFinite(duration)) duration = 0;

        try {
            JSONObject document = new JSONObject(cached);
            JSONObject progress = document.optJSONObject("progress");
            if (progress == null) {
                progress = new JSONObject();
                document.put("progress", progress);
            }

            JSONObject item = progress.optJSONObject(id);
            if (item == null) item = new JSONObject();

            double previous = item.optDouble("time", 0);
            boolean watched = item.optBoolean("watched", false);
            double safe = Math.max(0, position);

            // Starting from zero should not erase a real resume point.
            if (safe < 1 && previous > 5) safe = previous;

            if (duration > 1 && (safe >= duration - 15 || safe / duration >= 0.95)) {
                watched = true;
            }
            if (watched && duration > 0) {
                safe = Math.max(safe, duration);
            }

            item.put("time", safe);
            item.put("duration", Math.max(0, duration));
            item.put("watched", watched);
            item.put("updated", System.currentTimeMillis());
            progress.put(id, item);

            JSONObject recents = document.optJSONObject("recents");
            if (recents == null) {
                recents = emptyRecents();
                document.put("recents", recents);
            }
            JSONArray items = recents.optJSONArray("items");
            if (items == null) {
                items = new JSONArray();
                recents.put("items", items);
            }

            String niceTitle = TextUtils.isEmpty(title) ? "Vídeo do Drive" : title;
            JSONArray updated = new JSONArray();
            JSONObject existing = null;
            for (int i = 0; i < items.length(); i++) {
                JSONObject entry = items.optJSONObject(i);
                if (entry == null) continue;
                if (id.equals(entry.optString("id"))) {
                    existing = entry;
                } else if (updated.length() < 29) {
                    updated.put(entry);
                }
            }
            if (existing == null) existing = new JSONObject();
            existing.put("id", id);
            if (!TextUtils.isEmpty(niceTitle)) existing.put("title", niceTitle);
            existing.put("added", System.currentTimeMillis());

            JSONArray finalItems = new JSONArray();
            finalItems.put(existing);
            for (int i = 0; i < updated.length(); i++) finalItems.put(updated.get(i));
            recents.put("items", finalItems);

            cached = document.toString();
            preferences.edit().putString(KEY_LIBRARY, cached).apply();
            return cached;
        } catch (Exception ignored) {
            return cached;
        }
    }

    private static JSONObject emptyRecents() {
        try {
            JSONObject recents = new JSONObject();
            recents.put("folders", new JSONArray());
            recents.put("items", new JSONArray());
            return recents;
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static boolean isFinite(double value) {
        return !Double.isNaN(value) && !Double.isInfinite(value);
    }
}
