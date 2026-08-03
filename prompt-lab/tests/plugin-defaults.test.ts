import { describe, expect, it } from 'vitest';
import { EXCEL_PREVIEW_DEFAULT_ENABLED, getUserPluginDefaultEnabled } from '../src/plugins/defaults';

describe('plugin defaults', () => {
  it('keeps the Excel plugin disabled by default', () => {
    expect(EXCEL_PREVIEW_DEFAULT_ENABLED).toBe(false);
  });

  it('disables 今日待办 by default', () => {
    expect(getUserPluginDefaultEnabled({ name: '今日待办' })).toBe(false);
  });

  it('disables Excel 阅读器 by default and normalizes whitespace', () => {
    expect(getUserPluginDefaultEnabled({ name: 'Excel 阅读器' })).toBe(false);
    expect(getUserPluginDefaultEnabled({ name: 'Excel  阅读器' })).toBe(false);
  });

  it('keeps other user plugins enabled and respects explicit settings', () => {
    expect(getUserPluginDefaultEnabled({ name: '其他插件' })).toBe(true);
    expect(getUserPluginDefaultEnabled({ name: '今日待办', enabled: true })).toBe(true);
  });
});
