/**
 * D840 part 3 (#2348): the Grow feeds' world, shared by
 * `mercury_grow_d840.test.ts` and D882's `mercury_grow_raise_mcp_d882.test.ts`.
 * Real SQL on node:sqlite, real JWT routes, part 1's fake MCP server; every
 * name, id and amount is invented.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { signedInFake, FAKE_ACC_A, fakeTx } from './_mercury_mcp_fake.mjs';
import { openMercuryReads } from '../src/services/mercury/reads.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { landGrow, readGrow } from '../src/services/mercury/growFeeds.ts';

const here = dirname(fileURLToPath(import.meta.url));
const M = resolve(here, '../sql/migrations');
const file = (p: string) => readFileSync(resolve(M, readdirSync(M).find((f) => f.startsWith(`${p}_`))!), 'utf8');
const ddl = (p: string) => file(p).split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim())
  .filter((x) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(x)).map((x) => `${x};`).join('\n');

export const TODAY = '2026-10-21';
export const PID = 7;
export const INTEGRATION = 41;
export const FOUNDER = 1;
export const COFOUNDER = 2;
export const ADMIN = 3;
export const PARTNER = 4;
export const ADVISOR = 5;
export const INVESTOR = 6;
export const viewers = {
  founder: { id: FOUNDER, founder_id: 10 }, cofounder: { id: COFOUNDER, founder_id: 11 }, admin: { id: ADMIN, founder_id: null },
  partner: { id: PARTNER, founder_id: null }, advisor: { id: ADVISOR, founder_id: 12 }, investor: { id: INVESTOR, founder_id: null },
};

export async function growDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = readFileSync(resolve(here, '../sql/schema_baseline.sql'), 'utf8');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, deleted_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
           CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, project_id INTEGER, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT, actor TEXT);
           CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER, email TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')));
           CREATE TABLE spinout_lab_milestones (id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT);`);
  for (const t of ['partners', 'raise_prospects', 'deals', 'commitments', 'entities', 'compliance_events']) db.exec(tableFromBaseline(baseline, t));
  for (const p of ['034', '119', '127', '132', '326']) db.exec(ddl(p));
  db.exec(ddl('125')); db.exec(file('437'));
  db.exec(file('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(file('443'));
  db.exec(file('462'));
  db.exec(file('507'));
  db.exec(file('445'));
  db.exec(file('477'));
  db.exec(file('490'));
  const env = { JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  env.KEK_PII = 'fixture-cipher-key-'.repeat(4);
  await ensureIntegrationsSchema(env);
  await ensureProjectMetricsSchema(env);
  db.exec(file('521'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  u.run(COFOUNDER, 'founder', 11, 'Cole', 'cole@co.example');
  u.run(ADMIN, 'admin', null, 'Ann', 'ann@axal.example');
  u.run(PARTNER, 'partner', null, 'Pat', 'pat@axal.example');
  u.run(ADVISOR, 'founder', 12, 'Ada', 'ada@else.example');
  u.run(INVESTOR, 'investor', null, 'Ivy', 'ivy@fund.example');
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'investor', 'accepted')`).run(PID, INVESTOR);
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, 'p7', 'Venture', 10, 70)`).run(PID);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (70, ?)').run(COFOUNDER);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')`).run(PID, ADVISOR);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')`).run(PID, COFOUNDER);
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (?, 'mi', ?, 'mercury', 'active', 'oauth_mcp')`).run(INTEGRATION, FOUNDER);
  db.prepare(`INSERT INTO partners (name, email, company, status) VALUES ('Pat', 'pat@axal.example', 'Brightlane Advisory LLC', 'active')`).run();
  db.prepare(`INSERT INTO growth_channels (uid, project_id, name, utm_source) VALUES ('ch-google', ?, 'Google Ads', 'google')`).run(PID);
  for (const name of ['Ena', 'Eli']) {
    db.prepare(`INSERT INTO company_people (uid, company_id, name, person_type, status, created_by) VALUES (?, 70, ?, 'employee', 'active', 1)`).run(`cp-${name}`, name);
  }
  db.prepare(`INSERT INTO contacts (uid, project_id, name, email, audience, utm_json, created_at) VALUES ('ct1', ?, 'Buyer', 'buyer@else.example', 'customer', '{"utm_source":"google"}', '2026-09-20 10:00:00')`).run(PID);
  return { db, env };
}

let n = 0;
const tx = (amount: number, on: string, counterparty: string, extra: Record<string, unknown> = {}) => ({
  id: fakeTx(++n), accountId: FAKE_ACC_A, amount, counterpartyName: counterparty, createdAt: `${on}T09:00:00Z`, postedAt: `${on}T12:00:00Z`,
  status: 'sent', kind: 'externalTransfer', ...extra,
});

/** Three full months of a small venture's lines, an invoice paid in September, and a partner paid in August. */
export function growFake() {
  const s = signedInFake();
  n = 0;
  s.fake.state.data.transactions = [
    ...['2026-07', '2026-08', '2026-09'].flatMap((m) => [
      tx(-8000, `${m}-15`, 'Gusto'),
      tx(-1000, `${m}-10`, 'Google Ads', { mercuryCategory: 'Advertising' }),
      tx(-1000, `${m}-01`, 'Landlord Co', { mercuryCategory: 'Facilities Expenses' }),
    ]),
    tx(3000, '2026-07-20', 'Other Customer'),
    tx(3000, '2026-08-20', 'Other Customer'),
    tx(2500, '2026-09-05', 'Customer Co'),
    tx(-1500, '2026-08-03', 'Brightlane Advisory, LLC'),
    tx(-700, '2026-09-28', 'Pending Vendor', { status: 'pending', postedAt: null }),
  ];
  return s;
}

export async function syncOnce(env: any, s = growFake()) {
  const reads = await openMercuryReads({ accessToken: s.accessToken, fetcher: s.fake.fetch });
  const read = await readGrow(env, reads, FOUNDER, TODAY);
  return { counts: await landGrow(env, INTEGRATION, { id: PID, founder_user_id: FOUNDER }, read, TODAY), fake: s.fake, read };
}


const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
export const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [ADVISOR]: 'founder', [INVESTOR]: 'investor' };
export async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json() as any };
}

/** The founder's row as a sign-in leaves it: the fake's access token, encrypted. */
export async function signedInRow(db: any, env: any, s: { accessToken: string }) {
  const enc = await encryptCredentials(env, 'mi', { access_token: s.accessToken, expires_at: null, scopes: ['read', 'offline_access'], issuer: 'https://mcp.mercury.com', client_key: 'fake-client' } as any);
  db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(enc, INTEGRATION);
}
