import type { SecurityFinding } from './types';

const sarifLevel = (severity: SecurityFinding['severity']): 'error' | 'warning' | 'note' => severity === 'P0' || severity === 'P1' ? 'error' : severity === 'P2' ? 'warning' : 'note';

export function findingsToSarif(findings: SecurityFinding[], projectDir: string): Record<string, unknown> {
  const rules = new Map<string, SecurityFinding>();
  findings.forEach((finding) => rules.set(`${finding.scannerId}:${finding.ruleId}`, finding));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'next-work-dashboard Security Audit',
          informationUri: 'https://github.com/',
          rules: [...rules.entries()].map(([id, finding]) => ({ id, name: finding.ruleId, shortDescription: { text: finding.title }, fullDescription: { text: finding.description }, help: { text: finding.recommendation }, properties: { category: finding.category, severity: finding.severity, scannerId: finding.scannerId, cwe: finding.cwe } })),
        },
      },
      originalUriBaseIds: { PROJECTROOT: { uri: `file:///${projectDir.replace(/\\/g, '/').replace(/^\//, '')}/` } },
      results: findings.filter((finding) => finding.status !== 'fixed' && finding.status !== 'false-positive').map((finding) => ({
        ruleId: `${finding.scannerId}:${finding.ruleId}`,
        level: sarifLevel(finding.severity),
        message: { text: finding.description },
        partialFingerprints: { primaryLocationLineHash: finding.fingerprint },
        locations: [{ physicalLocation: { artifactLocation: { uri: finding.location.file.replace(/\\/g, '/'), uriBaseId: 'PROJECTROOT' }, region: { startLine: Math.max(1, finding.location.line), ...(finding.location.column ? { startColumn: finding.location.column } : {}) } } }],
        properties: { status: finding.status, confidence: finding.confidence, aiVerdict: finding.aiReview?.verdict, cve: finding.cve, cvss: finding.cvss },
      })),
    }],
  };
}
