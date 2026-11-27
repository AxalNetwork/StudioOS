/** D5984 shared section-incident issue template, for Worker callers. */
export type IncidentCase = Readonly<{ section: string; name: string; file: string; test: string }>;
export const cases: Map<string, IncidentCase>;
export const issueLabels: readonly string[];
export function issueKeyInput(repo: string, caseId: string, episode: string): string;
export function issueMarker(key: string): string;
export function issueDraft(input: { repo: string; caseId: string; key: string; count: number; revision: string | null }): {
  marker: string; spec: IncidentCase; title: string; body: string; labels: string[];
};
export function countMilestone(count: number): number;
export function milestoneReceipt(key: string, bucket: number): string;
export function milestoneComment(key: string, bucket: number): string;
export function filedCount(body: string | null | undefined): number;
