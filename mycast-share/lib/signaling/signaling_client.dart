import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'signaling_frames.dart';

/// State of the signaling WebSocket connection.
enum SignalingStatus { idle, connecting, open, reconnecting, closed, error }

/// Sends and receives signaling frames over a single WebSocket connection.
/// Auto-reconnects on transient failure with exponential back-off.
class SignalingClient extends ChangeNotifier {
  SignalingClient();

  SignalingStatus _status = SignalingStatus.idle;
  SignalingStatus get status => _status;

  String? _lastError;
  String? get lastError => _lastError;

  String? _wsUrl;
  String? _sessionToken;
  String? _deviceId;
  String? _deviceName;
  String? _platform;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _heartbeat;
  Timer? _reconnect;
  int _reconnectAttempt = 0;
  bool _wantConnected = false;
  bool _disposed = false;

  void start({
    required String wsUrl,
    required String sessionToken,
    required String deviceId,
    required String deviceName,
    required String platform,
  }) {
    _wsUrl = wsUrl;
    _sessionToken = sessionToken;
    _deviceId = deviceId;
    _deviceName = deviceName;
    _platform = platform;
    _wantConnected = true;
    _reconnectAttempt = 0;
    _connect();
  }

  void stop() {
    _wantConnected = false;
    _heartbeat?.cancel();
    _reconnect?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
    _setStatus(SignalingStatus.closed);
  }

  void send(SignalingFrame frame) {
    final ch = _channel;
    if (ch == null) {
      _setError('signaling 通道未连接');
      return;
    }
    try {
      ch.sink.add(frame.encode());
    } catch (e) {
      _setError('signaling 发送失败：$e');
    }
  }

  void _connect() {
    if (_disposed) return;
    final url = _wsUrl;
    final token = _sessionToken;
    if (url == null || token == null) return;
    _setStatus(_reconnectAttempt == 0 ? SignalingStatus.connecting : SignalingStatus.reconnecting);
    try {
      // Pass bearer as a sub-protocol; the server reads it and skips its
      // 6-digit-code requirement when a valid session token is present.
      _channel = IOWebSocketChannel.connect(
        Uri.parse(url),
        protocols: ['mycast', 'bearer', token],
        pingInterval: const Duration(seconds: 25),
      );
      _subscription = _channel!.stream.listen(
        _onMessage,
        onError: (Object err, StackTrace st) => _setError('signaling 错误：$err'),
        onDone: _onDone,
        cancelOnError: true,
      );
      _sendHello();
      _setStatus(SignalingStatus.open);
      _lastError = null;
      _reconnectAttempt = 0;
      _startHeartbeat();
    } catch (e) {
      _setError('signaling 连接失败：$e');
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic raw) {
    if (raw is! String) return;
    final frame = SignalingFrame.decode(raw);
    if (frame == null) return;
    _router?.dispatch(frame);
  }

  void _onDone() {
    _heartbeat?.cancel();
    if (_wantConnected) {
      _scheduleReconnect();
    } else {
      _setStatus(SignalingStatus.closed);
    }
  }

  void _sendHello() {
    final id = _deviceId;
    final name = _deviceName;
    final platform = _platform;
    if (id == null || name == null || platform == null) return;
    send(PhoneHelloFrame(deviceId: id, deviceName: name, platform: platform));
  }

  void _startHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = Timer.periodic(const Duration(seconds: 20), (_) {
      send(const PingFrame());
    });
  }

  void _scheduleReconnect() {
    _reconnect?.cancel();
    _reconnectAttempt = (++_reconnectAttempt).clamp(1, 6);
    final delay = Duration(seconds: 1 << (_reconnectAttempt - 1));
    _reconnect = Timer(delay, () {
      if (_wantConnected) _connect();
    });
    _setStatus(SignalingStatus.reconnecting);
  }

  SignalingRouter? _router;
  void bindRouter(SignalingRouter router) {
    _router = router;
  }

  void _setStatus(SignalingStatus v) {
    if (_status == v) return;
    _status = v;
    notifyListeners();
  }

  void _setError(String message) {
    _lastError = message;
    _setStatus(SignalingStatus.error);
  }

  @override
  void dispose() {
    _disposed = true;
    stop();
    super.dispose();
  }
}

/// Per-frame dispatcher that the rest of the app subscribes to.
class SignalingRouter {
  SignalingRouter();

  final _offerController = StreamController<OfferFrame>.broadcast();
  final _answerController = StreamController<AnswerFrame>.broadcast();
  final _iceController = StreamController<IceFrame>.broadcast();
  final _sessionController = StreamController<SessionCreatedFrame>.broadcast();
  final _errorController = StreamController<SessionErrorFrame>.broadcast();
  final _streamStartController = StreamController<StreamStartFrame>.broadcast();
  final _streamStopController = StreamController<StreamStopFrame>.broadcast();
  final _helloAckController = StreamController<bool>.broadcast();

  Stream<OfferFrame> get onOffer => _offerController.stream;
  Stream<AnswerFrame> get onAnswer => _answerController.stream;
  Stream<IceFrame> get onIce => _iceController.stream;
  Stream<SessionCreatedFrame> get onSessionCreated => _sessionController.stream;
  Stream<SessionErrorFrame> get onSessionError => _errorController.stream;
  Stream<StreamStartFrame> get onStreamStart => _streamStartController.stream;
  Stream<StreamStopFrame> get onStreamStop => _streamStopController.stream;
  Stream<bool> get onHelloAck => _helloAckController.stream;

  void dispatch(SignalingFrame frame) {
    if (frame is OfferFrame) _offerController.add(frame);
    if (frame is AnswerFrame) _answerController.add(frame);
    if (frame is IceFrame) _iceController.add(frame);
    if (frame is SessionCreatedFrame) _sessionController.add(frame);
    if (frame is SessionErrorFrame) _errorController.add(frame);
    if (frame is StreamStartFrame) _streamStartController.add(frame);
    if (frame is StreamStopFrame) _streamStopController.add(frame);
  }

  void dispose() {
    _offerController.close();
    _answerController.close();
    _iceController.close();
    _sessionController.close();
    _errorController.close();
    _streamStartController.close();
    _streamStopController.close();
    _helloAckController.close();
  }
}
