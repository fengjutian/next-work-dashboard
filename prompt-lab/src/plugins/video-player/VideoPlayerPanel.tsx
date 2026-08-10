/**
 * 视频播放器插件主面板
 *
 * V1 视频窗口策略：mpv 自身窗口（独立 OS 窗口），UI 作为"遥控器"控制。
 * 集成：文件选择 / 拖拽 / 播放控制 / 进度条 / 音轨 / 字幕 / 快捷键 / 最近播放
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Video, Upload, X, ExternalLink } from '@/components/icons';
import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from 'antd';
import { Controls } from './Controls';
import { ProgressBar } from './ProgressBar';
import { MediaInfoPanel } from './MediaInfoPanel';
import { RecentList } from './RecentList';
import { useVideoPlayer } from './useVideoPlayer';
import { fileBaseName, fileDirName } from './format';
import {
  applySeek,
  applySpeedChange,
  applyVolumeChange,
  SEEK_STEP,
  SHORTCUT_HELP,
  VOLUME_STEP,
  useShortcuts,
} from './useShortcuts';
import { loadRecent, recordRecent } from './recent-store';
import type { RecentVideoEntry } from './types';

export function VideoPlayerPanel() {
  const player = useVideoPlayer();
  const [dragOver, setDragOver] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recentEntries, setRecentEntries] = useState<RecentVideoEntry[]>(() => loadRecent());
  const dragCounter = useRef(0);

  // 文件载入后写入"最近播放"
  useEffect(() => {
    if (player.status.state === 'ready' || player.status.state === 'playing' || player.status.state === 'paused') {
      const filePath = player.status.filePath;
      if (filePath) {
        const name = fileBaseName(filePath);
        const entry: RecentVideoEntry = {
          path: filePath,
          name,
          duration: player.status.duration,
          lastPlayedAt: Date.now(),
        };
        setRecentEntries(recordRecent(entry));
      }
    }
  }, [player.status.state, player.status.filePath, player.status.duration]);

  // 拖拽到面板
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      dragCounter.current = 0;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const api = (window as any).electronAPI;
      const filePath: string | undefined = typeof file.path === 'string'
        ? file.path
        : api?.getPathForFile
          ? await api.getPathForFile(file)
          : undefined;
      if (!filePath) {
        Modal.error({ title: '无法识别文件路径', content: '请改用"打开文件"按钮选择。' });
        return;
      }
      setBusy(true);
      try {
        await player.open(filePath);
      } catch (err) {
        Modal.error({ title: '打开失败', content: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [player],
  );

  const openFile = useCallback(async () => {
    setBusy(true);
    try {
      await player.pickAndOpen();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/canceled|cancel/i.test(message)) {
        Modal.error({ title: '打开失败', content: message });
      }
    } finally {
      setBusy(false);
    }
  }, [player]);

  const closePlayer = useCallback(async () => {
    try {
      await player.close();
    } catch {
      // ignore
    }
  }, [player]);

  const playFromRecent = useCallback(
    async (entry: RecentVideoEntry) => {
      setBusy(true);
      try {
        await player.open(entry.path);
      } catch (err) {
        Modal.error({ title: '打开失败', content: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [player],
  );

  // 快捷键
  const api = (window as any).electronAPI?.videoPlayer;
  useShortcuts(
    useMemo(
      () => ({
        toggle: () => player.toggle().catch(() => {}),
        seekForward: () => api && applySeek(api, SEEK_STEP).catch(() => {}),
        seekBackward: () => api && applySeek(api, -SEEK_STEP).catch(() => {}),
        volumeUp: () => api && applyVolumeChange(api, player.status.volume, VOLUME_STEP).catch(() => {}),
        volumeDown: () => api && applyVolumeChange(api, player.status.volume, -VOLUME_STEP).catch(() => {}),
        mute: () => api && api.setMute(!player.status.muted).catch(() => {}),
        speedUp: () => api && applySpeedChange(api, player.status.speed, 0.1).catch(() => {}),
        speedDown: () => api && applySpeedChange(api, player.status.speed, -0.1).catch(() => {}),
        resetSpeed: () => api && api.setSpeed(1).catch(() => {}),
        stop: () => player.stop().catch(() => {}),
      }),
      [api, player],
    ),
    !!player.status.filePath,
  );

  const { status } = player;
  const fileName = status.filePath ? fileBaseName(status.filePath) : '';
  const fileDir = status.filePath ? fileDirName(status.filePath) : '';
  const isEmpty = !status.filePath;

  return (
    <div className="flex h-full bg-card">
      <div
        className="flex-1 flex flex-col min-w-0"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Video className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">视频播放器</h2>
            {fileName && (
              <span className="text-xs text-muted-foreground truncate" title={status.filePath ?? ''}>
                <span className="font-medium text-foreground/80">{fileName}</span>
                {fileDir && <span className="ml-1.5 text-muted-foreground/70">{fileDir}</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setHelpOpen(true)} title="查看快捷键">
              <Keyboard className="h-3.5 w-3.5" />
            </Button>
            {!recentOpen && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRecentOpen(true)} title="打开最近播放">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button type="button" variant="default" size="sm" onClick={openFile} disabled={busy}>
              <Upload className="h-3.5 w-3.5" />
              打开文件
            </Button>
            {status.filePath && (
              <Button type="button" variant="outline" size="sm" onClick={closePlayer} title="关闭当前视频">
                <X className="h-3.5 w-3.5" />
                关闭
              </Button>
            )}
          </div>
        </div>

        {/* Stage / placeholder */}
        <div className="flex-1 relative overflow-hidden">
          {dragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary m-4 rounded-lg pointer-events-none">
              <div className="text-center">
                <Upload className="h-10 w-10 text-primary mx-auto mb-2" />
                <p className="text-sm text-primary font-medium">释放以打开视频</p>
                <p className="text-xs text-muted-foreground mt-1">支持 .mp4 .mkv .mov .avi .webm 等</p>
              </div>
            </div>
          )}

          {isEmpty ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <div className="rounded-full bg-primary/10 p-6 mb-4">
                <Video className="h-12 w-12 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground">打开一个视频文件开始</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                视频将在独立的 mpv 窗口中显示，本面板作为遥控器。
                支持常见格式（MP4 / MKV / MOV / AVI / WebM / FLV / TS 等）。
              </p>
              <Button type="button" variant="default" size="lg" onClick={openFile} className="mt-4" disabled={busy}>
                <Upload className="h-4 w-4" />
                选择文件
              </Button>
              {status.errorMessage && (
                <p className="text-sm text-destructive mt-3 max-w-md">
                  {status.errorMessage}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-6">
                {status.errorMessage?.includes('未找到 mpv')
                  ? '提示：执行 npm run fetch:mpv 自动下载 mpv 二进制到 resources/video-player/'
                  : '或直接把文件拖到这里'}
              </p>
            </div>
          ) : (
            <StagePlaceholder status={status.state} fileName={fileName} />
          )}
        </div>

        {/* Progress + controls */}
        {!isEmpty && (
          <>
            <div className="px-3 py-1.5 border-t bg-muted/30">
              <ProgressBar
                currentTime={status.currentTime}
                duration={status.duration}
                onSeek={(t) => player.seek(t, 'absolute').catch(() => {})}
              />
            </div>
            <Controls
              status={status}
              onToggle={() => player.toggle().catch(() => {})}
              onStop={() => player.stop().catch(() => {})}
              onVolume={(v) => player.setVolume(v).catch(() => {})}
              onMute={(m) => player.setMute(m).catch(() => {})}
              onSpeed={(s) => player.setSpeed(s).catch(() => {})}
              onSelectAudio={(id) => player.selectAudio(id).catch(() => {})}
              onSelectSubtitle={(id) => player.selectSubtitle(id).catch(() => {})}
              onAddSubtitle={() => player.addSubtitle().catch((err) => {
                Modal.error({ title: '加载字幕失败', content: err instanceof Error ? err.message : String(err) });
              })}
              onOpenHelp={() => setHelpOpen(true)}
            />
          </>
        )}

        <MediaInfoPanel mediaInfo={status.mediaInfo} filePath={status.filePath} />
      </div>

      {recentOpen && (
        <RecentList
          entries={recentEntries}
          onPick={playFromRecent}
          onClose={() => setRecentOpen(false)}
        />
      )}

      <Modal
        title="快捷键"
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        footer={null}
        width={420}
      >
        <ul className="space-y-1.5 text-sm">
          {SHORTCUT_HELP.map((s) => (
            <li key={s.keys.join('/')} className="flex items-center justify-between gap-3">
              <span className="text-foreground/80">{s.desc}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {s.keys.join(' / ')}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function StagePlaceholder({ status, fileName }: { status: string; fileName: string }) {
  const message = (() => {
    switch (status) {
      case 'loading': return '正在加载媒体…';
      case 'ready': return '已就绪';
      case 'playing': return '播放中';
      case 'paused': return '已暂停';
      case 'ended': return '播放结束';
      case 'error': return '播放出错';
      default: return '已停止';
    }
  })();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-gradient-to-br from-muted/50 to-background">
      <div className="rounded-full bg-card border p-5 mb-4 shadow-sm">
        <Video className="h-10 w-10 text-primary" />
      </div>
      <p className="text-sm font-medium text-foreground">{message}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-md">
        视频画面在独立的 mpv 窗口中显示。使用底部控件或快捷键控制播放。
      </p>
      <p className="text-xs text-muted-foreground/70 mt-2 truncate max-w-[80%]" title={fileName}>
        {fileName}
      </p>
    </div>
  );
}
