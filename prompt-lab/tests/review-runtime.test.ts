import { describe, expect, it } from "vitest";
import {
  affectedByChange,
  buildDependencyGraph,
  processInChunks,
  ReviewResultCache,
  scheduleRetry,
  stableContentKey,
} from "../../packages/outline-scaffolder/src/core/review-runtime";

describe("large manuscript review runtime", () => {
  it("processes 1,000 chapters without changing order", async () => {
    const chapters = Array.from(
      { length: 1_000 },
      (_, index) => `chapter-${index}`,
    );
    let progress = 0;
    const result = await processInChunks(
      chapters,
      (chapter) => chapter.toUpperCase(),
      {
        chunkSize: 25,
        onProgress: (done) => {
          progress = done;
        },
      },
    );
    expect(result[999]).toBe("CHAPTER-999");
    expect(progress).toBe(1_000);
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      processInChunks([1], (value) => value, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("caches by stable content signature and evicts old values", () => {
    expect(stableContentKey(["a", 1])).toBe(stableContentKey(["a", 1]));
    const cache = new ReviewResultCache<number>({}, 1);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("uses exponential retry delay", () => {
    const first = scheduleRetry(
      [],
      { chapter: "a" },
      new Error("offline"),
      1_000,
    );
    const second = scheduleRetry(
      first,
      { chapter: "a" },
      new Error("offline"),
      2_000,
    );
    expect(second[0].attempts).toBe(2);
    expect(second[0].nextAttemptAt).toBe(6_000);
  });

  it("limits incremental propagation by dependency depth", () => {
    const graph = buildDependencyGraph(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
      ],
    );
    expect(affectedByChange(graph, "a", 2)).toEqual(["a", "b", "c"]);
  });
});
