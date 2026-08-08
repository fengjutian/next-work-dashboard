import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { officeClient } from './office-client';
import { parseCompactElements } from './OfficeWordEditor';
import type { OfficeOperationResult } from './types';

interface Props { filePath: string; onMutation(result: OfficeOperationResult): void; onError(message: string): void }

export const OfficePptEditor: React.FC<Props> = ({ filePath, onMutation, onError }) => {
  const [elements, setElements] = useState(() => parseCompactElements(''));
  const [slide, setSlide] = useState(1);
  const [selectedPath, setSelectedPath] = useState('');
  const [text, setText] = useState('');
  const [x, setX] = useState('1in'); const [y, setY] = useState('1in');
  const [width, setWidth] = useState('4in'); const [height, setHeight] = useState('1in');

  const reload = useCallback(async () => {
    const result = await officeClient.query(filePath, '*');
    if (!result.success) { onError(result.error || '无法读取 PPT 元素'); return; }
    setElements(parseCompactElements(result.output || ''));
  }, [filePath, onError]);
  useEffect(() => { void reload(); }, [reload]);
  const slideNumbers = useMemo(() => {
    const found = new Set(elements.map((item) => Number(item.path.match(/^\/slide\[(\d+)\]/)?.[1])).filter(Boolean));
    if (!found.size) found.add(1);
    return [...found].sort((a, b) => a - b);
  }, [elements]);
  const visible = elements.filter((item) => item.path.startsWith(`/slide[${slide}]/`));

  const mutate = async (operation: () => Promise<OfficeOperationResult>) => {
    const result = await operation(); onMutation(result);
    if (result.success) await reload(); else onError(result.error || 'PPT 修改失败');
  };
  const selectElement = (path: string, value: string) => { setSelectedPath(path); setText(value); };
  const addSlide = () => mutate(() => officeClient.add({ filePath, path: '/', type: 'slide', properties: { title: '新幻灯片' } }));
  const removeSlide = () => window.confirm(`确定删除第 ${slide} 张幻灯片？`) && mutate(() => officeClient.remove(filePath, `/slide[${slide}]`));
  const addText = () => mutate(() => officeClient.add({ filePath, path: `/slide[${slide}]`, type: 'shape', properties: { text: '新文本', x, y, width, height } }));
  const apply = () => selectedPath && mutate(() => officeClient.set({ filePath, path: selectedPath, properties: { text, x, y, width, height } }));

  return <div className="flex h-full min-h-0">
    <aside className="w-44 shrink-0 overflow-auto border-r bg-muted/20 p-2">
      <div className="mb-2 grid grid-cols-2 gap-1"><button onClick={() => void addSlide()} className="rounded border px-2 py-1 text-xs">新增</button><button onClick={() => void removeSlide()} className="rounded border px-2 py-1 text-xs text-destructive">删除</button></div>
      {slideNumbers.map((number) => <button key={number} onClick={() => setSlide(number)} className={`mb-2 flex aspect-video w-full items-center justify-center rounded border text-sm ${number === slide ? 'border-primary bg-primary/5' : 'bg-card'}`}>幻灯片 {number}</button>)}
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b p-2"><button onClick={() => void addText()} className="rounded border px-2 py-1 text-xs">添加文本框</button><span className="text-xs text-muted-foreground">当前幻灯片：{slide}</span></div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-auto p-3">{visible.map((item) => <button key={item.path} onClick={() => selectElement(item.path, item.text)} className={`mb-2 block w-full rounded border p-3 text-left ${item.path === selectedPath ? 'border-primary' : ''}`}><code className="text-[10px] text-muted-foreground">{item.path}</code><p className="mt-1 text-sm">{item.text || item.label}</p></button>)}</div>
        <aside className="border-l p-3 text-xs"><h3 className="mb-3 font-semibold">元素属性</h3><textarea value={text} onChange={(event) => setText(event.target.value)} className="mb-2 h-28 w-full resize-none rounded border bg-background p-2" placeholder="文本" />
          {[['X', x, setX], ['Y', y, setY], ['宽', width, setWidth], ['高', height, setHeight]].map(([label, value, setter]) => <label key={String(label)} className="mb-2 flex items-center gap-2"><span className="w-6">{String(label)}</span><input value={String(value)} onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1" /></label>)}
          <button disabled={!selectedPath} onClick={() => void apply()} className="w-full rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-40">应用文本与布局</button>
        </aside>
      </div>
    </section>
  </div>;
};
