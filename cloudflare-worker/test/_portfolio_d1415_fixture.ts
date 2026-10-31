/**
 * D1415 (#3697, part 2) — the shared fixture for the Portfolio tests: the
 * baseline's tables, migrations 597 and 685 over them, and the routers mounted
 * as `index.ts` mounts them. Every person, company and project is made up.
 *
 * People: Ada (founder 101) is the primary admin of Northwind and a member of
 * Southwind and of the archived Oldwind. Ben (founder 102) is a plain member
 * of Northwind and a co-founder on Dock, a Southwind project. Cy (advisor) has
 * no company and a seat on Dock. Dee (founder 104) is Westwind's own. Eve is a
 * platform admin.
 *
 * Projects: Venture (Northwind, Ada's), Solo (standalone, Ada's), Dock
 * (Southwind, Ada's), Relic (Oldwind, Ada's) and Private (Westwind, Dee's).
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import companyLifecycle from '../src/routes/company_lifecycle.ts';
import companyLegal from '../src/routes/company_legal.ts';
import projectLifecycle from '../src/routes/project_lifecycle.ts';
import projects from '../src/routes/projects.ts';
import accountPortfolio from '../src/routes/account_portfolio.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
export const M685 = readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8');
// D1593 (#3861): 749 adds the registered agent and the mailing kind, which `routes/company_legal.ts` reads.
export const M749 = readFileSync(new URL('../sql/migrations/749_company_registered_agent_and_mailing.sql', import.meta.url), 'utf8');

export const ADA = 1, BEN = 2, CY = 3, DEE = 4, EVE = 5;
export const NORTH = 1, SOUTH = 2, OLD = 3, WEST = 4;
export const VENTURE = 10, SOLO = 11, DOCK = 12, RELIC = 13, PRIVATE = 14;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [CY]: 'advisor', [DEE]: 'founder', [EVE]: 'admin' };

export function fixture(opts: { migration685?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'founders', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations', 'deals', 'project_members']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_pair ON project_members (project_id, user_id)');
  db.exec(M597);
  db.exec(opts.migration685 ?? M685);
  db.exec(M749);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADA, 'founder', 'Ada Made-up', 'ada@example.test', 101);
  u.run(BEN, 'founder', 'Ben Made-up', 'ben@example.test', 102);
  u.run(CY, 'advisor', 'Cy Made-up', 'cy@example.test', null);
  u.run(DEE, 'founder', 'Dee Made-up', 'dee@example.test', 104);
  u.run(EVE, 'admin', 'Eve Made-up', 'eve@example.test', null);
  const f = db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)');
  f.run(101, 'Ada Made-up', 'ada@example.test'); f.run(102, 'Ben Made-up', 'ben@example.test'); f.run(104, 'Dee Made-up', 'dee@example.test');
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, slug, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind', 'northwind', null);
  c.run(SOUTH, 'co-south', 'Southwind', null, null);
  c.run(OLD, 'co-old', 'Oldwind', 'oldwind', '2026-05-01');
  c.run(WEST, 'co-west', 'Westwind', 'westwind', null);
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  l.run('l-1', NORTH, ADA, 'Admin', 1, '2026-01-01');
  l.run('l-2', NORTH, BEN, 'Member', 0, '2026-01-02');
  l.run('l-3', SOUTH, ADA, 'Member', 0, '2026-01-03');
  l.run('l-4', OLD, ADA, 'Admin', 1, '2026-01-04');
  l.run('l-5', WEST, DEE, 'Admin', 1, '2026-01-05');
  const p = db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id, slug, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  p.run(VENTURE, 'p-venture', 'Venture', 101, NORTH, 'venture', '2026-02-01');
  p.run(SOLO, 'p-solo', 'Solo', 101, null, 'solo', '2026-02-02');
  p.run(DOCK, 'p-dock', 'Dock', 101, SOUTH, null, '2026-02-03');
  p.run(RELIC, 'p-relic', 'Relic', 101, OLD, 'relic', '2026-02-04');
  p.run(PRIVATE, 'p-private', 'Private', 104, WEST, 'private', '2026-02-05');
  const s = db.prepare("INSERT INTO project_members (project_id, user_id, role, status, accepted_at) VALUES (?, ?, ?, 'accepted', '2026-02-10')");
  s.run(VENTURE, BEN, 'cofounder'); s.run(DOCK, BEN, 'cofounder'); s.run(DOCK, CY, 'advisor');
  return db;
}

export const envOf = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

function appFor() {
  const app = new Hono();
  app.route('/api', accountPortfolio);
  app.route('/api/projects', projectLifecycle);
  app.route('/api/projects', projects);
  app.route('/api', companyLifecycle);
  app.route('/api', companyLegal);
  app.route('/api', companyRoutes);
  return app;
}

export async function call(env: any, who: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await appFor().request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
