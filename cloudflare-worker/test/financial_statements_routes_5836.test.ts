/**
 * D5836 (#5836, part 1) — the read routes over D5833's statement store, over the
 * full migrated schema with signed requests:
 *   · the venture's founder, a co-founder and an admin read; an advisor, an
 *     investor and a stranger get the same 404 (no raw ledger figure for them);
 *   · the latest revision of each statement, a superseded revision by its uid,
 *     and the pins with the revision each points at;
 *   · amounts stay the store's exact text, zero, negative and absent apart;
 *   · an unknown revision, another venture's revision and an unreadable filter
 *     are refused by code.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/financial_statements_routes_5836.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import router, { mount } from '../src/routes/financial_statements.ts';
import { fromQuickBooks } from '../src/services/financialStatements/quickbooks.ts';
import { pinRevision, writeSnapshot } from '../src/services/financialStatements/store.ts';

const JWT_SECRET = 'synthetic-5836-only-not-a-real-credential'.repeat(2);
const FOUNDER = 1, COFOUNDER = 2, ADVISOR = 3, STRANGER = 4, INVESTOR = 5, ADMIN = 6, PROJECT = 50, OTHER = 51;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/accounting/${name}.json`, import.meta.url), 'utf8'));
const QB_BS = fixture('quickbooks_balance_sheet'), QB_PL = fixture('quickbooks_profit_and_loss');
const asUser = (id: number, founder_id: number | null, role = 'founder') => ({ id, role, founder_id, licences: [role] } as any);

async function world() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  u.run(FOUNDER, 'founder', 'Fay', 'fay@example.test', 10);
  u.run(COFOUNDER, 'founder', 'Cid', 'cid@example.test', 20);
  u.run(ADVISOR, 'advisor', 'Ava', 'ava@example.test', null);
  u.run(STRANGER, 'founder', 'Sol', 'sol@example.test', 40);
  u.run(INVESTOR, 'investor', 'Ivy', 'ivy@example.test', null);
  u.run(ADMIN, 'admin', 'Ada', 'ada@example.test', null);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(PROJECT, 'Venture', 10);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(OTHER, 'Other', 40);
  const m = db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, ?, 'accepted')");
  m.run(PROJECT, COFOUNDER, 'cofounder'); m.run(PROJECT, ADVISOR, 'advisor'); m.run(PROJECT, INVESTOR, 'investor');
  const i = db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (?, ?, ?, ?, 'active', 'oauth2')");
  i.run(1, 'int-qb-founder', FOUNDER, 'quickbooks'); i.run(4, 'int-qb-stranger', STRANGER, 'quickbooks');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const founder = { user: asUser(FOUNDER, 10), projectId: PROJECT };
  const bs = (as_of: string) => fromQuickBooks(QB_BS, { realm_id: '9130350000000001', requested: { as_of } });
  const first = await writeSnapshot(env, founder, 1, bs('2026-09-30'));
  // A correction of the same statement: a new revision that supersedes the first.
  const corrected = structuredClone(QB_BS);
  const second = await writeSnapshot(env, founder, 1, fromQuickBooks(mutateFirstAmount(corrected), { realm_id: '9130350000000001', requested: { as_of: '2026-09-30' } }));
  await writeSnapshot(env, founder, 1, fromQuickBooks(QB_PL, { realm_id: '9130350000000001', requested: { start: '2026-04-01', end: '2026-09-30' } }));
  const pin = await pinRevision(env, founder, first.uid, 'Use of Funds evidence');
  const other = await writeSnapshot(env, { user: asUser(STRANGER, 40), projectId: OTHER }, 4, bs('2026-06-30'));
  return { db, env, first, second, pin, other };
}
/** Change one cash account's amount so the second write is a correction, not `unchanged`. */
function mutateFirstAmount(body: any): any {
  const walk = (n: any): boolean => {
    if (n && typeof n === 'object') {
      if (Array.isArray(n.ColData) && n.ColData[1] && /^-?\d/.test(String(n.ColData[1].value ?? ''))) { n.ColData[1].value = '1.00'; return true; }
      for (const v of Object.values(n)) if (walk(v)) return true;
    }
    return false;
  };
  assert.ok(walk(body), 'the fixture has an amount to correct');
  return body;
}

const app = new Hono<any>();
app.route(mount.path, mount.router as any);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function get(env: any, path: string, who: number | null) {
  const headers: Record<string, string> = {};
  if (who != null) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const res = await app.request(path, { headers }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any, cache: res.headers.get('cache-control') };
}

test('mounted at /api/financial-statements, reads only', () => {
  assert.equal(mount.path, '/api/financial-statements');
  assert.equal(mount.router, router);
  assert.deepEqual([...new Set((router as any).routes.map((r: any) => r.method))], ['GET']);
});

test('the founder, a co-founder and an admin read; an advisor, an investor and a stranger get the same 404', async () => {
  const w = await world();
  for (const who of [FOUNDER, COFOUNDER, ADMIN]) {
    const r = await get(w.env, `/api/financial-statements/${PROJECT}`, who);
    assert.equal(r.status, 200, String(who));
    assert.equal(r.cache, 'private, no-store');
  }
  for (const who of [ADVISOR, INVESTOR, STRANGER]) {
    for (const p of [`/api/financial-statements/${PROJECT}`, `/api/financial-statements/${PROJECT}/pins`, `/api/financial-statements/${PROJECT}/revisions/${w.first.uid}`]) {
      const r = await get(w.env, p, who);
      assert.deepEqual([r.status, r.body.error], [404, 'project_not_found'], `${who} ${p}`);
      assert.ok(!JSON.stringify(r.body).includes('232959'), 'no figure in a refusal');
    }
  }
  assert.equal((await get(w.env, `/api/financial-statements/${PROJECT}`, null)).status, 401);
  assert.equal((await get(w.env, '/api/financial-statements/0', FOUNDER)).status, 404);
  assert.equal((await get(w.env, '/api/financial-statements/abc', FOUNDER)).status, 404);
});

test('latest: one current revision per statement, the correction counted, exact amounts with their states', async () => {
  const w = await world();
  const r = await get(w.env, `/api/financial-statements/${PROJECT}`, FOUNDER);
  assert.deepEqual(r.body.items.map((s: any) => [s.report, s.revision, s.revisions]), [['balance_sheet', 2, 2], ['profit_and_loss', 1, 1]]);
  const bs = r.body.items[0];
  assert.equal(bs.uid, w.second.uid);
  assert.equal(bs.superseded_by, null);
  const states = new Set(bs.lines.map((l: any) => l.state));
  for (const s of ['value', 'zero', 'absent']) assert.ok(states.has(s), s);
  assert.ok(bs.lines.some((l: any) => /^-/.test(String(l.amount_minor))), 'a negative amount stays negative');
  for (const l of bs.lines) if (l.amount != null) assert.equal(typeof l.amount, 'string', 'exact text, never a float');
  assert.ok(!JSON.stringify(r.body).includes(w.other.uid), 'another venture\'s statement is not here');
  const pl = await get(w.env, `/api/financial-statements/${PROJECT}?report=profit_and_loss`, FOUNDER);
  assert.deepEqual(pl.body.items.map((s: any) => s.report), ['profit_and_loss']);
  assert.deepEqual([(await get(w.env, `/api/financial-statements/${PROJECT}?report=cash_flow`, FOUNDER)).body.error], ['invalid_report']);
});

test('a revision by its uid, superseded or not; pins point at their revision and say it was superseded', async () => {
  const w = await world();
  const old = await get(w.env, `/api/financial-statements/${PROJECT}/revisions/${w.first.uid}`, FOUNDER);
  assert.equal(old.status, 200);
  assert.deepEqual([old.body.item.revision, old.body.item.superseded_by], [1, w.second.uid]);
  const pins = await get(w.env, `/api/financial-statements/${PROJECT}/pins`, COFOUNDER);
  assert.deepEqual(pins.body.items.map((p: any) => [p.uid, p.snapshot_uid, p.revision, p.superseded_by, p.purpose]),
    [[w.pin.uid, w.first.uid, 1, w.second.uid, 'Use of Funds evidence']]);
  const foreign = await get(w.env, `/api/financial-statements/${PROJECT}/revisions/${w.other.uid}`, FOUNDER);
  assert.deepEqual([foreign.status, foreign.body.error], [404, 'snapshot_not_found'], 'another venture\'s revision is not found here');
  assert.deepEqual((await get(w.env, `/api/financial-statements/${PROJECT}/revisions/not-a-uid`, FOUNDER)).body.error, 'snapshot_not_found');
});
