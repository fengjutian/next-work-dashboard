path = r'D:/github/next-work-dashboard/prompt-lab/tailwind.config.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
# Insert after compare line
marker = "    '../packages/compare/src/**/*.{ts,tsx}',\n"
insertion = marker + "    '../packages/english-lookup/src/**/*.{ts,tsx}',\n"
if marker in content:
    # Only insert once
    if insertion not in content:
        content = content.replace(marker, insertion, 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print('OK replaced')
    else:
        print('ALREADY INSERTED')
else:
    print('MARKER NOT FOUND')
