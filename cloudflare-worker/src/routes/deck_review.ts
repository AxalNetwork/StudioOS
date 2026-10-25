/**
 * D900 (#2679, part 6 of #2434) — the studio's own review of a deck version.
 *
 *   POST /api/decks/:id/review    reviews this version's text; returns the review and the run's cost
 *   GET  /api/decks/:id/reviews   the venture's version reviews, newest first, each with its score and cost
 *
 * It reviews the version's cards, not an upload: each point names a card
 * (`services/deckVersionReview.ts`). The row is `deck_reviews` with `deck_id`
 * and `deck_version` (migration 541) and each run is a `deck_review_history`
 * row, which this file is the first to read. A run's cost is its own
 * `ai_usage_logs` rows (`record_ref = 'deck_review:<id>'`, guard rows included).
 *
 * Who: a review is a charged run, so only the venture's founders run one (the
 * deck's write access, as a note's post is granted (D905)). Its Admin, or the
 * Super Admin on HQ, reads the history (PD21: an admin reads and changes
 * nothing). Anyone else is not found. Uploads and pasted text stay the
 * reviewer's (`/api/deck-reviewer`), per user, untouched.
 *
 * A run that returned no review stores none: the route answers 502 with what
 * the run cost, and the history keeps what it had. A missing score stays
 * missing ("Score not returned"). Each review writes one `raise.pitch-deck`
 * activity row naming the version and the card count, never a figure.
 *
 * Mounted before `routes/decks.ts`; both paths are two segments.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { hydrateSuperAdmin, isSuperAdmin, requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { ensureDeckReviewSchema } from '../services/deckReviewSchema';
import { runVersionReview, type CardReview } from '../services/deckVersionReview';
import { railFor, refuseRun } from '../util/railContext';

const deckReview = new Hono<{ Bindings: Env }>();

/** The rail row a version review runs under (`services/ai/railMatrix.json`). */
export const VERSION_REVIEW_PAGE = 'Founder · Raise · Pitch deck';
export const VERSION_REVIEW_OPTION = 'review:deck-version';
/** The history read returns at most this many runs. */
export const REVIEW_HISTORY_MAX = 200;

type Kind = 'admin' | 'super_admin' | 'founder';
type DeckRow = { id: number; project_id: number; version: number; slides: string | null };

const NOT_FOUND = { error: 'deck_not_found', message: 'That deck is not one you can read.' };

async function deckRow(env: Env, id: number): Promise<DeckRow | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return env.DB.prepare('SELECT id, project_id, version, slides FROM pitch_decks WHERE id = ?').bind(id).first<DeckRow>();
}

/** What the caller is to this venture's reviews, or null (as a note's reader is decided, D905). */
async function reviewRole(c: any, user: User, projectId: number, running: boolean): Promise<Kind | null> {
  if (String(user.role || '').toLowerCase() === 'admin') {
    return isSuperAdmin(await hydrateSuperAdmin(c.env, user)) ? 'super_admin' : 'admin';
  }
  try {
    await projectOwned(c, user, projectId, { write: true, audit: running });
    return 'founder';
  } catch {
    return null;
  }
}

function slidesOf(row: DeckRow): unknown[] {
  try { const s = JSON.parse(row.slides || '[]'); return Array.isArray(s) ? s : []; } catch { return []; }
}

const recordRef = (reviewId: string) => `deck_review:${reviewId}`;

/**
 * What a run cost: the micro-USD charged over its rows (the run and its guard
 * rows), and the estimated cost in USD. `charged_microusd` is null when any row
 * has no recorded charge or there is no row, never a guessed 0.
 */
export type RunCost = { charged_microusd: number | null; est_cost_usd: number | null; runs: number };

async function costOf(env: Env, reviewIds: string[]): Promise<Map<string, RunCost>> {
  const out = new Map<string, RunCost>();
  if (!reviewIds.length) return out;
  const refs = reviewIds.map(recordRef);
  try {
    const rows = (await env.DB.prepare(
      `SELECT record_ref,
              COUNT(*) AS n,
              SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded,
              SUM(charged_microusd) AS charged,
              SUM(est_cost_usd) AS est,
              SUM(CASE WHEN guard_for IS NULL AND refusal IS NULL THEN 1 ELSE 0 END) AS runs
         FROM ai_usage_logs
        WHERE record_ref IN (SELECT value FROM json_each(?))
        GROUP BY record_ref`,
    ).bind(JSON.stringify(refs)).all<{ record_ref: string; n: number; unrecorded: number; charged: number | null; est: number | null; runs: number }>()).results ?? [];
    for (const r of rows) {
      out.set(String(r.record_ref).slice('deck_review:'.length), {
        charged_microusd: Number(r.unrecorded) > 0 || r.charged == null ? null : Number(r.charged),
        est_cost_usd: r.est == null ? null : Number(r.est),
        runs: Number(r.runs) || 0,
      });
    }
  } catch {
    // An unreadable log leaves every cost unknown, never zero.
  }
  return out;
}

const NO_COST: RunCost = { charged_microusd: null, est_cost_usd: null, runs: 0 };

function parseReview(json: string | null): CardReview | null {
  try {
    const r = JSON.parse(json || 'null');
    return r && typeof r === 'object' && r.shape === 'cards' ? r as CardReview : null;
  } catch {
    return null;
  }
}

deckReview.post('/:id/review', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json(NOT_FOUND, 404);
  const projectId = Number(row.project_id);
  const kind = await reviewRole(c, user, projectId, true);
  if (!kind) return c.json(NOT_FOUND, 404);
  if (kind !== 'founder') {
    return c.json({ error: 'read_only', message: 'Only the venture\'s founders run a review. You can read the reviews.' }, 403);
  }
  const slides = slidesOf(row);
  if (!slides.length) return c.json({ error: 'deck_empty', message: 'This version has no cards to review.' }, 400);

  await ensureDeckReviewSchema(c.env);
  const id = crypto.randomUUID();
  const rail = railFor(c, { page: VERSION_REVIEW_PAGE, option: VERSION_REVIEW_OPTION }, recordRef(id));
  const { review, result } = await runVersionReview(c.env, Number(user.id), slides, rail);

  if (!review) {
    // A refusal answers in its own words (the switch, a budget stop, the guard).
    const refused = result ? refuseRun(c, result) : null;
    if (refused) return refused;
    const cost = (await costOf(c.env, [id])).get(id) ?? NO_COST;
    return c.json({
      error: 'review_not_returned',
      message: 'The review came back with nothing to show, so nothing was saved. Try again.',
      cost,
    }, 502);
  }

  const now = new Date().toISOString();
  const title = `v${row.version} review`;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO deck_reviews (id, user_id, project_id, source, filename, mime, size, r2_key, raw_retained,
         extraction_status, status, title, review_json, deck_id, deck_version, created_at, updated_at)
       VALUES (?, ?, ?, 'deck', NULL, NULL, 0, NULL, 0, 'ok', 'complete', ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, projectId, title, JSON.stringify(review), row.id, row.version, now, now),
    c.env.DB.prepare('INSERT INTO deck_review_history (id, review_id, review_json, created_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, JSON.stringify(review), now),
    logCycleWriteStatement(c.env, {
      projectId, userId: Number(user.id), cycle: 'raise', module: 'pitch-deck', entityId: row.id,
      action: 'deck_reviewed', summary: `Review run on v${row.version}, ${slides.length} cards`,
    }),
  ]);
  const cost = (await costOf(c.env, [id])).get(id) ?? NO_COST;
  return c.json({
    review: {
      id, deck_id: row.id, deck_version: row.version, created_at: now,
      model: result?.usage?.model ?? null,
      ...review,
    },
    cost,
  }, 201);
});

deckReview.get('/:id/reviews', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json(NOT_FOUND, 404);
  const projectId = Number(row.project_id);
  const kind = await reviewRole(c, user, projectId, false);
  if (!kind) return c.json(NOT_FOUND, 404);
  await ensureDeckReviewSchema(c.env);

  const rows = (await c.env.DB.prepare(
    `SELECT h.id AS run_id, h.review_json, h.created_at, r.id AS review_id, r.deck_id, r.deck_version
       FROM deck_review_history h
       JOIN deck_reviews r ON r.id = h.review_id
      WHERE r.project_id = ?
        -- A version of this venture's deck: an upload or pasted text (deck_id NULL) never matches.
        AND r.deck_id IN (SELECT id FROM pitch_decks WHERE project_id = ?)
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT ?`,
  ).bind(projectId, projectId, REVIEW_HISTORY_MAX).all<{
    run_id: string; review_json: string | null; created_at: string; review_id: string; deck_id: number; deck_version: number;
  }>()).results ?? [];

  const costs = await costOf(c.env, [...new Set(rows.map((r) => r.review_id))]);
  const reviews = rows.map((r) => {
    const review = parseReview(r.review_json);
    return {
      id: r.review_id,
      run_id: r.run_id,
      deck_id: r.deck_id,
      deck_version: r.deck_version,
      created_at: r.created_at,
      overall_score: review ? review.overall_score : null,
      cost: costs.get(r.review_id) ?? NO_COST,
      review,
    };
  });
  return c.json({ reviews, viewer: kind, capped: rows.length >= REVIEW_HISTORY_MAX });
});

export default deckReview;
