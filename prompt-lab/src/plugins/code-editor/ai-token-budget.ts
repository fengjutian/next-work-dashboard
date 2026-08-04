// Token Budget Tracking & Long-Session Management
import { estimateTokens } from "./ai-context";

export interface TokenUsage {
  contextFiles: number; contextTokens: number; messageTokens: number;
  systemTokens: number; totalInput: number; outputTokens: number;
  limit: number; remaining: number;
}

export interface BudgetCheckResult {
  canProceed: boolean; usage: TokenUsage;
  warning?: "near_limit" | "over_limit" | "compression_needed";
  recommendation?: string;
}

export interface ConversationSummary {
  text: string; compressedCount: number;
  preservedConstraints: string[]; fileReferences: string[];
  timestamp: number;
}

export function estimateMessageTokens(msgs: Array<{ role: string; content: string }>) {
  let total = 0, system = 0;
  const perMessage: number[] = [];
  for (const msg of msgs) {
    const t = estimateTokens(msg.content) + 4;
    perMessage.push(t); total += t;
    if (msg.role === "system") system += t;
  }
  return { total, system, perMessage };
}

export function checkTokenBudget(
  messages: Array<{ role: string; content: string }>,
  contextFiles: Array<{ path: string; content: string }>,
  budgetLimit: number, outputReserve = 4096,
): BudgetCheckResult {
  const m = estimateMessageTokens(messages);
  let ctx = 0; for (const f of contextFiles) ctx += estimateTokens(f.content) + estimateTokens(f.path) + 12;
  const input = m.total + ctx;
  const remaining = Math.max(0, budgetLimit - input);
  const usage: TokenUsage = { contextFiles: contextFiles.length, contextTokens: ctx, messageTokens: m.total, systemTokens: m.system, totalInput: input, outputTokens: 0, limit: budgetLimit, remaining };
  if (input > budgetLimit) return { canProceed: false, usage, warning: "over_limit", recommendation: "Input exceeds " + budgetLimit + " token limit." };
  if (remaining < outputReserve * 0.3) return { canProceed: true, usage, warning: "near_limit", recommendation: "Only " + remaining + " tokens for output." };
  if (input > budgetLimit * 0.6) return { canProceed: true, usage, warning: "compression_needed", recommendation: "Input at " + Math.round(input / budgetLimit * 100) + "% of budget." };
  return { canProceed: true, usage };
}

export function createConversationSummary(
  messages: Array<{ role: string; content: string }>, keepRecent = 4,
): ConversationSummary {
  if (messages.length <= keepRecent) return { text: "", compressedCount: 0, preservedConstraints: [], fileReferences: [], timestamp: Date.now() };
  const old = messages.slice(0, -keepRecent);
  const constraints: string[] = [];
  const fileRefs: string[] = [];
  for (const msg of old) {
    if (msg.role !== "user") continue;
    const pm = msg.content.match(/[a-zA-Z0-9_./-]+.(?:tsx?|jsx?|json|css|md|py|go|rs)/gi);
    if (pm) for (const p of pm) { if (!fileRefs.includes(p)) fileRefs.push(p); }
    const cm = msg.content.match(/不得|禁止|不允许|不能|必须|一定要|don.t|never|must not|cannot|required|ensure/gi);
    if (cm) for (const c of cm) { if (!constraints.includes(c)) constraints.push(c); }
  }
  const userMsgs = old.filter(function(m) { return m.role === "user"; });
  const goals = userMsgs.slice(0, 3).map(function(m) { return m.content.slice(0, 80).replace(/s+/g, " ").trim(); }).filter(Boolean).join(" | ");
  const parts: string[] = [];
  parts.push("[Summary] Compressed " + old.length + " messages.");
  if (goals) parts.push("Goals: " + goals);
  if (constraints.length) parts.push("Constraints: " + constraints.slice(0, 5).join("; "));
  if (fileRefs.length) parts.push("Files: " + fileRefs.slice(0, 8).join(", "));
  return {
    text: parts.join(String.fromCharCode(10)),
    compressedCount: old.length,
    preservedConstraints: constraints.slice(0, 10),
    fileReferences: fileRefs.slice(0, 20),
    timestamp: Date.now(),
  };
}

export function applyTraceableSummary(
  messages: Array<{ role: string; content: string }>, keepRecent = 4,
) {
  const summary = createConversationSummary(messages, keepRecent);
  if (summary.compressedCount === 0) return { newMessages: messages, summary };
  const recent = messages.slice(-keepRecent);
  const systemMsg = { role: "system" as const, content: summary.text };
  return { newMessages: [systemMsg, ...recent], summary };
}
