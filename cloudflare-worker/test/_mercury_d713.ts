/** Minimal PR A fixtures: no entity bank tables or provider calls. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
export const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
export function ddl(db: any, name: string) {
  const start = baseline.indexOf(`CREATE TABLE ${name} (`);
  db.exec(baseline.slice(start, baseline.indexOf(');', start) + 2));
}
export function fixture(migrate = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log']) ddl(db, t);
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, user_id INTEGER, company_id INTEGER);
    CREATE TABLE integrations (id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, status TEXT, credentials_enc TEXT, config_json TEXT, updated_at TEXT, last_error TEXT, last_error_at TEXT, last_synced_at TEXT);
    INSERT INTO users (id, role, name, email, founder_id, partner_id) VALUES
    (1, 'admin', 'Holder', 'holder@example.test', NULL, NULL), (2, 'admin', 'Admin', 'admin@example.test', NULL, NULL),
    (10, 'founder', 'Founder', 'founder@example.test', 100, NULL), (20, 'partner', 'Partner', 'partner@example.test', NULL, 200),
    (21, 'partner', 'Other', 'other@example.test', NULL, 201), (30, 'investor', 'Investor', 'investor@example.test', NULL, NULL);
    INSERT INTO super_admins (user_id) VALUES (1);
    INSERT INTO projects VALUES (1, 'Venture', 100, NULL), (2, 'Second', 100, NULL);
    INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES
      (1, 'fresh', 'totp', datetime('now')), (1, 'stale', 'totp', datetime('now', '-2 days')),
      (2, 'plain-totp', 'totp', datetime('now', '-2 days')), (2, 'plain-password', 'password', datetime('now'));
  `);
  for (const m of ['028_partner_deals.sql', '311_revenue_entries.sql', '400_revenue_stripe_charge_index.sql']) db.exec(mig(m));
  db.exec("INSERT INTO partner_deals (id,user_id,deal_type,proposal_json,status) VALUES (1,20,'custom','{}','active'), (2,21,'custom','{}','active'), (3,20,'custom','{}','proposed')");
  if (migrate) db.exec(mig('477_mercury_personal.sql'));
  return { db, env: { DB: d1Over(db), JWT_SECRET: crypto.randomUUID(), ENVIRONMENT: 'development' } as any };
}
export async function call(router: any, env: any, path: string, who = 2, method = 'GET', body?: any, jti?: string) {
  const jwt = await new SignJWT({ user_id: who, ...(jti ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const app = new Hono<any>(); app.route('/', router);
  app.onError((e, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: res.status, body: await res.json() as any };
}
export const draft = { partner_deal_id: 1, kind: 'revenue_share', direction: 'to_member', amount_cents: 5000, due_on: '2026-10-01', memo: 'Signed deal' };
export function match(db: any, target: string, id: number, state = 'confirmed', transaction = 'txn-a') {
  db.prepare(`INSERT INTO mercury_personal_matches (uid,user_id,integration_id,mercury_transaction_id,account_last_four,amount_cents,posted_on,target_kind,target_id,state) VALUES (?,20,9,?,'4242',5000,'2026-10-02',?,?,?)`).run(crypto.randomUUID(),transaction,target,id,state);
}
