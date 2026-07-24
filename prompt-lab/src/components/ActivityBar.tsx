import React from 'react';
import { useStore } from '@/store';
import { pluginRegistry } from '@/plugins';

export const ActivityBar: React.FC = () => {
  const { activeActivity, setActiveActivity } = useStore();

  // 订阅 registry 变更，插件开关后自动重渲染
  const [, setTick] = React.useState(0);
  React.useEffect(() => pluginRegistry.subscribe(() => setTick((t) => t + 1)), []);

  // 从插件注册中心获取已启用的插件（按 order 排序）
  const plugins = pluginRegistry.getEnabled();

  return (
    <div className="w-12 flex-shrink-0 border-r bg-zinc-100 dark:bg-zinc-900 flex flex-col items-center py-3 gap-1 select-none">
      {plugins.map(({ id, icon: Icon, name: label }) => {
        const isActive = activeActivity === id;
        return (
          <button
            key={id}
            className={`relative w-10 h-10 flex items-center justify-center rounded-md transition-colors group ${
              isActive
                ? 'text-zinc-900 dark:text-zinc-100 bg-zinc-200 dark:bg-zinc-700'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800'
            }`}
            onClick={() => setActiveActivity(isActive ? null : id)}
            title={label}
          >
            {/* VSCode 风格的活动指示器 */}
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-blue-500 rounded-r-full" />
            )}
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
};
