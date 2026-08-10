package com.nextworkdashboard.mycast

import android.content.Intent
import android.os.Build
import android.os.Bundle
import com.nextworkdashboard.mycast.capture.CaptureController
import com.nextworkdashboard.mycast.capture.CaptureMethodHandler
import com.nextworkdashboard.mycast.capture.ScreenCaptureService
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Main entry point for the MyCast phone client.
 *
 * Hosts a single MethodChannel (`com.nextworkdashboard.mycast/capture`) that the
 * Dart layer uses to ask the platform for screen capture, microphone capture,
 * and to stop them. All actual MediaProjection / ForegroundService lifecycle
 * is delegated to [CaptureController] and [ScreenCaptureService].
 */
class MainActivity : FlutterActivity() {

    private var captureChannel: MethodChannel? = null
    private val controller = CaptureController()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val handler = CaptureMethodHandler(
            activity = this,
            controller = controller,
        )
        captureChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.nextworkdashboard.mycast/capture",
        ).apply {
            setMethodCallHandler(handler)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Restore capture state after configuration change / process restart.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            controller.attach(this)
        }
    }

    override fun onDestroy() {
        captureChannel?.setMethodCallHandler(null)
        captureChannel = null
        super.onDestroy()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // Forward MediaProjectionManager confirmation back to the controller so
        // it can start the foreground service and obtain a VirtualDisplay.
        if (requestCode == CaptureController.MEDIA_PROJECTION_REQUEST_CODE) {
            controller.onProjectionResult(resultCode, data)
        }
    }
}
