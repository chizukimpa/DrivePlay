package app.driveplay.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps the app process out of Samsung's background freezer while the user
 * finishes the Google login in the browser.
 *
 * <p>The OAuth redirect comes back to a loopback ServerSocket owned by the app.
 * If the process is frozen, the TCP handshake stays in SYN_SENT and the
 * browser shows ERR_CONNECTION_REFUSED after a while. A dataSync foreground
 * service keeps the accept loop running until the code arrives.</p>
 */
public final class OAuthKeepAliveService extends Service {

    private static final String CHANNEL_ID = "driveplay_oauth";
    private static final int NOTIFICATION_ID = 0x4451;
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_TEXT = "text";

    static void start(Context context) {
        start(context, "Conectando à conta Google…",
            "Conclua o login no navegador. O DrivePlay volta sozinho.");
    }

    static void start(Context context, String title, String text) {
        Intent intent = new Intent(context, OAuthKeepAliveService.class);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_TEXT, text);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
            // If the OEM refuses the service, the normal 15-minute OAuth
            // window still gives the user a chance to return to the app.
        }
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, OAuthKeepAliveService.class));
        } catch (Exception ignored) {
            // Already stopped.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Login do Google", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mantém o DrivePlay ativo enquanto você conecta a conta.");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        String text = intent == null ? null : intent.getStringExtra(EXTRA_TEXT);
        if (title == null || title.isEmpty()) title = "Conectando à conta Google…";
        if (text == null || text.isEmpty()) {
            text = "Conclua o login no navegador. O DrivePlay volta sozinho.";
        }

        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 7, open, pendingFlags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true);

        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, builder.build(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, builder.build());
            }
        } catch (Exception error) {
            try {
                startForeground(NOTIFICATION_ID, builder.build());
            } catch (Exception ignored) {
                stopSelf();
            }
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        try { stopForeground(true); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
