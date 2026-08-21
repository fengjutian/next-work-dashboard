import React from "react";
import type { EditorialRole, VersionComparison } from "../../core/editorial-analysis";
import { Button } from "../Button";

interface ControversyCard { id: string; topic: string; positions: Array<{ label: string; argument: string; evidenceIds: string[] }>; adoptedPosition: string; rationale: string }
interface RoleApproval { id: string; role: EditorialRole; reviewer: string; status: "pending" | "approved" | "changes-requested" }

export interface CollaborationViewProps {
  controversies: ControversyCard[];
  addControversy: () => void;
  updateControversy: (id: string, patch: Partial<ControversyCard>) => void;
  roleApprovals: RoleApproval[];
  ensureRoleApprovals: () => void;
  updateRoleApproval: (id: string, patch: Partial<RoleApproval>) => void;
  versionFiles: string[];
  leftVersion: string;
  rightVersion: string;
  setLeftVersion: (value: string) => void;
  setRightVersion: (value: string) => void;
  refreshVersions: () => void;
  compareVersions: () => void;
  comparison: VersionComparison | null;
}

export function CollaborationView(p: CollaborationViewProps) {
  return <div className="mx-auto mb-5 grid max-w-7xl gap-5 lg:grid-cols-2">
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">学术争议卡</h3><Button size="sm" onClick={p.addControversy}>新增</Button></div>{p.controversies.map((card) => <div key={card.id} className="mt-3 rounded border border-border p-3"><input value={card.topic} onChange={(event) => p.updateControversy(card.id, { topic: event.target.value })} className="w-full rounded border border-input bg-background p-2 text-sm" />{card.positions.map((position, index) => <textarea key={index} value={position.argument} onChange={(event) => p.updateControversy(card.id, { positions: card.positions.map((entry, entryIndex) => entryIndex === index ? { ...entry, argument: event.target.value } : entry) })} placeholder={`${position.label}及依据`} className="mt-2 min-h-14 w-full rounded border border-input bg-background p-2 text-xs" />)}<input value={card.adoptedPosition} onChange={(event) => p.updateControversy(card.id, { adoptedPosition: event.target.value })} placeholder="本书采用立场" className="mt-2 w-full rounded border border-input bg-background p-2 text-xs" /><textarea value={card.rationale} onChange={(event) => p.updateControversy(card.id, { rationale: event.target.value })} placeholder="理由与保留意见" className="mt-2 min-h-14 w-full rounded border border-input bg-background p-2 text-xs" /></div>)}</section>
    <section className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4"><div className="flex justify-between"><h3 className="font-semibold">多角色签核</h3><Button size="sm" variant="outline" onClick={p.ensureRoleApprovals}>生成签核表</Button></div>{p.roleApprovals.map((approval) => <div key={approval.id} className="mt-2 grid gap-2 md:grid-cols-[100px_1fr_130px]"><span className="text-xs">{approval.role}</span><input value={approval.reviewer} onChange={(event) => p.updateRoleApproval(approval.id, { reviewer: event.target.value })} placeholder="签核人" className="rounded border border-input bg-background p-1 text-xs" /><select value={approval.status} onChange={(event) => p.updateRoleApproval(approval.id, { status: event.target.value as RoleApproval["status"] })} className="rounded border border-input bg-background p-1 text-xs"><option value="pending">待签核</option><option value="approved">通过</option><option value="changes-requested">退回</option></select></div>)}</div>
      <div className="rounded-xl border border-border bg-card p-4"><div className="flex justify-between"><h3 className="font-semibold">任意版本比较</h3><Button size="sm" variant="outline" onClick={p.refreshVersions}>刷新</Button></div><div className="mt-2 grid gap-2 md:grid-cols-2">{[p.leftVersion, p.rightVersion].map((value, index) => <select key={index} value={value} onChange={(event) => index ? p.setRightVersion(event.target.value) : p.setLeftVersion(event.target.value)} className="rounded border border-input bg-background p-2 text-xs"><option value="">选择版本</option>{p.versionFiles.map((path) => <option key={path} value={path}>{path}</option>)}</select>)}</div><Button size="sm" className="mt-2 w-full" onClick={p.compareVersions}>比较</Button>{p.comparison && <div className="mt-3 text-xs">相似度 {Math.round(p.comparison.similarity * 100)}%，删除 {p.comparison.removed.length} 行，新增 {p.comparison.added.length} 行<div className="mt-2 grid grid-cols-2 gap-2"><pre className="max-h-32 overflow-auto whitespace-pre-wrap bg-red-500/[0.06] p-2">{p.comparison.removed.map((line) => `− ${line}`).join("\n")}</pre><pre className="max-h-32 overflow-auto whitespace-pre-wrap bg-emerald-500/[0.06] p-2">{p.comparison.added.map((line) => `+ ${line}`).join("\n")}</pre></div></div>}</div>
    </section>
  </div>;
}
