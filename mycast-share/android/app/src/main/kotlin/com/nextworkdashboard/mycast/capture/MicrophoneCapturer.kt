package com.nextworkdashboard.mycast.capture

import android.app.Activity
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log

/**
 * AudioRecord-based microphone capturer.
 *
 * MVP: we simply hold an [AudioRecord] open at 16 kHz / 16-bit / mono so the
 * audio permission is requested and granted (otherwise WebRTC's microphone
 * path fails later). Frames are discarded for now; wiring into libwebrtc
 * is a Phase-2 task identical in shape to the screen capturer.
 */
class MicrophoneCapturer(private val activity: Activity) {
    private var recorder: AudioRecord? = null
    private var thread: Thread? = null
    @Volatile private var running = false

    fun start() {
        if (running) return
        val sampleRate = 16000
        val channel = AudioFormat.CHANNEL_IN_MONO
        val encoding = AudioFormat.ENCODING_PCM_16BIT
        val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channel, encoding)
        if (minBuffer <= 0) {
            Log.w("MyCast.Capture", "AudioRecord.getMinBufferSize returned $minBuffer")
            return
        }
        val bufferSize = minBuffer * 4
        try {
            recorder = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate, channel, encoding, bufferSize,
            )
            if (recorder?.state != AudioRecord.STATE_INITIALIZED) {
                Log.w("MyCast.Capture", "AudioRecord not initialized; releasing")
                recorder?.release()
                recorder = null
                return
            }
            recorder?.startRecording()
            running = true
            thread = Thread({ readLoop(bufferSize) }, "MyCast-Mic").also { it.isDaemon = true; it.start() }
        } catch (e: SecurityException) {
            Log.w("MyCast.Capture", "AudioRecord permission denied: ${e.message}")
            recorder?.release()
            recorder = null
        }
    }

    private fun readLoop(bufferSize: Int) {
        val buf = ByteArray(bufferSize)
        while (running) {
            val r = recorder ?: break
            val n = try { r.read(buf, 0, buf.size) } catch (_: Throwable) { -1 }
            if (n <= 0) break
            // Frames discarded in Phase 1.
        }
    }

    fun stop() {
        running = false
        try { recorder?.stop() } catch (_: Throwable) {}
        try { recorder?.release() } catch (_: Throwable) {}
        recorder = null
        thread?.interrupt()
        thread = null
    }
}
