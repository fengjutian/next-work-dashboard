import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import { Button } from "../Button";
import { EditorialDiff } from "../components/EditorialDiff";

interface EvidenceRecord { id: string; title: string; status: string }
interface PendingPatch { path: string; original: string; replacement: string }

export interface DocumentEditorContentProps {
  activeFile: string;
  editorMode: "edit" | "preview";
  pendingPatch: PendingPatch | null;
  undoPendingPatch: () => void;
  evidenceRecords: EvidenceRecord[];
  selectedEvidenceId: string;
  setSelectedEvidenceId: (id: string) => void;
  bindEvidence: () => void;
  documentLoading: boolean;
  editorRef: React.RefObject<HTMLTextAreaElement>;
  content: string;
  setContent: (content: string) => void;
  readOnly: boolean;
  previewImageUrls: Record<string, string>;
  dirty: boolean;
  undoLabel?: string;
  undoDocument: () => void;
  articleWordCount: number;
}

export function DocumentEditorContent(p: DocumentEditorContentProps) {
  return <>
    {p.pendingPatch && p.activeFile === p.pendingPatch.path && <div className="border-b border-border bg-card p-3"><div className="flex items-center justify-between"><div><div className="text-xs font-semibold">审校建议 Diff</div><div className="text-[11px] text-muted-foreground">建议已载入编辑器，保存后正式应用；继续编辑前可撤销。</div></div><Button size="sm" variant="outline" onClick={p.undoPendingPatch}>撤销载入</Button></div><EditorialDiff original={p.pendingPatch.original} replacement={p.pendingPatch.replacement} /></div>}
    {p.editorMode === "edit" && p.activeFile && p.evidenceRecords.length > 0 && <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2"><span className="shrink-0 text-xs text-muted-foreground">证据绑定</span><select value={p.selectedEvidenceId} onChange={(event) => p.setSelectedEvidenceId(event.target.value)} className="min-w-0 max-w-sm flex-1 rounded border border-input bg-background px-2 py-1 text-xs"><option value="">选择史料</option>{p.evidenceRecords.map((item) => <option key={item.id} value={item.id}>{item.status === "verified" ? "✓ " : ""}{item.title}</option>)}</select><Button size="sm" variant="outline" disabled={!p.selectedEvidenceId} onMouseDown={(event) => event.preventDefault()} onClick={p.bindEvidence}>绑定到选中文字</Button><span className="truncate text-xs text-muted-foreground">先在正文中选择一个完整观点或句子</span></div>}
    <div className="min-h-0 flex-1 overflow-auto">{p.documentLoading ? <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : !p.activeFile ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">从左侧选择一个文档</div> : p.editorMode === "edit" ? <textarea ref={p.editorRef} value={p.content} readOnly={p.readOnly} onChange={(event) => p.setContent(event.target.value)} spellCheck={false} className={`h-full min-h-[500px] w-full resize-none border-0 bg-background p-6 font-mono text-sm leading-7 outline-none ${p.readOnly ? "cursor-not-allowed opacity-80" : ""}`} /> : <article className="prose prose-sm mx-auto max-w-4xl p-8 dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ src, alt, ...props }) => <img {...props} src={p.previewImageUrls[src || ""] || src} alt={alt || "章节插图"} /> }}>{p.content}</ReactMarkdown></article>}</div>
    {p.activeFile && <div className="flex h-8 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground"><div className="flex items-center gap-3"><span>{p.dirty ? "有未保存的修改" : "所有修改已保存"}</span>{p.undoLabel && p.dirty && <button type="button" className="text-primary hover:underline" onClick={p.undoDocument}>撤销上次新增</button>}</div><span title="字数已排除 YAML 头信息、Markdown 标记、链接地址和注释">文章 {p.articleWordCount.toLocaleString()} 字 · 原始 {p.content.length.toLocaleString()} 字符</span></div>}
  </>;
}
