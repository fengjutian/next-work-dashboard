import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart' as _uuid;

/// Persistent device identity used for pairing.
///
/// Each installation has a stable `deviceId` (uuid v4) and a human-readable
/// `deviceName` (model / hostname). Stored in SharedPreferences.
class DeviceProfile extends ChangeNotifier {
  DeviceProfile({required this.deviceId, required this.deviceName, required this.platform});

  String deviceId;
  String deviceName;
  String platform; // 'android' | 'ios' | 'web' | 'macos' | ...

  String? _lastHost;
  int? _lastHttpPort;
  int? _lastWsPort;
  String? _lastPairCode;

  String? get lastHost => _lastHost;
  int? get lastHttpPort => _lastHttpPort;
  int? get lastWsPort => _lastWsPort;
  String? get lastPairCode => _lastPairCode;

  static const _kId = 'mycast.deviceId';
  static const _kName = 'mycast.deviceName';
  static const _kPlatform = 'mycast.platform';
  static const _kLastHost = 'mycast.lastHost';
  static const _kLastHttpPort = 'mycast.lastHttpPort';
  static const _kLastWsPort = 'mycast.lastWsPort';
  static const _kLastCode = 'mycast.lastPairCode';

  static Future<DeviceProfile> load() async {
    final prefs = await SharedPreferences.getInstance();
    final id = prefs.getString(_kId) ?? const _uuid.Uuid().v4();
    final platform = await _detectPlatform();
    final defaultName = await _defaultDeviceName(platform);
    final name = prefs.getString(_kName) ?? defaultName;

    final p = DeviceProfile(
      deviceId: id.isEmpty ? const _uuid.Uuid().v4() : id,
      deviceName: name.isEmpty ? defaultName : name,
      platform: platform,
    );
    p._lastHost = prefs.getString(_kLastHost);
    p._lastHttpPort = prefs.getInt(_kLastHttpPort);
    p._lastWsPort = prefs.getInt(_kLastWsPort);
    p._lastCode = prefs.getString(_kLastCode);
    return p;
  }

  Future<void> rememberHost({required String host, int? httpPort, int? wsPort, String? pairCode}) async {
    _lastHost = host;
    if (httpPort != null) _lastHttpPort = httpPort;
    if (wsPort != null) _lastWsPort = wsPort;
    if (pairCode != null) _lastPairCode = pairCode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLastHost, host);
    if (httpPort != null) await prefs.setInt(_kLastHttpPort, httpPort);
    if (wsPort != null) await prefs.setInt(_kLastWsPort, wsPort);
    if (pairCode != null) await prefs.setString(_kLastCode, pairCode);
    notifyListeners();
  }

  Future<void> rename(String newName) async {
    if (newName.trim().isEmpty) return;
    deviceName = newName.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kName, deviceName);
    notifyListeners();
  }

  static Future<String> _detectPlatform() async {
    if (kIsWeb) return 'web';
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    if (Platform.isMacOS) return 'macos';
    if (Platform.isWindows) return 'windows';
    if (Platform.isLinux) return 'linux';
    return 'unknown';
  }

  static Future<String> _defaultDeviceName(String platform) async {
    final info = DeviceInfoPlugin();
    try {
      if (platform == 'android') {
        final a = await info.androidInfo;
        return '${a.manufacturer} ${a.model}';
      }
      if (platform == 'ios') {
        final i = await info.iosInfo;
        return '${i.name} (${i.model})';
      }
    } catch (_) {
      // Fall through.
    }
    return platform == 'ios' ? 'iPhone' : 'Android';
  }
}
