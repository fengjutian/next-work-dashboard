import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverInterruptedRequest, type AiConversationMessage, type AiPendingRequest } from './ai-conversation';
import { isDbReady, dbInsertAgentMessage, dbInsertAgentProposal, dbDeleteAgentProposals, dbLoadAgentMessages, dbLoadAgentProposals } from '@/db';
import type { AiHunk, OpenDocument } from '../editor-types';

export interface AiFileProposal {
  path: string;
  previousPath?: string;
  original: string;
  modified: string;
  language: string;
  metadata?: OpenDocument;
}

export interface AiEditHistory { id: number; path: string; before: string; after: string }

interface AiSession {
  id: number;
  workspace: string;
  instruction: string;
  timestamp: number;
  filesChanged: number;
  accepted: number;
}

interface UseAiSessionStateOptions {
  workspace: { path: string; name: string } | null;
  sessionId?: string;
  appendOutput: (message: string) => void;
}

function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}

export function useAiSessionState({ workspace, sessionId, appendOutput }: UseAiSessionStateOptions) {
  const persistenceKey = workspace ? `${workspace.path}::${sessionId ?? 'default'}` : null;
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiEditing, setAiEditing] = useState(false);
  const [inlineEdit, setInlineEdit] = useState({ instruction: '', visible: false });
  const [aiSessions, setAiSessions] = useState<AiSession[]>(() => readStored('code-editor.ai-sessions', []));
  const [aiMultiFile, setAiMultiFile] = useState(false);
  const [aiProposals, setAiProposals] = useState<AiFileProposal[]>([]);
  const [aiTokenBudget, setAiTokenBudget] = useState(() => (
    Math.max(4_000, Math.min(64_000, Number(localStorage.getItem('code-editor.ai-token-budget')) || 24_000))
  ));
  const [aiHistory, setAiHistory] = useState<AiEditHistory[]>(() => readStored('code-editor.ai-history', []));
  const [aiHunks, setAiHunks] = useState<AiHunk[]>([]);
  const [aiMessages, setAiMessages] = useState<AiConversationMessage[]>([]);
  const [aiPendingRequest, setAiPendingRequest] = useState<AiPendingRequest | null>(null);
  const restoredDraftWorkspace = useRef<string | null>(null);

  useEffect(() => localStorage.setItem('code-editor.ai-history', JSON.stringify(aiHistory.slice(-50))), [aiHistory]);
  useEffect(() => localStorage.setItem('code-editor.ai-sessions', JSON.stringify(aiSessions.slice(-100))), [aiSessions]);
  useEffect(() => localStorage.setItem('code-editor.ai-token-budget', String(aiTokenBudget)), [aiTokenBudget]);

  useEffect(() => {
    if (!workspace || !persistenceKey) return;
    const drafts = readStored<Record<string, { proposals: AiFileProposal[]; instruction: string }>>('code-editor.ai-drafts.v1', {});
    const draft = drafts[persistenceKey];
    setAiProposals(draft?.proposals ?? []);
    setAiInstruction(draft?.instruction ?? '');
    restoredDraftWorkspace.current = persistenceKey;
    if (draft?.proposals.length) appendOutput(`已恢复 ${draft.proposals.length} 个待审 AI 修改候选`);
    const restoreFromDb = () => {
      if (!isDbReady()) return false;
      const sid = persistenceKey.split('::')[1] ?? persistenceKey;
      const rows = dbLoadAgentProposals(sid);
      if (rows.length > 0) setAiProposals(rows.map((row) => ({
        path: row.path, original: row.original, modified: row.modified,
        language: row.language, previousPath: row.previousPath ?? undefined,
      })));
      return true;
    };
    if (!restoreFromDb()) {
      const timer = window.setTimeout(restoreFromDb, 500);
      return () => window.clearTimeout(timer);
    }
  }, [appendOutput, persistenceKey, workspace]);

  useEffect(() => {
    if (!workspace || !persistenceKey) { setAiMessages([]); setAiPendingRequest(null); return; }
    const conversations = readStored<Record<string, AiConversationMessage[]>>('code-editor.ai-conversations.v1', {});
    const pending = readStored<Record<string, AiPendingRequest>>('code-editor.ai-pending.v1', {});
    setAiMessages(conversations[persistenceKey] ?? []);
    const recovered = recoverInterruptedRequest(pending[persistenceKey]);
    setAiPendingRequest(recovered ?? null);
    if (recovered) {
      setAiInstruction(recovered.instruction);
      appendOutput(`已恢复中断的 AI 请求：${recovered.instruction.slice(0, 80)}`);
    }
    const restoreFromDb = () => {
      if (!isDbReady()) return false;
      const sid = persistenceKey.split('::')[1] ?? persistenceKey;
      const rows = dbLoadAgentMessages(sid, 100, 0);
      if (rows.length > 0) setAiMessages(rows.map((row) => ({
        role: row.role as AiConversationMessage['role'], content: row.content, timestamp: row.timestamp,
      })));
      return true;
    };
    if (!restoreFromDb()) {
      const timer = window.setTimeout(restoreFromDb, 500);
      return () => window.clearTimeout(timer);
    }
  }, [appendOutput, persistenceKey, workspace]);

  useEffect(() => {
    if (!persistenceKey) return;
    const conversations = readStored<Record<string, AiConversationMessage[]>>('code-editor.ai-conversations.v1', {});
    conversations[persistenceKey] = aiMessages.slice(-100);
    localStorage.setItem('code-editor.ai-conversations.v1', JSON.stringify(conversations));
      // Also persist to SQLite
      if (isDbReady() && aiMessages.length > 0) {
        const last = aiMessages[aiMessages.length - 1];
        const sid = persistenceKey.split("::")[1] ?? persistenceKey;
        try { dbInsertAgentMessage({ id: "msg-" + sid + "-" + aiMessages.length, sessionId: sid, role: last.role, content: last.content, seq: aiMessages.length, timestamp: last.timestamp }); } catch { /* localStorage remains the compatibility fallback */ }
      }
  }, [aiMessages, persistenceKey]);

  useEffect(() => {
    if (!persistenceKey) return;
    const pending = readStored<Record<string, AiPendingRequest>>('code-editor.ai-pending.v1', {});
    if (aiPendingRequest) pending[persistenceKey] = aiPendingRequest;
    else delete pending[persistenceKey];
    localStorage.setItem('code-editor.ai-pending.v1', JSON.stringify(pending));
  }, [aiPendingRequest, persistenceKey]);

  useEffect(() => {
    if (!workspace || !persistenceKey || restoredDraftWorkspace.current !== persistenceKey) return;
    try {
      const drafts = readStored<Record<string, { proposals: AiFileProposal[]; instruction: string; savedAt?: number }>>('code-editor.ai-drafts.v1', {});
      if (aiProposals.length) drafts[persistenceKey] = {
        proposals: aiProposals, instruction: aiInstruction, savedAt: Date.now(),
      };
      else delete drafts[persistenceKey];
      localStorage.setItem('code-editor.ai-drafts.v1', JSON.stringify(drafts));
      // Also persist to SQLite as a per-session replacement set.
      if (isDbReady()) {
        const sid = persistenceKey.split("::")[1] ?? persistenceKey;
        try {
          dbDeleteAgentProposals(sid);
          for (let i = 0; i < aiProposals.length; i++) {
            const p = aiProposals[i];
            dbInsertAgentProposal({ id: "prop-" + sid + "-" + i, sessionId: sid, path: p.path, original: p.original, modified: p.modified, language: p.language, previousPath: p.previousPath ?? null, accepted: null, acceptedAt: null, seq: i, createdAt: Date.now() });
          }
        } catch { /* localStorage remains the compatibility fallback */ }
      }
    } catch (error) {
      appendOutput(`AI 待审候选持久化失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [aiInstruction, aiProposals, appendOutput, persistenceKey, workspace]);

  const recordAiSession = useCallback((fileCount: number) => {
    if (!workspace) return;
    const timestamp = Date.now();
    setAiSessions((previous) => [...previous, {
      id: timestamp, workspace: workspace.name, instruction: aiInstruction.trim().slice(0, 80),
      timestamp, filesChanged: fileCount, accepted: 0,
    }]);
  }, [aiInstruction, workspace]);

  const updateSessionAcceptCount = useCallback((count = 1) => {
    setAiSessions((previous) => {
      const last = previous.at(-1);
      return last ? [...previous.slice(0, -1), { ...last, accepted: last.accepted + count }] : previous;
    });
  }, []);

  return {
    aiInstruction, setAiInstruction, aiEditing, setAiEditing, inlineEdit, setInlineEdit,
    aiSessions, aiMultiFile, setAiMultiFile, aiProposals, setAiProposals,
    aiTokenBudget, setAiTokenBudget, aiHistory, setAiHistory, aiHunks, setAiHunks,
    aiMessages, setAiMessages, aiPendingRequest, setAiPendingRequest,
    recordAiSession, updateSessionAcceptCount,
  };
}
