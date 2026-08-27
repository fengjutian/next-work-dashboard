import re

path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'
with open(path, 'rb') as f:
    text = f.read().decode('utf-8').replace('\r\n', '\n')

# Fix the bad escape: '\'LF'\' should be 'LF'
# The PowerShell inserted literal backslashes
text = re.sub(r"\\'([A-Z]+)\\'", r"'\1'", text)

text = text.replace('\n', '\r\n')
with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))

# Verify
with open(path, 'rb') as f:
    check = f.read().decode('utf-8')

m = re.search(r'const documentFromFile.*?CompareDocument', check)
if m:
    print('FOUND:', m.group(0)[:200])
else:
    print('NOT FOUND')
