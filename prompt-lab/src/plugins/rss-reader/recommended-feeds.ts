export interface RecommendedFeed {
  title: string;
  url: string;
  category: "AI 前沿" | "工程技术" | "研究论文" | "新闻与周刊";
  language: "中文" | "English";
}

/**
 * A compact starter set selected from the live-verified Tidings RSS Top 200.
 * Keep this deliberately small: importing a feed also downloads its articles.
 */
export const RECOMMENDED_FEEDS: RecommendedFeed[] = [
  { title: "AI 开发者日报", url: "https://ainews.liduos.com/rss.xml", category: "AI 前沿", language: "中文" },
  { title: "OpenAI News", url: "https://openai.com/news/rss.xml", category: "AI 前沿", language: "English" },
  { title: "Anthropic News", url: "https://rsshub.bestblogs.dev/anthropic/news", category: "AI 前沿", language: "English" },
  { title: "Google DeepMind", url: "https://deepmind.com/blog/feed/basic/", category: "AI 前沿", language: "English" },
  { title: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", category: "AI 前沿", language: "English" },
  { title: "Simon Willison's Weblog", url: "https://simonwillison.net/atom/everything/", category: "AI 前沿", language: "English" },
  { title: "Codex Releases", url: "https://github.com/openai/codex/releases.atom", category: "工程技术", language: "English" },
  { title: "Claude Code Releases", url: "https://github.com/anthropics/claude-code/releases.atom", category: "工程技术", language: "English" },
  { title: "MCP Servers Releases", url: "https://github.com/modelcontextprotocol/servers/releases.atom", category: "工程技术", language: "English" },
  { title: "Google Research", url: "https://research.google/blog/rss/", category: "研究论文", language: "English" },
  { title: "Apple Machine Learning Research", url: "https://machinelearning.apple.com/rss.xml", category: "研究论文", language: "English" },
  { title: "arXiv · Computation and Language", url: "https://export.arxiv.org/rss/cs.CL", category: "研究论文", language: "English" },
  { title: "MIT News · Artificial Intelligence", url: "https://news.mit.edu/rss/topic/artificial-intelligence2", category: "新闻与周刊", language: "English" },
  { title: "Last Week in AI", url: "https://lastweekin.ai/feed", category: "新闻与周刊", language: "English" },
];

export function unsubscribedRecommendations(
  subscribedUrls: Iterable<string>,
): RecommendedFeed[] {
  const normalized = new Set(
    [...subscribedUrls].map((url) => url.trim().replace(/\/$/, "")),
  );
  return RECOMMENDED_FEEDS.filter(
    (feed) => !normalized.has(feed.url.replace(/\/$/, "")),
  );
}
