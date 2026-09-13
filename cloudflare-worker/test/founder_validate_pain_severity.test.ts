/**
 * `interview_pain_severities` finally has both ends.
 *
 * Migration 211 created the table with the right shape and a unique index on
 * `(interview_id, phrase_norm)`, and then NOTHING READ OR WROTE IT — anywhere.
 * Migration 215's own header names it as its example of "a column that comes to
 * exist that nothing reads", and the consequence was visible to customers:
 * `/validate/pain-map`'s `Need-to-have` chip carried the reason "no mention
 * carries a severity: `interview_pain_severities` exists with no reader and no
 * writer anywhere in the worker".
 *
 * RUN, NOT READ. These call the route and the view against a real SQLite built
 * from migration 211 itself, because the failures worth catching here are all
 * shaped like a query that compiles and answers wrongly:
 *
 *   · A severity attributed to the wrong interview counts a theme twice, and
 *     `need_count` is a count of INTERVIEWS — so the number on screen would be
 *     larger than the number of people who said it.
 *   · A severity that does not follow its phrase through re-grouping would make
 *     the chip disagree with the map beside it about the same conversation.
 *   · `severity_recorded` derived from the counts rather than the rows would
 *     report "nothing on file" for a project whose severities all sit against
 *     phrases since reworded — and a chip narrowing on that would answer a
 *     question the store cannot answer.
 *   · A second write from a second tab leaving two rows would break the count
 *     the moment anyone judged the same pain twice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import founderValidate from '../src/routes/founder_validate.ts';
import { getPainGroupsView, ensurePainGroupsSchema } from '../src/services/painGroups.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER_USER = 501;
const FOUNDER_ID = 77;
const OTHER_USER = 502;
const PROJECT = 9001;
const OTHER_PROJECT = 9002;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/**
 * The severity table comes FROM MIGRATION 211, not from a hand-written copy.
 * `partner_pipeline_stores.test.ts` learned that the hard way: a shape copied
 * into a test is how a test passes against a schema production does not have.
 */
function migration(name: string): string {
  return readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
}
function tableFromMigration(name: string, table: string): string {
  const src = migration(name);
  const at = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at >= 0, `${table} is no longer created by migration ${name}`);
  return src.slice(at, src.indexOf(');', at) + 2);
}
function indexFromMigration(name: string, idx: string): string {
  const src = migration(name);
  const at = src.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS ${idx}`);
  assert.ok(at >= 0, `${idx} is no longer created by migration ${name}`);
  return src.slice(at, src.indexOf(';', at) + 1);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
                        is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
                        name TEXT, email TEXT, spinout_lab_active INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER NOT NULL, name TEXT);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      interviewee_name TEXT, interviewee_role TEXT, interviewee_company TEXT,
      icp_fit TEXT, quote_consent INTEGER, pains_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  // `pain_groups` AND `pain_group_aliases` COME FROM THE SERVICE THAT OWNS
  // THEM, not from a copy here. The first draft of this file hand-wrote both
  // and left `project_id` off the alias table — so every alias silently failed
  // to load, the two wordings never joined their theme, and the test failed
  // against correct code. Which is the shape of the rule
  // `partner_pipeline_stores.test.ts` states in its own header: a schema copied
  // into a test is how a test comes to pass against one production has not got.
  // Here it failed instead of passing, which was luck rather than design.
  db.exec(tableFromMigration('211_founder_validate_evidence', 'interview_pain_severities'));
  db.exec(indexFromMigration('211_founder_validate_evidence', 'idx_interview_pain_sev_unique'));

  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(FOUNDER_USER, 'founder', FOUNDER_ID, 'f@example.com');
  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(OTHER_USER, 'founder', 88, 'other@example.com');
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)').run(PROJECT, FOUNDER_ID, 'Ours');
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)').run(OTHER_PROJECT, 88, 'Theirs');
  return db;
}

const addInterview = (db: any, id: number, projectId: number, pains: string[]) =>
  db.prepare('INSERT INTO discovery_interviews (id, project_id, pains_json) VALUES (?,?,?)')
    .run(id, projectId, JSON.stringify(pains));

async function env(db: InstanceType<typeof DatabaseSync>) {
  const e = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any;
  // The service bootstraps its own two tables; awaiting it here means a test
  // may seed a curated group before the first read, which is the order a real
  // project is in by the time anyone opens the pain map.
  await ensurePainGroupsSchema(e);
  return e;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function put(e: any, id: number, body: any, who = FOUNDER_USER) {
  const res = await founderValidate.request(`/interviews/${id}/pain-severity`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await token(who, 'founder')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, e);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('a severity written is a severity the pain map reads back', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, 1, PROJECT, ['onboarding takes three weeks']);

  const before = await getPainGroupsView(e, PROJECT);
  assert.equal(before.severity_recorded, false, 'an untouched project reports a severity on file');
  assert.equal(before.ungrouped[0].need_count, 0);

  const r = await put(e, 1, { phrase: 'onboarding takes three weeks', severity: 'need' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const after = await getPainGroupsView(e, PROJECT);
  assert.equal(after.severity_recorded, true, 'the view cannot see the row it was just given');
  assert.equal(after.ungrouped[0].need_count, 1);
  assert.equal(after.ungrouped[0].nice_count, 0);
});

test('the count is of interviews, and a second judgement replaces the first', async () => {
  const db = freshDb();
  const e = await env(db);
  // One interview, one pain, judged twice — the two-tabs case. The unique index
  // is what stops this becoming two rows, and `need_count` counting two people
  // where there is one.
  addInterview(db, 1, PROJECT, ['billing is manual']);
  await put(e, 1, { phrase: 'billing is manual', severity: 'nice' });
  await put(e, 1, { phrase: 'billing is manual', severity: 'need' });

  const rows = db.prepare('SELECT severity FROM interview_pain_severities WHERE interview_id = 1').all();
  assert.equal(rows.length, 1, 'judging the same pain twice left two rows');
  assert.equal((rows[0] as any).severity, 'need', 'the later judgement did not win');

  const view = await getPainGroupsView(e, PROJECT);
  assert.equal(view.ungrouped[0].need_count, 1, 'one interview counted as more than one');
  assert.equal(view.ungrouped[0].nice_count, 0, 'the replaced judgement is still being counted');
});

test('two interviews naming one pain differently count once each, under one theme', async () => {
  const db = freshDb();
  const e = await env(db);
  // The re-grouping case. Two wordings, one curated theme — so the severities
  // have to travel with their phrases into the theme, exactly as the mention
  // counts already do.
  db.prepare('INSERT INTO pain_groups (id, project_id, title) VALUES (?,?,?)').run(1, PROJECT, 'Onboarding');
  const alias = db.prepare(
    'INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?,?,?,?)');
  alias.run(PROJECT, 1, 'slow setup', 'Slow setup');
  alias.run(PROJECT, 1, 'takes weeks to start', 'Takes weeks to start');
  addInterview(db, 1, PROJECT, ['slow setup']);
  addInterview(db, 2, PROJECT, ['takes weeks to start']);

  await put(e, 1, { phrase: 'slow setup', severity: 'need' });
  await put(e, 2, { phrase: 'takes weeks to start', severity: 'need' });

  const view = await getPainGroupsView(e, PROJECT);
  const g = view.groups.find((x) => x.title === 'Onboarding')!;
  assert.equal(g.need_count, 2, 'severities did not follow their phrases into the theme');
  assert.equal(g.count, 2, 'the mention count moved with them or was never right');
});

test('null clears the judgement, and clearing is not the same as "nice"', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, 1, PROJECT, ['no audit trail']);
  await put(e, 1, { phrase: 'no audit trail', severity: 'need' });
  const cleared = await put(e, 1, { phrase: 'no audit trail', severity: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.severity, null);

  const view = await getPainGroupsView(e, PROJECT);
  assert.equal(view.ungrouped[0].need_count, 0);
  assert.equal(view.ungrouped[0].nice_count, 0, 'clearing recorded a nice-to-have instead of nothing');
  // AND THE PROJECT IS BACK TO "nothing on file", which is the state the chip
  // must be able to tell from "everything is optional".
  assert.equal(view.severity_recorded, false, 'a cleared judgement still reports a severity on file');
});

test('a severity survives its phrase being reworded, and still reports as recorded', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, 1, PROJECT, ['exports are broken']);
  await put(e, 1, { phrase: 'exports are broken', severity: 'need' });
  // The founder edits the interview and rewords the pain. The severity is now
  // an orphan: it counts against no theme, and the route deliberately does not
  // delete it, so re-typing the original wording brings the judgement back.
  db.prepare('UPDATE discovery_interviews SET pains_json = ? WHERE id = 1')
    .run(JSON.stringify(['csv export drops rows']));

  const view = await getPainGroupsView(e, PROJECT);
  assert.equal(view.ungrouped[0].need_count, 0, 'an orphaned severity is still being counted');
  assert.equal(view.severity_recorded, true,
    'the project reports nothing on file while a severity row exists — derived from counts, not rows');
});

test('the phrase is normalised, so the display and the stored form reach one row', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, 1, PROJECT, ['Manual  Reconciliation']);
  await put(e, 1, { phrase: 'Manual  Reconciliation', severity: 'need' });
  await put(e, 1, { phrase: 'manual reconciliation', severity: 'nice' });
  const rows = db.prepare('SELECT severity FROM interview_pain_severities WHERE interview_id = 1').all();
  assert.equal(rows.length, 1, 'two spellings of one phrase made two rows');
  assert.equal((rows[0] as any).severity, 'nice');
});

test('another founder cannot judge this venture\'s pains', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, 1, PROJECT, ['slow']);
  const r = await put(e, 1, { phrase: 'slow', severity: 'need' }, OTHER_USER);
  assert.ok(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}`);
  const rows = db.prepare('SELECT * FROM interview_pain_severities').all();
  assert.equal(rows.length, 0, 'another founder wrote a severity onto this venture');
});

test('a severity from another project never reaches this view', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, 1, PROJECT, ['slow']);
  addInterview(db, 2, OTHER_PROJECT, ['slow']);
  // Written straight to the table, bypassing the route, because the point is
  // the VIEW's join: `interview_pain_severities` carries no project of its own.
  db.prepare('INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?,?,?)')
    .run(2, 'slow', 'need');

  const ours = await getPainGroupsView(e, PROJECT);
  assert.equal(ours.ungrouped[0].need_count, 0, 'another project\'s severity is counted here');
  assert.equal(ours.severity_recorded, false, 'another project\'s severity makes this one report rows');
});

test('an unknown severity is refused, and writes nothing', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, 1, PROJECT, ['slow']);
  const r = await put(e, 1, { phrase: 'slow', severity: 'critical' });
  assert.equal(r.status, 400);
  assert.equal(db.prepare('SELECT * FROM interview_pain_severities').all().length, 0);

  const blank = await put(e, 1, { phrase: '   ', severity: 'need' });
  assert.equal(blank.status, 400, 'a phrase of whitespace was accepted');
  assert.equal(db.prepare('SELECT * FROM interview_pain_severities').all().length, 0);
});
