/**
 * D540 — the Super Admin's control over credit rewards. Mounted at
 * /api/admin/credit-rules.
 *
 *   GET  /                    every reward rule and the monthly bounty cap
 *   PUT  /:key                change one rule's credits, value or on/off
 *   GET  /grants              rule-based grants and manual adjustments (D608,
 *                             `manual: true`), newest first (?user_id=)
 *   POST /grants/:id/revoke   take one back
 *   POST /lab-backfill        pay the current Lab cohort once for milestones
 *                             completed before credits launched (D541,
 *                             #1102 Q4 B); ?after= continues a walk
 *
 * Every route is the Super Admin's (`requireSuperAdmin`), and every write
 * carries a typed reason of at least ten characters — the floor the other
 * HQ acts share (`HOLDER_REASON_MIN`) — recorded through `logAdminAction`.
 * Amounts live in `credit_reward_rules` (migration 381); grants go through
 * `services/creditGrants.ts`, never a ledger write from here.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { CAP_RULE_KEY, MANUAL_RULE_KEY, isBountyRule, revokeGrant } from '../services/creditGrants';
import { backfillLabCredits } from '../services/labMilestoneCredits';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

export const CREDIT_REASON_MIN = 10;
const CREDITS_MAX = 100_000;

type RuleRow = { key: string; credits: number; usd_value_cents: number; active: number; updated_by: number | null; updated_at: string };

export function ruleKind(key: string): 'cap' | 'bounty' | 'lab' | 'reward' {
  if (key === CAP_RULE_KEY) return 'cap';
  if (isBountyRule(key)) return 'bounty';
  if (key.startsWith('lab:')) return 'lab';
  return 'reward';
}

const shape = (x: RuleRow) => ({
  key: x.key, kind: ruleKind(x.key), credits: Number(x.credits), usd_value_cents: Number(x.usd_value_cents),
  active: Number(x.active) === 1, updated_by: x.updated_by ?? null, updated_at: x.updated_at,
});

async function readReason(c: any, body: any): Promise<string | Response> {
  const reason = String(body?.reason ?? '').trim().slice(0, 500);
  if (reason.length < CREDIT_REASON_MIN) {
    return refuse(c, 400, {
      code: 'reason_too_short',
      message: `Say why — at least ${CREDIT_REASON_MIN} characters. It is recorded beside the change.`,
    });
  }
  return reason;
}

const wholeNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= CREDITS_MAX * 100 ? n : null;
};

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    const rows = await c.env.DB.prepare(
      'SELECT key, credits, usd_value_cents, active, updated_by, updated_at FROM credit_reward_rules ORDER BY key',
    ).all<RuleRow>();
    return c.json({ rules: (rows.results || []).map(shape) });
  } catch (e) { return mapError(c, e); }
});

r.get('/grants', async (c) => {
  try {
    await requireSuperAdmin(c);
    const userId = Number(c.req.query('user_id') || 0);
    // Two full literals, never a clause dropped into the query text.
    const one = Number.isInteger(userId) && userId > 0;
    const rows = await (one
      ? c.env.DB.prepare(
          `SELECT g.id, g.user_id, u.email, g.delta AS credits, g.rule_key, g.source_ref, g.note, g.created_at,
                  r.id AS revoke_id, r.note AS revoke_reason, r.created_at AS revoked_at
             FROM perk_credit_ledger g
             LEFT JOIN users u ON u.id = g.user_id
             LEFT JOIN perk_credit_ledger r
               ON r.user_id = g.user_id AND r.kind = 'admin_adjust' AND r.source_ref = 'revoke:' || g.id
            WHERE ((g.kind = 'grant' AND g.rule_key IS NOT NULL) OR (g.kind = 'admin_adjust' AND g.rule_key = 'manual' AND substr(g.source_ref, 1, 7) <> 'revoke:')) AND g.user_id = ?
            ORDER BY g.created_at DESC, g.id DESC LIMIT 200`,
        ).bind(userId)
      : c.env.DB.prepare(
          `SELECT g.id, g.user_id, u.email, g.delta AS credits, g.rule_key, g.source_ref, g.note, g.created_at,
                  r.id AS revoke_id, r.note AS revoke_reason, r.created_at AS revoked_at
             FROM perk_credit_ledger g
             LEFT JOIN users u ON u.id = g.user_id
             LEFT JOIN perk_credit_ledger r
               ON r.user_id = g.user_id AND r.kind = 'admin_adjust' AND r.source_ref = 'revoke:' || g.id
            WHERE ((g.kind = 'grant' AND g.rule_key IS NOT NULL) OR (g.kind = 'admin_adjust' AND g.rule_key = 'manual' AND substr(g.source_ref, 1, 7) <> 'revoke:'))
            ORDER BY g.created_at DESC, g.id DESC LIMIT 200`,
        )
    ).all<any>();
    return c.json({
      grants: (rows.results || []).map((g: any) => ({
        id: g.id, user_id: g.user_id, email: g.email ?? null, credits: Number(g.credits), rule_key: g.rule_key,
        manual: g.rule_key === MANUAL_RULE_KEY,
        source_ref: g.source_ref, note: g.note, created_at: g.created_at,
        revoked: g.revoke_id !== null && g.revoke_id !== undefined,
        revoke_reason: g.revoke_reason ?? null, revoked_at: g.revoked_at ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/grants/:id/revoke', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id) || id <= 0) return refuse(c, 400, { code: 'invalid_id', message: 'That is not a grant id.' });
    const body = await c.req.json().catch(() => ({}));
    const reason = await readReason(c, body);
    if (reason instanceof Response) return reason;
    const out = await revokeGrant(c.env, { ledgerId: id, actor: { id: admin.id, email: admin.email }, reason });
    if (out.status === 'refused') {
      return refuse(c, out.code === 'not_found' ? 404 : 409, {
        code: out.code, message: out.message, extra: out.balance === undefined ? {} : { balance: out.balance },
      });
    }
    return c.json(out);
  } catch (e) { return mapError(c, e); }
});

// One walk of the cohort backfill. Idempotent on the ledger's source refs, so
// running it again, or past a member paid live, pays nothing more. The answer
// carries `next_after` until every accepted member has been walked.
r.post('/lab-backfill', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const reason = await readReason(c, body);
    if (reason instanceof Response) return reason;
    const after = Number.parseInt(String(c.req.query('after') ?? '0'), 10);
    const limit = Number.parseInt(String(c.req.query('limit') ?? ''), 10);
    const result = await backfillLabCredits(c.env, {
      after: Number.isInteger(after) ? after : 0,
      limit: Number.isInteger(limit) ? limit : undefined,
    });
    await logAdminAction(c.env, admin.id, admin.email, 'credit_lab_backfill', { after, ...result, reason });
    return c.json({ ok: true, ...result });
  } catch (e) { return mapError(c, e); }
});

r.put('/:key', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const reason = await readReason(c, body);
    if (reason instanceof Response) return reason;
    const before = await c.env.DB.prepare(
      'SELECT key, credits, usd_value_cents, active, updated_by, updated_at FROM credit_reward_rules WHERE key = ?',
    ).bind(key).first<RuleRow>();
    if (!before) return refuse(c, 404, { code: 'rule_unknown', message: `No reward rule is named ${key}.` });

    const credits = body?.credits === undefined ? Number(before.credits) : wholeNumber(body.credits);
    if (credits === null || credits > CREDITS_MAX) {
      return refuse(c, 400, { code: 'invalid_credits', message: `Credits must be a whole number from 0 to ${CREDITS_MAX}.` });
    }
    // 1 CREDIT = US$1, ALWAYS (#1101). The dollar value follows the credits
    // and is never set on its own: the Perks balance and ledger convert at
    // that one rate, so a rule worth anything else would show the same
    // credits at two different prices. A value sent that disagrees is refused.
    const usdCents = credits * 100;
    if (body?.usd_value_cents !== undefined && wholeNumber(body.usd_value_cents) !== usdCents) {
      return refuse(c, 400, {
        code: 'usd_value_fixed',
        message: `1 credit is US$1, so ${credits} credits are worth ${usdCents} cents. Change the credits; the value follows.`,
      });
    }
    const active = body?.active === undefined ? Number(before.active) === 1 : body.active === true;
    if (body?.active !== undefined && typeof body.active !== 'boolean') {
      return refuse(c, 400, { code: 'invalid_active', message: 'active must be true or false.' });
    }

    await c.env.DB.prepare(
      `UPDATE credit_reward_rules SET credits = ?, usd_value_cents = ?, active = ?, updated_by = ?, updated_at = ?
        WHERE key = ?`,
    ).bind(credits, usdCents, active ? 1 : 0, admin.id, new Date().toISOString(), key).run();
    const from = shape(before);
    await logAdminAction(c.env, admin.id, admin.email, 'credit_rule_update', {
      rule_key: key,
      from: { credits: from.credits, usd_value_cents: from.usd_value_cents, active: from.active },
      to: { credits, usd_value_cents: usdCents, active },
      reason,
    });
    const after = await c.env.DB.prepare(
      'SELECT key, credits, usd_value_cents, active, updated_by, updated_at FROM credit_reward_rules WHERE key = ?',
    ).bind(key).first<RuleRow>();
    return c.json({ rule: after ? shape(after) : null });
  } catch (e) { return mapError(c, e); }
});

export default r;
