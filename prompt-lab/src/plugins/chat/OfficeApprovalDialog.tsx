import { useEffect, useState } from 'react';
import { ShieldAlert, X } from '@/components/icons';
import { subscribeOfficeApproval, type OfficeApprovalRequest } from '@/services/office-approval';

export function OfficeApprovalDialog() {
  const [request, setRequest] = useState<OfficeApprovalRequest | null>(null);
  useEffect(() => subscribeOfficeApproval(setRequest), []);
  if (!request) return null;
  const decide = (approved: boolean) => { request.respond(approved); setRequest(null); };
  return <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55" role="dialog" aria-modal="true" aria-label="Office AI 操作审批">
    <div className="w-[580px] max-w-[92vw] rounded-xl border bg-card shadow-2xl">
      <div className="flex items-start gap-3 border-b p-4"><ShieldAlert className={`mt-0.5 h-5 w-5 ${request.destructive ? 'text-destructive' : 'text-warning'}`} /><div className="flex-1"><h2 className="text-sm font-semibold">允许 AI 修改 Office 文档？</h2><p className="mt-1 text-xs text-muted-foreground">{request.summary}</p></div><button onClick={() => decide(false)}><X className="h-4 w-4" /></button></div>
      <div className="p-4 text-xs"><div className="mb-2"><span className="text-muted-foreground">操作：</span><code>{request.operation}</code></div><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3">{JSON.stringify(request.arguments, null, 2)}</pre></div>
      <div className="flex justify-end gap-2 border-t p-3"><button onClick={() => decide(false)} className="rounded border px-3 py-1.5 text-xs">拒绝</button><button onClick={() => decide(true)} className={`rounded px-3 py-1.5 text-xs text-white ${request.destructive ? 'bg-destructive' : 'bg-primary'}`}>允许本次操作</button></div>
    </div>
  </div>;
}
