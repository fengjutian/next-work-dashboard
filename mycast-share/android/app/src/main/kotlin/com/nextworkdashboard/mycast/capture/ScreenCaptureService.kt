package com.nextworkdashboard.mycast.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Foreground service that hosts the screen capture session.
 *
 * Android 14 (API 34) requires the `mediaProjection` foreground service type
 * and a matching permission. The notification is built by the controller and
 * shown on `startForeground(...)` so the OS keeps our process alive while the
 * user can see we're actively sharing their screen.
 *
 * The actual screen capture pipeline lives in [ScreenCapturer]; this service
 * exists purely to satisfy the foreground-service requirement and to keep the
 * process alive when the user navigates away from the app.
 */
class ScreenCaptureService : Service() {

    companion object {
        private const val TAG = "MyCast.Svc"
        const val NOTIFICATION_ID = 0x4D43 // "MC"
        const val CHANNEL_ID = "mycast.screen_capture"

        /** Last notification built by the controller. The service reuses it. */
        @Volatile
        var lastNotification: Notification? = null

        fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    CHANNEL_ID,
                    "屏幕共享",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = "MyCast 投屏时显示的前台服务通知" }
                nm.createNotificationChannel(ch)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        ensureChannel(this)
        Log.i(TAG, "ScreenCaptureService onCreate")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = lastNotification ?: Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("MyCast 正在共享屏幕")
            .setContentText("投屏进行中…")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Throwable) {
            Log.w(TAG, "startForeground failed: ${e.message}")
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.i(TAG, "ScreenCaptureService onDestroy")
        super.onDestroy()
    }
}
