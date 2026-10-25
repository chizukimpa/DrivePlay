package app.driveplay.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps DrivePlay alive while the video plays in the background.
 *
 * <p>Without a foreground service Samsung (and Android itself) may destroy the
 * activity as soon as the user switches apps, locks the screen or folds the
 * phone to the cover display. The service owns no player: it only keeps the
 * process alive and offers pause/close actions from the notification.</p>
 */
public final class PlaybackService extends Service {

    static final String CHANNEL_ID = "driveplay_playback";
    static final int NOTIFICATION_ID = 0x4450;

    private static final String ACTION_START = "app.driveplay.mobile.PLAYBACK_START";
    private static final String ACTION_STOP = "app.driveplay.mobile.PLAYBACK_STOP";
    private static final String ACTION_TOGGLE = "app.driveplay.mobile.PLAYBACK_TOGGLE";
    private static final String EXTRA_PLAYING = "playing";

    private static boolean running;
    private static boolean playing = true;
    private static String title = "DrivePlay";
    private static MainActivity host;

    private MediaSession mediaSession;

    static void attach(MainActivity activity) {
        host = activity;
    }

    static void detach(MainActivity activity) {
        if (host == activity) host = null;
    }

    static boolean isRunning() {
        return running;
    }

    /** Sets the title used by the notification and the media session. */
    static void rememberTitle(String value) {
        if (value != null && !value.trim().isEmpty()) title = value.trim();
    }

    static void updateTitle(Context context, String value) {
        rememberTitle(value);
        if (!running) return;
        Intent intent = new Intent(context, PlaybackService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_PLAYING, playing);
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            // The next notification update will pick it up.
        }
    }

    static void start(Context context, boolean isPlaying) {
        playing = isPlaying;
        Intent intent = new Intent(context, PlaybackService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_PLAYING, isPlaying);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
            // Background start restrictions: playback keeps working without it.
        }
    }

    static void stop(Context context) {
        running = false;
        try {
            context.stopService(new Intent(context, PlaybackService.class));
        } catch (Exception ignored) {
            // Already stopped.
        }
    }

    static void updatePlaying(Context context, boolean isPlaying) {
        if (!running || playing == isPlaying) return;
        playing = isPlaying;
        Intent intent = new Intent(context, PlaybackService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_PLAYING, isPlaying);
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            // Notification update is best effort.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            running = false;
            MainActivity activity = host;
            if (activity != null) activity.backgroundClose();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_TOGGLE.equals(action)) {
            MainActivity activity = host;
            if (activity != null) activity.backgroundToggle();
            playing = !playing;
            showNotification();
            return START_STICKY;
        }

        if (intent != null && intent.hasExtra(EXTRA_PLAYING)) {
            playing = intent.getBooleanExtra(EXTRA_PLAYING, playing);
        }
        running = true;
        showNotification();
        return START_STICKY;
    }

    private void showNotification() {
        ensureMediaSession();
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception error) {
            // Some OEMs require an active media session (or the app is not in
            // the foreground). Keep the service without the foreground flag so
            // playback is never interrupted.
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {
                running = false;
                stopSelf();
            }
        }
    }

    /** Android 15+ expects the mediaPlayback FGS type to own a media session. */
    private void ensureMediaSession() {
        if (mediaSession != null) {
            updateSessionState();
            return;
        }
        try {
            mediaSession = new MediaSession(this, "DrivePlay");
            mediaSession.setActive(true);
            updateSessionState();
        } catch (Exception ignored) {
            mediaSession = null;
        }
    }

    private void updateSessionState() {
        if (mediaSession == null) return;
        try {
            PlaybackState.Builder state = new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY
                    | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE)
                .setState(
                    playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                    PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                    playing ? 1f : 0f
                );
            mediaSession.setPlaybackState(state.build());
            mediaSession.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "DrivePlay")
                .build());
        } catch (Exception ignored) {
            // Playback state is informational.
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Reprodução em segundo plano",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Mantém o vídeo aberto quando você sai do app.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 1, open, flags);

        Intent toggle = new Intent(this, PlaybackService.class).setAction(ACTION_TOGGLE);
        PendingIntent toggleIntent = PendingIntent.getService(this, 2, toggle, flags);

        Intent close = new Intent(this, PlaybackService.class).setAction(ACTION_STOP);
        PendingIntent closeIntent = PendingIntent.getService(this, 3, close, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder
            .setContentTitle(title)
            .setContentText(playing
                ? "Reproduzindo em segundo plano"
                : "Vídeo pausado")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent)
            .addAction(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Pausar" : "Reproduzir",
                toggleIntent
            )
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Fechar", closeIntent);
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        if (mediaSession != null) {
            try {
                builder.setStyle(new Notification.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1));
            } catch (Exception ignored) {
                // Plain notification is fine.
            }
        }
        return builder.build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Keep the service (and playback) alive when the task is swiped away.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Exception ignored) {
                // Already released.
            }
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
