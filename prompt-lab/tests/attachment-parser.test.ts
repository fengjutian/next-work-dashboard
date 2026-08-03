import { describe, expect, it } from 'vitest';
import { buildAttachmentContext } from '../src/plugins/chat/attachment-parser';

describe('聊天附件上下文', () => {
  it('把解析后的文件内容包装成模型可识别的附件区块', () => {
    const context = buildAttachmentContext([{
      name: 'example.ts',
      type: 'ts',
      content: 'export const value = 1;',
      originalLength: 23,
      truncated: false,
    }]);

    expect(context).toContain('<attachment name="example.ts" type="ts">');
    expect(context).toContain('export const value = 1;');
    expect(context).toContain('</attachment>');
  });
});
