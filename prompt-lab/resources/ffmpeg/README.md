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

Set `NWD_BUNDLE_FFMPEG=1` when running `npm run package` or `npm run make`.
Keep the matching FFmpeg license and source-offer materials with release artifacts.
