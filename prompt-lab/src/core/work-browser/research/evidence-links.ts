export interface ClaimEvidenceLink { claim: string; evidenceIds: string[]; disputed: boolean }

export function mapClaimsToEvidence(report: string, evidence: Array<{ id: string; url: string; status: string }>): ClaimEvidenceLink[] {
  const byUrl = new Map(evidence.map((item) => [item.url, item]));
  return report.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((claim) => {
    const urls = [...claim.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]);
    const linked = urls.map((url) => byUrl.get(url)).filter((item): item is NonNullable<typeof item> => !!item);
    return { claim, evidenceIds: linked.map((item) => item.id), disputed: linked.some((item) => item.status === 'disputed') };
  }).filter((item) => item.evidenceIds.length > 0);
}
