import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:provider/provider.dart';

import '../app/routes.dart';
import '../pairing/pairing_service.dart';
import 'casting_service.dart';
import 'quality_preset.dart';

class CastingPage extends StatefulWidget {
  const CastingPage({super.key});

  @override
  State<CastingPage> createState() => _CastingPageState();
}

class _CastingPageState extends State<CastingPage> {
  PairingResult? _pairing;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final arg = ModalRoute.of(context)?.settings.arguments;
      if (arg is PairingResult) {
        setState(() => _pairing = arg);
      }
      await context.read<CastingService>().initLocalRenderer();
    });
  }

  @override
  void dispose() {
    // We don't tear down here so the user can return; the user explicitly
    // hits the Stop button to end the stream.
    super.dispose();
  }

  Future<void> _start() async {
    final pairing = _pairing;
    if (pairing == null) return;
    await context.read<CastingService>().startCasting(pairing);
  }

  Future<void> _stop() async {
    await context.read<CastingService>().stopCasting();
  }

  @override
  Widget build(BuildContext context) {
    final casting = context.watch<CastingService>();
    final pairing = _pairing;
    final status = casting.status;
    final isActive = status == CastingStatus.streaming ||
        status == CastingStatus.negotiating ||
        status == CastingStatus.capturing;

    return Scaffold(
      appBar: AppBar(
        title: Text(pairing == null ? 'MyCast · 投屏' : '${pairing.qr.host} · 投屏'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          IconButton(
            tooltip: '文件',
            icon: const Icon(Icons.folder_outlined),
            onPressed: () => Navigator.of(context).pushNamed(Routes.transfer),
          ),
          IconButton(
            tooltip: '设置',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).pushNamed(Routes.settings),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          _StatusCard(status: status, error: casting.error),
          const SizedBox(height: 16),
          _LocalPreview(renderer: casting.localRenderer, active: isActive),
          const SizedBox(height: 16),
          _QualitySelector(
            value: casting.quality,
            disabled: isActive,
            onChanged: (q) => context.read<CastingService>().setQuality(q),
          ),
          const SizedBox(height: 8),
          SwitchListTile.adaptive(
            value: casting.includeMicrophone,
            onChanged: isActive
                ? null
                : (v) => context.read<CastingService>().setMicrophone(v),
            title: const Text('传输麦克风'),
            subtitle: const Text('默认关闭。第一版不传系统声音。'),
            contentPadding: EdgeInsets.zero,
          ),
          const SizedBox(height: 12),
          if (pairing == null)
            const Card(
              child: ListTile(
                leading: Icon(Icons.warning_amber_outlined),
                title: Text('尚未配对'),
                subtitle: Text('请先返回配对页完成扫码或手动输入'),
              ),
            )
          else if (isActive)
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
              onPressed: _stop,
              icon: const Icon(Icons.stop_circle_outlined),
              label: const Text('停止投屏'),
            )
          else
            FilledButton.icon(
              onPressed: pairing == null ? null : _start,
              icon: const Icon(Icons.play_arrow),
              label: const Text('开始投屏'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            ),
          const SizedBox(height: 16),
          _TroubleshootingCard(),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status, this.error});
  final CastingStatus status;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = switch (status) {
      CastingStatus.idle => scheme.surfaceContainerHighest,
      CastingStatus.requestingCapture => Colors.amber.shade100,
      CastingStatus.capturing => Colors.amber.shade100,
      CastingStatus.negotiating => Colors.blue.shade100,
      CastingStatus.streaming => Colors.green.shade100,
      CastingStatus.stopped => scheme.surfaceContainerHighest,
      CastingStatus.error => scheme.errorContainer,
    };
    final label = switch (status) {
      CastingStatus.idle => '空闲',
      CastingStatus.requestingCapture => '正在请求屏幕采集授权…',
      CastingStatus.capturing => '已获取屏幕，准备协商',
      CastingStatus.negotiating => 'WebRTC 协商中…',
      CastingStatus.streaming => '正在投屏',
      CastingStatus.stopped => '已停止',
      CastingStatus.error => '异常',
    };
    return Card(
      color: color,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Icon(_iconFor(status), color: scheme.onSurface),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (error != null) ...[
                    const SizedBox(height: 2),
                    Text(error!, style: TextStyle(color: scheme.error, fontSize: 12)),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _iconFor(CastingStatus s) => switch (s) {
        CastingStatus.idle => Icons.power_settings_new,
        CastingStatus.requestingCapture => Icons.lock_open,
        CastingStatus.capturing => Icons.screenshot_monitor_outlined,
        CastingStatus.negotiating => Icons.compare_arrows,
        CastingStatus.streaming => Icons.cast_connected,
        CastingStatus.stopped => Icons.stop,
        CastingStatus.error => Icons.error_outline,
      };
}

class _LocalPreview extends StatelessWidget {
  const _LocalPreview({required this.renderer, required this.active});
  final RTCVideoRenderer renderer;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(color: Colors.black),
            if (active)
              RTCVideoView(renderer, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover)
            else
              const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.cast, color: Colors.white60, size: 56),
                    SizedBox(height: 8),
                    Text('未投屏', style: TextStyle(color: Colors.white70)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _QualitySelector extends StatelessWidget {
  const _QualitySelector({required this.value, required this.disabled, required this.onChanged});
  final QualityPreset value;
  final bool disabled;
  final ValueChanged<QualityPreset> onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            const Icon(Icons.high_quality_outlined),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonHideUnderline(
                child: DropdownButton<QualityPreset>(
                  isExpanded: true,
                  value: value,
                  onChanged: disabled ? null : (q) { if (q != null) onChanged(q); },
                  items: QualityPreset.all
                      .map((q) => DropdownMenuItem(value: q, child: Text(q.label)))
                      .toList(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TroubleshootingCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('无法投屏？', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            const Text(
              '1. 确认手机和电脑在同一 WiFi\n'
              '2. 电脑端 MyCast 插件已启动\n'
              '3. Android 14+ 需要授予屏幕采集授权\n'
              '4. 重新进入本页可重连信令',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }
}
