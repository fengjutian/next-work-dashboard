import sys

src_path = r'D:\github\next-work-dashboard\prompt-lab\src\plugins\compare\ComparePanel.tsx'
dst_path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'

# Read as bytes to preserve encoding
with open(src_path, 'rb') as f:
    data = f.read()

# Decode as UTF-8 (the actual encoding), then convert CRLF -> LF for processing
text = data.decode('utf-8').replace('\r\n', '\n')

# Replacements (no PowerShell string escape mess)
REPLACEMENTS = [
    (
        "import { applyTextDiffHunk, createUnifiedDiff, prepareTextForComparison } from '@/lib/text-diff';\n"
        "import { createUnifiedDiffAsync } from '@/lib/text-diff-client';\n",
        "import { applyTextDiffHunk, createUnifiedDiff, prepareTextForComparison, type TextDiffHunk } from '../core/text-diff';\n"
    ),
    (
        "import { applyUnifiedPatch, parseUnifiedPatch, type UnifiedPatch } from '@/lib/unified-patch';\n",
        "import { applyUnifiedPatch, parseUnifiedPatch, type UnifiedPatch } from '../core/unified-patch';\n"
    ),
    (
        "import {\n  applyJsonPatch, canonicalizeJson, changesOnlyText, createJsonPatch, diffJsonTree,\n  formatCsvForComparison, formatEnvForComparison, formatJsonForComparison, formatMarkdownForComparison,\n  formatXmlForComparison, formatYamlForComparison, normalizeChineseLines, normalizeParagraphs,\n  type CompareMode, type JsonPatchOperation,\n} from '@/lib/comparison-modes';\n",
        "import {\n  applyJsonPatch, canonicalizeJson, changesOnlyText, createJsonPatch, diffJsonTree,\n  formatCsvForComparison, formatEnvForComparison, formatJsonForComparison, formatMarkdownForComparison,\n  formatXmlForComparison, formatYamlForComparison, normalizeChineseLines, normalizeParagraphs,\n  type CompareMode, type JsonPatchOperation,\n} from '../core/comparison-modes';\n"
    ),
    (
        "import type { FilePickResult, WorkspaceEncoding } from '@/types/electron';\n",
        "import type { FilePickResult, WorkspaceEncoding, SaveFileOptions } from '../core/types';\n"
    ),
    (
        "import { ArrowLeft, ArrowLeftRight, ArrowRight, Columns2, Copy, Download, FileDiff, FileText, Rows3, Save, Upload } from '@/components/icons';\n",
        "import { ArrowLeft, ArrowLeftRight, ArrowRight, Columns2, Copy, Download, FileDiff, FileText, Rows3, Save, Upload } from 'lucide-react';\n"
    ),
    (
        "import { Button } from '@/components/ui/button';\n",
        ""
    ),
    (
        "import { useStore } from '@/store';\n",
        ""
    ),
    (
        "import { configureMonaco } from '@/lib/monaco-setup';\n",
        ""
    ),
    (
        "import { decodeBase64Utf8, languageIdFromName } from '@/plugins/code-editor/editor-utils';\n",
        ""
    ),
]

for old, new in REPLACEMENTS:
    if old not in text:
        print(f'WARN: not found: {old[:60]!r}')
    text = text.replace(old, new)

# Replace the top imports block to add the new ones
old_top = (
    "import React, { useEffect, useMemo, useRef, useState } from 'react';\n"
    "import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';\n"
    "import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';\n"
)
new_top = (
    "import React, { useEffect, useMemo, useRef, useState } from 'react';\n"
    "import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';\n"
    "import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';\n"
    "import { useCompareAdapter } from './context';\n"
    "import { createDiffClient } from './diff-worker-client';\n"
    "import { Button } from './Button';\n"
)
text = text.replace(old_top, new_top)

# Add the type declarations + remove configureMonaco() top-level call
old_imports_end = "import { UnifiedDiffView } from './UnifiedDiffView';\n"
new_imports_end = (
    "import { UnifiedDiffView } from './UnifiedDiffView';\n\n"
    "interface CompareDocument {\n"
    "  label: string;\n"
    "  content: string;\n"
    "  savedContent?: string;\n"
    "  path?: string;\n"
    "  encoding?: WorkspaceEncoding;\n"
    "  lineEnding?: 'LF' | 'CRLF';\n"
    "  modifiedAt?: number;\n"
    "  readOnly?: boolean;\n"
    "}\n\n"
    "interface SaveConflict {\n"
    "  side: 'left' | 'right';\n"
    "  current: {\n"
    "    content: string;\n"
    "    encoding: WorkspaceEncoding;\n"
    "    lineEnding: 'LF' | 'CRLF';\n"
    "    mixedLineEndings: boolean;\n"
    "    modifiedAt: number;\n"
    "  };\n"
    "}\n\n"
    "interface PatchSession {\n"
    "  name: string;\n"
    "  patch: UnifiedPatch;\n"
    "  reverse: boolean;\n"
    "}\n"
)
text = text.replace(old_imports_end, new_imports_end)

# Remove the configureMonaco() call
text = text.replace("\nconfigureMonaco();\n", "\n")

# Replace useStore with adapter
text = text.replace(
    "  const theme = useStore((state) => state.theme);\n"
    "  const activeActivity = useStore((state) => state.activeActivity);",
    "  const { api, store, monaco, worker, events } = useCompareAdapter();\n"
    "  // Lazily initialise Monaco once on first render. Idempotent.\n"
    "  monaco.configureMonaco();\n"
    "  const theme = store.theme;\n"
    "  const activeActivity = store.activeActivity;\n"
    "  const diffClient = useMemo(() => createDiffClient(worker), [worker]);"
)

# Replace functions
text = text.replace("createUnifiedDiffAsync(", "diffClient.createUnifiedDiffAsync(")
text = text.replace("languageIdFromName(", "monaco.languageIdFromName(")
text = text.replace("decodeBase64Utf8(", "monaco.decodeBase64Utf8(")
text = text.replace("window.electronAPI.pickFile(", "api.pickFile(")
text = text.replace("window.electronAPI.saveFile(", "api.saveFile(")
text = text.replace("window.electronAPI.writeTextFile(", "api.writeTextFile(")
text = text.replace(
    "    let result: Awaited<ReturnType<typeof window.electronAPI.writeTextFile>>;\n",
    "    let result: { success: boolean; path?: string; error?: string; modifiedAt?: number; current?: SaveConflict['current'] };\n"
)

# openFile: handle the new PickedFileSingle shape
old_openFile = (
    "  const openFile = async (side: 'left' | 'right') => {\n"
    "    const result = await api.pickFile();\n"
    "    const file = Array.isArray(result) ? result[0] : result;\n"
    "    if (!file) return;\n"
    "    if (file.size > 20 * 1024 * 1024) {\n"
    "      setStatus('文件超过 20MB，已拒绝载入');\n"
    "      return;\n"
    "    }\n"
    "    try {\n"
    "      const document = documentFromFile(file);\n"
    "      if (side === 'left') setLeft(document); else setRight(document);\n"
    "      setStatus(`已载入 ${file.name}`);\n"
    "    } catch (error) {\n"
    "      setStatus(error instanceof Error ? error.message : '无法读取该文件');\n"
    "    }\n"
    "  };\n"
)
new_openFile = (
    "  const openFile = async (side: 'left' | 'right') => {\n"
    "    const result = await api.pickFile();\n"
    "    const file = Array.isArray(result) ? result[0] : result;\n"
    "    if (!file) return;\n"
    "    const size = file.size ?? (file.text?.length ?? file.content?.length ?? 0);\n"
    "    if (size > 20 * 1024 * 1024) {\n"
    "      setStatus('文件超过 20MB，已拒绝载入');\n"
    "      return;\n"
    "    }\n"
    "    try {\n"
    "      const document = documentFromFile(file);\n"
    "      if (side === 'left') setLeft(document); else setRight(document);\n"
    "      setStatus(`已载入 ${file.name}`);\n"
    "    } catch (error) {\n"
    "      setStatus(error instanceof Error ? error.message : '无法读取该文件');\n"
    "    }\n"
    "  };\n"
)
text = text.replace(old_openFile, new_openFile)

old_openTwo = (
    "  const openTwoFiles = async () => {\n"
    "    const result = await api.pickFile({ multiple: true });\n"
    "    const files = Array.isArray(result) ? result : result ? [result] : [];\n"
    "    if (files.length !== 2) {\n"
    "      setStatus('请选择两个文本文件');\n"
    "      return;\n"
    "    }\n"
    "    if (files.some((file) => file.size > 20 * 1024 * 1024)) {\n"
    "      setStatus('文件超过 20MB，已拒绝载入');\n"
    "      return;\n"
    "    }\n"
    "    try {\n"
    "      setLeft(documentFromFile(files[0]));\n"
    "      setRight(documentFromFile(files[1]));\n"
    "      setActiveChange(-1);\n"
    "      setStatus(`已直接比较 ${files[0].name} 与 ${files[1].name}`);\n"
    "    } catch (error) {\n"
    "      setStatus(error instanceof Error ? error.message : '无法读取选择的文件');\n"
    "    }\n"
    "  };\n"
)
new_openTwo = (
    "  const openTwoFiles = async () => {\n"
    "    const result = await api.pickFile({ multiple: true });\n"
    "    const files = Array.isArray(result) ? result : result ? [result] : [];\n"
    "    if (files.length !== 2) {\n"
    "      setStatus('请选择两个文本文件');\n"
    "      return;\n"
    "    }\n"
    "    if (files.some((file) => (file.size ?? (file.text?.length ?? file.content?.length ?? 0)) > 20 * 1024 * 1024)) {\n"
    "      setStatus('文件超过 20MB，已拒绝载入');\n"
    "      return;\n"
    "    }\n"
    "    try {\n"
    "      setLeft(documentFromFile(files[0]));\n"
    "      setRight(documentFromFile(files[1]));\n"
    "      setActiveChange(-1);\n"
    "      setStatus(`已直接比较 ${files[0].name} 与 ${files[1].name}`);\n"
    "    } catch (error) {\n"
    "      setStatus(error instanceof Error ? error.message : '无法读取选择的文件');\n"
    "    }\n"
    "  };\n"
)
text = text.replace(old_openTwo, new_openTwo)

# documentFromFile signature: accept PickedFileSingle (optional content)
old_doc = "  const documentFromFile = (file: FilePickResult): CompareDocument => ({\n"
new_doc = (
    "  const documentFromFile = (file: {\n"
    "    name: string;\n"
    "    path: string;\n"
    "    text?: string;\n"
    "    content?: string;\n"
    "    encoding?: WorkspaceEncoding;\n"
    "    lineEnding?: 'LF' | 'CRLF';\n"
    "    modifiedAt?: number;\n"
    "    readOnly?: boolean;\n"
    "  }): CompareDocument => ({\n"
)
text = text.replace(old_doc, new_doc)
text = text.replace(
    "    content: file.text ?? monaco.decodeBase64Utf8(file.content),\n"
    "    savedContent: file.text ?? monaco.decodeBase64Utf8(file.content),\n",
    "    content: file.text ?? monaco.decodeBase64Utf8(file.content ?? ''),\n"
    "    savedContent: file.text ?? monaco.decodeBase64Utf8(file.content ?? ''),\n"
)

# openComparison event handler
old_open = (
    "    const openComparison = (event: Event) => {\n"
    "      applyComparison((event as CustomEvent<{ left?: CompareDocument; right?: CompareDocument }>).detail);\n"
    "      sessionStorage.removeItem('compare.pending.v1');\n"
    "    };\n"
    "    try {\n"
    "      const pending = sessionStorage.getItem('compare.pending.v1');\n"
    "      if (pending) {\n"
    "        applyComparison(JSON.parse(pending) as { left?: CompareDocument; right?: CompareDocument });\n"
    "        sessionStorage.removeItem('compare.pending.v1');\n"
    "      }\n"
    "    } catch {\n"
    "      sessionStorage.removeItem('compare.pending.v1');\n"
    "    }\n"
    "    window.addEventListener('compare:open-content', openComparison);\n"
    "    return () => window.removeEventListener('compare:open-content', openComparison);\n"
    "  }, []);\n"
)
new_open = (
    "    const openComparison = (detail: { left?: CompareDocument; right?: CompareDocument }) => {\n"
    "      applyComparison(detail);\n"
    "      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }\n"
    "    };\n"
    "    try {\n"
    "      const pending = sessionStorage.getItem('compare.pending.v1');\n"
    "      if (pending) {\n"
    "        applyComparison(JSON.parse(pending) as { left?: CompareDocument; right?: CompareDocument });\n"
    "        try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }\n"
    "      }\n"
    "    } catch {\n"
    "      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }\n"
    "    }\n"
    "    const unsubscribe = events.onOpenContent(openComparison);\n"
    "    return unsubscribe;\n"
    "  }, [events]);\n"
)
text = text.replace(old_open, new_open)

# saveDocument
old_save = (
    "    const options = { encoding: document.encoding ?? 'utf8', lineEnding: document.lineEnding ?? 'LF' };\n"
    "    let result: { success: boolean; path?: string; error?: string; modifiedAt?: number; current?: SaveConflict['current'] };\n"
    "    if (document.path && !saveAs) {\n"
    "      result = await api.writeTextFile(document.path, document.content, { ...options, expectedModifiedAt: document.modifiedAt, force });\n"
    "    } else {\n"
    "      result = await api.saveFile(document.content, document.label, options);\n"
    "    }\n"
)
new_save = (
    "    const options: SaveFileOptions = { encoding: document.encoding ?? 'utf8', lineEnding: document.lineEnding ?? 'LF' };\n"
    "    let result: { success: boolean; path?: string; error?: string; modifiedAt?: number; current?: SaveConflict['current'] };\n"
    "    if (document.path && !saveAs) {\n"
    "      result = await api.writeTextFile(document.path, document.content, { ...options, expectedModifiedAt: document.modifiedAt, force });\n"
    "    } else {\n"
    "      const saved = await api.saveFile(document.content, document.label, options);\n"
    "      result = { success: saved.success, path: saved.path, error: saved.error };\n"
    "    }\n"
)
text = text.replace(old_save, new_save)

# Restore CRLF
text = text.replace('\n', '\r\n')

# Write to destination
with open(dst_path, 'wb') as f:
    f.write(text.encode('utf-8'))

print(f'Wrote {dst_path} ({len(text)} bytes)')
