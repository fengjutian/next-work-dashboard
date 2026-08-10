# 歌词工坊高精度音乐结构分析占位设计

当前版本只启用 `Meyda + wavesurfer.js` 本地轻量分析。`All-In-One Music Structure Analyzer` 不随应用安装，也不会被静默下载或启动。

## 预留边界

- 渲染层入口：`analyzeWithHighAccuracy(file)`。
- 能力探测：`getHighAccuracyAnalyzerStatus()`。
- 统一输出沿用 `AudioAnalysis` 与 `AudioStructureSegment`，UI 不应感知 Python 返回格式。
- 当前占位实现位于 `prompt-lab/src/plugins/lyric-studio/high-accuracy-analyzer.ts`，始终报告不可用。

## 后续实现建议

1. 在 Electron 主进程增加受限 IPC，只接收用户明确选择的本地音频路径。
2. 使用独立 Python worker 调用 All-In-One，模型和 Python 环境作为可选组件下载，不打入默认安装包。
3. 标准化为 WAV 后分析，worker 仅向主进程输出 JSON；临时音频和分轨在完成或取消后清理。
4. 校验 worker 输出的路径、段落范围和数值，设置超时、取消、并发数及资源上限。
5. 将标签映射为 `Intro | Verse | Pre-Chorus | Chorus | Bridge | Outro | Unknown`，再交给现有时间轴人工修正。

建议的 IPC 返回体：

```json
{
  "bpm": 96,
  "beats": [0.31, 0.94],
  "downbeats": [0.31],
  "segments": [
    { "start": 0, "end": 12.8, "kind": "Intro", "confidence": 0.91 }
  ]
}
```

引入前需补充 Windows/macOS/Linux 打包验证、模型许可证清单、离线安装与卸载流程，以及无 GPU 条件下的性能基线。
