import 'dart:convert';

/// All frames exchanged with the desktop sidecar's `/ws` endpoint.
///
/// Frames are encoded as `{ "type": "...", ... }` JSON. The desktop emits
/// unsolicited events (phone.hello, session.created, etc.) and replies to
/// our offer/answer/ice with mirrored events.
sealed class SignalingFrame {
  const SignalingFrame();

  Map<String, dynamic> toJson();

  /// Convenience: encode to a single JSON line.
  String encode() => jsonEncode(toJson());

  /// Parse a JSON line into a typed frame. Returns null on unknown shape.
  static SignalingFrame? decode(String raw) {
    Map<String, dynamic> json;
    try {
      final v = jsonDecode(raw);
      if (v is! Map<String, dynamic>) return null;
      json = v;
    } catch (_) {
      return null;
    }
    final type = json['type'] as String?;
    return switch (type) {
      'hello' => PhoneHelloFrame(
        deviceId: json['device_id'] as String,
        deviceName: json['device_name'] as String,
        platform: json['platform'] as String? ?? 'unknown',
      ),
      'session_created' => SessionCreatedFrame(
        sessionId: json['session_id'] as String,
        phoneDeviceId: (json['phone_device_id'] as String?) ?? '',
        kind: (json['kind'] as String?) ?? 'screen',
      ),
      'offer' => OfferFrame(
        sessionId: json['session_id'] as String,
        sdp: json['sdp'] as String,
        deviceId: (json['device_id'] as String?) ?? '',
      ),
      'answer' => AnswerFrame(
        sessionId: json['session_id'] as String,
        sdp: json['sdp'] as String,
        deviceId: (json['device_id'] as String?) ?? '',
      ),
      'ice' => IceFrame(
        sessionId: json['session_id'] as String,
        candidate: json['candidate'],
        deviceId: (json['device_id'] as String?) ?? '',
      ),
      'stream_start' => StreamStartFrame(
        sessionId: json['session_id'] as String,
      ),
      'stream_stop' => StreamStopFrame(
        sessionId: json['session_id'] as String,
      ),
      'session_error' => SessionErrorFrame(
        sessionId: (json['session_id'] as String?) ?? '',
        message: json['message'] as String? ?? 'unknown',
      ),
      'pong' => const PongFrame(),
      _ => null,
    };
  }
}

/// ── Outgoing (phone → desktop) ────────────────────────────────────────

class PhoneHelloFrame extends SignalingFrame {
  const PhoneHelloFrame({required this.deviceId, required this.deviceName, required this.platform});
  final String deviceId;
  final String deviceName;
  final String platform;
  @override
  Map<String, dynamic> toJson() => {
        'type': 'hello',
        'device_id': deviceId,
        'device_name': deviceName,
        'platform': platform,
      };
}

class CreateSessionFrame extends SignalingFrame {
  const CreateSessionFrame({required this.sessionId, required this.kind});
  final String sessionId;
  final String kind; // 'screen' | 'file'
  @override
  Map<String, dynamic> toJson() => {
        'type': 'create_session',
        'session_id': sessionId,
        'kind': kind,
      };
}

class OfferFrame extends SignalingFrame {
  const OfferFrame({required this.sessionId, required this.sdp, this.deviceId = ''});
  final String sessionId;
  final String sdp;
  final String deviceId;
  @override
  Map<String, dynamic> toJson() => {
        'type': 'offer',
        'session_id': sessionId,
        'sdp': sdp,
        if (deviceId.isNotEmpty) 'device_id': deviceId,
      };
}

class AnswerFrame extends SignalingFrame {
  const AnswerFrame({required this.sessionId, required this.sdp, this.deviceId = ''});
  final String sessionId;
  final String sdp;
  final String deviceId;
  @override
  Map<String, dynamic> toJson() => {
        'type': 'answer',
        'session_id': sessionId,
        'sdp': sdp,
        if (deviceId.isNotEmpty) 'device_id': deviceId,
      };
}

class IceFrame extends SignalingFrame {
  const IceFrame({required this.sessionId, required this.candidate, this.deviceId = ''});
  final String sessionId;
  final Object? candidate;
  final String deviceId;
  @override
  Map<String, dynamic> toJson() => {
        'type': 'ice',
        'session_id': sessionId,
        'candidate': candidate,
        if (deviceId.isNotEmpty) 'device_id': deviceId,
      };
}

class StreamStartFrame extends SignalingFrame {
  const StreamStartFrame({required this.sessionId});
  final String sessionId;
  @override
  Map<String, dynamic> toJson() => {'type': 'stream_start', 'session_id': sessionId};
}

class StreamStopFrame extends SignalingFrame {
  const StreamStopFrame({required this.sessionId});
  final String sessionId;
  @override
  Map<String, dynamic> toJson() => {'type': 'stream_stop', 'session_id': sessionId};
}

class PingFrame extends SignalingFrame {
  const PingFrame();
  @override
  Map<String, dynamic> toJson() => {'type': 'ping'};
}

/// ── Incoming (desktop → phone) ────────────────────────────────────────

class SessionCreatedFrame extends SignalingFrame {
  const SessionCreatedFrame({required this.sessionId, required this.phoneDeviceId, required this.kind});
  final String sessionId;
  final String phoneDeviceId;
  final String kind;
  @override
  Map<String, dynamic> toJson() => {
        'type': 'session_created',
        'session_id': sessionId,
        'phone_device_id': phoneDeviceId,
        'kind': kind,
      };
}

class SessionErrorFrame extends SignalingFrame {
  const SessionErrorFrame({required this.sessionId, required this.message});
  final String sessionId;
  final String message;
  @override
  Map<String, dynamic> toJson() => {
        'type': 'session_error',
        'session_id': sessionId,
        'message': message,
      };
}

class PongFrame extends SignalingFrame {
  const PongFrame();
  @override
  Map<String, dynamic> toJson() => {'type': 'pong'};
}
