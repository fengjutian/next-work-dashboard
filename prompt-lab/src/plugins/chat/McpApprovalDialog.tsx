import { useEffect, useState } from 'react';
import { ShieldAlert, X } from '@/components/icons';
import { subscribeMcpApproval, type McpApprovalDecision, type McpApprovalRequest } from '@/services/mcp-approval';

export function McpApprovalDialog() {
  const [request, setRequest] = useState<McpApprovalRequest | null>(null);

  useEffect(() => subscribeMcpApproval(setRequest), []);

  if (!request) return null;
  const decide = (decision: McpApprovalDecision) => {
    request.respond(decision);
    setRequest(null);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55" role="dialog" aria-modal="true" aria-label="MCP 工具审批">
      <div className="w-[560px] max-w-[92vw] rounded-xl border bg-card shadow-2xl">
        <div className="flex items-start gap-3 border-b p-4">
          <ShieldAlert className={`mt-0.5 h-5 w-5 ${request.destructive ? 'text-destructive' : 'text-warning'}`} />
          <div className="flex-1">
            <h2 className="text-sm font-semibold">允许 MCP 工具调用？</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {request.destructive ? '该工具声明可能执行破坏性修改，每次调用都必须审批。' : '该工具可能修改数据或访问外部系统。'}
            </p>
          </div>
          <button className="rounded p-1 hover:bg-muted" onClick={() => decide('deny')} aria-label="拒绝"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-4 text-xs">
          <div className="grid grid-cols-[80px_1fr] gap-2"><span className="text-muted-foreground">Server</span><code>{request.tool.serverId}</code></div>
          <div className="grid grid-cols-[80px_1fr] gap-2"><span className="text-muted-foreground">工具</span><code>{request.tool.name}</code></div>
          <div>
            <div className="mb-1 text-muted-foreground">调用参数</div>
            <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(request.arguments, null, 2)}</pre>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t p-3">
          <button className="rounded border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => decide('deny')}>拒绝</button>
          {!request.destructive && <button className="rounded border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => decide('session')}>本会话允许</button>}
          {!request.destructive && <button className="rounded border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => decide('always')}>始终允许此工具</button>}
          <button className={`rounded px-3 py-1.5 text-xs text-white ${request.destructive ? 'bg-destructive' : 'bg-primary'}`} onClick={() => decide('once')}>仅本次允许</button>
        </div>
      </div>
    </div>
  );
}
