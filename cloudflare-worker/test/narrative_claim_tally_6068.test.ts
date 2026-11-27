/**
 * D6068 (#6068, under #4863) — the Investor narrative's Home "Claims backed"
 * tile and Story's per-section Mismatch dot, read from D1264's claim store on
 * the module read (`parts.narrative.claims`, `services/narrative/claimTally.ts`).
 * Real mounted routes on SQLite (the baseline and every later migration).
 *
 *   1. Before a check stores claims, the tally is a real "nothing checked"
 *      (total 0), never an unknown count.
 *   2. After the founder's check, backed of total and the sections holding a
 *      Mismatch, for the newest version only; a noted Mismatch stays one.
 *   3. A store that cannot be read is `unreadable` on its own; the rest of the
 *      part still reads.
 *
 * Every name and figure is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/narrative_claim_tally_6068.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { claimTally, CLAIMS_UNREADABLE_REASON } from '../src/services/narrative/claimTally.ts';
import { sectionOfField } from '../src/services/narrative/claims.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-6068-claim-tally-0123456789';
const OWNER = 1;
const PID = 7;
const today = '2026-11-01';

function fixture() {
  const db = new DatabaseSync(':memory:');
  loadSchema(db);
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test');
    INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10, 1);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10);`);
  // Stripe's metric says 38 paying customers; nothing pinned backs a letter of intent.
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, source, paying_accounts) VALUES (?, ?, 'stripe', 38)").run(PID, today);
  const row: Record<string, unknown> = {
    id: 1, uid: 'item1', project_id: PID, area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_table: 'project_metrics',
    source_ref: '5:paying_accounts', source_label: 'connector', provider: 'stripe', strength: 'measured', observed_on: today, summary: 'Synthetic record.',
    value_num: 38, value_unit: 'count', snapshot_hash: 'h'.repeat(64), state: 'pinned', visibility: 'after_nda', mutation_uid: 'm1',
  };
  for (const c of db.prepare('PRAGMA table_info(raise_evidence_items)').all() as any[]) {
    if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : 'synthetic';
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO raise_evidence_items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k] as any));
  return db;
}

const app = new Hono<any>().route('/api/cycles/raise', cycleRaise);
app.onError((err: any, c: any) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: any, method: string, path: string, body?: unknown, DB: any = d1Over(db)) {
  const token = await new SignJWT({ user_id: OWNER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`/api/cycles/raise${path}${sep}project=${PID}`, {
      method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}

async function version(db: any, section: string, words: string) {
  const v = await call(db, 'POST', '/narrative-versions', { investor_type: 'seed_fund', start_from: 'blank' });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const s = await call(db, 'PUT', `/narrative/${v.body.version}/sections/${section}`, { body: words });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return v.body.version as number;
}

const part = async (db: any, DB?: any) => {
  const r = await call(db, 'GET', '/modules/investor-narrative', undefined, DB);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.parts.narrative.state, 'ok');
  return r.body.parts.narrative;
};

test('D6068: no version is no tally; before a check, the newest version reads a real zero total, never a guess', async () => {
  const db = fixture();
  assert.equal((await part(db)).claims, null, 'no version, no tally');
  const v = await version(db, 'traction', 'We serve 42 paying customers with 3 letters of intent.');
  db.prepare("DELETE FROM raise_claims WHERE surface = 'narrative'").run();
  const { claims } = await part(db);
  assert.deepEqual(claims, { state: 'ok', version: v, total: 0, backed: 0, checked_at: null, mismatch_sections: [] });
});

test('D6068: after the founder\'s check, backed of total and the sections with a Mismatch, for the newest version', async () => {
  const db = fixture();
  const v1 = await version(db, 'traction', 'We serve 42 paying customers with 3 letters of intent.');
  assert.equal((await call(db, 'GET', `/narrative/${v1}/claims`)).status, 200);
  let { claims } = await part(db);
  assert.equal(claims.state, 'ok');
  assert.equal(claims.version, v1);
  assert.equal(claims.total, 2, 'paying customers and letters of intent');
  assert.equal(claims.backed, 0);
  assert.deepEqual(claims.mismatch_sections, ['traction']);
  assert.match(String(claims.checked_at), /^\d{4}-\d{2}-\d{2}/);

  // One claim backed now: 1 of 2, and traction still holds the other Mismatch.
  // Stripe's 38 against a stated 42 is the Mismatch; no pinned record backs the letters of intent.
  assert.deepEqual(db.prepare("SELECT claim_kind, state FROM raise_claims WHERE surface = 'narrative' ORDER BY id").all().map((r: any) => [r.claim_kind, r.state]),
    [['paying_customers', 'mismatch'], ['lois', 'not_backed']]);

  // The letters now a Mismatch the founder kept with a note, the customers backed: 1 of 2, and a noted Mismatch stays open (D900 §10).
  db.prepare("UPDATE raise_claims SET state = 'mismatch', note = 'Synthetic note.', note_value = stated_value WHERE surface = 'narrative' AND claim_kind = 'lois'").run();
  db.prepare("UPDATE raise_claims SET state = 'backed' WHERE surface = 'narrative' AND claim_kind = 'paying_customers'").run();
  ({ claims } = await part(db));
  assert.deepEqual([claims.backed, claims.total, claims.mismatch_sections], [1, 2, ['traction']], 'a noted Mismatch is still open');
  // No Mismatch left: the section shows none.
  db.prepare("UPDATE raise_claims SET state = 'not_backed' WHERE surface = 'narrative' AND claim_kind = 'lois'").run();
  ({ claims } = await part(db));
  assert.deepEqual([claims.backed, claims.total, claims.mismatch_sections], [1, 2, []]);

  // A newer version is the one tallied, never the older version's claims.
  const v2 = await version(db, 'traction', 'We serve 42 paying customers.');
  db.prepare("DELETE FROM raise_claims WHERE surface = 'narrative' AND surface_version = ?").run(`v${v2}`);
  ({ claims } = await part(db));
  assert.deepEqual([claims.version, claims.total, claims.backed], [v2, 0, 0]);
});

test('D6068: a claim store that cannot be read is unreadable on its own; the rest of the part reads', async () => {
  const db = fixture();
  const v = await version(db, 'traction', 'We serve 42 paying customers.');
  const real = d1Over(db);
  const broken = { ...real, prepare: (sql: string) => (/FROM raise_claims WHERE project_id = \? AND surface = 'narrative' AND surface_version = \? ORDER BY id/.test(sql) && /SELECT field_key, state, checked_at/.test(sql) ? (() => { throw new Error('no such table: raise_claims'); })() : real.prepare(sql)) };
  const p = await part(db, broken);
  assert.deepEqual(p.claims, { state: 'unreadable', version: v, reason: CLAIMS_UNREADABLE_REASON });
  assert.equal(p.versions.length, 1, 'the versions still read');
  // The helper on its own says the same.
  const saved = console.warn; console.warn = () => {};
  try { assert.equal((await claimTally({ DB: broken } as any, PID, v, sectionOfField)).state, 'unreadable'); } finally { console.warn = saved; }
});
