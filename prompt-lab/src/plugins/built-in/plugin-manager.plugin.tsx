import React from 'react';
import { Puzzle } from 'lucide-react';
import { pluginRegistry } from '../registry';

/**
 * PluginManager — 插件管理面板。
 *
 * 功能：
 *  - 列出所有已注册插件（含内置和自定义）
 *  - 显示名称、ID、排序、状态
 *  - 开关切换启用/禁用
 *  - 禁用插件后 ActivityBar 和主内容区同步消失
 */
export const PluginManagerPanel: React.FC = () => {
  // 订阅 registry 变更，确保开关后重渲染
  const [, setTick] = React.useState(0);
  React.useEffect(() => pluginRegistry.subscribe(() => setTick((t) => t + 1)), []);

  const allPlugins = pluginRegistry.getAll();
  const enabledCount = pluginRegistry.getEnabled().length;

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
      </div>

      {/* 插件卡片网格 */}
      <div className="flex-1 overflow-y-auto p-4">
        {allPlugins.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-16">
            暂无已注册的插件
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {allPlugins.map((plugin) => {
              const Icon = plugin.icon;
              return (
                <div
                  key={plugin.id}
                  className={`relative flex flex-col items-center gap-3 p-4 rounded-xl border transition-all ${
                    plugin.enabled
                      ? 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:shadow-md'
                      : 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 opacity-60'
                  }`}
                >
                  {/* 状态角标 */}
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
                      ? 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
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

                  {/* 状态标签 */}
                  {!plugin.enabled && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-500 font-medium">
                      已禁用
                    </span>
                  )}
                  {plugin.enabled && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-medium">
                      已启用
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 border-t text-[11px] text-zinc-400">
        禁用插件会将其从左侧栏和主内容区隐藏，但不会删除数据
      </div>
    </div>
  );
};
