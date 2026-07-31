import { describe, expect, it } from 'vitest';
import { decodeBase64Utf8, languageFromName } from '../src/plugins/code-editor/CodeEditorPanel';

describe('代码编辑器', () => {
  it('正确解码 UTF-8 文件', () => {
    const text = 'const message = "你好";';
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });

    expect(decodeBase64Utf8(btoa(binary))).toBe(text);
  });

  it('拒绝包含空字节的二进制文件', () => {
    expect(() => decodeBase64Utf8(btoa('a\u0000b'))).toThrow('二进制');
  });

  it('根据文件名识别语言', () => {
    expect(languageFromName('App.tsx')).toBe('TypeScript React');
    expect(languageFromName('main.py')).toBe('Python');
    expect(languageFromName('Dockerfile')).toBe('Dockerfile');
  });
});
