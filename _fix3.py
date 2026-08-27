path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'
with open(path, 'rb') as f:
    data = f.read()

# In the file, the bad pattern is backslash + single quote (0x5c 0x27).
# We want to remove the backslash.
backslashes_quote = bytes([0x5c, 0x27])
quote_only = bytes([0x27])
new_data = data.replace(backslashes_quote, quote_only)
with open(path, 'wb') as f:
    f.write(new_data)

# Verify
with open(path, 'rb') as f:
    check = f.read()
idx = check.find(b'const documentFromFile')
end = check.find(b'CompareDocument', idx) + len(b'CompareDocument')
chunk = check[idx:end]
print('Bytes 160-200:')
print(' '.join(f'{b:02x}' for b in chunk[160:200]))
