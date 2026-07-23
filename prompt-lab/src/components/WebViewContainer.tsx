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
