/** D5616 path overlap, for Worker callers (D5569 part 2: `cloudflare-worker/src/services/agents/agentPublisher.ts`). */
export type OverlapFile = string | { filename: string; status?: string; previous_filename?: string };
export type OverlapPr = { number: number; files?: OverlapFile[]; draft?: boolean; changed_files?: number };
export type OverlapPair<T extends OverlapPr = OverlapPr> = {
  a: T; b: T;
  paths: { path: string; class: string }[];
  migrationStamps: string[];
  verdict: 'not checked';
};
export const MARKER: string;
export function classify(path: string): string;
export function pairs<T extends OverlapPr>(prs: T[]): OverlapPair<T>[];
export function order<T extends OverlapPr>(cluster: T[]): T[];
export function escape(value: unknown): string;
