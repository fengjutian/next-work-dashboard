import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../app/routes.dart';
import 'device_profile.dart';
import 'pairing_service.dart';
import 'qr_parser.dart';

class PairingPage extends StatefulWidget {
  const PairingPage({super.key});

  @override
  State<PairingPage> createState() => _PairingPageState();
}

class _PairingPageState extends State<PairingPage> {
  final _codeController = TextEditingController();
  final _hostController = TextEditingController();
  final _nameController = TextEditingController();
  bool _scanMode = true;

  @override
  void initState() {
    super.initState();
    final profile = context.read<DeviceProfile>();
    _nameController.text = profile.deviceName;
    if (profile.lastHost != null) {
      _hostController.text = profile.lastHost!;
    } else if (profile.lastPairCode != null) {
      _codeController.text = profile.lastPairCode!;
    }
  }

  @override
  void dispose() {
    _codeController.dispose();
    _hostController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _attemptPair(PairingQr qr) async {
    final service = context.read<PairingService>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      final result = await service.pair(qr: qr);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text('已配对：${qr.host}'),
          backgroundColor: Theme.of(context).colorScheme.primary,
          duration: const Duration(seconds: 2),
        ),
      );
      Navigator.of(context).pushReplacementNamed(Routes.casting, arguments: result);
    } on PairingError catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text('配对失败：${e.message}'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = context.watch<DeviceProfile>();
    final pairing = context.watch<PairingService>();
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('MyCast · 配对'),
        actions: [
          IconButton(
            tooltip: '设置',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).pushNamed(Routes.settings),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          _DeviceCard(profile: profile),
          const SizedBox(height: 16),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, label: Text('扫一扫'), icon: Icon(Icons.qr_code_scanner)),
              ButtonSegment(value: false, label: Text('手动输入'), icon: Icon(Icons.keyboard)),
            ],
            selected: {_scanMode},
            onSelectionChanged: (s) => setState(() => _scanMode = s.first),
          ),
          const SizedBox(height: 16),
          if (_scanMode) _ScannerCard(onScanned: _handleScanned) else _ManualCard(
            codeController: _codeController,
            hostController: _hostController,
            nameController: _nameController,
            onPair: _handleManualPair,
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: pairing.busy
                ? null
                : () {
                    final code = _codeController.text.trim();
                    final host = _hostController.text.trim();
                    if (code.isEmpty || host.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('请输入主机地址和配对码')),
                      );
                      return;
                    }
                    final qr = QrParser.tryParse(
                      code,
                      fallbackHost: host,
                      fallbackHttpPort: 17890,
                      fallbackWsPort: 17891,
                    );
                    if (qr == null) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('配对码格式不正确（应为 6 位数字）')),
                      );
                      return;
                    }
                    if (_nameController.text.trim().isNotEmpty) {
                      context.read<DeviceProfile>().rename(_nameController.text);
                    }
                    _attemptPair(qr);
                  },
            icon: pairing.busy
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.link),
            label: const Text('连接'),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              backgroundColor: scheme.primary,
            ),
          ),
        ],
      ),
    );
  }

  void _handleScanned(String raw) {
    final qr = QrParser.tryParse(
      raw,
      fallbackHost: _hostController.text.trim().isEmpty ? null : _hostController.text.trim(),
    );
    if (qr == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('二维码无法解析，请检查是否来自 MyCast 桌面端')),
      );
      return;
    }
    setState(() {
      _hostController.text = qr.host;
      _codeController.text = qr.pairCode;
      _scanMode = false;
    });
    _attemptPair(qr);
  }

  void _handleManualPair() {
    final code = _codeController.text.trim();
    final host = _hostController.text.trim();
    if (code.isEmpty || host.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入主机地址和配对码')),
      );
      return;
    }
    final qr = QrParser.tryParse(
      code,
      fallbackHost: host,
      fallbackHttpPort: 17890,
      fallbackWsPort: 17891,
    );
    if (qr == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('配对码格式不正确（应为 6 位数字）')),
      );
      return;
    }
    if (_nameController.text.trim().isNotEmpty) {
      context.read<DeviceProfile>().rename(_nameController.text);
    }
    _attemptPair(qr);
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({required this.profile});
  final DeviceProfile profile;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: scheme.primaryContainer,
              foregroundColor: scheme.onPrimaryContainer,
              radius: 24,
              child: const Icon(Icons.phone_android, size: 26),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(profile.deviceName, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 2),
                  Text(
                    '设备 ID · ${profile.deviceId.substring(0, 8)} · ${profile.platform}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  if (profile.lastHost != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      '上次连接：${profile.lastHost}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScannerCard extends StatefulWidget {
  const _ScannerCard({required this.onScanned});
  final ValueChanged<String> onScanned;

  @override
  State<_ScannerCard> createState() => _ScannerCardState();
}

class _ScannerCardState extends State<_ScannerCard> {
  final MobileScannerController _controller = MobileScannerController();
  bool _handled = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        height: 280,
        child: Stack(
          children: [
            MobileScanner(
              controller: _controller,
              onDetect: (capture) {
                if (_handled) return;
                for (final code in capture.barcodes) {
                  final raw = code.rawValue;
                  if (raw == null) continue;
                  _handled = true;
                  widget.onScanned(raw);
                  _controller.stop();
                  break;
                }
              },
              errorBuilder: (context, error, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.no_photography_outlined, size: 40),
                      const SizedBox(height: 8),
                      Text('相机不可用：${error.errorDetails?.message ?? error.errorCode.name}'),
                      const SizedBox(height: 4),
                      const Text('请改用「手动输入」', style: TextStyle(fontSize: 12)),
                    ],
                  ),
                ),
              ),
            ),
            // Center reticle.
            IgnorePointer(
              child: Center(
                child: Container(
                  width: 180,
                  height: 180,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 2),
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 12,
              bottom: 12,
              child: ValueListenableBuilder<MobileScannerState>(
                valueListenable: _controller,
                builder: (context, value, _) {
                  return _Chip(text: value.torchState == TorchState.on ? '关闭手电' : '手电', onTap: () => _controller.toggleTorch());
                },
              ),
            ),
            Positioned(
              right: 12,
              bottom: 12,
              child: _Chip(text: '切换镜头', onTap: () => _controller.switchCamera()),
            ),
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.text, required this.onTap});
  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.45),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 12)),
      ),
    );
  }
}

class _ManualCard extends StatelessWidget {
  const _ManualCard({
    required this.codeController,
    required this.hostController,
    required this.nameController,
    required this.onPair,
  });

  final TextEditingController codeController;
  final TextEditingController hostController;
  final TextEditingController nameController;
  final VoidCallback onPair;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('手动连接', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            const Text('桌面端首页会显示 6 位配对码和 IP，类似 192.168.1.20:17890。',
                style: TextStyle(fontSize: 12, color: Colors.black54)),
            const SizedBox(height: 14),
            TextField(
              controller: hostController,
              keyboardType: TextInputType.text,
              decoration: const InputDecoration(
                labelText: '桌面端地址',
                hintText: '192.168.1.20',
                prefixIcon: Icon(Icons.dns_outlined),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: codeController,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(
                labelText: '配对码（6 位）',
                hintText: '123456',
                prefixIcon: Icon(Icons.pin_outlined),
              ),
            ),
            const SizedBox(height: 4),
            TextField(
              controller: nameController,
              decoration: const InputDecoration(
                labelText: '本机名称（可选）',
                prefixIcon: Icon(Icons.edit_outlined),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
