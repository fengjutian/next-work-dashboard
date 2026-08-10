import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'settings_store.dart';
import '../pairing/device_profile.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<SettingsStore>();
    final profile = context.watch<DeviceProfile>();
    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: ListView(
        children: [
          const _SectionHeader('设备'),
          ListTile(
            leading: const Icon(Icons.phone_android),
            title: const Text('本机名称'),
            subtitle: Text(profile.deviceName),
            onTap: () => _renameDevice(context, profile),
          ),
          ListTile(
            leading: const Icon(Icons.fingerprint),
            title: const Text('设备 ID'),
            subtitle: Text(profile.deviceId),
          ),
          const Divider(),
          const _SectionHeader('画质'),
          RadioListTile<String>(
            value: 'smooth',
            groupValue: settings.qualityId,
            onChanged: (v) { if (v != null) settings.setQuality(v); },
            title: const Text('流畅 (540p / 15 fps)'),
            subtitle: const Text('弱网环境，码率约 1.2 Mbps'),
          ),
          RadioListTile<String>(
            value: 'balanced',
            groupValue: settings.qualityId,
            onChanged: (v) { if (v != null) settings.setQuality(v); },
            title: const Text('均衡 (720p / 30 fps)'),
            subtitle: const Text('推荐，码率约 2.5 Mbps'),
          ),
          RadioListTile<String>(
            value: 'high',
            groupValue: settings.qualityId,
            onChanged: (v) { if (v != null) settings.setQuality(v); },
            title: const Text('高清 (1080p / 30 fps)'),
            subtitle: const Text('需要稳定的局域网'),
          ),
          const Divider(),
          const _SectionHeader('行为'),
          SwitchListTile.adaptive(
            value: settings.includeMicrophone,
            onChanged: settings.setMicrophone,
            title: const Text('传输麦克风'),
            subtitle: const Text('投屏时附带手机麦克风'),
          ),
          SwitchListTile.adaptive(
            value: settings.keepScreenAwake,
            onChanged: settings.setKeepScreenAwake,
            title: const Text('保持屏幕常亮'),
            subtitle: const Text('投屏期间禁止手机熄屏'),
          ),
          SwitchListTile.adaptive(
            value: settings.autoReconnect,
            onChanged: settings.setAutoReconnect,
            title: const Text('自动重连'),
            subtitle: const Text('信令断开后自动尝试恢复'),
          ),
          const Divider(),
          const _SectionHeader('关于'),
          const ListTile(
            leading: Icon(Icons.info_outline),
            title: Text('MyCast 0.1.0'),
            subtitle: Text('局域网投屏 + 文件传输'),
          ),
        ],
      ),
    );
  }

  void _renameDevice(BuildContext context, DeviceProfile profile) {
    final controller = TextEditingController(text: profile.deviceName);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('修改本机名称'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 32,
          decoration: const InputDecoration(hintText: '例如：Pixel 10 (客厅)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('取消')),
          FilledButton(
            onPressed: () {
              profile.rename(controller.text);
              Navigator.of(ctx).pop();
            },
            child: const Text('保存'),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
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
