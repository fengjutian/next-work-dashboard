/**
 * HTML → Markdown 极简转换
 *
 * 不引入 turndown（重依赖）；自实现覆盖 Phase 1 需要的标签：
 *  h1-h6 / p / br / hr / strong / em / code / pre / blockquote
 *  ul / ol / li / a / img / table / thead / tbody / tr / th / td
 * 未知标签 → 降级为内联文本。
 */

function inline(html: string): string {
  // 链接
  html = html.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
    const t = inline(String(text)).replace(/[[\]]/g, '');
    return `[${t}](${href})`;
  });
  // 图片
  html = html.replace(/<img\s+[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_m, src, alt) => `![${alt}](${src})`);
  html = html.replace(/<img\s+[^>]*src="([^"]+)"[^>]*\/?>/gi, (_m, src) => `![](${src})`);
  // 强调
  html = html.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_m, _t, c) => `**${inline(String(c))}**`);
  html = html.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_m, _t, c) => `*${inline(String(c))}*`);
  html = html.replace(/<code>([\s\S]*?)<\/code>/gi, (_m, c) => `\`${String(c).replace(/`/g, '\\`')}\``);
  // 换行
  html = html.replace(/<br\s*\/?>/gi, '  \n');
  // 剥掉其余标签
  html = html.replace(/<[^>]+>/g, '');
  // 反转义
  html = html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return html;
}

function block(html: string): string {
  let out = html;
  // 预处理：剥 script/style 内容
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');

  // 块级标签换行处理
  out = out.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, c) => `\n\n## ${inline(String(c)).trim()}\n\n`);
  out = out.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  out = out.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, c) => `\n\n> ${inline(String(c)).replace(/\n/g, '\n> ')}\n\n`);
  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c) => `\n\n\`\`\`\n${String(c).replace(/<[^>]+>/g, '').trim()}\n\`\`\`\n\n`);
  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, c) => `\n\n${inline(String(c)).trim()}\n\n`);

  // 列表
  out = out.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, c) => {
    const items = String(c).match(/<li\b[^>]*>([\s\S]*?)<\/li>/gi) || [];
    return '\n\n' + items.map((li) => `- ${inline(li.replace(/<\/?li>/gi, '')).trim()}`).join('\n') + '\n\n';
  });
  out = out.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, c) => {
    const items = String(c).match(/<li\b[^>]*>([\s\S]*?)<\/li>/gi) || [];
    return '\n\n' + items.map((li, i) => `${i + 1}. ${inline(li.replace(/<\/?li>/gi, '')).trim()}`).join('\n') + '\n\n';
  });

  // 表格（极简：每行 `| a | b |`）
  out = out.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, t) => {
    const rows = String(t).match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    const cells = (row: string) =>
      (row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || []).map((c) => inline(c.replace(/<\/?t[hd][^>]*>/gi, '')).trim());
    if (!rows.length) return '';
    const header = cells(rows[0]);
    const separator = header.map(() => '---');
    const body = rows.slice(1).map((r) => `| ${cells(r).join(' | ')} |`).join('\n');
    return `\n\n| ${header.join(' | ')} |\n| ${separator.join(' | ')} |\n${body}\n\n`;
  });

  // 兜底：剥残余标签
  out = out.replace(/<[^>]+>/g, '');
  // 反转义
  out = out.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // HTML 源码中的标签缩进不应变成可见的 Markdown 空白段落。
  out = out.replace(/\n[ \t]+\n/g, '\n\n');
  // 折叠多空行
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

export function htmlToMarkdownInline(html: string): string {
  return inline(html).trim();
}

export function htmlToMarkdown(html: string): string {
  return block(html);
}
