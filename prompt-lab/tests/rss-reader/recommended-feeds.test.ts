import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_FEEDS,
  unsubscribedRecommendations,
} from "../../src/plugins/rss-reader/recommended-feeds";

describe("RSS recommended feeds", () => {
  it("contains unique HTTPS feeds in useful categories", () => {
    expect(RECOMMENDED_FEEDS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(RECOMMENDED_FEEDS.map((feed) => feed.url)).size).toBe(
      RECOMMENDED_FEEDS.length,
    );
    expect(RECOMMENDED_FEEDS.every((feed) => feed.url.startsWith("https://"))).toBe(true);
    expect(new Set(RECOMMENDED_FEEDS.map((feed) => feed.category)).size).toBe(4);
  });

  it("hides existing subscriptions and tolerates a trailing slash", () => {
    const first = RECOMMENDED_FEEDS[0];
    const remaining = unsubscribedRecommendations([`${first.url}/`]);
    expect(remaining).not.toContainEqual(first);
  });
});
