export interface WebsiteMetadata {
  url: string;
  title: string;
  description: string;
  keywords: string[];
  textSample: string;
}

export function extractWebsiteMetadata(html: string, url: string): WebsiteMetadata {
  const title = decodeEntities(firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ])).trim();
  const description = decodeEntities(firstMatch(html, [
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i,
  ])).trim();
  const keywords = decodeEntities(firstMatch(html, [
    /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']keywords["']/i,
  ])).split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  const textSample = decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')).trim().slice(0, 3000);
  return { url, title: title.slice(0, 300), description: description.slice(0, 1000), keywords, textSample };
}

function firstMatch(html: string, patterns: RegExp[]): string {
  for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return match[1]; }
  return '';
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }[entity] || entity));
}
