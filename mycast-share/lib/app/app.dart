import 'package:flutter/material.dart';

import '../pairing/pairing_page.dart';
import '../casting/casting_page.dart';
import '../transfer/transfer_page.dart';
import '../settings/settings_page.dart';
import 'routes.dart';
import 'theme.dart';

class MyCastApp extends StatelessWidget {
  const MyCastApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MyCast',
      theme: buildMyCastTheme(),
      darkTheme: buildMyCastTheme(brightness: Brightness.dark),
      themeMode: ThemeMode.system,
      initialRoute: Routes.pairing,
      onGenerateRoute: (settings) {
        switch (settings.name) {
          case Routes.pairing:
            return MaterialPageRoute(builder: (_) => const PairingPage());
          case Routes.casting:
            return MaterialPageRoute(builder: (_) => const CastingPage());
          case Routes.transfer:
            return MaterialPageRoute(builder: (_) => const TransferPage());
          case Routes.settings:
            return MaterialPageRoute(builder: (_) => const SettingsPage());
        }
        return null;
      },
    );
  }
}
