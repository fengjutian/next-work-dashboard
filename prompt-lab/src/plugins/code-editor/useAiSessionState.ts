import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverInterruptedRequest, type AiConversationMessage, type AiPendingRequest } from './ai-conversation';
import type { AiHunk, OpenDocument } from './editor-types';

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
  appendOutput: (message: string) => void;
}

function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}

export function useAiSessionState({ workspace, appendOutput }: UseAiSessionStateOptions) {
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
    if (!workspace) return;
    const drafts = readStored<Record<string, { proposals: AiFileProposal[]; instruction: string }>>('code-editor.ai-drafts.v1', {});
    const draft = drafts[workspace.path];
    setAiProposals(draft?.proposals ?? []);
    if (draft?.instruction) setAiInstruction(draft.instruction);
    restoredDraftWorkspace.current = workspace.path;
    if (draft?.proposals.length) appendOutput(`已恢复 ${draft.proposals.length} 个待审 AI 修改候选`);
  }, [appendOutput, workspace]);

  useEffect(() => {
    if (!workspace) { setAiMessages([]); setAiPendingRequest(null); return; }
    const conversations = readStored<Record<string, AiConversationMessage[]>>('code-editor.ai-conversations.v1', {});
    const pending = readStored<Record<string, AiPendingRequest>>('code-editor.ai-pending.v1', {});
    setAiMessages(conversations[workspace.path] ?? []);
    const recovered = recoverInterruptedRequest(pending[workspace.path]);
    setAiPendingRequest(recovered ?? null);
    if (recovered) {
      setAiInstruction(recovered.instruction);
      appendOutput(`已恢复中断的 AI 请求：${recovered.instruction.slice(0, 80)}`);
    }
  }, [appendOutput, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const conversations = readStored<Record<string, AiConversationMessage[]>>('code-editor.ai-conversations.v1', {});
    conversations[workspace.path] = aiMessages.slice(-100);
    localStorage.setItem('code-editor.ai-conversations.v1', JSON.stringify(conversations));
  }, [aiMessages, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const pending = readStored<Record<string, AiPendingRequest>>('code-editor.ai-pending.v1', {});
    if (aiPendingRequest) pending[workspace.path] = aiPendingRequest;
    else delete pending[workspace.path];
    localStorage.setItem('code-editor.ai-pending.v1', JSON.stringify(pending));
  }, [aiPendingRequest, workspace]);

  useEffect(() => {
    if (!workspace || restoredDraftWorkspace.current !== workspace.path) return;
    try {
      const drafts = readStored<Record<string, { proposals: AiFileProposal[]; instruction: string; savedAt?: number }>>('code-editor.ai-drafts.v1', {});
      if (aiProposals.length) drafts[workspace.path] = {
        proposals: aiProposals, instruction: aiInstruction, savedAt: Date.now(),
      };
      else delete drafts[workspace.path];
      localStorage.setItem('code-editor.ai-drafts.v1', JSON.stringify(drafts));
    } catch (error) {
      appendOutput(`AI 待审候选持久化失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [aiInstruction, aiProposals, appendOutput, workspace]);

  const recordAiSession = useCallback((fileCount: number) => {
    if (!workspace) return;
    const timestamp = Date.now();
    setAiSessions((previous) => [...previous, {
      id: timestamp, workspace: workspace.name, instruction: aiInstruction.trim().slice(0, 80),
      timestamp, filesChanged: fileCount, accepted: 0,
    }]);
  }, [aiInstruction, workspace]);

  const updateSessionAcceptCount = useCallback(() => {
    setAiSessions((previous) => {
      const last = previous.at(-1);
      return last ? [...previous.slice(0, -1), { ...last, accepted: last.accepted + 1 }] : previous;
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
