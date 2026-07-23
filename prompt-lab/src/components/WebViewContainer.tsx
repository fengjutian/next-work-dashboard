import React, { useRef, useCallback, useState, useEffect } from 'react';
import { X, RefreshCw, ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import { VariableFillDialog, extractVariables } from '@/components/VariableFillDialog';
import type { Prompt } from '@/store';

// ── 标签栏 ──

const TabBar: React.FC = () => {
  const { tabs, activeTabId, sites, openTab, closeTab, setActiveTab } =
    useStore();

  return (
    <div className="h-9 flex items-center bg-zinc-100 dark:bg-zinc-900 border-b gap-0.5 px-1 overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex items-center gap-1 px-3 py-1 text-xs rounded-t-md cursor-pointer select-none whitespace-nowrap border-b-2 transition-colors ${
            activeTabId === tab.id
              ? 'bg-white dark:bg-zinc-950 border-blue-500 text-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span>{tab.title}</span>
          <button
            className="ml-0.5 p-0.2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {/* 新建标签下拉 */}
      <div className="relative group">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-zinc-400 hover:text-zinc-600"
        >
          +
        </Button>
        <div className="absolute top-full left-0 mt-1 hidden group-hover:block bg-white dark:bg-zinc-800 border rounded-md shadow-lg py-1 z-50 min-w-[120px]">
          {sites
            .filter((s) => s.enabled)
            .map((site) => (
              <div
                key={site.id}
                className="px-3 py-1.5 text-xs cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                onClick={() => openTab(site.id)}
              >
                {site.name}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

// ── WebView 容器 ──

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          style?: React.CSSProperties;
          ref?: React.Ref<Electron.WebviewTag>;
        },
        HTMLElement
      >;
    }
  }
  interface HTMLElementTagNameMap {
    webview: Electron.WebviewTag;
  }
}

const WebViewPanel: React.FC<{ tabId: string }> = ({ tabId }) => {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId));
  const injectMode = useStore((s) => s.injectMode);
  const injectStrategy = useStore((s) => s.injectStrategy);
  const setLastInjectResult = useStore((s) => s.setLastInjectResult);
  const selectedPromptId = useStore((s) => s.selectedPromptId);
  const selectPrompt = useStore((s) => s.selectPrompt);
  const incrementUsage = useStore((s) => s.incrementUsage);
  const recordInject = useStore((s) => s.recordInject);
  const pendingInjection = useStore((s) => s.pendingInjection);
  const clearInjection = useStore((s) => s.clearInjection);
  const { toast } = useToast();
  const prompts = useStore((s) => s.prompts);
  const sites = useStore((s) => s.sites);
  // webview preload 路径（由 main 进程在页面加载前注入，同步可用）
  const preloadPath = (window as any).__WEBVIEW_PRELOAD_PATH__ || '';

  // ── 网络拦截：在 webview 页面中注入 fetch hook ──
  const injectInterceptor = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    // 先注入诊断 ping，验证 executeJavaScript + console-message 通道
    webview.executeJavaScript(`console.log('__PL_PING__:' + location.href)`).catch(() => {});

    // 注入 fetch + XHR hook — 嗅探所有网络请求
    webview.executeJavaScript(`
      (function() {
        if (window.__promptlab_injected__) return;
        window.__promptlab_injected__ = true;

        const TAG = '__PL_CAPTURE__:';
        const SNIFF = '__PL_SNIFF__:';
        console.log('__PL_HOOK__:installed');

        function guessSite(url) {
          if (url.includes('chat.deepseek.com')) return 'deepseek';
          if (url.includes('chatgpt.com')) return 'chatgpt';
          if (url.includes('kimi.moonshot.cn')) return 'kimi';
          if (url.includes('tongyi.aliyun.com')) return 'tongyi';
          return null;
        }

        function parseSSE(text) {
          const lines = text.split('\\n');
          let content = '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            try {
              const d = JSON.parse(jsonStr);
              const delta = d?.choices?.[0]?.delta?.content;
              if (delta) content += delta;
            } catch(e) {}
          }
          return content;
        }

        const origFetch = window.fetch.bind(window);

        window.fetch = async function(input, init) {
          const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
          const site = guessSite(url);

          // 嗅探：打印所有 AI 站点的 API 请求 URL（用于诊断）
          if (site) {
            console.log(SNIFF + JSON.stringify({ site, url, ct: init?.headers?.['content-type'] || 'none' }));
          }

          if (!site) return origFetch(input, init);

          let requestBody = null;
          if (init?.body) {
            try { requestBody = JSON.parse(init.body); } catch(e) { requestBody = init.body; }
          }

          const response = await origFetch(input, init);
          const ct = response.headers.get('content-type') || '';

          if (!ct.includes('text/event-stream') && !ct.includes('application/json')) {
            return response;
          }

          const cloned = response.clone();
          const body = cloned.body;
          if (!body) return response;

          const reader = body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullContent = '';

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\\n\\n');
                buffer = parts.pop() || '';
                for (const part of parts) {
                  const chunk = parseSSE(part + '\\n\\n');
                  if (chunk) fullContent += chunk;
                }
              }
              if (buffer.trim()) {
                const chunk = parseSSE(buffer);
                if (chunk) fullContent += chunk;
              }
              if (fullContent) {
                console.log(TAG + JSON.stringify({
                  site: site,
                  timestamp: Date.now(),
                  requestBody: requestBody,
                  responseContent: fullContent
                }));
              }
            } catch(e) {}
          })();

          return response;
        };

        // ── Hook XMLHttpRequest ──
        const OrigXHR = window.XMLHttpRequest;

        // ── Hook EventSource ──
        const OrigES = window.EventSource;
        window.EventSource = function(url, config) {
          const site = guessSite(url.toString());
          if (site) console.log(SNIFF + JSON.stringify({ via: 'eventsource', site, url: url.toString() }));
          return new OrigES(url, config);
        };

        // ── Hook XMLHttpRequest ──
        window.XMLHttpRequest = function() {
          const xhr = new OrigXHR();
          const origOpen = xhr.open;
          let _url = '', _method = '';
          xhr.open = function(method, url) {
            _url = url.toString();
            _method = method;
            return origOpen.apply(xhr, arguments);
          };
          const origSend = xhr.send;
          xhr.send = function(body) {
            const site = guessSite(_url);
            if (site) {
              console.log(SNIFF + JSON.stringify({ via: 'xhr', site, method: _method, url: _url }));
              xhr.addEventListener('load', function() {
                if (xhr.responseText && xhr.responseText.startsWith('data:')) {
                  // SSE via XHR — parse it
                  const lines = xhr.responseText.split('\\n');
                  let content = '';
                  for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') continue;
                    try { const d = JSON.parse(jsonStr); const delta = d?.choices?.[0]?.delta?.content; if (delta) content += delta; } catch(e) {}
                  }
                  if (content) {
                    console.log(TAG + JSON.stringify({ site, timestamp: Date.now(), requestBody: body, responseContent: content }));
                  }
                }
              });
            }
            return origSend.apply(xhr, arguments);
          };
          return xhr;
        };
      })();
    `).catch(() => {});
  }, []);

  // dom-ready 时：设置 UA + 注入拦截器
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onDomReady = () => {
      // 设置真实 Chrome User-Agent，避免被网站检测为 Electron
      try {
        webview.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        );
      } catch {}
      injectInterceptor();
    };
    webview.addEventListener('dom-ready', onDomReady);

    // 开发模式：自动打开 webview 的 DevTools 方便诊断（仅首次）
    const openDevTools = () => {
      try { webview.openDevTools(); } catch {}
      webview.removeEventListener('dom-ready', openDevTools);
    };
    webview.addEventListener('dom-ready', openDevTools);
    return () => { webview.removeEventListener('dom-ready', onDomReady); };
  }, [tab?.siteId, injectInterceptor]);

  // 监听 console-message 捕获对话数据 — 同时接收诊断 ping
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onConsole = (event: Electron.ConsoleMessageEvent) => {
      const msg = event.message;
      // 诊断 ping
      if (msg.startsWith('__PL_PING__:')) {
        console.log('[PromptLab] Pipeline OK, page:', msg.slice(14));
        return;
      }
      // URL 嗅探
      if (msg.startsWith('__PL_SNIFF__:')) {
        console.log('[PromptLab] API call:', msg.slice(15));
        return;
      }
      // Hook 安装确认
      if (msg.startsWith('__PL_HOOK__:')) {
        console.log('[PromptLab]', msg);
        return;
      }
      // 对话捕获
      if (msg.startsWith('__PL_CAPTURE__:')) {
        try {
          const data = JSON.parse(msg.slice(17));
          if (data?.responseContent) {
            console.log('[PromptLab] Captured AI response from:', data.site);
            (window as any).electronAPI?.saveConversation?.({
              site: data.site || 'unknown',
              timestamp: data.timestamp || Date.now(),
              requestBody: data.requestBody,
              responseContent: data.responseContent,
            });
          }
        } catch { console.log('[PromptLab] Parse error for capture msg'); }
      }
    };

    webview.addEventListener('console-message', onConsole);
    return () => { webview.removeEventListener('console-message', onConsole); };
  }, [tab?.siteId]);

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
  const site = sites.find((s) => s.id === tab?.siteId);
  const [variableDialogOpen, setVariableDialogOpen] = useState(false);

  const doInject = useCallback((finalText: string) => {
    if (!webviewRef.current || !selectedPrompt || !site) return;

    const webview = webviewRef.current;
    const autoSubmit = injectMode === 'fill-and-submit';

    const script = `
      (function() {
        const input = document.querySelector('${site.inputSelector}');
        if (!input) return JSON.stringify({ success: false, error: 'INPUT_NOT_FOUND' });

        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value'
        )?.set;

        const safeText = ${JSON.stringify(finalText)};
        ${injectStrategy === 'append' ? 'const appendMode = true;' : 'const appendMode = false;'}

        if (nativeSetter) {
          nativeSetter.call(input, appendMode ? (input.value + safeText) : safeText);
        } else {
          input.value = appendMode ? (input.value + safeText) : safeText;
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        ${
          autoSubmit && site.submitSelector
            ? `setTimeout(() => {
                 const btn = document.querySelector('${site.submitSelector}');
                 if (btn) btn.click();
               }, 200);`
            : ''
        }

        return JSON.stringify({ success: true });
      })();
    `;

    webview
      .executeJavaScript(script)
      .then((result: string) => {
        const parsed = JSON.parse(result);
        setLastInjectResult(parsed);
        if (parsed.success) {
          incrementUsage(selectedPrompt.id);
          recordInject(selectedPrompt.id, site.id);
          toast('注入成功', 'success');
        } else {
          toast(parsed.error === 'INPUT_NOT_FOUND' ? '未找到输入框，请检查 CSS 选择器' : `注入失败: ${parsed.error}`, 'error');
        }
      })
      .catch((err: Error) => {
        setLastInjectResult({ success: false, error: err.message });
        toast(`注入失败: ${err.message}`, 'error');
      });
  }, [selectedPrompt, site, injectMode, injectStrategy, setLastInjectResult, incrementUsage, recordInject, toast]);

  const handleInject = useCallback(() => {
    if (!selectedPrompt) return;
    const vars = extractVariables(selectedPrompt.content);
    if (vars.length > 0) {
      setVariableDialogOpen(true);
    } else {
      doInject(selectedPrompt.content);
    }
  }, [selectedPrompt, doInject]);

  // 监听来自 CommandPalette 的注入信号
  useEffect(() => {
    if (!pendingInjection || !tab) return;
    if (pendingInjection.siteId !== tab.siteId) return;

    const prompt = prompts.find((p) => p.id === pendingInjection.promptId);
    if (!prompt) return clearInjection();

    selectPrompt(prompt.id);
    const vars = extractVariables(prompt.content);
    if (vars.length > 0) {
      setVariableDialogOpen(true);
    } else {
      doInject(prompt.content);
    }
    clearInjection();
  }, [pendingInjection, tab, prompts, doInject, clearInjection]);

  if (!tab) return null;

  return (
    <div className="flex-1 flex flex-col relative">
      {/* 导航栏 */}
      <div className="h-8 flex items-center px-2 gap-1 bg-zinc-50 dark:bg-zinc-900 border-b">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => webviewRef.current?.reload()}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>

        <div className="flex-1 text-xs text-zinc-400 truncate px-2">
          {tab.url}
        </div>

        {/* 注入按钮 */}
        {selectedPrompt && site && (
          <Button
            size="sm"
            className="h-6 text-xs gap-1 bg-blue-600 hover:bg-blue-700"
            onClick={handleInject}
          >
            <Send className="h-3 w-3" />
            注入「{selectedPrompt.title}」
          </Button>
        )}
      </div>

      {/* WebView */}
      <webview
        ref={webviewRef}
        src={tab.url}
        partition={`persist:site-${tab.siteId}`}
        preload={preloadPath || undefined}
        style={{ flex: 1 }}
        // @ts-expect-error webview-specific attribute
        allowpopups="true"
      />

      {/* 变量填充对话框 */}
      {variableDialogOpen && selectedPrompt && (
        <VariableFillDialog
          content={selectedPrompt.content}
          variables={selectedPrompt.variables}
          onConfirm={(filled) => {
            setVariableDialogOpen(false);
            doInject(filled);
          }}
          onCancel={() => setVariableDialogOpen(false)}
        />
      )}
    </div>
  );
};

// ── 导出 ──

export function WebViewContainer() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);

  if (tabs.length === 0) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TabBar />
      <div className="flex-1 flex relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex-1 absolute inset-0"
            style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
          >
            <WebViewPanel tabId={tab.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
