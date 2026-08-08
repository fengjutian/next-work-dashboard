import React, { useCallback, useEffect, useState } from 'react';
import { officeClient } from './office-client';
import type { OfficeOperationResult } from './types';

interface Props { filePath: string; onMutation(result: OfficeOperationResult): void; onError(message: string): void }
interface ParagraphItem { path: string; label: string; text: string }

export function parseCompactElements(output: string): ParagraphItem[] {
  return output.split('\n').filter((line) => line.startsWith('/')).map((line) => {
    const [path, label = '', raw = ''] = line.split('\t');
    return { path, label, text: raw.replace(/^"|"$/g, '') };
  });
}

export const OfficeWordEditor: React.FC<Props> = ({ filePath, onMutation, onError }) => {
  const [items, setItems] = useState<ParagraphItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [text, setText] = useState('');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [size, setSize] = useState('12');
  const [color, setColor] = useState('000000');

  const reload = useCallback(async () => {
    const result = await officeClient.query(filePath, 'paragraph');
    if (!result.success) { onError(result.error || '无法读取 Word 段落'); return; }
    const parsed = parseCompactElements(result.output || '');
    setItems(parsed); setSelected(0); setText(parsed[0]?.text || '');
  }, [filePath, onError]);
  useEffect(() => { void reload(); }, [reload]);

  const choose = (index: number) => { setSelected(index); setText(items[index]?.text || ''); };
  const apply = async () => {
    const item = items[selected]; if (!item) return;
    const result = await officeClient.set({ filePath, path: item.path, properties: { text, bold: String(bold), italic: String(italic), size, color: color.replace('#', '') } });
    onMutation(result); if (!result.success) onError(result.error || 'Word 段落更新失败'); else await reload();
  };
  const addParagraph = async () => {
    const result = await officeClient.add({ filePath, path: '/body', type: 'paragraph', properties: { text: '新段落' } });
    onMutation(result); if (result.success) await reload(); else onError(result.error || '新增段落失败');
  };
  const removeParagraph = async () => {
    const item = items[selected]; if (!item || !window.confirm('确定删除所选段落？')) return;
    const result = await officeClient.remove(filePath, item.path); onMutation(result);
    if (result.success) await reload(); else onError(result.error || '删除段落失败');
  };

  return <div className="flex h-full min-h-0">
    <aside className="w-64 shrink-0 overflow-auto border-r bg-muted/20 p-2">
      <div className="mb-2 flex gap-1"><button onClick={() => void addParagraph()} className="flex-1 rounded border px-2 py-1 text-xs">新增段落</button><button onClick={() => void removeParagraph()} className="rounded border px-2 py-1 text-xs text-destructive">删除</button></div>
      {items.map((item, index) => <button key={item.path} onClick={() => choose(index)} className={`mb-1 block w-full rounded border p-2 text-left text-xs ${index === selected ? 'border-primary bg-primary/5' : ''}`}><span className="block text-[10px] text-muted-foreground">{item.label}</span><span className="line-clamp-2">{item.text || '（空段落）'}</span></button>)}
    </aside>
    <section className="flex min-w-0 flex-1 flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setBold((value) => !value)} className={`rounded border px-3 py-1 font-bold ${bold ? 'bg-primary text-primary-foreground' : ''}`}>B</button>
        <button onClick={() => setItalic((value) => !value)} className={`rounded border px-3 py-1 italic ${italic ? 'bg-primary text-primary-foreground' : ''}`}>I</button>
        <label className="text-xs">字号 <input type="number" min="6" max="96" value={size} onChange={(event) => setSize(event.target.value)} className="w-16 rounded border bg-background px-2 py-1" /></label>
        <label className="text-xs">颜色 <input type="color" value={`#${color.replace('#', '').padStart(6, '0').slice(0, 6)}`} onChange={(event) => setColor(event.target.value.slice(1))} /></label>
        <button onClick={() => void apply()} className="ml-auto rounded bg-primary px-4 py-1.5 text-xs text-primary-foreground">应用修改</button>
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} className="min-h-0 flex-1 resize-none rounded border bg-card p-4 text-base leading-7" placeholder="选择或新增段落" />
    </section>
  </div>;
};
