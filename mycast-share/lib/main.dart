import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/app.dart';
import 'pairing/pairing_service.dart';
import 'pairing/device_profile.dart';
import 'settings/settings_store.dart';
import 'signaling/signaling_client.dart';
import 'casting/casting_service.dart';
import 'transfer/transfer_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final profile = await DeviceProfile.load();
  final settings = await SettingsStore.load();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<DeviceProfile>.value(value: profile),
        ChangeNotifierProvider<SettingsStore>.value(value: settings),
        ChangeNotifierProvider<PairingService>(create: (_) => PairingService(profile)),
        ChangeNotifierProvider<SignalingClient>(create: (_) => SignalingClient()),
        Provider<SignalingRouter>(create: (_) => SignalingRouter()),
        ChangeNotifierProvider<CastingService>(create: (_) => CastingService()),
        ChangeNotifierProvider<TransferService>(create: (_) => TransferService(profile)),
      ],
      child: const MyCastApp(),
    ),
  );
}
