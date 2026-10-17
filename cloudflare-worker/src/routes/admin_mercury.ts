/**
 * D710 (#1775) — Mercury for fund administration, read-only. Mounted at
 * `/api/admin/mercury`, ahead of the generic `/api/admin` routers.
 *
 *  GET    /connections                       the four entities, each with its connection or null
 *  PUT    /connections/:entityKey            { api_token, confirm_read_only }   Super Admin, write bar
 *  DELETE /connections/:entityKey            { reason }                          Super Admin, write bar
 *  POST   /connections/:entityKey/sync       sync now (once in five minutes)
 *  GET    /accounts?entity=
 *  GET    /transactions?entity=&account=&from=&to=&match=&page=   (50 a page)
 *  GET    /matches?state=
 *  POST   /matches                           { transaction_uid, target_kind, target_id }
 *  POST   /matches/:uid/confirm
 *  POST   /matches/:uid/reject               { reason }
 *
 * WHO (decision 4, `services/mercury/access.ts`): connect, replace and
 * disconnect are the Super Admin's, behind `requireSuperAdminWriteBar`, with
 * `super_admin_required` answered first to a plain Admin. Every other route is
 * an Admin's on HQ. A support session and a branch are refused everywhere.
 *
 * NOTHING HERE MOVES MONEY. No path sends, transfers, pays or wires; the
 * client behind it can only GET (`mercury_read_only_d710.test.mjs`).
 *
 * WHAT A RESPONSE NEVER CARRIES: a token beyond `token_preview` (and that only
 * on the Super Admin's own read, as D223 removed previews from reads every
 * admin can make), an account or routing number, or a Mercury body. A value
 * never read is null with `reason: 'not_recorded'`; a failed read is null with
 * `reason: 'unreadable'`, never 0 (`D686.md:553`).
 *
 * Every read writes its `admin_audit_log` row first and answers 503 with no
 * rows when it cannot (decision 7). Writes call `logAdminAction` after the act.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { isSuperAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { AXAL_ENTITIES, type AxalEntityKey } from '../services/legalDocFormat';
import { AUDIT_UNAVAILABLE, auditRead, requireMercuryCredentialWriter, requireMercuryReader } from '../services/mercury/access';
import { getOrganization, listAccounts, MercuryClientError, type MercuryFetch } from '../services/mercury/client';
import { parseAccounts, parseOrganization } from '../services/mercury/parse';
import {
  checkAgainstRegistry, disconnect, ENTITY_KEYS, isEntityKey, liveConnection, orgNameDiffers, registryRows, saveConnection,
  upsertAccounts, type ConnectionRow,
} from '../services/mercury/store';
import { syncConnection } from '../services/mercury/sync';
import { confirmMatch, proposeManual, rejectMatch, type MatchDeps } from '../services/mercury/match';

type C = Context<{ Bindings: Env }>;

export const SYNC_NOW_MINUTES = 5;
export const TRANSACTIONS_PAGE = 50;
const MATCH_STATES = ['proposed', 'confirmed', 'rejected', 'needs_review'] as const;

export interface AdminMercuryOptions { fetcher?: MercuryFetch; match?: Partial<MatchDeps> }

function view(row: ConnectionRow | null, withPreview: boolean) {
  if (!row) return null;
  return {
    uid: row.uid,
    status: row.status,
    mercury_org_name: row.mercury_org_name,
    org_name_differs: orgNameDiffers(row.entity_key, row.mercury_org_name),
    connected_at: row.connected_at,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
    ...(withPreview ? { token_preview: row.token_preview } : {}),
  };
}

const money = (cents: unknown, readAt: unknown) => (cents == null
  ? { cents: null, reason: readAt ? 'unreadable' : 'not_recorded' }
  : { cents: Number(cents), reason: null });

async function entityParam(c: C): Promise<AxalEntityKey | Response> {
  const key = String(c.req.param('entityKey') || '');
  return isEntityKey(key) ? key : c.json({ code: 'unknown_entity', detail: 'No such Axal entity.' }, 404);
}

function waitUntil(c: C, work: Promise<unknown>): void {
  try { c.executionCtx.waitUntil(work.catch(() => {})); }
  catch { work.catch(() => {}); }
}

const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function createAdminMercury(opts: AdminMercuryOptions = {}) {
  const r = new Hono<{ Bindings: Env }>();

  r.get('/connections', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const rows = await Promise.all(ENTITY_KEYS.map((k) => liveConnection(c.env, k)));
    if (!await auditRead(c.env, user, 'mercury_connections_read', { connections: rows.filter(Boolean).length })) return c.json(AUDIT_UNAVAILABLE, 503);
    const holder = isSuperAdmin(user as any);
    return c.json({
      ok: true,
      entities: ENTITY_KEYS.map((k, i) => ({ entity_key: k, name: AXAL_ENTITIES[k].name, connection: view(rows[i], holder) })),
    });
  });

  r.put('/connections/:entityKey', async (c) => {
    const user = await requireMercuryCredentialWriter(c); if (user instanceof Response) return user;
    const entity = await entityParam(c); if (entity instanceof Response) return entity;
    const body = (await c.req.json().catch(() => ({}))) as { api_token?: unknown; confirm_read_only?: unknown };
    const token = typeof body.api_token === 'string' ? body.api_token.trim() : '';
    if (token.length < 8 || token.length > 512 || /\s/.test(token)) return c.json({ code: 'api_token_required', detail: 'Paste the read-only API token.' }, 400);
    // UNVERIFIED that Mercury reports a token's permission; until it is known
    // to, the Super Admin confirms it, and the GET-only client is the guarantee.
    if (body.confirm_read_only !== true) {
      return c.json({ code: 'confirm_read_only_required', detail: 'Confirm that this token is read-only. A read-write token is never accepted.' }, 400);
    }
    const registry = await registryRows(c.env).catch(() => null);
    if (registry == null) {
      return c.json({ code: 'bank_registry_unavailable', detail: 'The bank-account registry (#1773) is not on this deployment yet, so no organization can be checked or connected.' }, 503);
    }
    let accounts; let orgName: string | null;
    try {
      const parsed = parseAccounts(await listAccounts(token, opts.fetcher));
      accounts = parsed;
      orgName = parseOrganization(await getOrganization(token, opts.fetcher)).legal_name;
    } catch (e) {
      const code = e instanceof MercuryClientError ? e.code : 'network_error';
      if (code === 'unauthorized') return c.json({ code: 'mercury_token_refused', detail: 'Mercury refused this token.' }, 400);
      return c.json({ code: 'mercury_unreachable', detail: 'Mercury could not be read. Nothing was stored.', reason: code }, 502);
    }
    const check = await checkAgainstRegistry(c.env, entity, accounts.accounts, registry);
    if (!check.ok) {
      const message = check.code === 'mercury_account_taken'
        ? 'An account this token reads is already stored for another entity.'
        : 'This token’s accounts are not the ones the registry holds for this entity.';
      return c.json({ code: check.code, detail: message }, 409);
    }
    const { row, replaced } = await saveConnection(c.env, user, entity, token, orgName);
    await upsertAccounts(c.env, row, accounts.accounts, check.registered);
    waitUntil(c, syncConnection(c.env, row.id, 'connect', { fetcher: opts.fetcher, match: opts.match }));
    await logAdminAction(c.env, user.id, user.email, replaced ? 'mercury_token_replaced' : 'mercury_connected', {
      entity_key: entity, connection_uid: row.uid, accounts: accounts.accounts.length,
      registered: check.registered.size, skipped_kinds: accounts.skipped,
    });
    return c.json({
      ok: true, entity_key: entity, replaced, connection: view(row, true),
      accounts: accounts.accounts.length, registered: check.registered.size, skipped_kinds: accounts.skipped,
      org_name_differs: orgNameDiffers(entity, orgName),
    });
  });

  r.delete('/connections/:entityKey', async (c) => {
    const user = await requireMercuryCredentialWriter(c); if (user instanceof Response) return user;
    const entity = await entityParam(c); if (entity instanceof Response) return entity;
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500) return c.json({ code: 'reason_required', detail: 'Give a reason of at least ten characters.' }, 400);
    const live = await liveConnection(c.env, entity);
    if (!live) return c.json({ code: 'not_connected', detail: 'This entity has no Mercury connection.' }, 404);
    await disconnect(c.env, user, live, reason);
    await logAdminAction(c.env, user.id, user.email, 'mercury_disconnected', { entity_key: entity, connection_uid: live.uid, reason });
    return c.json({ ok: true, entity_key: entity, disconnected: true });
  });

  r.post('/connections/:entityKey/sync', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const entity = await entityParam(c); if (entity instanceof Response) return entity;
    const live = await liveConnection(c.env, entity);
    if (!live) return c.json({ code: 'not_connected', detail: 'This entity has no Mercury connection.' }, 404);
    const last = live.last_sync_requested_at ? Date.parse(`${live.last_sync_requested_at.replace(' ', 'T')}Z`) : NaN;
    const wait = Number.isFinite(last) ? Math.ceil((last + SYNC_NOW_MINUTES * 60_000 - Date.now()) / 1000) : 0;
    if (wait > 0) {
      return c.json({ code: 'sync_rate_limited', detail: 'A sync was asked for in the last five minutes.', retry_after_seconds: wait }, 429, { 'Retry-After': String(wait) });
    }
    await c.env.DB.prepare("UPDATE mercury_entity_connections SET last_sync_requested_at = datetime('now') WHERE id = ?").bind(live.id).run();
    const outcome = await syncConnection(c.env, live.id, 'manual', { fetcher: opts.fetcher, match: opts.match });
    await logAdminAction(c.env, user.id, user.email, 'mercury_sync_requested', { entity_key: entity, connection_uid: live.uid, status: outcome.status });
    if (outcome.status === 'sync_in_progress') return c.json({ code: 'sync_in_progress', detail: 'A sync of this connection is already running.' }, 409);
    return c.json({ ok: outcome.status !== 'error', entity_key: entity, sync: outcome });
  });

  r.get('/accounts', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const entity = c.req.query('entity') || null;
    if (entity && !isEntityKey(entity)) return c.json({ code: 'unknown_entity', detail: 'No such Axal entity.' }, 400);
    const rows = (await c.env.DB.prepare(
      `SELECT a.uid, a.entity_key, a.kind, a.last_four, a.nickname, a.status, a.registered,
              a.current_cents, a.available_cents, a.balance_read_at, c.status AS connection_status
         FROM mercury_accounts a JOIN mercury_entity_connections c ON c.id = a.connection_id
        WHERE (? IS NULL OR a.entity_key = ?) ORDER BY a.entity_key, a.kind, a.last_four`,
    ).bind(entity, entity).all<any>()).results || [];
    if (!await auditRead(c.env, user, 'mercury_accounts_read', { entity, rows: rows.length })) return c.json(AUDIT_UNAVAILABLE, 503);
    return c.json({
      ok: true,
      items: rows.map((a) => ({
        uid: a.uid, entity_key: a.entity_key, kind: a.kind, last_four: a.last_four, nickname: a.nickname, status: a.status,
        registered: Number(a.registered) === 1, connection_status: a.connection_status,
        current: money(a.current_cents, a.balance_read_at), available: money(a.available_cents, a.balance_read_at),
        balance_read_at: a.balance_read_at,
      })),
    });
  });

  r.get('/transactions', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const q = (k: string) => c.req.query(k) || null;
    const entity = q('entity'); const account = q('account'); const from = q('from'); const to = q('to'); const match = q('match');
    if (entity && !isEntityKey(entity)) return c.json({ code: 'unknown_entity', detail: 'No such Axal entity.' }, 400);
    if ((from && !day(from)) || (to && !day(to))) return c.json({ code: 'invalid_date', detail: 'Dates are YYYY-MM-DD.' }, 400);
    if (match && match !== 'none' && !(MATCH_STATES as readonly string[]).includes(match)) return c.json({ code: 'invalid_match_filter', detail: 'Unknown match filter.' }, 400);
    if (account && !/^[a-f0-9]{32}$/.test(account)) return c.json({ code: 'invalid_account', detail: 'Unknown account.' }, 400);
    const page = Math.max(1, Math.min(10_000, Number.parseInt(q('page') || '1', 10) || 1));
    const binds = [entity, entity, account, account, from, from, to, to, match, match, match];
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id LEFT JOIN mercury_matches m ON m.transaction_id = t.id AND m.state <> 'rejected'
       WHERE (? IS NULL OR a.entity_key = ?) AND (? IS NULL OR a.uid = ?)
        AND (? IS NULL OR t.created_on >= ?) AND (? IS NULL OR t.created_on <= ?)
        AND (? IS NULL OR (? = 'none' AND m.id IS NULL) OR m.state = ?)`,
    ).bind(...binds).first<{ n: number }>();
    const rows = (await c.env.DB.prepare(
      `SELECT t.uid, t.amount_cents, t.created_on, t.posted_on, t.counterparty_name, t.memo, t.status, t.kind,
              a.uid AS account_uid, a.entity_key, a.last_four,
              m.uid AS match_uid, m.state AS match_state, m.target_kind, m.target_id
         FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id LEFT JOIN mercury_matches m ON m.transaction_id = t.id AND m.state <> 'rejected'
       WHERE (? IS NULL OR a.entity_key = ?) AND (? IS NULL OR a.uid = ?)
        AND (? IS NULL OR t.created_on >= ?) AND (? IS NULL OR t.created_on <= ?)
        AND (? IS NULL OR (? = 'none' AND m.id IS NULL) OR m.state = ?)
        ORDER BY t.created_on DESC, t.id DESC LIMIT ? OFFSET ?`,
    ).bind(...binds, TRANSACTIONS_PAGE, (page - 1) * TRANSACTIONS_PAGE).all<any>()).results || [];
    if (!await auditRead(c.env, user, 'mercury_transactions_read', { entity, account, from, to, match, page, rows: rows.length })) return c.json(AUDIT_UNAVAILABLE, 503);
    return c.json({
      ok: true, page, page_size: TRANSACTIONS_PAGE, total: Number(total?.n ?? 0),
      items: rows.map((t) => ({
        uid: t.uid, account_uid: t.account_uid, entity_key: t.entity_key, last_four: t.last_four,
        amount_cents: Number(t.amount_cents), created_on: t.created_on, posted_on: t.posted_on,
        counterparty_name: t.counterparty_name, memo: t.memo, status: t.status, kind: t.kind,
        match: t.match_uid ? { uid: t.match_uid, state: t.match_state, target_kind: t.target_kind, target_id: Number(t.target_id) } : null,
      })),
    });
  });

  r.get('/matches', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const state = c.req.query('state') || null;
    if (state && !(MATCH_STATES as readonly string[]).includes(state)) return c.json({ code: 'invalid_state', detail: 'Unknown match state.' }, 400);
    const rows = (await c.env.DB.prepare(
      `SELECT m.uid, m.target_kind, m.target_id, m.state, m.origin, m.amount_cents, m.proposed_at, m.confirmed_at,
              m.rejected_at, m.reason, m.receipt_id, t.uid AS transaction_uid, t.posted_on, t.counterparty_name,
              a.entity_key, a.last_four
         FROM mercury_matches m JOIN mercury_transactions t ON t.id = m.transaction_id JOIN mercury_accounts a ON a.id = t.account_id
        WHERE (? IS NULL OR m.state = ?) ORDER BY m.id DESC LIMIT 200`,
    ).bind(state, state).all<any>()).results || [];
    if (!await auditRead(c.env, user, 'mercury_matches_read', { state, rows: rows.length })) return c.json(AUDIT_UNAVAILABLE, 503);
    return c.json({ ok: true, items: rows });
  });

  const answer = (c: C, out: { ok: true } | { ok: false; status: 400 | 404 | 409; code: string; detail: string }, extra: Record<string, unknown> = {}) =>
    out.ok ? c.json({ ...out, ...extra }) : c.json({ code: out.code, detail: out.detail }, out.status);

  r.post('/matches', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const out = await proposeManual(c.env, user as User, body, opts.match);
    if (out.ok) await logAdminAction(c.env, user.id, user.email, 'mercury_match_proposed', { match_uid: out.uid, target_kind: body.target_kind, target_id: Number(body.target_id) });
    return out.ok ? c.json(out, 201) : answer(c, out);
  });

  r.post('/matches/:uid/confirm', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const uid = c.req.param('uid');
    const out = await confirmMatch(c.env, user as User, uid, opts.match);
    if (out.ok) await logAdminAction(c.env, user.id, user.email, 'mercury_match_confirmed', { match_uid: uid, receipt_id: out.receipt_id });
    return answer(c, out);
  });

  r.post('/matches/:uid/reject', async (c) => {
    const user = await requireMercuryReader(c); if (user instanceof Response) return user;
    const uid = c.req.param('uid');
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    const out = await rejectMatch(c.env, user as User, uid, body.reason);
    if (out.ok) await logAdminAction(c.env, user.id, user.email, 'mercury_match_rejected', { match_uid: uid });
    return answer(c, out);
  });

  return r;
}

export default createAdminMercury();
