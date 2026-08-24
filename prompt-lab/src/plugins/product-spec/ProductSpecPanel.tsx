import { XMarkdown } from '@ant-design/x-markdown';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Download, FileText, Image, Loader2, Paperclip, Sparkles, Trash2, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/store';
import { parseDocument } from '../document-knowledge/parser';
import { buildSystemPrompt, buildUserPrompt, downloadProductSpec } from './generator';
import type { ProductSpecSource } from './types';

const DOCUMENTS = /\.(pdf|docx)$/i;
const IMAGES = /^image\//;
const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte|py|rs|go|java|kt|swift|cs|cpp|c|h|html|css|scss|sql|json|ya?ml|toml|md)$/i;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}

export function ProductSpecPanel() {
  const aiApi = useStore((state) => state.aiApi);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [sources, setSources] = useState<ProductSpecSource[]>([]);
  const [productName, setProductName] = useState('');
  const [audience, setAudience] = useState('产品、设计、研发和测试团队');
  const [requirements, setRequirements] = useState('');
  const [code, setCode] = useState('');
  const [includeDevelopmentPlan, setIncludeDevelopmentPlan] = useState(true);
  const [includeAcceptanceCriteria, setIncludeAcceptanceCriteria] = useState(true);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const configured = Boolean(aiApi.apiKey?.trim() && aiApi.baseUrl?.trim() && aiApi.model?.trim());

  useEffect(() => () => controllerRef.current?.abort(), []);

  const addFiles = async (files: FileList | File[]) => {
    const added: ProductSpecSource[] = [];
    for (const file of Array.from(files)) {
      try {
        if (IMAGES.test(file.type)) added.push({ id: crypto.randomUUID(), name: file.name, kind: 'image', size: file.size, dataUrl: await readDataUrl(file) });
        else if (DOCUMENTS.test(file.name)) {
          const parsed = await parseDocument(file);
          added.push({ id: crypto.randomUUID(), name: file.name, kind: 'document', size: file.size, text: parsed.plainText });
          if (!productName) setProductName(file.name.replace(/\.(pdf|docx)$/i, ''));
        } else if (CODE.test(file.name)) added.push({ id: crypto.randomUUID(), name: file.name, kind: 'code', size: file.size, text: await file.text() });
        else toast.error(`不支持的文件：${file.name}`);
      } catch (error) { toast.error(`${file.name} 解析失败：${error instanceof Error ? error.message : String(error)}`); }
    }
    setSources((current) => [...current, ...added]);
  };

  const effectiveSources = useMemo(() => code.trim() ? [...sources, { id: 'pasted-code', name: '用户粘贴代码', kind: 'code' as const, size: code.length, text: code }] : sources, [code, sources]);

  const generate = async () => {
    if (!configured) return toast.error('请先在设置中配置 AI API、Base URL 和模型');
    if (!effectiveSources.length) return toast.error('请至少添加一张图片、一份文档或一段代码');
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller; setRunning(true); setResult('');
    const context = { sources: effectiveSources, options: { productName, audience, additionalRequirements: requirements, includeDevelopmentPlan, includeAcceptanceCriteria } };
    const imageParts = effectiveSources.filter((item) => item.kind === 'image' && item.dataUrl).map((item) => ({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'high' } }));
    try {
      const response = await window.electronAPI.llmChat({ baseUrl: aiApi.baseUrl, apiKey: aiApi.apiKey, body: { model: aiApi.model, temperature: 0.2, max_tokens: 12000, messages: [{ role: 'system', content: buildSystemPrompt(context) }, { role: 'user', content: [{ type: 'text', text: buildUserPrompt(context) }, ...imageParts] }] } });
      if (!response.ok) throw new Error(response.error ?? `HTTP ${response.status}`);
      const data = response.data as { choices?: Array<{ message?: { content?: string } }>; output_text?: string };
      const content = data.choices?.[0]?.message?.content ?? data.output_text ?? '';
      if (!content.trim()) throw new Error('模型没有返回内容');
      setResult(content.trim()); toast.success('产品说明文档已生成');
    } catch (error) { if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setRunning(false); if (controllerRef.current === controller) controllerRef.current = null; }
  };

  return <div className="flex h-full min-h-0 bg-background">
    <aside className="w-[380px] shrink-0 overflow-y-auto border-r p-4">
      <div className="mb-4 flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><div><h1 className="font-semibold">产品说明文档生成器</h1><p className="text-xs text-muted-foreground">图片 + PDF/Word + 代码联合分析</p></div></div>
      <label className="mb-1 block text-xs font-medium">产品名称</label><input className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm" value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例如：订单管理工作台" />
      <label className="mb-1 block text-xs font-medium">目标读者</label><input className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm" value={audience} onChange={(event) => setAudience(event.target.value)} />
      <input ref={inputRef} type="file" multiple className="hidden" accept="image/*,.pdf,.docx,.ts,.tsx,.js,.jsx,.vue,.py,.rs,.go,.java,.json,.yaml,.yml,.sql,.md" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} />
      <Button className="mb-3 w-full" variant="outline" onClick={() => inputRef.current?.click()}><Paperclip className="h-4 w-4" /> 添加图片、文档或代码</Button>
      <div className="mb-3 space-y-2">{sources.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-md border p-2 text-xs">{item.kind === 'image' ? <Image className="h-4 w-4" /> : <FileText className="h-4 w-4" />}<span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span><button aria-label={`移除 ${item.name}`} onClick={() => setSources((current) => current.filter((source) => source.id !== item.id))}><X className="h-4 w-4" /></button></div>)}</div>
      <label className="mb-1 block text-xs font-medium">粘贴代码（可选）</label><textarea className="mb-3 min-h-32 w-full rounded-md border bg-background p-3 font-mono text-xs" value={code} onChange={(event) => setCode(event.target.value)} placeholder="粘贴核心数据模型、接口或页面代码…" />
      <label className="mb-1 block text-xs font-medium">补充要求（可选）</label><textarea className="mb-3 min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={requirements} onChange={(event) => setRequirements(event.target.value)} placeholder="例如：重点分析权限模型和移动端适配" />
      <label className="mb-2 flex gap-2 text-sm"><input type="checkbox" checked={includeDevelopmentPlan} onChange={(event) => setIncludeDevelopmentPlan(event.target.checked)} />详细开发实施过程</label>
      <label className="mb-4 flex gap-2 text-sm"><input type="checkbox" checked={includeAcceptanceCriteria} onChange={(event) => setIncludeAcceptanceCriteria(event.target.checked)} />可验证验收标准</label>
      <Button className="w-full" disabled={running || !configured} onClick={() => void generate()}>{running ? <Loader2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}{running ? '正在分析材料…' : '生成产品说明文档'}</Button>
      {!configured && <p className="mt-2 text-xs text-amber-600">请先在应用设置中配置 AI 服务；图片分析需要支持视觉的模型。</p>}
    </aside>
    <main className="flex min-w-0 flex-1 flex-col"><header className="flex items-center justify-between border-b px-5 py-3"><div><h2 className="font-medium">生成结果</h2><p className="text-xs text-muted-foreground">所有推断与待确认项会单独标注</p></div><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!result} onClick={() => { void navigator.clipboard.writeText(result); toast.success('已复制'); }}><Copy className="h-4 w-4" />复制</Button><Button size="sm" variant="ghost" disabled={!result} onClick={() => downloadProductSpec(`${productName || '产品说明文档'}.md`, result)}><Download className="h-4 w-4" />下载</Button><Button size="sm" variant="ghost" disabled={!result} onClick={() => setResult('')}><Trash2 className="h-4 w-4" />清空</Button></div></header>
      <div className="flex-1 overflow-y-auto p-6">{result ? <article className="prose prose-sm mx-auto max-w-5xl dark:prose-invert"><XMarkdown>{result}</XMarkdown></article> : <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground"><div><FileText className="mx-auto mb-3 h-10 w-10 opacity-40" /><p>添加材料后生成详细产品说明文档</p><p className="mt-1 text-xs">支持界面截图、PDF、Word 与常见代码文件</p></div></div>}</div>
    </main>
  </div>;
}
