/**
 * D710 (#1775) — the shared fixture for the Mercury tests.
 *
 * A real `node:sqlite` database: the users, sessions and audit tables and the
 * fund tables cut from schema_baseline.sql, then migrations 312 (the call
 * ledger), 472 (#1773's bank-account registry), 473 (#1774's fee periods),
 * 474 (Mercury) and 483 (D749's Not ours marks).
 * `withRegistry()` inserts registry rows that satisfy 472's checks.
 *
 * Every Mercury call goes to `mercuryStub`, which records each request. Every
 * account number, digit run and token here is invented; the last fours are
 * none of the six real ones in #1773's table.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, stepUpRefusalBody } from '../src/util/authErrors.ts';
import { createAdminMercury, type AdminMercuryOptions } from '../src/routes/admin_mercury.ts';

export const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
export const TOKEN = 'fixture-not-a-token-1';
export const TOKEN_2 = 'fixture-not-a-token-2';

export const SUPER = 901, ADMIN = 902, FOUNDER = 903, PARTNER = 904, INVESTOR = 905, ADVISOR = 906, EXPLORING = 907, FUND_ADMIN = 908;
export const ROLES: Record<number, string> = {
  [SUPER]: 'admin', [ADMIN]: 'admin', [FOUNDER]: 'founder', [PARTNER]: 'partner', [INVESTOR]: 'investor',
  [ADVISOR]: 'advisor', [EXPLORING]: 'exploring', [FUND_ADMIN]: 'investor',
};
/** Session ids: a fresh TOTP session, a stale one, and a session minted by SMS. */
export const JTI = { superFresh: 'totp-super', superStale: 'totp-stale-super', adminTotp: 'totp-admin', adminSms: 'sms-admin' };

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const noFks = (sql: string) => sql.replace(/\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi, '');

export function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'capital_calls', 'limited_partners', 'vc_funds']) {
    db.exec(noFks(tableFromBaseline(BASELINE, t)));
  }
  db.exec(migration('312_fund_call_ledger.sql'));
  db.exec(migration('473_fund_management_fees.sql'));
  db.exec(migration('472_entity_bank_accounts.sql'));
  db.exec(migration('473_fund_management_fees.sql'));
  db.exec(migration('474_mercury_entity_connections.sql'));
  db.exec(migration('483_mercury_not_ours.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const [id, role] of Object.entries(ROLES)) u.run(Number(id), role, `User ${id}`, `user${id}@example.test`);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now', ?))");
  s.run(SUPER, JTI.superFresh, 'totp', '+0 seconds');
  s.run(SUPER, JTI.superStale, 'totp', '-2 days');
  s.run(ADMIN, JTI.adminTotp, 'totp', '+0 seconds');
  s.run(ADMIN, JTI.adminSms, 'sms', '+0 seconds');
  return db;
}

/** #1773's registry, as the stand-in described above. */
export function withRegistry(db: DatabaseSync, rows: Array<[entity: string, kind: string, last4: string]>): void {
  const ins = db.prepare(`INSERT INTO entity_bank_accounts (uid, entity_key, label, bank_name, bank_address, beneficiary_name,
    beneficiary_address, account_kind, account_number_enc, account_last4, routing_number, recorded_by)
    VALUES (?, ?, ?, 'Fixture Bank', '1 Fixture Way', 'Fixture Beneficiary', '2 Fixture Way', ?, 'v1.fixture-not-ciphertext', ?, '000000000', ?)`);
  rows.forEach(([e, k, l], i) => ins.run(`reg-${randomUUID()}`, e, `Fixture ${i}`, k, l, SUPER));
}

/* ── the Mercury stub ─────────────────────────────────────────────────────── */

export interface StubTxn { id: string; amount: unknown; createdAt: string; postedAt?: string | null; status?: string; kind?: string;
  counterpartyName?: string; externalMemo?: string; currency?: string; [k: string]: unknown }
export interface StubState {
  accounts: Array<Record<string, unknown>>;
  org: Record<string, unknown>;
  txns: Record<string, StubTxn[]>;
  /** Answer every call with this status (a 401, a 302…) instead. */
  status?: number;
}
export interface StubCall { url: string; method: string; redirect: string | undefined; hasBody: boolean; auth: string | null }

export function mercuryStub(state: StubState) {
  const calls: StubCall[] = [];
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers as HeadersInit);
    calls.push({ url, method: String(init.method || 'GET').toUpperCase(), redirect: init.redirect, hasBody: init.body != null, auth: headers.get('Authorization') });
    if (state.status) return new Response('{"error":"stub"}', { status: state.status, headers: state.status >= 300 && state.status < 400 ? { Location: 'https://elsewhere.example/' } : {} });
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v1/, '');
    if (path === '/accounts') return Response.json({ accounts: state.accounts });
    if (path === '/organization') return Response.json(state.org);
    const m = /^\/account\/([^/]+)\/transactions$/.exec(path);
    if (m) {
      const start = u.searchParams.get('start') || '0000-00-00';
      const limit = Number(u.searchParams.get('limit') || 500);
      const offset = Number(u.searchParams.get('offset') || 0);
      const all = (state.txns[m[1]] || []).filter((t) => t.createdAt.slice(0, 10) >= start)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return Response.json({ total: all.length, transactions: all.slice(offset, offset + limit) });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

/** An invented account: a twelve-digit number whose last four is `last4`. */
export function account(id: string, kind: string, last4: string, extra: Record<string, unknown> = {}) {
  return { id, accountNumber: `90817263${last4}`, routingNumber: '000000017', kind, nickname: `${kind} ${last4}`, status: 'active',
    currentBalance: 1234.56, availableBalance: 1200, legalBusinessName: 'Axal VC GP LLC', ...extra };
}

/* ── the router, behind production's error table ──────────────────────────── */

export function appFor(opts: AdminMercuryOptions = {}) {
  const a = new Hono<any>();
  a.route('/api/admin/mercury', createAdminMercury(opts));
  a.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(err), 403);
    const s = AUTH_ERROR_STATUSES[msg];
    if (s) return c.json({ detail: msg }, s);
    throw err;
  });
  return a;
}

export async function tokenFor(user: number, opts: { jti?: string; impersonated?: boolean } = {}): Promise<string> {
  return new SignJWT({ user_id: user, role: ROLES[user], ...(opts.jti ? { jti: opts.jti } : {}), ...(opts.impersonated ? { impersonated_by: SUPER } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

export function envFor(db: DatabaseSync, extra: Record<string, unknown> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra } as any;
}

export async function call(app: Hono<any>, env: any, method: string, path: string, as: number,
  opts: { jti?: string; impersonated?: boolean; body?: unknown } = {}) {
  const res = await app.request(`/api/admin/mercury${path}`, {
    method,
    headers: { Authorization: `Bearer ${await tokenFor(as, opts)}`, 'Content-Type': 'application/json' },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  }, env);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text, headers: res.headers };
}

export const rows = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];
export const one = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;

/** Wait for the first sync a connect starts in `waitUntil`, so a snapshot taken after it is stable. */
export async function settled(db: DatabaseSync): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const running = (db.prepare("SELECT COUNT(*) AS n FROM mercury_sync_runs WHERE status = 'running'").get() as any).n;
    const started = (db.prepare('SELECT COUNT(*) AS n FROM mercury_sync_runs').get() as any).n;
    const conns = (db.prepare("SELECT COUNT(*) AS n FROM mercury_entity_connections WHERE status <> 'disconnected'").get() as any).n;
    if (!running && started >= Math.min(conns, 1)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}
