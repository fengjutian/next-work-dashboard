path = r'D:\github\next-work-dashboard\packages\compare\src\react\ComparePanel.tsx'
with open(path, 'rb') as f:
    data = f.read()

# Replace '' with ' (just remove the extra quote)
double_quote = bytes([0x27, 0x27])
single_quote = bytes([0x27])
new_data = data.replace(double_quote, single_quote)
with open(path, 'wb') as f:
    f.write(new_data)

print('Done')
