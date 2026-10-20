/**
 * D778 part 7 (#2103) — the pitch deck reviewer's three presses through the
 * run path: `review:deck-file` (upload), `review:deck-text` (pasted text) and
 * `review:deck-again` (regenerate). Each run names the page and option D771's
 * inventory gives it; a mounted rail's page and the press's option win; the
 * record is the review the run writes, never the browser's label. A review is
 * the reviewer's own output: it writes `deck_reviews` and its history, and no
 * deck or project record.
 *
 * Real SQLite (the baseline plus every migration above BASELINE_CUTOFF), a
 * stubbed, guarded model, made-up data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/founder_deck_review_d778.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckReviewer, { DECK_REVIEW_OPTIONS, DECK_REVIEW_PAGE } from '../src/routes/deck_reviewer.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d778-deck-review-0123456789';
const FOUNDER = 1; const PID = 7;
const DECK_TEXT = '# Problem\nFreight teams reconcile invoices by hand.\n\n# Solution\nAn agent that reconciles them.';

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
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${FOUNDER}, 5000000);`);
  return db;
}

async function call(db: any, method: string, path: string, init: { body?: BodyInit; json?: unknown; headers?: Record<string, string> } = {}) {
  const AI: any = withGuard({
    run: async (_m: string, input: any) => {
      const sys = String(input?.messages?.[0]?.content || '');
      return { response: sys.includes('organize raw pitch-deck text')
        ? JSON.stringify({ sections: [{ key: 'problem', content: 'Freight teams reconcile invoices by hand.' }] })
        : JSON.stringify({ overall_score: 61, summary: 'A clear problem; the traction slide is thin.', strengths: ['Clear problem'] }) };
    },
  });
  AI.toMarkdown = async () => [{ data: DECK_TEXT }];
  const app = new Hono<any>();
  app.route('/api/deck-reviewer', deckReviewer);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(init.headers || {}) };
  let body = init.body;
  if (init.json !== undefined) { body = JSON.stringify(init.json); headers['content-type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://t/api/deck-reviewer${path}`, { method, headers, body }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const runs = (db: any) => (db.prepare(`SELECT user_id, rail_page, rail_option, record_ref FROM ai_usage_logs WHERE guard_for IS NULL ORDER BY id`).all() as any[]).map((r) => ({ ...r }));
const upload = (db: any, headers?: Record<string, string>) => {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([37, 80, 68, 70])], 'kestrel.pdf', { type: 'application/pdf' }));
  fd.append('project_id', String(PID));
  return call(db, 'POST', '/upload', { body: fd, headers });
};

test('D778: the reviewer\'s three presses fall back to the page and options D771\'s inventory gives them', () => {
  const rows = FOUNDER_OPTIONS.filter((o: any) => String(o.key).startsWith('review:deck'));
  assert.deepEqual(rows.map((o: any) => o.key).sort(), Object.values(DECK_REVIEW_OPTIONS).sort());
  for (const o of rows as any[]) assert.equal(o.page, DECK_REVIEW_PAGE, o.key);
});

test('D778: each press with no rail context names its inventoried option, and the record is its review', async () => {
  // Mutation checked: keep the old fixed rail → every row reads 'raise' and 'review:pitch-deck'.
  const db = fixture();
  const up = await upload(db);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.status, 'complete', JSON.stringify(up.body));
  const pasted = await call(db, 'POST', '/paste', { json: { text: DECK_TEXT, project_id: PID } });
  assert.equal(pasted.status, 200, JSON.stringify(pasted.body));
  const again = await call(db, 'POST', `/${pasted.body.id}/regenerate`, { json: {} });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const at = (id: string) => `deck_review:${id}`;
  assert.deepEqual(runs(db).map((r) => [r.rail_page, r.rail_option, r.record_ref]), [
    [DECK_REVIEW_PAGE, 'review:deck-file', at(up.body.id)], [DECK_REVIEW_PAGE, 'review:deck-file', at(up.body.id)],
    [DECK_REVIEW_PAGE, 'review:deck-text', at(pasted.body.id)], [DECK_REVIEW_PAGE, 'review:deck-text', at(pasted.body.id)],
    [DECK_REVIEW_PAGE, 'review:deck-again', at(pasted.body.id)],
  ], 'mapping and review are two runs; a regenerate is one');
  assert.ok(runs(db).every((r) => r.user_id === FOUNDER), 'charged to the member who pressed');
});

test('D778: a mounted rail\'s page and the press\'s option win; the browser\'s record label never does', async () => {
  // Mutation checked: pass the fixed fallback instead of railFor → the page reads the inventory's.
  const db = fixture();
  const press = (option: string) => ({ 'X-Rail-Page': 'raise', 'X-Rail-Option': encodeURIComponent(option), 'X-Rail-Record': 'project:999' });
  const up = await upload(db, press('review:deck-file'));
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const again = await call(db, 'POST', `/${up.body.id}/regenerate`, { json: {}, headers: press('review:deck-again') });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const pasted = await call(db, 'POST', '/paste', { json: { text: DECK_TEXT }, headers: press('review:deck-text') });
  assert.equal(pasted.status, 200, JSON.stringify(pasted.body));
  assert.deepEqual([...new Set(runs(db).map((r) => `${r.rail_page}|${r.rail_option}|${r.record_ref}`))], [
    `raise|review:deck-file|deck_review:${up.body.id}`, `raise|review:deck-again|deck_review:${up.body.id}`,
    `raise|review:deck-text|deck_review:${pasted.body.id}`,
  ], 'the mounted page holds the member\'s Manual switch, so it is the one checked');
});

test('D778: a review writes only the reviewer\'s own store, never the deck or the project', async () => {
  const db = fixture();
  const before = (db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get() as any)?.n ?? 0;
  const project = JSON.stringify(db.prepare('SELECT * FROM projects WHERE id = ?').get(PID));
  const r = await call(db, 'POST', '/paste', { json: { text: DECK_TEXT, project_id: PID } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deck_review_history WHERE review_id = ?').get(r.body.id) as any).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get() as any)?.n ?? 0, before, 'no deck version');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM projects WHERE id = ?').get(PID)), project, 'the project row is untouched');
});
