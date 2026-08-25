import { describe, expect, it } from "vitest";
import {
  analyzeStitchFrames,
  calculateRgbFrameSimilarity,
  stitchPasses,
} from "../../src/plugins/video-generation/core/continuity";

describe("video generation continuity", () => {
  it("scores identical frames as fully continuous", () => {
    expect(
      calculateRgbFrameSimilarity(
        new Uint8Array([10, 20, 30]),
        new Uint8Array([10, 20, 30]),
      ),
    ).toBe(1);
  });

  it("rejects a strongly discontinuous cut", () => {
    const score = calculateRgbFrameSimilarity(
      new Uint8Array([0, 0, 0]),
      new Uint8Array([255, 255, 255]),
    );
    expect(score).toBe(0);
    expect(stitchPasses(score)).toBe(false);
  });

  it("rejects mismatched frame buffers", () => {
    expect(() =>
      calculateRgbFrameSimilarity(new Uint8Array([1]), new Uint8Array([1, 2])),
    ).toThrow("尺寸不一致");
  });

  it("returns all continuity dimensions for a four-frame seam", () => {
    const frame = new Uint8Array(4 * 4 * 3).fill(96);
    const metrics = analyzeStitchFrames(frame, frame, frame, frame, 4, 4);
    expect(metrics.ssim).toBe(1);
    expect(metrics.motionDirection).toBe(1);
    expect(metrics.subjectPosition).toBe(1);
    expect(metrics.exposure).toBe(1);
    expect(metrics.colorTemperature).toBe(1);
    expect(metrics.histogram).toBeCloseTo(1);
    expect(metrics.faceIdentity).toBeNull();
    expect(metrics.score).toBeCloseTo(1);
  });
});
