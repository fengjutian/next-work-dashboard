import { describe, expect, it } from 'vitest';
import { decodeWorkspaceText, encodeWorkspaceText } from '../src/main/workspace-text';

describe('工作区文本编码', () => {
  it('识别并保留 UTF-8 BOM 和 CRLF', () => {
    const source = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('第一行\r\n第二行\r\n', 'utf-8'),
    ]);
    const decoded = decodeWorkspaceText(source);
    expect(decoded).toEqual({
      content: '第一行\r\n第二行\r\n',
      encoding: 'utf8bom',
      lineEnding: 'CRLF',
    });
    expect(encodeWorkspaceText(decoded.content, decoded)).toEqual(source);
  });

  it('按照原换行符写回编辑器规范化后的内容', () => {
    expect(encodeWorkspaceText('a\nb\n', { lineEnding: 'CRLF' }).toString('utf-8'))
      .toBe('a\r\nb\r\n');
  });

  it('拒绝二进制和非 UTF-8 内容', () => {
    expect(() => decodeWorkspaceText(Buffer.from([0x61, 0x00, 0x62]))).toThrow('BINARY_FILE');
    expect(() => decodeWorkspaceText(Buffer.from([0xff, 0xfe, 0x61]))).toThrow('UNSUPPORTED_ENCODING');
  });
});
