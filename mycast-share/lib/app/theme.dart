import 'package:flutter/material.dart';

/// MyCast brand palette: deep indigo + cyan accent.
const _kIndigo = Color(0xFF4F46E5);
const _kCyan = Color(0xFF06B6D4);
const _kBg = Color(0xFFF8FAFC);
const _kBgDark = Color(0xFF0B1220);
const _kSurface = Color(0xFFFFFFFF);
const _kSurfaceDark = Color(0xFF111827);
const _kOnSurface = Color(0xFF0F172A);
const _kOnSurfaceDark = Color(0xFFE2E8F0);

ThemeData buildMyCastTheme({Brightness? brightness}) {
  brightness ??= Brightness.light;
  final isDark = brightness == Brightness.dark;

  final scheme = ColorScheme.fromSeed(
    seedColor: _kIndigo,
    secondary: _kCyan,
    brightness: brightness,
    surface: isDark ? _kSurfaceDark : _kSurface,
    onSurface: isDark ? _kOnSurfaceDark : _kOnSurface,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: isDark ? _kBgDark : _kBg,
    appBarTheme: AppBarTheme(
      centerTitle: false,
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      elevation: 0,
      scrolledUnderElevation: 0.5,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.4)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: isDark ? _kBgDark : _kBg,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: scheme.primary, width: 1.4),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
    ),
  );
}
