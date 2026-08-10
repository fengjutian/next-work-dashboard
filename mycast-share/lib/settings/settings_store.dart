import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persisted app preferences.
class SettingsStore extends ChangeNotifier {
  SettingsStore({
    String qualityId = 'balanced',
    bool includeMicrophone = false,
    bool keepScreenAwake = true,
    bool autoReconnect = true,
  })  : _qualityId = qualityId,
        _includeMicrophone = includeMicrophone,
        _keepScreenAwake = keepScreenAwake,
        _autoReconnect = autoReconnect;

  String _qualityId;
  bool _includeMicrophone;
  bool _keepScreenAwake;
  bool _autoReconnect;

  String get qualityId => _qualityId;
  bool get includeMicrophone => _includeMicrophone;
  bool get keepScreenAwake => _keepScreenAwake;
  bool get autoReconnect => _autoReconnect;

  static const _kQuality = 'mycast.settings.quality';
  static const _kMic = 'mycast.settings.mic';
  static const _kAwake = 'mycast.settings.awake';
  static const _kReconnect = 'mycast.settings.reconnect';

  static Future<SettingsStore> load() async {
    final prefs = await SharedPreferences.getInstance();
    return SettingsStore(
      qualityId: prefs.getString(_kQuality) ?? 'balanced',
      includeMicrophone: prefs.getBool(_kMic) ?? false,
      keepScreenAwake: prefs.getBool(_kAwake) ?? true,
      autoReconnect: prefs.getBool(_kReconnect) ?? true,
    );
  }

  Future<void> setQuality(String id) async {
    _qualityId = id;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kQuality, id);
    notifyListeners();
  }

  Future<void> setMicrophone(bool v) async {
    _includeMicrophone = v;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kMic, v);
    notifyListeners();
  }

  Future<void> setKeepScreenAwake(bool v) async {
    _keepScreenAwake = v;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kAwake, v);
    notifyListeners();
  }

  Future<void> setAutoReconnect(bool v) async {
    _autoReconnect = v;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kReconnect, v);
    notifyListeners();
  }
}
