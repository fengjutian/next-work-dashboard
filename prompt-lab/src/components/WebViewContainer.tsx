import React, { useRef, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, ArrowLeft, ArrowRight, Send } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import { VariableFillDialog } from '@/components/VariableFillDialog';
import { SaveConversationPanel } from '@/components/SaveConversationPanel';
import {
  extractVariables,
  buildInjectionScript,
  buildConversationExtractScript,
  parseExtractResult,
} from '@/core';
import type { Prompt } from '@/store';

// ── 标签栏 ──

const TabBar: React.FC = () => {
  const { tabs, activeTabId, sites, openTab, closeTab, setActiveTab } =
    useStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleToggle = () => {
    if (!dropdownOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    setDropdownOpen(!dropdownOpen);
  };

  const handleOpenTab = (siteId: string) => {
    openTab(siteId);
    setDropdownOpen(false);
  };

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
      <Button
        ref={btnRef}
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-zinc-400 hover:text-zinc-600"
        onClick={handleToggle}
      >
        +
      </Button>
      {dropdownOpen &&
        createPortal(
          <>
            {/* 点击外部关闭 */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setDropdownOpen(false)}
            />
            <div
              className="fixed z-50 bg-white dark:bg-zinc-800 border rounded-md shadow-lg py-1 min-w-[120px]"
              style={{ top: dropdownPos.top, left: dropdownPos.left }}
            >
              {sites
                .filter((s) => s.enabled)
                .map((site) => (
                  <div
                    key={site.id}
                    className="px-3 py-1.5 text-xs cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                    onClick={() => handleOpenTab(site.id)}
                  >
                    {site.name}
                  </div>
                ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};

// ── WebView 容器 ──

declare global {
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
  const notifyConversationSaved = useStore((s) => s.notifyConversationSaved);

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
  const site = sites.find((s) => s.id === tab?.siteId);

  // ── 对话保存：从 DOM 提取对话内容（按钮触发）──
  const handleSaveConversation = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview || !site) return;

    try {
      const result = await webview.executeJavaScript(buildConversationExtractScript());
      const parsed = parseExtractResult(result);
      if (parsed.success && parsed.content) {
        const saveResult = await (window as any).electronAPI?.saveConversation?.({
          site: site.id,
          timestamp: Date.now(),
          requestBody: { note: 'DOM extraction' },
          responseContent: parsed.content,
        });
        if (saveResult?.success) {
          toast('对话已保存', 'success');
          notifyConversationSaved();
        } else {
          toast('保存失败: ' + (saveResult?.error || '未知错误'), 'error');
        }
      } else {
        toast('未找到对话内容', 'error');
      }
    } catch {
      toast('保存失败', 'error');
    }
  }, [site, toast, notifyConversationSaved]);

  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [variableDialogOpen, setVariableDialogOpen] = useState(false);

  // ── 标注保存侧边栏 ──
  // 提取对话内容的回调：由面板中的「从页面提取」按钮触发
  const handleExtractContent = useCallback(async (): Promise<string> => {
    const webview = webviewRef.current;
    if (!webview) throw new Error('webview not ready');

    const result = await webview.executeJavaScript(buildConversationExtractScript());
    const parsed = parseExtractResult(result);
    if (parsed.success && parsed.content) {
      return parsed.content;
    }
    throw new Error('未找到对话内容');
  }, []);

  // 面板保存：用户自行填写标题、备注、内容
  const handleSaveWithInfo = useCallback(async (title: string, notes: string, content: string) => {
    setSavePanelOpen(false);
    console.log('[WebViewPanel] handleSaveWithInfo called, title:', title, 'site:', site?.id);
    try {
      const api = (window as any).electronAPI;
      if (!api?.saveConversation) {
        console.error('[WebViewPanel] electronAPI.saveConversation not available!');
        toast('保存失败: API 不可用', 'error');
        return;
      }
      const saveResult = await api.saveConversation({
        site: site?.id,
        timestamp: Date.now(),
        requestBody: { note: 'user-saved' },
        responseContent: content,
        title,
        notes: notes || undefined,
        createNew: true,
      });
      console.log('[WebViewPanel] saveResult:', saveResult);
      if (saveResult?.success) {
        toast('对话已保存', 'success');
        notifyConversationSaved();
      } else {
        toast('保存失败: ' + (saveResult?.error || '未知错误'), 'error');
      }
    } catch (err) {
      console.error('[WebViewPanel] save failed:', err);
      toast('保存失败', 'error');
    }
  }, [site, toast, notifyConversationSaved]);

  const doInject = useCallback((finalText: string) => {
    if (!webviewRef.current || !selectedPrompt || !site) return;

    const webview = webviewRef.current;
    const script = buildInjectionScript({
      site,
      text: finalText,
      mode: injectMode,
      strategy: injectStrategy,
    });

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

        {/* 保存对话按钮 */}
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs gap-1"
          onClick={handleSaveConversation}
          title="快速保存当前对话"
        >
          保存
        </Button>

        {/* 标注保存按钮 */}
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs gap-1 border-dashed"
          onClick={() => setSavePanelOpen(true)}
          title="打开侧边栏填写对话信息后保存"
        >
          📝 标注保存
        </Button>

        {/* 注入按钮 */}
        {selectedPrompt && site && (
          <Button
            size="sm"
            className="h-6 text-xs gap-1 bg-blue-600 hover:bg-blue-700 ml-1"
            onClick={handleInject}
          >
            <Send className="h-3 w-3" />
            注入「{selectedPrompt.title}」
          </Button>
        )}
      </div>

      {/* WebView + 侧边栏 */}
      <div className="flex-1 flex overflow-hidden">
        <webview
          ref={webviewRef}
          src={tab.url}
          partition={`persist:site-${tab.siteId}`}
          preload={(window as any).__WEBVIEW_PRELOAD_PATH__ ?? ''}
          useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
          style={{ flex: 1 }}
          // @ts-expect-error webview-specific attribute
          allowpopups="true"
        />

        <SaveConversationPanel
          open={savePanelOpen}
          onExtract={handleExtractContent}
          onSave={handleSaveWithInfo}
          onClose={() => setSavePanelOpen(false)}
        />
      </div>

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
