import { describe, expect, it } from 'vitest';
import {
  decodeWorkspaceText,
  encodeWorkspaceText,
  fileWasModified,
} from '../src/main/workspace/text';

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
      mixedLineEndings: false,
    });
    expect(encodeWorkspaceText(decoded.content, decoded)).toEqual(source);
  });

  it('按照原换行符写回编辑器规范化后的内容', () => {
    expect(encodeWorkspaceText('a\nb\n', { lineEnding: 'CRLF' }).toString('utf-8'))
      .toBe('a\r\nb\r\n');
  });

  it('拒绝二进制内容', () => {
    expect(() => decodeWorkspaceText(Buffer.from([0x61, 0x00, 0x62]))).toThrow('BINARY_FILE');
  });

  it('识别并往返写入 UTF-16 与 GBK', () => {
    const utf16 = encodeWorkspaceText('你好\r\n', { encoding: 'utf16le', lineEnding: 'CRLF' });
    expect(decodeWorkspaceText(utf16)).toMatchObject({
      content: '你好\r\n',
      encoding: 'utf16le',
      lineEnding: 'CRLF',
    });

    const gbk = encodeWorkspaceText('中文', { encoding: 'gbk' });
    expect(decodeWorkspaceText(gbk)).toMatchObject({ content: '中文', encoding: 'gbk' });
  });

  it('检测混合换行符和外部修改时间冲突', () => {
    expect(decodeWorkspaceText(Buffer.from('a\r\nb\n', 'utf-8'))).toMatchObject({
      lineEnding: 'LF',
      mixedLineEndings: true,
    });
    expect(fileWasModified(200, 100)).toBe(true);
    expect(fileWasModified(100.5, 100)).toBe(false);
  });
});
