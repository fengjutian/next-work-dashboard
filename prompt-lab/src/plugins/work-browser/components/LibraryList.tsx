/**
 * LibraryList — 右侧 Library（已保存文档 + 搜索历史）
 */
import { Tabs, List, Typography, Empty, Space, Tag, Input } from '../ui';
import { FilePenLine, FileText, GitCompareArrows, Search, Upload } from 'lucide-react';
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
  useEffect(() => { void window.electronAPI.workBrowser.settings.get('workBrowser.docling.baseUrl').then((value) => setDoclingUrl(value || '')); }, []);
  return (
    <Tabs
      size="small"
      style={{ height: '100%' }}
      items={[
        {
          key: 'docs',
          label: <span><FileText size={12} /> 文档 ({documents.length})</span>,
          children: (
            <div className="max-h-full overflow-auto p-2">
              <button type="button" onClick={onImportDocument} className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                <Upload size={13} />导入 PDF / Word / Excel / PowerPoint
              </button>
              <Input value={doclingUrl} placeholder="Docling URL（扫描 PDF OCR，可选）" onChange={(event) => setDoclingUrl(event.target.value)} onBlur={() => void window.electronAPI.workBrowser.settings.set('workBrowser.docling.baseUrl', doclingUrl.trim())} />
              {documents.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有保存的文档" />
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
            </div>
          ),
        },
        {
          key: 'history',
          label: <span><Search size={12} /> 搜索历史</span>,
          children: (
            <div className="max-h-full overflow-auto p-2">
              {history.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有搜索" />
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
            </div>
          ),
        },
      ]}
    />
  );
}
