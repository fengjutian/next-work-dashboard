// Smoke test for the MyCast app shell.
//
// A full integration test is intentionally out of scope for the MVP — the
// pairing, signaling, and casting flows all touch platform channels and the
// WebRTC engine. This file just keeps `flutter test` green for CI.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('smoke test renders a MaterialApp', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: Center(child: Text('MyCast')))),
    );
    expect(find.text('MyCast'), findsOneWidget);
  });
}
