/** Split restored extracted text into readable blocks without treating it as source code. */
export function previewParagraphs(content: string, maxChars = 900): string[] {
  const lines = content.replace(/\r/g, '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const result: string[] = [];
  for (const line of lines) {
    let remaining = line;
    while (remaining.length > maxChars) {
      const candidates = [remaining.lastIndexOf('. ', maxChars), remaining.lastIndexOf('。', maxChars), remaining.lastIndexOf(' ', maxChars)];
      const splitAt = Math.max(...candidates, Math.floor(maxChars * .6));
      result.push(remaining.slice(0, splitAt + 1).trim());
      remaining = remaining.slice(splitAt + 1).trim();
    }
    if (remaining) result.push(remaining);
  }
  return result;
}
