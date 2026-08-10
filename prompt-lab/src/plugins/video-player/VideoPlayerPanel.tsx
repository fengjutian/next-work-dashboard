/**
 * 视频播放器插件主面板（V2 完整版）
 *
 * 集成：
 *  - 文件 / URL 打开、拖拽
 *  - 播放控制 + 进度条
 *  - 音轨 / 字幕切换
 *  - 播放列表面板（自动连播 / 循环 / 随机）
 *  - 视频窗口模式切换（mpv 默认 / BrowserWindow 嵌入基线）
 *  - 完整快捷键
 *  - 最近播放（侧栏）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Video, Upload, X, ExternalLink } from '@/components/icons';
import { Keyboard, Link2, MonitorPlay } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal, Input } from 'antd';
import { Controls } from './Controls';
import { ProgressBar } from './ProgressBar';
import { MediaInfoPanel } from './MediaInfoPanel';
import { RecentList } from './RecentList';
import { PlaylistPanel } from './PlaylistPanel';
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
import type { RecentVideoEntry, VideoWindowMode } from './types';

type SidebarTab = 'recent' | 'playlist' | 'none';

export function VideoPlayerPanel() {
  const player = useVideoPlayer();
  const [dragOver, setDragOver] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [sidebar, setSidebar] = useState<SidebarTab>('recent');
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

  // 拖拽
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
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;
      const api = (window as any).electronAPI;
      const sources: string[] = [];
      for (const file of files) {
        let p: string | undefined = typeof file.path === 'string' ? file.path : undefined;
        if (!p && api?.getPathForFile) {
          p = await api.getPathForFile(file);
        }
        if (p) sources.push(p);
      }
      if (sources.length === 0) {
        Modal.error({ title: '无法识别文件路径', content: '请改用"打开文件"按钮选择。' });
        return;
      }
      setBusy(true);
      try {
        await player.addToPlaylist(sources);
        await player.playIndex(0);
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

  const openUrl = useCallback(async () => {
    if (!urlInput.trim()) return;
    setBusy(true);
    try {
      await player.openUrl(urlInput.trim());
      setUrlOpen(false);
      setUrlInput('');
    } catch (err) {
      Modal.error({ title: '打开 URL 失败', content: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [player, urlInput]);

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

  const switchWindowMode = useCallback(async (mode: VideoWindowMode) => {
    if (status.window.mode === mode) return;
    setBusy(true);
    try {
      await player.setWindowMode(mode);
    } catch (err) {
      Modal.error({ title: '切换窗口模式失败', content: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [player, status.window.mode]);

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
            <WindowModeToggle mode={status.window.mode} onChange={switchWindowMode} disabled={busy} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setHelpOpen(true)} title="查看快捷键">
              <Keyboard className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setUrlOpen(true)} title="打开网络 URL（HLS / RTSP / RTMP / HTTP）">
              <Link2 className="h-3.5 w-3.5" />
              URL
            </Button>
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

        {/* Sidebar tabs */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-muted/30 text-xs">
          <SidebarTabButton active={sidebar === 'playlist'} onClick={() => setSidebar('playlist')} count={status.playlist.items.length}>
            播放列表
          </SidebarTabButton>
          <SidebarTabButton active={sidebar === 'recent'} onClick={() => setSidebar('recent')} count={recentEntries.length}>
            最近
          </SidebarTabButton>
          {sidebar !== 'none' && (
            <button
              type="button"
              onClick={() => setSidebar('none')}
              className="ml-auto text-muted-foreground hover:text-foreground"
              title="关闭侧栏"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {sidebar === 'none' && (
            <button
              type="button"
              onClick={() => setSidebar('recent')}
              className="ml-auto text-muted-foreground hover:text-foreground"
              title="打开侧栏"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Stage / placeholder */}
        <div className="flex-1 relative overflow-hidden">
          {dragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary m-4 rounded-lg pointer-events-none">
              <div className="text-center">
                <Upload className="h-10 w-10 text-primary mx-auto mb-2" />
                <p className="text-sm text-primary font-medium">释放以加入播放列表</p>
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
                视频显示在 {status.window.mode === 'browser' ? '内置浏览器窗口' : 'mpv 窗口'}。
                本面板作为遥控器，支持播放列表 / 网络 URL / 快捷键。
              </p>
              <div className="flex items-center gap-2 mt-4">
                <Button type="button" variant="default" size="lg" onClick={openFile} disabled={busy}>
                  <Upload className="h-4 w-4" />
                  选择文件
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={() => setUrlOpen(true)}>
                  <Link2 className="h-4 w-4" />
                  打开 URL
                </Button>
              </div>
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
            <StagePlaceholder
              status={status.state}
              fileName={fileName}
              windowMode={status.window.mode}
              detached={status.window.detached}
              onFocusVideoWindow={() => player.focusVideoWindow().catch(() => {})}
              onAttach={() => player.attachVideoWindow().catch(() => {})}
            />
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
              onAddSubtitle={() => player.pickAndAddSubtitle().catch((err) => {
                Modal.error({ title: '加载字幕失败', content: err instanceof Error ? err.message : String(err) });
              })}
              onOpenHelp={() => setHelpOpen(true)}
            />
          </>
        )}

        <MediaInfoPanel mediaInfo={status.mediaInfo} filePath={status.filePath} />
      </div>

      {sidebar === 'playlist' && (
        <PlaylistPanel
          playlist={status.playlist}
          onPlayIndex={(idx) => player.playIndex(idx).catch((err) => {
            Modal.error({ title: '播放失败', content: err instanceof Error ? err.message : String(err) });
          })}
          onPlayNext={() => player.playNext().catch(() => {})}
          onPlayPrev={() => player.playPrev().catch(() => {})}
          onRemove={(id) => player.removeFromPlaylist(id).catch(() => {})}
          onClear={() => player.clearPlaylist().catch(() => {})}
          onModeChange={(m) => player.setPlaylistMode(m).catch(() => {})}
          onReorder={(from, to) => player.reorderPlaylist(from, to).catch(() => {})}
          onAddFiles={() => player.pickAndOpen().catch((err) => {
            if (!/canceled|cancel/i.test(String(err))) {
              Modal.error({ title: '打开失败', content: err instanceof Error ? err.message : String(err) });
            }
          })}
          onClose={() => setSidebar('recent')}
        />
      )}

      {sidebar === 'recent' && (
        <RecentList
          entries={recentEntries}
          onPick={playFromRecent}
          onClose={() => setSidebar('none')}
        />
      )}

      {/* Modals */}
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

      <Modal
        title="打开网络 URL"
        open={urlOpen}
        onOk={openUrl}
        onCancel={() => {
          setUrlOpen(false);
          setUrlInput('');
        }}
        okText="播放"
        cancelText="取消"
        confirmLoading={busy}
      >
        <p className="text-sm text-muted-foreground mb-3">
          mpv 原生支持 HTTP / HTTPS / HLS（.m3u8）/ RTSP / RTMP / MMS。可用于直播、远程视频等。
        </p>
        <Input
          placeholder="https://example.com/video.m3u8"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onPressEnter={openUrl}
          autoFocus
        />
      </Modal>
    </div>
  );
}

function SidebarTabButton({ children, active, onClick, count }: { children: React.ReactNode; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded transition-colors ${
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
      {typeof count === 'number' && (
        <span className="ml-1 text-muted-foreground/70 tabular-nums">{count}</span>
      )}
    </button>
  );
}

function WindowModeToggle({ mode, onChange, disabled }: { mode: VideoWindowMode; onChange: (m: VideoWindowMode) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center rounded-md border bg-card mr-1 overflow-hidden">
      <button
        type="button"
        onClick={() => onChange('mpv')}
        disabled={disabled}
        title="mpv 默认窗口（独立 OS 窗口）"
        className={`px-1.5 py-1 text-xs ${
          mode === 'mpv' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <MonitorPlay className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange('browser')}
        disabled={disabled}
        title="嵌入到 BrowserWindow（V2 基线）"
        className={`px-1.5 py-1 text-xs ${
          mode === 'browser' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        嵌入
      </button>
    </div>
  );
}

function StagePlaceholder({ status, fileName, windowMode, detached, onFocusVideoWindow, onAttach }: {
  status: string;
  fileName: string;
  windowMode: VideoWindowMode;
  detached: boolean;
  onFocusVideoWindow: () => void;
  onAttach: () => void;
}) {
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
        视频显示在 {windowMode === 'browser' ? '嵌入窗口' : 'mpv 窗口'}。使用底部控件或快捷键控制。
      </p>
      {windowMode === 'browser' && (
        <div className="flex items-center gap-2 mt-3">
          <Button type="button" variant="outline" size="sm" onClick={onFocusVideoWindow}>
            切到视频窗口
          </Button>
          {detached && (
            <Button type="button" variant="ghost" size="sm" onClick={onAttach}>
              重新附加
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground/70 mt-2 truncate max-w-[80%]" title={fileName}>
        {fileName}
      </p>
    </div>
  );
}
