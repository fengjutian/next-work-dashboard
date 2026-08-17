import React from 'react';
import { Puzzle, Plus, Blocks, Trash2, Code, Download, Upload } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { isDbReady, dbSetSetting, flushDbToDisk } from '@/db';
import { loadUserPlugins, saveUserPlugins } from './user-plugin-store';
import { builtInPlugins } from '../built-in';
import { CreatePluginDialog } from './CreatePluginDialog';
import { exportPlugin, importPlugin, rollbackPlugin } from './import-export';
import { usePluginRegistryVersion } from '../usePluginRegistry';
import { pluginStorage } from '../plugin-storage';
import type { InstalledPluginState, MarketplaceCatalog, MarketplacePlugin, PluginInstallProgress } from '@/types/electron';
import { availableUpdates, getMarketplaceUrl, installOnlinePlugin, loadMarketplace, marketplacePluginVersion, setMarketplaceUrl } from './marketplace';

type PluginCategoryId = 'ai' | 'knowledge' | 'office' | 'development' | 'productivity' | 'system' | 'custom';

const PLUGIN_CATEGORIES: Array<{ id: PluginCategoryId; label: string; description: string }> = [
  { id: 'ai', label: 'AI 与创作', description: 'AI 会话、提示词和内容创作' },
  { id: 'knowledge', label: '知识管理', description: '知识库、图谱、阅读和文档检索' },
  { id: 'office', label: '办公文档', description: 'Office、PDF、白板与文本处理' },
  { id: 'development', label: '开发工具', description: '代码、终端、数据库与系统分析' },
  { id: 'productivity', label: '效率服务', description: '便签、翻译、天气和语言学习' },
  { id: 'system', label: '系统组件', description: '工作台自身的管理能力' },
  { id: 'custom', label: '自定义插件', description: '导入或创建的 Sandbox 插件' },
];

const BUILT_IN_CATEGORY: Record<string, PluginCategoryId> = {
  ai: 'ai', chat: 'ai', prompts: 'ai', 'style-image': 'ai',
  history: 'knowledge', graph: 'knowledge', weread: 'knowledge', 'document-knowledge': 'knowledge',
  'office-studio': 'office', 'word-preview': 'office', 'excel-preview': 'office', 'ppt-preview': 'office',
  'pdf-preview': 'office', excalidraw: 'office', compare: 'office',
  'code-editor': 'development', terminal: 'development', database: 'development', 'disk-space': 'development',
  'screen-capture': 'productivity', notes: 'productivity', translator: 'productivity', windy: 'productivity',
  'hanyu-jinjie': 'productivity', lingohut: 'productivity',
  'plugin-manager': 'system',
};

function pluginCategory(id: string, isUserPlugin: boolean): PluginCategoryId {
  return isUserPlugin ? 'custom' : BUILT_IN_CATEGORY[id] ?? 'system';
}

// ── 主面板 ──

export const PluginManagerPanel: React.FC = () => {
  usePluginRegistryVersion();

  // 启动时从 localStorage 恢复用户插件
  // 弹层状态
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [safeMode, setSafeMode] = React.useState(() => pluginStorage.isSafeMode());
  const [activeCategory, setActiveCategory] = React.useState<'all' | PluginCategoryId>('all');
  const [onlineMode, setOnlineMode] = React.useState(false);
  const [catalog, setCatalog] = React.useState<MarketplaceCatalog | null>(null);
  const [marketplaceBusy, setMarketplaceBusy] = React.useState(false);

  const refreshMarketplace = async () => {
    setMarketplaceBusy(true);
    try {
      const currentUrl = getMarketplaceUrl();
      if (!currentUrl) {
        const nextUrl = window.prompt('Marketplace catalog URL（HTTPS 或 localhost）', currentUrl);
        if (!nextUrl) return;
        setMarketplaceUrl(nextUrl);
      }
      setCatalog(await loadMarketplace(true));
    } catch (error) {
      alert(`Marketplace 加载失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMarketplaceBusy(false);
    }
  };

  React.useEffect(() => { void loadMarketplace().then(setCatalog).catch(() => undefined); }, []);

  const allPlugins = pluginRegistry.getAll();
  const enabledCount = pluginRegistry.getEnabled().length;

  // 已存在的用户插件 ID 集合（每次渲染重新计算以保持同步）
  const userDefs = loadUserPlugins();
  const userPluginIds = new Set(userDefs.map((d) => d.id));
  const categorizedPlugins = PLUGIN_CATEGORIES.map((category) => ({
    ...category,
    plugins: allPlugins.filter((plugin) => pluginCategory(plugin.id, userPluginIds.has(plugin.id)) === category.id),
  })).filter((category) => category.plugins.length > 0);
  const visibleCategories = activeCategory === 'all'
    ? categorizedPlugins
    : categorizedPlugins.filter((category) => category.id === activeCategory);

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
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOnlineMode((value) => !value)}>
            {onlineMode ? '已安装插件' : '在线插件'}
          </button>
          <button className="text-xs text-muted-foreground hover:text-foreground" disabled={marketplaceBusy} onClick={async () => {
            await refreshMarketplace();
            const updates = availableUpdates(await loadMarketplace());
            alert(updates.length ? `发现 ${updates.length} 个更新：\n${updates.map((item) => `${item.name} ${item.version}`).join('\n')}` : '当前没有可用更新');
          }}>
            {marketplaceBusy ? '检查中…' : '检查更新'}
          </button>
          <button
            className={`px-2 py-1 rounded text-xs ${safeMode ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => { const next = !safeMode; pluginRegistry.setSafeMode(next); setSafeMode(next); }}
            title="安全模式会禁用全部用户插件"
          >
            {safeMode ? '退出安全模式' : '安全模式'}
          </button>
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
        onCreated={() => undefined}
      />

      {onlineMode ? (
        <OnlinePluginList catalog={catalog} busy={marketplaceBusy} onRefresh={refreshMarketplace} />
      ) : <>
      {/* 分类筛选 */}
      <div className="shrink-0 border-b bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5" role="tablist" aria-label="插件分类">
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${activeCategory === 'all' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          >
            全部 <span className="ml-1 opacity-75">{allPlugins.length}</span>
          </button>
          {categorizedPlugins.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${activeCategory === category.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              {category.label} <span className="ml-1 opacity-75">{category.plugins.length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 插件卡片网格 */}
      <div className="flex-1 overflow-y-auto p-4">
        {allPlugins.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-16">
            暂无已注册的插件，点击"新建插件"开始
          </p>
        ) : (
          <div className="space-y-7">
            {visibleCategories.map((category) => (
              <section key={category.id} aria-labelledby={`plugin-category-${category.id}`}>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 id={`plugin-category-${category.id}`} className="text-sm font-semibold text-foreground">{category.label}</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">{category.plugins.filter((plugin) => plugin.enabled).length}/{category.plugins.length} 已启用</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{category.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {category.plugins.map((plugin) => {
                    const Icon = plugin.icon;
                    const isUserPlugin = userPluginIds.has(plugin.id);
                    const def = userDefs.find((item) => item.id === plugin.id);
                    const isScriptPlugin = def?.script != null && def.script.length > 0;
                    return (
                      <PluginCard
                        key={plugin.id}
                        plugin={plugin}
                        Icon={Icon}
                        isUserPlugin={isUserPlugin}
                        isScriptPlugin={isScriptPlugin}
                        onDelete={handleDelete}
                        onExport={(id) => {
                          const item = loadUserPlugins().find((definition) => definition.id === id);
                          if (item) void exportPlugin(item);
                        }}
                        onRollback={(id) => alert(rollbackPlugin(id).message)}
                        onLogs={(id) => {
                          const logs = pluginStorage.getLogs(id);
                          alert(logs.length ? logs.map((entry) => `[${entry.level}] ${entry.message}`).join('\n') : '暂无日志');
                        }}
                        onToggle={async (id) => {
                          const p = pluginRegistry.get(id);
                          if (p) {
                            const nextEnabled = !p.enabled;
                            if (nextEnabled) {
                              try {
                                const requirement = await window.electronAPI.plugins.getResourceRequirement(id);
                                if (requirement.required && !requirement.installed) {
                                  if (!requirement.version) throw new Error('在线目录中没有当前平台可用的资源版本');
                                  const size = requirement.size ? `（${(requirement.size / 1024 / 1024).toFixed(1)} MB）` : '';
                                  if (!window.confirm(`启用该插件需要下载资源 ${requirement.version}${size}，是否继续？`)) return;
                                  await window.electronAPI.plugins.ensureResource(id);
                                }
                              } catch (error) {
                                alert(`资源安装失败：${error instanceof Error ? error.message : String(error)}`);
                                return;
                              }
                            }
                            pluginRegistry.setEnabled(id, nextEnabled);
                            if (isUserPlugin) {
                              const defs = loadUserPlugins().map((item) => item.id === id
                                ? { ...item, enabled: nextEnabled }
                                : item);
                              saveUserPlugins(defs);
                            }
                            if (isDbReady()) {
                              // 只保存与内置默认值不同的差量，避免修改默认值后被旧快照覆盖
                              const builtInDefaults: Record<string, boolean> = {};
                              for (const bp of builtInPlugins) builtInDefaults[bp.id] = bp.enabled;
                              const full = pluginRegistry.getEnabledSnapshot();
                              const delta: Record<string, boolean> = {};
                              for (const [pluginId, enabled] of Object.entries(full)) {
                                if (builtInDefaults[pluginId] === undefined || builtInDefaults[pluginId] !== enabled) {
                                  delta[pluginId] = enabled;
                                }
                              }
                              dbSetSetting('plugin.enabled.delta', JSON.stringify(delta));
                              void flushDbToDisk();
                            }
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
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
      </>}
    </div>
  );
};

const OnlinePluginList: React.FC<{
  catalog: MarketplaceCatalog | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
}> = ({ catalog, busy, onRefresh }) => {
  const [installing, setInstalling] = React.useState<string | null>(null);
  const [installedPackages, setInstalledPackages] = React.useState<InstalledPluginState[]>([]);
  const [selectedVersions, setSelectedVersions] = React.useState<Record<string, string>>({});
  const [progress, setProgress] = React.useState<Record<string, PluginInstallProgress>>({});
  const reloadInstalled = React.useCallback(async () => setInstalledPackages(await window.electronAPI.plugins.listInstalled()), []);
  React.useEffect(() => {
    void reloadInstalled().catch((error) => {
      console.error('[PluginManager] Failed to load installed packages', error);
    });
    return window.electronAPI.plugins.onInstallProgress((next) => setProgress((current) => ({ ...current, [next.pluginId]: next })));
  }, [reloadInstalled]);
  const installed = new Map<string, string | undefined>(loadUserPlugins().map((item) => [item.id, item.manifest?.version]));
  installedPackages.forEach((item) => installed.set(item.id, item.activeVersion ?? undefined));
  const install = async (entry: MarketplacePlugin) => {
    setInstalling(entry.id);
    try {
      alert((await installOnlinePlugin(entry, selectedVersions[entry.id] ?? marketplacePluginVersion(entry))).message);
      await reloadInstalled();
    }
    catch (error) { alert(`安装失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setInstalling(null); }
  };
  const runLifecycle = async (operation: () => Promise<unknown>) => {
    try { await operation(); await reloadInstalled(); }
    catch (error) { alert(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="flex-1 overflow-y-auto p-4">
    <div className="mb-4 flex items-center justify-between">
      <div><h3 className="text-sm font-semibold">在线插件</h3><p className="text-xs text-muted-foreground">目录会缓存在本机；插件安装前校验大小与 SHA-256。</p></div>
      <button className="rounded border px-3 py-1.5 text-xs" disabled={busy} onClick={() => void onRefresh()}>{busy ? '刷新中…' : '刷新目录'}</button>
    </div>
    {!catalog ? <p className="py-16 text-center text-sm text-muted-foreground">尚未配置或缓存 Marketplace catalog。</p> :
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{catalog.plugins.map((entry) => {
        const packageState = installedPackages.find((item) => item.id === entry.id);
        const selected = selectedVersions[entry.id] ?? marketplacePluginVersion(entry);
        const currentProgress = progress[entry.id];
        return <div key={entry.id} className="rounded-lg border bg-background p-4">
          <h4 className="text-sm font-medium">{entry.name}</h4><p className="mt-1 min-h-8 text-xs text-muted-foreground">{entry.description || entry.id}</p>
          <div className="mt-3 flex items-center gap-2">
            {entry.versions?.length ? <select className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" value={selected} onChange={(event) => setSelectedVersions((value) => ({ ...value, [entry.id]: event.target.value }))}>
              {[...entry.versions].sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true })).map((release) => <option key={release.version} value={release.version}>{release.version} · {release.channel ?? 'stable'}</option>)}
            </select> : <span className="flex-1 text-xs text-muted-foreground">v{entry.version}</span>}
            <button className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50" disabled={installing === entry.id || packageState?.installedVersions.includes(selected)} onClick={() => void install(entry)}>
              {installing === entry.id ? '安装中…' : packageState?.installedVersions.includes(selected) ? '已安装' : installed.has(entry.id) ? '安装版本' : '安装'}
            </button>
          </div>
          {installing === entry.id && currentProgress && <div className="mt-3"><div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>{currentProgress.phase}</span><span>{currentProgress.percent ?? 0}%</span></div><div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${currentProgress.percent ?? 0}%` }} /></div>{currentProgress.phase === 'downloading' && <button className="mt-1 text-[10px] text-destructive" onClick={() => void window.electronAPI.plugins.cancelInstall(entry.id, selected)}>取消下载</button>}</div>}
          {packageState && <div className="mt-3 border-t pt-3"><div className="text-[10px] text-muted-foreground">当前版本：{packageState.activeVersion ?? '未激活'}</div><div className="mt-2 flex flex-wrap gap-1">{packageState.installedVersions.map((version) => <span key={version} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]">{version}{version !== packageState.activeVersion && <><button className="text-primary" onClick={() => void runLifecycle(() => window.electronAPI.plugins.activateVersion(entry.id, version))}>启用</button><button className="text-destructive" onClick={() => void runLifecycle(() => window.electronAPI.plugins.uninstallVersion(entry.id, version))}>删除</button></>}</span>)}</div>{packageState.previousVersion && <button className="mt-2 text-[10px] text-primary" onClick={() => void runLifecycle(() => window.electronAPI.plugins.rollback(entry.id))}>回滚到 {packageState.previousVersion}</button>}</div>}
        </div>;
      })}</div>}
  </div>;
};

// ── 插件卡片子组件 ──

interface PluginCardProps {
  plugin: ReturnType<typeof pluginRegistry.getAll>[number];
  Icon: React.ComponentType<{ className?: string }>;
  isUserPlugin: boolean;
  isScriptPlugin: boolean;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onToggle: (id: string) => void;
  onRollback: (id: string) => void;
  onLogs: (id: string) => void;
}

const PluginCard: React.FC<PluginCardProps> = ({
  plugin,
  Icon,
  isUserPlugin,
  isScriptPlugin,
  onDelete,
  onExport,
  onToggle,
  onRollback,
  onLogs,
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
        <button className="absolute top-2 left-14 opacity-0 group-hover:opacity-100 text-[10px] text-muted-foreground hover:text-primary" onClick={() => onRollback(plugin.id)} title="回滚上一版本">回滚</button>
        <button className="absolute top-2 left-24 opacity-0 group-hover:opacity-100 text-[10px] text-muted-foreground hover:text-primary" onClick={() => onLogs(plugin.id)} title="查看运行日志">日志</button>
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
