import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Download, ExternalLink, FolderPlus, Globe2, LayoutGrid, List, Pencil, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WebsiteCategory, WebsiteRecord, WebsiteRecordInput } from '../../core/website-registry/types';

type Scope = 'all' | 'favorites' | 'recent' | 'uncategorized' | 'archived' | string;
type EditorState = { record?: WebsiteRecord; values: WebsiteRecordInput };
const emptyValues = (): WebsiteRecordInput => ({ name: '', url: '', description: '', categoryId: null, tags: [], notes: '' });

export function WebsiteRegistryPanel() {
  const [records, setRecords] = useState<WebsiteRecord[]>([]);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [sort, setSort] = useState<'updated' | 'opened' | 'popular' | 'name'>('updated');
  const [view, setView] = useState<'grid' | 'list'>(() => localStorage.getItem('website-registry.view') === 'list' ? 'list' : 'grid');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [nextRecords, nextCategories] = await Promise.all([
      window.electronAPI.websiteRegistry.record.list({}), window.electronAPI.websiteRegistry.category.list(),
    ]);
    setRecords(nextRecords); setCategories(nextCategories);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const create = () => { setNotice(''); setEditor({ values: emptyValues() }); };
    window.addEventListener('website-registry:create', create);
    return () => window.removeEventListener('website-registry:create', create);
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = records.filter((record) => {
      if (scope === 'favorites' && !record.favorite) return false;
      if (scope === 'recent' && !record.lastOpenedAt) return false;
      if (scope === 'uncategorized' && record.categoryId) return false;
      if (scope === 'archived' ? !record.archived : record.archived) return false;
      if (!['all', 'favorites', 'recent', 'uncategorized', 'archived'].includes(scope) && record.categoryId !== scope) return false;
      if (!needle) return true;
      return [record.name, record.url, record.description, record.notes, ...record.tags].some((value) => value.toLowerCase().includes(needle));
    });
    return filtered.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'popular' ? b.openCount - a.openCount : sort === 'opened' ? (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) : b.updatedAt - a.updatedAt);
  }, [records, query, scope, sort]);

  const saveRecord = async () => {
    if (!editor) return; setBusy(true); setNotice('');
    try {
      if (editor.record) await window.electronAPI.websiteRegistry.record.update(editor.record.id, editor.values);
      else await window.electronAPI.websiteRegistry.record.create(editor.values);
      setEditor(null); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const patchRecord = async (record: WebsiteRecord, patch: Partial<WebsiteRecordInput>) => { await window.electronAPI.websiteRegistry.record.update(record.id, patch); await refresh(); };
  const removeRecord = async (record: WebsiteRecord) => { if (!window.confirm(`确定删除“${record.name}”吗？`)) return; await window.electronAPI.websiteRegistry.record.remove(record.id); await refresh(); };
  const openRecord = async (record: WebsiteRecord) => { await window.electronAPI.websiteRegistry.record.open(record.id); await refresh(); };
  const addCategory = async () => { const name = categoryName.trim(); if (!name) return; try { await window.electronAPI.websiteRegistry.category.create(name); setCategoryName(''); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } };
  const removeCategory = async (category: WebsiteCategory) => { if (!window.confirm(`删除分类“${category.name}”？其中的网站将移到未分类。`)) return; await window.electronAPI.websiteRegistry.category.remove(category.id); if (scope === category.id) setScope('all'); await refresh(); };
  const importData = async () => { const result = await window.electronAPI.websiteRegistry.importData(); setNotice(`导入 ${result.imported} 条，跳过重复 ${result.skipped} 条，无效 ${result.invalid} 条`); await refresh(); };

  return <div className="flex h-full min-h-0 bg-background text-foreground">
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card/70">
      <div className="flex items-center gap-2 border-b px-4 py-4"><Globe2 className="h-5 w-5 text-primary" /><div><div className="text-sm font-semibold">网站收藏</div><div className="text-[11px] text-muted-foreground">{records.filter((r) => !r.archived).length} 个网站</div></div></div>
      <nav className="space-y-1 p-2">
        <ScopeButton active={scope === 'all'} onClick={() => setScope('all')} label="全部网站" count={records.filter((r) => !r.archived).length} />
        <ScopeButton active={scope === 'favorites'} onClick={() => setScope('favorites')} label="收藏" count={records.filter((r) => r.favorite && !r.archived).length} />
        <ScopeButton active={scope === 'recent'} onClick={() => setScope('recent')} label="最近打开" />
        <ScopeButton active={scope === 'uncategorized'} onClick={() => setScope('uncategorized')} label="未分类" />
        <ScopeButton active={scope === 'archived'} onClick={() => setScope('archived')} label="已归档" />
      </nav>
      <div className="mt-2 border-t px-3 pt-3"><div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">分类</div>
        <div className="space-y-1">{categories.map((category) => <div key={category.id} className="group flex items-center"><button type="button" onClick={() => setScope(category.id)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${scope === category.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><span className="h-2 w-2 rounded-full" style={{ background: category.color }} /><span className="truncate">{category.name}</span></button><button type="button" className="opacity-0 group-hover:opacity-100" onClick={() => void removeCategory(category)}><X className="h-3 w-3 text-muted-foreground" /></button></div>)}</div>
        <div className="mt-3 flex gap-1"><Input className="h-8 text-xs" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCategory(); }} placeholder="新分类" /><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void addCategory()}><FolderPlus className="h-4 w-4" /></Button></div>
      </div>
    </aside>
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b bg-card/50 px-4 py-3">
        <div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="搜索名称、网址、描述、标签或备注" /></div>
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="updated">最近更新</option><option value="opened">最近打开</option><option value="popular">打开次数</option><option value="name">名称</option></select>
        <Button variant="outline" size="icon" onClick={() => { const next = view === 'grid' ? 'list' : 'grid'; setView(next); localStorage.setItem('website-registry.view', next); }}>{view === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}</Button>
        <Button variant="outline" onClick={() => void importData()}><Upload className="mr-2 h-4 w-4" />导入</Button>
        <Button variant="outline" onClick={() => void window.electronAPI.websiteRegistry.exportData()}><Download className="mr-2 h-4 w-4" />导出</Button>
        <Button onClick={() => { setNotice(''); setEditor({ values: emptyValues() }); }}><Plus className="mr-2 h-4 w-4" />添加网站</Button>
      </header>
      {notice && <div className="border-b bg-primary/5 px-4 py-2 text-xs text-primary">{notice}</div>}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!visible.length ? <div className="grid h-full place-items-center text-center"><div><Globe2 className="mx-auto h-10 w-10 text-muted-foreground/40" /><p className="mt-3 text-sm text-muted-foreground">没有符合条件的网站</p><Button className="mt-4" variant="outline" onClick={() => setEditor({ values: emptyValues() })}>添加第一个网站</Button></div></div> :
          <div className={view === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3' : 'space-y-2'}>{visible.map((record) => <WebsiteItem key={record.id} record={record} category={categories.find((c) => c.id === record.categoryId)} compact={view === 'list'} onOpen={() => void openRecord(record)} onEdit={() => { setNotice(''); setEditor({ record, values: { ...record } }); }} onFavorite={() => void patchRecord(record, { favorite: !record.favorite })} onArchive={() => void patchRecord(record, { archived: !record.archived })} onDelete={() => void removeRecord(record)} />)}</div>}
      </div>
    </main>
    {editor && <Editor editor={editor} categories={categories} busy={busy} notice={notice} onChange={(values) => setEditor({ ...editor, values })} onClose={() => setEditor(null)} onSave={() => void saveRecord()} />}
  </div>;
}

function ScopeButton({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) { return <button type="button" onClick={onClick} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-xs ${active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'}`}><span>{label}</span>{count !== undefined && <span className="text-[10px] text-muted-foreground">{count}</span>}</button>; }

function WebsiteItem({ record, category, compact, onOpen, onEdit, onFavorite, onArchive, onDelete }: { record: WebsiteRecord; category?: WebsiteCategory; compact: boolean; onOpen: () => void; onEdit: () => void; onFavorite: () => void; onArchive: () => void; onDelete: () => void }) {
  return <article className={`group border bg-card shadow-sm transition hover:border-primary/30 hover:shadow-md ${compact ? 'flex items-center gap-3 rounded-lg p-3' : 'rounded-xl p-4'}`}>
    <div className={`flex min-w-0 ${compact ? 'flex-1 items-center gap-3' : 'items-start gap-3'}`}><div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted"><img src={record.faviconUrl || ''} alt="" className="h-6 w-6" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></div><div className="min-w-0 flex-1"><button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-semibold hover:text-primary">{record.name}</button><div className="truncate text-[11px] text-muted-foreground">{record.url}</div>{!compact && record.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{record.description}</p>}<div className={`${compact ? 'ml-auto' : 'mt-3'} flex flex-wrap gap-1`}>{category && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{category.name}</span>}{record.tags.slice(0, compact ? 2 : 4).map((tag) => <span key={tag} className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] text-primary">#{tag}</span>)}</div></div></div>
    <div className={`flex items-center gap-1 ${compact ? '' : 'mt-3 border-t pt-3'}`}><button title="打开" onClick={onOpen} className="rounded p-1.5 hover:bg-muted"><ExternalLink className="h-4 w-4" /></button><button title="收藏" onClick={onFavorite} className="rounded p-1.5 hover:bg-muted"><Star className={`h-4 w-4 ${record.favorite ? 'fill-amber-400 text-amber-500' : ''}`} /></button><button title="编辑" onClick={onEdit} className="rounded p-1.5 hover:bg-muted"><Pencil className="h-4 w-4" /></button><button title={record.archived ? '恢复' : '归档'} onClick={onArchive} className="rounded p-1.5 hover:bg-muted"><Archive className="h-4 w-4" /></button><button title="删除" onClick={onDelete} className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>{!compact && <span className="ml-auto text-[10px] text-muted-foreground">打开 {record.openCount} 次</span>}</div>
  </article>;
}

function Editor({ editor, categories, busy, notice, onChange, onClose, onSave }: { editor: EditorState; categories: WebsiteCategory[]; busy: boolean; notice: string; onChange: (values: WebsiteRecordInput) => void; onClose: () => void; onSave: () => void }) {
  const set = (patch: Partial<WebsiteRecordInput>) => onChange({ ...editor.values, ...patch });
  return <div className="fixed inset-0 z-[1200] flex justify-end bg-black/35" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="flex h-full w-full max-w-lg flex-col bg-card shadow-2xl"><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">{editor.record ? '编辑网站' : '添加网站'}</h2><p className="text-xs text-muted-foreground">收藏并整理需要长期使用的网站资料</p></div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button></header><div className="flex-1 space-y-4 overflow-auto p-5"><Field label="网站名称 *"><Input autoFocus value={editor.values.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如：GitHub" /></Field><Field label="网站地址 *"><Input value={editor.values.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://github.com" /></Field><Field label="描述"><textarea value={editor.values.description || ''} onChange={(e) => set({ description: e.target.value })} className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" placeholder="这个网站有什么用途？" /></Field><Field label="分类"><select value={editor.values.categoryId || ''} onChange={(e) => set({ categoryId: e.target.value || null })} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="标签"><Input value={(editor.values.tags || []).join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} placeholder="开发, 工具, 文档" /></Field><Field label="备注"><textarea value={editor.values.notes || ''} onChange={(e) => set({ notes: e.target.value })} className="min-h-32 w-full rounded-md border bg-background p-3 text-sm" placeholder="补充使用方法、账号提示等（请勿保存密码）" /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!editor.values.favorite} onChange={(e) => set({ favorite: e.target.checked })} />加入收藏</label>{notice && <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{notice}</p>}</div><footer className="flex justify-end gap-2 border-t p-4"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy} onClick={onSave}>{busy ? '保存中…' : '保存'}</Button></footer></section></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5"><span className="text-xs font-medium">{label}</span>{children}</label>; }
