/**
 * storagePath 边界校验 — H4 修复
 */
import { describe, it, expect } from 'vitest';
import { normalizeStoragePath } from '@/main/work-browser/workspace-store';

describe('normalizeStoragePath', () => {
  it('空输入返回空字符串（让 caller 走 app.getPath 兜底）', () => {
    expect(normalizeStoragePath('')).toBe('');
    expect(normalizeStoragePath(undefined)).toBe('');
    expect(normalizeStoragePath(null)).toBe('');
  });

  it('绝对路径 resolve 后保留', () => {
    if (process.platform === 'win32') {
      expect(normalizeStoragePath('C:\\Users\\test\\docs')).toBe('C:\\Users\\test\\docs');
      expect(normalizeStoragePath('D:/data')).toMatch(/^D:\\data$/);
    } else {
      expect(normalizeStoragePath('/var/data')).toBe('/var/data');
      expect(normalizeStoragePath('/var/data/')).toBe('/var/data');
    }
  });

  it('拒绝包含 .. 的路径（防止 traversal）', () => {
    expect(() => normalizeStoragePath('/var/data/../etc/passwd')).toThrow(/INVALID_STORAGE_PATH/);
    expect(() => normalizeStoragePath('C:\\Users\\..\\Windows')).toThrow(/INVALID_STORAGE_PATH/);
  });

  it('显式 .. 段直接拒绝（不靠 resolve 救场）', () => {
    expect(() => normalizeStoragePath('./foo/../bar')).toThrow(/INVALID_STORAGE_PATH/);
  });
});
