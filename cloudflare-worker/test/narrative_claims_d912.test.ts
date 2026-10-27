/**
 * D912 (#2696) — the Investor narrative's claims and its check, through the
 * real `cycle_raise.ts` router on SQLite (the baseline and every later
 * migration, 645 included).
 *
 *   1. Run the check checks the version asked about, words in a deck-stored
 *      section and in a `narrative_sections` one alike; another version is
 *      untouched. A typed "42 paying customers" against Stripe's 38 is a
 *      Mismatch.
 *   2. The claims read: the section, the stated figure, the state, the best
 *      source; the record's figure and the candidates for the founder only.
 *   3. Who: the founder runs the check; staff never run it; a Super Admin
 *      with a reason reads states with no figure, as Evidence admits only
 *      them; another founder reaches nothing.
 *   4. "Keep mine, with a note" (D900's shared route) shows on the claim.
 *   5. Phrase the fix takes the clicked claim: `claimMismatch` rebuilds that
 *      mismatch from the store, and nothing for a claim that is not one.
 *
 * Every name and figure is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/narrative_claims_d912.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { claimMismatch, fixScope } from '../src/services/narrativeFix.ts';
import { sectionOf } from '../src/services/narrativeClaims.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d912-narrative-claims-0123456789';

const OWNER = 1, ADMIN = 4, OTHER = 5, HQ = 6;
const PID = 7;
const ROLE: Record<number, string> = { [OWNER]: 'founder', [ADMIN]: 'admin', [OTHER]: 'founder', [HQ]: 'admin' };

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10),
      (${ADMIN}, 'admin@example.test', 'Synthetic Admin', 'admin', NULL),
      (${OTHER}, 'other@example.test', 'Synthetic Other Founder', 'founder', 11),
      (${HQ}, 'hq@example.test', 'Synthetic Super Admin', 'admin', NULL);
    INSERT INTO super_admins (user_id) VALUES (${HQ});
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10), (8, 'Synthetic other venture', 11);`);
  pin(db, 1, '5:paying_accounts', 38);
  return db;
}

/** A pinned KPI snapshot as D1263's Accept leaves it. */
function pin(db: any, id: number, ref: string, value: number) {
  const row: Record<string, unknown> = {
    id, uid: `item${id}`, project_id: PID, area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_table: 'project_metrics',
    source_ref: ref, source_label: 'connector', provider: 'stripe', strength: 'measured', observed_on: '2026-10-20', summary: 'Synthetic.', value_num: value,
    value_unit: 'count', snapshot_hash: 'h'.repeat(64), state: 'pinned', visibility: 'after_nda', mutation_uid: `m${id}`,
  };
  for (const c of db.prepare('PRAGMA table_info(raise_evidence_items)').all() as any[]) {
    if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : 'synthetic';
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO raise_evidence_items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k] as any));
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: any, who: number | null, method: string, path: string, body?: unknown) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) h.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`/api/cycles/raise${path}${sep}project=${PID}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}

/** Two saved versions: v1 states nothing; v2 says 42 paying customers in Traction (a deck key) and in Team (a section store). */
async function versions(db: any) {
  for (let i = 0; i < 2; i += 1) {
    const r = await call(db, OWNER, 'POST', '/narrative-versions', { investor_type: 'seed_fund' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  assert.equal((await call(db, OWNER, 'PUT', '/narrative/2/sections/traction', { body: 'We serve 42 paying customers.' })).status, 200);
  assert.equal((await call(db, OWNER, 'PUT', '/narrative/2/sections/team', { body: 'Built for 42 paying customers so far.' })).status, 200);
}
const claimsOf = (db: any, v: string) => db.prepare("SELECT field_key, state FROM raise_claims WHERE surface = 'narrative' AND surface_version = ? ORDER BY field_key").all(v).map((r: any) => [r.field_key, r.state]);

test('a claim’s section: a deck key, why now, or a section-stored one; any other field is in none', () => {
  assert.deepEqual(sectionOf('traction.takeaway#paying_customers'), { key: 'traction', label: 'Traction' });
  assert.deepEqual(sectionOf('section:team#mrr'), { key: 'team', label: 'Team' });
  assert.deepEqual(sectionOf('why_now#mrr'), { key: 'why_now', label: 'Why now' });
  assert.equal(sectionOf('cover.thesis#mrr'), null);
  assert.deepEqual(fixScope('7|abc_1'), { project: '7', claim: 'abc_1' });
  assert.deepEqual(fixScope('7'), { project: '7', claim: null });
  assert.equal(fixScope('7|bad uid;').claim, null, 'a claim key that is not an id is no claim');
});

test('Run the check checks the version asked about, both stores of words, and leaves the other version alone', async () => {
  const db = fixture();
  await versions(db);
  const v1 = await call(db, OWNER, 'POST', '/narrative/1/check');
  assert.equal(v1.status, 200, JSON.stringify(v1.body));
  assert.deepEqual(v1.body.claims, [], 'v1 states no figure');
  const r = await call(db, OWNER, 'POST', '/narrative/2/check');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Mutation checked: drop the `narrative_sections` read → the Team claim is missing.
  assert.deepEqual(claimsOf(db, 'v2'), [['section:team#paying_customers', 'mismatch'], ['traction.takeaway#paying_customers', 'mismatch']]);
  assert.deepEqual(claimsOf(db, 'v1'), []);
  const traction = r.body.claims.find((c: any) => c.section?.key === 'traction');
  assert.equal(traction.state, 'mismatch');
  assert.equal(traction.stated, '42');
  assert.equal(traction.figure, 'Paying customers');
  assert.deepEqual(traction.source, { label: 'connector', provider: 'stripe', observed_on: '2026-10-20', record: '38' });
  assert.ok(r.body.checked_at, 'Last checked');
  const log = db.prepare("SELECT action FROM activity_logs WHERE action = 'narrative_checked'").all();
  assert.equal(log.length, 2, 'one cycle row per run, never a figure');
  assert.equal((await call(db, OWNER, 'POST', '/narrative/9/check')).status, 404);
  assert.equal((await call(db, OWNER, 'POST', '/narrative/0/check')).status, 404, 'version 0 is the live deck, not a version');
});

test('who: the founder runs; an Admin is refused the run; a Super Admin with a reason reads states with no figure; another founder reaches nothing', async () => {
  const db = fixture();
  await versions(db);
  await call(db, OWNER, 'POST', '/narrative/2/check');
  for (const who of [ADMIN, HQ]) assert.equal((await call(db, who, 'POST', '/narrative/2/check')).status, 403, `${who} runs nothing`);
  assert.equal((await call(db, HQ, 'GET', '/narrative/2/claims')).body.code, 'read_reason_required', 'a reason first (D914)');
  for (const who of [ADMIN, HQ]) assert.equal((await call(db, who, 'POST', '/narrative/reads', { reason: 'Synthetic quarterly review' })).status, 201);
  // Claims are evidence: an Admin who is not a Super Admin reads none, as on Evidence (D1263).
  assert.equal((await call(db, ADMIN, 'GET', '/narrative/2/claims')).status, 403);
  const hq = await call(db, HQ, 'GET', '/narrative/2/claims');
  assert.equal(hq.status, 200, JSON.stringify(hq.body));
  assert.equal(hq.body.founder, false);
  // Mutation checked: pass `true` for founder → the record's figure reaches the Super Admin.
  for (const c of hq.body.claims) {
    assert.equal(c.state, 'mismatch');
    assert.equal(c.source.record, undefined, 'no record figure for staff');
    assert.equal(c.candidates, undefined);
  }
  // The figure as a value, never a substring: a claim's uid or a timestamp may hold the digits.
  assert.doesNotMatch(JSON.stringify(hq.body), /:"?38"?[,}]/, 'the record’s figure never reaches staff');
  // Another venture's founder is refused (the Evidence gate's 403 or the narrative's 404), and nothing is written.
  for (const [m, p] of [['GET', '/narrative/2/claims'], ['POST', '/narrative/2/check']] as const) {
    assert.ok([403, 404].includes((await call(db, OTHER, m, p)).status), `${m} ${p}`);
  }
  assert.equal((await call(db, null, 'GET', '/narrative/2/claims')).status, 401);
});

test('the founder’s read: a Not-backed claim offers the records that could back it; a kept note shows', async () => {
  const db = fixture();
  await versions(db);
  await call(db, OWNER, 'PUT', '/narrative/2/sections/traction', { body: 'We serve 42 paying customers and $9,000 MRR.' });
  await call(db, OWNER, 'POST', '/narrative/2/check');
  pin(db, 2, '5:arr', 100000);
  const read = await call(db, OWNER, 'GET', '/narrative/2/claims');
  const mrr = read.body.claims.find((c: any) => c.kind === 'mrr');
  assert.equal(mrr.state, 'not_backed');
  // Every pinned KPI snapshot is a record that could back an MRR claim (D1263's `backs`).
  assert.deepEqual(mrr.candidates.map((i: any) => i.id), ['item1', 'item2']);
  const mismatch = read.body.claims.find((c: any) => c.section?.key === 'traction' && c.kind === 'paying_customers');
  const note = await call(db, OWNER, 'POST', `/evidence/claims/${mismatch.id}/note`, { note: 'Our count includes annual pilots.' });
  assert.equal(note.status, 200, JSON.stringify(note.body));
  const after = (await call(db, OWNER, 'GET', '/narrative/2/claims')).body.claims.find((c: any) => c.id === mismatch.id);
  assert.equal(after.state, 'mismatch', 'a kept figure is still a Mismatch');
  assert.equal(after.note.text, 'Our count includes annual pilots.');
});

test('Phrase the fix takes the claim clicked: its figure, both values and both sources; nothing for one that is not a mismatch', async () => {
  const db = fixture();
  await versions(db);
  await call(db, OWNER, 'POST', '/narrative/2/check');
  const env = { DB: d1Over(db) } as any;
  const uid = (key: string) => (db.prepare("SELECT uid FROM raise_claims WHERE surface = 'narrative' AND field_key = ?").get(key) as any).uid;
  const m = await claimMismatch(env, PID, uid('section:team#paying_customers'));
  assert.deepEqual(m, { figure: 'paying_customers', stated_value: 42, stated_source: 'the narrative, v2, Team', metric_value: 38, metric_source: 'Connector · stripe · 2026-10-20' });
  assert.equal(await claimMismatch(env, 8, uid('section:team#paying_customers')), null, 'another venture’s claim is not found');
  db.prepare("UPDATE raise_claims SET state = 'backed' WHERE field_key = 'traction.takeaway#paying_customers'").run();
  // Mutation checked: drop `state = 'mismatch'` from the read → a Backed claim is phrased.
  assert.equal(await claimMismatch(env, PID, uid('traction.takeaway#paying_customers')), null);
});
