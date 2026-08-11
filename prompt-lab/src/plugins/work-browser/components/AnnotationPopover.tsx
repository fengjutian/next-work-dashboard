/**
 * AnnotationPopover — 选中文字后的浮动菜单
 *
 * 菜单选项：
 *  - 🟡 高亮 (no note)
 *  - 📝 添加笔记
 *  - ❌ 取消
 */
import { Card, Input, Space, Button, Tooltip } from '../ui';
import { Highlighter, Notebook, X } from 'lucide-react';
import { useState } from 'react';

export interface AnnotationPopoverProps {
  text: string;
  x: number;
  y: number;
  onSave: (note: string, color: 'yellow' | 'green' | 'red' | 'blue') => void | Promise<void>;
  onCancel: () => void;
}

export function AnnotationPopover({ text, x, y, onSave, onCancel }: AnnotationPopoverProps) {
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'menu' | 'note'>('menu');

  const handleHighlight = () => {
    void onSave('', 'yellow');
  };
  const handleAddNote = () => setStep('note');

  return (
    <div
      style={{
        position: 'fixed',
        top: Math.min(y, window.innerHeight - 200),
        left: Math.min(Math.max(x - 150, 8), window.innerWidth - 320),
        zIndex: 1000,
        width: 320,
      }}
    >
      <Card
        size="small"
        style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
        bodyStyle={{ padding: 8 }}
      >
        {step === 'menu' && (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#666', maxHeight: 60, overflow: 'auto', padding: 4, background: '#fffbe6', borderRadius: 4 }}>
              "{text.length > 120 ? text.slice(0, 120) + '…' : text}"
            </div>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Tooltip title="仅高亮，无笔记">
                <Button icon={<Highlighter size={14} />} onClick={handleHighlight}>高亮</Button>
              </Tooltip>
              <Tooltip title="高亮 + 笔记">
                <Button type="primary" icon={<Notebook size={14} />} onClick={handleAddNote}>添加笔记</Button>
              </Tooltip>
              <Button icon={<X size={14} />} onClick={onCancel} />
            </Space>
          </Space>
        )}
        {step === 'note' && (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#666' }}>笔记（可选）</div>
            <Input.TextArea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="写下你的想法…"
            />
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setStep('menu')}>返回</Button>
              <Button size="small" type="primary" onClick={() => void onSave(note, 'yellow')}>保存</Button>
            </Space>
          </Space>
        )}
      </Card>
    </div>
  );
}
