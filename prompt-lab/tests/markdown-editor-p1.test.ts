/**
 * P1 单测：纯函数覆盖。
 *
 * - Slash Command filter / find
 * - Image asset path 计算 / 类型识别 / 大小阈值
 * - Wiki Link 文本生成（虽然具体插入由 suggestion 处理，但路径规范化可测）
 */

import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS, filterCommands, findCommand } from '../src/plugins/markdown-editor/editor/slash-commands';
import { isImageFile, pickAssetPath, shouldStoreOnDisk, IMAGE_INLINE_LIMIT_BYTES } from '../src/plugins/markdown-editor/editor/image-paths';

describe('slash commands', () => {
  it('exposes a baseline command set', () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(5);
    expect(SLASH_COMMANDS.some((c) => c.id === 'h1')).toBe(true);
    expect(SLASH_COMMANDS.some((c) => c.id === 'table')).toBe(true);
  });

  it('returns all commands when query is empty', () => {
    expect(filterCommands('').length).toBe(SLASH_COMMANDS.length);
  });

  it('filters by id / title / keyword', () => {
    const titleMatches = filterCommands('标题');
    expect(titleMatches.length).toBeGreaterThan(0);
    expect(titleMatches.every((c) => c.title.includes('标题'))).toBe(true);

    const idMatches = filterCommands('table');
    expect(idMatches.some((c) => c.id === 'table')).toBe(true);

    const keywordMatches = filterCommands('todo');
    expect(keywordMatches.some((c) => c.id === 'task')).toBe(true);
  });

  it('findCommand returns the matching item or undefined', () => {
    expect(findCommand('h1')?.id).toBe('h1');
    expect(findCommand('not-a-command')).toBeUndefined();
  });

  it('matches case-insensitively', () => {
    const matches = filterCommands('H1');
    expect(matches.some((c) => c.id === 'h1')).toBe(true);
  });
});

describe('image asset path', () => {
  it('recognizes common image types', () => {
    expect(isImageFile({ name: 'foo.png', type: 'image/png' })).toBe(true);
    expect(isImageFile({ name: 'foo.jpg', type: 'image/jpeg' })).toBe(true);
    expect(isImageFile({ name: 'foo.svg', type: 'image/svg+xml' })).toBe(true);
    // 仅靠扩展名也能识别
    expect(isImageFile({ name: 'no-mime.gif' })).toBe(true);
    // 非图片
    expect(isImageFile({ name: 'doc.pdf', type: 'application/pdf' })).toBe(false);
    expect(isImageFile({ name: 'foo.txt' })).toBe(false);
  });

  it('generates assets/ paths for root-level documents', () => {
    const path = pickAssetPath('notes.md', 'screenshot.png');
    expect(path).toMatch(/^assets\/screenshot-\d{8}-\d{6}\.png$/);
  });

  it('uses ../assets/ for nested documents', () => {
    const path = pickAssetPath('daily/2026-08-11.md', 'photo.jpg');
    expect(path).toMatch(/^\.\.\/assets\/photo-\d{8}-\d{6}\.jpg$/);
  });

  it('falls back to assets/ when no document path is given', () => {
    const path = pickAssetPath(null, 'orphan.png');
    expect(path).toMatch(/^assets\/orphan-\d{8}-\d{6}\.png$/);
  });

  it('sanitizes unsafe characters in filename', () => {
    const path = pickAssetPath(null, '屏幕 截图 2026.png');
    expect(path).not.toContain(' ');
    expect(path).toMatch(/^assets\/屏幕-截图-2026-\d{8}-\d{6}\.png$/);
  });

  it('extracts extension correctly', () => {
    const png = pickAssetPath(null, 'pic.PNG');
    expect(png).toMatch(/\.png$/);
    const jpeg = pickAssetPath(null, 'pic.jpeg');
    expect(jpeg).toMatch(/\.jpeg$/);
  });
});

describe('image size policy', () => {
  it('stores on disk when in workspace and below limit', () => {
    expect(shouldStoreOnDisk(IMAGE_INLINE_LIMIT_BYTES - 1, true)).toBe(true);
    expect(shouldStoreOnDisk(0, true)).toBe(true);
  });

  it('inlines as base64 when no workspace', () => {
    expect(shouldStoreOnDisk(1024, false)).toBe(false);
  });

  it('inlines as base64 when above limit', () => {
    expect(shouldStoreOnDisk(IMAGE_INLINE_LIMIT_BYTES + 1, true)).toBe(false);
    expect(shouldStoreOnDisk(10 * 1024 * 1024, true)).toBe(false);
  });
});
