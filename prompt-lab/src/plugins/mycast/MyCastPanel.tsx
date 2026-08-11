/**
 * MyCast — 局域网手机投屏 + 文件传输 桌面端插件
 *
 * 包含四个内置 tab：
 *  - Home: 状态 / 配对码 / QR 码 / 连接方式
 *  - Devices: 已配对 / 在线手机
 *  - Screen: WebRTC 接收 (HTMLVideoElement)
 *  - Files: 文件传输记录
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Monitor, Network, Phone, RefreshCw, RotateCcw, Video, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { notification } from 'antd';
import QRCode from 'qrcode';

import type { MyCastEvent, MyCastState, SessionInfo, TransferInfo } from './backend/mycast-types';

export type MyCastTab = 'home' | 'devices' | 'screen' | 'files';

const TABS: { key: MyCastTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'home', label: '主页', icon: Network },
  { key: 'devices', label: '设备', icon: Phone },
  { key: 'screen', label: '投屏', icon: Video },
  { key: 'files', label: '文件', icon: FileText },
];

const humanSize = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const humanTime = (ms: number) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

interface DeviceEntry {
  deviceId: string;
  deviceName: string;
  platform: string;
  pairedAt: number;
  source: 'hello' | 'pair';
}

interface ScreenSession {
  sessionId: string;
  phoneDeviceId: string;
  phoneDeviceName: string;
  startedAt: number;
  pc: RTCPeerConnection | null;
}

export const MyCastPanel: React.FC = () => {
  const [notice, holder] = notification.useNotification();
  const [tab, setTab] = useState<MyCastTab>('home');
  const [state, setState] = useState<MyCastState | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [transfers, setTransfers] = useState<TransferInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenSession | null>(null);
  const [streamStats, setStreamStats] = useState<{ resolution?: string; bitrate?: number; state: RTCPeerConnectionState | 'idle' }>({ state: 'idle' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const statsTimerRef = useRef<number | null>(null);

  /* ── 启动 daemon + 监听事件 ── */
  useEffect(() => {
    let cancelled = false;
    const startAndRefresh = async () => {
      try {
        const cur = await window.electronAPI.mycast.start();
        if (cancelled) return;
        setState(cur);
        await refreshAll();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void startAndRefresh();
    const off = window.electronAPI.mycast.onEvent((ev: MyCastEvent) => handleEvent(ev));
    return () => { cancelled = true; off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [s, sess, t] = await Promise.all([
        window.electronAPI.mycast.state(),
        window.electronAPI.mycast.listSessions(),
        window.electronAPI.mycast.listTransfers(),
      ]);
      setState(s);
      setSessions(sess as SessionInfo[]);
      setTransfers(t as TransferInfo[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const handleEvent = useCallback((ev: MyCastEvent) => {
    switch (ev.type) {
      case 'ready':
        setState((s) => s ? { ...s, ready: true, deviceId: ev.deviceId, deviceName: ev.deviceName, platform: ev.platform, httpPort: ev.httpPort, wsPort: ev.wsPort, mdnsEnabled: ev.mdnsEnabled, version: ev.version, bindAddr: ev.bindAddr, lanAddr: ev.lanAddr, lanAddrs: ev.lanAddrs } : s);
        notice.success({ message: 'MyCast 已就绪', description: `${ev.deviceName} · LAN ${ev.lanAddr} · HTTP :${ev.httpPort}`, placement: 'bottomRight' });
        break;
      case 'phone.hello':
        setDevices((prev) => {
          const existing = prev.find((d) => d.deviceId === ev.deviceId);
          if (existing) return prev;
          return [...prev, { deviceId: ev.deviceId, deviceName: ev.deviceName, platform: ev.platform, pairedAt: Date.now(), source: 'hello' }];
        });
        notice.info({ message: '手机已连接', description: `${ev.deviceName} (${ev.platform})`, placement: 'bottomRight' });
        break;
      case 'phone.pair':
        setDevices((prev) => {
          const existing = prev.find((d) => d.deviceId === ev.deviceId);
          const next = { deviceId: ev.deviceId, deviceName: ev.deviceName, platform: ev.platform, pairedAt: Date.now(), source: 'pair' as const };
          if (existing) return prev.map((d) => (d.deviceId === ev.deviceId ? { ...d, ...next } : d));
          return [...prev, next];
        });
        break;
      case 'session.created':
        if (ev.kind === 'screen') {
          setActiveScreen({
            sessionId: ev.sessionId,
            phoneDeviceId: ev.phoneDeviceId,
            phoneDeviceName: devices.find((d) => d.deviceId === ev.phoneDeviceId)?.deviceName ?? ev.phoneDeviceId,
            startedAt: Date.now(),
            pc: null,
          });
          setTab('screen');
          notice.info({ message: '手机请求投屏', description: ev.sessionId, placement: 'bottomRight' });
        }
        void refreshAll();
        break;
      case 'webrtc.offer':
        void handleOffer(ev.sessionId, ev.phoneDeviceId, ev.sdp);
        break;
      case 'webrtc.ice':
        if (ev.candidate && activeScreen?.pc) {
          try { void activeScreen.pc.addIceCandidate(ev.candidate as RTCIceCandidateInit); } catch (e) { /* ignore */ }
        }
        break;
      case 'stream.start':
        setStreamStats((s) => ({ ...s, state: 'connected' }));
        break;
      case 'stream.stop':
        teardownScreen();
        break;
      case 'error':
        setError(ev.message);
        notice.error({ message: 'MyCast 出错', description: ev.message, placement: 'bottomRight' });
        break;
    }
  }, [devices, notice, activeScreen?.pc, refreshAll]);

  /* ── WebRTC 接收处理 ── */
  const handleOffer = useCallback(async (sessionId: string, phoneDeviceId: string, sdp: string) => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.ontrack = (ev) => {
      if (videoRef.current) {
        videoRef.current.srcObject = ev.streams[0];
        videoRef.current.play().catch(() => undefined);
      }
      setStreamStats((s) => ({ ...s, state: 'connected' }));
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        void window.electronAPI.mycast.sendToPhone(phoneDeviceId, {
          type: 'ice',
          session_id: sessionId,
          candidate: ev.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      setStreamStats((s) => ({ ...s, state: pc.connectionState }));
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        teardownScreen();
      }
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      void window.electronAPI.mycast.sendToPhone(phoneDeviceId, {
        type: 'answer',
        session_id: sessionId,
        sdp: answer.sdp ?? '',
      });
      setActiveScreen({
        sessionId,
        phoneDeviceId,
        phoneDeviceName: devices.find((d) => d.deviceId === phoneDeviceId)?.deviceName ?? phoneDeviceId,
        startedAt: Date.now(),
        pc,
      });
      startStats(pc);
    } catch (e) {
      notice.error({ message: 'WebRTC 协商失败', description: (e as Error).message, placement: 'bottomRight' });
    }
  }, [devices, notice]);

  const teardownScreen = useCallback(() => {
    if (activeScreen?.pc) {
      try { activeScreen.pc.close(); } catch { /* ignore */ }
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setActiveScreen(null);
    setStreamStats({ state: 'idle' });
    if (statsTimerRef.current) {
      window.clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
  }, [activeScreen?.pc]);

  const startStats = (pc: RTCPeerConnection) => {
    if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
    let lastBytes = 0;
    statsTimerRef.current = window.setInterval(async () => {
      try {
        const stats = await pc.getStats();
        let bytes = 0; let width = 0; let height = 0;
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && (report as { kind?: string }).kind === 'video') {
            bytes += Number((report as { bytesReceived?: number }).bytesReceived ?? 0);
            width = Number((report as { frameWidth?: number }).frameWidth ?? width);
            height = Number((report as { frameHeight?: number }).frameHeight ?? height);
          }
        });
        const delta = Math.max(0, bytes - lastBytes);
        lastBytes = bytes;
        setStreamStats((s) => ({ ...s, bitrate: delta * 8 / 1000, resolution: width && height ? `${width}×${height}` : s.resolution }));
      } catch { /* ignore */ }
    }, 1000);
  };

  /* ── 配对码生成 ── */
  const issuePairing = useCallback(async () => {
    if (!state?.ready) {
      setError('daemon 还没就绪');
      return;
    }
    setStarting(true);
    try {
      const r = await window.electronAPI.mycast.issuePairing();
      setPairCode(r.pairCode);
      setPairExpiresAt(Date.now() + r.expiresInMs);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }, [state?.ready]);

  /* ── QR 码生成 ── */
  useEffect(() => {
    if (!state?.ready || !pairCode) { setQrSvg(null); return; }
    const { httpLink } = buildMobileUrl(state, pairCode);
    // Encode a regular HTTP URL so the system camera and WeChat can open it.
    // The MyCast in-app scanner also accepts this format.
    QRCode.toString(httpLink, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220 })
      .then(setQrSvg)
      .catch(() => setQrSvg(null));
  }, [state, pairCode]);

  /* ── 自动刷新会话 / 传输 ── */
  useEffect(() => {
    const t = window.setInterval(() => { void refreshAll(); }, 5000);
    return () => window.clearInterval(t);
  }, [refreshAll]);

  /* ── 倒计时显示配对码剩余时间 ── */
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const pairRemaining = pairExpiresAt ? Math.max(0, Math.floor((pairExpiresAt - now) / 1000)) : 0;

  return (
    <div className="flex h-full flex-col bg-background">
      {holder}
      <header className="flex h-14 items-center gap-3 border-b px-5">
        <Monitor className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">MyCast · 局域网投屏</h2>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {state?.ready
              ? `${state.deviceName ?? '桌面'} · ${state.lanAddr ?? 'LAN'}:${state.httpPort} · mDNS ${state.mdnsEnabled ? '✓' : '✗'}`
              : state === null ? '正在连接…' : 'daemon 未就绪'}
          </p>
        </div>
        <span className={`pill ${state?.ready ? 'ok' : 'warn'}`} style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, background: state?.ready ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: state?.ready ? 'var(--ok)' : 'var(--warn)' }}>
          {state?.ready ? '● 就绪' : '● 离线'}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void refreshAll()}><RefreshCw className="h-4 w-4" /></Button>
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 border-b px-3 py-1.5 text-sm">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
              onClick={() => setTab(t.key)}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-xs text-amber-700">
        <span><strong>当前版本：</strong>文件传输可用；Android 投屏正在验证 WebRTC 链路，视频源暂为前置摄像头，不是手机屏幕。</span>
        <button type="button" onClick={() => setTab('screen')} className="shrink-0 rounded border border-amber-500/30 px-2 py-1 hover:bg-amber-500/10">查看投屏状态</button>
      </div>

      <main className="flex-1 overflow-auto p-5">
        {error && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {tab === 'home' && <HomeTab state={state} pairCode={pairCode} pairRemaining={pairRemaining} qrSvg={qrSvg} onIssue={issuePairing} starting={starting} />}
        {tab === 'devices' && <DevicesTab devices={devices} sessions={sessions} onEndSession={async (id) => { await window.electronAPI.mycast.endSession(id); await refreshAll(); }} />}
        {tab === 'screen' && <ScreenTab videoRef={videoRef} activeScreen={activeScreen} streamStats={streamStats} onStop={teardownScreen} state={state} />}
        {tab === 'files' && <FilesTab transfers={transfers} onCancel={async (id) => { await window.electronAPI.mycast.cancelTransfer(id); await refreshAll(); }} onOpen={async (id) => { const result = await window.electronAPI.mycast.openTransfer(id); if (!result.success) setError(result.error ?? '无法打开文件'); }} onRefresh={refreshAll} />}
      </main>
    </div>
  );
};

/* =========================================================================
 *  Home Tab
 * ========================================================================= */

const HomeTab: React.FC<{
  state: MyCastState | null;
  pairCode: string | null;
  pairRemaining: number;
  qrSvg: string | null;
  onIssue: () => void;
  starting: boolean;
}> = ({ state, pairCode, pairRemaining, qrSvg, onIssue, starting }) => {
  const lanAddress = useMemo(() => {
    return state?.lanAddr && state.httpPort ? `http://${state.lanAddr}:${state.httpPort}` : '—';
  }, [state?.lanAddr, state?.httpPort]);

  const mobileUrl = state && pairCode ? buildMobileUrl(state, pairCode) : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
      <div className="order-2 rounded-lg border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Monitor className="h-4 w-4 text-primary" /> 桌面端</h3>
        <dl className="grid grid-cols-[80px_1fr] gap-y-2 text-xs">
          <dt className="text-muted-foreground">设备名</dt><dd className="font-medium">{state?.deviceName ?? '—'}</dd>
          <dt className="text-muted-foreground">设备 ID</dt><dd className="font-mono">{state?.deviceId ?? '—'}</dd>
          <dt className="text-muted-foreground">平台</dt><dd>{state?.platform ?? '—'}</dd>
          <dt className="text-muted-foreground">LAN IP</dt><dd className="font-mono text-primary">{state?.lanAddr ?? '—'}{state?.lanAddrs && state.lanAddrs.length > 1 && <span className="ml-2 text-[10px] text-muted-foreground">（+{state.lanAddrs.length - 1} 个备选）</span>}</dd>
          <dt className="text-muted-foreground">HTTP</dt><dd className="font-mono">0.0.0.0:{state?.httpPort ?? '—'}</dd>
          <dt className="text-muted-foreground">WebSocket</dt><dd className="font-mono">0.0.0.0:{state?.wsPort ?? '—'}</dd>
          <dt className="text-muted-foreground">mDNS</dt><dd>{state?.mdnsEnabled ? <span className="text-[color:var(--ok)]">已开启 · _nwd-mycast._tcp.local</span> : '已关闭'}</dd>
        </dl>
        {state?.lanAddrs && state.lanAddrs.length > 1 && (
          <details className="mt-2 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">所有 LAN 地址</summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {state.lanAddrs.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        )}
        <p className="mt-4 text-[11px] text-muted-foreground leading-relaxed">
          桌面端是 MyCast 服务的承载方，HTTP / WebSocket / mDNS 都通过 Rust sidecar (nwd-mycast.exe) 暴露。
          手机在同一局域网内可以通过 QR 码 / mDNS 名称 / 手动 IP 三种方式发现本机。
        </p>
      </div>

      <div className="order-first rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2"><Network className="h-4 w-4 text-primary" /> 用 MyCast App 扫码连接</h3>
            <p className="mt-1 text-xs text-muted-foreground">确保手机与电脑连接同一个 Wi-Fi</p>
          </div>
          <Button size="sm" variant="outline" onClick={onIssue} disabled={!state?.ready || starting}>
            <RotateCcw className={`mr-1 h-3.5 w-3.5 ${starting ? 'animate-spin' : ''}`} />
            {pairCode ? '换一组' : '生成配对码'}
          </Button>
        </div>
        {pairCode ? (
          <>
            <div className="flex items-baseline justify-center gap-3">
              <span className="font-mono text-4xl font-semibold tracking-widest text-primary">{pairCode.slice(0, 3)} {pairCode.slice(3, 6)}</span>
              <span className="text-xs text-muted-foreground">剩余 {pairRemaining}s</span>
            </div>
            {qrSvg && (
              <div className="mx-auto mt-4 flex w-fit justify-center rounded-xl border bg-white p-3 shadow-sm" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            )}
            {mobileUrl && (
              <>
                <p className="mt-2 break-all text-center font-mono text-[10px] text-muted-foreground">
                  {mobileUrl.httpLink}
                </p>
                <p className="mt-1 text-center text-[10px] text-muted-foreground">
                  手机相机/微信扫码会直接打开配对页；也可在 MyCast App 内扫码。{' '}
                  <a
                    className="text-primary underline"
                    href={mobileUrl.httpLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    用浏览器打开
                  </a>
                  （仅文件传输，无投屏）。
                </p>
              </>
            )}
          </>
        ) : (
          <div className="py-10 text-center">
            <Network className="mx-auto mb-3 h-10 w-10 text-primary/40" />
            <p className="text-sm font-medium">生成一次性配对码</p>
            <p className="mt-1 text-xs text-muted-foreground">配对码5分钟有效，只能成功使用一次。</p>
          </div>
        )}
      </div>

      <div className="order-3 rounded-lg border bg-card p-5">
        <h3 className="mb-2 text-sm font-semibold">三种连接方式</h3>
        <ul className="space-y-2 text-xs text-muted-foreground">
          <li><span className="font-medium text-foreground">1. QR 码（推荐）</span> · 在手机相机/微信扫描桌面端的 QR 码，手机浏览器自动打开配对页（<code className="font-mono text-foreground">{lanAddress}</code>）。</li>
          <li><span className="font-medium text-foreground">2. mDNS 名称</span> · 在手机浏览器输入 <code className="font-mono text-foreground">{state?.deviceName ?? '<hostname>'}.local</code>，系统自动解析到本机。</li>
          <li><span className="font-medium text-foreground">3. 手动 IP</span> · 确认手机和电脑在同一 WiFi，在手机浏览器输入 <code className="font-mono text-foreground">{lanAddress}/</code>。</li>
        </ul>
        <p className="mt-2 text-[10px] text-muted-foreground">提示：如果手机扫码后报"网络错误"，通常是 QR 码里的 IP 跟手机不在同一网段，或电脑防火墙未放行 17890/17891 端口。Windows 首次启动会弹防火墙授权，请允许"专用网络"。</p>
      </div>
    </div>
  );
};

/* =========================================================================
 *  Devices Tab
 * ========================================================================= */

const DevicesTab: React.FC<{
  devices: DeviceEntry[];
  sessions: SessionInfo[];
  onEndSession: (id: string) => void;
}> = ({ devices, sessions, onEndSession }) => {
  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Phone className="h-12 w-12 opacity-30" />
        <p className="text-sm">还没有手机连接</p>
        <p className="text-xs">手机扫码或手动输入地址即可发现本机</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card">
        <header className="border-b px-4 py-2.5 text-sm font-semibold">已连接手机 ({devices.length})</header>
        <ul>
          {devices.map((d) => (
            <li key={d.deviceId} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
              <Phone className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <div className="text-sm font-medium">{d.deviceName}</div>
                <div className="text-[11px] text-muted-foreground">{d.platform} · {d.source === 'pair' ? '已配对' : '已连接'} · {humanTime(d.pairedAt)}</div>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{d.deviceId}</span>
            </li>
          ))}
        </ul>
      </div>
      {sessions.length > 0 && (
        <div className="rounded-lg border bg-card">
          <header className="border-b px-4 py-2.5 text-sm font-semibold">活动会话 ({sessions.length})</header>
          <ul>
            {sessions.map((s) => (
              <li key={s.session_id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <Video className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{s.kind} · {s.phone_device_name}</div>
                  <div className="text-[11px] text-muted-foreground">{s.session_id} · {humanTime(s.created_at_ms)}</div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => onEndSession(s.session_id)}>结束</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/* =========================================================================
 *  Screen Tab
 * ========================================================================= */

const ScreenTab: React.FC<{
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  activeScreen: ScreenSession | null;
  streamStats: { resolution?: string; bitrate?: number; state: RTCPeerConnectionState | 'idle' };
  onStop: () => void;
  state: MyCastState | null;
}> = ({ videoRef, activeScreen, streamStats, onStop, state }) => {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-700">
        <strong>投屏技术预览：</strong>当前 Android 客户端发送前置摄像头视频，用于验证配对、SDP 和 ICE 链路；真实屏幕捕获仍在开发中。
      </div>
      <div className="rounded-lg border bg-black">
        <div className="relative aspect-video">
          <video ref={videoRef} className="h-full w-full" autoPlay playsInline muted />
          {!activeScreen && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
              等待手机发起投屏…
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric label="状态" value={streamStats.state} />
        <Metric label="分辨率" value={streamStats.resolution ?? '—'} />
        <Metric label="码率" value={streamStats.bitrate != null ? `${(streamStats.bitrate / 1000).toFixed(1)} Mbps` : '—'} />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="destructive" disabled={!activeScreen} onClick={onStop}><X className="mr-1 h-4 w-4" />停止</Button>
        <span className="text-xs text-muted-foreground">
          {activeScreen ? `会话 ${activeScreen.sessionId} · 来自 ${activeScreen.phoneDeviceName}` : `手机打开移动端页面（HTTP :${state?.httpPort ?? 17890}），选择「投屏」即可。`}
        </span>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-md border bg-card px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="font-mono text-sm">{value}</div>
  </div>
);

/* =========================================================================
 *  Files Tab
 * ========================================================================= */

const FilesTab: React.FC<{
  transfers: TransferInfo[];
  onCancel: (id: string) => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}> = ({ transfers, onCancel, onOpen, onRefresh }) => {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">
        文件传输走 HTTP，分两块：
        <ul className="ml-4 mt-1 list-disc space-y-0.5">
          <li>手机 → 桌面：手机在浏览器里上传文件，桌面端落地到 <code className="font-mono">%LOCALAPPDATA%/nwd-mycast/</code>（开发态为 <code className="font-mono">./</code>）。</li>
          <li>桌面 → 手机：手机通过 <code className="font-mono">/api/files</code> 列出/下载。Rust sidecar 直接流式读写，UI 在此显示传输进度。</li>
        </ul>
      </div>
      <div className="rounded-lg border bg-card">
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="text-sm font-semibold">传输记录 ({transfers.length})</h3>
          <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </header>
        {transfers.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">还没有传输记录</p>
        ) : (
          <ul>
            {transfers.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
                <FileText className="h-4 w-4 text-primary" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {humanSize(t.received_bytes)} / {humanSize(t.size)} · sha256 {t.sha256 ? t.sha256.slice(0, 10) + '…' : '计算中'} · {humanTime(t.started_at_ms)}
                  </div>
                </div>
                <span className={`pill pill-${t.status}`} style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, background: statusBg(t.status), color: statusFg(t.status) }}>
                  {t.status}
                </span>
                {t.status === 'active' && (
                  <Button size="sm" variant="ghost" onClick={() => onCancel(t.id)}>取消</Button>
                )}
                {t.status === 'completed' && (
                  <Button size="sm" variant="outline" onClick={() => onOpen(t.id)}>打开</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const statusBg = (s: TransferInfo['status']) => {
  switch (s) {
    case 'active': return 'rgba(99,102,241,0.15)';
    case 'completed': return 'rgba(16,185,129,0.15)';
    case 'failed': return 'rgba(239,68,68,0.15)';
    case 'cancelled': return 'rgba(245,158,11,0.15)';
  }
};
const statusFg = (s: TransferInfo['status']) => {
  switch (s) {
    case 'active': return 'rgb(99,102,241)';
    case 'completed': return 'rgb(16,185,129)';
    case 'failed': return 'rgb(239,68,68)';
    case 'cancelled': return 'rgb(245,158,11)';
  }
};

/* =========================================================================
 *  Helpers
 * ========================================================================= */

export function buildMobileUrl(state: MyCastState, pairCode: string): { deepLink: string; httpLink: string } {
  // Prefer the daemon-discovered LAN IP. If for some reason we don't have one
  // (e.g. daemon not yet ready), fall back to bindAddr (which is usually
  // 0.0.0.0 and unroutable — better than nothing for a transient placeholder).
  const host = state.lanAddr
    || (state.bindAddr && state.bindAddr !== '0.0.0.0' ? state.bindAddr : null)
    || (typeof window !== 'undefined' ? window.location.hostname : null)
    || '127.0.0.1';
  const port = state.httpPort ?? 17890;
  // The Rust sidecar serves HTTP and WebSocket on the same Axum listener.
  const wsPort = state.wsPort ?? 17891;
  const deepLink = `mycast://pair?host=${encodeURIComponent(host)}&httpPort=${port}&wsPort=${wsPort}&code=${encodeURIComponent(pairCode)}`;
  const httpLink = `http://${host}:${port}/?pair=${encodeURIComponent(pairCode)}`;
  return { deepLink, httpLink };
}

export function buildHttpMobileUrl(state: MyCastState, pairCode: string): string {
  return buildMobileUrl(state, pairCode).httpLink;
}
