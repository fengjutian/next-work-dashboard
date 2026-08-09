import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Image, Loader2, Sparkles, Trash2, Upload } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';
import { notification } from 'antd';
import { deleteImage, listImages, saveImage } from './image-library';

type ReferenceImage = { file: File; dataUrl: string; base64: string };
type GeneratedImage = { id: string; dataUrl: string; prompt: string; style: string; provider: string; model: string; aspectRatio: string; size: number; createdAt: number };
type ImageProvider = 'openai-compatible' | 'minimax';
const MINIMAX_KEY_STORAGE = 'nwd:style-image:minimax-api-key';

const STYLES = [
  { id: 'custom', label: '自定义', prompt: '' },
  { id: 'zine', label: '纸艺拼贴', prompt: 'tactile editorial paper collage, torn fibrous edges, layered handmade paper, bold structural color, refined zine composition' },
  { id: 'watercolor', label: '清透水彩', prompt: 'delicate watercolor illustration, translucent pigments, soft paper texture, expressive brushwork' },
  { id: 'anime', label: '动漫插画', prompt: 'high quality anime illustration, clean line art, cinematic lighting, expressive color design' },
  { id: 'film', label: '复古胶片', prompt: 'vintage analog film photography, natural grain, muted colors, soft highlight bloom, cinematic composition' },
  { id: 'clay', label: '黏土模型', prompt: 'handcrafted clay model, miniature diorama, soft studio lighting, tactile material, charming details' },
  { id: 'cinematic', label: '电影剧照', prompt: 'cinematic film still, dramatic composition, motivated lighting, subtle film grain, rich production design' },
  { id: 'chinese', label: '东方美学', prompt: 'contemporary Chinese aesthetics, restrained oriental composition, elegant negative space, refined traditional color palette' },
  { id: 'ink', label: '水墨写意', prompt: 'expressive Chinese ink wash painting, flowing brush strokes, rice paper texture, poetic negative space' },
  { id: 'oil', label: '古典油画', prompt: 'classical oil painting, layered impasto, chiaroscuro lighting, museum quality pigments, painterly details' },
  { id: 'pixel', label: '像素艺术', prompt: 'detailed pixel art, carefully limited palette, crisp pixel clusters, atmospheric game scene' },
  { id: 'cyberpunk', label: '赛博霓虹', prompt: 'cinematic cyberpunk, rain-soaked neon streets, volumetric haze, electric color contrast, intricate futuristic details' },
  { id: 'isometric', label: '等距插画', prompt: 'clean isometric illustration, precise miniature architecture, soft ambient occlusion, harmonious colors' },
  { id: 'lowpoly', label: '低多边形', prompt: 'stylized low-poly 3D art, faceted geometry, elegant lighting, bold simplified forms' },
  { id: 'surreal', label: '超现实', prompt: 'poetic surrealism, dreamlike visual metaphor, impossible yet coherent scene, cinematic atmospheric depth' },
  { id: 'minimal', label: '极简设计', prompt: 'minimalist visual design, disciplined negative space, simple geometric forms, refined color relationships' },
  { id: 'storybook', label: '绘本童话', prompt: 'whimsical storybook illustration, warm hand-drawn textures, gentle colors, charming narrative details' },
  { id: 'fashion', label: '时尚大片', prompt: 'high-fashion editorial photography, confident art direction, sculptural styling, premium studio lighting' },
  { id: 'documentary', label: '纪实摄影', prompt: 'authentic documentary photography, natural available light, candid human moment, realistic color and texture' },
  { id: 'architecture', label: '建筑可视化', prompt: 'premium architectural visualization, accurate materials, balanced daylight, human-scale details, clean composition' },
  { id: 'product', label: '商业产品', prompt: 'premium product photography, precise studio lighting, clean backdrop, realistic materials, advertising composition' },
];

async function createVisualPrompt(aiApi: { apiKey: string; baseUrl: string; model: string; provider?: string }, idea: string, stylePrompt: string): Promise<string> {
  const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, chatProxy: aiApi.provider === 'qwen' ? window.electronAPI.llmChat : undefined });
  const messages: ChatMessage[] = [{ role: 'system', content: '你是专业视觉导演和文生图提示词设计师。将用户的简短想法扩写成一段具体、连贯、可直接用于图片生成的中文画面描述。必须保留用户主体与意图，并补充环境、构图、镜头、光线、色彩、材质和氛围。不要解释，不要标题，不要 Markdown，不要参数，不要杜撰文字或水印。控制在 180 至 350 个中文字符。' }, { role: 'user', content: `用户想法：${idea}\n选定风格参考：${stylePrompt || '自定义，不限定风格'}` }];
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.75, maxTokens: 700, stream: true })) if (chunk.delta) chunks.push(chunk.delta);
  return chunks.join('').trim().replace(/^```(?:text)?\s*|\s*```$/g, '').replace(/^[“"]|[”"]$/g, '');
}

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
  const [provider, setProvider] = useState<ImageProvider>('minimax');
  const [miniMaxApiKey, setMiniMaxApiKey] = useState(() => localStorage.getItem(MINIMAX_KEY_STORAGE) || '');
  const [model, setModel] = useState('image-01');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('medium');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [promptLoading, setPromptLoading] = useState(false);
  const [showAllStyles, setShowAllStyles] = useState(false);

  useEffect(() => { localStorage.setItem(MINIMAX_KEY_STORAGE, miniMaxApiKey); }, [miniMaxApiKey]);
  const refreshLibrary = useCallback(() => {
    setResults((current) => {
      current.forEach((item) => { if (item.dataUrl.startsWith('blob:')) URL.revokeObjectURL(item.dataUrl); });
      return listImages().map((item) => ({ id: item.id, dataUrl: URL.createObjectURL(item.image), prompt: item.prompt, style: item.style, provider: item.provider, model: item.model, aspectRatio: item.aspectRatio, size: item.size, createdAt: item.createdAt }));
    });
  }, []);
  useEffect(() => { refreshLibrary(); return () => { setResults((current) => { current.forEach((item) => { if (item.dataUrl.startsWith('blob:')) URL.revokeObjectURL(item.dataUrl); }); return current; }); }; }, [refreshLibrary]);
  const changeProvider = (next: ImageProvider) => { setProvider(next); setModel(next === 'minimax' ? 'image-01' : 'gpt-image-1'); if (next === 'minimax') setReference(null); };

  const showError = useCallback((description: string) => {
    notifApi.error({ message: '图片生成失败', description, placement: 'bottomRight', duration: 6 });
  }, [notifApi]);

  const chooseFile = useCallback(async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showError('请选择 PNG、JPEG 或 WebP 图片'); return; }
    if (file.size > 20 * 1024 * 1024) { showError('参考图片不能超过 20 MB'); return; }
    try { setReference(await readImage(file)); } catch (reason) { showError(reason instanceof Error ? reason.message : '无法读取图片'); }
  }, [showError]);

  const generatePrompt = useCallback(async () => {
    if (!prompt.trim()) { showError('请先输入一句画面想法，例如“小猫在雨夜等主人”'); return; }
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { showError('请先在设置中配置文本 AI 服务，用于生成画面描述'); return; }
    setPromptLoading(true);
    try {
      const next = await createVisualPrompt(aiApi, prompt.trim(), STYLES.find((item) => item.id === style)?.prompt || '');
      if (!next) throw new Error('AI 没有返回画面描述');
      setPrompt(next.slice(0, provider === 'minimax' ? 1500 : 4000));
      notifApi.success({ message: '画面描述已生成', description: '可以继续修改，确认后再生成图片。', placement: 'bottomRight' });
    } catch (reason) { showError(reason instanceof Error ? reason.message : '生成画面描述失败'); }
    finally { setPromptLoading(false); }
  }, [aiApi, notifApi, prompt, provider, showError, style]);

  const generate = useCallback(async () => {
    if (!prompt.trim()) { showError('请填写希望生成的画面描述'); return; }
    const apiKey = provider === 'minimax' ? miniMaxApiKey : aiApi.apiKey;
    if (!apiKey.trim() || (provider === 'openai-compatible' && !aiApi.baseUrl.trim())) { showError(provider === 'minimax' ? '请填写 MiniMax API Key' : '请先在设置中配置 AI API Key 和 Base URL'); return; }
    const stylePrompt = STYLES.find((item) => item.id === style)?.prompt;
    const finalPrompt = [prompt.trim(), stylePrompt].filter(Boolean).join('. ');
    setLoading(true);
    try {
      const response = await window.electronAPI.generateImage({
        provider, baseUrl: provider === 'minimax' ? 'https://api.minimaxi.com/v1' : aiApi.baseUrl, apiKey, model: model.trim(), prompt: finalPrompt, size, quality, aspectRatio, promptOptimizer,
        image: reference ? { dataBase64: reference.base64, mimeType: reference.file.type, name: reference.file.name } : undefined,
      });
      if (!response.success || !response.imageDataUrl) throw new Error(response.error || '模型没有返回图片');
      const imageDataUrl = response.imageDataUrl;
      const imageBlob = await fetch(imageDataUrl).then((value) => value.blob());
      await saveImage({ id: crypto.randomUUID(), prompt: response.revisedPrompt || finalPrompt, style, provider, model, aspectRatio: provider === 'minimax' ? aspectRatio : size, mimeType: imageBlob.type || 'image/jpeg', size: imageBlob.size, createdAt: Date.now(), image: imageBlob });
      refreshLibrary();
      notifApi.success({ message: '图片生成完成', description: '结果已保存到本地 SQLite 图片库。', placement: 'bottomRight' });
    } catch (reason) {
      const rawMessage = reason instanceof Error ? reason.message : '图片生成失败';
      const needsRestart = /No handler registered for ['"]image:generate['"]/i.test(rawMessage);
      const staleMiniMaxHandler = provider === 'minimax' && /404|page not found/i.test(rawMessage);
      showError(needsRestart || staleMiniMaxHandler ? '图片主进程仍是旧版本。请完全退出应用（包括托盘进程）后重新启动；仅刷新页面不会更新 MiniMax 接口。' : rawMessage);
    }
    finally { setLoading(false); }
  }, [aiApi, aspectRatio, miniMaxApiKey, model, notifApi, prompt, promptOptimizer, provider, quality, reference, refreshLibrary, showError, size, style]);

  const download = (item: GeneratedImage) => {
    const anchor = document.createElement('a'); anchor.href = item.dataUrl;
    anchor.download = `style-image-${new Date(item.createdAt).toISOString().replace(/[:.]/g, '-')}.png`; anchor.click();
  };

  const removeImage = async (item: GeneratedImage) => {
    if (!window.confirm('确定删除这张本地图片吗？删除后无法恢复。')) return;
    await deleteImage(item.id);
    refreshLibrary();
    notifApi.success({ message: '图片已删除', placement: 'bottomRight' });
  };

  const copyPrompt = async (item: GeneratedImage) => {
    await navigator.clipboard.writeText(item.prompt);
    notifApi.success({ message: '提示词已复制', placement: 'bottomRight' });
  };

  const reusePrompt = (item: GeneratedImage) => {
    setPrompt(item.prompt.slice(0, provider === 'minimax' ? 1500 : 4000));
    if (STYLES.some((candidate) => candidate.id === item.style)) setStyle(item.style);
    notifApi.success({ message: '提示词已回填', description: '可在左侧修改后再次生成。', placement: 'bottomRight' });
  };

  return <div className="flex h-full min-h-0 bg-background text-foreground">
    {contextHolder}
    <section className="w-[360px] shrink-0 overflow-y-auto border-r p-5">
      <div className="mb-5"><h1 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="h-5 w-5 text-primary" />风格图片生成</h1><p className="mt-1 text-xs text-muted-foreground">上传参考图，用提示词生成新的风格化图片</p></div>
      <label className="mb-2 block text-sm font-medium">生成服务</label>
      <select className="mb-4 h-9 w-full rounded-md border bg-background px-2 text-sm" value={provider} onChange={(event) => changeProvider(event.target.value as ImageProvider)}><option value="minimax">MiniMax（推荐）</option><option value="openai-compatible">OpenAI 兼容服务</option></select>
      {provider === 'minimax' && <label className="mb-4 grid gap-1 text-xs"><span>MiniMax API Key</span><input type="password" value={miniMaxApiKey} onChange={(event) => setMiniMaxApiKey(event.target.value)} className="h-9 rounded-md border bg-background px-3" placeholder="在 MiniMax 开放平台创建的 API Key" autoComplete="off" /><span className="text-[10px] text-muted-foreground">仅保存在本机，不使用文本模型的 API Key。</span></label>}
      <label className="mb-2 block text-sm font-medium">参考图片 <span className="font-normal text-muted-foreground">（可选）</span></label>
      <input ref={fileRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      {reference ? <div className="group relative mb-4 overflow-hidden rounded-lg border bg-muted"><img src={reference.dataUrl} className="h-44 w-full object-contain" alt="参考图片" /><button className="absolute right-2 top-2 rounded bg-background/90 p-1.5 shadow" onClick={() => setReference(null)} title="移除"><Trash2 className="h-4 w-4" /></button></div>
        : <button disabled={provider === 'minimax'} className="mb-4 flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (provider !== 'minimax') void chooseFile(event.dataTransfer.files[0]); }}><Upload className="h-6 w-6" /><span>{provider === 'minimax' ? 'MiniMax 当前使用文生图模式' : '点击或拖入图片'}</span><span className="text-[11px]">{provider === 'minimax' ? '切换到 OpenAI 兼容服务可上传参考图' : 'PNG / JPEG / WebP，最大 20 MB'}</span></button>}
      <div className="mb-2 flex items-center justify-between"><label className="text-sm font-medium">画面描述</label><Button type="button" size="sm" variant="outline" disabled={promptLoading || !prompt.trim()} onClick={() => void generatePrompt()}>{promptLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}{promptLoading ? 'AI 构思中' : 'AI 丰富描述'}</Button></div>
      <textarea className="mb-1 min-h-28 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" value={prompt} maxLength={provider === 'minimax' ? 1500 : 4000} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：一只猫坐在雨夜咖啡馆的窗边，温暖灯光，安静的氛围……" /><p className="mb-4 text-right text-[10px] text-muted-foreground">{prompt.length}/{provider === 'minimax' ? 1500 : 4000}</p>
      <div className="mb-2 flex items-center justify-between"><label className="text-sm font-medium">风格</label><span className="text-[10px] text-muted-foreground">{STYLES.length} 种</span></div>
      <div className="grid grid-cols-3 gap-2">{(showAllStyles ? STYLES : STYLES.slice(0, 9)).map((item) => <button key={item.id} onClick={() => setStyle(item.id)} className={`rounded-md border px-2 py-2 text-xs ${style === item.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}>{item.label}</button>)}</div>
      <button type="button" className="mb-4 mt-2 w-full rounded py-1 text-xs text-primary hover:bg-primary/5" onClick={() => setShowAllStyles((current) => !current)}>{showAllStyles ? '收起风格' : `展开更多风格（${STYLES.length - 9}）`}</button>
      {provider === 'minimax' ? <><div className="mb-4 grid grid-cols-2 gap-3"><label className="text-xs">模型<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={model} onChange={(event) => { const next = event.target.value; setModel(next); if (next === 'image-01-live' && aspectRatio === '21:9') setAspectRatio('1:1'); }}><option value="image-01">Image 01</option><option value="image-01-live">Image 01 Live</option></select></label><label className="text-xs">画幅<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', ...(model === 'image-01' ? ['21:9'] : [])].map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label></div><label className="mb-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={promptOptimizer} onChange={(event) => setPromptOptimizer(event.target.checked)} />让 MiniMax 自动优化提示词</label></> : <><div className="mb-4 grid grid-cols-2 gap-3"><label className="text-xs">尺寸<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={size} onChange={(event) => setSize(event.target.value)}><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option></select></label><label className="text-xs">质量<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={quality} onChange={(event) => setQuality(event.target.value)}><option value="low">快速</option><option value="medium">标准</option><option value="high">高清</option></select></label></div><label className="mb-1 block text-xs">图片模型</label><input className="mb-4 h-9 w-full rounded-md border bg-background px-3 text-sm" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-image-1" /></>}
      <Button className="w-full" disabled={loading || !prompt.trim()} onClick={() => void generate()}>{loading ? <><Loader2 className="mr-2 h-4 w-4" />正在生成（可能需要数分钟）</> : <><Sparkles className="mr-2 h-4 w-4" />生成图片</>}</Button>
    </section>
    <main className="min-w-0 flex-1 overflow-y-auto p-6">{results.length ? <><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">本地图片库</h2><p className="text-xs text-muted-foreground">图片和对应提示词已保存到 SQLite · {results.length} 张</p></div></div><div className="grid grid-cols-1 gap-5 xl:grid-cols-2">{results.map((item, index) => <article key={item.id} className="overflow-hidden rounded-xl border bg-card shadow-sm"><div className="relative bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px]"><img className="max-h-[620px] w-full object-contain" src={item.dataUrl} alt={`生成结果 ${index + 1}`} /></div><div className="p-3"><details className="group"><summary className="cursor-pointer text-xs font-medium">查看完整提示词</summary><p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">{item.prompt}</p></details><p className="mt-2 text-[10px] text-muted-foreground">{item.model} · {item.aspectRatio} · {(item.size / 1024 / 1024).toFixed(1)} MB · {new Date(item.createdAt).toLocaleString()}</p><div className="mt-3 flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" onClick={() => void copyPrompt(item)}><Copy className="mr-1 h-4 w-4" />复制提示词</Button><Button size="sm" variant="outline" onClick={() => reusePrompt(item)}><Sparkles className="mr-1 h-4 w-4" />再次使用</Button><Button size="sm" variant="outline" onClick={() => download(item)}><Download className="mr-1 h-4 w-4" />下载</Button><Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" title="从本地数据库删除" onClick={() => void removeImage(item)}><Trash2 className="h-4 w-4" /></Button></div></div></article>)}</div></> : <div className="flex h-full min-h-80 flex-col items-center justify-center text-muted-foreground"><Image className="mb-4 h-16 w-16 opacity-20" /><p className="font-medium">生成结果会显示在这里</p><p className="mt-1 text-sm">生成后会自动保存图片和提示词到本地 SQLite</p></div>}</main>
  </div>;
};
