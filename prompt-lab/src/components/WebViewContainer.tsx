import React, { useRef, useCallback, useState, useEffect } from 'react';
import { X, RefreshCw, ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import { VariableFillDialog, extractVariables } from '@/components/VariableFillDialog';
import { SaveConversationPanel } from '@/components/SaveConversationPanel';
import type { Prompt } from '@/store';

// ── 标签栏 ──

const TabBar: React.FC = () => {
  const { tabs, activeTabId, sites, openTab, closeTab, setActiveTab } =
    useStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);

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
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          +
        </Button>
        <div className={`absolute top-full left-0 mt-1 bg-white dark:bg-zinc-800 border rounded-md shadow-lg py-1 z-50 min-w-[120px] ${dropdownOpen ? 'block' : 'hidden group-hover:block'}`}>
          {sites
            .filter((s) => s.enabled)
            .map((site) => (
              <div
                key={site.id}
                className="px-3 py-1.5 text-xs cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                onClick={() => { openTab(site.id); setDropdownOpen(false); }}
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
  const notifyConversationSaved = useStore((s) => s.notifyConversationSaved);

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
  const site = sites.find((s) => s.id === tab?.siteId);

  // ── 对话保存：从 DOM 提取对话内容（按钮触发）──
  const handleSaveConversation = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview || !site) return;

    try {
      const result = await webview.executeJavaScript(`
        (function() {
          // 策略 1：已知选择器
          const knownSelectors = [
            '[data-message-author-role]',
            'article[data-testid^="conversation-turn"]',
          ];
          for (const sel of knownSelectors) {
            const nodes = document.querySelectorAll(sel);
            if (nodes.length > 1) {
              const lines = [];
              for (const el of nodes) {
                const t = el.textContent?.trim();
                if (!t || t.length < 3) continue;
                const role = el.getAttribute('data-message-author-role') || '';
                const isUser = role === 'user';
                lines.push('### ' + (isUser ? '🧑 用户' : '🤖 AI'));
                lines.push('');
                lines.push(t);
                lines.push('');
              }
              return JSON.stringify({ success: true, content: lines.join('\\n'), via: 'known' });
            }
          }

          // 策略 2：寻找对话区域 — 页面中央、可滚动、包含多条文本的容器
          const all = document.body.querySelectorAll('*');
          const vw = window.innerWidth, vh = window.innerHeight;
          let candidates = [];

          for (const el of all) {
            if (el.children.length < 2) continue;
            const rect = el.getBoundingClientRect();
            // 排除侧边栏、顶部导航、底部输入区
            if (rect.width < 300 || rect.height < 200) continue;
            if (rect.left > vw * 0.7 || rect.right < vw * 0.3) continue;
            if (rect.top > vh * 0.6) continue;

            const children = Array.from(el.children);
            const textChildren = children.filter(c => {
              const t = c.textContent?.trim() || '';
              return t.length > 15 && c.children.length > 0;
            });

            if (textChildren.length >= 2) {
              candidates.push({
                el: textChildren,
                count: textChildren.length,
                area: rect.width * rect.height,
                centerDist: Math.abs(rect.left + rect.width/2 - vw/2)
              });
            }
          }

          // 选文本子元素最多且在中央的
          candidates.sort((a, b) => b.count - a.count || a.centerDist - b.centerDist);
          const best = candidates[0];

          if (best && best.count > 1) {
            const lines = [];
            for (const el of best.el) {
              const t = el.textContent?.trim();
              if (!t || t.length < 5) continue;
              const isAI = /(好的|当然|可以|以下是|以下为|根据|我来|这是|Here|Sure|Certainly|Let me|I can)/i.test(t.substring(0, 60));
              lines.push('### ' + (isAI ? '🤖 AI' : '🧑 用户'));
              lines.push('');
              lines.push(t);
              lines.push('');
            }
            if (lines.length > 0) {
              return JSON.stringify({ success: true, content: lines.join('\\n'), via: 'auto' });
            }
          }

          // 策略 3：兜底 — 整个页面可见文本
          const bodyText = document.body.innerText?.trim();
          if (bodyText && bodyText.length > 50) {
            return JSON.stringify({ success: true, content: '# 页面内容\\n\\n' + bodyText, via: 'fallback' });
          }

          return JSON.stringify({ success: false });
        })();
      `);

      const parsed = JSON.parse(result);
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

    const result = await webview.executeJavaScript(`
      (function() {
        const knownSelectors = [
          '[data-message-author-role]',
          'article[data-testid^="conversation-turn"]',
        ];
        for (const sel of knownSelectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes.length > 1) {
            const lines = [];
            for (const el of nodes) {
              const t = el.textContent?.trim();
              if (!t || t.length < 3) continue;
              const role = el.getAttribute('data-message-author-role') || '';
              const isUser = role === 'user';
              lines.push('### ' + (isUser ? '🧑 用户' : '🤖 AI'));
              lines.push('');
              lines.push(t);
              lines.push('');
            }
            return JSON.stringify({ success: true, content: lines.join('\\n'), via: 'known' });
          }
        }

        const all = document.body.querySelectorAll('*');
        const vw = window.innerWidth, vh = window.innerHeight;
        let candidates = [];
        for (const el of all) {
          if (el.children.length < 2) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 300 || rect.height < 200) continue;
          if (rect.left > vw * 0.7 || rect.right < vw * 0.3) continue;
          if (rect.top > vh * 0.6) continue;
          const children = Array.from(el.children);
          const textChildren = children.filter(c => {
            const t = c.textContent?.trim() || '';
            return t.length > 15 && c.children.length > 0;
          });
          if (textChildren.length >= 2) {
            candidates.push({
              el: textChildren,
              count: textChildren.length,
              area: rect.width * rect.height,
              centerDist: Math.abs(rect.left + rect.width/2 - vw/2)
            });
          }
        }
        candidates.sort((a, b) => b.count - a.count || a.centerDist - b.centerDist);
        const best = candidates[0];
        if (best && best.count > 1) {
          const lines = [];
          for (const el of best.el) {
            const t = el.textContent?.trim();
            if (!t || t.length < 5) continue;
            const isAI = /(好的|当然|可以|以下是|以下为|根据|我来|这是|Here|Sure|Certainly|Let me|I can)/i.test(t.substring(0, 60));
            lines.push('### ' + (isAI ? '🤖 AI' : '🧑 用户'));
            lines.push('');
            lines.push(t);
            lines.push('');
          }
          if (lines.length > 0) {
            return JSON.stringify({ success: true, content: lines.join('\\n'), via: 'auto' });
          }
        }

        const bodyText = document.body.innerText?.trim();
        if (bodyText && bodyText.length > 50) {
          return JSON.stringify({ success: true, content: '# 页面内容\\n\\n' + bodyText, via: 'fallback' });
        }
        return JSON.stringify({ success: false });
      })();
    `);

    const parsed = JSON.parse(result);
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
