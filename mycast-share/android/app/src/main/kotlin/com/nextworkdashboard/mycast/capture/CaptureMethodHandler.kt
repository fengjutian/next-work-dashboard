package com.nextworkdashboard.mycast.capture

import android.app.Activity
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Implements the `com.nextworkdashboard.mycast/capture` MethodChannel.
 *
 * Methods (all return a String stream id on success):
 *   - startScreenCapture({width, height, frameRate, bitrateKbps}) → "mycast-screen"
 *   - startMicrophoneCapture() → "mycast-mic"
 *   - stopScreenCapture() → "ok"
 *   - stopAll() → "ok"
 */
class CaptureMethodHandler(
    private val activity: Activity,
    private val controller: CaptureController,
) : MethodChannel.MethodCallHandler {

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "startScreenCapture" -> {
                    val width = (call.argument<Int>("width")) ?: 1280
                    val height = (call.argument<Int>("height")) ?: 720
                    val frameRate = (call.argument<Int>("frameRate")) ?: 30
                    val bitrateKbps = (call.argument<Int>("bitrateKbps")) ?: 2500
                    val id = controller.startScreenCapture(activity, width, height, frameRate, bitrateKbps)
                    result.success(id)
                }
                "startMicrophoneCapture" -> {
                    val id = controller.startMicrophoneCapture(activity)
                    result.success(id)
                }
                "stopScreenCapture" -> {
                    controller.stopScreenCapture()
                    result.success("ok")
                }
                "stopAll" -> {
                    controller.stopAll()
                    result.success("ok")
                }
                else -> result.notImplemented()
            }
        } catch (e: Throwable) {
            result.error("MYCAST_CAPTURE", e.message, e)
        }
    }
}
