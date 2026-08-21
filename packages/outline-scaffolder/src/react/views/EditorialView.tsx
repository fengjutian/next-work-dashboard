import React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "../Button";

type EditorialStageId = "completeness" | "structure" | "facts" | "professional" | "language" | "citations" | "consistency" | "format";
type ChapterEditorialStageId = Exclude<EditorialStageId, "consistency" | "format">;
interface EditorialIssue { id: string; stage: EditorialStageId; severity: "blocker" | "warning"; type: string; message: string; originalText?: string; suggestion?: string; status: "open" | "accepted" | "rejected" }
interface EditorialAudit { status: "pending" | "issues" | "passed" | "stale"; blockers: string[]; warnings: string[]; issues?: EditorialIssue[] }
interface ClaimRecord { id: string; chapter: string; text: string; type: string; evidenceIds: string[]; status: "unreviewed" | "supported" | "disputed" | "unsupported"; notes: string }
interface EvidenceRecord { id: string; title: string; chapter: string; status: "clue" | "verified" | "disputed" }
interface FinalSnapshot { path: string; createdAt: number }
interface EditorialStage { id: EditorialStageId; label: string; scope: "chapter" | "book" }

export interface EditorialViewProps {
  finalReadConfirmed: boolean; setFinalReadConfirmed: (value: boolean) => void; finalSnapshot: FinalSnapshot | null; unlockFinalDraft: () => void;
  editorialChapterPath: string; activeFile: string; setEditorialChapterPath: (path: string) => void; managedFiles: string[];
  claims: ClaimRecord[]; evidenceRecords: EvidenceRecord[]; updateClaim: (id: string, patch: Partial<ClaimRecord>) => void; toggleClaimEvidence: (claim: ClaimRecord, evidenceId: string) => void;
  editorialBatchRunning: boolean; editorialBatchProgress: { current: string; completed: number; total: number; failed: number }; stopEditorialBatch: () => void; runEditorialBatch: () => void;
  hasAiApiKey: boolean; editorialAiLoading: boolean; editorialAiStage: ChapterEditorialStageId; setEditorialAiStage: (stage: ChapterEditorialStageId) => void; runEditorialAiStage: (stage: ChapterEditorialStageId) => void; aiRetryQueue: unknown[]; retryFailedAiReviews: () => void;
  editorialStages: EditorialStage[]; editorialAudits: Record<string, Partial<Record<EditorialStageId, EditorialAudit>>>; editorialRunning: EditorialStageId | null;
  openEditorialIssue: (path: string, issue: EditorialIssue, applySuggestion?: boolean) => void; updateEditorialIssue: (path: string, stage: EditorialStageId, id: string, status: EditorialIssue["status"]) => void;
  runEditorialStage: (stage: EditorialStageId, path?: string) => void; confirmEditorialStage: (stage: EditorialStageId, path?: string) => void;
}

export function EditorialView(props: EditorialViewProps) {
  const { finalReadConfirmed, setFinalReadConfirmed, finalSnapshot, unlockFinalDraft, editorialChapterPath, activeFile, setEditorialChapterPath, managedFiles, claims, evidenceRecords, updateClaim, toggleClaimEvidence, editorialBatchRunning, editorialBatchProgress, stopEditorialBatch, runEditorialBatch, hasAiApiKey, editorialAiLoading, editorialAiStage, setEditorialAiStage, runEditorialAiStage, aiRetryQueue, retryFailedAiReviews, editorialStages: EDITORIAL_STAGES, editorialAudits, editorialRunning, openEditorialIssue, updateEditorialIssue, runEditorialStage, confirmEditorialStage } = props;
  return (<div className="mx-auto max-w-6xl space-y-5">
                {finalReadConfirmed && (
                  <section className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4">
                    <div>
                      <div className="text-sm font-semibold text-emerald-700">
                        正式成稿已锁定
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {finalSnapshot
                          ? `快照：${finalSnapshot.path} · ${new Date(finalSnapshot.createdAt).toLocaleString()}`
                          : "正在生成全书快照…"}
                      </div>
                    </div>
                    <Button variant="outline" onClick={unlockFinalDraft}>
                      解锁修改
                    </Button>
                  </section>
                )}
                {(editorialChapterPath || activeFile) &&
                  (() => {
                    const path = editorialChapterPath || activeFile;
                    const chapterClaims = claims.filter(
                      (claim) => claim.chapter === path,
                    );
                    const supported = chapterClaims.filter(
                      (claim) =>
                        claim.status === "supported" &&
                        claim.evidenceIds.length,
                    );
                    const coverage = chapterClaims.length
                      ? Math.round(
                          (supported.length / chapterClaims.length) * 100,
                        )
                      : 0;
                    return (
                      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <h2 className="text-sm font-semibold">
                              主张—证据绑定
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              事实校验自动抽取高风险主张；至少 80%
                              获得已核实证据支持，才能通过引用校验。
                            </p>
                          </div>
                          <div
                            className={`text-2xl font-semibold ${coverage >= 80 ? "text-emerald-600" : "text-amber-700"}`}
                          >
                            {coverage}%
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${coverage >= 80 ? "bg-emerald-500" : "bg-amber-500"}`}
                            style={{ width: `${coverage}%` }}
                          />
                        </div>
                        <div className="mt-3 max-h-96 space-y-2 overflow-auto">
                          {chapterClaims.map((claim) => (
                            <div
                              key={claim.id}
                              className="rounded-md border border-border p-3"
                            >
                              <div className="text-xs font-medium">
                                {claim.type}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {claim.text}
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-[150px_1fr]">
                                <select
                                  value={claim.status}
                                  onChange={(event) =>
                                    updateClaim(claim.id, {
                                      status: event.target
                                        .value as ClaimRecord["status"],
                                    })
                                  }
                                  className="rounded border border-input bg-background px-2 py-1 text-xs"
                                >
                                  <option value="unreviewed">未审查</option>
                                  <option value="supported">有证据支持</option>
                                  <option value="disputed">存在争议</option>
                                  <option value="unsupported">缺少支持</option>
                                </select>
                                <div className="flex flex-wrap gap-2">
                                  {evidenceRecords
                                    .filter(
                                      (evidence) => evidence.chapter === path,
                                    )
                                    .map((evidence) => (
                                      <label
                                        key={evidence.id}
                                        className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] ${claim.evidenceIds.includes(evidence.id) ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={claim.evidenceIds.includes(
                                            evidence.id,
                                          )}
                                          onChange={() =>
                                            toggleClaimEvidence(
                                              claim,
                                              evidence.id,
                                            )
                                          }
                                        />
                                        {evidence.status === "verified"
                                          ? "✓"
                                          : evidence.status === "disputed"
                                            ? "!"
                                            : "?"}{" "}
                                        {evidence.title}
                                      </label>
                                    ))}
                                </div>
                              </div>
                              <input
                                value={claim.notes}
                                onChange={(event) =>
                                  updateClaim(claim.id, {
                                    notes: event.target.value,
                                  })
                                }
                                placeholder="核实说明、证据边界或争议处理"
                                className="mt-2 w-full rounded border border-input bg-background px-2 py-1 text-xs"
                              />
                            </div>
                          ))}
                          {!chapterClaims.length && (
                            <div className="py-8 text-center text-xs text-muted-foreground">
                              请先运行“事实准确性校验”或对应 AI 深度审校。
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })()}
                <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[220px] flex-1">
                      <div className="text-sm font-semibold">
                        批量 AI 审校队列
                      </div>
                      <p className="text-xs text-muted-foreground">
                        仅处理当前所选阶段中未通过或已失效的章节，可停止后继续。
                      </p>
                    </div>
                    {editorialBatchRunning ? (
                      <>
                        <div className="min-w-[220px] flex-1">
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="truncate">
                              {editorialBatchProgress.current || "准备中"}
                            </span>
                            <span>
                              {editorialBatchProgress.completed}/
                              {editorialBatchProgress.total} · 失败{" "}
                              {editorialBatchProgress.failed}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{
                                width: `${editorialBatchProgress.total ? Math.round(((editorialBatchProgress.completed + editorialBatchProgress.failed) / editorialBatchProgress.total) * 100) : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            stopEditorialBatch();
                          }}
                        >
                          完成当前章后停止
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={!hasAiApiKey || editorialAiLoading}
                        onClick={() => void runEditorialBatch()}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        批量检查未通过章节
                      </Button>
                    )}
                  </div>
                </section>
                <section className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[220px] flex-1">
                      <div className="text-sm font-semibold">
                        AI 分阶段深度审校
                      </div>
                      <p className="text-xs text-muted-foreground">
                        基于当前章节、写作卡和证据台账生成严格结构化问题。
                      </p>
                    </div>
                    <select
                      value={editorialAiStage}
                      onChange={(event) =>
                        setEditorialAiStage(
                          event.target.value as Exclude<
                            EditorialStageId,
                            "consistency" | "format"
                          >,
                        )
                      }
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {EDITORIAL_STAGES.filter(
                        (
                          stage,
                        ): stage is {
                          id: Exclude<
                            EditorialStageId,
                            "consistency" | "format"
                          >;
                          label: string;
                          scope: "chapter";
                        } => stage.scope === "chapter",
                      ).map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={
                        editorialAiLoading ||
                        !(editorialChapterPath || activeFile) ||
                        !hasAiApiKey
                      }
                      onClick={() => void runEditorialAiStage(editorialAiStage)}
                    >
                      {editorialAiLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      AI 深度检查
                    </Button>
                    <Button
                      variant="outline"
                      disabled={editorialAiLoading || !aiRetryQueue.length}
                      onClick={() => void retryFailedAiReviews()}
                    >
                      重试失败项 {aiRetryQueue.length}
                    </Button>
                  </div>
                </section>
                {(editorialChapterPath || activeFile) && (
                  <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold">结构化问题清单</h2>
                        <p className="text-xs text-muted-foreground">
                          定位原文；有安全替换建议时可载入编辑器，确认后再保存。
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {
                          Object.values(
                            editorialAudits[
                              editorialChapterPath || activeFile
                            ] ?? {},
                          )
                            .flatMap((audit) => audit?.issues ?? [])
                            .filter((issue) => issue.status === "open").length
                        }{" "}
                        项待处理
                      </span>
                    </div>
                    <div className="max-h-80 space-y-2 overflow-auto">
                      {Object.values(
                        editorialAudits[editorialChapterPath || activeFile] ??
                          {},
                      )
                        .flatMap((audit) => audit?.issues ?? [])
                        .map((issue) => (
                          <div
                            key={`${issue.stage}-${issue.id}`}
                            className={`rounded-md border p-3 ${issue.status === "rejected" ? "opacity-50" : issue.severity === "blocker" ? "border-destructive/40" : "border-amber-500/30"}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-medium">
                                  {
                                    EDITORIAL_STAGES.find(
                                      (stage) => stage.id === issue.stage,
                                    )?.label
                                  }{" "}
                                  · {issue.type}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {issue.message}
                                </div>
                                {issue.originalText && (
                                  <div className="mt-2 line-clamp-2 rounded bg-muted/60 p-2 font-mono text-[11px]">
                                    {issue.originalText}
                                  </div>
                                )}
                                {issue.suggestion !== undefined && (
                                  <div className="mt-1 line-clamp-2 rounded bg-emerald-500/10 p-2 text-[11px] text-emerald-800">
                                    建议：{issue.suggestion || "删除该套话"}
                                  </div>
                                )}
                              </div>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {issue.status === "open"
                                  ? "待处理"
                                  : issue.status === "accepted"
                                    ? "已接受"
                                    : "已拒绝"}
                              </span>
                            </div>
                            {issue.status === "open" && (
                              <div className="mt-2 flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!issue.originalText}
                                  onClick={() =>
                                    void openEditorialIssue(
                                      editorialChapterPath || activeFile,
                                      issue,
                                    )
                                  }
                                >
                                  定位原文
                                </Button>
                                {issue.suggestion !== undefined && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      void openEditorialIssue(
                                        editorialChapterPath || activeFile,
                                        issue,
                                        true,
                                      )
                                    }
                                  >
                                    载入建议
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    updateEditorialIssue(
                                      editorialChapterPath || activeFile,
                                      issue.stage,
                                      issue.id,
                                      "rejected",
                                    )
                                  }
                                >
                                  拒绝
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </section>
                )}
                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">八阶段审校流水线</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        章节按顺序完成前六项；全部章节通过后开放全书校验。正文修改并保存后，相关结果自动失效。
                      </p>
                    </div>
                    <select
                      value={editorialChapterPath || activeFile}
                      onChange={(event) =>
                        setEditorialChapterPath(event.target.value)
                      }
                      className="max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">选择章节</option>
                      {managedFiles
                        .filter(
                          (path) =>
                            path.toLowerCase().endsWith(".md") &&
                            !/README\.md$/i.test(path),
                        )
                        .map((path) => (
                          <option key={path} value={path}>
                            {path.split("/").pop()}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {EDITORIAL_STAGES.filter(
                      (stage) => stage.scope === "chapter",
                    ).map((stage, index) => {
                      const path = editorialChapterPath || activeFile;
                      const audit = path
                        ? editorialAudits[path]?.[stage.id]
                        : undefined;
                      const statusText =
                        audit?.status === "passed"
                          ? "已通过"
                          : audit?.status === "issues"
                            ? `${audit.blockers.length} 项阻断，${audit.warnings.length} 项提示`
                            : audit?.status === "stale"
                              ? "正文修改后已失效"
                              : "尚未运行";
                      return (
                        <div
                          key={stage.id}
                          className="rounded-lg border border-border p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              {index + 1}. {stage.label}
                            </span>
                            <span
                              className={`text-xs ${audit?.status === "passed" ? "text-emerald-600" : audit?.blockers.length ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              {statusText}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 w-full"
                            disabled={!path || editorialRunning !== null}
                            onClick={() =>
                              void runEditorialStage(stage.id, path)
                            }
                          >
                            {editorialRunning === stage.id && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            运行检查
                          </Button>
                          {audit?.status === "issues" &&
                            !audit.blockers.length && (
                              <Button
                                size="sm"
                                className="mt-2 w-full"
                                onClick={() =>
                                  confirmEditorialStage(stage.id, path)
                                }
                              >
                                人工确认通过
                              </Button>
                            )}
                          <div className="mt-2 max-h-24 overflow-auto text-[11px]">
                            {audit?.blockers.map((item) => (
                              <div key={item} className="text-destructive">
                                阻断：{item}
                              </div>
                            ))}
                            {audit?.warnings.map((item) => (
                              <div key={item} className="text-amber-700">
                                提示：{item}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="grid gap-3 md:grid-cols-3">
                  {EDITORIAL_STAGES.filter(
                    (stage) => stage.scope === "book",
                  ).map((stage, index) => {
                    const audit = editorialAudits.__book__?.[stage.id];
                    return (
                      <div
                        key={stage.id}
                        className="rounded-xl border border-border bg-card p-4 shadow-sm"
                      >
                        <div className="font-medium">
                          {index + 7}. {stage.label}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {audit?.status === "passed"
                            ? "已通过"
                            : audit?.status === "issues"
                              ? `${audit.blockers.length} 项阻断，${audit.warnings.length} 项提示`
                              : audit?.status === "stale"
                                ? "正文修改后已失效"
                                : "前六项全部通过后开放"}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 w-full"
                          disabled={editorialRunning !== null}
                          onClick={() => void runEditorialStage(stage.id)}
                        >
                          {editorialRunning === stage.id && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          运行检查
                        </Button>
                        {audit?.status === "issues" &&
                          !audit.blockers.length && (
                            <Button
                              size="sm"
                              className="mt-2 w-full"
                              onClick={() => confirmEditorialStage(stage.id)}
                            >
                              人工确认通过
                            </Button>
                          )}
                        <div className="mt-2 max-h-24 overflow-auto text-[11px]">
                          {audit?.blockers.map((item) => (
                            <div key={item} className="text-destructive">
                              阻断：{item}
                            </div>
                          ))}
                          {audit?.warnings.map((item) => (
                            <div key={item} className="text-amber-700">
                              提示：{item}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="font-medium">最终人工通读</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {finalReadConfirmed
                        ? "已确认，书稿进入正式成稿状态"
                        : "出版格式校验通过后开放"}
                    </p>
                    <Button
                      size="sm"
                      className="mt-3 w-full"
                      disabled={
                        editorialAudits.__book__?.format?.status !== "passed" ||
                        finalReadConfirmed
                      }
                      onClick={() => setFinalReadConfirmed(true)}
                    >
                      {finalReadConfirmed ? "正式成稿" : "确认通读完成"}
                    </Button>
                  </div>
                </section>
              </div>
  );
}