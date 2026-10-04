/**
 * D540 — the Super Admin's control over credit rewards. Mounted at
 * /api/admin/credit-rules.
 *
 *   GET  /                    every reward rule and the monthly bounty cap
 *   PUT  /:key                change one rule's credits, value or on/off
 *   GET  /grants              rule-based grants, newest first (?user_id=)
 *   POST /grants/:id/revoke   take one back
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
import { CAP_RULE_KEY, isBountyRule, revokeGrant } from '../services/creditGrants';
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
            WHERE g.kind = 'grant' AND g.rule_key IS NOT NULL AND g.user_id = ?
            ORDER BY g.created_at DESC, g.id DESC LIMIT 200`,
        ).bind(userId)
      : c.env.DB.prepare(
          `SELECT g.id, g.user_id, u.email, g.delta AS credits, g.rule_key, g.source_ref, g.note, g.created_at,
                  r.id AS revoke_id, r.note AS revoke_reason, r.created_at AS revoked_at
             FROM perk_credit_ledger g
             LEFT JOIN users u ON u.id = g.user_id
             LEFT JOIN perk_credit_ledger r
               ON r.user_id = g.user_id AND r.kind = 'admin_adjust' AND r.source_ref = 'revoke:' || g.id
            WHERE g.kind = 'grant' AND g.rule_key IS NOT NULL
            ORDER BY g.created_at DESC, g.id DESC LIMIT 200`,
        )
    ).all<any>();
    return c.json({
      grants: (rows.results || []).map((g: any) => ({
        id: g.id, user_id: g.user_id, email: g.email ?? null, credits: Number(g.credits), rule_key: g.rule_key,
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
    // 1 credit = US$1 unless the Super Admin says otherwise for this rule.
    const usdCents = body?.usd_value_cents === undefined
      ? (body?.credits === undefined ? Number(before.usd_value_cents) : credits * 100)
      : wholeNumber(body.usd_value_cents);
    if (usdCents === null) {
      return refuse(c, 400, { code: 'invalid_value', message: 'The dollar value must be a whole number of cents, 0 or more.' });
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
