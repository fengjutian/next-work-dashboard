import sys
import re

# Read the source file in binary to preserve original encoding
src_path = r'D:\github\next-work-dashboard\prompt-lab\src\plugins\compare\ComparePanel.tsx'
dst_path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'

with open(src_path, 'rb') as f:
    data = f.read()

# Decode using the actual encoding. The file has CRLF line endings.
# Try utf-8 first; if mojibake, try gb18030.
text = data.decode('utf-8', errors='replace')
# Convert CRLF -> LF for in-memory processing
text = text.replace('\r\n', '\n')

# 1. Replace `import { ... } from '@/lib/text-diff';` to import from `../core/text-diff` (and remove the text-diff-client one)
# Combine text-diff + text-diff-client into one import from ../core/text-diff
text = text.replace(
    "import { applyTextDiffHunk, createUnifiedDiff, prepareTextForComparison } from '@/lib/text-diff';\n"
    "import { createUnifiedDiffAsync } from '@/lib/text-diff-client';\n",
    "import { applyTextDiffHunk, createUnifiedDiff, prepareTextForComparison, type TextDiffHunk } from '../core/text-diff';\n"
)
text = text.replace(
    "import { applyUnifiedPatch, parseUnifiedPatch, type UnifiedPatch } from '@/lib/unified-patch';\n",
    "import { applyUnifiedPatch, parseUnifiedPatch, type UnifiedPatch } from '../core/unified-patch';\n"
)
text = text.replace(
    "import {\n  applyJsonPatch, canonicalizeJson, changesOnlyText, createJsonPatch, diffJsonTree,\n  formatCsvForComparison, formatEnvForComparison, formatJsonForComparison, formatMarkdownForComparison,\n  formatXmlForComparison, formatYamlForComparison, normalizeChineseLines, normalizeParagraphs,\n  type CompareMode, type JsonPatchOperation,\n} from '@/lib/comparison-modes';\n",
    "import {\n  applyJsonPatch, canonicalizeJson, changesOnlyText, createJsonPatch, diffJsonTree,\n  formatCsvForComparison, formatEnvForComparison, formatJsonForComparison, formatMarkdownForComparison,\n  formatXmlForComparison, formatYamlForComparison, normalizeChineseLines, normalizeParagraphs,\n  type CompareMode, type JsonPatchOperation,\n} from '../core/comparison-modes';\n"
)
text = text.replace(
    "import type { FilePickResult, WorkspaceEncoding } from '@/types/electron';\n",
    "import type { FilePickResult, WorkspaceEncoding } from '../core/types';\n"
)
text = text.replace(
    "import { ArrowLeft, ArrowLeftRight, ArrowRight, Columns2, Copy, Download, FileDiff, FileText, Rows3, Save, Upload } from '@/components/icons';\n",
    "import { ArrowLeft, ArrowLeftRight, ArrowRight, Columns2, Copy, Download, FileDiff, FileText, Rows3, Save, Upload } from 'lucide-react';\n"
)
text = text.replace(
    "import { Button } from '@/components/ui/button';\n",
    ""
)
text = text.replace(
    "import { useStore } from '@/store';\n",
    ""
)
text = text.replace(
    "import { configureMonaco } from '@/lib/monaco-setup';\n",
    ""
)
text = text.replace(
    "import { decodeBase64Utf8, languageIdFromName } from '@/plugins/code-editor/editor-utils';\n",
    ""
)

# Replace the bottom imports (already exists in migrated file):
text = text.replace(
    "import { DIFF_WORKER_THRESHOLD, useTextDiffHunks } from './useTextDiffHunks';\n",
    "import { DIFF_WORKER_THRESHOLD, useTextDiffHunks } from './useTextDiffHunks';\n"
)

# Add adapter + diff-client + types
old_top_imports = (
    "import React, { useEffect, useMemo, useRef, useState } from 'react';\n"
    "import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';\n"
    "import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';\n"
)
new_top_imports = (
    "import React, { useEffect, useMemo, useRef, useState } from 'react';\n"
    "import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';\n"
    "import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';\n"
    "import type { FilePickResult, WorkspaceEncoding, SaveFileOptions, SaveFileResult, WriteTextFileOptions, WriteTextFileResult } from '../core/types';\n"
    "import { useCompareAdapter } from './context';\n"
    "import { createDiffClient } from './diff-worker-client';\n"
)
text = text.replace(old_top_imports, new_top_imports)

# Remove configureMonaco() top-level call
text = text.replace("\nconfigureMonaco();\n", "\n")

# Replace useStore calls with adapter
text = text.replace(
    "const theme = useStore((state) => state.theme);\n"
    "  const activeActivity = useStore((state) => state.activeActivity);",
    "const { api, store, monaco, worker, events } = useCompareAdapter();\n"
    "  // Lazily initialise Monaco once on first render. Idempotent.\n"
    "  monaco.configureMonaco();\n"
    "  const theme = store.theme;\n"
    "  const activeActivity = store.activeActivity;\n"
    "  const diffClient = useMemo(() => createDiffClient(worker), [worker]);"
)

# Add the type declarations that were originally in compare/ComparePanel.tsx
# (CompareDocument, SaveConflict, PatchSession)
# These were declared near the top of the file.
old_type_block = (
    "import { UnifiedDiffView } from './UnifiedDiffView';\n"
    "\n"
    "interface CompareDocument {\n"
)
new_type_block = (
    "import { UnifiedDiffView } from './UnifiedDiffView';\n"
    "\n"
    "interface CompareDocument {\n"
)
# The interfaces already exist - good. We just need to keep them.
# But the migrated version had them deleted in the import replacement. Let me check.

# Actually, since the type definitions for CompareDocument, SaveConflict, PatchSession
# were at the top of the original file, they should be preserved. Let me verify
# they still exist in text.

if "interface CompareDocument" not in text:
    # Add the type definitions after the last import
    text = text.replace(
        "import { UnifiedDiffView } from './UnifiedDiffView';\n",
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

# Replace `createUnifiedDiffAsync(` with `diffClient.createUnifiedDiffAsync(`
text = text.replace("createUnifiedDiffAsync(", "diffClient.createUnifiedDiffAsync(")

# Replace `languageIdFromName(` with `monaco.languageIdFromName(`
text = text.replace("languageIdFromName(", "monaco.languageIdFromName(")

# Replace `decodeBase64Utf8(` with `monaco.decodeBase64Utf8(`
text = text.replace("decodeBase64Utf8(", "monaco.decodeBase64Utf8(")

# Replace window.electronAPI.pickFile with api.pickFile
text = text.replace("window.electronAPI.pickFile(", "api.pickFile(")

# Replace window.electronAPI.saveFile with api.saveFile (3-arg)
text = text.replace("window.electronAPI.saveFile(", "api.saveFile(")

# Replace window.electronAPI.writeTextFile with api.writeTextFile
text = text.replace("window.electronAPI.writeTextFile(", "api.writeTextFile(")

# Replace the useEffect block that listens to compare:open-content
old_block = (
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
new_block = (
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
text = text.replace(old_block, new_block)

# Also fix the openComparison signature: it was taking (event: Event) but
# the adapter passes the detail directly. Let me look at what it was:
old_open = (
    "    const openComparison = (event: Event) => {\n"
    "      applyComparison((event as CustomEvent<{ left?: CompareDocument; right?: CompareDocument }>).detail);\n"
    "      sessionStorage.removeItem('compare.pending.v1');\n"
    "    };\n"
)
new_open = (
    "    const openComparison = (detail: { left?: CompareDocument; right?: CompareDocument }) => {\n"
    "      applyComparison(detail);\n"
    "      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }\n"
    "    };\n"
)
text = text.replace(old_open, new_open)

# Replace the saveDocument block that uses window.electronAPI return type
old_save = (
    "    const options = { encoding: document.encoding ?? 'utf8', lineEnding: document.lineEnding ?? 'LF' };\n"
    "    let result: Awaited<ReturnType<typeof window.electronAPI.writeTextFile>>;\n"
    "    if (document.path && !saveAs) {\n"
    "      result = await window.electronAPI.writeTextFile(document.path, document.content, { ...options, expectedModifiedAt: document.modifiedAt, force });\n"
    "    } else {\n"
    "      result = await window.electronAPI.saveFile(document.content, document.label, options);\n"
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

# Replace the openFile + openTwoFiles to use api.pickFile result mapping
old_openFile = (
    "  const openFile = async (side: 'left' | 'right') => {\n"
    "    const result = await window.electronAPI.pickFile();\n"
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
    "      const document = documentFromFile({\n"
    "        name: file.name, path: file.path, text: file.text, content: file.content,\n"
    "        encoding: file.encoding, lineEnding: file.lineEnding, modifiedAt: file.modifiedAt, readOnly: file.readOnly,\n"
    "      });\n"
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
    "    const result = await window.electronAPI.pickFile({ multiple: true });\n"
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
    "      setLeft(documentFromFile({\n"
    "        name: files[0].name, path: files[0].path, text: files[0].text, content: files[0].content,\n"
    "        encoding: files[0].encoding, lineEnding: files[0].lineEnding, modifiedAt: files[0].modifiedAt, readOnly: files[0].readOnly,\n"
    "      }));\n"
    "      setRight(documentFromFile({\n"
    "        name: files[1].name, path: files[1].path, text: files[1].text, content: files[1].content,\n"
    "        encoding: files[1].encoding, lineEnding: files[1].lineEnding, modifiedAt: files[1].modifiedAt, readOnly: files[1].readOnly,\n"
    "      }));\n"
    "      setActiveChange(-1);\n"
    "      setStatus(`已直接比较 ${files[0].name} 与 ${files[1].name}`);\n"
    "    } catch (error) {\n"
    "      setStatus(error instanceof Error ? error.message : '无法读取选择的文件');\n"
    "    }\n"
    "  };\n"
)
text = text.replace(old_openTwo, new_openTwo)

# Now write the file
text = text.replace('\n', '\r\n')  # restore CRLF
with open(dst_path, 'wb') as f:
    f.write(text.encode('utf-8'))

print(f'Wrote {dst_path} ({len(text)} bytes)')
