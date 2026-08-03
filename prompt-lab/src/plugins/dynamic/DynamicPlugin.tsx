import React from 'react';
import { PluginSandbox } from '../sandbox';
import type { PluginPermission } from '../sandbox/types';
import * as XLSX from 'xlsx';
import { useStore } from '@/store';
import { transform as babelTransform } from '@babel/standalone';

/**
 * DynamicPlugin — 用户自定义插件的通用渲染组件。
 *
 * 支持三种模式：
 *  1. 旧版 content 模式（向后兼容）：渲染 Markdown 文本
 *  2. 新版 script 模式：通过 PluginSandbox 运行用户脚本
 *  3. 新版 kernel 模式：直接加载预编译的 React 组件
 *
 * 优先级：kernel > script > content
 */
interface DynamicPluginProps {
  pluginName: string;
  /** 旧版：Markdown 内容（向后兼容） */
  content?: string;
  /** 新版：JavaScript 脚本（sandbox） */
  script?: string;
  /** 新版：自定义 CSS */
  style?: string;
  /** 新版：插件 ID（用于存储隔离） */
  pluginId?: string;
  /** 新版：权限声明（默认最小权限） */
  permissions?: PluginPermission[];
  /**
   * 内核模式：预编译的 JS 源码（IIFE/UMD），执行后导出 default React 组件。
   * 当此字段非空时，插件会直接注入 React 树而非 iframe 沙箱。
   */
  bundle?: string;
}

/**
 * 内核插件加载器 — 动态执行 bundle 代码并渲染其导出的 React 组件。
 * 使用 React Error Boundary 提供完整的错误保护（含 hooks 异常）。
 */
class KernelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: Error) {
    return { error: `渲染错误: ${e.message ?? String(e)}` };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4">
          <div className="p-4 rounded-lg border border-destructive bg-destructive/10 bg-destructive/10 border-destructive">
            <h3 className="text-sm font-semibold text-destructive text-destructive">
              内核插件渲染异常
            </h3>
            <pre className="text-xs text-destructive mt-2 whitespace-pre-wrap">
              {this.state.error}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const KernelPluginLoader: React.FC<{ bundle: string; pluginId: string }> = ({
  bundle,
  pluginId,
}) => {
  const [Component, setComponent] = React.useState<React.FC | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      // 先编译 JSX/TSX → 纯 JS（如果代码包含 JSX 语法）
      let code = bundle;
      if (/<[A-Z]\w*|<\/[A-Z]\w*|className\s*[=:]|React\.createElement/.test(bundle)) {
        // 代码看起来包含 JSX 或已是纯 JS createElement — 尝试 Babel 转换
        try {
          const result = babelTransform(bundle, {
            presets: ['react'],
            filename: `kernel-${pluginId}.tsx`,
          });
          code = result.code ?? bundle;
        } catch {
          // Babel 转换失败（可能是已编译的代码或纯 JS），使用原始代码
          code = bundle;
        }
      }

      // 执行 bundle 代码 — IIFE/UMD，通过参数注入依赖
      const exports: any = {};
      const module = { exports };
      const require = (name: string) => {
        if (name === 'react') return React;
        if (name === 'xlsx') return XLSX;
        if (name === '@/store') return { useStore };
        throw new Error(`内核插件不支持 import "${name}"`);
      };

      // 注入全局变量供 bundle 使用
      const rawAPI = (window as any).electronAPI ?? {};
      // 包装 pickFile/saveFile — 未构建时给出友好提示
      const electronAPI = new Proxy(rawAPI, {
        get(target, prop) {
          if ((prop === 'pickFile' || prop === 'saveFile') && !(prop in target)) {
            return async () => {
              throw new Error(
                `electronAPI.${String(prop)} 不可用。请重新构建 Electron 应用（npm run build）使 preload 改动生效。`,
              );
            };
          }
          return target[prop];
        },
      });

      // 便捷注入函数 — 对齐沙箱 PluginSDK.actions.injectPrompt
      const callElectronApi = (method: 'pickFile' | 'saveFile' | 'copyText', ...args: unknown[]) => {
        const fn = electronAPI[method];
        if (typeof fn !== 'function') {
          throw new Error(`electronAPI.${method} 不可用，请重新构建 Electron 应用使 preload 改动生效。`);
        }
        return fn(...args);
      };
      const kernelElectronAPI = Object.freeze({
        pickFile: (...args: unknown[]) => callElectronApi('pickFile', ...args),
        saveFile: (...args: unknown[]) => callElectronApi('saveFile', ...args),
        copyText: (...args: unknown[]) => callElectronApi('copyText', ...args),
      });

      const injectToAI = async (siteId: string, text: string, autoSubmit = false) => {
        const store = useStore.getState();
        const site = store.sites.find((s: any) => s.id === siteId);
        if (!site) throw new Error(`站点 "${siteId}" 不存在`);
        const tab = store.tabs.find((t: any) => t.siteId === siteId);
        if (!tab) throw new Error(`请先打开站点 "${siteId}" 的标签页`);
        if (!rawAPI?.injectPrompt) throw new Error('electronAPI.injectPrompt 不可用');

        await rawAPI.injectPrompt({
          webviewId: parseInt(String(tab.id).replace(/\D/g, ''), 10) || 0,
          text,
          inputSelector: site.inputSelector,
          submitSelector: site.submitSelector || undefined,
          autoSubmit,
        });
        store.recordInject?.('plugin:' + pluginId, siteId);
      };

      const globals = {
        React,
        XLSX,
        useStore,
        electronAPI: kernelElectronAPI,
        injectToAI,
      };

      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'exports', 'module', 'require',
        'React', 'XLSX', 'useStore', 'electronAPI', 'injectToAI',
        `//# sourceURL=kernel-${pluginId}.js\n${code}`,
      );
      fn(
        exports, module, require,
        globals.React, globals.XLSX, globals.useStore, globals.electronAPI, globals.injectToAI,
      );

      // 取导出的组件
      const Comp = module.exports?.default
        || module.exports
        || (window as any)[`__kernel_plugin_${pluginId}__`];

      if (typeof Comp === 'function') {
        setComponent(() => Comp);
      } else {
        setError('bundle 未导出 default React 组件。请确保 bundle 末尾有 return 或 module.exports = ...');
      }
    } catch (e: any) {
      setError(`加载失败: ${e.message ?? String(e)}`);
    }
  }, [bundle, pluginId]);

  if (error) {
    return (
      <div className="flex flex-col h-full bg-card">
        <div className="p-4">
          <div className="p-4 rounded-lg border border-destructive bg-destructive/10 bg-destructive/10 border-destructive">
            <h3 className="text-sm font-semibold text-destructive text-destructive">内核插件加载失败</h3>
            <pre className="text-xs text-destructive mt-2 whitespace-pre-wrap">{error}</pre>
          </div>
        </div>
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="flex items-center justify-center h-full bg-card">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <KernelErrorBoundary>
      <Component />
    </KernelErrorBoundary>
  );
};

export const DynamicPlugin: React.FC<DynamicPluginProps> = ({
  pluginName,
  content,
  script,
  style,
  pluginId,
  permissions = [],
  bundle,
}) => {
  // ── 内核模式：直接注入 React 树 ──
  if (bundle) {
    return (
      <KernelPluginLoader bundle={bundle} pluginId={pluginId ?? pluginName} />
    );
  }

  // ── 沙箱模式：iframe ──
  if (script) {
    return (
      <PluginSandbox
        pluginId={pluginId ?? pluginName}
        script={script}
        style={style}
        permissions={permissions}
      />
    );
  }

  // ── 旧版：静态 Markdown 渲染 ──
  return (
    <div className="flex flex-col h-full bg-card">
      {/* 头部 */}
      <div className="px-4 py-3 border-b">
        <h2 className="font-semibold text-sm text-foreground">
          {pluginName}
        </h2>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {content ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br/>')
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline">$1</a>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>'),
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground text-center py-16">
            空白插件 — 可在插件管理中编辑内容
          </p>
        )}
      </div>
    </div>
  );
};
