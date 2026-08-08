import { afterEach, describe, expect, it, vi } from 'vitest';
import { officeTools } from '../src/core/tools/office-tools';

afterEach(() => vi.unstubAllGlobals());

function tool(name: string) {
  const found = officeTools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

describe('Office Studio agent tools', () => {
  it('reads an outline through the typed bridge', async () => {
    const outline = vi.fn().mockResolvedValue({ success: true, output: 'Slide 1' });
    vi.stubGlobal('window', { electronAPI: { office: { outline } } });
    await expect(tool('office_read').execute({ filePath: 'C:\\report.pptx' })).resolves.toBe('Slide 1');
    expect(outline).toHaveBeenCalledWith('C:\\report.pptx');
  });

  it('requires confirmation before an AI write', async () => {
    const set = vi.fn().mockResolvedValue({ success: true, output: 'updated' });
    vi.stubGlobal('window', { confirm: vi.fn(() => false), electronAPI: { office: { set } } });
    await expect(tool('office_update').execute({ filePath: 'C:\\report.docx', path: '/body/p[1]', properties: { text: 'New' } })).rejects.toThrow('用户取消');
    expect(set).not.toHaveBeenCalled();
  });

  it('normalizes property values after confirmation', async () => {
    const set = vi.fn().mockResolvedValue({ success: true, output: 'updated' });
    vi.stubGlobal('window', { confirm: vi.fn(() => true), electronAPI: { office: { set } } });
    await expect(tool('office_update').execute({ filePath: 'C:\\report.docx', path: '/body/p[1]', properties: { bold: true } })).resolves.toBe('updated');
    expect(set).toHaveBeenCalledWith({ filePath: 'C:\\report.docx', path: '/body/p[1]', properties: { bold: 'true' } });
  });
});
