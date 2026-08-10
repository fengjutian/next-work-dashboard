package com.nextworkdashboard.mycast.capture

import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.util.DisplayMetrics
import android.util.Log
import android.view.Surface
import android.view.WindowManager

/**
 * Wraps a [MediaProjection] into a [VirtualDisplay] whose surface is rendered
 * to an off-screen Surface. Phase 1 only wires the MediaProjection → VirtualDisplay
 * pipeline; the resulting YUV frames are then handed off to a `libwebrtc`
 * `VideoSource` via a custom `VideoCapturer` (Phase 2 — see README).
 *
 * Until that path is built, [MediaStream]s obtained from the controller will
 * return empty (no video frames) but the WebRTC peer connection and signaling
 * flow can be exercised end-to-end. The desktop will see a connected session
 * with zero incoming bitrate.
 */
class ScreenCapturer(
    private val projection: MediaProjection,
    private val width: Int,
    private val height: Int,
    private val frameRate: Int,
    private val bitrateKbps: Int,
) {
    private var virtualDisplay: VirtualDisplay? = null
    private var callback: MediaProjection.Callback? = null

    fun start() {
        Log.i(
            "MyCast.Capture",
            "starting VirtualDisplay: ${width}x${height}@${frameRate} bitrate=${bitrateKbps}kbps"
        )
        // The Surface we hand to VirtualDisplay is just a sink for the MVP.
        // In Phase 2 this becomes the input surface of MediaCodec (H.264 encoder)
        // whose output frames are pushed to libwebrtc.
        val sink = Surface(SurfaceTexture(0))
        try {
            virtualDisplay = projection.createVirtualDisplay(
                "mycast-screen",
                width, height, frameRate * 2,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                sink,
                null, null,
            )
        } catch (e: Throwable) {
            Log.w("MyCast.Capture", "createVirtualDisplay failed: ${e.message}")
        }
        // Hold the callback so we know when the projection stops.
        callback = object : MediaProjection.Callback() {
            override fun onStop() {
                Log.i("MyCast.Capture", "projection onStop")
                stop()
            }
        }
    }

    fun stop() {
        try { virtualDisplay?.release() } catch (_: Throwable) {}
        virtualDisplay = null
    }
}

private class SurfaceTexture @JvmOverloads constructor(texName: Int) :
    android.graphics.SurfaceTexture(texName)
