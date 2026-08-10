/**
 * MarkdownWorkspaceController 鈥?涓夋爮甯冨眬涓庡叏灞€鐘舵€併€? *
 * 璐ｄ换锛? *  1. 缁勫悎 useMarkdownDocuments + useMarkdownPersistence + useExternalFileChanges銆? *  2. 鐩戝惉鍏ㄥ眬 plugin:file-open 浜嬩欢锛岃矾鐢卞埌鏈彃浠剁殑 open銆? *  3. 娓叉煋 MarkdownToolbar / MarkdownTabBar / MarkdownOutline / FrontmatterPanel /
 *     BacklinksPanel / MarkdownStatusBar / MarkdownEditor銆? *  4. 澶勭悊淇濆瓨銆佹ā寮忓垏鎹€佸閮ㄥ啿绐?UI銆佹簮鐮?WYSIWYG 鍒囨崲銆? */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, PanelLeft, PanelRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/Toast';
import { MarkdownEditor, type MarkdownEditorCommands, type MarkdownEditorHandle } from './editor/createMarkdownEditor';
import { MarkdownSourceEditor, type MarkdownSourceEditorHandle } from './editor/source-mode';
import { MarkdownToolbar } from './components/MarkdownToolbar';
import { MarkdownTabBar } from './components/MarkdownTabBar';
import { MarkdownOutline } from './components/MarkdownOutline';
import { FrontmatterPanel } from './components/FrontmatterPanel';
import { BacklinksPanel } from './components/BacklinksPanel';
import { MarkdownStatusBar } from './components/MarkdownStatusBar';
import { useMarkdownDocuments } from './hooks/useMarkdownDocuments';
import { useMarkdownPersistence } from './hooks/useMarkdownPersistence';
import { useExternalFileChanges } from './hooks/useExternalFileChanges';
import { checkRoundtrip } from './editor/roundtrip-guard';
import { composeDocument, hasTrailingNewline } from './editor/markdown-codec';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import { cn } from '@/lib/utils';
import { AUTO_SAVE_DEBOUNCE_MS } from './types';
import type { EditorMode, MarkdownDocument, SourceModeReason } from './types';

// 鈹€鈹€ 鏂囦欢鎵撳紑浜嬩欢杞借嵎 鈹€鈹€

interface PluginFileOpenDetail {
  pluginId: string;
  editorId: string;
  file: { path: string; name: string };
}

export const MarkdownWorkspaceController: React.FC = () => {
  const documentsApi = useMarkdownDocuments();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [commands, setCommands] = useState<MarkdownEditorCommands | null>(null);
  const editorHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const sourceHandleRef = useRef<MarkdownSourceEditorHandle | null>(null);
  const [activeLine, setActiveLine] = useState(1);
  const [showOutline, setShowOutline] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const autoSaveTimer = useRef<number | null>(null);

  // 鐭ヨ瘑宸ヤ綔鍖烘牴璺緞锛堢敤浜?Backlink 闈㈡澘锛?  const knowledgeRoot = activeKnowledgeWorkspace.activeRoot;

  const persistence = useMarkdownPersistence({
    onSaved: (id, savedContent, savedAt, version) => {
      documentsApi.markSaved(id, savedContent, savedAt, version);
      // 瑙﹀彂鐭ヨ瘑绱㈠紩鍒锋柊
      const doc = documentsApi.documents.find((d) => d.id === id);
      if (doc) {
        void activeKnowledgeWorkspace.refresh().catch(() => undefined);
      }
    },
    onConflict: (id, incomingContent, incomingModifiedAt) => {
      documentsApi.applyExternalChange(id, { content: incomingContent, modifiedAt: incomingModifiedAt, type: 'change' });
      toast('妫€娴嬪埌澶栭儴鏂囦欢淇敼锛岃閫夋嫨澶勭悊鏂瑰紡', 'warning');
    },
    onError: (id, message) => {
      toast(`淇濆瓨澶辫触锛?{message}`, 'error');
    },
  });

  // 鐩戝惉澶栭儴鏂囦欢鍙樺寲
  useExternalFileChanges(knowledgeRoot, {
    isWatching: (rootPath) => rootPath === knowledgeRoot,
    onChange: (relativePath, incomingContent, modifiedAt, type) => {
      const doc = documentsApi.documents.find(
        (d) => d.rootPath === knowledgeRoot && d.relativePath.replace(/\\/g, '/') === relativePath,
      );
      if (!doc) return;
      // 鍙湪纾佺洏鐗堟湰涓庢湰鍦颁繚瀛樼増鏈笉鍚屻€佷笖涓庢湰鍦板綋鍓嶅唴瀹逛笉鍚屾椂鎻愮ず
      if (incomingContent === doc.savedContent) return;
      documentsApi.applyExternalChange(doc.id, { content: incomingContent, modifiedAt, type });
      toast('澶栭儴鏂囦欢宸蹭慨鏀?, 'info');
    },
  });

  // 鐩戝惉鍏ㄥ眬 plugin:file-open
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PluginFileOpenDetail>).detail;
      if (!detail || detail.pluginId !== 'markdown-editor') return;
      const { file } = detail;
      if (!file?.path) return;
      void openFromPath(file.path, file.name);
    };
    window.addEventListener('plugin:file-open', handler);
    return () => window.removeEventListener('plugin:file-open', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentsApi]);

  // 鑷姩淇濆瓨鍘绘姈
  useEffect(() => {
    const doc = documentsApi.activeDocument;
    if (!doc || !doc.dirty || doc.readOnly) return;
    const settings = readSettings();
    if (!settings.autoSave) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      void handleSave();
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentsApi.activeDocument?.content, documentsApi.activeDocument?.dirty]);

  // 鈹€鈹€ 鎵撳紑鏂囦欢 鈹€鈹€

  const openFromPath = useCallback(
    async (absolutePath: string, fileName: string) => {
      // 瑙ｆ瀽 rootPath 鍜?relativePath
      // 浼樺厛绾э細knowledgeRoot > window.pickFile 缁欑殑缁濆璺緞
      const root = knowledgeRoot;
      if (!root) {
        toast('璇峰厛鍦ㄧ煡璇嗗伐浣滃尯鎵撳紑鐩綍', 'warning');
        return;
      }
      const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
      const normalizedRoot = root.replace(/\\/g, '/');
      let relativePath = fileName;
      if (normalizedAbsolute.startsWith(normalizedRoot)) {
        relativePath = normalizedAbsolute.slice(normalizedRoot.length).replace(/^\/+/, '');
      }
      const result = await window.electronAPI.workspace.readTextFile(root, relativePath);
      if (!result.success || !result.data) {
        toast(`鏃犳硶璇诲彇鏂囦欢锛?{result.error ?? '鏈煡閿欒'}`, 'error');
        return;
      }
      const data = result.data;
      // 濡傛灉鏂囦欢宸叉墦寮€锛屾縺娲?      const existing = documentsApi.documents.find(
        (d) => d.rootPath === root && d.relativePath.replace(/\\/g, '/') === relativePath,
      );
      const doc = documentsApi.open({
        rootPath: root,
        relativePath,
        fileName: data.name ?? relativePath.split('/').pop() ?? fileName,
        content: data.content,
        encoding: data.encoding,
        lineEnding: data.lineEnding.toLowerCase() as 'lf' | 'crlf',
        mixedLineEndings: data.mixedLineEndings,
        readOnly: data.readOnly,
        size: data.size,
        modifiedAt: data.modifiedAt,
        reuseExisting: true,
      });
      if (existing) documentsApi.activate(existing.id);
      else documentsApi.activate(doc.id);
      // 鍚姩寰€杩旀鏌?      scheduleRoundtripCheck(doc.id, data.content);
    },
    [documentsApi, knowledgeRoot, toastApi],
  );

  // 鈹€鈹€ 淇濆瓨 鈹€鈹€

  const handleSave = useCallback(async () => {
    const doc = documentsApi.activeDocument;
    if (!doc || saving) return;
    if (doc.readOnly) {
      toast('鏂囦欢涓哄彧璇?, 'warning');
      return;
    }
    setSaving(true);
    try {
      // 鍚屾浠庣紪杈戝櫒鍙栨渶鏂?body锛堥伩鍏?setState 鏃跺樊锛?      let body = doc.body;
      if (doc.mode === 'wysiwyg' && editorHandleRef.current) {
        body = editorHandleRef.current.getMarkdown();
      } else if (doc.mode === 'source' && sourceHandleRef.current) {
        body = sourceHandleRef.current.getValue();
      }
      const result = await persistence.save(doc, body);
      if (result.success) {
        toast('宸蹭繚瀛?, 'success');
      } else if (!result.externalContent) {
        toast(`淇濆瓨澶辫触锛?{result.error}`, 'error');
      }
    } finally {
      setSaving(false);
    }
  }, [documentsApi, persistence, saving, toastApi]);

  // 鍏ㄥ眬 Ctrl/Cmd+S
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // 鈹€鈹€ 妯″紡鍒囨崲 鈹€鈹€

  const handleToggleMode = useCallback(() => {
    const doc = documentsApi.activeDocument;
    if (!doc) return;
    const next: EditorMode = doc.mode === 'wysiwyg' ? 'source' : 'wysiwyg';
    const reason: SourceModeReason = next === 'source' ? 'user-toggle' : null;
    documentsApi.setActiveMode(next, reason);
  }, [documentsApi]);

  // 鈹€鈹€ 鍏抽棴鏍囩 鈹€鈹€

  const handleClose = useCallback(
    (id: string) => {
      const doc = documentsApi.documents.find((d) => d.id === id);
      if (doc?.dirty) {
        const ok = window.confirm(`銆?{doc.fileName}銆嶆湁鏈繚瀛樼殑淇敼锛岀‘瀹氬叧闂紵`);
        if (!ok) return;
      }
      documentsApi.close(id);
    },
    [documentsApi],
  );

  const handleCloseOthers = useCallback(
    (id: string) => {
      const others = documentsApi.documents.filter((d) => d.id !== id && d.dirty);
      if (others.length > 0) {
        const ok = window.confirm(`鍏朵粬 ${others.length} 涓爣绛炬湁鏈繚瀛樹慨鏀癸紝纭畾鍏抽棴锛焋);
        if (!ok) return;
      }
      for (const d of others) documentsApi.close(d.id);
    },
    [documentsApi],
  );

  const handleCloseAll = useCallback(() => {
    const dirty = documentsApi.documents.filter((d) => d.dirty);
    if (dirty.length > 0) {
      const ok = window.confirm(`${dirty.length} 涓爣绛炬湁鏈繚瀛樹慨鏀癸紝鍏ㄩ儴鍏抽棴锛焋);
      if (!ok) return;
    }
    for (const d of documentsApi.documents) documentsApi.close(d.id);
  }, [documentsApi]);

  // 鈹€鈹€ 澶х翰璺宠浆 鈹€鈹€

  const handleJumpToLine = useCallback(
    (line: number) => {
      if (editorHandleRef.current) editorHandleRef.current.scrollToLine(line);
      if (sourceHandleRef.current) sourceHandleRef.current.scrollTo({ line, column: 1 });
      setActiveLine(line);
    },
    [],
  );

  // 鈹€鈹€ 閾炬帴/鍥剧墖瀵硅瘽妗嗭紙绠€鍖栫増 P0锛氱敤 prompt 鏀堕泦锛?鈹€鈹€

  const handleOpenLinkDialog = useCallback(() => {
    const url = window.prompt('杈撳叆閾炬帴 URL');
    if (url) commands?.insertLink(url);
  }, [commands]);

  const handleOpenImageDialog = useCallback(() => {
    const src = window.prompt('杈撳叆鍥剧墖 URL 鎴栬矾寰勶紙绮樿创鍥剧墖璇风敤鏂囦欢閫夋嫨瀵硅瘽妗?P1锛?);
    if (src) commands?.insertImage(src, src.split('/').pop() ?? '');
  }, [commands]);

  // 鈹€鈹€ 寰€杩旀鏌?鈹€鈹€

  const scheduleRoundtripCheck = useCallback(
    (id: string, original: string) => {
      // 绠€鍖栵細setContent 鈫?getMarkdown 妯℃嫙锛屼絾杩欓噷娌℃湁 Tiptap 瀹炰緥鍙嬁銆?      // 鎴戜滑閫€鑰屾眰鍏舵锛氫笌 savedContent 鍋氳绾?diff锛?      // 瀵逛簬鏈紪杈戠殑鏂囨。锛岀瓑浠蜂簬 selfDiff锛堟棤宸紓锛夈€?      // 鐪熸鐨?parse 鈫?serialize 鈫?parse 妫€鏌ュ湪 P0 閫氳繃 Tiptap 鑷繁鐨?      // 鍐呴儴鍥炵幆瀹屾垚锛堢敤鎴峰湪缂栬緫鍣ㄤ腑鎵€瑙佸嵆鎵€寰楋級锛屽閮ㄩ噸鍋氬彧鍋氬唴瀹?diff銆?      const report = checkRoundtrip(original, original);
      documentsApi.setRoundtrip(id, report);
    },
    [documentsApi],
  );

  // 鈹€鈹€ 娓叉煋 鈹€鈹€

  const activeDocument = documentsApi.activeDocument;
  const settings = useMemo(() => readSettings(), []);

  return (
    <div className="flex h-full flex-col bg-background">
      <MarkdownToolbar
        mode={activeDocument?.mode ?? 'wysiwyg'}
        sourceModeReason={activeDocument?.sourceModeReason ?? null}
        dirty={activeDocument?.dirty ?? false}
        saving={saving}
        roundtripSeverity={activeDocument?.roundtrip.severity ?? 'safe'}
        hasCommands={Boolean(commands)}
        commands={commands}
        onToggleMode={handleToggleMode}
        onSave={() => void handleSave()}
        onOpenLinkDialog={handleOpenLinkDialog}
        onOpenImageDialog={handleOpenImageDialog}
      />
      <MarkdownTabBar
        documents={documentsApi.documents}
        activeId={documentsApi.activeId}
        onActivate={documentsApi.activate}
        onClose={handleClose}
        onCloseOthers={handleCloseOthers}
        onCloseAll={handleCloseAll}
      />
      <div className="flex flex-1 overflow-hidden">
        {showOutline && (
          <aside className="flex w-64 flex-shrink-0 flex-col border-r bg-card">
            <div className="flex h-8 items-center border-b px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              澶х翰
            </div>
            <MarkdownOutline document={activeDocument} activeLine={activeLine} onJump={handleJumpToLine} />
          </aside>
        )}
        <main className="flex flex-1 flex-col overflow-hidden">
          {activeDocument ? (
            <ActiveDocumentSurface
              document={activeDocument}
              setCommands={setCommands}
              editorHandleRef={editorHandleRef}
              sourceHandleRef={sourceHandleRef}
              onContentChange={(body) => {
                documentsApi.updateContent(activeDocument.id, body);
              }}
              onSelectionChange={({ line }) => setActiveLine(line)}
              onJumpToLine={handleJumpToLine}
            />
          ) : (
            <EmptyState onPickFile={() => void pickAndOpenFile(openFromPath, toast)} />
          )}
        </main>
        {showRightPanel && (
          <aside className="flex w-72 flex-shrink-0 flex-col border-l bg-card">
            <div className="flex h-8 items-center border-b px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              鏂囨。淇℃伅
            </div>
            <div className="flex-1 overflow-hidden">
              <FrontmatterPanel
                frontmatter={activeDocument?.frontmatter ?? null}
                fileName={activeDocument?.fileName ?? ''}
                encoding={activeDocument?.encoding ?? 'utf8'}
                lineEnding={activeDocument?.lineEnding ?? 'lf'}
                size={activeDocument?.size ?? 0}
              />
            </div>
            <div className="h-7 flex-shrink-0 border-t bg-muted/40 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center">
              Backlinks
            </div>
            <div className="h-48 flex-shrink-0 overflow-hidden border-t">
              <BacklinksPanel
                rootPath={knowledgeRoot}
                relativePath={
                  activeDocument
                    ? `${activeDocument.rootPath.replace(/\\/g, '/')}/${activeDocument.relativePath.replace(/\\/g, '/')}`
                    : ''
                }
                onJump={({ path, line }) => {
                  const fileName = path.split('/').pop() ?? path;
                  void openFromPath(path, fileName).then(() => handleJumpToLine(line));
                }}
              />
            </div>
          </aside>
        )}
      </div>
      <MarkdownStatusBar
        document={activeDocument}
        roundtrip={activeDocument?.roundtrip ?? { severity: 'safe', issues: [], diffLines: 0, checkedAt: 0 }}
        saving={saving}
      />
      <div className="flex h-6 flex-shrink-0 items-center gap-1 border-t bg-muted/40 px-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setShowOutline((v) => !v)}
          className={cn('flex h-5 w-5 items-center justify-center rounded hover:bg-accent', showOutline && 'bg-accent')}
          title={showOutline ? '闅愯棌澶х翰' : '鏄剧ず澶х翰'}
          aria-label="鍒囨崲澶х翰"
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowRightPanel((v) => !v)}
          className={cn('flex h-5 w-5 items-center justify-center rounded hover:bg-accent', showRightPanel && 'bg-accent')}
          title={showRightPanel ? '闅愯棌渚ф爮' : '鏄剧ず渚ф爮'}
          aria-label="鍒囨崲渚ф爮"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
        <span className="ml-2">璁剧疆锛氳嚜鍔ㄤ繚瀛?{settings.autoSave ? '寮€' : '鍏?}</span>
      </div>
    </div>
  );
};

// 鈹€鈹€ 娲诲姩鏂囨。琛ㄩ潰 鈹€鈹€

interface ActiveDocumentSurfaceProps {
  document: MarkdownDocument;
  setCommands: (handler: MarkdownEditorCommands | null) => void;
  editorHandleRef: React.MutableRefObject<MarkdownEditorHandle | null>;
  sourceHandleRef: React.MutableRefObject<MarkdownSourceEditorHandle | null>;
  onContentChange: (body: string) => void;
  onSelectionChange: (info: { line: number }) => void;
  onJumpToLine: (line: number) => void;
}

const ActiveDocumentSurface: React.FC<ActiveDocumentSurfaceProps> = ({
  document,
  setCommands,
  editorHandleRef,
  sourceHandleRef,
  onContentChange,
  onSelectionChange,
  onJumpToLine,
}) => {
  // 鍒囨崲鏂囨。鏃堕噸缃?commands锛涗繚鐣?handle 寮曠敤浠ヤ究鐖剁粍浠惰Е鍙戞粴鍔?  useEffect(() => {
    setCommands(null);
  }, [document.id, setCommands]);

  if (document.mode === 'wysiwyg') {
    return (
      <MarkdownEditor
        ref={editorHandleRef}
        initialMarkdown={document.body}
        onChange={onContentChange}
        onSelectionChange={onSelectionChange}
        registerCommands={setCommands}
        readOnly={document.readOnly}
      />
    );
  }
  return (
    <MarkdownSourceEditor
      ref={sourceHandleRef}
      value={document.body}
      placeholder="婧愮爜妯″紡锛圕trl+S 淇濆瓨锛?
      readOnly={document.readOnly}
      onChange={onContentChange}
    />
  );
};

// 鈹€鈹€ 绌虹姸鎬?鈹€鈹€

const EmptyState: React.FC<{ onPickFile: () => void }> = ({ onPickFile }) => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
      <Columns2 className="h-10 w-10 opacity-30" />
      <h3 className="text-base font-semibold text-foreground">Markdown 缂栬緫鍣?/h3>
      <p className="max-w-md text-xs">鎵撳紑涓€涓?.md 鏂囦欢寮€濮嬬紪杈戯紝鎴栦粠鏂囦欢鑿滃崟閫夋嫨 "鎵撳紑鏂囦欢鈥?銆?/p>
      <Button onClick={onPickFile} size="sm" variant="default">
        閫夋嫨 Markdown 鏂囦欢
      </Button>
    </div>
  );
};

async function pickAndOpenFile(
  openFromPath: (absolutePath: string, fileName: string) => Promise<void>,
  showToast: (message: string, level: 'info' | 'success' | 'warning' | 'error') => void,
): Promise<void> {
  const result = await window.electronAPI.pickFile({ accept: '.md,.markdown,text/markdown,text/x-markdown' });
  const file = Array.isArray(result) ? result[0] : result;
  if (!file) return;
  if (!/\.(md|markdown)$/i.test(file.name)) {
    showToast('璇烽€夋嫨 .md 鎴?.markdown 鏂囦欢', 'warning');
    return;
  }
  await openFromPath(file.path, file.name);
}

function readSettings(): { autoSave: boolean; defaultSourceMode: boolean; handleMarkdownFiles: boolean } {
  try {
    const raw = localStorage.getItem('markdown-editor.settings.v1');
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { autoSave: false, defaultSourceMode: false, handleMarkdownFiles: true };
}

