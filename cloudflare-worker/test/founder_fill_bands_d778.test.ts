/**
 * D778 part 4 (#2103) — the founder's fill bands through the run path:
 * `fill:pain_tag`, `fill:hypothesis` and `fill:feedback_theme`. A run with no
 * rail page names the page D771's inventory gives the band; a mounted rail's
 * page and the press's option win; the run stores a proposal and writes no
 * record before the founder's Accept. Real SQLite (the baseline plus every
 * migration above BASELINE_CUTOFF, as `grow_writes_d691.test.ts` builds it), a
 * stubbed model, made-up data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/founder_fill_bands_d778.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import founderValidate, { FOUNDER_FILL_PAGES } from '../src/routes/founder_validate.ts';
import { FILL_KINDS } from '../src/services/fills/registry.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1; const PID = 7;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Kestrel Labs', 10);
    INSERT INTO pain_groups (id, project_id, title) VALUES (21, ${PID}, 'Manual reconciliation');
    INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${PID}, 21, 'reconciling by hand', 'reconciling by hand');
    INSERT INTO discovery_interviews (project_id, interviewee_name, pains_json) VALUES (${PID}, 'Ola Ops', '["reconciling by hand"]');
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${FOUNDER}, 5000000);`);
  return db;
}

const CLAIM = 'Ops leads at mid-market freight firms will pay to stop reconciling by hand.';
async function propose(db: any, kind: string, headers: Record<string, string> = {}) {
  const AI = withGuard({ run: async () => ({ response: JSON.stringify([{ claim: CLAIM }]) }) });
  const app = new Hono<any>();
  app.route('/api/founder/validate', founderValidate);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/founder/validate/propose/${PID}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ kind }),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const runs = (db: any) => (db.prepare(`SELECT user_id, rail_page, rail_option FROM ai_usage_logs WHERE rail_option LIKE 'fill:%' AND guard_for IS NULL ORDER BY id`).all() as any[]).map((r) => ({ ...r }));

test('D778: each founder fill band\'s fallback page is the one D771\'s inventory gives it, both ways', () => {
  const fills = FOUNDER_OPTIONS.filter((o: any) => o.key.startsWith('fill:'));
  assert.deepEqual(fills.map((o: any) => o.key.slice(5)).sort(), Object.keys(FOUNDER_FILL_PAGES).sort());
  for (const o of fills as any[]) assert.equal(FOUNDER_FILL_PAGES[o.key.slice(5)], o.page, o.key);
  for (const kind of Object.keys(FOUNDER_FILL_PAGES)) assert.ok(FILL_KINDS[kind], `${kind} is a fill kind`);
  // A kind the founder's boards do not list keeps its surface's workspace.
  assert.equal(FOUNDER_FILL_PAGES.market_sizing, undefined);
});

test('D778: a press with no rail context runs on the band\'s inventoried page and option, and stores only a proposal', async () => {
  // Mutation checked: fall back to the surface's workspace → the page reads 'validate'.
  const db = fixture();
  const before = (db.prepare('SELECT COUNT(*) AS n FROM hypotheses WHERE project_id = ?').get(PID) as any).n;
  const r = await propose(db, 'hypothesis');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.proposals?.length, 1, JSON.stringify(r.body));
  assert.deepEqual(runs(db), [{ user_id: FOUNDER, rail_page: 'Founder · Validate · Experiments and evidence', rail_option: 'fill:hypothesis' }]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hypotheses WHERE project_id = ?').get(PID) as any).n, before, 'nothing on the board before Accept');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM validate_proposals WHERE project_id = ? AND status = 'pending'").get(PID) as any).n, 1, 'one proposal, waiting');
});

test('D778: a mounted rail\'s page and the press\'s option win over the fallback', async () => {
  const db = fixture();
  const r = await propose(db, 'hypothesis', { 'X-Rail-Page': 'validate', 'X-Rail-Option': encodeURIComponent('fill:hypothesis') });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(runs(db), [{ user_id: FOUNDER, rail_page: 'validate', rail_option: 'fill:hypothesis' }],
    'the mounted page holds the member\'s Manual switch, so it is the one checked');
});
