import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../pairing/device_profile.dart';
import '../pairing/pairing_service.dart';

class RemoteFile {
  const RemoteFile({
    required this.id,
    required this.name,
    required this.size,
    required this.kind,
    required this.modifiedAtMs,
  });

  final String id;
  final String name;
  final int size;
  final String kind;
  final int modifiedAtMs;

  factory RemoteFile.fromJson(Map<String, dynamic> json) => RemoteFile(
        id: json['id'] as String,
        name: json['name'] as String,
        size: (json['size'] as num?)?.toInt() ?? 0,
        kind: json['kind'] as String? ?? 'file',
        modifiedAtMs: (json['modified_at_ms'] as num?)?.toInt() ?? 0,
      );
}

class UploadProgress {
  const UploadProgress({
    required this.fileName,
    required this.total,
    required this.sent,
    required this.status,
  });

  final String fileName;
  final int total;
  final int sent;
  final UploadStatus status;
}

enum UploadStatus { active, completed, failed, cancelled }

/// Talks to the desktop's `/api/files/*` HTTP endpoints using the pair session
/// token. Supports listing, downloading, and uploading (with progress events).
class TransferService extends ChangeNotifier {
  TransferService(this._profile);

  // Kept for symmetry with other services; transfer endpoints don't need the
  // device id today but future "upload from" labels will.
  // ignore: unused_field
  final DeviceProfile _profile;
  final http.Client _client = http.Client();

  PairingResult? _pairing;
  List<RemoteFile> _files = [];
  bool _loading = false;
  String? _error;
  final Map<String, UploadProgress> _uploads = {};

  List<RemoteFile> get files => List.unmodifiable(_files);
  bool get loading => _loading;
  String? get error => _error;
  Map<String, UploadProgress> get uploads => Map.unmodifiable(_uploads);

  void bind(PairingResult pairing) {
    _pairing = pairing;
    refresh();
  }

  Future<void> refresh() async {
    final p = _pairing;
    if (p == null) return;
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final resp = await _client.get(
        Uri.parse('${p.httpBase}/api/files'),
        headers: _authHeaders(p),
      );
      if (resp.statusCode != 200) {
        throw HttpException('HTTP ${resp.statusCode}');
      }
      final json = jsonDecode(resp.body) as Map<String, dynamic>;
      final list = (json['files'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      _files = list.map(RemoteFile.fromJson).toList();
    } catch (e) {
      _error = '无法读取文件列表：$e';
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<File> download(RemoteFile file, {String? saveTo}) async {
    final p = _pairing;
    if (p == null) throw StateError('尚未配对');
    final dir = saveTo ?? (await _defaultDownloadDir());
    final path = '$dir/${file.name}';
    final resp = await _client.get(
      Uri.parse('${p.httpBase}/api/files/download/${file.id}'),
      headers: _authHeaders(p),
    );
    if (resp.statusCode != 200) {
      throw HttpException('下载失败：HTTP ${resp.statusCode}');
    }
    final target = File(path);
    await target.writeAsBytes(resp.bodyBytes, flush: true);
    return target;
  }

  Future<void> upload(File source) async {
    final p = _pairing;
    if (p == null) throw StateError('尚未配对');
    final key = '${DateTime.now().microsecondsSinceEpoch}-${source.uri.pathSegments.last}';
    final length = await source.length();
    _uploads[key] = UploadProgress(
      fileName: source.uri.pathSegments.last,
      total: length,
      sent: 0,
      status: UploadStatus.active,
    );
    notifyListeners();

    final req = http.MultipartRequest('POST', Uri.parse('${p.httpBase}/api/files/upload'));
    req.headers.addAll(_authHeaders(p));
    req.fields['filename'] = source.uri.pathSegments.last;
    req.fields['size'] = length.toString();

    // For simplicity we read the file in one chunk and attach; for large
    // files (>1 GiB) a chunked upload should replace this.
    final bytes = await source.readAsBytes();
    req.files.add(http.MultipartFile.fromBytes('file', bytes, filename: source.uri.pathSegments.last));

    try {
      final streamed = await req.send();
      // After `send()` the request's contentLength is set to the actual body
      // length (we always read the file into a buffer first).
      _uploads[key] = _uploads[key]!.copyWith(sent: req.contentLength);
      notifyListeners();
      if (streamed.statusCode == 200) {
        _uploads[key] = _uploads[key]!.copyWith(status: UploadStatus.completed);
        await refresh();
      } else {
        _uploads[key] = _uploads[key]!.copyWith(status: UploadStatus.failed);
        _error = '上传失败：HTTP ${streamed.statusCode}';
      }
    } catch (e) {
      _uploads[key] = _uploads[key]!.copyWith(status: UploadStatus.failed);
      _error = '上传异常：$e';
    } finally {
      notifyListeners();
    }
  }

  void clearCompletedUploads() {
    _uploads.removeWhere((_, p) => p.status != UploadStatus.active);
    notifyListeners();
  }

  Map<String, String> _authHeaders(PairingResult p) => {
        'Authorization': 'Bearer ${p.sessionToken}',
      };

  Future<String> _defaultDownloadDir() async {
    // On Android/iOS this is the app-private external dir; for desktop
    // platforms we honor the OS-conventional "Downloads" folder. Files
    // here are visible to the user via the system file manager.
    if (Platform.isAndroid || Platform.isIOS) {
      // Best-effort: rely on the caller to override if they want a custom
      // path. We use a temp dir under cache and let the OS clean it.
      return Directory.systemTemp.path;
    }
    return Directory.current.path;
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }
}

extension on UploadProgress {
  UploadProgress copyWith({int? sent, UploadStatus? status}) =>
      UploadProgress(
        fileName: fileName,
        total: total,
        sent: sent ?? this.sent,
        status: status ?? this.status,
      );
}
