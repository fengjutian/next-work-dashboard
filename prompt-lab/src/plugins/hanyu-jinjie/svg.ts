const BLOCKED_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas']);
const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);

export function extractSvgSource(raw: string): string {
  const cleaned = raw.trim()
    .replace(/^```(?:svg|xml|html)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^<\?xml[^>]*>\s*/i, '')
    .trim();
  const start = cleaned.search(/<svg(?:\s|>)/i);
  const closingMatches = [...cleaned.matchAll(/<\/svg\s*>/gi)];
  const end = closingMatches.at(-1);
  return start >= 0 && end ? cleaned.slice(start, (end.index || 0) + end[0].length) : cleaned;
}

export function sanitizeGeneratedSvg(raw: string): string {
  const source = extractSvgSource(raw);
  if (!/<svg(?:\s|>)/i.test(source)) throw new Error('模型回复中没有找到 SVG 卡片，请重新生成');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName.toLocaleLowerCase() !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('模型没有返回有效的 SVG，请重新生成');
  }

  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (BLOCKED_ELEMENTS.has(element.localName.toLocaleLowerCase())) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLocaleLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'srcdoc') { element.removeAttribute(attribute.name); continue; }
      if (URL_ATTRIBUTES.has(name) && value && !value.startsWith('#')) { element.removeAttribute(attribute.name); continue; }
      if ((name === 'style' || name === 'fill' || name === 'stroke' || name === 'filter') && /url\s*\(\s*["']?(?!#)/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const attribute of Array.from(root.attributes)) {
    if (attribute.name.toLocaleLowerCase().startsWith('on')) root.removeAttribute(attribute.name);
  }
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '汉语新解生成卡片');
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return new XMLSerializer().serializeToString(root);
}

export function safeCardFilename(word: string): string {
  const printable = [...word].map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  return (printable.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 40) || '未命名') + '.svg';
}
