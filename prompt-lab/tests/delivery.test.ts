import { describe, expect, it } from "vitest";
import {
  checksumText,
  createReleaseCandidate,
  createRestorePlan,
  validateBackup,
} from "../src/plugins/outline-scaffolder/delivery";

describe("delivery workflow", () => {
  it("validates checksums and creates a selective restore plan", () => {
    const files = [
      {
        sourcePath: "01.md",
        backupPath: "b/01.md",
        content: "old",
        checksum: checksumText("old"),
      },
    ];
    expect(validateBackup(files)[0].valid).toBe(true);
    expect(createRestorePlan(files, { "01.md": "new" })[0]).toMatchObject({
      state: "changed",
      selected: true,
    });
  });

  it("only creates a release candidate after the gate passes", () => {
    expect(() =>
      createReleaseCandidate({ allowed: false, blockers: ["未签核"] }, []),
    ).toThrow("未签核");
    expect(
      createReleaseCandidate({ allowed: true, blockers: [] }, ["v2.0.0"])
        .version,
    ).toBe("v3.0.0-rc.1");
  });
});
