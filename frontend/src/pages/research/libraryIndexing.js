/**
 * D4612 — the library watches its own indexing, and Re-index is a batch that
 * reports what each document did.
 *
 * Reading a file happens on a queue, so an upload or a re-index answers before
 * Ask can use the document. The page used to read the library once, straight
 * after, and then sat on "Reading…" until the reader navigated away and back.
 * Now, while any document is `pending`, it re-reads on a bounded schedule
 * (`pollDelay`), stops once nothing is pending or the schedule runs out, and
 * stops on unmount. A re-read that answers after a newer one, or after the
 * page has left, is dropped (`recordGate.js`).
 *
 * Re-index skips what is already being read (`reindexTargets`): the route
 * refuses a pending document with `already_queued`, and resubmitting it was
 * a failure the page reported as the reader's. It runs at most `concurrency`
 * at a time, keeps the page busy until every one has answered, and says how
 * many went, how many were already going and which could not (`batchSummary`).
 */
import { isAnswerable } from './askOutcome.js';

/** Re-reads while a document is pending: quick at first, then every 15 s, for about 4 minutes. */
const DELAYS = [2000, 3000, 5000, 8000, 13000];
export const MAX_POLLS = 20;
export function pollDelay(attempt) {
  if (attempt >= MAX_POLLS) return null;
  return DELAYS[attempt] ?? 15000;
}

export const hasPending = (items) => (items || []).some((d) => d.source !== 'client' && d.index_state === 'pending');

/** Own documents Ask cannot fully read that are not already being read. */
export const reindexTargets = (items) => (items || []).filter((d) => d.source !== 'client'
  && d.index_state !== 'indexed' && d.index_state !== 'pending');

/** Runs `fn(uid)` over `uids`, at most `concurrency` at once; one outcome per uid, in order. */
export async function runBatch(uids, fn, concurrency = 2) {
  const results = new Array(uids.length);
  let next = 0;
  const worker = async () => {
    while (next < uids.length) {
      const i = next++;
      try {
        await fn(uids[i]);
        results[i] = { uid: uids[i], ok: true };
      } catch (e) {
        results[i] = { uid: uids[i], ok: false, code: e?.code || e?.data?.detail || null };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, uids.length) }, worker));
  return results;
}

/** One sentence for a finished batch; titles name the documents that could not be re-read. */
export function batchSummary(results, titleOf = (uid) => uid) {
  const went = results.filter((r) => r.ok).length;
  const queued = results.filter((r) => !r.ok && r.code === 'already_queued').length;
  const failed = results.filter((r) => !r.ok && r.code !== 'already_queued');
  const parts = [];
  if (went) parts.push(`Reading ${went} again`);
  if (queued) parts.push(`${queued} already being read`);
  if (failed.length) parts.push(`${failed.length} could not be re-indexed: ${failed.map((r) => titleOf(r.uid)).join(', ')}`);
  return {
    ok: failed.length === 0,
    text: `${parts.join('; ') || 'Nothing to re-index'}.${went ? ' The states below update when Ask can use them.' : ''}`,
  };
}

/**
 * What a row says it can do next, from its recorded state and note. A failed
 * read is retried; a file nothing could be read from is replaced, because
 * reading it again reads nothing again.
 */
export function nextStep(d) {
  if (d.source === 'client') return null;
  if (d.index_state === 'failed') return { note: d.index_note || 'The last read failed.', action: 'Re-index' };
  if (d.index_state === 'unsupported') return { note: d.index_note || 'No text could be read from this file.', action: 'Replace the file' };
  if (d.index_state === 'partial') return { note: d.index_note || 'Some passages were not indexed.', action: 'Re-index' };
  return null;
}

export { isAnswerable };
