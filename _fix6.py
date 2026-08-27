path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'
with open(path, 'rb') as f:
    text = f.read().decode('utf-8').replace('\r\n', '\n')

# openComparison should accept the FilePickResult shape and convert to CompareDocument
old_open = """    const openComparison = (detail: { left?: { label: string; content: string; path?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; savedContent?: string }; right?: { label: string; content: string; path?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; savedContent?: string } }) => {
      if (!detail.left || !detail.right) return;
      applyComparison({
        left: { ...detail.left, readOnly: true },
        right: { ...detail.right, readOnly: true },
      });
      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }
    };"""

new_open = """    const openComparison = (detail: { left?: { name: string; path: string; text?: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; size?: number }; right?: { name: string; path: string; text?: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; size?: number } }) => {
      if (!detail.left || !detail.right) return;
      applyComparison({
        left: { ...documentFromFile(detail.left), readOnly: true },
        right: { ...documentFromFile(detail.right), readOnly: true },
      });
      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }
    };"""

if old_open not in text:
    print('WARN: openComparison block not found exactly. Searching for partial match...')
    # Try to find the line
    for line in text.split('\n'):
        if 'const openComparison' in line:
            print(f'  Found: {line[:100]}')
else:
    text = text.replace(old_open, new_open)
    print('Replaced openComparison')

# Restore CRLF
text = text.replace('\n', '\r\n')
with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))

print('Done')
