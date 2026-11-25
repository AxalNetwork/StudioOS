/**
 * D8507 (#8507) — hosted Stage A's receipt and its sweep, the pure half. No
 * filesystem, no spawn, no network, so `stageASweep.test.mjs` holds every
 * rule to account. `scripts/agent-stage-a.mjs` writes the receipt;
 * `scripts/agent-stage-a-sweep.mjs` lists, selects and deletes.
 *
 * WHY. Stage A's own `finally` deletes what it created, but a cancelled or
 * timed-out job is killed from outside and that block may never run. The
 * workflow's second job, `if: always()`, sweeps what the run left behind.
 *
 * THE RECEIPT is one JSON line per resource, appended the moment `wrangler`
 * has created it (the Worker's line is written before its first deploy, since
 * a failed deploy can still leave a script). A job killed mid-write leaves at
 * most one torn last line, which `parseReceipt` drops and counts.
 *
 * THE SELECTION RULE. A resource is swept only when its name is one of the
 * run's own Stage A names (`stageANames`): the Worker `studioos-s4594-<run>`,
 * the KV titles `studioos-s4594-<run>-<binding>`, the queues, buckets and
 * Workflows `studioos-<kind>-s4594-<run>` (and `-dlq`), and the D1 rehearsal
 * side `studioos-rehearsal-<run>-src`. The receipt never widens that: a
 * receipt line whose name is not the run's is refused and reported, so a
 * corrupt or edited receipt cannot point the sweep at anything else. The
 * receipt's job is to carry ids (a KV namespace is deleted by id) and to show
 * what the run itself recorded; the listing is what decides.
 */

import { RUN_RE, stageANames } from './stageARun.mjs';
import { REHEARSAL_DB_PREFIX } from './migrationTargets.mjs';

export const RECEIPT_KINDS = Object.freeze(['worker', 'd1', 'kv', 'queue', 'bucket', 'workflow']);

/** One receipt line. Throws on a kind it does not know or a name that is not the run's. */
export function receiptLine(run, { kind, name, id = null }, at = new Date()) {
  if (!RECEIPT_KINDS.includes(kind)) throw new Error(`not a Stage A resource kind: ${kind}`);
  if (!isRunName(run, kind, name)) throw new Error(`refusing a receipt line for ${kind} ${JSON.stringify(name)}: not run ${run}'s`);
  return `${JSON.stringify({ run, kind, name, id: id ?? null, at: at.toISOString() })}\n`;
}

/** Parses a receipt. A line that is not JSON (a torn last write) or not this run's is dropped and counted. */
export function parseReceipt(text, run) {
  const entries = [];
  let torn = 0;
  const refused = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { torn += 1; continue; }
    if (!e || e.run !== run || !RECEIPT_KINDS.includes(e.kind) || !isRunName(run, e.kind, e.name)) { refused.push(e?.name ?? null); continue; }
    entries.push({ kind: e.kind, name: e.name, id: e.id ?? null });
  }
  return { entries, torn, refused };
}

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** The exact names one run may own, by kind. */
export function runPatterns(run) {
  const n = stageANames(run);
  const sfx = escape(`-s4594-${run}`);
  return {
    worker: new RegExp(`^${escape(n.worker)}$`),
    d1: new RegExp(`^${escape(`${REHEARSAL_DB_PREFIX}${run}-src`)}$`),
    kv: new RegExp(`^${escape(n.worker)}-(tokens|rate_limits|oauth_kv)$`),
    queue: new RegExp(`^studioos-[a-z-]+?${sfx}(-dlq)?$`),
    bucket: new RegExp(`^studioos-[a-z-]+?${sfx}$`),
    workflow: new RegExp(`^studioos-[a-z-]+?${sfx}$`),
  };
}

/** True only for a name the run itself would have created for that kind. */
export function isRunName(run, kind, name) {
  if (!RUN_RE.test(String(run ?? ''))) return false;
  const p = runPatterns(run)[kind];
  return Boolean(p) && typeof name === 'string' && p.test(name);
}

/**
 * What to delete, from what the account lists now. `listed` holds one array
 * per kind (`undefined` when that list could not be read): `worker` and the
 * queue, bucket and workflow kinds are names; `d1` is names; `kv` is
 * `{ title, id }`. Returns the deletions in a safe order (the Worker first,
 * the database last), which kinds could not be read, and what the receipt
 * named that the account no longer lists (already gone).
 */
export function selectForSweep({ run, listed, receipt = [] }) {
  if (!RUN_RE.test(String(run ?? ''))) throw new Error(`a Stage A run id is 6 to 20 of [a-z0-9]; got ${JSON.stringify(run)}`);
  const unread = [];
  const del = [];
  const order = ['worker', 'workflow', 'queue', 'kv', 'bucket', 'd1'];
  for (const kind of order) {
    const items = listed?.[kind];
    if (!Array.isArray(items)) { unread.push(kind); continue; }
    for (const it of items) {
      const name = kind === 'kv' ? it?.title : it;
      if (!isRunName(run, kind, name)) continue;
      del.push(kind === 'kv' ? { kind, name, id: it.id ?? receipt.find((e) => e.kind === 'kv' && e.name === name)?.id ?? null } : { kind, name });
    }
  }
  const seen = new Set(del.map((d) => `${d.kind}:${d.name}`));
  const gone = receipt.filter((e) => !seen.has(`${e.kind}:${e.name}`) && !unread.includes(e.kind)).map((e) => `${e.kind}:${e.name}`);
  return { delete: del, unread, gone };
}

/**
 * The count the workflow fails on: what is still listed after the sweep, plus
 * one for every kind that could not be read (an unread list is never zero).
 */
export function leftCount({ run, listed }) {
  const { delete: still, unread } = selectForSweep({ run, listed });
  return { left: still.length + unread.length, still: still.map((d) => `${d.kind}:${d.name}`), unread };
}
