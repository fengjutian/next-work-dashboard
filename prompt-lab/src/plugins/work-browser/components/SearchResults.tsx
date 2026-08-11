/**
 * SearchResults — 搜索结果弹层
 */
import { Card, List, Tag, Space, Typography, Empty, Spin, Button, Drawer, Tag as AntTag } from '../ui';
import { Globe, BookMarked, BookOpen } from 'lucide-react';
import type { AggregatedSearchResponse } from '../../../core/work-browser/types';
import { AiSummaryCard } from './AiSummary';

export interface SearchResultsProps {
  open: boolean;
  onClose: () => void;
  data: AggregatedSearchResponse | null;
  loading: boolean;
  onOpen: (url: string) => void;
}

function sourceIcon(source: string) {
  if (source.includes('github')) return <BookMarked size={14} />;
  if (source.includes('stackoverflow')) return <BookOpen size={14} />;
  return <Globe size={14} />;
}

export function SearchResults({ open, onClose, data, loading, onOpen }: SearchResultsProps) {
  return (
    <Drawer
      title="搜索结果"
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      {loading && <Spin tip="多引擎并行搜索中…" style={{ display: 'block', margin: '24px auto' }} />}
      {!loading && data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {data.aiSummary && <AiSummaryCard summary={data.aiSummary} />}
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {data.results.length} 条结果 · {data.providers.length} 个引擎 · {data.took} ms
            </Typography.Text>
            <Space size={4} style={{ marginLeft: 8 }}>
              {data.providers.map((p) => (
                <Tag key={p.providerId} color={p.ok ? 'blue' : 'red'} style={{ fontSize: 11 }}>
                  {p.providerId} · {p.count}
                </Tag>
              ))}
            </Space>
          </div>
          {data.results.length === 0 ? (
            <Empty description="没有命中" />
          ) : (
            <List
              dataSource={data.results}
              renderItem={(r) => (
                <Card size="small" hoverable style={{ marginBottom: 8 }}>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space>
                      {sourceIcon(r.source)}
                      <Typography.Link onClick={() => onOpen(r.url)} target="_blank" strong>
                        {r.title}
                      </Typography.Link>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.domain}</Typography.Text>
                      <AntTag>{r.source}</AntTag>
                    </Space>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
                      {r.snippet}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.canonicalUrl}</Typography.Text>
                  </Space>
                </Card>
              )}
            />
          )}
          <Button block onClick={onClose}>关闭</Button>
        </Space>
      )}
    </Drawer>
  );
}
