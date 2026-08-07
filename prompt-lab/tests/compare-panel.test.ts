// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/monaco-setup', () => ({ configureMonaco: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => createElement('div', {
    'data-testid': 'diff-editor',
    'data-original': original,
    'data-modified': modified,
  }),
}));

import { ComparePanel } from '../src/plugins/compare/ComparePanel';
import { useStore } from '../src/store';

const pickFile = vi.fn();
const writeTextFile = vi.fn();
const saveFile = vi.fn();

describe('ComparePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useStore.getState().setActiveActivity('ai');
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { pickFile, writeTextFile, saveFile },
    });
  });
  afterEach(() => cleanup());

  it('swaps the two input documents', () => {
    render(createElement(ComparePanel));
    const left = screen.getByLabelText('左侧文本') as HTMLTextAreaElement;
    const right = screen.getByLabelText('右侧文本') as HTMLTextAreaElement;
    const originalLeft = left.value;
    const originalRight = right.value;
    fireEvent.click(screen.getByRole('button', { name: '交换左右' }));
    expect(left.value).toBe(originalRight);
    expect(right.value).toBe(originalLeft);
  });

  it('applies the selected left-side hunk to the right', () => {
    render(createElement(ComparePanel));
    fireEvent.change(screen.getByLabelText('左侧文本'), { target: { value: 'a\nleft\nz' } });
    fireEvent.change(screen.getByLabelText('右侧文本'), { target: { value: 'a\nright\nz' } });
    fireEvent.click(screen.getByRole('button', { name: '应用 →' }));
    expect((screen.getByLabelText('右侧文本') as HTMLTextAreaElement).value).toBe('a\nleft\nz');
  });

  it('persists display preferences and compares normalized content', () => {
    render(createElement(ComparePanel));
    fireEvent.change(screen.getByLabelText('左侧文本'), { target: { value: 'Hello\n\nWORLD' } });
    fireEvent.change(screen.getByLabelText('右侧文本'), { target: { value: 'hello\nworld' } });
    fireEvent.click(screen.getByLabelText('忽略大小写'));
    fireEvent.click(screen.getByLabelText('忽略空行'));
    const editor = screen.getByTestId('diff-editor');
    expect(editor.getAttribute('data-original')).toBe('hello\nworld');
    expect(editor.getAttribute('data-modified')).toBe('hello\nworld');
    expect(JSON.parse(localStorage.getItem('compare.preferences.v1') ?? '{}')).toMatchObject({ ignoreCase: true, ignoreBlankLines: true });
  });

  it('opens two files and safely saves an edited side with its metadata', async () => {
    pickFile.mockResolvedValue([
      { path: 'C:\\tmp\\left.txt', name: 'left.txt', size: 4, content: '', mimeType: 'text/plain', text: 'left', encoding: 'utf8bom', lineEnding: 'CRLF', modifiedAt: 10 },
      { path: 'C:\\tmp\\right.txt', name: 'right.txt', size: 5, content: '', mimeType: 'text/plain', text: 'right', encoding: 'utf8', lineEnding: 'LF', modifiedAt: 20 },
    ]);
    writeTextFile.mockResolvedValue({ success: true, path: 'C:\\tmp\\right.txt', modifiedAt: 30 });
    render(createElement(ComparePanel));
    fireEvent.click(screen.getByRole('button', { name: '选择两个文件' }));
    await waitFor(() => expect((screen.getByLabelText('右侧文本') as HTMLTextAreaElement).value).toBe('right'));
    fireEvent.change(screen.getByLabelText('右侧文本'), { target: { value: 'right edited' } });
    fireEvent.click(screen.getByRole('button', { name: '保存右侧' }));
    await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith('C:\\tmp\\right.txt', 'right edited', {
      encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: 20, force: false,
    }));
  });

  it('offers recovery actions when the file changed externally', async () => {
    pickFile.mockResolvedValue({ path: 'C:\\tmp\\right.txt', name: 'right.txt', size: 5, content: '', mimeType: 'text/plain', text: 'right', encoding: 'utf8', lineEnding: 'LF', modifiedAt: 20 });
    writeTextFile.mockResolvedValue({
      success: false,
      error: 'FILE_MODIFIED_EXTERNALLY',
      current: { content: 'external', encoding: 'utf8', lineEnding: 'LF', mixedLineEndings: false, modifiedAt: 30 },
    });
    render(createElement(ComparePanel));
    fireEvent.click(screen.getByRole('button', { name: '载入右侧' }));
    await waitFor(() => expect((screen.getByLabelText('右侧文本') as HTMLTextAreaElement).value).toBe('right'));
    fireEvent.change(screen.getByLabelText('右侧文本'), { target: { value: 'local edit' } });
    fireEvent.click(screen.getByRole('button', { name: '保存右侧' }));
    expect((await screen.findByRole('alert')).textContent).toContain('已被外部修改');
    fireEvent.click(screen.getByRole('button', { name: '载入外部版本' }));
    expect((screen.getByLabelText('右侧文本') as HTMLTextAreaElement).value).toBe('external');
  });

  it('handles save shortcuts only while the compare plugin is active', async () => {
    pickFile.mockResolvedValue({ path: 'C:\\tmp\\right.txt', name: 'right.txt', size: 5, content: '', mimeType: 'text/plain', text: 'right', encoding: 'utf8', lineEnding: 'LF', modifiedAt: 20 });
    writeTextFile.mockResolvedValue({ success: true, path: 'C:\\tmp\\right.txt', modifiedAt: 30 });
    render(createElement(ComparePanel));
    fireEvent.click(screen.getByRole('button', { name: '载入右侧' }));
    await waitFor(() => expect((screen.getByLabelText('右侧文本') as HTMLTextAreaElement).value).toBe('right'));
    fireEvent.change(screen.getByLabelText('右侧文本'), { target: { value: 'edited' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(writeTextFile).not.toHaveBeenCalled();
    act(() => useStore.getState().setActiveActivity('compare'));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
  });
});
