import React, { useState, useEffect } from 'react';
import { X, Download } from '@/components/icons';
import { Button } from '@/components/ui/button';

interface Props {
  /** 是否显示 */
  open: boolean;
  /** 提取对话内容的回调（由父组件执行 webview JS） */
  onExtract: () => Promise<string>;
  onSave: (title: string, notes: string, content: string) => void;
  onClose: () => void;
}

export const SaveConversationPanel: React.FC<Props> = ({
  open,
  onExtract,
  onSave,
  onClose,
}) => {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [content, setContent] = useState('');
  const [extracting, setExtracting] = useState(false);

  // 关闭时重置表单
  useEffect(() => {
    if (!open) {
      setTitle('');
      setNotes('');
      setContent('');
    }
  }, [open]);

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const text = await onExtract();
      setContent(text);
    } catch {
      // 静默失败
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = () => {
    if (!title.trim()) return;
    onSave(title.trim(), notes.trim(), content.trim());
  };

  if (!open) return null;

  return (
    <div className="w-[380px] flex-shrink-0 border-l flex flex-col bg-card h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-background">
        <h3 className="text-xs font-semibold text-muted-foreground">
          保存对话
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* 表单 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 标题 */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            标题 <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：React 性能优化讨论"
            className="w-full text-sm p-2 rounded-md border focus:outline-none focus:ring-2 ring-ring bg-card"
            autoFocus
          />
        </div>

        {/* 备注 */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            备注 <span className="text-foreground">（可选）</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="对话摘要、关键结论等..."
            className="w-full h-20 text-sm p-2 rounded-md border resize-none focus:outline-none focus:ring-2 ring-ring bg-card"
          />
        </div>

        {/* 对话内容 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-muted-foreground">
              对话内容
            </label>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={handleExtract}
              disabled={extracting}
            >
              <Download className="h-3 w-3" />
              {extracting ? '提取中...' : '从页面提取'}
            </Button>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="在此粘贴或从页面提取对话内容..."
            className="w-full h-64 text-sm p-2 rounded-md border resize-none focus:outline-none focus:ring-2 ring-ring bg-card font-mono leading-relaxed"
          />
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="px-3 py-2 border-t bg-background">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-primary hover:bg-primary-hover text-white"
            onClick={handleSave}
            disabled={!title.trim()}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
};
