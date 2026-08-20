/**
 * LibraryList — 右侧 Library（已保存文档 + 搜索历史）
 */
import { List, Typography, Space, Tag, Input } from '../ui';
import { FilePenLine, FileText, GitCompareArrows, Search, Settings2, Upload } from 'lucide-react';
import type { Document, SearchHistoryEntry } from '../../../core/work-browser/types';
import { useEffect, useState } from 'react';

export interface LibraryListProps {
  documents: Document[];
  history: SearchHistoryEntry[];
  onOpenDocument: (doc: Document) => void;
  onEditDocument: (doc: Document) => void;
  onCompareDocument: (doc: Document) => void;
  onReplayQuery: (text: string) => void;
  onImportDocument: () => void;
}

export function LibraryList({ documents, history, onOpenDocument, onEditDocument, onCompareDocument, onReplayQuery, onImportDocument }: LibraryListProps) {
  const [doclingUrl, setDoclingUrl] = useState('');
  const [activeView, setActiveView] = useState<'docs' | 'history'>('docs');
  const [showOcrSettings, setShowOcrSettings] = useState(false);
  useEffect(() => { void window.electronAPI.workBrowser.settings.get('workBrowser.docling.baseUrl').then((value) => setDoclingUrl(value || '')); }, []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/70 p-3">
        <div className="grid grid-cols-2 rounded-xl bg-muted/70 p-1">
          <button type="button" onClick={() => setActiveView('docs')} className={`flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition ${activeView === 'docs' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <FileText size={14} />文档<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{documents.length}</span>
          </button>
          <button type="button" onClick={() => setActiveView('history')} className={`flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition ${activeView === 'history' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <Search size={14} />搜索历史
          </button>
        </div>
      </div>

      {activeView === 'docs' ? <div className="min-h-0 flex-1 overflow-auto p-3">
        <button type="button" onClick={onImportDocument} className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-primary/25 bg-primary/[0.035] p-3 text-left transition hover:border-primary/50 hover:bg-primary/[0.07]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Upload size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-foreground">导入本地文档</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">PDF、Word、Excel、PowerPoint</span></span>
        </button>
        <button type="button" onClick={() => setShowOcrSettings((value) => !value)} className="mt-2 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground">
          <span className="flex items-center gap-1.5"><Settings2 size={12} />扫描 PDF OCR</span><span>{showOcrSettings ? '收起' : doclingUrl ? '已配置' : '可选'}</span>
        </button>
        {showOcrSettings && <div className="mt-1 rounded-xl border border-border/70 bg-muted/30 p-2">
          <Input size="small" value={doclingUrl} placeholder="https://your-docling-service" onChange={(event) => setDoclingUrl(event.target.value)} onBlur={() => void window.electronAPI.workBrowser.settings.set('workBrowser.docling.baseUrl', doclingUrl.trim())} />
          <p className="mt-1.5 px-1 text-[10px] leading-4 text-muted-foreground">仅扫描版 PDF 需要，普通文档可直接导入。</p>
        </div>}
        <div className="my-3 h-px bg-border/60" />
        {documents.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground/45"><FileText size={23} /></span>
            <p className="mt-4 text-sm font-medium text-foreground">资料库还是空的</p>
            <p className="mt-1 max-w-52 text-xs leading-5 text-muted-foreground">保存网页或导入本地文档，之后可以统一搜索和研究。</p>
          </div>
        ) : (
                <List
                  size="small"
                  dataSource={documents}
                  renderItem={(d) => (
                    <List.Item onClick={() => onOpenDocument(d)} className="mb-1 cursor-pointer rounded-xl border border-transparent transition hover:border-border hover:bg-accent">
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <div className="flex w-full items-center gap-2">
                          <Typography.Text strong ellipsis className="min-w-0 flex-1">{d.title}</Typography.Text>
                          <button
                            type="button"
                            title="比较最近两个版本"
                            aria-label={`比较 ${d.title} 的版本`}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                            onClick={(event) => { event.stopPropagation(); onCompareDocument(d); }}
                          >
                            <GitCompareArrows size={13} />
                          </button>
                          <button
                            type="button"
                            title="在 Markdown 编辑器中打开"
                            aria-label={`编辑 ${d.title}`}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                            onClick={(event) => { event.stopPropagation(); onEditDocument(d); }}
                          >
                            <FilePenLine size={13} />
                          </button>
                        </div>
                        <Space size={4}>
                          <Tag style={{ fontSize: 10 }}>{d.sourceType}</Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{d.wordCount} 词</Typography.Text>
                        </Space>
                        {d.summary && <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0, fontSize: 12 }}>{d.summary}</Typography.Paragraph>}
                      </Space>
                    </List.Item>
                  )}
                />
        )}
      </div> : <div className="min-h-0 flex-1 overflow-auto p-3">
        {history.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground/45"><Search size={23} /></span>
            <p className="mt-4 text-sm font-medium text-foreground">还没有搜索记录</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">搜索过的内容会出现在这里，方便快速重放。</p>
          </div>
        ) : (
                <List
                  size="small"
                  dataSource={history}
                  renderItem={(h) => (
                    <List.Item onClick={() => onReplayQuery(h.text)} className="mb-1 cursor-pointer rounded-xl border border-transparent transition hover:border-border hover:bg-accent">
                      <div className="flex min-w-0 flex-col gap-1">
                        <Typography.Text ellipsis className="text-xs font-medium">{h.text}</Typography.Text>
                        <Typography.Text type="secondary" className="text-[10px]">{h.resultCount} 条结果 · {new Date(h.executedAt).toLocaleString('zh-CN')}</Typography.Text>
                      </div>
                    </List.Item>
                  )}
                />
        )}
      </div>}
    </div>
  );
}
