import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Languages, Loader2, RefreshCw } from '@/components/icons';
import { Button } from '@/components/ui/button';

const HOME_URL = 'https://www.lingohut.com/zh';

export const LingoHutPanel: React.FC = () => {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUrl, setCurrentUrl] = useState(HOME_URL);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const updateNavigation = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    setCanGoBack(webview.canGoBack()); setCanGoForward(webview.canGoForward());
    const url = webview.getURL(); if (url) setCurrentUrl(url);
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const started = () => { setLoading(true); setError(''); };
    const stopped = () => { setLoading(false); updateNavigation(); };
    const navigated = () => updateNavigation();
    const failed = (event: Electron.DidFailLoadEvent) => {
      if (event.errorCode === -3) return;
      setLoading(false); setError(`页面加载失败（${event.errorCode}）：${event.errorDescription}`);
    };
    webview.addEventListener('did-start-loading', started);
    webview.addEventListener('did-stop-loading', stopped);
    webview.addEventListener('did-navigate', navigated);
    webview.addEventListener('did-navigate-in-page', navigated);
    webview.addEventListener('did-fail-load', failed);
    return () => {
      webview.removeEventListener('did-start-loading', started); webview.removeEventListener('did-stop-loading', stopped);
      webview.removeEventListener('did-navigate', navigated); webview.removeEventListener('did-navigate-in-page', navigated);
      webview.removeEventListener('did-fail-load', failed);
    };
  }, [updateNavigation]);

  return <div className="flex h-full min-h-0 flex-col bg-card">
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2">
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canGoBack} title="后退" onClick={() => webviewRef.current?.goBack()}><ArrowLeft className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canGoForward} title="前进" onClick={() => webviewRef.current?.goForward()}><ArrowRight className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="刷新" onClick={() => webviewRef.current?.reload()}><RefreshCw className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="返回 LingoHut 中文首页" onClick={() => webviewRef.current?.loadURL(HOME_URL)}><Languages className="h-3.5 w-3.5" /></Button>
      <div className="mx-2 flex min-w-0 flex-1 items-center gap-2"><Languages className="h-4 w-4 shrink-0 text-primary" /><span className="truncate text-xs font-medium">LingoHut 语言学习</span><span className="hidden truncate text-[10px] text-muted-foreground md:block">{currentUrl}</span></div>
      {loading && <Loader2 className="mr-1 h-3.5 w-3.5 text-primary" />}
      <Button variant="ghost" size="icon" className="h-7 w-7" title="在系统浏览器打开" onClick={() => void window.electronAPI.shell.openExternal(currentUrl)}><ExternalLink className="h-3.5 w-3.5" /></Button>
    </div>
    <div className="relative min-h-0 flex-1">
      {error && <div role="alert" className="absolute inset-x-4 top-4 z-20 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-background p-3 text-sm text-destructive shadow-lg"><span>{error}</span><Button variant="outline" size="sm" onClick={() => webviewRef.current?.reload()}>重试</Button></div>}
      <webview ref={webviewRef} src={HOME_URL} partition="persist:lingohut" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  </div>;
};
