/// Result of parsing a desktop QR code (or manual URL entry).
class PairingQr {
  const PairingQr({
    required this.host,
    required this.httpPort,
    required this.wsPort,
    required this.pairCode,
  });

  final String host;
  final int httpPort;
  final int wsPort;
  final String pairCode;

  String get httpBase => 'http://$host:$httpPort';
  String get wsUrl => 'ws://$host:$wsPort';

  @override
  String toString() => '$httpBase/?pair=$pairCode';
}

class QrParser {
  /// Accepts multiple encodings:
  ///   1. mycast://pair?host=…&httpPort=…&wsPort=…&code=123456
  ///   2. http://host:port/?pair=123456 (full URL the sidecar serves)
  ///   3. http://host:port/?host=…&code=…  (legacy hint form)
  ///   4. Plain 6-digit code, with a separately-known host
  static PairingQr? tryParse(String raw, {String? fallbackHost, int? fallbackHttpPort, int? fallbackWsPort}) {
    final value = raw.trim();
    if (value.isEmpty) return null;

    // 1) mycast:// deep link
    if (value.startsWith('mycast://')) {
      final uri = Uri.tryParse(value);
      if (uri == null) return null;
      return _fromParams(
        uri.queryParameters,
        fallbackHost: fallbackHost,
        fallbackHttpPort: fallbackHttpPort,
        fallbackWsPort: fallbackWsPort,
      );
    }

    // 2) http(s):// full URL (the sidecar's mobile UI is reachable at this URL)
    if (value.startsWith('http://') || value.startsWith('https://')) {
      final uri = Uri.tryParse(value);
      if (uri == null) return null;
      return _fromParams(
        uri.queryParameters,
        hostOverride: uri.host,
        httpPortOverride: uri.hasPort ? uri.port : null,
        fallbackHost: fallbackHost,
        fallbackHttpPort: fallbackHttpPort,
        fallbackWsPort: fallbackWsPort,
      );
    }

    // 3) Plain 6-digit code; we need a host from elsewhere
    if (RegExp(r'^\d{6}$').hasMatch(value)) {
      final host = fallbackHost;
      if (host == null) return null;
      return PairingQr(
        host: host,
        httpPort: fallbackHttpPort ?? 17890,
        wsPort: fallbackWsPort ?? 17891,
        pairCode: value,
      );
    }
    return null;
  }

  static PairingQr? _fromParams(
    Map<String, String> params, {
    String? hostOverride,
    int? httpPortOverride,
    String? fallbackHost,
    int? fallbackHttpPort,
    int? fallbackWsPort,
  }) {
    final host = hostOverride ?? params['host'] ?? fallbackHost;
    if (host == null) return null;
    final code = params['code'] ?? params['pair'] ?? params['pairing_code'];
    if (code == null || !RegExp(r'^\d{6}$').hasMatch(code)) return null;
    final httpPort = int.tryParse(params['httpPort'] ?? '') ?? httpPortOverride ?? fallbackHttpPort ?? 17890;
    final wsPort = int.tryParse(params['wsPort'] ?? '') ?? fallbackWsPort ?? 17891;
    return PairingQr(host: host, httpPort: httpPort, wsPort: wsPort, pairCode: code);
  }
}
