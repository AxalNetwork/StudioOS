/**
 * D545 — the community task list the Eadwyn chat's Tasks panel reads.
 * Mounted at /api/community-tasks. Signed-in only.
 *
 *   GET /?suggestions_before=<id>
 *         { tasks, my_suggestions, my_suggestions_next, audience }
 *
 *   tasks           the approved community tasks for the caller's persona,
 *                   plus those for `all`. A Super Admin, who reviews them,
 *                   sees every approved task. A plain admin is not the
 *                   reviewer (D544's review routes are `requireSuperAdmin`),
 *                   so they read only the tasks for `all`.
 *   my_suggestions  the caller's own suggested tasks with their review state:
 *                   pending, approved, or declined with the Super Admin's
 *                   reason. Newest first, 100 a page.
 *   my_suggestions_next  the `suggestions_before` value for the next page, or
 *                   null when this page is the last. Older suggestions are
 *                   one request away, never silently cut off.
 *
 *   GET /rewards    { rewards }   (D606)
 *
 *   rewards         what an approved suggestion and a fixed bug earn today,
 *                   from D540's `credit_reward_rules`, for the Eadwyn panels'
 *                   notes: `task_approved`, `bug_high`, `bug_medium` and
 *                   `bug_low`, each `{ credits, active }`, or null when the
 *                   table has no such rule. A failed read is a refusal,
 *                   never zeros.
 *
 * D606 — each approved suggestion also carries `reward`: the credits its
 * grant actually paid (the ledger row D544's approval wrote, keyed
 * `task:<id>`), what the suggester got rather than what the rule says now.
 * `credits` is null when no grant was paid (refused, or the rule was off);
 * `revoked` says a grant was taken back; a ledger that cannot be read says
 * `credits_unreadable` and the list is still served. A pending or declined
 * suggestion carries null.
 *
 * The store is D544's `community_tasks` (migration 383). A read that fails is
 * a 500 refusal, never an empty list: "No tasks yet" and "could not read the
 * tasks" are different sentences, and the panel prints each.
 *
 * The persona matches D544's audiences: the four roles that are personas
 * themselves, `exploring` as `explorer`, and any other account sees only the
 * tasks for `all`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

const SUGGESTIONS_PAGE = 100;

/** The rules the Eadwyn panels state, in the order the notes name them. */
export const PANEL_REWARD_KEYS = ['task_approved', 'bug_high', 'bug_medium', 'bug_low'] as const;

export type SuggestionReward = { credits: number | null; revoked: boolean } | { credits: null; credits_unreadable: true } | null;

/**
 * The grant each approved suggestion paid, from the ledger. Same reading as
 * D542's `bountySummaries`: the grant's own delta, revoked when an
 * `admin_adjust` row names it.
 */
async function suggestionRewards(env: Env, userId: number, rows: Array<{ id: number; status: string }>): Promise<Map<number, SuggestionReward>> {
  const out = new Map<number, SuggestionReward>();
  const approved = rows.filter((x) => x.status === 'approved');
  for (const x of rows) out.set(Number(x.id), null);
  if (!approved.length) return out;
  try {
    const { results } = await env.DB.prepare(
      `SELECT g.source_ref, g.delta,
              EXISTS (SELECT 1 FROM perk_credit_ledger r
                       WHERE r.user_id = g.user_id AND r.kind = 'admin_adjust' AND r.source_ref = 'revoke:' || g.id) AS revoked
         FROM perk_credit_ledger g
        WHERE g.user_id = ? AND g.kind = 'grant' AND g.source_ref IN (SELECT value FROM json_each(?))`,
    ).bind(userId, JSON.stringify(approved.map((x) => `task:${x.id}`))).all<{ source_ref: string; delta: number; revoked: number }>();
    const byRef = new Map((results || []).map((g) => [g.source_ref, g]));
    for (const x of approved) {
      const g = byRef.get(`task:${x.id}`);
      out.set(Number(x.id), { credits: g ? Number(g.delta) : null, revoked: !!(g && Number(g.revoked)) });
    }
  } catch (e) {
    console.warn('[community-tasks] ledger unreadable for the suggestion rewards', (e as Error).message);
    for (const x of approved) out.set(Number(x.id), { credits: null, credits_unreadable: true });
  }
  return out;
}

/** The audience a role reads, or null for "only the tasks for everyone". */
export function audienceFor(role: unknown): string | null {
  const v = String(role ?? '').toLowerCase();
  if (v === 'founder' || v === 'investor' || v === 'advisor' || v === 'partner') return v;
  if (v === 'exploring' || v === 'explorer') return 'explorer';
  return null;
}

r.get('/', async (c) => {
  let user;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const seesAll = isSuperAdmin(user as any);
  const audience = audienceFor(user.role);
  const beforeRaw = c.req.query('suggestions_before');
  const before = beforeRaw === undefined ? null : Number(beforeRaw);
  if (before !== null && !(Number.isInteger(before) && before > 0)) {
    return refuse(c, 400, { code: 'bad_cursor', message: 'suggestions_before must be a positive suggestion id.' });
  }
  try {
    const tasks = await (seesAll
      ? c.env.DB.prepare(
          `SELECT id, title, body, audience, decided_at FROM community_tasks
            WHERE status = 'approved' ORDER BY decided_at DESC, id DESC LIMIT 200`,
        )
      : c.env.DB.prepare(
          `SELECT id, title, body, audience, decided_at FROM community_tasks
            WHERE status = 'approved' AND (audience = 'all' OR audience = ?)
            ORDER BY decided_at DESC, id DESC LIMIT 200`,
        ).bind(audience ?? 'all')
    ).all<any>();
    const mine = await c.env.DB.prepare(
      `SELECT ct.id, ct.ticket_id, ct.title, ct.status, ct.decline_reason, ct.created_at, ct.decided_at
         FROM community_tasks ct JOIN tickets t ON t.id = ct.ticket_id
        WHERE t.user_id = ? AND (? IS NULL OR ct.id < ?)
        ORDER BY ct.id DESC LIMIT 101`,
    ).bind(user.id, before, before).all<any>();
    // One row past the page says whether there is another page.
    const mineRows = mine.results || [];
    const page = mineRows.slice(0, SUGGESTIONS_PAGE);
    const next = mineRows.length > SUGGESTIONS_PAGE ? page[page.length - 1].id : null;
    const rewards = await suggestionRewards(c.env, Number(user.id), page);
    return c.json({
      audience: seesAll ? 'admin' : (audience ?? 'all'),
      tasks: (tasks.results || []).map((x: any) => ({
        id: x.id, title: x.title, body: x.body ?? null, audience: x.audience, published_at: x.decided_at ?? null,
      })),
      my_suggestions: page.map((x: any) => ({
        id: x.id, ticket_id: x.ticket_id, title: x.title, status: x.status,
        // The reason belongs to a decline only; a pending or approved row has none.
        decline_reason: x.status === 'declined' ? (x.decline_reason ?? null) : null,
        created_at: x.created_at, decided_at: x.decided_at ?? null,
        reward: rewards.get(Number(x.id)) ?? null,
      })),
      my_suggestions_next: next,
    });
  } catch (e) {
    return refuse(c, 500, {
      code: 'community_tasks_unreadable',
      message: 'The task list could not be read. This is not a sign there are none; try again.',
      raw: e,
    });
  }
});

r.get('/rewards', async (c) => {
  try { await requireAuth(c); } catch (e) { return mapError(c, e); }
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT key, credits, active FROM credit_reward_rules WHERE key IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(PANEL_REWARD_KEYS)).all<{ key: string; credits: number; active: number }>();
    const byKey = new Map((results || []).map((x) => [x.key, x]));
    const rewards = Object.fromEntries(PANEL_REWARD_KEYS.map((k) => {
      const x = byKey.get(k);
      return [k, x ? { credits: Number(x.credits), active: Number(x.active) === 1 } : null];
    }));
    return c.json({ rewards });
  } catch (e) {
    return refuse(c, 500, {
      code: 'rewards_unreadable',
      message: 'What a task or a bug report earns could not be read. This is not a sign it earns nothing; try again.',
      raw: e,
    });
  }
});

export default r;
