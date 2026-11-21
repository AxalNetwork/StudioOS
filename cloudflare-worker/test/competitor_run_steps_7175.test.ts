/**
 * D7175 part 2 (#7175, canvas D7041 board RS-13 B3) — "What the run did"
 * prints each step's time.
 *
 * Held here:
 *   - a run stores `output.run_steps`: search (the run's start), discovery
 *     (with the companies it returned), read (the reads tried and fetched),
 *     synthesis, and saved, each with an ISO time, in that order and never
 *     going back in time;
 *   - a run that found nothing still records its steps, with 0 companies and
 *     0 reads;
 *   - a save of the person's text keeps the run's steps (they describe the
 *     run, not the edit).
 *
 * Real SQLite (the baseline plus every migration), a stubbed, guarded model,
 * a stubbed public web, made-up data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/competitor_run_steps_7175.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import competitors from '../src/routes/competitors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { loadSchema } from './_schema_once.mjs';
import { __setPublicResolverForTest } from '../src/services/webFetch.ts';

__setPublicResolverForTest(async () => ['93.184.216.34']);

const JWT_SECRET = 'unit-test-jwt-secret-7175-run-steps-0123456789';
const OWNER = 1;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  loadSchema(db);
  db.exec(`INSERT INTO users (id, email, name, role) VALUES (${OWNER}, 'owner@example.test', 'Ola Owner', 'founder');
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${OWNER}, 5000000);`);
  return db;
}

const model = {
  discovery: [] as Array<{ name: string; domain: string; category: string }>,
  synthesis: {} as Record<string, unknown>,
};

/** The public web: every page answers, except a host named `down`, which answers 503. */
async function withWeb<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    if (url.includes('down.example')) return new Response('unavailable', { status: 503, headers: { 'content-type': 'text/html' } });
    return new Response('<html><head><title>Page</title></head><body><h1>Freight</h1><p>Plans from $99.</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = prev; }
}

async function call(db: any, method: string, path: string, json?: unknown, headers: Record<string, string> = {}) {
  const AI: any = withGuard({
    run: async (_m: string, input: any) => {
      const sys = String(input?.messages?.[0]?.content || '');
      if (sys.includes('competitive-intelligence analyst')) return { response: JSON.stringify(model.discovery) };
      if (sys.includes('positioning/messaging')) return { response: JSON.stringify({ positioning: 'Freight invoices.' }) };
      return { response: JSON.stringify(model.synthesis) };
    },
  });
  const app = new Hono<any>();
  app.route('/api/competitors', competitors);
  const token = await new SignJWT({ user_id: OWNER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withWeb(() => app.fetch(new Request(`http://t/api/competitors${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any));
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

test('a run stores when each of its steps finished, in order: search, discovery, read, synthesis, saved', async () => {
  const db = fixture();
  model.discovery = [
    { name: 'Ledgerline', domain: 'ledgerline.example', category: 'direct' },
    { name: 'Downco', domain: 'down.example', category: 'adjacent' },
  ];
  model.synthesis = { market_summary: 'A crowded back office.' };
  const made = await call(db, 'POST', '/analyze', { market: 'Freight invoice reconciliation', depth: 'quick' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const steps = made.body.output.run_steps;
  assert.deepEqual(steps.map((s: any) => s.step), ['search', 'discovery', 'read', 'synthesis', 'saved']);
  for (const s of steps) assert.match(s.at, ISO, `${s.step} has an ISO time`);
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i].at >= steps[i - 1].at, `${steps[i].step} is not before ${steps[i - 1].step}`);
  assert.equal(steps[1].companies, 2, 'discovery says how many companies it returned');
  const read = steps[2];
  const sources = made.body.sources as Array<{ status: number }>;
  assert.equal(read.tried, sources.length, 'the read step counts every read tried, failed ones included');
  assert.equal(read.fetched, sources.filter((s) => s.status >= 200 && s.status < 400).length);
  assert.ok(read.tried > read.fetched, 'the 503 read is tried, not fetched');
  // The run started at the search step: never before the row was made.
  assert.ok(steps[0].at >= String(made.body.created_at).slice(0, 19), 'search is stamped at the start of the run');

  // A save of the person's text keeps the run's steps.
  const saved = await call(db, 'PATCH', `/${made.body.id}`, { output: { ...made.body.output, notes: 'Mine.' } }, { 'If-Match': '1' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.output.run_steps, steps, 'a save keeps the steps of the run');
});

test('a run that found nothing still records its steps, with 0 companies and 0 reads', async () => {
  const db = fixture();
  model.discovery = [];
  model.synthesis = {};
  const made = await call(db, 'POST', '/analyze', { market: 'Enzyme assays', depth: 'quick' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const steps = made.body.output.run_steps;
  assert.deepEqual(steps.map((s: any) => [s.step, s.companies ?? null, s.tried ?? null, s.fetched ?? null]), [
    ['search', null, null, null], ['discovery', 0, null, null], ['read', null, 0, 0], ['synthesis', null, null, null], ['saved', null, null, null],
  ]);
  assert.equal(made.body.evidence.status, 'insufficient');
});
