/**
 * D4813 (#4813, package 2) — Cohorts guidance: a week is refused rather than
 * dropped, drafts are their author's alone, publishing, versions with a 409 on
 * a stale write, retire and restore, and the edit history.
 *
 * Fixtures come from `schema_baseline.sql` (the shape production runs) with
 * migration 202611091920 applied on top, except where a test checks that the
 * route heals a database the migration has not reached.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/advisor_guidance_v2_d4813.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import advisors from '../src/routes/advisors.ts';
import { parseGuidanceWeek, guidanceCounts, guidanceStatus } from '../src/routes/_advisor_cohort_helpers.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const NOTICES = read('cloudflare-worker/sql/migrations/367_cohort_advisor_founder_notice.sql');
const V2 = read('cloudflare-worker/sql/migrations/202611091920_cohort_guidance_v2.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const AVA = 10; // advisor, assigned to CYCLE
const BEA = 11; // advisor, also assigned to CYCLE
const CAL = 12; // advisor, assigned to nothing
const FAY = 20; const FIN = 21; // founders in CYCLE
const CYCLE = 1; // four recorded week windows
const OPEN = 2; // no week windows recorded

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
function q(sql: string, binds: any[]) {
  const values: any[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => { values.push(binds[Number(n) - 1]); return '?'; });
  return values.length ? { sql: rewritten, values } : { sql, values: binds };
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const x = q(sql, b); return db.prepare(x.sql).get(...x.values) ?? null; },
        async all() { const x = q(sql, b); return { results: db.prepare(x.sql).all(...x.values) }; },
        async run() {
          const x = q(sql, b);
          const r = db.prepare(x.sql).run(...x.values);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * 3_600_000).toISOString();
const strip = (sql: string) => sql.replace(/^\s*--[^\n]*$/gm, '');

function freshDb({ migrate = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'company_week_status', 'advisor_cohort_assignments', 'notifications_inbox',
    'user_settings', 'week_windows', 'cohort_guidance', 'cohort_guidance_acks', 'advisors']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(strip(NOTICES));
  if (migrate) db.exec(strip(V2));
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(AVA, 'ava@example.test', 'Ava Advisor', 'advisor');
  u.run(BEA, 'bea@example.test', 'Bea Advisor', 'advisor');
  u.run(CAL, 'cal@example.test', 'Cal Advisor', 'advisor');
  u.run(FAY, 'fay@example.test', 'Fay Founder', 'founder');
  u.run(FIN, 'fin@example.test', 'Fin Founder', 'founder');
  const cy = db.prepare('INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status) VALUES (?, ?, ?, ?, ?, ?)');
  cy.run(CYCLE, 2026, 11, iso(-24 * 9), iso(24 * 19), 'active');
  cy.run(OPEN, 2026, 12, iso(24 * 20), iso(24 * 48), 'upcoming');
  const ww = db.prepare('INSERT INTO week_windows (cohort_cycle_id, week_number, unlock_at, deadline_at) VALUES (?, ?, ?, ?)');
  for (let w = 1; w <= 4; w += 1) ww.run(CYCLE, w, iso(-24 * 9 + (w - 1) * 24 * 7), iso(-24 * 2 + (w - 1) * 24 * 7));
  const st = db.prepare(`INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES (?, ?, 1, 'pending')`);
  st.run(FAY, CYCLE); st.run(FIN, CYCLE);
  const asg = db.prepare(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, is_active)
              VALUES (?, ?, ?, ?, 1)`);
  asg.run('asg-ava', AVA, CYCLE, iso(-240));
  asg.run('asg-ava-open', AVA, OPEN, iso(-240));
  asg.run('asg-bea', BEA, CYCLE, iso(-240));
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);

async function call(db: InstanceType<typeof DatabaseSync>, path: string,
  { as = AVA, method = 'GET', body }: { as?: number; method?: string; body?: unknown } = {}) {
  const role = as >= 20 ? 'founder' : 'advisor';
  const tok = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await advisors.request(path, init, env(db), { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const post = (db: any, body: unknown, as = AVA, cycle = CYCLE) =>
  call(db, `/me/cohort/${cycle}/guidance`, { as, method: 'POST', body });
const patch = (db: any, uid: string, body: unknown, as = AVA) =>
  call(db, `/me/guidance/${uid}`, { as, method: 'PATCH', body });
const publish = (db: any, uid: string, body: unknown, as = AVA) =>
  call(db, `/me/guidance/${uid}/publish`, { as, method: 'POST', body });
const list = (db: any, as = AVA, cycle = CYCLE) => call(db, `/me/cohort/${cycle}/guidance`, { as });
const rowCount = (db: any) => (db.prepare('SELECT COUNT(*) AS n FROM cohort_guidance').get() as any).n;

// ── 1. The week ─────────────────────────────────────────────────────────────

test('D4813: parseGuidanceWeek refuses what it cannot read instead of making it general', () => {
  assert.deepEqual(parseGuidanceWeek(undefined, 4), { ok: true, week: null });
  assert.deepEqual(parseGuidanceWeek(null, 4), { ok: true, week: null });
  assert.deepEqual(parseGuidanceWeek('  ', 4), { ok: true, week: null });
  assert.deepEqual(parseGuidanceWeek(3, 4), { ok: true, week: 3 });
  assert.deepEqual(parseGuidanceWeek('4', 4), { ok: true, week: 4 });
  for (const bad of [0, 5, 7, -1, 2.5, '2.5', 'abc', '3 weeks', true, {}, [], 'week 3', 1e3]) {
    const r = parseGuidanceWeek(bad, 4);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} is refused`);
  }
  const r = parseGuidanceWeek(7, 4) as { ok: false; message: string };
  assert.match(r.message, /This cohort has 4 weeks\. Choose a week from 1 to 4, or leave it empty for general guidance\./);
});

test('D4813: an out-of-range or invalid week is refused with a 400, and nothing is stored', async () => {
  const db = freshDb();
  for (const week of [7, 0, 5, 'abc', 2.5, '-1']) {
    const r = await post(db, { body: 'Talk to five customers', week_number: week });
    assert.equal(r.status, 400, `week ${week}`);
    assert.equal(r.body.error, 'guidance_week_invalid');
    assert.equal(r.body.field, 'week_number');
    assert.equal(r.body.max_week, 4, 'the bound is the cohort’s recorded weeks');
    assert.match(r.body.message, /Choose a week from 1 to 4/);
  }
  assert.equal(rowCount(db), 0, 'a refused week is never stored as general guidance');

  const general = await post(db, { body: 'For the whole programme', week_number: '' });
  assert.equal(general.status, 201);
  assert.equal(general.body.week_number, null, 'unstated is general');
  const third = await post(db, { body: 'For week three', week_number: 3 });
  assert.equal(third.status, 201);
  assert.equal(third.body.week_number, 3);

  // Editing the week is checked the same way.
  const bad = await patch(db, third.body.uid, { week_number: 9, version: third.body.version });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'guidance_week_invalid');
  const stored = db.prepare('SELECT week_number FROM cohort_guidance WHERE uid = ?').get(third.body.uid) as any;
  assert.equal(stored.week_number, 3, 'the refused edit left the week alone');
});

test('D4813: a cohort with no recorded week windows keeps the 1–52 bound, refused beyond it', async () => {
  const db = freshDb();
  assert.equal((await post(db, { body: 'Late note', week_number: 52 }, AVA, OPEN)).status, 201);
  const r = await post(db, { body: 'Too late', week_number: 53 }, AVA, OPEN);
  assert.equal(r.status, 400);
  assert.equal(r.body.max_week, 52);
  const g = await list(db, AVA, OPEN);
  assert.deepEqual(g.body.week_limit, { max: 52, source: 'default' });
  assert.deepEqual((await list(db)).body.week_limit, { max: 4, source: 'week_windows' });
});

// ── 2. Drafts are their author's ─────────────────────────────────────────────

test('D4813: a draft is read by its author only — not another advisor on the cohort, not a founder', async () => {
  const db = freshDb();
  const d = await post(db, { title: 'Pricing test checklist', body: 'Decide the one number first.', draft: true });
  assert.equal(d.status, 201);
  assert.equal(d.body.status, 'draft');
  assert.equal(d.body.is_draft, true);
  assert.equal(d.body.title, 'Pricing test checklist');
  assert.equal(d.body.version, 1);

  const mine = await list(db);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.items.map((i: any) => i.uid), [d.body.uid]);
  assert.equal(mine.body.counts.drafts, 1);
  assert.equal(mine.body.counts.broadcast, 0, 'a draft has not been posted to anyone');

  const bea = await list(db, BEA);
  assert.equal(bea.status, 200);
  assert.equal(bea.body.items.length, 0, 'Bea advises the same cohort and still never sees Ava’s draft');
  assert.ok(!JSON.stringify(bea.body).includes('Pricing test checklist'));

  for (const founder of [FAY, FIN]) {
    const f = await list(db, founder);
    assert.equal(f.status, 403, 'a founder cannot read the advisor’s guidance list at all');
    assert.ok(!JSON.stringify(f.body).includes('Pricing test checklist'));
    assert.equal((await call(db, `/me/guidance/${d.body.uid}/history`, { as: founder })).status, 403);
  }
  // Another advisor cannot edit, publish or read the history of it.
  assert.equal((await patch(db, d.body.uid, { body: 'mine now', version: 1 }, BEA)).status, 404);
  assert.equal((await publish(db, d.body.uid, { version: 1 }, BEA)).status, 404);
  assert.equal((await call(db, `/me/guidance/${d.body.uid}/history`, { as: BEA })).status, 404);
});

test('D4813: a draft may be only a title; published guidance needs a body', async () => {
  const db = freshDb();
  assert.equal((await post(db, { title: 'Idea for week 3', draft: true })).status, 201);
  assert.equal((await post(db, { title: 'No body' })).status, 400);
  assert.equal((await post(db, { draft: true })).status, 400);
});

// ── 3. Publish ───────────────────────────────────────────────────────────────

test('D4813: publishing a draft makes it published, stamps the date and records the version', async () => {
  const db = freshDb();
  const d = await post(db, { title: 'Week 2', body: 'Five conversations.', week_number: 2, draft: true });
  db.prepare('UPDATE cohort_guidance SET posted_at = ? WHERE uid = ?').run('2026-01-01T00:00:00.000Z', d.body.uid);

  assert.equal((await publish(db, d.body.uid, {})).status, 400, 'publish names the version it was made against');
  const p = await publish(db, d.body.uid, { version: 1 });
  assert.equal(p.status, 200);
  assert.equal(p.body.item.status, 'published');
  assert.equal(p.body.item.version, 2);
  assert.notEqual(p.body.item.posted_at, '2026-01-01T00:00:00.000Z', 'the published date is when it reached the batch');

  const again = await publish(db, d.body.uid, { version: 2 });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'guidance_not_draft');

  const g = await list(db);
  assert.equal(g.body.counts.broadcast, 1);
  assert.equal(g.body.counts.drafts, 0);
});

test('D4813: publishing needs the assignment as it stands; editing your own words does not', async () => {
  const db = freshDb();
  const d = await post(db, { body: 'Draft before access ended', draft: true });
  db.prepare('UPDATE advisor_cohort_assignments SET is_active = 0 WHERE advisor_user_id = ? AND cohort_cycle_id = ?').run(AVA, CYCLE);
  const p = await publish(db, d.body.uid, { version: 1 });
  assert.equal(p.status, 403, 'nothing new reaches founders an advisor no longer advises');
  const e = await patch(db, d.body.uid, { body: 'Still mine to edit', version: 1 });
  assert.equal(e.status, 200);
  assert.equal((await post(db, { body: 'New' })).status, 403, 'and nothing new is written to the cohort');
});

// ── 4. Versions ──────────────────────────────────────────────────────────────

test('D4813: an edit against a stale version is refused with 409 and the row as it stands', async () => {
  const db = freshDb();
  const g = await post(db, { title: 'Original', body: 'First words' });
  const uid = g.body.uid;

  const noVersion = await patch(db, uid, { body: 'Who am I racing?' });
  assert.equal(noVersion.status, 400);
  assert.equal(noVersion.body.error, 'guidance_version_required');

  const tabA = await patch(db, uid, { title: 'Tab A title', body: 'Tab A words', version: 1 });
  assert.equal(tabA.status, 200);
  assert.equal(tabA.body.item.version, 2);
  assert.equal(tabA.body.item.title, 'Tab A title');

  const tabB = await patch(db, uid, { body: 'Tab B words', version: 1 });
  assert.equal(tabB.status, 409);
  assert.equal(tabB.body.error, 'guidance_version_conflict');
  assert.equal(tabB.body.current.body, 'Tab A words', 'the page gets what is there now, to compare');
  assert.equal(tabB.body.current.version, 2);
  const stored = db.prepare('SELECT body, version FROM cohort_guidance WHERE uid = ?').get(uid) as any;
  assert.equal(stored.body, 'Tab A words', 'the stale write changed nothing');
  assert.equal(stored.version, 2);

  // Clearing a title is an edit too.
  const cleared = await patch(db, uid, { title: null, version: 2 });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.item.title, null);
  assert.equal((await patch(db, uid, { version: 'x', retired: true })).status, 400);
});

test('D4813: a page that predates versions can still answer and retire, checked against the row as read', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, asked_by_user_id, body)
              VALUES ('q1', ?, ?, ?, 'Should the pricing test include annual plans?')`).run(CYCLE, AVA, FAY);
  const a = await patch(db, 'q1', { answer: 'Monthly only for now.' });
  assert.equal(a.status, 200);
  assert.equal(a.body.item.answer, 'Monthly only for now.');
  assert.ok(a.body.item.answered_at);
  const r = await patch(db, 'q1', { retired: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.status, 'retired');
});

// ── 5. Retire and restore ────────────────────────────────────────────────────

test('D4813: retire and restore are versioned and keep the guidance', async () => {
  const db = freshDb();
  const g = await post(db, { title: 'Old template', body: 'Use the old template.', week_number: 1 });
  const r = await patch(db, g.body.uid, { retired: true, version: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.status, 'retired');
  assert.equal(r.body.item.version, 2);
  const after = await list(db);
  assert.equal(after.body.items.length, 1, 'retired is still listed; the page filters it');
  assert.equal(after.body.items[0].status, 'retired');
  assert.equal(after.body.counts.broadcast, 0);

  assert.equal((await patch(db, g.body.uid, { retired: false, version: 1 })).status, 409, 'stale restore');
  const back = await patch(db, g.body.uid, { retired: false, version: 2 });
  assert.equal(back.status, 200);
  assert.equal(back.body.item.status, 'published');
  assert.equal(back.body.item.retired_at, null);
});

// ── 6. History ───────────────────────────────────────────────────────────────

test('D4813: every change appends a version to the history, newest first', async () => {
  const db = freshDb();
  const d = await post(db, { title: 'v1', body: 'one', draft: true });
  await patch(db, d.body.uid, { body: 'two', version: 1 });
  await publish(db, d.body.uid, { version: 2 });
  await patch(db, d.body.uid, { retired: true, version: 3 });
  await patch(db, d.body.uid, { retired: false, version: 4 });
  const h = await call(db, `/me/guidance/${d.body.uid}/history`);
  assert.equal(h.status, 200);
  assert.equal(h.body.version, 5);
  assert.deepEqual(h.body.items.map((v: any) => [v.version, v.action]),
    [[5, 'restored'], [4, 'retired'], [3, 'published'], [2, 'edited'], [1, 'created']]);
  assert.equal(h.body.items.find((v: any) => v.version === 1).body, 'one', 'what it said then is kept');
  assert.equal(h.body.items.find((v: any) => v.version === 2).is_draft, true);
  assert.equal(h.body.items.find((v: any) => v.version === 3).is_draft, false);
  assert.throws(() => db.exec(`INSERT INTO cohort_guidance_versions (guidance_id, version, action, body)
    VALUES (${(db.prepare('SELECT id FROM cohort_guidance').get() as any).id}, 2, 'edited', 'fork')`), /UNIQUE/,
  'a version is written once');
});

test('D4813: the migration backfills rows written before it, untitled and published at version 1', () => {
  const db = freshDb({ migrate: false });
  db.prepare(`INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, body, week_number)
              VALUES ('old', ?, ?, 'Posted before titles existed', 2)`).run(CYCLE, AVA);
  db.exec(strip(V2));
  const row = db.prepare('SELECT title, is_draft, version FROM cohort_guidance WHERE uid = ?').get('old') as any;
  assert.deepEqual({ ...row }, { title: null, is_draft: 0, version: 1 });
  const v = db.prepare('SELECT version, action, body, week_number FROM cohort_guidance_versions').all() as any[];
  assert.deepEqual(v.map((x) => ({ ...x })), [{ version: 1, action: 'backfilled', body: 'Posted before titles existed', week_number: 2 }]);
});

test('D4813: the route heals a database the migration has not reached', async () => {
  const db = freshDb({ migrate: false });
  const d = await post(db, { title: 'Healed', body: 'Works without the migration', draft: true });
  assert.equal(d.status, 201);
  assert.equal(d.body.status, 'draft');
  const cols = (db.prepare('PRAGMA table_info(cohort_guidance)').all() as any[]).map((c) => c.name);
  for (const c of ['title', 'is_draft', 'version']) assert.ok(cols.includes(c), c);
});

// ── 7. Assignment and founder visibility ─────────────────────────────────────

test('D4813: only an assigned advisor writes; a founder and an unassigned advisor are refused', async () => {
  const db = freshDb();
  assert.equal((await post(db, { body: 'x' }, CAL)).status, 403);
  assert.equal((await post(db, { body: 'x', draft: true }, FAY)).status, 403);
  assert.equal((await list(db, CAL)).status, 403);
  assert.equal(rowCount(db), 0);
});

test('D4813: a founder who opted out of an advisor is still left out of who acted', async () => {
  const db = freshDb();
  const g = await post(db, { title: 'Week 2', body: 'Talk to customers' });
  const id = (db.prepare('SELECT id FROM cohort_guidance WHERE uid = ?').get(g.body.uid) as any).id;
  db.prepare('INSERT INTO cohort_guidance_acks (guidance_id, founder_user_id) VALUES (?, ?)').run(id, FAY);
  db.prepare('INSERT INTO cohort_guidance_acks (guidance_id, founder_user_id) VALUES (?, ?)').run(id, FIN);
  db.prepare('INSERT INTO cohort_advisor_optouts (founder_user_id, advisor_user_id) VALUES (?, ?)').run(FIN, AVA);
  const r = await list(db);
  assert.deepEqual(r.body.items[0].acted_by.map((a: any) => a.user_id), [FAY]);
  assert.ok(!JSON.stringify(r.body).includes('Fin Founder'));
  assert.equal(r.body.acknowledgements_recorded, false, 'no founder surface writes an acknowledgement yet');
});

test('D4813: status is derived; drafts are neither posted, open nor in the response time', () => {
  assert.equal(guidanceStatus({ retired_at: null, is_draft: 1 }), 'draft');
  assert.equal(guidanceStatus({ retired_at: '2026-11-01', is_draft: 1 }), 'retired');
  assert.equal(guidanceStatus({ retired_at: null, is_draft: 0 }), 'published');
  const base = { asked_by_user_id: null, answer: null, posted_at: '2026-11-01T00:00:00Z', answered_at: null, retired_at: null };
  const c = guidanceCounts([
    { ...base, id: 1, is_draft: 1 }, { ...base, id: 2, is_draft: 0 }, { ...base, id: 3 },
  ]);
  assert.equal(c.drafts, 1);
  assert.equal(c.broadcast, 2, 'a row read before the migration (no is_draft) is published');
});
