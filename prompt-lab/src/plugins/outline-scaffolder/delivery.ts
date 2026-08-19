import type { ExportGate } from "./editorial-analysis";

export interface BackupFile {
  sourcePath: string;
  backupPath: string;
  content: string;
  checksum: string;
}
export interface RestorePlanItem {
  sourcePath: string;
  backupPath: string;
  state: "missing" | "changed" | "unchanged";
  selected: boolean;
  expectedChecksum: string;
}
export interface ReleaseCandidate {
  version: string;
  label: "review" | "proof" | "final";
  notes: string;
  createdAt: number;
  formats: Array<"docx" | "pdf" | "epub">;
}

export const checksumText = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
};

export function createRestorePlan(
  files: BackupFile[],
  current: Record<string, string | undefined>,
): RestorePlanItem[] {
  return files.map((file) => {
    const currentContent = current[file.sourcePath];
    const state =
      currentContent === undefined
        ? "missing"
        : checksumText(currentContent) === file.checksum
          ? "unchanged"
          : "changed";
    return {
      sourcePath: file.sourcePath,
      backupPath: file.backupPath,
      state,
      selected: state !== "unchanged",
      expectedChecksum: file.checksum,
    };
  });
}

export function validateBackup(
  files: BackupFile[],
): Array<{ path: string; valid: boolean }> {
  return files.map((file) => ({
    path: file.sourcePath,
    valid: checksumText(file.content) === file.checksum,
  }));
}

export function createReleaseCandidate(
  gate: ExportGate,
  previousVersions: string[],
  now = Date.now(),
): ReleaseCandidate {
  if (!gate.allowed)
    throw new Error(`发布门禁未通过：${gate.blockers.join("；")}`);
  const max = previousVersions
    .map((version) => Number(version.match(/^v?(\d+)/i)?.[1] ?? 0))
    .reduce((left, right) => Math.max(left, right), 0);
  return {
    version: `v${max + 1}.0.0-rc.1`,
    label: "proof",
    notes: "自动发布候选：门禁通过，已生成 DOCX、PDF、EPUB 校样。",
    createdAt: now,
    formats: ["docx", "pdf", "epub"],
  };
}
