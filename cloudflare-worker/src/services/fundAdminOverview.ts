/**
 * D714 (#1779) decision 9 — `GET /api/fund-admin/overview`, the console's
 * first screen: per Axal entity, its Mercury connection and accounts; per
 * administered fund, its call totals, the latest fee period, the report drafts
 * waiting and the bank matches to review.
 *
 * IT READS STORES ONLY. Nothing here imports `services/mercury/client.ts`,
 * calls Mercury, decrypts a token or reads a bank number: the accounts are
 * the rows #1775's sync wrote, shown as "ending NNNN", and #1773's registry
 * is counted, never read. No connection's `credentials_enc` or
 * `token_preview` and no account number, routing number, counterparty or
 * memo leaves this file.
 *
 * IT IS AUDITED FIRST. The balances are an admin read of entity connections,
 * so #1775's fail-closed `auditRead` row is written before any figure is
 * read; when it cannot be written the route answers 503 with no figures
 * (`AUDIT_UNAVAILABLE`).
 *
 * EACH BLOCK STANDS ALONE. `entities`, `funds`, `fees`, `drafts` and
 * `matches` each carry `state`: `ok`, or `unreadable` when its own store
 * failed, so one missing table does not blank the page. Inside a block, a
 * value nobody has recorded is `not_recorded` with its reason, never 0.
 *
 * It reads entity connections only, never a member's personal Mercury
 * (#1778), so no member's own bank reaches fund administration.
 */
import type { Env, User } from '../types';
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';
import { AUDIT_UNAVAILABLE, auditRead } from './mercury/access';
import { administeredFunds } from './fundReportBuild';
import { readFundCalls } from './fundCallLedger';

/**
 * The four entities in #1775's order. Not imported from `mercury/store.ts`:
 * D710 decision 11 keeps that module's importers to Mercury's own files, and
 * `mercury_read_only_d710.test.mjs` holds it there.
 */
const ENTITY_KEYS: readonly AxalEntityKey[] = Object.freeze(['holdings', 'management', 'gp', 'fund']);

type BlockState = 'ok' | 'unreadable';
type Block<T> = { state: BlockState; items: T[] };

const NO_CONNECTION = 'No Mercury connection';
const NO_ACCOUNT = 'No bank account yet';

/** One store's read: its rows, or `unreadable` when the store failed. */
async function block<T>(name: string, read: () => Promise<T[]>): Promise<Block<T>> {
  try {
    return { state: 'ok', items: await read() };
  } catch (e) {
    console.warn('[fundAdminOverview] block unreadable', name, (e as Error).message);
    return { state: 'unreadable', items: [] };
  }
}

const rows = async <T>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> => {
  const res = await env.DB.prepare(sql).bind(...binds).all<T>();
  if (res && (res as any).success === false) throw new Error('read failed');
  return (res?.results || []) as T[];
};

async function entities(env: Env) {
  const connections = await rows<any>(env,
    `SELECT id, entity_key, status, mercury_org_name, last_synced_at, last_error, last_error_at
       FROM mercury_entity_connections WHERE status <> 'disconnected'`);
  const accounts = await rows<any>(env,
    `SELECT a.uid, a.connection_id, a.entity_key, a.kind, a.last_four, a.nickname, a.status,
            a.current_cents, a.available_cents, a.balance_read_at
       FROM mercury_accounts a
       JOIN mercury_entity_connections c ON c.id = a.connection_id AND c.status <> 'disconnected'
      ORDER BY a.entity_key, a.id`);
  // #1773's registry, counted: whether each entity has an account to be paid into.
  const registry = await rows<{ entity_key: string; n: number }>(env,
    `SELECT entity_key, COUNT(*) AS n FROM entity_bank_accounts WHERE status = 'active' GROUP BY entity_key`);
  return ENTITY_KEYS.map((key: AxalEntityKey) => {
    const conn = connections.find((r) => r.entity_key === key) || null;
    const own = conn ? accounts.filter((a) => Number(a.connection_id) === Number(conn.id)) : [];
    const reason = !conn ? NO_CONNECTION : own.length === 0 ? NO_ACCOUNT : null;
    return {
      entity_key: key,
      name: AXAL_ENTITIES[key].name,
      state: reason ? 'not_recorded' : 'ok',
      reason,
      connection: conn ? {
        status: conn.status,
        org_name: conn.mercury_org_name ?? null,
        last_synced_at: conn.last_synced_at ?? null,
        last_error: conn.last_error ?? null,
        last_error_at: conn.last_error_at ?? null,
      } : null,
      accounts: own.map((a) => ({
        uid: a.uid,
        kind: a.kind,
        ending: a.last_four,
        nickname: a.nickname ?? null,
        status: a.status ?? null,
        current_cents: a.current_cents == null ? null : Number(a.current_cents),
        available_cents: a.available_cents == null ? null : Number(a.available_cents),
        balance_read_at: a.balance_read_at ?? null,
      })),
      payment_accounts: Number(registry.find((r) => r.entity_key === key)?.n ?? 0),
    };
  });
}

async function funds(env: Env, list: Array<{ id: number; name: string }>, today: string) {
  const out = [];
  for (const f of list) {
    const { summary, calls, unnumbered } = await readFundCalls(env, Number(f.id), today);
    const lines = [...calls.flatMap((call: any) => call.lines), ...unnumbered];
    const open = lines.filter((l: any) => l.state !== 'paid');
    const due = open.map((l: any) => l.due_date).filter((d: unknown): d is string => typeof d === 'string' && d >= today).sort();
    out.push({
      fund_id: Number(f.id),
      name: f.name,
      committed_cents: summary.committed_cents,
      called_cents: summary.called_cents,
      received_cents: summary.received_cents,
      outstanding_cents: summary.outstanding_cents,
      overdue_lines: open.filter((l: any) => l.state === 'overdue').length,
      next_due_date: due[0] ?? null,
    });
  }
  return out;
}

async function fees(env: Env, list: Array<{ id: number }>) {
  const periods = await rows<any>(env,
    `SELECT p.fund_id, p.quarter, p.status, p.net_cents, p.issued_at
       FROM fund_fee_periods p
      WHERE p.quarter = (SELECT MAX(q.quarter) FROM fund_fee_periods q WHERE q.fund_id = p.fund_id)`);
  return list.map((f) => {
    const p = periods.find((r) => Number(r.fund_id) === Number(f.id));
    return p
      ? { fund_id: Number(f.id), state: 'ok', reason: null, quarter: p.quarter, status: p.status, net_cents: Number(p.net_cents), issued_at: p.issued_at ?? null }
      : { fund_id: Number(f.id), state: 'not_recorded', reason: 'No fee period yet', quarter: null, status: null, net_cents: null, issued_at: null };
  });
}

async function drafts(env: Env, list: Array<{ id: number }>) {
  const counts = await rows<{ fund_id: number | null; entity_key: string | null; status: string; n: number }>(env,
    `SELECT fund_id, entity_key, status, COUNT(*) AS n FROM fund_report_drafts
      WHERE status IN ('draft', 'prepared') GROUP BY fund_id, entity_key, status`);
  const sum = (pick: (r: typeof counts[number]) => boolean, status: string) =>
    counts.filter((r) => pick(r) && r.status === status).reduce((s, r) => s + Number(r.n), 0);
  return [
    ...list.map((f) => ({
      fund_id: Number(f.id), entity_key: null,
      draft: sum((r) => Number(r.fund_id) === Number(f.id), 'draft'),
      prepared: sum((r) => Number(r.fund_id) === Number(f.id), 'prepared'),
    })),
    ...ENTITY_KEYS.map((key) => ({
      fund_id: null, entity_key: key,
      draft: sum((r) => r.fund_id == null && r.entity_key === key, 'draft'),
      prepared: sum((r) => r.fund_id == null && r.entity_key === key, 'prepared'),
    })),
  ];
}

async function matches(env: Env, list: Array<{ id: number }>) {
  // A match's fund: a call line's LP's fund, or the fee period's fund.
  const counts = await rows<{ fund_id: number | null; state: string; n: number }>(env,
    `SELECT COALESCE(lp.fund_id, fp.fund_id) AS fund_id, m.state, COUNT(*) AS n
       FROM mercury_matches m
       LEFT JOIN capital_calls cc ON m.target_kind = 'capital_call_line' AND cc.id = m.target_id
       LEFT JOIN limited_partners lp ON lp.id = cc.limited_partner_id
       LEFT JOIN fund_fee_periods fp ON m.target_kind = 'fee_period' AND fp.id = m.target_id
      WHERE m.state IN ('proposed', 'needs_review')
      GROUP BY COALESCE(lp.fund_id, fp.fund_id), m.state`);
  const of = (id: number, state: string) =>
    counts.filter((r) => Number(r.fund_id) === id && r.state === state).reduce((s, r) => s + Number(r.n), 0);
  return list.map((f) => ({ fund_id: Number(f.id), proposed: of(Number(f.id), 'proposed'), needs_review: of(Number(f.id), 'needs_review') }));
}

export type FundAdminOverview = {
  as_of: string;
  entities: Block<Awaited<ReturnType<typeof entities>>[number]>;
  funds: Block<Awaited<ReturnType<typeof funds>>[number]>;
  fees: Block<Awaited<ReturnType<typeof fees>>[number]>;
  drafts: Block<Awaited<ReturnType<typeof drafts>>[number]>;
  matches: Block<Awaited<ReturnType<typeof matches>>[number]>;
};

/**
 * The overview, or `null` when its audit row could not be written (the route
 * then answers `AUDIT_UNAVAILABLE`, 503). The caller has passed the reader's
 * gate.
 */
export async function fundAdminOverview(env: Env, user: User, today: string): Promise<FundAdminOverview | null> {
  if (!await auditRead(env, user, 'mercury_accounts_read', { surface: 'fund_admin.overview' })) return null;
  const administered = await block('administered funds', () => administeredFunds(env));
  const list = administered.items;
  const fundsBlock = administered.state === 'ok' ? await block('funds', () => funds(env, list, today)) : administered as Block<never>;
  const scoped = <T>(name: string, read: () => Promise<T[]>) =>
    administered.state === 'ok' ? block(name, read) : Promise.resolve({ state: 'unreadable', items: [] } as Block<T>);
  return {
    as_of: today,
    entities: await block('entities', () => entities(env)),
    funds: fundsBlock,
    fees: await scoped('fees', () => fees(env, list)),
    drafts: await block('drafts', () => drafts(env, list)),
    matches: await scoped('matches', () => matches(env, list)),
  };
}

export { AUDIT_UNAVAILABLE };
