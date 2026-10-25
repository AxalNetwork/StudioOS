import { raiseEvidenceTables } from './_raise_evidence_fixture.ts';
/**
 * D840 part 2 (#2347): the Raise feeds' world, shared by
 * `mercury_raise_feeds_d840.test.ts` and D882's `mercury_grow_raise_mcp_d882.test.ts`.
 * Real SQL on node:sqlite, real JWT routes, part 1's fake MCP server; every
 * name, id and amount is invented.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import raise from '../src/routes/cycle_raise.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { addColumnsFrom, tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { personalMatchTables } from './_mercury_d713.ts';
import { memR2 } from './_channels_fixture.ts';
import { FAKE_ACC_A, ISSUER, fakeTx, signedInFake } from './_mercury_mcp_fake.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
export const TODAY = '2026-10-21';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const mig = (n: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${n}`), 'utf8');

// ───────────────────────────────────────────── invented Mercury data

export const tx = (n: number, amount: number, postedAt: string, o: Record<string, unknown> = {}) => ({
  id: fakeTx(n), accountId: FAKE_ACC_A, amount, createdAt: `${postedAt}T09:00:00Z`, postedAt: `${postedAt}T10:00:00Z`,
  status: 'sent', kind: 'externalTransfer', counterpartyName: 'Customer Co', ...o,
});
export const LINES = [
  tx(1, -500, '2026-09-03', { kind: 'debitCardTransaction', mercuryCategory: 'Software', counterpartyName: 'Cloud Host' }),
  tx(2, -1200, '2026-05-10', { kind: 'debitCardTransaction', mercuryCategory: 'Advertising', counterpartyName: 'Ad Network' }),
  tx(3, -300, '2026-01-10', { kind: 'debitCardTransaction', mercuryCategory: 'Gardening', counterpartyName: 'Plants' }),
  tx(4, 2000, '2026-08-12'),
  tx(5, 3000, '2026-09-12'),
  tx(6, 50000, '2026-09-20', { kind: 'incomingDomesticWire', counterpartyName: 'Harbour Angels LLC' }),
  tx(7, 25000, '2026-09-25', { kind: 'incomingDomesticWire', counterpartyName: 'New Fund LP' }),
  tx(8, -9999, '2026-09-26', { kind: 'internalTransfer', counterpartyName: 'Reserve' }),
  tx(9, 40000, '2026-09-27', { kind: 'incomingDomesticWire', counterpartyName: 'Already Revenue Inc' }),
];
export const STATEMENTS = { statements: [
  { id: 'stmt-2026-09', startDate: '2026-09-01', endDate: '2026-09-30', endingBalance: 1200.5, transactionCount: 3, downloadUrl: `${ISSUER}/fake-statements/stmt-2026-09.pdf` },
  // Mercury lists it but gives no link: nothing to store.
  { id: 'stmt-2026-08', startDate: '2026-08-01', endDate: '2026-08-31', endingBalance: 900, transactionCount: 2 },
] };
export const CASHFLOW = { months: ['2026-07', '2026-08', '2026-09'].map((month) => ({ month, incomingCents: 100000, outgoingCents: -200000, cashflowCents: -100000 })), truncated: false };

export function mercury() {
  const { fake, accessToken } = signedInFake();
  fake.state.data.transactions = LINES;
  fake.state.data.cashflow = CASHFLOW;
  fake.state.data.statements = STATEMENTS;
  return { fake, accessToken };
}

// ───────────────────────────────────────────── the database

export async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects', 'data_room_files',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'dd_cases', 'dd_requests', 'raise_rounds', 'esign_envelopes']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec(mig('129_captable_one_canonical_per_project.sql'));
  db.exec(mig('249_project_metrics.sql'));
  db.exec(mig('410_safe_issuances.sql'));
  db.exec(mig('442_raise_cycle_stores.sql'));
  db.exec(mig('463_raise_record_stores.sql'));
  addColumnsFrom(db, mig('441_build_cycle_stores.sql'), 'cap_table_holders');
  db.exec(`
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT, credentials_enc TEXT,
      config_json TEXT, last_error TEXT, last_error_at TEXT, updated_at TEXT);
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT, event_type TEXT, status TEXT, response_summary TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE contacts(id INTEGER PRIMARY KEY);
  `);
  db.exec(mig('311_revenue_entries.sql'));
  db.exec(mig('477_mercury_personal.sql'));
  personalMatchTables(db);
  // D1017: a Mercury SAFE's Accept lands on the record.
  for (const m of ['445_connector_fed_items.sql', '520_mercury_raise_feeds.sql', '573_cap_table_record.sql']) db.exec(mig(m));
  raiseEvidenceTables(db);
  db.exec(`
    INSERT INTO users (id, role, founder_id, name, email, is_active, subscription_tier) VALUES
      (1, 'founder', 11, 'One', 'one@example.test', 1, 'studio'), (2, 'founder', 22, 'Two', 'two@example.test', 1, 'studio'),
      (30, 'admin', NULL, 'Admin', 'admin@example.test', 1, 'studio');
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (101, 'p-101', 'Own Venture', 11, 10), (202, 'p-202', 'Other Venture', 22, 20);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20), (1, 99);
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage, amount) VALUES
      (501, 'rp-1', 101, 'Harbour Angels', 'Harbour Angels', 'diligence', 50000), (502, 'rp-2', 202, 'New Fund', 'New Fund', 'meeting', 25000);
    INSERT INTO revenue_entries (uid,project_id,customer,amount_cents,revenue_type,received_on,source,source_ref) VALUES ('synthetic-existing',101,'Synthetic customer',4000000,'one_time','2026-09-27','mercury','${fakeTx(9)}');
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'k'.repeat(48), FILES: memR2() };
  const { fake, accessToken } = mercury();
  // A sign-in's credentials as part 1's callback stores them (`oauth.ts` McpCredentials); invented.
  const signIn = { access_token: accessToken, token_type: 'Bearer', expires_at: null, scopes: ['read', 'offline_access'], issuer: 'https://mcp.mercury.com', client_key: 'fixture-client' };
  const creds = await encryptCredentials(env, 'mc-one', signIn);
  const creds2 = await encryptCredentials(env, 'mc-two', signIn);
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, credentials_enc) VALUES (41, 'mc-one', 1, 'mercury', 'oauth_mcp', ?), (42, 'mc-two', 2, 'mercury', 'oauth_mcp', ?)`)
    .run(creds, creds2);
  const one = (sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
  const all = (sql: string, ...a: any[]) => db.prepare(sql).all(...a).map((r: any) => ({ ...r }));
  return { db, env, fake, accessToken, one, all };
}

export const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/raise', raise);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
export async function call(env: any, path: string, who = 1, method = 'GET', body?: unknown, company?: string) {
  const role = who === 30 ? 'admin' : 'founder';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': company ?? (who === 2 ? '20' : '10'), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, body: json, text };
}
export const sync = (env: any, who = 1) => call(env, '/api/cycles/raise/mercury/sync?project=101', who, 'POST');
export const mod = async (env: any, slug: string, who = 1) => (await call(env, `/api/cycles/raise/modules/${slug}?project=101`, who)).body;
export const accept = (env: any, id: number, body?: unknown, who = 1) => call(env, `/api/cycles/raise/mercury/proposals/${id}/accept?project=101`, who, 'POST', body);
export const dismiss = (env: any, id: number, who = 1) => call(env, `/api/cycles/raise/mercury/proposals/${id}/dismiss?project=101`, who, 'POST');
export const proposal = (f: any, kind: string, key: string) => f.one('SELECT * FROM mercury_raise_proposals WHERE kind = ? AND source_key = ?', kind, key);

/** A sync through the fake, with the global fetch answering mcp.mercury.com. */
export async function withFake<T>(f: { fake: any }, run: () => Promise<T>): Promise<T> {
  const off = f.fake.install();
  try { return await run(); } finally { off(); }
}
