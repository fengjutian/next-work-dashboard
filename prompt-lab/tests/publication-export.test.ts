import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  createDocxBase64,
  createEpubBase64,
} from "../../packages/outline-scaffolder/src/core/publication-export";
import {
  migrateOutlineProject,
  OUTLINE_PROJECT_SCHEMA_VERSION,
} from "../../packages/outline-scaffolder/src/core/project-migrations";

const book = {
  title: "秦汉兴亡",
  author: "作者",
  chapters: [
    {
      path: "01.md",
      title: "第一章",
      markdown: "## 第一节\n\n公元前221年，秦统一六国。",
    },
  ],
};

describe("publication exporters", () => {
  it("creates a valid OOXML package containing the manuscript", async () => {
    const zip = await JSZip.loadAsync(await createDocxBase64(book), {
      base64: true,
    });
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(await zip.file("word/document.xml")?.async("string")).toContain(
      "秦统一六国",
    );
  });

  it("creates an EPUB 3 package with ordered chapters", async () => {
    const base64 = await createEpubBase64(book);
    const zip = await JSZip.loadAsync(base64, { base64: true });
    expect(await zip.file("mimetype")?.async("string")).toBe(
      "application/epub+zip",
    );
    expect(await zip.file("OEBPS/nav.xhtml")?.async("string")).toContain(
      "第一章",
    );
  });
});

describe("project migrations", () => {
  it("migrates v1 data through every explicit schema step", () => {
    const migrated = migrateOutlineProject({
      schemaVersion: 1,
      name: "旧项目",
    });
    expect(migrated.schemaVersion).toBe(OUTLINE_PROJECT_SCHEMA_VERSION);
    expect(migrated.migrationHistory).toHaveLength(9);
    expect(migrated.aiRetryQueue).toEqual([]);
  });

  it("does not duplicate migration history for current projects", () => {
    const migrated = migrateOutlineProject({
      schemaVersion: 10,
      migrationHistory: ["done"],
    });
    expect(migrated.migrationHistory).toEqual(["done"]);
  });
});
