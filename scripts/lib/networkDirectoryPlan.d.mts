/** D7672 directory planner types, for Worker callers (D7674 part 2: `cloudflare-worker/src/services/networkDirectoryApply.ts`). */
export type PlanStatement = { sql: string; params: unknown[] };
export type PlanBatch = { key: string; statements: PlanStatement[] };
export type DispositionCounts = { input: number; accepted: number; review: number; skipped: number };
export type PlanSummary = {
  planner_version: string;
  run_uid: string;
  review_manifest_hash: string;
  production_written: false;
  source_rows: DispositionCounts;
  derived_organizations: DispositionCounts;
  all_staged_records: DispositionCounts;
  people: number;
  organizations: number;
  affiliations: number;
  affiliations_needing_review: number;
  duplicate_identity_groups: number;
  source_channel_review_groups: number;
  by_source: Record<string, DispositionCounts>;
  atomic_batches: number;
  statements: number;
};
export type DirectoryPlan = {
  version: 1;
  execution_contract: { sequential: true; atomic_per_batch: true; stop_on_error: true; operator_only: true };
  summary: PlanSummary;
  batches: PlanBatch[];
};
export const VERSION: string;
export const SOURCES: Readonly<Record<string, { name: string; url: string }>>;
export const WRITE_TABLES: readonly string[];
export function canonical(value: unknown): string;
export function professionalUrl(value: unknown, kind?: 'person' | 'organization' | null): string | null;
export function buildDirectoryPlan(input: { records: unknown; manifest: unknown }): DirectoryPlan;
