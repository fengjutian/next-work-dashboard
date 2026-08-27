path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'
with open(path, 'rb') as f:
    text = f.read().decode('utf-8').replace('\r\n', '\n')

# Fix monaco.decodeBase64Utf8(file.content) -> monaco.decodeBase64Utf8(file.content ?? '')
text = text.replace(
    "parseUnifiedPatch(file.text ?? monaco.decodeBase64Utf8(file.content))",
    "parseUnifiedPatch(file.text ?? monaco.decodeBase64Utf8(file.content ?? ''))"
)
text = text.replace(
    "JSON.parse(file.text ?? monaco.decodeBase64Utf8(file.content)) as JsonPatchOperation",
    "JSON.parse(file.text ?? monaco.decodeBase64Utf8(file.content ?? '')) as JsonPatchOperation"
)

# Fix openComparison: the events adapter passes FilePickResult (not CompareDocument).
# The local applyComparison needs CompareDocument. So convert at the boundary.
old_open = (
    "    const openComparison = (detail: { left?: CompareDocument; right?: CompareDocument }) => {\n"
    "      applyComparison(detail);\n"
    "      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }\n"
    "    };\n"
)
new_open = (
    "    const openComparison = (detail: { left?: { label: string; content: string; path?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; savedContent?: string }; right?: { label: string; content: string; path?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; savedContent?: string } }) => {\n"
    "      if (!detail.left || !detail.right) return;\n"
    "      applyComparison({\n"
    "        left: { ...detail.left, readOnly: true },\n"
    "        right: { ...detail.right, readOnly: true },\n"
    "      });\n"
    "      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }\n"
    "    };\n"
)
text = text.replace(old_open, new_open)

# Restore CRLF
text = text.replace('\n', '\r\n')
with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))

print('Done')
