/**
 * Phase 0.2 — minimal pipeline votes endpoint for the worker.
 *
 * Mirrors backend/app/api/routes/pipeline_votes.py:cast_vote at the level
 * needed to publish `vote_threshold_reached` notifications in production.
 * The richer tally / leaderboard endpoints stay backend-only for now —
 * this route exists so the notification publisher fires symmetrically on
 * axal.vc, not as a full reimplementation of the voting subsystem.
 *
 *   POST /api/pipeline/votes/:deal_id   { vote_type, weight?, comment?, anonymous? }
 *
 * Storage is D1 (SQLite). Idempotency: a `pipeline_vote_threshold_log`
 * PK row guards against re-paging admins on every subsequent vote after
 * the threshold first crosses.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const votes = new Hono<{ Bindings: Env }>();

// Mirror backend/app/api/routes/pipeline_votes.py — keep in sync to avoid
// cross-stack divergence on when admins get paged.
const VOTE_THRESHOLD_VOTERS = 5;
const VOTE_THRESHOLD_WEIGHT = 12;
const VOTE_TYPES = new Set(['strong_buy', 'buy', 'pass', 'strong_pass']);

let votesMigrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (votesMigrated) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS pipeline_votes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       deal_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       vote_type TEXT NOT NULL,
       weight INTEGER NOT NULL DEFAULT 1,
       comment TEXT,
       anonymous INTEGER DEFAULT 0,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(deal_id, user_id)
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS pipeline_vote_threshold_log (
       deal_id INTEGER PRIMARY KEY,
       fired_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`,
  ).run();
  votesMigrated = true;
}

votes.post('/:deal_id', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const dealId = parseInt(c.req.param('deal_id'), 10);
  if (!Number.isFinite(dealId)) return c.json({ error: 'Invalid deal_id' }, 400);

  const body: any = await c.req.json().catch(() => ({}));
  const voteType: string = body?.vote_type;
  const weight: number = Math.max(1, Math.min(parseInt(body?.weight ?? 1, 10) || 1, 5));
  const comment: string | null = typeof body?.comment === 'string' ? body.comment.slice(0, 2000) : null;
  const anonymous: number = body?.anonymous ? 1 : 0;
  if (!VOTE_TYPES.has(voteType)) return c.json({ error: 'Invalid vote_type' }, 422);

  try {
    await ensureSchema(c.env);

    const existing: any = await c.env.DB.prepare(
      `SELECT id FROM pipeline_votes WHERE deal_id = ? AND user_id = ?`,
    ).bind(dealId, user.id).first();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE pipeline_votes
            SET vote_type = ?, weight = ?, comment = ?, anonymous = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE deal_id = ? AND user_id = ?`,
      ).bind(voteType, weight, comment, anonymous, dealId, user.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO pipeline_votes (deal_id, user_id, vote_type, weight, comment, anonymous)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(dealId, user.id, voteType, weight, comment, anonymous).run();
    }

    const tally: any = await c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total_voters,
         COALESCE(SUM(weight), 0) AS total_weight,
         SUM(CASE WHEN vote_type = 'strong_buy' THEN 1 ELSE 0 END) AS strong_buy
       FROM pipeline_votes WHERE deal_id = ?`,
    ).bind(dealId).first();
    const totalVoters = Number(tally?.total_voters || 0);
    const totalWeight = Number(tally?.total_weight || 0);
    const strongBuy = Number(tally?.strong_buy || 0);
    const thresholdReached =
      totalVoters >= VOTE_THRESHOLD_VOTERS && totalWeight >= VOTE_THRESHOLD_WEIGHT;

    if (thresholdReached) {
      try {
        // INSERT OR IGNORE acts as a "first-crossing" guard in SQLite —
        // concurrent voters race; only one row inserts, the others no-op
        // (reflected by .meta.changes === 0) so admins are paged once.
        const fired: any = await c.env.DB.prepare(
          `INSERT OR IGNORE INTO pipeline_vote_threshold_log (deal_id) VALUES (?)`,
        ).bind(dealId).run();
        const wasFirstCrossing = Number(fired?.meta?.changes || 0) > 0;
        if (wasFirstCrossing) {
          const admins: any = await c.env.DB.prepare(
            `SELECT id FROM users WHERE role = 'admin' AND is_active = 1`,
          ).all();
          const { notify } = await import('../services/notify');
          for (const admin of (admins?.results || [])) {
            await notify(c.env, {
              userId: admin.id,
              type: 'vote_threshold_reached',
              title: 'Vote threshold reached',
              body: `Deal #${dealId} hit ${totalVoters} voters · weight ${totalWeight}`,
              link: '/pipeline',
              payload: {
                deal_id: dealId,
                tally: { total_voters: totalVoters, total_weight: totalWeight, strong_buy: strongBuy },
              },
              channels: ['in_app', 'email', 'slack'],
            });
          }
        }
      } catch (e) { console.warn('[votes] notify vote_threshold_reached failed', e); }
    }

    return c.json({
      ok: true,
      deal_id: dealId,
      tally: {
        total_voters: totalVoters,
        total_weight: totalWeight,
        strong_buy: strongBuy,
        threshold_reached: thresholdReached,
        threshold: { voters: VOTE_THRESHOLD_VOTERS, weight: VOTE_THRESHOLD_WEIGHT },
      },
    });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to cast vote' }, 500);
  }
});

export default votes;
