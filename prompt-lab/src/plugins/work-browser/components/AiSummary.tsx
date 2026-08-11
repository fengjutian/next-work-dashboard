/**
 * AiSummaryCard — AI 摘要展示
 */
import { Card, Typography, Space, Tag } from '../ui';
import { Sparkles } from 'lucide-react';

export interface AiSummaryCardProps {
  summary: string;
  source?: string;
}

export function AiSummaryCard({ summary, source }: AiSummaryCardProps) {
  return (
    <Card size="small" style={{ background: '#fafbff', borderColor: '#adc6ff' }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space>
          <Sparkles size={14} color="#7c3aed" />
          <Typography.Text strong>AI 摘要</Typography.Text>
          {source && <Tag color="purple" style={{ fontSize: 11 }}>{source}</Tag>}
        </Space>
        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
          {summary}
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          ⚠ 引用事实以 [n] 标注原始来源编号；请勿在缺乏引用的情况下使用本摘要。
        </Typography.Text>
      </Space>
    </Card>
  );
}
