import 'dart:io';

import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart' as fp;
import 'package:provider/provider.dart';

import 'transfer_service.dart';

class TransferPage extends StatefulWidget {
  const TransferPage({super.key});

  @override
  State<TransferPage> createState() => _TransferPageState();
}

class _TransferPageState extends State<TransferPage> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<TransferService>().refresh();
    });
  }

  Future<void> _pickAndUpload() async {
    final result = await fp.FilePicker.platform.pickFiles(allowMultiple: true);
    if (result == null) return;
    for (final file in result.files) {
      final path = file.path;
      if (path == null) continue;
      if (!mounted) return;
      await context.read<TransferService>().upload(File(path));
    }
  }

  String _humanSize(int n) {
    if (n < 1024) return '$n B';
    if (n < 1024 * 1024) return '${(n / 1024).toStringAsFixed(1)} KB';
    if (n < 1024 * 1024 * 1024) return '${(n / 1024 / 1024).toStringAsFixed(1)} MB';
    return '${(n / 1024 / 1024 / 1024).toStringAsFixed(2)} GB';
  }

  @override
  Widget build(BuildContext context) {
    final transfer = context.watch<TransferService>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('MyCast · 文件'),
        actions: [
          IconButton(
            tooltip: '刷新',
            icon: const Icon(Icons.refresh),
            onPressed: transfer.loading ? null : () => transfer.refresh(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 80),
        children: [
          if (transfer.uploads.isNotEmpty) ...[
            const _SectionHeader('上传任务'),
            ...transfer.uploads.entries.map((e) {
              final p = e.value;
              final pct = p.total > 0 ? (p.sent / p.total).clamp(0.0, 1.0) : 0.0;
              return Card(
                child: ListTile(
                  leading: const Icon(Icons.upload_file),
                  title: Text(p.fileName, overflow: TextOverflow.ellipsis),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${_humanSize(p.sent)} / ${_humanSize(p.total)}'),
                      const SizedBox(height: 4),
                      LinearProgressIndicator(value: pct),
                    ],
                  ),
                  trailing: Text(_statusLabel(p.status)),
                ),
              );
            }),
            const SizedBox(height: 12),
          ],
          const _SectionHeader('桌面文件'),
          if (transfer.error != null)
            Card(
              color: Theme.of(context).colorScheme.errorContainer,
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text(transfer.error!),
              ),
            ),
          if (transfer.loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (transfer.files.isEmpty)
            const Card(
              child: ListTile(
                leading: Icon(Icons.folder_off_outlined),
                title: Text('桌面还没有文件'),
                subtitle: Text('使用下方按钮从手机上传'),
              ),
            )
          else
            ...transfer.files.map(
              (f) => Card(
                child: ListTile(
                  leading: Icon(_iconFor(f.name)),
                  title: Text(f.name, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    '${_humanSize(f.size)} · ${_kindLabel(f.kind)} · ${DateTime.fromMillisecondsSinceEpoch(f.modifiedAtMs).toLocal().toString().split(".").first}',
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.download_outlined),
                    onPressed: () async {
                      final messenger = ScaffoldMessenger.of(context);
                      try {
                        final saved = await context.read<TransferService>().download(f);
                        messenger.showSnackBar(SnackBar(content: Text('已下载：${saved.path}')));
                      } catch (e) {
                        messenger.showSnackBar(SnackBar(content: Text('下载失败：$e')));
                      }
                    },
                  ),
                ),
              ),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _pickAndUpload,
        icon: const Icon(Icons.upload),
        label: const Text('上传文件'),
      ),
    );
  }

  String _statusLabel(UploadStatus s) => switch (s) {
        UploadStatus.active => '上传中',
        UploadStatus.completed => '完成',
        UploadStatus.failed => '失败',
        UploadStatus.cancelled => '已取消',
      };

  IconData _iconFor(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.webp')) return Icons.image;
    if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm')) return Icons.movie;
    if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a')) return Icons.audiotrack;
    if (lower.endsWith('.pdf')) return Icons.picture_as_pdf;
    if (lower.endsWith('.txt') || lower.endsWith('.md')) return Icons.article;
    return Icons.insert_drive_file_outlined;
  }

  String _kindLabel(String kind) => switch (kind) {
        'image' => '图片',
        'video' => '视频',
        'audio' => '音频',
        'pdf' => 'PDF',
        'text' => '文本',
        _ => '文件',
      };
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
      child: Text(
        text,
        style: TextStyle(
          color: Theme.of(context).colorScheme.primary,
          fontWeight: FontWeight.w600,
          fontSize: 13,
        ),
      ),
    );
  }
}
