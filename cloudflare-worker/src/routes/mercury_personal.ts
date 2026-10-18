/**
 * /api/mercury/personal — a member's own Mercury, for payment evidence (D713, #1778).
 * NOTHING HERE MOVES MONEY: every bank read goes through #1775's GET-only client.
 *
 *   GET  /status                       the caller's connection and the uses their role holds
 *   GET  /matches?target=invoice|payout|settlement
 *                                      their open targets of that kind, each with the bank
 *                                      lines that fit it, and their confirmed matches
 *   POST /matches                      { target_kind, target_id, transaction_id } — confirm one
 *   POST /matches/:uid/withdraw        { reason } — at least 10 characters
 *
 * THE USE KEYS (`services/mercuryPersonal.ts` `PERSONAL_USES`), as `/status` names them:
 *
 *   venture_revenue   founder   the revenue import, at /api/revenue/projects/:id/mercury-credits
 *   practice_income   partner   target=invoice: their own engagement invoices
 *   partner_deals     partner   target=payout and target=settlement; HQ only
 *
 * Every route checks the caller's use, branch and support session first
 * (`personalPolicy`), and each value in a request is checked before anything
 * reaches Mercury. A target is named by its integer id; another member's target
 * or match is 404, as a missing one is. `/status` reads only the caller's own
 * `integrations` row, never the bank. Disconnect stays with the generic
 * integrations route.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import {
  PERSONAL_USES, TARGET_WORDS, USE_OF_TARGET, UUID_RE, WITHDRAW_REASON_MIN,
  confirmMatch, logPersonalRead, matchDto, matchUse, ownTargets, personalConnection, personalPolicy,
  proposals, readFailure, usesFor, withdrawMatch,
  type MatchRow, type PersonalMatchTarget, type PersonalUse,
} from '../services/mercuryPersonal';

type C = Context<{ Bindings: Env }>;
const mercuryPersonal = new Hono<{ Bindings: Env }>();

const ALL_USES: PersonalUse[] = [...new Set(Object.values(PERSONAL_USES).flat())];

/** `invoice`, `payout`, `settlement`, or the stored kind itself. */
function targetKind(v: unknown): PersonalMatchTarget | null {
  const s = String(v ?? '');
  if (TARGET_WORDS[s]) return TARGET_WORDS[s];
  return (Object.values(TARGET_WORDS) as string[]).includes(s) ? (s as PersonalMatchTarget) : null;
}

const positiveId = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))
  && Number.isSafeInteger(Number(v)) && Number(v) > 0;

mercuryPersonal.get('/status', async (c) => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare(
    "SELECT uid, status, external_account_name, config_json FROM integrations WHERE user_id = ? AND provider_key = 'mercury' LIMIT 1",
  ).bind(user.id).first<{ uid: string; status: string; external_account_name: string | null; config_json: string | null }>();
  let readOnly: string | null = null;
  try { readOnly = row?.config_json ? (JSON.parse(row.config_json)?.read_only ?? null) : null; } catch { readOnly = null; }
  const held = usesFor(user.role);
  const hq = branchOf(c.env) === null;
  return c.json({
    connected: !!row,
    connection: row ? { uid: row.uid, status: row.status, account_name: row.external_account_name, read_only: readOnly } : null,
    uses: ALL_USES.map((key) => ({
      key,
      available: held.includes(key) && (key !== 'partner_deals' || hq),
      reason: !held.includes(key) ? 'purpose_not_allowed' : key === 'partner_deals' && !hq ? 'hq_only' : null,
    })),
  });
});

async function confirmedMatches(c: C, user: User, kind: PersonalMatchTarget) {
  const rows = (await c.env.DB.prepare(
    "SELECT * FROM mercury_personal_matches WHERE user_id = ? AND target_kind = ? AND state = 'confirmed' ORDER BY posted_on DESC, id DESC",
  ).bind(user.id, kind).all<MatchRow>()).results || [];
  return rows.map(matchDto);
}

mercuryPersonal.get('/matches', async (c) => {
  const user = await requireAuth(c);
  const kind = targetKind(c.req.query('target'));
  if (!kind) return c.json({ error: 'invalid_target', message: 'Choose invoice, payout or settlement.' }, 400);
  const conn = await personalConnection(c, user, USE_OF_TARGET[kind]);
  if (conn instanceof Response) return conn;
  const targets = await ownTargets(c.env, user, kind);
  let found;
  try { found = await proposals(c.env, user, conn, targets); }
  catch (e) { return readFailure(c, conn, e); }
  await logPersonalRead(c.env, conn, user, 'mercury_matches_read', { targets: targets.length, lines: found.lines_read });
  return c.json({ target_kind: kind, ...found, matches: await confirmedMatches(c, user, kind) });
});

mercuryPersonal.post('/matches', async (c) => {
  const user = await requireAuth(c);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = targetKind(b.target_kind);
  if (!kind) return c.json({ error: 'invalid_target', message: 'Choose invoice, payout or settlement.' }, 400);
  if (!positiveId(b.target_id)) return c.json({ error: 'invalid_target_id', message: 'Name the invoice, payout or settlement by its id.' }, 400);
  const txId = typeof b.transaction_id === 'string' ? b.transaction_id.toLowerCase() : '';
  if (!UUID_RE.test(txId)) return c.json({ error: 'invalid_transaction_id', message: 'Name the bank line by its Mercury transaction id.' }, 400);
  const conn = await personalConnection(c, user, USE_OF_TARGET[kind]);
  if (conn instanceof Response) return conn;
  let out;
  try { out = await confirmMatch(c.env, user, conn, kind, Number(b.target_id), txId); }
  catch (e) { return readFailure(c, conn, e); }
  await logPersonalRead(c.env, conn, user, 'mercury_match_confirm', { lines: 1, matched: out.ok ? 1 : 0 });
  if (!out.ok) return c.json({ error: out.code, message: out.message }, out.status as 404 | 409);
  return c.json({ ok: true, match: matchDto(out.match) }, 201);
});

mercuryPersonal.post('/matches/:uid/withdraw', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < WITHDRAW_REASON_MIN || reason.length > 1000) {
    return c.json({ error: 'reason_required', message: `Say why, in at least ${WITHDRAW_REASON_MIN} characters.` }, 400);
  }
  const use = UUID_RE.test(uid) ? await matchUse(c.env, user, uid) : null;
  if (!use) return c.json({ error: 'match_not_found', message: 'No such match.' }, 404);
  // A withdraw reads no bank line, but the use is still the caller's to hold.
  const policy = await personalPolicy(c, user, use);
  if (policy) return policy;
  const out = await withdrawMatch(c.env, user, uid, reason);
  if (!out.ok) return c.json({ error: out.code, message: out.message }, out.status as 404 | 409);
  return c.json({ ok: true, match: matchDto(out.match) });
});

export default mercuryPersonal;
