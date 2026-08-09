import React, { useCallback, useRef, useState } from 'react';
import { Download, Image, Loader2, Sparkles, Trash2, Upload } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/store';
import { notification } from 'antd';

type ReferenceImage = { file: File; dataUrl: string; base64: string };
type GeneratedImage = { id: string; dataUrl: string; prompt: string; createdAt: number };

const STYLES = [
  { id: 'custom', label: '自定义', prompt: '' },
  { id: 'zine', label: '纸艺拼贴', prompt: 'tactile editorial paper collage, torn fibrous edges, layered handmade paper, bold structural color, refined zine composition' },
  { id: 'watercolor', label: '清透水彩', prompt: 'delicate watercolor illustration, translucent pigments, soft paper texture, expressive brushwork' },
  { id: 'anime', label: '动漫插画', prompt: 'high quality anime illustration, clean line art, cinematic lighting, expressive color design' },
  { id: 'film', label: '复古胶片', prompt: 'vintage analog film photography, natural grain, muted colors, soft highlight bloom, cinematic composition' },
  { id: 'clay', label: '黏土模型', prompt: 'handcrafted clay model, miniature diorama, soft studio lighting, tactile material, charming details' },
];

function readImage(file: File): Promise<ReferenceImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve({ file, dataUrl, base64: dataUrl.split(',')[1] || '' });
    };
    reader.readAsDataURL(file);
  });
}

export const StyleImagePanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [notifApi, contextHolder] = notification.useNotification();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState<ReferenceImage | null>(null);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('zine');
  const [model, setModel] = useState('gpt-image-1');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('medium');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedImage[]>([]);

  const showError = useCallback((description: string) => {
    notifApi.error({ message: '图片生成失败', description, placement: 'bottomRight', duration: 6 });
  }, [notifApi]);

  const chooseFile = useCallback(async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showError('请选择 PNG、JPEG 或 WebP 图片'); return; }
    if (file.size > 20 * 1024 * 1024) { showError('参考图片不能超过 20 MB'); return; }
    try { setReference(await readImage(file)); } catch (reason) { showError(reason instanceof Error ? reason.message : '无法读取图片'); }
  }, [showError]);

  const generate = useCallback(async () => {
    if (!prompt.trim()) { showError('请填写希望生成的画面描述'); return; }
    if (!aiApi.apiKey.trim() || !aiApi.baseUrl.trim()) { showError('请先在设置中配置 AI API Key 和 Base URL'); return; }
    const stylePrompt = STYLES.find((item) => item.id === style)?.prompt;
    const finalPrompt = [prompt.trim(), stylePrompt].filter(Boolean).join('. ');
    setLoading(true);
    try {
      const response = await window.electronAPI.generateImage({
        baseUrl: aiApi.baseUrl, apiKey: aiApi.apiKey, model: model.trim(), prompt: finalPrompt, size, quality,
        image: reference ? { dataBase64: reference.base64, mimeType: reference.file.type, name: reference.file.name } : undefined,
      });
      if (!response.success || !response.imageDataUrl) throw new Error(response.error || '模型没有返回图片');
      const imageDataUrl = response.imageDataUrl;
      setResults((current) => [{ id: crypto.randomUUID(), dataUrl: imageDataUrl, prompt: response.revisedPrompt || finalPrompt, createdAt: Date.now() }, ...current].slice(0, 12));
      notifApi.success({ message: '图片生成完成', description: '结果已显示，可预览或下载。', placement: 'bottomRight' });
    } catch (reason) {
      const rawMessage = reason instanceof Error ? reason.message : '图片生成失败';
      const needsRestart = /No handler registered for ['"]image:generate['"]/i.test(rawMessage);
      showError(needsRestart ? '图片服务刚刚安装，需要完全退出并重新启动应用后才能使用。仅刷新页面无效。' : rawMessage);
    }
    finally { setLoading(false); }
  }, [aiApi, model, notifApi, prompt, quality, reference, showError, size, style]);

  const download = (item: GeneratedImage) => {
    const anchor = document.createElement('a'); anchor.href = item.dataUrl;
    anchor.download = `style-image-${new Date(item.createdAt).toISOString().replace(/[:.]/g, '-')}.png`; anchor.click();
  };

  return <div className="flex h-full min-h-0 bg-background text-foreground">
    {contextHolder}
    <section className="w-[360px] shrink-0 overflow-y-auto border-r p-5">
      <div className="mb-5"><h1 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="h-5 w-5 text-primary" />风格图片生成</h1><p className="mt-1 text-xs text-muted-foreground">上传参考图，用提示词生成新的风格化图片</p></div>
      <label className="mb-2 block text-sm font-medium">参考图片 <span className="font-normal text-muted-foreground">（可选）</span></label>
      <input ref={fileRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      {reference ? <div className="group relative mb-4 overflow-hidden rounded-lg border bg-muted"><img src={reference.dataUrl} className="h-44 w-full object-contain" alt="参考图片" /><button className="absolute right-2 top-2 rounded bg-background/90 p-1.5 shadow" onClick={() => setReference(null)} title="移除"><Trash2 className="h-4 w-4" /></button></div>
        : <button className="mb-4 flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-primary" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}><Upload className="h-6 w-6" /><span>点击或拖入图片</span><span className="text-[11px]">PNG / JPEG / WebP，最大 20 MB</span></button>}
      <label className="mb-2 block text-sm font-medium">画面描述</label>
      <textarea className="mb-4 min-h-28 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：一只猫坐在雨夜咖啡馆的窗边，温暖灯光，安静的氛围……" />
      <label className="mb-2 block text-sm font-medium">风格</label>
      <div className="mb-4 grid grid-cols-3 gap-2">{STYLES.map((item) => <button key={item.id} onClick={() => setStyle(item.id)} className={`rounded-md border px-2 py-2 text-xs ${style === item.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}>{item.label}</button>)}</div>
      <div className="mb-4 grid grid-cols-2 gap-3"><label className="text-xs">尺寸<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={size} onChange={(event) => setSize(event.target.value)}><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option></select></label><label className="text-xs">质量<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={quality} onChange={(event) => setQuality(event.target.value)}><option value="low">快速</option><option value="medium">标准</option><option value="high">高清</option></select></label></div>
      <label className="mb-1 block text-xs">图片模型</label><input className="mb-4 h-9 w-full rounded-md border bg-background px-3 text-sm" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-image-1" />
      <Button className="w-full" disabled={loading || !prompt.trim()} onClick={() => void generate()}>{loading ? <><Loader2 className="mr-2 h-4 w-4" />正在生成（可能需要数分钟）</> : <><Sparkles className="mr-2 h-4 w-4" />生成图片</>}</Button>
    </section>
    <main className="min-w-0 flex-1 overflow-y-auto p-6">{results.length ? <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">{results.map((item, index) => <article key={item.id} className="overflow-hidden rounded-xl border bg-card shadow-sm"><div className="relative bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px]"><img className="max-h-[620px] w-full object-contain" src={item.dataUrl} alt={`生成结果 ${index + 1}`} /></div><div className="flex items-start gap-3 p-3"><p className="line-clamp-2 flex-1 text-xs text-muted-foreground">{item.prompt}</p><Button size="sm" variant="outline" onClick={() => download(item)}><Download className="mr-1 h-4 w-4" />下载</Button></div></article>)}</div> : <div className="flex h-full min-h-80 flex-col items-center justify-center text-muted-foreground"><Image className="mb-4 h-16 w-16 opacity-20" /><p className="font-medium">生成结果会显示在这里</p><p className="mt-1 text-sm">可不上传图片直接进行文生图</p></div>}</main>
  </div>;
};
