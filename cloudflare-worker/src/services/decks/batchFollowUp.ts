/**
 * D1600 (#3879, deck v2) — what happens to a deck generation run after it ends:
 * its failed areas retried, the founder told it finished while they were away,
 * and the return banner cleared once they look (pd2b, pd2c, pd9n).
 *
 * RETRY. A run's family is its first run and every retry of it
 * (`parent_batch_uid`, migration 752, always the first run). A line of the
 * plan (card, area, element, kind and task) is failed when its newest step in
 * the family that ran failed (a stopped step never ran); `retryPlan` copies those lines, with the model, request
 * and rail option they had, into a new run. Lines that succeeded are never in
 * it. The retry's quote is the sum of those lines' quotes, each priced by
 * `quoteRun` when the first run was admitted; it must fit what the family has
 * not charged of the first run's quote (`holdRemaining`), and the run admits
 * it only then (`D1GenRuntime.admit`'s `parentBatchUid`), so retries never
 * charge past the first run's quote.
 *
 * NOTICE. A run that ends `done` with no live stream taking its `batch_done`
 * writes one in-app notice to the member who started it (`noticeBuildDone`),
 * guarded by `notified_at`: no figure, card text or venture metric is in it,
 * only the link to the proposal review.
 *
 * BANNER. `unseenBatches` lists the deck's finished runs nobody has opened from
 * the banner, newest first, with the count of cards each left waiting;
 * `markSeen` clears one.
 */
import type { Env } from '../../types';
import { notify } from '../notify';
import type { BatchRow, PlanLine, StepRow } from './genRuntime';

/** `Idempotency-Key` on a retry: 8 to 64 letters, digits or . _ : - (#3753's start takes the same characters). */
export const RETRY_KEY = /^[A-Za-z0-9._:-]{8,64}$/;
/** The banner lists at most this many runs. */
export const UNSEEN_LIMIT = 5;
export const MAX_RETRY_AREAS = 400;

const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const lineKey = (s: Pick<StepRow, 'card_uid' | 'area_id' | 'element' | 'kind' | 'task'>) =>
  JSON.stringify([s.card_uid ?? null, s.area_id ?? null, s.element, s.kind, s.task ?? null]);

/** The first run of the family `b` belongs to. */
export const rootOf = (b: Pick<BatchRow, 'uid' | 'parent_batch_uid'>) => b.parent_batch_uid || b.uid;

async function familySteps(env: Env, deckId: number, rootUid: string): Promise<StepRow[]> {
  const r = await env.DB.prepare(
    `SELECT s.* FROM deck_area_batch_steps s JOIN deck_area_batches b ON b.uid = s.batch_uid
      WHERE b.deck_id = ?1 AND (b.uid = ?2 OR b.parent_batch_uid = ?2)
      ORDER BY b.created_at, b.rowid, s.seq`,
  ).bind(deckId, rootUid).all<StepRow>();
  return (r.results || []) as StepRow[];
}

/** What the family has not charged of the first run's quote. */
export async function holdRemaining(env: Env, deckId: number, rootUid: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT (SELECT quote_microusd FROM deck_area_batches WHERE uid = ?2 AND deck_id = ?1)
          - (SELECT COALESCE(SUM(s.charged_microusd), 0) FROM deck_area_batch_steps s
              WHERE s.batch_uid IN (SELECT uid FROM deck_area_batches WHERE deck_id = ?1 AND (uid = ?2 OR parent_batch_uid = ?2))) AS n`,
  ).bind(deckId, rootUid).first<{ n: number | null }>();
  return Math.max(0, Number(row?.n ?? 0));
}

function inputOf(step: StepRow): Record<string, unknown> | null {
  if (!step.input) return null;
  try { const v = JSON.parse(step.input); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/**
 * The family's failed lines, as a new plan: only the areas in `areas` when it
 * is given. `retried` names their areas, once each.
 */
export async function retryPlan(env: Env, deckId: number, rootUid: string, areas: string[] | null) {
  const latest = new Map<string, StepRow>();
  // A stopped step never ran, so it leaves its line as the run before left it.
  for (const s of await familySteps(env, deckId, rootUid)) if (s.state !== 'stopped') latest.set(lineKey(s), s);
  const wanted = areas ? new Set(areas) : null;
  const failed = [...latest.values()].filter((s) => s.state === 'failed' && (!wanted || (s.area_id != null && wanted.has(s.area_id))));
  const lines: PlanLine[] = failed.map((s) => ({
    card_uid: s.card_uid, area_id: s.area_id, element: s.element, kind: s.kind, task: s.task, model: s.model,
    quote_microusd: Number(s.quote_microusd), input: inputOf(s),
  }));
  const retried = [...new Set(failed.map((s) => s.area_id).filter((a): a is string => a != null))];
  return { lines, retried, quote: lines.reduce((n, l) => n + Number(l.quote_microusd), 0) };
}

/** What a retry answered, read back from the run it made: a repeat with the same key gets the first answer. */
export async function retryAnswer(env: Env, child: BatchRow) {
  const r = await env.DB.prepare('SELECT DISTINCT area_id FROM deck_area_batch_steps WHERE batch_uid = ?1 AND area_id IS NOT NULL ORDER BY seq')
    .bind(child.uid).all<{ area_id: string }>();
  return { batch_uid: child.uid, retried: (r.results || []).map((x) => x.area_id), quote: { microusd: Number(child.quote_microusd) } };
}

/**
 * The deck's finished runs that nobody has opened from the banner, newest
 * first. `cards_waiting` counts the cards that hold a proposal from the run
 * (a step that ended `done` and wrote one): a count, never the content.
 */
export async function unseenBatches(env: Env, deckId: number) {
  const r = await env.DB.prepare(
    `SELECT b.uid AS batch_uid, b.settled_at AS finished_at,
            (SELECT COUNT(DISTINCT s.card_uid) FROM deck_area_batch_steps s
              WHERE s.batch_uid = b.uid AND s.state = 'done' AND s.result IS NOT NULL) AS cards_waiting
       FROM deck_area_batches b
      WHERE b.deck_id = ?1 AND b.state = 'done' AND b.seen_at IS NULL
      ORDER BY b.settled_at DESC, b.rowid DESC LIMIT ?2`,
  ).bind(deckId, UNSEEN_LIMIT).all<{ batch_uid: string; finished_at: string | null; cards_waiting: number }>();
  return (r.results || []).map((x) => ({ batch_uid: x.batch_uid, finished_at: x.finished_at, cards_waiting: Number(x.cards_waiting) }));
}

/** Clears the run from the banner. Repeating it changes nothing. */
export async function markSeen(env: Env, uid: string): Promise<void> {
  await env.DB.prepare('UPDATE deck_area_batches SET seen_at = COALESCE(seen_at, ?2) WHERE uid = ?1').bind(uid, nowSql()).run();
}

/**
 * The one in-app notice for a run that finished with no one watching. The
 * `notified_at` claim comes first, so two drivers or a restarted room send it
 * once. True when this call sent it.
 */
export async function noticeBuildDone(env: Env, uid: string): Promise<boolean> {
  const claim = await env.DB.prepare(`UPDATE deck_area_batches SET notified_at = ?2 WHERE uid = ?1 AND notified_at IS NULL AND state = 'done'`)
    .bind(uid, nowSql()).run();
  if (!Number(claim?.meta?.changes)) return false;
  const b = await env.DB.prepare('SELECT project_id, created_by FROM deck_area_batches WHERE uid = ?1').bind(uid).first<{ project_id: number; created_by: number }>();
  if (!b) return false;
  const id = await notify(env, {
    userId: Number(b.created_by), type: 'deck_build_done', category: 'fundraising', channels: ['in_app'],
    title: 'Your deck build finished',
    body: 'Its proposals are ready to review.',
    link: `/raise/pitch?project_id=${encodeURIComponent(String(b.project_id))}&proposal=${encodeURIComponent(uid)}`,
    payload: { batch_uid: uid },
  }).catch(() => null);
  return id != null;
}
