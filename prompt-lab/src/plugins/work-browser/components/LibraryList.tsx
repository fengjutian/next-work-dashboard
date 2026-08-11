/**
 * LibraryList — 右侧 Library（已保存文档 + 搜索历史）
 */
import { Tabs, List, Typography, Empty, Space, Tag } from '../ui';
import { FileText, Search } from 'lucide-react';
import type { Document, SearchHistoryEntry } from '../../../core/work-browser/types';

export interface LibraryListProps {
  documents: Document[];
  history: SearchHistoryEntry[];
  onOpenDocument: (doc: Document) => void;
  onReplayQuery: (text: string) => void;
}

export function LibraryList({ documents, history, onOpenDocument, onReplayQuery }: LibraryListProps) {
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
              {documents.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有保存的文档" />
              ) : (
                <List
                  size="small"
                  dataSource={documents}
                  renderItem={(d) => (
                    <List.Item onClick={() => onOpenDocument(d)} className="mb-1 cursor-pointer rounded-xl border border-transparent transition hover:border-border hover:bg-accent">
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Typography.Text strong ellipsis style={{ width: '100%' }}>{d.title}</Typography.Text>
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
