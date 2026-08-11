/**
 * MarkdownStatusBar — 状态栏。
 *
 * 从左到右展示：
 *  - 保存状态
 *  - 字数 / 行数
 *  - 模式
 *  - 换行符 / 编码
 *  - 往返安全
 *  - 外部变化提示
 *  - 显式保存按钮
 */

import React from 'react';
import { CheckCircle, Save, ShieldAlert, Info } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MarkdownDocument } from '../types';

export interface MarkdownStatusBarProps {
  document: MarkdownDocument;
  onSave(): void;
}

export const MarkdownStatusBar: React.FC<MarkdownStatusBarProps> = ({ document, onSave }) => {
  return (
    <footer className="flex h-7 flex-shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground">
      <SaveStatus doc={document} />
      <Sep />
      <span>字数 {document.charCount.toLocaleString()}</span>
      <span>行数 {document.lineCount.toLocaleString()}</span>
      <Sep />
      <span>模式 {document.mode === 'visual' ? '可视化' : '源码'}</span>
      <Sep />
      <span>换行 {document.lineEnding === 'crlf' ? 'CRLF' : 'LF'}</span>
      <Sep />
      <RoundtripBadge doc={document} />
      <div className="flex-1" />
      {document.mode === 'visual' && (
        <span className="hidden text-[10px] text-muted-foreground md:inline" title="按住 Ctrl 或 Cmd 点击 [[wiki link]] 跳转">
          Ctrl/Cmd+点击 [[…]] 跳转
        </span>
      )}
      {document.dirty && (
        <button
          type="button"
          onClick={onSave}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-accent hover:text-foreground"
        >
          <Save className="h-3 w-3" />
          <span>保存</span>
        </button>
      )}
    </footer>
  );
};

const Sep: React.FC = () => <span className="h-3 w-px bg-border" />;

const SaveStatus: React.FC<{ doc: MarkdownDocument }> = ({ doc }) => {
  if (doc.dirty) {
    return (
      <span className="flex items-center gap-1 text-amber-600">
        <Info className="h-3 w-3" />
        <span>未保存</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-emerald-600">
      <CheckCircle className="h-3 w-3" />
      <span>已保存</span>
    </span>
  );
};

const RoundtripBadge: React.FC<{ doc: MarkdownDocument }> = ({ doc }) => {
  if (doc.roundtrip === 'safe') {
    return (
      <span className="flex items-center gap-1 text-emerald-600">
        <CheckCircle className="h-3 w-3" />
        <span>往返安全</span>
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-1 text-rose-500')} title={doc.roundtripReason ?? ''}>
      <ShieldAlert className="h-3 w-3" />
      <span>源码模式</span>
    </span>
  );
};
