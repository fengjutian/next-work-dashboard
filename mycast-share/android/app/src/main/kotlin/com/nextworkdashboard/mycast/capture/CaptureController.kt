package com.nextworkdashboard.mycast.capture

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.Display
import android.view.WindowManager
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Owns the long-lived [MediaProjection] instance returned by
 * `MediaProjectionManager.createScreenCaptureIntent()`. The activity starts
 * the intent; on result, the controller binds the projection, starts a
 * foreground service, and hands the projection to a [ScreenCapturer].
 */
class CaptureController {

    companion object {
        const val MEDIA_PROJECTION_REQUEST_CODE = 0x4D50 // "MP"
        const val STREAM_ID_SCREEN = "mycast-screen"
        const val STREAM_ID_MIC = "mycast-mic"
        private const val TAG = "MyCast.Capture"
        private const val CHANNEL_ID = "mycast.screen_capture"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val projectionRef = AtomicReference<MediaProjection?>()
    private val pending = AtomicBoolean(false)
    private var screenCapturer: ScreenCapturer? = null
    private var microphoneCapturer: MicrophoneCapturer? = null
    private var lastWidth: Int = 1280
    private var lastHeight: Int = 720
    private var lastFrameRate: Int = 30
    private var lastBitrateKbps: Int = 2500
    private var attached: Activity? = null

    fun startScreenCapture(
        activity: Activity,
        width: Int,
        height: Int,
        frameRate: Int,
        bitrateKbps: Int,
    ): String {
        lastWidth = width
        lastHeight = height
        lastFrameRate = frameRate
        lastBitrateKbps = bitrateKbps
        if (projectionRef.get() != null) {
            rebindCapturer()
            return STREAM_ID_SCREEN
        }
        if (pending.compareAndSet(false, true)) {
            val mpm = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val intent = mpm.createScreenCaptureIntent()
            activity.startActivityForResult(intent, MEDIA_PROJECTION_REQUEST_CODE)
        }
        return STREAM_ID_SCREEN
    }

    fun startMicrophoneCapture(activity: Activity): String {
        if (microphoneCapturer == null) {
            microphoneCapturer = MicrophoneCapturer(activity).also { it.start() }
        }
        return STREAM_ID_MIC
    }

    fun stopScreenCapture() {
        try { screenCapturer?.stop() } catch (e: Throwable) { Log.w(TAG, "screenCapturer.stop failed: ${e.message}") }
        screenCapturer = null
        projectionRef.get()?.stop()
        projectionRef.set(null)
        try {
            val ctx = attached ?: return
            ctx.stopService(Intent(ctx, ScreenCaptureService::class.java))
        } catch (_: Throwable) { /* noop */ }
    }

    fun stopAll() {
        stopScreenCapture()
        try { microphoneCapturer?.stop() } catch (_: Throwable) { /* noop */ }
        microphoneCapturer = null
    }

    fun attach(activity: Activity) {
        attached = activity
    }

    fun onProjectionResult(resultCode: Int, data: Intent?) {
        pending.set(false)
        val activity = attached ?: return
        if (resultCode != Activity.RESULT_OK || data == null) {
            Log.w(TAG, "MediaProjection denied (resultCode=$resultCode)")
            return
        }
        val mpm = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = mpm.getMediaProjection(resultCode, data)
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                Log.i(TAG, "MediaProjection stopped by system")
                mainHandler.post { stopScreenCapture() }
            }
        }, mainHandler)
        projectionRef.set(projection)
        startForegroundService(activity)
        rebindCapturer()
    }

    private fun rebindCapturer() {
        val projection = projectionRef.get() ?: return
        val display = attached?.let {
            (it.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        }
        val (w, h) = display?.let { actualSize(it) } ?: (lastWidth to lastHeight)
        screenCapturer = ScreenCapturer(projection, w, h, lastFrameRate, lastBitrateKbps).also { it.start() }
    }

    private fun actualSize(display: Display): Pair<Int, Int> {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        display.getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
    }

    private fun startForegroundService(activity: Activity) {
        ensureChannel(activity)
        val notification: Notification = Notification.Builder(activity, CHANNEL_ID)
            .setContentTitle("MyCast 正在共享屏幕")
            .setContentText("点击「停止投屏」按钮结束")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
        ScreenCaptureService.lastNotification = notification
        val intent = Intent(activity, ScreenCaptureService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }
    }

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "屏幕共享",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "MyCast 投屏时显示的前台服务通知" }
            nm.createNotificationChannel(channel)
        }
    }
}
