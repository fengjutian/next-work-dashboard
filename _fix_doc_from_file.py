import re

path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'
with open(path, 'rb') as f:
    text = f.read().decode('utf-8').replace('\r\n', '\n')

# Replace the broken documentFromFile signature
text = text.replace(
    "const documentFromFile = (file: { name: string; path: string; text?: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean }): CompareDocument",
    "const documentFromFile = (file: { name: string; path: string; text?: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean }): CompareDocument",
)

# Convert back
text = text.replace('\n', '\r\n')
with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))

# Verify
with open(path, 'rb') as f:
    check = f.read().decode('utf-8')

# Find the line
import re
m = re.search(r'const documentFromFile.*?CompareDocument', check)
if m:
    print('FOUND:', m.group(0)[:200])
else:
    print('NOT FOUND')
