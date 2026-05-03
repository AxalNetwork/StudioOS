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
 * Idempotency: a tiny `pipeline_vote_threshold_log` D1 row guards against
 * re-paging admins on every subsequent vote after the threshold crosses.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getSQL } from '../db';

const votes = new Hono<{ Bindings: Env }>();

const VOTE_THRESHOLD_VOTERS = 3;
const VOTE_THRESHOLD_WEIGHT = 6;
const VOTE_TYPES = new Set(['strong_buy', 'buy', 'pass', 'strong_pass']);

let votesMigrated = false;
async function ensureSchema(sql: any): Promise<void> {
  if (votesMigrated) return;
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_votes (
      id SERIAL PRIMARY KEY,
      deal_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      vote_type TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      comment TEXT,
      anonymous BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(deal_id, user_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_vote_threshold_log (
      deal_id INTEGER PRIMARY KEY,
      fired_at TIMESTAMP DEFAULT NOW()
    )
  `;
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
  const anonymous: boolean = !!body?.anonymous;
  if (!VOTE_TYPES.has(voteType)) return c.json({ error: 'Invalid vote_type' }, 422);

  const sql = getSQL(c.env);
  try {
    await ensureSchema(sql);

    const existing = await sql`SELECT id FROM pipeline_votes WHERE deal_id = ${dealId} AND user_id = ${user.id}`;
    if (existing.length > 0) {
      await sql`
        UPDATE pipeline_votes
           SET vote_type = ${voteType}, weight = ${weight},
               comment = ${comment}, anonymous = ${anonymous}, updated_at = NOW()
         WHERE deal_id = ${dealId} AND user_id = ${user.id}
      `;
    } else {
      await sql`
        INSERT INTO pipeline_votes (deal_id, user_id, vote_type, weight, comment, anonymous)
        VALUES (${dealId}, ${user.id}, ${voteType}, ${weight}, ${comment}, ${anonymous})
      `;
    }

    const tally = await sql`
      SELECT
        COUNT(*)::int                                       AS total_voters,
        COALESCE(SUM(weight), 0)::int                       AS total_weight,
        COUNT(*) FILTER (WHERE vote_type = 'strong_buy')::int AS strong_buy
      FROM pipeline_votes WHERE deal_id = ${dealId}
    `;
    const t = tally[0] || { total_voters: 0, total_weight: 0, strong_buy: 0 };
    const thresholdReached =
      t.total_voters >= VOTE_THRESHOLD_VOTERS && t.total_weight >= VOTE_THRESHOLD_WEIGHT;

    if (thresholdReached) {
      try {
        const fired = await sql`
          INSERT INTO pipeline_vote_threshold_log (deal_id) VALUES (${dealId})
          ON CONFLICT (deal_id) DO NOTHING
          RETURNING deal_id
        `;
        if (fired.length > 0) {
          const admins = await sql`SELECT id FROM users WHERE role = 'admin' AND is_active = true`;
          const { notify } = await import('../services/notify');
          for (const admin of admins) {
            await notify(c.env, {
              userId: admin.id,
              type: 'vote_threshold_reached',
              title: 'Vote threshold reached',
              body: `Deal #${dealId} hit ${t.total_voters} voters · weight ${t.total_weight}`,
              link: '/pipeline',
              payload: { deal_id: dealId, tally: t },
              channels: ['in_app', 'email', 'slack'],
            });
          }
        }
      } catch (e) { console.warn('[votes] notify vote_threshold_reached failed', e); }
    }

    await sql.end();
    return c.json({
      ok: true,
      deal_id: dealId,
      tally: { ...t, threshold_reached: thresholdReached, threshold: { voters: VOTE_THRESHOLD_VOTERS, weight: VOTE_THRESHOLD_WEIGHT } },
    });
  } catch (e: any) {
    try { await sql.end(); } catch {}
    return c.json({ error: e?.message || 'Failed to cast vote' }, 500);
  }
});

export default votes;
