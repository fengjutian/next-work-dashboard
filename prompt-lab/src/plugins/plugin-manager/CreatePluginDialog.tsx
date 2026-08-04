import React from 'react';
import { X, Code, ShieldCheck } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { loadUserPlugins, saveUserPlugins, registerUserPlugin } from './user-plugin-store';
import type { UserPluginDef } from './user-plugin-store';
import type { PluginPermission, PluginManifest, PluginConfigDeclaration } from '../sandbox/types';

// ── 新建插件弹层 ──

interface CreatePluginDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export const CreatePluginDialog: React.FC<CreatePluginDialogProps> = ({
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
  // 清单字段
  const [formVersion, setFormVersion] = React.useState('0.1.0');
  const [formDescription, setFormDescription] = React.useState('');
  const [formAuthor, setFormAuthor] = React.useState('');
  const [formIconEmoji, setFormIconEmoji] = React.useState('📊');
  const [formConfig, setFormConfig] = React.useState<PluginConfigDeclaration[]>([]);

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
    const manifest: PluginManifest = {
      id,
      name,
      version: formVersion || '0.1.0',
      apiVersion: '1',
      description: formDescription || undefined,
      author: formAuthor || undefined,
      iconEmoji: formIconEmoji || undefined,
      permissions: formPermissions,
      config: formConfig.length > 0 ? formConfig : undefined,
      runtime: 'sandbox',
    };

    // 持久化 + 注册
    const defs = loadUserPlugins();
    const def: UserPluginDef = {
      id,
      name,
      content: formContent,
      script: formScript || undefined,
      style: formStyle || undefined,
      permissions: formPermissions.length > 0 ? formPermissions : undefined,
      iconEmoji: formIconEmoji || undefined,
      manifest,
    };
    defs.push(def);
    saveUserPlugins(defs);

    registerUserPlugin(def);

    onCreated();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-foreground">
            新建插件
          </h3>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 表单 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* 选项卡切换 */}
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {([
              ['basic', '基础模式'],
              ['advanced', '高级模式（脚本）'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  activeTab === key
                    ? 'bg-white bg-accent text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
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
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                插件名称 <span className="text-destructive">*</span>
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-card border-border text-foreground outline-none focus:border-primary"
                placeholder="例如：今日待办"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onBlur={handleNameBlur}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                插件 ID
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-card border-border text-foreground outline-none focus:border-primary font-mono"
                placeholder="自动生成"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
              />
            </div>
          </div>

          {/* 清单字段（版本 + 图标 + 描述） */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                版本
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-card border-border text-foreground outline-none focus:border-primary font-mono"
                placeholder="0.1.0"
                value={formVersion}
                onChange={(e) => setFormVersion(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                图标 Emoji
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-card border-border text-foreground outline-none focus:border-primary"
                placeholder="📊"
                value={formIconEmoji}
                onChange={(e) => setFormIconEmoji(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                作者
              </label>
              <input
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-card border-border text-foreground outline-none focus:border-primary"
                placeholder="选填"
                value={formAuthor}
                onChange={(e) => setFormAuthor(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              描述
            </label>
            <input
              className="w-full px-2 py-1.5 text-sm border rounded-md bg-card border-border text-foreground outline-none focus:border-primary"
              placeholder="简短描述插件功能"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </div>

          {/* ── 基础模式：Markdown 内容 ── */}
          {activeTab === 'basic' && (
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                内容（支持 Markdown）
              </label>
              <textarea
                className="w-full px-2 py-1.5 text-sm border rounded-md bg-card border-border text-foreground outline-none focus:border-primary resize-none"
                rows={5}
                placeholder={"**标题**\n- 列表项 1\n- 列表项 2\n\n[链接](https://example.com)"}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                无需编程，支持 Markdown 格式。适合便签、说明文档、备忘等。
              </p>
            </div>
          )}

          {/* ── 高级模式：脚本编辑器 + 权限 ── */}
          {activeTab === 'advanced' && (
            <>
              {/* 脚本编辑 */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
                  <Code className="h-3.5 w-3.5" />
                  JavaScript 脚本
                  <span className="text-destructive">*</span>
                </label>
                <textarea
                  className="w-full px-2 py-1.5 text-xs font-mono border rounded-md bg-background border-border text-foreground outline-none focus:border-primary resize-none"
                  rows={10}
                  placeholder={"// 使用 PluginSDK 构建交互式插件\nconst { ui, store, actions, data } = PluginSDK;\n\n// 1. 设置初始 UI\nui.setContent('\\n  <div class=\"pk-card\">\\n    <h3>我的数据面板</h3>\\n    <button id=\"btn\" class=\"pk-btn pk-primary\">加载数据</button>\\n    <div id=\"result\"></div>\\n  </div>\\n');\n\n// 2. 绑定事件\ndocument.getElementById('btn').addEventListener('click', async () => {\n  const prompts = await store.getPrompts();\n  document.getElementById('result').innerHTML =\n    '共 ' + prompts.length + ' 条提示词';\n});"}
                  value={formScript}
                  onChange={(e) => setFormScript(e.target.value)}
                  spellCheck={false}
                />
              </div>

              {/* 自定义样式 */}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  自定义 CSS（可选）
                </label>
                <textarea
                  className="w-full px-2 py-1.5 text-xs font-mono border rounded-md bg-background border-border text-foreground outline-none focus:border-primary resize-none"
                  rows={3}
                  placeholder={"/* 自定义样式 */\n#result { color: var(--foreground); }"}
                  value={formStyle}
                  onChange={(e) => setFormStyle(e.target.value)}
                  spellCheck={false}
                />
              </div>

              {/* 权限选择 */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1.5">
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
                            ? 'border-primary bg-primary-light border-primary bg-primary-light'
                            : 'border-border hover:border-border'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 accent-primary"
                          checked={checked}
                          onChange={() => togglePermission(perm as PluginPermission)}
                        />
                        <div>
                          <div className="text-[11px] font-semibold text-foreground">
                            {title}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{desc}</div>
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
          <span className="text-[10px] text-muted-foreground">
            Esc 取消
          </span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent rounded-md transition-colors"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="px-4 py-1.5 text-xs font-medium bg-primary hover:bg-primary-hover text-white rounded-md transition-colors disabled:opacity-40"
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
