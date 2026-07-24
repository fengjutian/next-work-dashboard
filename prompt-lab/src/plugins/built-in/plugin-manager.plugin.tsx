import React from 'react';
import { Puzzle, Plus, X, Blocks, Trash2 } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { DynamicPlugin } from './dynamic.plugin';
import type { Plugin } from '../types';

// ── localStorage 持久化 ──

const STORAGE_KEY = 'plugin-manager-user-plugins';

interface UserPluginDef {
  id: string;
  name: string;
  content: string;
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
      <DynamicPlugin pluginName={def.name} content={def.content} />
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

// ── 组件 ──

export const PluginManagerPanel: React.FC = () => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => pluginRegistry.subscribe(() => setTick((t) => t + 1)), []);

  // 启动时从 localStorage 恢复用户插件
  React.useEffect(() => {
    rehydrateUserPlugins();
    setTick((t) => t + 1);
  }, []);

  // 新建表单状态
  const [showForm, setShowForm] = React.useState(false);
  const [formName, setFormName] = React.useState('');
  const [formId, setFormId] = React.useState('');
  const [formContent, setFormContent] = React.useState('');

  const allPlugins = pluginRegistry.getAll();
  const enabledCount = pluginRegistry.getEnabled().length;

  // 已存在的用户插件 ID 集合
  const userPluginIds = new Set(loadUserPlugins().map((d) => d.id));

  // ── 新建插件 ──
  const handleCreate = () => {
    const id = formId.trim().toLowerCase().replace(/\s+/g, '-') || Date.now().toString(36);
    const name = formName.trim() || '未命名插件';

    if (pluginRegistry.get(id)) {
      alert(`插件 ID "${id}" 已存在，请换一个`);
      return;
    }

    // 持久化
    const defs = loadUserPlugins();
    const def: UserPluginDef = { id, name, content: formContent };
    defs.push(def);
    saveUserPlugins(defs);
    userPluginIds.add(id);

    // 注册到 registry
    const BoundPlugin: React.FC = () => (
      <DynamicPlugin pluginName={name} content={formContent} />
    );
    pluginRegistry.register({
      id,
      name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: true,
      order: pluginRegistry.getAll().length,
    });

    // 重置表单
    setFormName('');
    setFormId('');
    setFormContent('');
    setShowForm(false);
  };

  // ── 删除用户插件 ──
  const handleDelete = (id: string) => {
    pluginRegistry.unregister(id);
    const defs = loadUserPlugins().filter((d) => d.id !== id);
    saveUserPlugins(defs);
    userPluginIds.delete(id);
  };

  // ── 自动生成 ID ──
  const handleNameBlur = () => {
    if (!formId && formName) {
      setFormId(formName.trim().toLowerCase().replace(/\s+/g, '-'));
    }
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
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? (
            <X className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {showForm ? '取消' : '新建插件'}
        </button>
      </div>

      {/* 新建插件表单 */}
      {showForm && (
        <div className="px-4 py-3 border-b bg-blue-50/50 dark:bg-blue-950/20 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                插件名称 *
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-900 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400"
                placeholder="例如：今日待办"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onBlur={handleNameBlur}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                插件 ID
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-900 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400 font-mono"
                placeholder="自动生成"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              内容（支持 Markdown）
            </label>
            <textarea
              className="w-full px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-zinc-900 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-400 resize-none"
              rows={3}
              placeholder="**标题**&#10;- 列表项 1&#10;- 列表项 2&#10;&#10;[链接](https://example.com)"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
            />
          </div>
          <button
            className="w-full py-1.5 text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors disabled:opacity-40"
            disabled={!formName.trim()}
            onClick={handleCreate}
          >
            创建插件
          </button>
        </div>
      )}

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
                    {isUserPlugin && (
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
