import React from 'react';
import { Puzzle, Plus, X, Blocks, Trash2, Code, ShieldCheck } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { DynamicPlugin } from './dynamic.plugin';
import type { Plugin } from '../types';
import type { PluginPermission } from '../sandbox/types';

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
      />
    );
    pluginRegistry.register({
      id: def.id,
      name: def.name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: true,
      order: nextOrder + i,
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
  const [activeTab, setActiveTab] = React.useState<'basic' | 'advanced'>('basic');

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

    // 持久化
    const defs = loadUserPlugins();
    const def: UserPluginDef = {
      id,
      name,
      content: formContent,
      script: formScript || undefined,
      style: formStyle || undefined,
      permissions: formPermissions.length > 0 ? formPermissions : undefined,
    };
    defs.push(def);
    saveUserPlugins(defs);

    // 注册到 registry
    const BoundPlugin: React.FC = () => (
      <DynamicPlugin
        pluginName={name}
        content={formContent}
        script={formScript || undefined}
        style={formStyle || undefined}
        pluginId={id}
        permissions={formPermissions}
      />
    );
    pluginRegistry.register({
      id,
      name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: true,
      order: pluginRegistry.getAll().length,
    });

    onCreated();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-[520px] max-h-[85vh] flex flex-col">
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
              disabled={!formName.trim()}
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
        <button
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          新建插件
        </button>
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
              return (
                <div
                  key={plugin.id}
                  className={`relative flex flex-col items-center gap-3 p-4 rounded-xl border transition-all group ${
                    plugin.enabled
                      ? 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:shadow-md'
                      : 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 opacity-60'
                  }`}
                >
                  {/* 删除按钮 — 仅用户插件 */}
                  {isUserPlugin && (
                    <button
                      className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all"
                      onClick={() => handleDelete(plugin.id)}
                      title="删除插件"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {/* 开关 */}
                  <div className="absolute top-2 right-2">
                    <button
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                        plugin.enabled
                          ? 'bg-blue-500'
                          : 'bg-zinc-300 dark:bg-zinc-600'
                      }`}
                      onClick={() =>
                        pluginRegistry.setEnabled(plugin.id, !plugin.enabled)
                      }
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
        <span>禁用插件会从左侧栏和主内容区隐藏，数据不丢失</span>
        <span className="flex items-center gap-1">
          <Blocks className="h-3 w-3 text-green-500" />
          绿色图标 = 自定义插件
        </span>
      </div>
    </div>
  );
};
