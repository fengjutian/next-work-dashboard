# FFmpeg runtime

Place distributable FFmpeg binaries in the platform directory before packaging:

```text
resources/ffmpeg/
  win32/ffmpeg.exe
  win32/ffprobe.exe
  darwin/ffmpeg
  darwin/ffprobe
  linux/ffmpeg
  linux/ffprobe
```

When either binary is present, Electron Forge includes this directory automatically
for `npm run package` and `npm run make`.
Keep the matching FFmpeg license and source-offer materials with release artifacts.
