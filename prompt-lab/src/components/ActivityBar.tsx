import React from 'react';
import { useStore } from '@/store';
import { pluginRegistry, usePluginRegistryVersion } from '@/plugins';

export const ActivityBar: React.FC = () => {
  const { activeActivity, setActiveActivity } = useStore();

  // 订阅 registry 变更，插件开关后自动重渲染
  usePluginRegistryVersion();

  // 从插件注册中心获取已启用的插件（按 order 排序）
  const bottomNavigationPluginIds = new Set(['plugin-manager', 'database']);
  const plugins = pluginRegistry.getEnabled().filter((plugin) => !bottomNavigationPluginIds.has(plugin.id));

  return (
    <div className="w-12 flex-shrink-0 border-r bg-muted flex flex-col items-center py-3 gap-1 select-none">
      {plugins.map(({ id, icon: Icon, name: label, preload }) => {
        const isActive = activeActivity === id;
        const prepare = () => preload?.() ?? Promise.resolve();
        const warm = () => {
          void prepare().catch((error) => {
            console.error(`[ActivityBar] Failed to preload plugin "${id}"`, error);
          });
        };
        return (
          <button
            key={id}
            className={`relative w-10 h-10 flex items-center justify-center rounded-md transition-colors group ${
              isActive
                ? 'text-foreground bg-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 dark:hover:bg-muted'
            }`}
            onMouseEnter={warm}
            onFocus={warm}
            onPointerDown={warm}
            onClick={async () => {
              if (!isActive) {
                try {
                  await prepare();
                } catch (error) {
                  console.error(`[ActivityBar] Failed to activate plugin "${id}"`, error);
                  return;
                }
              }
              setActiveActivity(isActive ? null : id);
            }}
            title={label}
          >
            {/* VSCode 风格的活动指示器 */}
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-primary rounded-r-full" />
            )}
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
};
