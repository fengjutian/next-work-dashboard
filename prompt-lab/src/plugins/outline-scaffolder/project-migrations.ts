export const OUTLINE_PROJECT_SCHEMA_VERSION = 10;

type ProjectRecord = Record<string, unknown>;
const list = (value: unknown) => Array.isArray(value) ? value : [];
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const migrations: Record<number, (project: ProjectRecord) => ProjectRecord> = {
  1: (p) => ({ ...p, chapterBriefs: object(p.chapterBriefs), chapterStatuses: object(p.chapterStatuses) }),
  2: (p) => ({ ...p, knowledgeEntries: list(p.knowledgeEntries), evidenceRecords: list(p.evidenceRecords) }),
  3: (p) => ({ ...p, editorialAudits: object(p.editorialAudits), claims: list(p.claims) }),
  4: (p) => ({ ...p, controversies: list(p.controversies), roleApprovals: list(p.roleApprovals) }),
  5: (p) => ({ ...p, contentClassifications: list(p.contentClassifications), changeLog: list(p.changeLog) }),
  6: (p) => ({ ...p, personRelations: list(p.personRelations), placeMappings: list(p.placeMappings) }),
  7: (p) => ({ ...p, editorialTasks: list(p.editorialTasks), qualitySnapshots: list(p.qualitySnapshots) }),
  8: (p) => ({ ...p, releaseRecords: list(p.releaseRecords), commentThreads: list(p.commentThreads) }),
  9: (p) => ({ ...p, aiExecutionLogs: list(p.aiExecutionLogs), aiResultCache: object(p.aiResultCache), aiRetryQueue: list(p.aiRetryQueue) }),
};

export function migrateOutlineProject(input: unknown): ProjectRecord & { schemaVersion: number; migrationHistory: string[] } {
  let project: ProjectRecord = object(input);
  const original = Math.max(1, Number(project.schemaVersion ?? project.version ?? 1));
  const history = Array.isArray(project.migrationHistory) ? project.migrationHistory.filter((item): item is string => typeof item === 'string') : [];
  for (let version = original; version < OUTLINE_PROJECT_SCHEMA_VERSION; version += 1) {
    project = (migrations[version] ?? ((value) => value))(project);
    history.push(`v${version}→v${version + 1}`);
  }
  return { ...project, schemaVersion: OUTLINE_PROJECT_SCHEMA_VERSION, version: OUTLINE_PROJECT_SCHEMA_VERSION, migrationHistory: history };
}
