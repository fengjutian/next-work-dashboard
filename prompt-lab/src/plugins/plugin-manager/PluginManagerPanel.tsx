import React from 'react';
import { Puzzle, Plus, X, Blocks, Trash2, Code, ShieldCheck, Download, Upload } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { DynamicPlugin } from '../dynamic';
import { isDbReady, dbSetSetting } from '@/db';
import type { Plugin } from '../types';
import type { PluginPermission, PluginManifest, PluginConfigDeclaration } from '../sandbox/types';

// ── localStorage 持久化 ──

const STORAGE_KEY = 'plugin-manager-user-plugins';

interface UserPluginDef {
  id: string;
  name: string;
  content: string;
  /** 新版：JavaScript 脚本 */
  script?: string;
  /** 新版：自定义 CSS */
  style?: string;
  /** 新版：权限声明 */
  permissions?: PluginPermission[];
  /** 新版：emoji 图标 */
  iconEmoji?: string;
  /** 新版：插件清单（.nwd 格式） */
  manifest?: PluginManifest;
  /** 内核模式：预编译的 JS 源码 */
  bundle?: string;
}

function loadUserPlugins(): UserPluginDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserPlugins(defs: UserPluginDef[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defs));
}

/** 重新注册所有用户插件（启动时调用，幂等） */
function rehydrateUserPlugins(): void {
  const defs = loadUserPlugins();
  const nextOrder = pluginRegistry.getAll().length;
  defs.forEach((def, i) => {
    // 跳过已注册的（幂等）
    if (pluginRegistry.get(def.id)) return;
    const BoundPlugin: React.FC = () => (
      <DynamicPlugin
        pluginName={def.name}
        content={def.content}
        script={def.script}
        style={def.style}
        pluginId={def.id}
        permissions={def.permissions}
        bundle={def.bundle}
      />
    );
    // 从 manifest 中提取贡献声明
    const commands = def.manifest?.config
      ? def.manifest.config.map((c) => ({
          id: `${def.id}.setConfig.${c.key}`,
          title: `设置 ${c.label ?? c.key}`,
          category: def.name,
        }))
      : undefined;
    pluginRegistry.register({
      id: def.id,
      name: def.name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: true,
      order: nextOrder + i,
      contributions: {
        commands,
      },
    });
  });
}

// ── 新建插件弹层 ──

interface CreatePluginDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const CreatePluginDialog: React.FC<CreatePluginDialogProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const [formName, setFormName] = React.useState('');
  const [formId, setFormId] = React.useState('');
  const [formContent, setFormContent] = React.useState('');
  const [formScript, setFormScript] = React.useState('');
  const [formStyle, setFormStyle] = React.useState('');
  const [formPermissions, setFormPermissions] = React.useState<PluginPermission[]>([]);
  const [activeTab, setActiveTab] = React.useState<'basic' | 'advanced' | 'kernel'>('basic');
  // 清单字段
  const [formVersion, setFormVersion] = React.useState('0.1.0');
  const [formDescription, setFormDescription] = React.useState('');
  const [formAuthor, setFormAuthor] = React.useState('');
  const [formIconEmoji, setFormIconEmoji] = React.useState('📊');
  const [formConfig, setFormConfig] = React.useState<PluginConfigDeclaration[]>([]);
  // 内核模式
  const [formBundle, setFormBundle] = React.useState('');

  // 打开时重置表单
  React.useEffect(() => {
    if (open) {
      setFormName('');
      setFormId('');
      setFormContent('');
      setFormScript('');
      setFormStyle('');
      setFormPermissions([]);
      setActiveTab('basic');
      setFormVersion('0.1.0');
      setFormDescription('');
      setFormAuthor('');
      setFormIconEmoji('📊');
      setFormConfig([]);
      setFormBundle('');
    }
  }, [open]);

  // Escape 关闭
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // ── 自动生成 ID ──
  const handleNameBlur = () => {
    if (!formId && formName) {
      setFormId(formName.trim().toLowerCase().replace(/\s+/g, '-'));
    }
  };

  // ── 切换权限 ──
  const togglePermission = (perm: PluginPermission) => {
    setFormPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  // ── 创建插件 ──
  const handleCreate = () => {
    const id =
      formId.trim().toLowerCase().replace(/\s+/g, '-') || Date.now().toString(36);
    const name = formName.trim() || '未命名插件';

    if (pluginRegistry.get(id)) {
      alert(`插件 ID "${id}" 已存在，请换一个`);
      return;
    }

    // 构建清单
    const isKernel = activeTab === 'kernel' && formBundle.trim().length > 0;
    const manifest: PluginManifest = {
      name,
      version: formVersion || '0.1.0',
      description: formDescription || undefined,
      author: formAuthor || undefined,
      iconEmoji: formIconEmoji || undefined,
      permissions: formPermissions,
      config: formConfig.length > 0 ? formConfig : undefined,
      runtime: isKernel ? 'kernel' : 'sandbox',
    };

    // 持久化
    const defs = loadUserPlugins();
    const def: UserPluginDef = {
      id,
      name,
      content: isKernel ? '' : formContent,
      script: isKernel ? undefined : (formScript || undefined),
      style: isKernel ? undefined : (formStyle || undefined),
      permissions: formPermissions.length > 0 ? formPermissions : undefined,
      iconEmoji: formIconEmoji || undefined,
      manifest,
      bundle: isKernel ? formBundle : undefined,
    };
    defs.push(def);
    saveUserPlugins(defs);

    // 注册到 registry
    const BoundPlugin: React.FC = () => (
      <DynamicPlugin
        pluginName={name}
        content={isKernel ? '' : formContent}
        script={isKernel ? undefined : (formScript || undefined)}
        style={isKernel ? undefined : (formStyle || undefined)}
        pluginId={id}
        permissions={formPermissions}
        bundle={isKernel ? formBundle : undefined}
      />
    );

    // 从 manifest config 生成命令
    const commands = manifest.config
      ? manifest.config.map((c) => ({
          id: `${id}.setConfig.${c.key}`,
          title: `设置 ${c.label ?? c.key}`,
          category: name,
        }))
      : undefined;

    pluginRegistry.register({
      id,
      name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: true,
      order: pluginRegistry.getAll().length,
      contributions: {
        commands,
      },
    });

    onCreated();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            新建插件
          </h3>
          <button
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 表单 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* 选项卡切换 */}
          <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
            {([
              ['basic', '基础模式'],
              ['advanced', '高级模式（脚本）'],
              ['kernel', '内核模式（React）'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  activeTab === key
                    ? 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 名称 + ID 始终显示 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                插件名称 <span className="text-red-400">*</span>
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-950 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400"
                placeholder="例如：今日待办"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onBlur={handleNameBlur}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                插件 ID
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-950 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400 font-mono"
                placeholder="自动生成"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
              />
            </div>
          </div>

          {/* 清单字段（版本 + 图标 + 描述） */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                版本
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-950 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400 font-mono"
                placeholder="0.1.0"
                value={formVersion}
                onChange={(e) => setFormVersion(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                图标 Emoji
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-950 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400"
                placeholder="📊"
                value={formIconEmoji}
                onChange={(e) => setFormIconEmoji(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                作者
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-950 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400"
                placeholder="选填"
                value={formAuthor}
                onChange={(e) => setFormAuthor(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              描述
            </label>
            <input
              className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-950 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400"
              placeholder="简短描述插件功能"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </div>

          {/* ── 基础模式：Markdown 内容 ── */}
          {activeTab === 'basic' && (
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                内容（支持 Markdown）
              </label>
              <textarea
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-950 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400 resize-none"
                rows={5}
                placeholder={"**标题**\n- 列表项 1\n- 列表项 2\n\n[链接](https://example.com)"}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
              />
              <p className="text-[10px] text-zinc-400 mt-1">
                无需编程，支持 Markdown 格式。适合便签、说明文档、备忘等。
              </p>
            </div>
          )}

          {/* ── 高级模式：脚本编辑器 + 权限 ── */}
          {activeTab === 'advanced' && (
            <>
              {/* 脚本编辑 */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 mb-1">
                  <Code className="h-3.5 w-3.5" />
                  JavaScript 脚本
                  <span className="text-red-400">*</span>
                </label>
                <textarea
                  className="w-full px-2 py-1.5 text-xs font-mono border rounded-md bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400 resize-none"
                  rows={10}
                  placeholder={"// 使用 PluginSDK 构建交互式插件\nconst { ui, store, actions, data } = PluginSDK;\n\n// 1. 设置初始 UI\nui.setContent('\\n  <div class=\"pk-card\">\\n    <h3>我的数据面板</h3>\\n    <button id=\"btn\" class=\"pk-btn pk-primary\">加载数据</button>\\n    <div id=\"result\"></div>\\n  </div>\\n');\n\n// 2. 绑定事件\ndocument.getElementById('btn').addEventListener('click', async () => {\n  const prompts = await store.getPrompts();\n  document.getElementById('result').innerHTML =\n    '共 ' + prompts.length + ' 条提示词';\n});"}
                  value={formScript}
                  onChange={(e) => setFormScript(e.target.value)}
                  spellCheck={false}
                />
              </div>

              {/* 自定义样式 */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                  自定义 CSS（可选）
                </label>
                <textarea
                  className="w-full px-2 py-1.5 text-xs font-mono border rounded-md bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400 resize-none"
                  rows={3}
                  placeholder={"/* 自定义样式 */\n#result { color: var(--foreground); }"}
                  value={formStyle}
                  onChange={(e) => setFormStyle(e.target.value)}
                  spellCheck={false}
                />
              </div>

              {/* 权限选择 */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 mb-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  权限声明（按需勾选）
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    ['store.read', '读取应用状态', '访问提示词、站点、标签页等'],
                    ['clipboard', '剪贴板', '读写系统剪贴板'],
                    ['inject', '注入提示词', '向 AI 站点注入文本'],
                    ['external.open', '打开链接', '在外部浏览器打开 URL'],
                    ['data', '私有存储', '插件隔离的键值存储'],
                    ['preview', '内容预览', '渲染 PDF、图片、Markdown、代码'],
                    ['file.read', '读取文件', '打开本地文件选择对话框'],
                    ['file.write', '写入文件', '保存内容到本地文件'],
                  ] as const).map(([perm, title, desc]) => {
                    const checked = formPermissions.includes(perm as PluginPermission);
                    return (
                      <label
                        key={perm}
                        className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                          checked
                            ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950'
                            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                          checked={checked}
                          onChange={() => togglePermission(perm as PluginPermission)}
                        />
                        <div>
                          <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                            {title}
                          </div>
                          <div className="text-[10px] text-zinc-400">{desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── 内核模式：React 组件 ── */}
          {activeTab === 'kernel' && (
            <>
              {/* 安全警告 */}
              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    系统级权限
                  </span>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-500 leading-relaxed">
                  内核插件直接注入 React 树，可以访问完整的 Node.js API、Electron API 和文件系统。
                  仅安装来自可信来源的内核插件。
                </p>
              </div>

              {/* Bundle 代码编辑 */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 mb-1">
                  <Code className="h-3.5 w-3.5" />
                  React 组件源码（IIFE/UMD）
                  <span className="text-red-400">*</span>
                </label>
                <textarea
                  className="w-full px-2 py-1.5 text-xs font-mono border rounded-md bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-amber-400 resize-none"
                  rows={12}
                  placeholder={"// 支持 JSX，Babel 自动编译\n// 可用: React, XLSX, useStore, electronAPI, injectToAI\n\nconst { useState } = React;\n\nfunction ExcelReader() {\n  const [data, setData] = useState(null);\n\n  const loadExcel = async () => {\n    const result = await electronAPI.pickFile({ accept: '.xlsx' });\n    if (!result) return;\n    const wb = XLSX.read(result.content, { type: 'base64' });\n    const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);\n    setData(json);\n  };\n\n  const injectData = async () => {\n    if (!data) return;\n    const text = data.map(r => Object.values(r).join('\\t')).join('\\n');\n    await injectToAI('deepseek', '请分析以下 Excel 数据:\\n' + text, false);\n  };\n\n  return (\n    <div style={{padding:16}}>\n      <button onClick={loadExcel}\n        style={{padding:'6px 14px',borderRadius:8,background:'#3b82f6',color:'#fff',border:'none',cursor:'pointer'}}>\n        打开 Excel\n      </button>\n      {data && <>\n        <button onClick={injectData}\n          style={{marginLeft:8,padding:'6px 14px',borderRadius:8,background:'#10b981',color:'#fff',border:'none',cursor:'pointer'}}>\n          注入到 AI\n        </button>\n        <pre style={{marginTop:12,fontSize:12,maxHeight:400,overflow:'auto'}}>\n          {JSON.stringify(data.slice(0,5), null, 2)}\n        </pre>\n      </>}\n    </div>\n  );\n}\n\nmodule.exports = ExcelReader;"}
                  value={formBundle}
                  onChange={(e) => setFormBundle(e.target.value)}
                  spellCheck={false}
                />
                <p className="text-[10px] text-zinc-400 mt-1">
                  支持 <strong>JSX/TSX</strong> 语法（Babel 自动编译）。可用 <code>require('xlsx')</code> 返回 SheetJS。
                  确保末尾 <code>module.exports = 组件名;</code> 导出 React 组件。
                </p>
              </div>

              {/* 或从文件加载 */}
              <button
                className="w-full py-2 text-xs font-medium text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg hover:border-amber-400 hover:text-amber-600 transition-colors"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.js,.ts,.jsx,.tsx';
                  input.onchange = () => {
                    const file = input.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => {
                        setFormBundle(reader.result as string);
                      };
                      reader.readAsText(file);
                    }
                  };
                  input.click();
                }}
              >
                或从文件加载 bundle...
              </button>
            </>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-4 py-3 border-t flex items-center justify-between">
          <span className="text-[10px] text-zinc-400">
            Esc 取消
          </span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="px-4 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors disabled:opacity-40"
              disabled={!formName.trim() || (activeTab === 'kernel' && !formBundle.trim())}
              onClick={handleCreate}
            >
              创建插件
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── .nwd 导入/导出 ──

/** 导出单个用户插件为 .nwd (zip 文件) */
async function exportPlugin(def: UserPluginDef): Promise<void> {
  try {
    const manifest = def.manifest ?? {
      name: def.name,
      version: '0.1.0',
      permissions: def.permissions ?? [],
      iconEmoji: def.iconEmoji,
    };
    // 移除内部 id 字段（manifest 不需要）
    const cleanManifest = { ...manifest };
    const isKernel = manifest.runtime === 'kernel' && def.bundle;

    // 构建 .nwd JSON bundle
    const nwdBundle: any = {
      format: 'nwd-v1',
      manifest: cleanManifest,
    };
    if (isKernel) {
      nwdBundle.kernelBundle = def.bundle!;
    } else {
      nwdBundle.script = def.script ?? def.content ?? '';
      nwdBundle.style = def.style ?? null;
    }
    const bundleStr = JSON.stringify(nwdBundle, null, 2);

    // 通过下载触发
    const blob = new Blob([bundleStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.id}.nwd`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[exportPlugin] 导出失败', err);
    alert('导出失败：' + (err as Error).message);
  }
}

/** 从 .nwd 文件导入插件 */
async function importPlugin(file: File): Promise<{ ok: boolean; message: string }> {
  try {
    const text = await file.text();
    const bundle = JSON.parse(text);

    if (bundle.format !== 'nwd-v1') {
      return { ok: false, message: '不支持的格式，需要 .nwd v1' };
    }

    const manifest: PluginManifest = bundle.manifest;
    if (!manifest?.name) {
      return { ok: false, message: 'manifest.json 缺少 name 字段' };
    }

    const id = manifest.name.toLowerCase().replace(/\s+/g, '-');
    const isKernel = manifest.runtime === 'kernel';
    const script = bundle.script ?? '';
    const style = bundle.style ?? '';
    const kernelBundle = bundle.kernelBundle ?? '';

    if (isKernel && !kernelBundle) {
      return { ok: false, message: '内核插件缺少 bundle 代码' };
    }
    if (!isKernel && !script) {
      return { ok: false, message: '插件脚本为空' };
    }

    if (pluginRegistry.get(id)) {
      return { ok: false, message: `插件 "${id}" 已存在，请先删除旧版本` };
    }

    const def: UserPluginDef = {
      id,
      name: manifest.name,
      content: '',  // 旧版 markdown 模式，导入时不使用
      script: isKernel ? undefined : script,
      style: style || undefined,
      permissions: manifest.permissions ?? [],
      iconEmoji: manifest.iconEmoji,
      manifest,
      bundle: isKernel ? kernelBundle : undefined,
    };

    const defs = loadUserPlugins();
    defs.push(def);
    saveUserPlugins(defs);

    // 注册
    const BoundPlugin: React.FC = () => (
      <DynamicPlugin
        pluginName={def.name}
        script={def.script}
        style={def.style}
        pluginId={def.id}
        permissions={def.permissions}
        bundle={def.bundle}
      />
    );
    const commands = manifest.config
      ? manifest.config.map((c) => ({
          id: `${id}.setConfig.${c.key}`,
          title: `设置 ${c.label ?? c.key}`,
          category: def.name,
        }))
      : undefined;
    pluginRegistry.register({
      id,
      name: def.name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: true,
      order: pluginRegistry.getAll().length,
      contributions: { commands },
    });

    return { ok: true, message: `已导入插件: ${manifest.name} v${manifest.version}` };
  } catch (err) {
    return { ok: false, message: '解析失败：' + (err as Error).message };
  }
}

// ── 主面板 ──

export const PluginManagerPanel: React.FC = () => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => pluginRegistry.subscribe(() => setTick((t) => t + 1)), []);

  // 启动时从 localStorage 恢复用户插件
  React.useEffect(() => {
    rehydrateUserPlugins();
    setTick((t) => t + 1);
  }, []);

  // 弹层状态
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const allPlugins = pluginRegistry.getAll();
  const enabledCount = pluginRegistry.getEnabled().length;

  // 已存在的用户插件 ID 集合（每次渲染重新计算以保持同步）
  const userPluginIds = new Set(loadUserPlugins().map((d) => d.id));

  // ── 删除用户插件 ──
  const handleDelete = (id: string) => {
    pluginRegistry.unregister(id);
    const defs = loadUserPlugins().filter((d) => d.id !== id);
    saveUserPlugins(defs);
    userPluginIds.delete(id);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-blue-500" />
          <h2 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">
            插件管理
          </h2>
          <span className="text-xs text-zinc-400">
            {enabledCount}/{allPlugins.length} 已启用
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 导入 .nwd */}
          <button
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.nwd';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (file) {
                  const result = await importPlugin(file);
                  alert(result.message);
                  if (result.ok) setTick((t) => t + 1);
                }
              };
              input.click();
            }}
            title="导入 .nwd 插件"
          >
            <Upload className="h-3.5 w-3.5" />
            导入
          </button>
          <button
            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            新建插件
          </button>
        </div>
      </div>

      {/* 新建插件弹层 */}
      <CreatePluginDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => setTick((t) => t + 1)}
      />

      {/* 插件卡片网格 */}
      <div className="flex-1 overflow-y-auto p-4">
        {allPlugins.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-16">
            暂无已注册的插件，点击"新建插件"开始
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {allPlugins.map((plugin) => {
              const Icon = plugin.icon;
              const isUserPlugin = userPluginIds.has(plugin.id);
              // 检查是否为脚本插件（通过 localStorage 中的定义判断）
              const userDefs = loadUserPlugins();
              const def = userDefs.find((d) => d.id === plugin.id);
              const isScriptPlugin = def?.script != null && def.script.length > 0;
              const isKernelPlugin = def?.manifest?.runtime === 'kernel' && def?.bundle != null;
              return (
                <div
                  key={plugin.id}
                  className={`relative flex flex-col items-center gap-3 p-4 rounded-xl border transition-all group ${
                    plugin.enabled
                      ? 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:shadow-md'
                      : 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 opacity-60'
                  }`}
                >
                  {/* 删除/导出按钮 — 仅用户插件 */}
                  {isUserPlugin && (
                    <>
                      <button
                        className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all"
                        onClick={() => handleDelete(plugin.id)}
                        title="删除插件"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="absolute top-2 left-8 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-blue-500 transition-all"
                        onClick={() => {
                          const userDefs = loadUserPlugins();
                          const def = userDefs.find((d) => d.id === plugin.id);
                          if (def) exportPlugin(def);
                        }}
                        title="导出 .nwd 插件"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}

                  {/* 开关 */}
                  <div className="absolute top-2 right-2">
                    <button
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                        plugin.enabled
                          ? 'bg-blue-500'
                          : 'bg-zinc-300 dark:bg-zinc-600'
                      }`}
                      onClick={() => {
                        pluginRegistry.setEnabled(plugin.id, !plugin.enabled);
                        if (isDbReady()) {
                          dbSetSetting('plugin.enabled', JSON.stringify(pluginRegistry.getEnabledSnapshot()));
                        }
                      }}
                      title={plugin.enabled ? '点击禁用' : '点击启用'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          plugin.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </button>
                  </div>

                  {/* 图标 */}
                  <div className={`p-3 rounded-xl ${
                    plugin.enabled
                      ? isUserPlugin
                        ? 'bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400'
                        : 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                  }`}>
                    <Icon className="h-7 w-7" />
                  </div>

                  {/* 名称 */}
                  <span className={`text-sm font-semibold ${
                    plugin.enabled
                      ? 'text-zinc-800 dark:text-zinc-200'
                      : 'text-zinc-400'
                  }`}>
                    {plugin.name}
                  </span>

                  {/* 元信息 */}
                  <div className="flex flex-col items-center gap-1 w-full">
                    <code className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                      {plugin.id}
                    </code>
                    <span className="text-[10px] text-zinc-400">
                      排序 #{plugin.order}
                    </span>
                  </div>

                  {/* 类型标签 */}
                  <div className="flex items-center gap-1">
                    {isKernelPlugin && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 font-medium">
                        <ShieldCheck className="h-2.5 w-2.5 inline mr-0.5" />
                        内核
                      </span>
                    )}
                    {isScriptPlugin && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 font-medium">
                        <Code className="h-2.5 w-2.5 inline mr-0.5" />
                        脚本
                      </span>
                    )}
                    {isUserPlugin && !isScriptPlugin && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400 font-medium">
                        自定义
                      </span>
                    )}
                    {plugin.enabled ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-medium">
                        已启用
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-500 font-medium">
                        已禁用
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 border-t text-[11px] text-zinc-400 flex items-center justify-between">
        <span>禁用插件会从左侧栏和主内容区隐藏，数据不丢失 · 悬停卡片显示导出/删除</span>
        <span className="flex items-center gap-1">
          <Blocks className="h-3 w-3 text-green-500" />
          绿色图标 = 自定义插件
        </span>
      </div>
    </div>
  );
};
