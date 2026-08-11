import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:uuid/uuid.dart';

import '../pairing/device_profile.dart';
import '../pairing/pairing_service.dart';
import '../settings/settings_store.dart';
import '../signaling/signaling_client.dart';
import '../signaling/signaling_frames.dart';
import 'quality_preset.dart';

enum CastingStatus { idle, requestingCapture, capturing, negotiating, streaming, stopped, error }

/// Orchestrates a single WebRTC screen-casting session:
///
///   1.  Request screen capture permission via the platform native bridge
///       (MediaProjection on Android; ReplayKit on iOS).
///   2.  Acquire a MediaStream.
///   3.  Create a `RTCPeerConnection`, attach the video track.
///   4.  Generate an SDP offer, send it via the signaling WebSocket.
///   5.  Apply the desktop's answer, exchange ICE candidates.
///   6.  Stream until the user stops or the connection drops.
class CastingService extends ChangeNotifier {
  CastingService();

  CastingStatus _status = CastingStatus.idle;
  CastingStatus get status => _status;

  String? _error;
  String? get error => _error;

  String? _activeSessionId;
  String? get activeSessionId => _activeSessionId;

  QualityPreset _quality = QualityPreset.balanced;
  QualityPreset get quality => _quality;

  bool _includeMicrophone = false;
  bool get includeMicrophone => _includeMicrophone;

  // WebRTC handles
  RTCPeerConnection? _pc;
  // ignore: unused_field
  MediaStream? _localStream;
  final _localRenderer = RTCVideoRenderer();

  // External collaborators (set by app once on startup)
  SignalingClient? _signaling;
  SignalingRouter? _router;
  DeviceProfile? _profile;
  SettingsStore? _settings;

  // Subscriptions
  StreamSubscription<IceFrame>? _iceSub;
  StreamSubscription<StreamStopFrame>? _stopSub;
  StreamSubscription<SessionErrorFrame>? _errorSub;

  RTCVideoRenderer get localRenderer => _localRenderer;

  void bind({
    required SignalingClient signaling,
    required SignalingRouter router,
    required DeviceProfile profile,
    required SettingsStore settings,
  }) {
    _signaling = signaling;
    _router = router;
    _profile = profile;
    _settings = settings;
    _quality = QualityPreset.byId(settings.qualityId);
    _includeMicrophone = settings.includeMicrophone;
  }

  Future<void> initLocalRenderer() async {
    await _localRenderer.initialize();
  }

  void setQuality(QualityPreset preset) {
    _quality = preset;
    _settings?.setQuality(preset.id);
    notifyListeners();
  }

  void setMicrophone(bool enabled) {
    _includeMicrophone = enabled;
    _settings?.setMicrophone(enabled);
    notifyListeners();
  }

  /// Begin a casting session. Requires a paired [PairingResult].
  Future<void> startCasting(PairingResult pairing) async {
    if (_status == CastingStatus.streaming || _status == CastingStatus.negotiating) {
      throw StateError('Casting already in progress');
    }
    _error = null;
    _setStatus(CastingStatus.requestingCapture);

    try {
      // 1. Acquire native screen capture → MediaStream
      final stream = await _acquireLocalStream();
      // Keep the stream reference so we can stop its tracks on teardown.
      _localStream = stream;
      _localRenderer.srcObject = stream;

      // 2. Build PeerConnection
      await _setupPeerConnection();
      for (final track in stream.getVideoTracks()) {
        await _pc!.addTrack(track, stream);
      }
      if (_includeMicrophone) {
        try {
          final mic = await _acquireMicrophoneStream();
          for (final t in mic.getAudioTracks()) {
            await _pc!.addTrack(t, mic);
          }
        } catch (e) {
          _setError('无法获取麦克风：$e');
        }
      }

      // 3. Wire signaling
      _wireSignalingListeners();
      final sessionId = 'sess-${const Uuid().v4().substring(0, 8)}';
      _activeSessionId = sessionId;
      _signaling!.send(CreateSessionFrame(sessionId: sessionId, kind: 'screen'));
      _signaling!.send(StreamStartFrame(sessionId: sessionId));

      // 4. Create offer
      _setStatus(CastingStatus.negotiating);
      final offer = await _pc!.createOffer({
        'offerToReceiveVideo': true,
        'offerToReceiveAudio': _includeMicrophone,
      });
      await _pc!.setLocalDescription(offer);
      _signaling!.send(OfferFrame(
        sessionId: sessionId,
        sdp: offer.sdp ?? '',
        deviceId: _profile?.deviceId ?? '',
      ));

      _setStatus(CastingStatus.streaming);
    } catch (e, st) {
      _setError('投屏启动失败：$e');
      debugPrint('startCasting failed: $e\n$st');
      _setStatus(CastingStatus.error);
      await _teardown();
    }
  }

  Future<void> stopCasting() async {
    final sid = _activeSessionId;
    if (sid != null) _signaling?.send(StreamStopFrame(sessionId: sid));
    await _teardown();
    _setStatus(CastingStatus.stopped);
  }

  Future<void> _teardown() async {
    await _iceSub?.cancel();
    await _stopSub?.cancel();
    await _errorSub?.cancel();
    _iceSub = _stopSub = _errorSub = null;

    try {
      await _pc?.close();
    } catch (_) {}
    _pc = null;

    await _stopNativeCapture();

    for (final t in _localStream?.getVideoTracks() ?? <MediaStreamTrack>[]) {
      try { t.stop(); } catch (_) {}
    }
    for (final t in _localStream?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      try { t.stop(); } catch (_) {}
    }
    _localStream = null;
    _localRenderer.srcObject = null;
    _activeSessionId = null;
  }

  Future<MediaStream> _acquireLocalStream() async {
    // Phase 1 (MVP placeholder): the actual screen capture pipeline is wired
    // through the platform channel (CaptureController.startScreenCapture), but
    // flutter_webrtc 0.14.x does not expose a stream-by-id accessor — the
    // video source must be a `VideoCapturer` registered through libwebrtc.
    // That integration is Phase-2 work; for now we open the front camera
    // so the rest of the pipeline (signaling, SDP, ICE) can be exercised.
    // The Dart-side `_acquireLocalStream` therefore calls the platform
    // channel to start the foreground service (so the user sees the
    // "MyCast 正在共享屏幕" notification) but the actual MediaStream comes
    // from `getUserMedia`. Replace with a custom VideoCapturer when the
    // native libwebrtc glue lands.
    try {
      await _invokeNative<dynamic>('startScreenCapture', {
        'width': _quality.width,
        'height': _quality.height,
        'frameRate': _quality.frameRate,
        'bitrateKbps': _quality.bitrateKbps,
      });
    } catch (e) {
      debugPrint('startScreenCapture native call failed: $e');
    }
    // MVP PLACEHOLDER: feeds the front camera into libwebrtc so the signaling
    // / SDP / ICE pipeline is exercised end-to-end. Real MediaProjection
    // frames → libwebrtc is Phase 2 and needs C++ JNI glue on Android.
    final stream = await Helper.openCamera(<String, dynamic>{
      'audio': false,
      'video': {
        'facingMode': 'user',
        'width': _quality.width,
        'height': _quality.height,
        'frameRate': _quality.frameRate,
      },
    });
    _setStatus(CastingStatus.capturing);
    return stream;
  }

  Future<MediaStream> _acquireMicrophoneStream() async {
    try {
      await _invokeNative<dynamic>('startMicrophoneCapture', null);
    } catch (_) { /* non-fatal in MVP */ }
    return Helper.openCamera(<String, dynamic>{'audio': true, 'video': false});
  }

  Future<void> _stopNativeCapture() async {
    try {
      await _invokeNative<dynamic>('stopScreenCapture', null);
    } catch (_) {}
  }

  Future<T?> _invokeNative<T>(String method, Object? args) async {
    if (!(Platform.isAndroid || Platform.isIOS)) {
      throw UnsupportedError('当前平台不支持原生屏幕采集');
    }
    const channel = MethodChannel('com.nextworkdashboard.mycast/capture');
    return await channel.invokeMethod<T>(method, args);
  }

  Future<void> _setupPeerConnection() async {
    _pc = await createPeerConnection({
      'sdpSemantics': 'unified-plan',
      'iceServers': <Map<String, dynamic>>[],
      'iceTransportPolicy': 'all',
    }, {
      'mandatory': {
        'OfferToReceiveAudio': _includeMicrophone,
        'OfferToReceiveVideo': false,
      },
    });
    _pc!.onIceCandidate = (RTCIceCandidate candidate) {
      final sid = _activeSessionId;
      if (sid == null) return;
      _signaling?.send(IceFrame(
        sessionId: sid,
        candidate: candidate.toMap(),
        deviceId: _profile?.deviceId ?? '',
      ));
    };
    _pc!.onIceConnectionState = (RTCIceConnectionState state) {
      if (state == RTCIceConnectionState.RTCIceConnectionStateFailed ||
          state == RTCIceConnectionState.RTCIceConnectionStateDisconnected ||
          state == RTCIceConnectionState.RTCIceConnectionStateClosed) {
        _setError('WebRTC 断开：${state.name}');
        _teardown();
        _setStatus(CastingStatus.stopped);
      }
    };
  }

  void _wireSignalingListeners() {
    final router = _router;
    if (router == null) return;

    _iceSub = router.onIce.listen((frame) {
      final pc = _pc;
      if (pc == null) return;
      if (frame.deviceId.isNotEmpty && frame.deviceId != _profile?.deviceId) return;
      final c = frame.candidate;
      if (c is Map) {
        pc.addCandidate(RTCIceCandidate(
          c['candidate'] as String? ?? '',
          c['sdpMid'] as String?,
          c['sdpMLineIndex'] as int?,
        ));
      }
    });

    _stopSub = router.onStreamStop.listen((_) {
      _teardown();
      _setStatus(CastingStatus.stopped);
    });

    _errorSub = router.onSessionError.listen((frame) {
      _setError('信令错误：${frame.message}');
      _teardown();
      _setStatus(CastingStatus.error);
    });
  }

  void _setStatus(CastingStatus v) {
    if (_status == v) return;
    _status = v;
    notifyListeners();
  }

  void _setError(String message) {
    _error = message;
    notifyListeners();
  }

  @override
  Future<void> dispose() async {
    await _teardown();
    await _localRenderer.dispose();
    super.dispose();
  }
}
