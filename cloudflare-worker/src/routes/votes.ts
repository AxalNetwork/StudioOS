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
// Mirror backend VOTE_TYPES exactly — same casing the FastAPI route accepts
// and what the React client sends from PipelinePage VOTE_OPTIONS.
const VOTE_TYPES = new Set(['Strong_Buy', 'Buy', 'Hold', 'Pass']);

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
  // User weight mirrors backend _user_weight: admin=4, lp=3, partner=2, founder=1.
  const role = String((user as any).role || '').toLowerCase();
  const weight: number = role === 'admin' ? 4 : role === 'lp' || role === 'investor' ? 3 : role === 'partner' ? 2 : 1;
  const comment: string | null = typeof body?.comment === 'string' ? body.comment.slice(0, 2000) : null;
  const anonymous: number = body?.anonymous ? 1 : 0;
  if (!VOTE_TYPES.has(voteType)) {
    return c.json({ detail: `vote_type must be one of ${[...VOTE_TYPES].sort().join(', ')}` }, 400);
  }

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

    // Build the per-type breakdown the backend's _build_public_tally returns.
    const grouped: any = await c.env.DB.prepare(
      `SELECT vote_type,
              COUNT(id) AS count,
              COALESCE(SUM(weight), 0) AS weight
         FROM pipeline_votes
        WHERE deal_id = ?
        GROUP BY vote_type`,
    ).bind(dealId).all();
    const byType: Record<string, { count: number; weight: number }> = {
      Strong_Buy: { count: 0, weight: 0 },
      Buy: { count: 0, weight: 0 },
      Hold: { count: 0, weight: 0 },
      Pass: { count: 0, weight: 0 },
    };
    let totalVoters = 0;
    let totalWeight = 0;
    for (const r of (grouped?.results || [])) {
      const vt = String(r.vote_type);
      if (vt in byType) byType[vt] = { count: Number(r.count), weight: Number(r.weight) };
      totalVoters += Number(r.count);
      totalWeight += Number(r.weight);
    }
    const sbWeight = byType.Strong_Buy.weight + byType.Buy.weight;
    const strongBuyPct = totalWeight ? Math.round((sbWeight / totalWeight) * 1000) / 10 : 0;
    const thresholdReached =
      totalVoters >= VOTE_THRESHOLD_VOTERS && totalWeight >= VOTE_THRESHOLD_WEIGHT;

    const publicTally = {
      deal_id: dealId,
      total_voters: totalVoters,
      total_weight: totalWeight,
      strong_buy_pct: strongBuyPct,
      by_type: byType,
      threshold_reached: thresholdReached,
      threshold: { voters_required: VOTE_THRESHOLD_VOTERS, weight_required: VOTE_THRESHOLD_WEIGHT },
    };

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
              payload: { deal_id: dealId, tally: publicTally },
              channels: ['in_app', 'email', 'slack'],
            });
          }
        }
      } catch (e) { console.warn('[votes] notify vote_threshold_reached failed', e); }
    }

    // Match backend cast_vote response exactly: the public tally fields
    // live at the TOP LEVEL, plus a `my_vote` block. PipelinePage reads
    // total_voters / total_weight / strong_buy_pct / by_type / my_vote
    // directly from this payload to refresh local state.
    return c.json({
      ...publicTally,
      my_vote: {
        vote_type: voteType,
        weight,
        comment,
        anonymous: !!anonymous,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to cast vote' }, 500);
  }
});

export default votes;
