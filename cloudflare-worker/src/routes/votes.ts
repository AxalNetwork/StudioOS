/**
 * Pipeline votes endpoint for the worker.
 *
 * Mirrors backend/app/api/routes/pipeline_votes.py.
 *
 *   POST /api/pipeline/votes/:deal_id   { vote_type, comment?, anonymous? }
 *   GET  /api/pipeline/votes/:deal_id   [?include_comments=true]
 *
 * Storage is D1 (SQLite). Idempotency: a `pipeline_vote_threshold_log`
 * PK row guards against re-paging admins on every subsequent vote after
 * the threshold first crosses.
 *
 * The GET arrived late. For a long stretch only the POST existed, so
 * `api.getVotes()` — called on mount by PipelinePage's VoteWidget and
 * fanned out across every deal by PipelineCommitPage — resolved to a
 * 404 that both callers swallow. The effect was that a tally rendered
 * after you voted and vanished on reload. Both handlers now read the
 * same `buildPublicTally()`, because the failure mode of two hand-kept
 * copies is the two surfaces quietly disagreeing about a threshold that
 * pages admins.
 *
 * ROUTE ORDER: `/:deal_id` is a catch-all over this router's root, so a
 * static sibling (`/leaderboard`, still unimplemented here and tracked
 * in scripts/api-drift-baseline.json) MUST be registered above it or it
 * will be swallowed and parsed as a deal id.
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

export interface PublicTally {
  deal_id: number;
  total_voters: number;
  total_weight: number;
  strong_buy_pct: number;
  by_type: Record<string, { count: number; weight: number }>;
  threshold_reached: boolean;
  threshold: { voters_required: number; weight_required: number };
}

/**
 * Aggregate-only tally — mirrors the backend's `_build_public_tally`.
 *
 * Carries zero per-user information, so it is safe to hand to any
 * authenticated viewer and to broadcast over the pipeline socket.
 * Personal state lives in the `my_vote` block the callers attach.
 */
async function buildPublicTally(env: Env, dealId: number): Promise<PublicTally> {
  const grouped: any = await env.DB.prepare(
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
  return {
    deal_id: dealId,
    total_voters: totalVoters,
    total_weight: totalWeight,
    strong_buy_pct: totalWeight ? Math.round((sbWeight / totalWeight) * 1000) / 10 : 0,
    by_type: byType,
    threshold_reached:
      totalVoters >= VOTE_THRESHOLD_VOTERS && totalWeight >= VOTE_THRESHOLD_WEIGHT,
    threshold: { voters_required: VOTE_THRESHOLD_VOTERS, weight_required: VOTE_THRESHOLD_WEIGHT },
  };
}

/** The viewer's own vote, or null. Never folded into the public tally. */
async function myVote(env: Env, dealId: number, userId: number) {
  const row: any = await env.DB.prepare(
    `SELECT vote_type, weight, comment, anonymous, updated_at
       FROM pipeline_votes WHERE deal_id = ? AND user_id = ?`,
  ).bind(dealId, userId).first();
  if (!row) return null;
  return {
    vote_type: row.vote_type,
    weight: Number(row.weight),
    comment: row.comment ?? null,
    anonymous: !!row.anonymous,
    updated_at: row.updated_at,
  };
}

votes.post('/:deal_id', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const dealId = parseInt(c.req.param('deal_id'), 10);
  if (!Number.isFinite(dealId)) return c.json({ error: 'Invalid deal_id' }, 400);

  const body: any = await c.req.json().catch(() => ({}));
  const voteType: string = body?.vote_type;
  // Mirror backend _user_weight: admin=3, LP=3, partner=2, everyone else=1.
  const role = String((user as any).role || '').toLowerCase();
  const weight: number =
    role === 'admin' ? 3 :
    role === 'lp' || role === 'investor' ? 3 :
    role === 'partner' ? 2 : 1;
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

    const publicTally = await buildPublicTally(c.env, dealId);
    const { total_voters: totalVoters, total_weight: totalWeight } = publicTally;

    if (publicTally.threshold_reached) {
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

/**
 * Live tally for one deal.
 *
 * A deal with no votes yet returns a zeroed tally rather than a 404.
 * Zero voters is the literal truth for an unvoted deal, and it is what
 * the widget needs in order to render its empty state; PipelineCommitPage
 * fans this call out across every deal on the board, so an error per
 * unvoted deal would be noise standing in for a fact.
 *
 * No existence check against `deals` — the sibling POST does not do one
 * either, and adding a lookup per call would cost a query per deal on
 * that fan-out to tell the caller something it already knows.
 */
votes.get('/:deal_id', async (c) => {
  // requireAuth throws; index.ts's onError maps 'Unauthorized' to a 401.
  const user = await requireAuth(c);
  const raw = c.req.param('deal_id');
  const dealId = parseInt(raw, 10);
  // Guard the whole segment, not just the prefix: parseInt('leaderboard-2')
  // would otherwise be NaN while parseInt('2x') quietly becomes 2.
  if (!/^\d+$/.test(raw) || !Number.isFinite(dealId)) {
    return c.json({ error: 'Invalid deal_id' }, 400);
  }

  try {
    await ensureSchema(c.env);
    const payload: Record<string, unknown> = {
      ...(await buildPublicTally(c.env, dealId)),
      my_vote: await myVote(c.env, dealId, user.id),
    };

    if (c.req.query('include_comments') === 'true') {
      // Anonymity is applied server-side: an anonymous voter's name never
      // leaves the worker, so it cannot be recovered from the response the
      // way a client-side filter would leak it.
      const rows: any = await c.env.DB.prepare(
        `SELECT v.vote_type, v.weight, v.comment, v.anonymous, v.updated_at, v.user_id,
                u.name AS voter_name
           FROM pipeline_votes v
           LEFT JOIN users u ON u.id = v.user_id
          WHERE v.deal_id = ? AND v.comment IS NOT NULL AND v.comment != ''
          ORDER BY v.updated_at DESC`,
      ).bind(dealId).all();
      payload.comments = (rows?.results || []).map((r: any) => ({
        voter_name: r.anonymous ? 'Anonymous' : (r.voter_name || `User #${r.user_id}`),
        vote_type: r.vote_type,
        weight: Number(r.weight),
        comment: r.comment,
        at: r.updated_at,
      }));
    }

    return c.json(payload);
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to load tally' }, 500);
  }
});

export default votes;
