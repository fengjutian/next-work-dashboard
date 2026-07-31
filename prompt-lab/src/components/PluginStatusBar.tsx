import React from 'react';
import { pluginRegistry } from '@/plugins';
import { useStore } from '@/store';

/**
 * PluginStatusBar — 集成插件状态栏项的底部栏组件。
 *
 * 从 pluginRegistry 中收集所有已启用插件的 contributions.statusBarItems，
 * 按 alignment/priority 排序后渲染。
 */
export const PluginStatusBar: React.FC = () => {
  // 订阅 registry 变更
  const [, setTick] = React.useState(0);
  React.useEffect(
    () => pluginRegistry.subscribe(() => setTick((t) => t + 1)),
    [],
  );

  const allItems = pluginRegistry
    .getEnabled()
    .flatMap((p) =>
      (p.contributions?.statusBarItems ?? []).map((item) => ({
        ...item,
        pluginId: p.id,
        pluginName: p.name,
      })),
    );

  if (allItems.length === 0) return null;

  const leftItems = allItems
    .filter((i) => (i.alignment ?? 'right') === 'left')
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const rightItems = allItems
    .filter((i) => (i.alignment ?? 'right') === 'right')
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const handleItemClick = React.useCallback(
    (item: typeof allItems[0]) => {
      if (item.command) {
        // 激活所属插件面板
        const plugin = pluginRegistry.get(item.pluginId);
        if (plugin?.enabled) {
          useStore.getState().setActiveActivity(item.pluginId);
        }
        // 执行命令
        pluginRegistry.executeCommand(item.command);
      }
    },
    [],
  );

  const renderItem = (item: typeof allItems[0]) => (
    <span
      key={`${item.pluginId}:${item.id}`}
      className={`text-[11px] px-2 transition-colors ${
        item.command
          ? 'cursor-pointer hover:text-primary'
          : 'text-muted-foreground cursor-default'
      }`}
      title={item.tooltip ?? item.text}
      onClick={() => handleItemClick(item)}
    >
      {item.text}
    </span>
  );

  return (
    <>
      <div className="flex items-center gap-1">{leftItems.map(renderItem)}</div>
      <div className="flex-1" />
      <div className="flex items-center gap-1">{rightItems.map(renderItem)}</div>
    </>
  );
};
