# FFmpeg runtime

Place distributable FFmpeg binaries in the platform directory before packaging:

```text
resources/ffmpeg/
  win-x64/ffmpeg.exe
  win-x64/ffprobe.exe
  darwin-arm64/ffmpeg
  darwin-arm64/ffprobe
  linux-x64/ffmpeg
  linux-x64/ffprobe
```

The legacy `win32`, `darwin`, and `linux` directories are also detected for
backward compatibility.

When either binary is present, Electron Forge includes this directory automatically
for `npm run package` and `npm run make`.
Keep the matching FFmpeg license and source-offer materials with release artifacts.
