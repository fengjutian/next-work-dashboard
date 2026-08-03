import React from 'react';
import { Puzzle, Plus, X, Blocks, Trash2, Code, ShieldCheck, Download, Upload } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { isDbReady, dbSetSetting } from '@/db';
import { loadUserPlugins, saveUserPlugins, rehydrateUserPlugins } from './user-plugin-store';
import type { UserPluginDef } from './user-plugin-store';
import { CreatePluginDialog } from './CreatePluginDialog';
import { exportPlugin, importPlugin } from './import-export';

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
    <div className="flex flex-col h-full bg-card">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-sm text-foreground">
            插件管理
          </h2>
          <span className="text-xs text-muted-foreground">
            {enabledCount}/{allPlugins.length} 已启用
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 导入 .nwd */}
          <button
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground text-muted-foreground dark:hover:text-foreground transition-colors"
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
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary text-primary dark:hover:text-primary transition-colors"
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
          <p className="text-sm text-muted-foreground text-center py-16">
            暂无已注册的插件，点击"新建插件"开始
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {allPlugins.map((plugin) => {
              const Icon = plugin.icon;
              const isUserPlugin = userPluginIds.has(plugin.id);
              const userDefs = loadUserPlugins();
              const def = userDefs.find((d) => d.id === plugin.id);
              const isScriptPlugin = def?.script != null && def.script.length > 0;
              const isKernelPlugin = def?.manifest?.runtime === 'kernel' && def?.bundle != null;
              return (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  Icon={Icon}
                  isUserPlugin={isUserPlugin}
                  isScriptPlugin={isScriptPlugin}
                  isKernelPlugin={isKernelPlugin}
                  onDelete={handleDelete}
                  onExport={async (id) => {
                    const defs = loadUserPlugins();
                    const def = defs.find((d) => d.id === id);
                    if (def) exportPlugin(def);
                  }}
                  onToggle={(id) => {
                    const p = pluginRegistry.get(id);
                    if (p) {
                      pluginRegistry.setEnabled(id, !p.enabled);
                      if (isDbReady()) {
                        dbSetSetting('plugin.enabled', JSON.stringify(pluginRegistry.getEnabledSnapshot()));
                      }
                    }
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 border-t text-[11px] text-muted-foreground flex items-center justify-between">
        <span>禁用插件会从左侧栏和主内容区隐藏，数据不丢失 · 悬停卡片显示导出/删除</span>
        <span className="flex items-center gap-1">
          <Blocks className="h-3 w-3 text-success" />
          绿色图标 = 自定义插件
        </span>
      </div>
    </div>
  );
};

// ── 插件卡片子组件 ──

interface PluginCardProps {
  plugin: ReturnType<typeof pluginRegistry.getAll>[number];
  Icon: React.ComponentType<{ className?: string }>;
  isUserPlugin: boolean;
  isScriptPlugin: boolean;
  isKernelPlugin: boolean;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onToggle: (id: string) => void;
}

const PluginCard: React.FC<PluginCardProps> = ({
  plugin,
  Icon,
  isUserPlugin,
  isScriptPlugin,
  isKernelPlugin,
  onDelete,
  onExport,
  onToggle,
}) => (
  <div
    className={`relative flex flex-col items-center gap-3 p-4 rounded-xl border transition-all group ${
      plugin.enabled
        ? 'border-border bg-card hover:shadow-md'
        : 'border-border bg-background/50 opacity-60'
    }`}
  >
    {/* 删除/导出按钮 — 仅用户插件 */}
    {isUserPlugin && (
      <>
        <button
          className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
          onClick={() => onDelete(plugin.id)}
          title="删除插件"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          className="absolute top-2 left-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all"
          onClick={() => onExport(plugin.id)}
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
          plugin.enabled ? 'bg-primary' : 'bg-input'
        }`}
        onClick={() => onToggle(plugin.id)}
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
          ? 'bg-success/10 bg-success/10 text-success text-success'
          : 'bg-primary-light text-primary'
        : 'bg-muted text-muted-foreground'
    }`}>
      <Icon className="h-7 w-7" />
    </div>

    {/* 名称 */}
    <span className={`text-sm font-semibold ${
      plugin.enabled ? 'text-foreground' : 'text-muted-foreground'
    }`}>
      {plugin.name}
    </span>

    {/* 元信息 */}
    <div className="flex flex-col items-center gap-1 w-full">
      <code className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
        {plugin.id}
      </code>
      <span className="text-[10px] text-muted-foreground">
        排序 #{plugin.order}
      </span>
    </div>

    {/* 类型标签 */}
    <div className="flex items-center gap-1">
      {isKernelPlugin && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/10 bg-warning/10 text-warning text-warning font-medium">
          <ShieldCheck className="h-2.5 w-2.5 inline mr-0.5" />
          内核
        </span>
      )}
      {isScriptPlugin && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-light text-primary font-medium">
          <Code className="h-2.5 w-2.5 inline mr-0.5" />
          脚本
        </span>
      )}
      {isUserPlugin && !isScriptPlugin && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 bg-success/10 text-success text-success font-medium">
          自定义
        </span>
      )}
      {plugin.enabled ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-light text-primary font-medium">
          已启用
        </span>
      ) : (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-muted-foreground font-medium">
          已禁用
        </span>
      )}
    </div>
  </div>
);
