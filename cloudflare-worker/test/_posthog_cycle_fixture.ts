/**
 * D1605 (#3731) — the PostHog cycle tests' fixture: the baseline plus every
 * numbered migration above the cutoff, schema only; a founder, a cofounder,
 * another founder and an admin; one venture in company 77 with an active
 * PostHog connection switched on for it and linked to `PROJECT_A`; and the
 * real routes over `_posthog_mcp_fake.mjs`. Every value is invented.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { createPosthogCycleRouter, createPosthogRouter } from '../src/routes/posthog.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { INSIGHT_A, PROJECT_A, POSTHOG_MCP_URL, posthogFake } from './_posthog_mcp_fake.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

export const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
export const FOUNDER = 10, COFOUNDER = 11, OTHER = 20, ADMIN = 30;
export const P = 1, P_OTHER = 2, COMPANY = 77, PH = 40;
export const TODAY = Date.parse('2026-10-31T12:00:00Z');

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

export async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', 1003);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  add.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${P}, 'Kestrel Labs', 1001, ${COMPANY}), (${P_OTHER}, 'Beta Works', 1002, 88)`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COFOUNDER}, 'cofounder', 'accepted')`);
  db.exec(`INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('u1', ${COMPANY}, ${FOUNDER}), ('u2', ${COMPANY}, ${COFOUNDER}), ('u3', 88, ${OTHER})`);
  const fake = posthogFake();
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const uid = 'int-posthog-fixture-0001';
  const creds = { access_token: fake.signedIn(), client_key: 'mcp_client:posthog:fixture', resource: POSTHOG_MCP_URL, scopes: ['insight:read'], expires_at: Date.now() + 3_600_000 };
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (?, ?, ?, 'posthog', 'active', 'oauth_mcp', ?)")
    .run(PH, uid, FOUNDER, await encryptCredentials(env, uid, creds));
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(PH, COMPANY);
  db.prepare('INSERT INTO posthog_project_links (uid, integration_id, project_id, posthog_project_id, posthog_project_name, region, linked_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('link-1', PH, P, PROJECT_A, 'Lumen web app', 'EU', FOUNDER);
  return { db, env, fake, uid };
}

export function appFor(fake: any) {
  const app = new Hono<any>();
  app.route('/api/connectors', createPosthogRouter({ fetcher: fake.fetch }));
  app.route('/api/cycles', createPosthogCycleRouter({ fetcher: fake.fetch }));
  app.onError((e: any, c) => c.json({ detail: String(e?.message || '') }, 500));
  return app;
}

export async function call(app: Hono<any>, env: any, who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const role = who === ADMIN ? 'admin' : 'founder';
  const token = await new SignJWT({ user_id: who, role, ...extra }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }, env));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

export async function tracked(app: Hono<any>, env: any, role = 'active_users', module = 'revenue_and_traction', section = 'grow') {
  const r = await call(app, env, FOUNDER, 'POST', `/api/cycles/${section}/posthog/tracked`, { project: P, module, insight_short_id: INSIGHT_A, role });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.tracked as { uid: string; kpi: string; unit: string };
}

