import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
/**
 * #1524 item 3 (D663 follow-up) — Eadwyn phrases the fix for one narrative
 * mismatch: the `raise/narrative-fix` draft surface, on real SQLite, with a
 * model stub that keeps its prompt and answers what each test tells it to.
 *
 * What is held:
 * - with nothing to phrase (no check row on the newest version, or a project
 *   that is not the caller's) the surface refuses before the model is reached;
 * - the model reads the one row, both figures and both sources, and no other
 *   project's;
 * - what is stored cites both figures and both sources whatever the model
 *   wrote, and a wording that quotes a figure the check did not find is not
 *   stored at all.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_fix_d663.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys, splitStatements } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import research from '../src/routes/research.ts';
import { finishNarrativeFix, unfoundFigures, NARRATIVE_FIX_INSTRUCTION } from '../src/services/narrativeFix.ts';
import type { Mismatch } from '../src/services/raiseCycle.ts';

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG442 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/442_raise_cycle_stores.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const MINE = { user: 70, founder_id: 170 };
const THEIRS = { user: 71, founder_id: 171 };
const MY_PROJECT = 900;
const THEIR_PROJECT = 901;

const STATED = 'Narrative · traction.summary';
const STORED = 'Metrics · project_metrics.mrr on 2026-09-30';
const ROW: Mismatch = { figure: 'mrr', stated_value: 12000, stated_source: STATED, metric_value: 9500, metric_source: STORED };

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE research_zone_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL, surface TEXT NOT NULL, scope_key TEXT,
      body TEXT NOT NULL, model TEXT, cost_micro_usd INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // The production shapes: the baseline's overrides table, then migration
  // 442's versioned columns and its `narrative_checks`.
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'spinout_deck_overrides')));
  for (const s of splitStatements(MIG442)) {
    if (/ALTER TABLE spinout_deck_overrides ADD COLUMN|CREATE TABLE IF NOT EXISTS narrative_checks/.test(s)) db.exec(stripForeignKeys(s));
  }
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  for (const who of [MINE, THEIRS]) {
    db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)').run(who.user, 'founder', who.founder_id);
  }
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(MY_PROJECT, 'Mine', MINE.founder_id);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(THEIR_PROJECT, 'Theirs', THEIRS.founder_id);
  return db;
}

function version(db: any, pid: number, v: number) {
  db.prepare('INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (?, ?, ?, ?)')
    .run(pid, 'traction.summary', `Version ${v} wording`, v);
}
function check(db: any, pid: number, v: number, m: Mismatch) {
  db.prepare(`INSERT INTO narrative_checks (project_id, version, figure, stated_value, stated_source, metric_value, metric_source)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(pid, v, m.figure, m.stated_value, m.stated_source, m.metric_value, m.metric_source);
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function draft(db: any, who: { user: number }, scopeKey: string, answer = 'Change the narrative to the stored figure, or correct the stored metric.') {
  let prompt: string | null = null;
  const AI = {
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      prompt = String(messages[messages.length - 1]?.content ?? '');
      return { response: answer };
    },
  };
  const res = await research.fetch(
    new Request('http://x/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token(who.user)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'raise/narrative-fix', scope_key: scopeKey }),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any,
  );
  const json: any = await res.json().catch(() => null);
  return { status: res.status, prompt: prompt as string | null, json };
}

const stored = (db: any) => db.prepare('SELECT body FROM research_zone_drafts').all().map((r: any) => String(r.body));

test('with nothing to phrase the band refuses, and the model is never reached', async () => {
  const db = freshDb();
  // No version at all.
  let r = await draft(db, MINE, String(MY_PROJECT));
  assert.equal(r.status, 409);
  assert.equal(r.json?.detail, 'nothing_to_draft');
  assert.equal(r.prompt, null);
  // A version the check found clean.
  version(db, MY_PROJECT, 1);
  r = await draft(db, MINE, String(MY_PROJECT));
  assert.equal(r.status, 409);
  assert.equal(r.prompt, null);
  // A mismatch on an OLDER version is not one the narrative card shows: the
  // band phrases what the newest version states, or nothing.
  check(db, MY_PROJECT, 1, ROW);
  version(db, MY_PROJECT, 2);
  r = await draft(db, MINE, String(MY_PROJECT));
  assert.equal(r.status, 409, 'an older version\'s mismatch was phrased as the newest one\'s');
  assert.equal(r.prompt, null);
  assert.deepEqual(stored(db), []);
});

test('another founder\'s mismatch is never phrased, and never read', async () => {
  const db = freshDb();
  version(db, THEIR_PROJECT, 1);
  check(db, THEIR_PROJECT, 1, ROW);
  const r = await draft(db, MINE, String(THEIR_PROJECT));
  assert.equal(r.status, 409);
  assert.equal(r.prompt, null);
});

test('the model reads the one row: both figures, both sources, and nothing that picks a side', async () => {
  const db = freshDb();
  version(db, MY_PROJECT, 1);
  check(db, MY_PROJECT, 1, ROW);
  check(db, MY_PROJECT, 1, { figure: 'paying_customers', stated_value: 40, stated_source: 'Narrative · traction.customers', metric_value: 31, metric_source: 'Metrics · project_metrics.paying_accounts on 2026-09-30' });
  version(db, THEIR_PROJECT, 1);
  check(db, THEIR_PROJECT, 1, { ...ROW, stated_value: 77000, stated_source: 'Narrative · their.summary' });
  const r = await draft(db, MINE, String(MY_PROJECT));
  assert.equal(r.status, 201);
  const prompt = String(r.prompt);
  for (const part of ['$12,000', '$9,500', STATED, STORED]) assert.ok(prompt.includes(part), `the model was not given ${part}`);
  // One mismatch: the first stored, never the rest.
  assert.ok(!prompt.includes('Paying customers') && !prompt.includes('traction.customers'), 'more than one mismatch reached the model');
  assert.ok(!prompt.includes('77,000') && !prompt.includes('their.summary'), 'another founder\'s check reached the model');
  assert.ok(prompt.includes('Do not say or imply which figure is right'), 'the instruction no longer forbids picking a side');
  assert.ok(prompt.includes('Nothing records which of the two is current.'));
});

test('what is stored cites both figures and both sources, whatever the model wrote', async () => {
  const db = freshDb();
  version(db, MY_PROJECT, 1);
  check(db, MY_PROJECT, 1, ROW);
  const r = await draft(db, MINE, String(MY_PROJECT), 'Bring the traction sentence in line with the stored metrics.');
  assert.equal(r.status, 201);
  const body = String(r.json?.item?.body);
  assert.ok(body.startsWith('Bring the traction sentence in line with the stored metrics.'));
  for (const part of ['$12,000', '$9,500', STATED, STORED]) assert.ok(body.includes(part), `the stored draft does not cite ${part}`);
  assert.deepEqual(stored(db), [body]);
});

test('a wording that quotes a figure the check did not find is not stored', async () => {
  const db = freshDb();
  version(db, MY_PROJECT, 1);
  check(db, MY_PROJECT, 1, ROW);
  const r = await draft(db, MINE, String(MY_PROJECT), 'Say $12,000 in MRR, growing 15% to $13,800 next month.');
  assert.equal(r.status, 503);
  assert.equal(r.json?.detail, 'draft_unfaithful');
  assert.deepEqual(stored(db), [], 'an unfaithful draft was stored');
});

test('unfoundFigures accepts both figures in any written form, and the sources\' own digits', () => {
  assert.deepEqual(unfoundFigures('Either $12,000 or $9,500 is current.', ROW), []);
  assert.deepEqual(unfoundFigures('Use $12k, or 9.5k as the snapshot of 2026-09-30 holds.', ROW), []);
  assert.deepEqual(unfoundFigures('No figure here at all.', ROW), []);
  assert.deepEqual(unfoundFigures('Round it to $10,000.', ROW), ['10,000']);
  assert.deepEqual(unfoundFigures('MRR of $12 million.', ROW), ['12 million']);
  // A source's digits are found as written, never re-scaled into a figure.
  assert.deepEqual(unfoundFigures('As of 2026 and 30k.', ROW), ['30k']);
});

test('finishNarrativeFix appends the check\'s sentence, or refuses', () => {
  const kept = finishNarrativeFix('  Use one of the two.  ', ROW);
  assert.equal(kept, `Use one of the two.\n\nAs the check found them: MRR: $12,000 in ${STATED}, $9,500 in ${STORED}.`);
  assert.equal(finishNarrativeFix('Say $11,000.', ROW), null);
  assert.match(NARRATIVE_FIX_INSTRUCTION, /Quote no other figure, date or number/);
});
