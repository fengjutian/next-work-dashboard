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
            <div style={{ overflow: 'auto', maxHeight: '100%' }}>
              {documents.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有保存的文档" />
              ) : (
                <List
                  size="small"
                  dataSource={documents}
                  renderItem={(d) => (
                    <List.Item onClick={() => onOpenDocument(d)} style={{ cursor: 'pointer' }}>
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
            <div style={{ overflow: 'auto', maxHeight: '100%' }}>
              {history.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有搜索" />
              ) : (
                <List
                  size="small"
                  dataSource={history}
                  renderItem={(h) => (
                    <List.Item onClick={() => onReplayQuery(h.text)} style={{ cursor: 'pointer' }}>
                      <Typography.Text ellipsis style={{ width: '100%' }}>{h.text}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{h.resultCount} 条 · {new Date(h.executedAt).toLocaleString('zh-CN')}</Typography.Text>
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
