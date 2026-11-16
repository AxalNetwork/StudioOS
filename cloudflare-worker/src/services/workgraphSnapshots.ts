/**
 * D5580 part 4 (#5580): the WorkGraph snapshot store — the hourly pr-overlap
 * job's advisory snapshot, kept so the HQ WorkGraph page can read it.
 *
 * `ingestSnapshot` checks a posted body (the snapshot as
 * scripts/lib/prRisk.mjs `snapshot()` writes it, schema
 * studioos-pr-overlap-snapshot/v2), stores it once by its sha256 and keeps the
 * latest KEEP rows. `latestSnapshot` reads the newest one with its age, so the
 * page can say how fresh it is; with none stored it says so instead of drawing
 * an empty board. Nothing here decides, blocks or labels anything: the
 * snapshot is advice (D5580).
 */
import type { Env } from '../types';
import { sha256Hex } from '../rpc/secret';

export const SNAPSHOT_SCHEMA = 'studioos-pr-overlap-snapshot/v2';
/** Under D1's 2 MB row limit, with room for the other columns. */
export const MAX_BYTES = 1_500_000;
/** A week of hourly scans. */
export const KEEP = 168;
/** The job runs hourly: a scan older than this is stale (two missed runs and a margin). */
export const STALE_AFTER_MINUTES = 150;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export type IngestResult =
  | { ok: true; stored: boolean; generated_at: string; partial: boolean }
  | { ok: false; status: 400 | 413; code: string; message: string };

const bad = (code: string, message: string): IngestResult => ({ ok: false, status: 400, code, message });

/** Check and store one posted snapshot. `text` is the request body exactly as received. */
export async function ingestSnapshot(env: Env, text: string): Promise<IngestResult> {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BYTES) {
    return { ok: false, status: 413, code: 'snapshot_too_large', message: `A snapshot is at most ${MAX_BYTES} bytes; this one is ${bytes}.` };
  }
  let s: any;
  try { s = JSON.parse(text); } catch { return bad('snapshot_not_json', 'The snapshot is not JSON.'); }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return bad('snapshot_not_object', 'The snapshot is not a JSON object.');
  if (s.schema !== SNAPSHOT_SCHEMA) return bad('snapshot_schema', `The snapshot's schema is not ${SNAPSHOT_SCHEMA}.`);
  if (typeof s.generatedAt !== 'string' || !ISO.test(s.generatedAt) || Number.isNaN(Date.parse(s.generatedAt))) {
    return bad('snapshot_generated_at', 'The snapshot has no readable generatedAt time.');
  }
  if (typeof s.partial !== 'boolean') return bad('snapshot_partial', 'The snapshot does not say whether the scan was partial.');
  if (!Array.isArray(s.prs) || !Array.isArray(s.pairs)) return bad('snapshot_lists', 'The snapshot has no prs and pairs lists.');
  if (!s.workInFlight || typeof s.workInFlight !== 'object' || Array.isArray(s.workInFlight)) {
    return bad('snapshot_work_in_flight', 'The snapshot has no workInFlight section.');
  }
  const digest = await sha256Hex(text);
  const written = await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO workgraph_snapshots (schema, generated_at, partial, sha256, bytes, body_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(s.schema, s.generatedAt, s.partial ? 1 : 0, digest, bytes, text),
    env.DB.prepare(
      'DELETE FROM workgraph_snapshots WHERE id NOT IN (SELECT id FROM workgraph_snapshots ORDER BY generated_at DESC, id DESC LIMIT ?)',
    ).bind(KEEP),
  ]);
  return { ok: true, stored: Number(written[0]?.meta?.changes ?? 0) > 0, generated_at: s.generatedAt, partial: s.partial };
}

export type LatestSnapshot =
  | { status: 'none'; reason: string }
  | { status: 'unreadable'; reason: string; generated_at: string; received_at: string }
  | {
      status: 'read'; generated_at: string; received_at: string; partial: boolean; schema: string;
      age_minutes: number; stale: boolean; stale_after_minutes: number; snapshot: unknown;
    };

/** The newest stored snapshot, with how old it is. */
export async function latestSnapshot(env: Env, now: number = Date.now()): Promise<LatestSnapshot> {
  const row = await env.DB.prepare(
    'SELECT schema, generated_at, partial, body_json, received_at FROM workgraph_snapshots ORDER BY generated_at DESC, id DESC LIMIT 1',
  ).first<{ schema: string; generated_at: string; partial: number; body_json: string; received_at: string }>();
  if (!row) return { status: 'none', reason: 'No scan has been posted yet: the hourly job posts once its ingest token is set.' };
  let snapshot: unknown;
  try { snapshot = JSON.parse(row.body_json); }
  catch { return { status: 'unreadable', reason: 'The stored scan could not be read.', generated_at: row.generated_at, received_at: row.received_at }; }
  const age = Math.max(0, Math.floor((now - Date.parse(row.generated_at)) / 60_000));
  return {
    status: 'read', generated_at: row.generated_at, received_at: row.received_at, partial: Number(row.partial) === 1,
    schema: row.schema, age_minutes: age, stale: age > STALE_AFTER_MINUTES, stale_after_minutes: STALE_AFTER_MINUTES, snapshot,
  };
}
