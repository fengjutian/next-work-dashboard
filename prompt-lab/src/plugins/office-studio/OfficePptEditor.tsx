import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { officeClient } from './office-client';
import { parseCompactElements } from './OfficeWordEditor';
import { OfficeAiChat } from './OfficeAiChat';
import type { OfficeOperationResult } from './types';

interface Props { filePath: string; onMutation(result: OfficeOperationResult): void; onError(message: string): void }

export const OfficePptEditor: React.FC<Props> = ({ filePath, onMutation, onError }) => {
  const [elements, setElements] = useState(() => parseCompactElements(''));
  const [slides, setSlides] = useState<number[]>([1]);
  const [slide, setSlide] = useState(1);
  const [selectedPath, setSelectedPath] = useState('');
  const [text, setText] = useState('');
  const [x, setX] = useState('1in'); const [y, setY] = useState('1in');
  const [width, setWidth] = useState('4in'); const [height, setHeight] = useState('1in');
  const [images, setImages] = useState<Record<number, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [rendering, setRendering] = useState(false);

  const reload = useCallback(async () => {
    const result = await officeClient.query(filePath, '*');
    if (!result.success) { onError(result.error || '无法读取 PPT 元素'); return; }
    const output = result.output || '';
    const parsed = parseCompactElements(output);
    setElements(parsed);
    const declaredCount = Number(output.match(/\/\s*(\d+)\s+slides?\s*$/m)?.[1] || 0);
    const pathCount = Math.max(0, ...parsed.map((item) => Number(item.path.match(/^\/slide\[(\d+)\]/)?.[1] || 0)));
    const count = Math.max(1, declaredCount, pathCount);
    const pages = Array.from({ length: count }, (_, index) => index + 1);
    setSlides(pages);
    setSlide((current) => pages.includes(current) ? current : pages[0]);
    setRendering(true);
    const rendered = await Promise.all(pages.map(async (page) => [page, await officeClient.renderPage(filePath, page)] as const));
    setImages(Object.fromEntries(rendered.flatMap(([page, value]) => value.success && value.imageDataUrl ? [[page, value.imageDataUrl] as const] : [])));
    setRendering(false);
  }, [filePath, onError]);
  useEffect(() => { void reload(); }, [reload]);

  const visible = useMemo(() => elements.filter((item) => item.path.startsWith(`/slide[${slide}]/`)), [elements, slide]);
  const mutate = async (operation: () => Promise<OfficeOperationResult>) => {
    const result = await operation(); onMutation(result);
    if (result.success) await reload(); else onError(result.error || 'PPT 修改失败');
  };
  const selectElement = (path: string) => { const item = elements.find((entry) => entry.path === path); setSelectedPath(path); setText(item?.text || ''); };
  const addSlide = () => mutate(() => officeClient.add({ filePath, path: '/', type: 'slide', properties: { title: '新幻灯片' } }));
  const removeSlide = () => window.confirm(`确定删除第 ${slide} 张幻灯片？`) && mutate(() => officeClient.remove(filePath, `/slide[${slide}]`));
  const addText = () => mutate(() => officeClient.add({ filePath, path: `/slide[${slide}]`, type: 'shape', properties: { text: '新文本', x, y, width, height } }));
  const apply = () => selectedPath && mutate(() => officeClient.set({ filePath, path: selectedPath, properties: { text, x, y, width, height } }));
  const aiChanged = () => { onMutation({ success: true, canUndo: true }); void reload(); };

  return <div className="flex h-full min-h-0 bg-muted/20">
    <aside className="flex w-48 shrink-0 flex-col border-r bg-background">
      <div className="grid grid-cols-2 gap-1 border-b p-2"><button onClick={() => void addSlide()} className="rounded border px-2 py-1 text-xs">＋ 幻灯片</button><button onClick={() => void removeSlide()} className="rounded border px-2 py-1 text-xs text-destructive">删除</button></div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{slides.map((number) => <button key={number} onClick={() => setSlide(number)} className={`mb-3 block w-full rounded border p-1 ${number === slide ? 'border-primary ring-1 ring-primary' : 'bg-card'}`}><div className="mb-1 text-left text-[10px] text-muted-foreground">{number}</div>{images[number] ? <img src={images[number]} className="aspect-video w-full bg-white object-contain" alt={`幻灯片 ${number}`} /> : <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">{rendering ? '渲染中…' : `幻灯片 ${number}`}</div>}</button>)}</div>
    </aside>

    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b bg-background px-3 py-2"><span className="text-xs font-medium">幻灯片 {slide}</span><select value={selectedPath} onChange={(event) => selectElement(event.target.value)} className="min-w-0 max-w-sm rounded border bg-background px-2 py-1 text-xs"><option value="">选择元素…</option>{visible.map((item) => <option key={item.path} value={item.path}>{item.text || item.label || item.path}</option>)}</select><button onClick={() => void addText()} className="rounded border px-2 py-1 text-xs">添加文本框</button><button onClick={() => setAdvanced((value) => !value)} className="ml-auto rounded border px-2 py-1 text-xs">{advanced ? '隐藏高级属性' : '高级属性'}</button></header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">{images[slide] ? <img src={images[slide]} className="max-h-full max-w-full bg-white object-contain shadow-xl" alt={`幻灯片 ${slide}`} /> : <div className="text-sm text-muted-foreground">正在渲染真实幻灯片…</div>}
        {advanced && <div className="absolute bottom-4 right-4 w-80 rounded-lg border bg-card/95 p-3 text-xs shadow-xl backdrop-blur"><textarea value={text} onChange={(event) => setText(event.target.value)} className="mb-2 h-24 w-full resize-none rounded border bg-background p-2" placeholder="所选元素文本" />{[['X', x, setX], ['Y', y, setY], ['宽', width, setWidth], ['高', height, setHeight]].map(([label, value, setter]) => <label key={String(label)} className="mb-1 flex items-center gap-2"><span className="w-6">{String(label)}</span><input value={String(value)} onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1" /></label>)}<button disabled={!selectedPath} onClick={() => void apply()} className="mt-2 w-full rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-40">应用属性</button></div>}
      </div>
    </section>

    <OfficeAiChat filePath={filePath} page={slide} selectedPath={selectedPath || undefined} onDocumentChanged={aiChanged} />
  </div>;
};
