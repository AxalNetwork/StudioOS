/**
 * /api/admin/capital-attestations — Axal's admins on HQ read an investor's
 * shared proof of funds (D752 §4, #1890). NOTHING HERE MOVES MONEY.
 *
 *   GET /?purpose=<p>&target_id=<n>   one target: deal_commitment, lp_application or lp_commitment
 *   GET /?deal_id=<n>                 every commitment on that deal that has a statement
 *   GET /?fund_id=<n>                 the fund's applications and LP commitments
 *
 * Exactly one form per request, or 400 `invalid_query`; a bad purpose is 400
 * `invalid_purpose`, a bad id 400 `invalid_target_id`, `invalid_deal_id` or
 * `invalid_fund_id`. A refused query reads nothing and writes no audit row.
 *
 * WHO: an Admin on HQ, the Super Admin included (`requireMercuryReader`):
 * 403 `support_session_refused` for a support session, 403 `hq_only` on a
 * branch, 403 for anyone who is not an admin. Never a cron, an Eadwyn reader
 * or an MCP tool.
 *
 * WHAT: reads `capital_attestations` and `users.name` only, never a
 * connection; calls no bank. One statement per target: the active one, else
 * the newest revoked one; a superseded statement is never shown. A revoked
 * statement carries its date and no amount or holder.
 *
 * ORDER (decisions 7 and 8): gate, validate, read, then the audit row
 * (`capital_attestations_read`, ids and counts only), then one view on every
 * active statement whose amount the answer carries, then the answer. No audit
 * row: 503 `audit_unavailable`, with nothing shown and no view counted. A
 * failed read: 503 `attestations_unreadable`, and no audit row.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { AUDIT_UNAVAILABLE, auditRead, requireMercuryReader } from '../services/mercury/access';
import {
  ADMIN_READ_LIMIT, OTHER_ACTIVE_MAX, adminDto, currentPerTarget, isPurpose, todayUtc,
  type AdminAttestationRow, type AttestationPurpose, type OtherActive,
} from '../services/capitalAttestationTerms';

const adminCapitalAttestations = new Hono<{ Bindings: Env }>();

const SELECT = `SELECT a.id, a.uid, a.user_id, a.purpose, a.target_id, a.deal_id, a.fund_id, a.amount_floor_cents, a.as_of, a.expires_on,
       a.holder_name, a.accounts_counted, a.consented_at, a.state, a.revoked_at, u.name AS investor_name
  FROM capital_attestations a JOIN users u ON u.id = a.user_id`;
const BY_TARGET = `${SELECT}
 WHERE a.state <> 'superseded' AND a.purpose = ? AND a.target_id = ?
 ORDER BY a.target_id, a.id DESC
 LIMIT 501`;
const BY_DEAL = `${SELECT}
 WHERE a.state <> 'superseded' AND a.purpose = 'deal_commitment' AND a.deal_id = ?
 ORDER BY a.target_id, a.id DESC
 LIMIT 501`;
const BY_FUND = `${SELECT}
 WHERE a.state <> 'superseded' AND a.fund_id = ? AND a.purpose IN ('lp_application', 'lp_commitment')
 ORDER BY a.target_id, a.id DESC
 LIMIT 501`;
const OTHERS = `SELECT uid, user_id, purpose, target_id, deal_id, amount_floor_cents, as_of, expires_on
  FROM capital_attestations WHERE state = 'active' AND user_id IN (SELECT value FROM json_each(?))`;
const BUMP = `UPDATE capital_attestations SET admin_view_count = admin_view_count + 1, last_admin_view_at = datetime('now')
 WHERE state = 'active' AND uid IN (SELECT value FROM json_each(?))`;

const positiveId = (v: string | undefined): number | null =>
  v !== undefined && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;

type Query =
  | { form: 'target'; purpose: AttestationPurpose; target_id: number }
  | { form: 'deal'; deal_id: number }
  | { form: 'fund'; fund_id: number };

function parseQuery(q: Record<string, string>): Query | { code: string; detail: string } {
  const has = (k: string) => q[k] !== undefined && q[k] !== '';
  const forms = [has('purpose') || has('target_id'), has('deal_id'), has('fund_id')].filter(Boolean).length;
  if (forms !== 1) return { code: 'invalid_query', detail: 'Ask for one target (purpose and target_id), one deal (deal_id) or one fund (fund_id).' };
  if (has('deal_id')) {
    const id = positiveId(q.deal_id);
    return id ? { form: 'deal', deal_id: id } : { code: 'invalid_deal_id', detail: 'Name the deal by its id.' };
  }
  if (has('fund_id')) {
    const id = positiveId(q.fund_id);
    return id ? { form: 'fund', fund_id: id } : { code: 'invalid_fund_id', detail: 'Name the fund by its id.' };
  }
  if (!isPurpose(q.purpose)) return { code: 'invalid_purpose', detail: 'Choose deal_commitment, lp_application or lp_commitment.' };
  const id = positiveId(q.target_id);
  return id ? { form: 'target', purpose: q.purpose, target_id: id } : { code: 'invalid_target_id', detail: 'Name the target by its id.' };
}

adminCapitalAttestations.get('/', async (c) => {
  const user = await requireMercuryReader(c);
  if (user instanceof Response) return user;
  const query = parseQuery(c.req.query());
  if ('code' in query) return c.json(query, 400);

  const today = todayUtc();
  let rows: AdminAttestationRow[];
  let truncated = false;
  let others: Array<OtherActive & { user_id: number }> = [];
  try {
    const stmt = query.form === 'target'
      ? c.env.DB.prepare(BY_TARGET).bind(query.purpose, query.target_id)
      : query.form === 'deal'
        ? c.env.DB.prepare(BY_DEAL).bind(query.deal_id)
        : c.env.DB.prepare(BY_FUND).bind(query.fund_id);
    const read = (await stmt.all<AdminAttestationRow>()).results || [];
    truncated = read.length > ADMIN_READ_LIMIT;
    rows = currentPerTarget(read.slice(0, ADMIN_READ_LIMIT)).sort((a, b) => Number(a.target_id) - Number(b.target_id) || Number(a.id) - Number(b.id));
    const userIds = [...new Set(rows.filter((r) => r.state === 'active').map((r) => Number(r.user_id)))];
    if (userIds.length) {
      others = (await c.env.DB.prepare(OTHERS).bind(JSON.stringify(userIds)).all<OtherActive & { user_id: number }>()).results || [];
    }
  } catch (e) {
    console.error('[capital_attestations] admin read failed', String((e as Error)?.message || e).slice(0, 300));
    return c.json({ code: 'attestations_unreadable', detail: 'The proofs of funds could not be read. This is not a claim that none was shared.' }, 503);
  }

  const viewed = new Set<string>();
  const items = rows.map((r) => {
    if (r.state !== 'active') return adminDto(r, today);
    const mine = others.filter((o) => Number(o.user_id) === Number(r.user_id) && o.uid !== r.uid);
    viewed.add(r.uid);
    for (const o of [...mine].sort((a, b) => String(b.as_of).localeCompare(String(a.as_of))).slice(0, OTHER_ACTIVE_MAX)) viewed.add(o.uid);
    return adminDto(r, today, mine);
  });

  const filters = {
    purpose: query.form === 'target' ? query.purpose : null,
    target_id: query.form === 'target' ? query.target_id : null,
    deal_id: query.form === 'deal' ? query.deal_id : null,
    fund_id: query.form === 'fund' ? query.fund_id : null,
    count: items.length,
    viewed: viewed.size,
  };
  if (!await auditRead(c.env, user, 'capital_attestations_read', filters)) return c.json(AUDIT_UNAVAILABLE, 503);
  if (viewed.size) {
    try {
      await c.env.DB.prepare(BUMP).bind(JSON.stringify([...viewed])).run();
    } catch (e) {
      console.error('[capital_attestations] view count failed', String((e as Error)?.message || e).slice(0, 300));
      return c.json(AUDIT_UNAVAILABLE, 503);
    }
  }
  return c.json({
    ok: true, today, items, truncated,
    ...(query.form === 'deal' ? { deal_id: query.deal_id } : {}),
    ...(query.form === 'fund' ? { fund_id: query.fund_id } : {}),
  });
});

export default adminCapitalAttestations;
