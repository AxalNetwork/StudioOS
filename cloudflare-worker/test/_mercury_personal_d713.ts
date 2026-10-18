/**
 * D713 (#1778) PR B — the shared fixture for a member's own Mercury.
 *
 * PR A's database (`_mercury_d713.ts`: users 10 founder, 20 and 21 partners,
 * 30 investor; projects 1 and 2 of founder 100), plus migrations 312, 472 and
 * 474 for decision 3's registry reads (472's `entity_bank_accounts` replaced by a
 * stand-in of the three columns personal code may read), 445 for `connector_fed_items`, and the
 * full `integrations` and `integration_logs` tables.
 *
 * Every Mercury call goes to `bank()`, a global fetch stub that records each
 * request. Ids, names and tokens are invented. No account or routing number
 * appears anywhere: an account's `accountNumber` is a masked `****` plus a
 * last four, and the last fours are none of the real ones in #1773's table.
 */
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { tableFromBaseline } from './_baseline.mjs';
import { fixture, mig } from './_mercury_d713.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import integrations from '../src/routes/integrations.ts';
import revenue from '../src/routes/revenue.ts';
import mercuryPersonal from '../src/routes/mercury_personal.ts';
import '../src/integrations/providers/mercury.ts';

export const TOKEN = 'fixture-not-a-token-3';
export const FOUR_A = '4242', FOUR_B = '1357';
export const ACC_A = 'acc-personal-a', ACC_B = 'acc-personal-b';
/** A synthetic transaction id: a UUID whose last group is `n`. */
export const tx = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const day = (offset: number) => {
  const t = new Date(); t.setUTCDate(t.getUTCDate() + offset); return t.toISOString().slice(0, 10);
};

export async function personalFixture(opts: { migrate?: boolean } = {}) {
  const { db, env } = fixture(opts.migrate ?? true);
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  for (const t of ['capital_calls', 'limited_partners', 'vc_funds']) db.exec(tableFromBaseline(baseline, t));
  for (const m of ['312_fund_call_ledger.sql', '472_entity_bank_accounts.sql', '474_mercury_entity_connections.sql', '445_connector_fed_items.sql', '435_connector_companies.sql']) db.exec(mig(m));
  // #1773's registry as a stand-in with only the three columns decision 3 may
  // read: a query naming any other column fails here, and no fixture needs a
  // routing number or a ciphertext.
  db.exec(`DROP TABLE entity_bank_accounts;
    CREATE TABLE entity_bank_accounts (id INTEGER PRIMARY KEY, entity_key TEXT NOT NULL, account_last4 TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');`);
  db.exec('DROP TABLE integrations');
  env.KEK_PII = 'fixture-cipher-key-'.repeat(4);
  await ensureIntegrationsSchema(env);
  db.exec("UPDATE users SET subscription_tier = 'growth' WHERE id = 10");
  return { db, env };
}

/** An active personal connection for `user`, stored as the connect route stores one. */
export async function connected(db: any, env: any, user: number, status = 'active') {
  const uid = `mp-${user}`;
  const enc = await encryptCredentials(env, uid, { api_key: TOKEN } as any);
  db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, external_account_id, external_account_name)
    VALUES (?, ?, 'mercury', 'Mercury', ?, 'api_key', ?, '{"read_only":"confirmed"}', 'org-own', 'Own Practice LLC')`).run(uid, user, status, enc);
  return (db.prepare('SELECT id FROM integrations WHERE uid = ?').get(uid) as any).id as number;
}

export interface Txn { id: string; amount: number; postedAt?: string | null; createdAt?: string; status?: string; kind?: string; counterpartyName?: string; currency?: string }
export interface BankState {
  org: Record<string, unknown>;
  accounts: Array<Record<string, unknown>>;
  txns: Record<string, Txn[]>;
  /** Answer every call with this status instead. */
  status?: number;
}
export interface BankCall { url: string; path: string; method: string; redirect?: string; body: boolean }

export const account = (id: string, last4: string, kind = 'checking') => ({ id, kind, accountNumber: `****${last4}`, nickname: `Own ${kind}`, status: 'active' });
export const credit = (n: number, amount: number, posted: string, counterpartyName = 'Customer Co', extra: Partial<Txn> = {}): Txn =>
  ({ id: tx(n), amount, postedAt: `${posted}T12:00:00Z`, createdAt: `${posted}T10:00:00Z`, status: 'sent', kind: 'externalTransfer', counterpartyName, ...extra });

export function defaultBank(): BankState {
  return {
    org: { id: 'org-own', legalBusinessName: 'Own Practice LLC' },
    accounts: [account(ACC_A, FOUR_A), account(ACC_B, FOUR_B, 'savings')],
    txns: { [ACC_A]: [], [ACC_B]: [] },
  };
}

/** Replace global fetch with the stub until `restore()`. Only api.mercury.com is answered. */
export function bank(state: BankState = defaultBank()) {
  const calls: BankCall[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = String(input?.url ?? input);
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v1/, '');
    calls.push({ url, path, method: String(init.method || 'GET').toUpperCase(), redirect: init.redirect as string, body: init.body != null });
    if (u.host !== 'api.mercury.com') return new Response('unexpected host', { status: 599 });
    if (state.status) return new Response('{"error":"stub"}', { status: state.status });
    if (path === '/organization') return Response.json(state.org);
    if (path === '/accounts') return Response.json({ accounts: state.accounts });
    let m = /^\/account\/([^/]+)\/transactions$/.exec(path);
    if (m) {
      const start = u.searchParams.get('start') || '0000-00-00';
      const limit = Number(u.searchParams.get('limit') || 500), offset = Number(u.searchParams.get('offset') || 0);
      const all = (state.txns[m[1]] || []).filter((t) => String(t.createdAt ?? t.postedAt).slice(0, 10) >= start);
      return Response.json({ total: all.length, transactions: all.slice(offset, offset + limit) });
    }
    m = /^\/account\/([^/]+)\/transaction\/([^/]+)$/.exec(path);
    if (m) {
      const t = (state.txns[m[1]] || []).find((x) => x.id === m![2]);
      return t ? Response.json(t) : new Response('{"error":"not found"}', { status: 404 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { state, calls, restore: () => { globalThis.fetch = real; } };
}

const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.route('/api/revenue', revenue);
app.route('/api/mercury/personal', mercuryPersonal);
app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));

export async function req(env: any, who: number, method: string, path: string, body?: unknown,
  opts: { impersonated?: boolean; branch?: boolean } = {}) {
  const role = ({ 10: 'founder', 20: 'partner', 21: 'partner', 30: 'investor', 1: 'admin', 2: 'admin' } as any)[who];
  const jwt = await new SignJWT({ user_id: who, role, ...(opts.impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const e = opts.branch ? { ...env, BRANCH_CODE: 'ldn' } : env;
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, e);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}

/** A registry row of #1773's, through the stand-in. */
export const registered = (db: any, entity: string, last4: string, status = 'active') =>
  db.prepare('INSERT INTO entity_bank_accounts (entity_key, account_last4, status) VALUES (?, ?, ?)').run(entity, last4, status);

export const count = (db: any, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);
