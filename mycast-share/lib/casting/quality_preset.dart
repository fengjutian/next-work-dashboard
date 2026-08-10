/// Screen casting quality presets.
///
/// The phone encodes its MediaProjection stream and the desktop receives it
/// via WebRTC. Encoders negotiate the actual bitrate / resolution; these
/// values are *initial* hints (via SDP X-google-start-bitrate, etc.).
class QualityPreset {
  const QualityPreset({
    required this.id,
    required this.label,
    required this.width,
    required this.height,
    required this.frameRate,
    required this.bitrateKbps,
  });

  final String id;
  final String label;
  final int width;
  final int height;
  final int frameRate;
  final int bitrateKbps;

  static const smooth = QualityPreset(
    id: 'smooth',
    label: '流畅 (540p / 15 fps)',
    width: 960,
    height: 540,
    frameRate: 15,
    bitrateKbps: 1200,
  );

  static const balanced = QualityPreset(
    id: 'balanced',
    label: '均衡 (720p / 30 fps)',
    width: 1280,
    height: 720,
    frameRate: 30,
    bitrateKbps: 2500,
  );

  static const high = QualityPreset(
    id: 'high',
    label: '高清 (1080p / 30 fps)',
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrateKbps: 6000,
  );

  static const all = <QualityPreset>[smooth, balanced, high];

  static QualityPreset byId(String id) =>
      all.firstWhere((p) => p.id == id, orElse: () => balanced);
}
