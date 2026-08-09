import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Circle, Download, Loader2, Monitor, Pause, Play, Square, Video } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { notification } from 'antd';

export type CaptureMode = 'screenshot' | 'recording';

const timeLabel = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const save = (url: string, name: string) => { const link = document.createElement('a'); link.href = url; link.download = name; link.click(); };
const hideCapturePanel = async () => {
  window.dispatchEvent(new CustomEvent('screen-capture:hide'));
  await new Promise((resolve) => window.setTimeout(resolve, 180));
};
const displayStream = (target: 'app' | 'screen', audio: boolean) => {
  window.electronAPI.screenCapture.setTarget(target);
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio });
};

export const ScreenCapturePanel: React.FC<{ initialMode?: CaptureMode }> = ({ initialMode = 'screenshot' }) => {
  const [notice, holder] = notification.useNotification();
  const [mode, setMode] = useState<CaptureMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [target, setTarget] = useState<'app' | 'screen'>('screen');
  const [systemAudio, setSystemAudio] = useState(true);
  const [microphone, setMicrophone] = useState(false);
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const chunks = useRef<Blob[]>([]);

  useEffect(() => { if (!recording) setMode(initialMode); }, [initialMode, recording]);
  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [paused, recording]);
  useEffect(() => {
    const state = { recording, paused, seconds };
    window.electronAPI.screenCapture.setRecordingState(state);
    window.dispatchEvent(new CustomEvent('screen-capture:state', { detail: state }));
  }, [paused, recording, seconds]);
  useEffect(() => () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [imageUrl, videoUrl]);

  const screenshot = useCallback(async () => {
    setBusy(true); let capture: MediaStream | undefined;
    try {
      await hideCapturePanel();
      capture = await displayStream(target, false);
      const preview = document.createElement('video'); preview.srcObject = capture; preview.muted = true; await preview.play();
      const canvas = document.createElement('canvas'); canvas.width = preview.videoWidth; canvas.height = preview.videoHeight;
      canvas.getContext('2d')?.drawImage(preview, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('无法生成截图');
      setImageUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
      notice.success({ message: '截屏完成', description: `${canvas.width} × ${canvas.height} PNG`, placement: 'bottomRight' });
    } catch (error) {
      if (!(error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name))) notice.error({ message: '截屏失败', description: error instanceof Error ? error.message : String(error) });
    } finally { capture?.getTracks().forEach((track) => track.stop()); setBusy(false); }
  }, [notice, target]);

  const stop = useCallback(() => { if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); }, []);
  const start = useCallback(async () => {
    setBusy(true);
    try {
      await hideCapturePanel();
      const display = await displayStream(target, systemAudio);
      let mic: MediaStream | undefined;
      try { if (microphone) mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
      catch (error) { display.getTracks().forEach((track) => track.stop()); throw new Error(`无法使用麦克风：${error instanceof Error ? error.message : String(error)}`); }
      const capture = new MediaStream([...display.getVideoTracks(), ...display.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])]);
      stream.current = capture;
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(MediaRecorder.isTypeSupported);
      const mediaRecorder = new MediaRecorder(capture, mimeType ? { mimeType } : undefined);
      recorder.current = mediaRecorder; chunks.current = []; setSeconds(0); setPaused(false);
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'video/webm' });
        setVideoUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        capture.getTracks().forEach((track) => track.stop()); display.getTracks().forEach((track) => track.stop()); mic?.getTracks().forEach((track) => track.stop()); stream.current = undefined; recorder.current = undefined;
        setRecording(false); setPaused(false); notice.success({ message: '录屏完成', description: '录像可以预览或下载。', placement: 'bottomRight' });
      };
      display.getVideoTracks()[0]?.addEventListener('ended', stop, { once: true });
      mediaRecorder.start(1000); setRecording(true);
    } catch (error) {
      if (!(error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name))) notice.error({ message: '无法开始录屏', description: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }, [microphone, notice, stop, systemAudio, target]);

  const pause = () => {
    if (recorder.current?.state === 'recording') { recorder.current.pause(); setPaused(true); }
    else if (recorder.current?.state === 'paused') { recorder.current.resume(); setPaused(false); }
  };
  const url = mode === 'screenshot' ? imageUrl : videoUrl;
  return <div className="flex h-full flex-col bg-background">{holder}
    <header className="flex h-14 items-center gap-3 border-b px-5"><Monitor className="h-5 w-5 text-primary" /><div><h2 className="text-sm font-semibold">{mode === 'screenshot' ? '截取屏幕' : recording ? '正在录屏' : '录制屏幕'}</h2><p className="text-[11px] text-muted-foreground">{mode === 'screenshot' ? '设置捕获范围，截屏时窗口会自动隐藏' : '设置捕获范围和声音，开始后窗口会自动隐藏'}</p></div></header>
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto p-6">
      <div className="flex flex-wrap items-center justify-center gap-4 rounded-lg border bg-card px-4 py-2 text-xs"><span className="font-medium">捕获范围</span><label className="flex items-center gap-1.5"><input type="radio" checked={target === 'screen'} disabled={recording} onChange={() => setTarget('screen')} />整个屏幕</label><label className="flex items-center gap-1.5"><input type="radio" checked={target === 'app'} disabled={recording} onChange={() => setTarget('app')} />当前应用</label>{mode === 'recording' && <><span className="mx-1 h-4 w-px bg-border" /><label className="flex items-center gap-1.5"><input type="checkbox" checked={systemAudio} disabled={recording} onChange={(event) => setSystemAudio(event.target.checked)} />系统声音</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={microphone} disabled={recording} onChange={(event) => setMicrophone(event.target.checked)} />麦克风</label></>}</div>
      {url ? mode === 'screenshot' ? <img src={url} className="max-h-[calc(100vh-300px)] max-w-full rounded-lg border bg-black object-contain shadow-lg" alt="屏幕截图" /> : <video src={url} controls className="max-h-[calc(100vh-300px)] max-w-full rounded-lg border bg-black shadow-lg" /> : <div className="flex min-h-64 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 text-muted-foreground"><Monitor className="mb-4 h-16 w-16 opacity-20" /><p className="text-sm">准备{mode === 'screenshot' ? '截取' : '录制'}{target === 'screen' ? '整个屏幕' : '当前应用'}</p><p className="mt-1 text-xs">开始前请确认捕获范围和声音选项</p></div>}
      <div className="flex items-center gap-3">{mode === 'screenshot' ? <Button disabled={busy || recording} onClick={() => void screenshot()}>{busy ? <Loader2 className="mr-2 h-4 w-4" /> : <Camera className="mr-2 h-4 w-4" />}截取屏幕</Button> : recording ? <><span className="flex gap-2 rounded-md border px-3 py-2 font-mono text-sm"><Circle className="h-3 w-3 fill-red-500 text-red-500" />{timeLabel(seconds)}</span><Button variant="outline" onClick={pause}>{paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}{paused ? '继续' : '暂停'}</Button><Button variant="destructive" onClick={stop}><Square className="mr-2 h-4 w-4 fill-current" />停止录制</Button></> : <Button disabled={busy} onClick={() => void start()}>{busy ? <Loader2 className="mr-2 h-4 w-4" /> : <Video className="mr-2 h-4 w-4" />}开始录屏</Button>}{url && !recording && <Button variant="outline" onClick={() => save(url, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.${mode === 'screenshot' ? 'png' : 'webm'}`)}><Download className="mr-2 h-4 w-4" />下载</Button>}</div>
    </main></div>;
};
