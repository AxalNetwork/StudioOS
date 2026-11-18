/**
 * D7118 (#7118): Wellness reflections by cadence. The real router on
 * node:sqlite, with the table built from its own migration.
 *
 * The acceptance list of #7118: two days in one week, overlapping weekly and
 * monthly periods, a retry, month-end and time zone boundaries, earlier
 * (legacy) check-ins, failure recovery, isolation across users, and the
 * suppressed aggregate cohort.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import reflections, { reflectionBody } from '../src/routes/wellbeing_reflections.ts';
import wellbeing from '../src/routes/wellbeing.ts';
import { localDay, periodOf, periodProblem, currentPeriods } from '../src/services/wellbeing/reflectionPeriods.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIA = 1, OTTO = 2, ADMIN = 3, INVESTOR = 4;
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611171643_7118_wellbeing_reflections.sql'), 'utf8');
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};
const TZ = 'Europe/Paris';
// A fixed clock: Tuesday 17 November 2026, noon UTC, for every test here.
const NOW = Date.parse('2026-11-17T12:00:00Z');
test.beforeEach(() => { mock.timers.enable({ apis: ['Date'], now: NOW }); });
test.afterEach(() => { mock.timers.reset(); });

function setup() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
           CREATE TABLE user_licences (user_id INTEGER, licence TEXT);`);
  db.exec(ddl('wellbeing_daily_pulses'));
  for (const col of ['mood_plain INTEGER', 'stress_plain INTEGER', 'sleep_plain INTEGER', 'energy_plain INTEGER', 'focus_plain INTEGER',
    'social_plain INTEGER', 'free_text_plain TEXT', 'tags_plain TEXT', 'support_enc TEXT', 'decisions_enc TEXT', 'support_plain INTEGER', 'decisions_plain INTEGER']) {
    try { db.exec(`ALTER TABLE wellbeing_daily_pulses ADD COLUMN ${col}`); } catch { /* already in the baseline */ }
  }
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, role, email, name) VALUES (?, ?, ?, ?)');
  u.run(MIA, 'founder', 'mia@example.test', 'Mia');
  u.run(OTTO, 'founder', 'otto@example.test', 'Otto');
  u.run(ADMIN, 'admin', 'admin@example.test', 'Ada');
  u.run(INVESTOR, 'investor', 'inv@example.test', 'Ivy');
  return db;
}
const envOf = (db: any, extra: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra }) as any;
const ROLE: Record<number, string> = { [MIA]: 'founder', [OTTO]: 'founder', [ADMIN]: 'admin', [INVESTOR]: 'investor' };

async function call(router: any, e: any, method: string, path: string, who: number, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await router.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, text, headers: res.headers };
}
const r = (e: any, method: string, path: string, who: number, body?: unknown) => quiet(() => call(reflections, e, method, path, who, body));
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, er = console.error, i = console.info, l = console.log;
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = er; console.info = i; console.log = l; }
};
const save = (e: any, who: number, cadence: string, period: string, body: Record<string, unknown>) =>
  r(e, 'PUT', `/${cadence}/${period}`, who, { timezone: TZ, ...body });

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

test('periods: a week is Monday to Sunday, a month ends on its own last day, leap years included', () => {
  assert.deepEqual(periodOf('week', '2026-11-19'), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(periodOf('week', '2026-11-16'), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(periodOf('week', '2026-11-22'), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(periodOf('month', '2026-11-30'), { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(periodOf('month', '2028-02-10'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(periodOf('month', '2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
  // A week that crosses a month end belongs to both the weeks and the month list, filed once.
  assert.deepEqual(periodOf('week', '2026-12-01'), { start: '2026-11-30', end: '2026-12-06' });
});

test('periods: today is the member\'s own date, across the date line and a month end', () => {
  const now = new Date('2026-11-30T23:30:00Z');
  assert.equal(localDay(now, 'UTC'), '2026-11-30');
  assert.equal(localDay(now, 'Europe/Paris'), '2026-12-01');
  assert.equal(localDay(now, 'America/Los_Angeles'), '2026-11-30');
  const paris = currentPeriods(now, 'Europe/Paris');
  assert.equal(paris.month.start, '2026-12-01');
  assert.equal(paris.week.start, '2026-11-30');
});

test('periods: a write names the period by its first day, and never a future or impossible one', () => {
  assert.equal(periodProblem('day', '2026-11-17', '2026-11-17'), null);
  assert.equal(periodProblem('week', '2026-11-18', '2026-11-20')?.code, 'period_not_aligned');
  assert.equal(periodProblem('month', '2026-11-02', '2026-11-20')?.code, 'period_not_aligned');
  assert.equal(periodProblem('day', '2026-11-18', '2026-11-17')?.code, 'period_in_future');
  assert.equal(periodProblem('day', '2026-02-30', '2026-11-17')?.code, 'invalid_period');
  assert.equal(periodProblem('day', '2019-12-31', '2026-11-17')?.code, 'period_too_early');
});

test('body: an empty reflection, a bad zone, an unknown question and an out-of-range score are refused', () => {
  assert.equal((reflectionBody({ timezone: TZ }) as any).code, 'reflection_empty');
  assert.equal((reflectionBody({ timezone: 'Mars/Olympus', text: 'x' }) as any).code, 'invalid_timezone');
  assert.equal((reflectionBody({ timezone: TZ, scores: { wealth: 3 } }) as any).code, 'invalid_scores');
  assert.equal((reflectionBody({ timezone: TZ, scores: { mood: 6 } }) as any).code, 'invalid_scores');
  assert.equal((reflectionBody({ timezone: TZ, text: '   ' }) as any).code, 'reflection_empty');
  const ok = reflectionBody({ timezone: TZ, topics: ['sleep', 'sleep', ' rest '] }) as any;
  assert.deepEqual(ok.topics, ['sleep', 'rest']);
});

// ---------------------------------------------------------------------------
// Writes and history
// ---------------------------------------------------------------------------

test('two days in one week stay two days, and a weekly save replaces neither', async () => {
  const e = envOf(setup());
  assert.equal((await save(e, MIA, 'day', '2026-11-16', { scores: { mood: 2 }, text: 'Monday was long' })).status, 201);
  assert.equal((await save(e, MIA, 'day', '2026-11-17', { scores: { mood: 4 }, text: 'Better today' })).status, 201);
  const week = await save(e, MIA, 'week', '2026-11-16', { scores: { stress: 3 }, text: 'The week so far' });
  assert.equal(week.status, 201);
  assert.equal(week.body.period_end, '2026-11-22');

  const days = await r(e, 'GET', '/?cadence=day', MIA);
  assert.equal(days.status, 200);
  assert.deepEqual(days.body.reflections.map((x: any) => [x.period_start, x.text]),
    [['2026-11-17', 'Better today'], ['2026-11-16', 'Monday was long']]);
  const weeks = await r(e, 'GET', '/?cadence=week', MIA);
  assert.deepEqual(weeks.body.reflections.map((x: any) => x.period_start), ['2026-11-16'], 'history shows only the week');
  assert.ok(days.body.reflections.every((x: any) => x.cadence === 'day'), 'a week reached the daily history');
});

test('a week across a month end and the month it overlaps are separate records, cited once each', async () => {
  const e = envOf(setup());
  assert.equal((await save(e, MIA, 'day', '2026-10-31', { topics: ['sleep'] })).status, 201);
  assert.equal((await save(e, MIA, 'week', '2026-10-26', { text: 'Crossing into November' })).status, 201);
  assert.equal((await save(e, MIA, 'month', '2026-10-01', { text: 'October' })).status, 201);
  assert.equal((await save(e, MIA, 'day', '2026-10-12', { topics: ['sleep', 'focus'] })).status, 201);
  const oct = await r(e, 'GET', '/months/2026-10/summary', MIA);
  assert.equal(oct.status, 200);
  assert.equal(oct.body.days_in_month, 31);
  assert.equal(oct.body.days_recorded, 2, 'only recorded days are counted');
  assert.deepEqual(oct.body.days.map((d: any) => d.period_start), ['2026-10-12', '2026-10-31']);
  assert.deepEqual(oct.body.weeks.map((w: any) => [w.period_start, w.period_end]), [['2026-10-26', '2026-11-01']]);
  assert.equal(oct.body.month_reflection?.period_start, '2026-10-01');
  assert.deepEqual(oct.body.topics, [{ topic: 'sleep', days: 2 }, { topic: 'focus', days: 1 }]);
  assert.ok(!oct.text.includes('October"') && !oct.text.includes('Crossing'), 'the summary cites periods, not prose');
  const nov = await r(e, 'GET', '/months/2026-11/summary', MIA);
  assert.deepEqual(nov.body.weeks.map((w: any) => w.period_start), ['2026-10-26'], 'the crossing week touches November too');
  assert.equal(nov.body.days_recorded, 0);
  assert.equal(nov.body.month_reflection, null);
  const future = await save(e, MIA, 'day', '2099-01-01', { text: 'later' });
  assert.equal(future.status, 400);
  assert.equal(future.body.error, 'period_in_future');
  const misaligned = await save(e, MIA, 'week', '2026-10-28', { text: 'a Wednesday' });
  assert.equal(misaligned.body.error, 'period_not_aligned');
});

test('an edit needs the revision it was made from; a stale copy is refused, never applied', async () => {
  const e = envOf(setup());
  const first = await save(e, MIA, 'day', '2026-11-17', { text: 'first' });
  assert.equal(first.body.revision, 1);
  const again = await save(e, MIA, 'day', '2026-11-17', { text: 'a second create' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'reflection_changed');
  assert.equal(again.body.current_revision, 1);
  const edit = await save(e, MIA, 'day', '2026-11-17', { text: 'edited', base_revision: 1 });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.revision, 2);
  const stale = await save(e, MIA, 'day', '2026-11-17', { text: 'from another tab', base_revision: 1 });
  assert.equal(stale.status, 409);
  const now = await r(e, 'GET', '/day/2026-11-17', MIA);
  assert.equal(now.body.text, 'edited');
});

test('a retry with the same request id writes once and returns the stored row', async () => {
  const e = envOf(setup());
  const a = await save(e, MIA, 'day', '2026-11-17', { text: 'once', request_id: 'req-1' });
  assert.equal(a.status, 201);
  const b = await save(e, MIA, 'day', '2026-11-17', { text: 'once', request_id: 'req-1' });
  assert.equal(b.status, 200);
  assert.equal(b.body.replayed, true);
  assert.equal(b.body.revision, 1);
  const edit = await save(e, MIA, 'day', '2026-11-17', { text: 'twice', base_revision: 1, request_id: 'req-2' });
  const retry = await save(e, MIA, 'day', '2026-11-17', { text: 'twice', base_revision: 1, request_id: 'req-2' });
  assert.equal(edit.body.revision, 2);
  assert.equal(retry.body.revision, 2, 'the retried edit was applied twice');
});

test('time zone: a day already written is edited, not duplicated, from another zone, and keeps its zone', async () => {
  const e = envOf(setup());
  await save(e, MIA, 'day', '2026-11-16', { text: 'from Paris' });
  const ny = await r(e, 'PUT', '/day/2026-11-16', MIA, { timezone: 'America/New_York', text: 'from New York', base_revision: 1 });
  assert.equal(ny.status, 200);
  assert.equal(ny.body.timezone, TZ, 'the row moved zone');
  const list = await r(e, 'GET', '/?cadence=day', MIA);
  assert.equal(list.body.reflections.length, 1);
});

test('today: the heart reads the member\'s own day, week and month with their reflections', async () => {
  const e = envOf(setup());
  const today = localDay(new Date(), TZ);
  const p = currentPeriods(new Date(), TZ);
  await save(e, MIA, 'day', today, { text: 'today' });
  const t = await r(e, 'GET', `/today?tz=${encodeURIComponent(TZ)}`, MIA);
  assert.equal(t.status, 200);
  assert.equal(t.body.today, today);
  assert.equal(t.body.day.reflection?.text, 'today');
  assert.equal(t.body.week.period_start, p.week.start);
  assert.equal(t.body.week.reflection, null, 'a day was read as the week');
  assert.equal(t.body.month.reflection, null);
  assert.equal((await r(e, 'GET', '/today?tz=Nowhere%2FLand', MIA)).status, 400);
});

// ---------------------------------------------------------------------------
// Protection and failure
// ---------------------------------------------------------------------------

test('stored encrypted: no answer, word or topic is in the row in plain text', async () => {
  const db = setup(); const e = envOf(db);
  await save(e, MIA, 'day', '2026-11-17', { scores: { mood: 4 }, text: 'a very private sentence', topics: ['grief'] });
  const row = db.prepare('SELECT * FROM wellbeing_reflections').get() as any;
  const dump = JSON.stringify(row);
  assert.ok(!dump.includes('private sentence') && !dump.includes('grief') && !/"mood"/.test(dump), dump);
  assert.ok(row.scores_enc && row.text_enc && row.topics_enc);
});

test('when the cipher is unavailable nothing is stored and the refusal says the words are kept', async () => {
  const db = setup();
  const e = { ENVIRONMENT: 'development', DB: d1Over(db), JWT_SECRET } as any;
  // A token signed with the secret, then an env with no cipher secret at all.
  const tok = await new SignJWT({ user_id: MIA, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const noCipher = { ...e, JWT_SECRET, AXAL_ENCRYPTION_SECRET: undefined };
  const original = crypto.subtle.encrypt.bind(crypto.subtle);
  (crypto.subtle as any).encrypt = async () => { throw new Error('cipher down'); };
  let res: Response;
  try {
    res = await quiet(() => reflections.request('/day/2026-11-17', {
      method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: TZ, text: 'keep me safe' }),
    }, noCipher) as Promise<Response>);
  } finally { (crypto.subtle as any).encrypt = original; }
  const body: any = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'reflection_protection_unavailable');
  assert.match(body.message, /words are kept/);
  assert.ok(!JSON.stringify(body).includes('keep me safe'));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM wellbeing_reflections').get() as any).n, 0, 'a plaintext row was stored');
});

test('a failed read is 503 with its code, never an empty history', async () => {
  const db = setup();
  const real: any = d1Over(db);
  const DB = { ...real, prepare(sql: string) { if (/wellbeing_reflections/.test(sql)) throw new Error('D1_ERROR: disk'); return real.prepare(sql); } };
  const e = { JWT_SECRET, ENVIRONMENT: 'development', DB } as any;
  for (const path of ['/?cadence=day', `/today?tz=${encodeURIComponent(TZ)}`, '/months/2026-11/summary', '/day/2026-11-17']) {
    const x = await r(e, 'GET', path, MIA);
    assert.equal(x.status, 503, path);
    assert.equal(x.body.error, 'reflections_unreadable', path);
    assert.ok(!('reflections' in x.body) && !('day' in x.body) && !('days' in x.body), `${path} answered an empty shape`);
    assert.ok(!x.text.includes('disk'), `${path} leaked the raw error`);
  }
  const w = await save(e, MIA, 'day', '2026-11-17', { text: 'still here' });
  assert.equal(w.status, 503);
  assert.equal(w.body.error, 'reflection_not_saved');
});

// ---------------------------------------------------------------------------
// Isolation, deletion, export, earlier check-ins
// ---------------------------------------------------------------------------

test('isolation: a member reads, edits and deletes only their own reflections', async () => {
  const e = envOf(setup());
  const mine = await save(e, MIA, 'day', '2026-11-17', { text: 'Mia only' });
  await save(e, OTTO, 'day', '2026-11-17', { text: 'Otto only' });
  const ottoList = await r(e, 'GET', '/?cadence=day', OTTO);
  assert.deepEqual(ottoList.body.reflections.map((x: any) => x.text), ['Otto only']);
  const ottoDay = await r(e, 'GET', '/day/2026-11-17', OTTO);
  assert.equal(ottoDay.body.text, 'Otto only');
  assert.equal((await r(e, 'DELETE', `/${mine.body.uid}`, OTTO)).status, 404, 'another member deleted it');
  assert.equal((await r(e, 'GET', '/day/2026-11-17', MIA)).body.text, 'Mia only');
  assert.equal((await r(e, 'GET', '/?cadence=day', INVESTOR)).status, 403);
});

test('delete removes the reflection; the period can be written again from revision 0', async () => {
  const e = envOf(setup());
  const a = await save(e, MIA, 'week', '2026-11-16', { text: 'to remove' });
  assert.equal((await r(e, 'DELETE', `/${a.body.uid}`, MIA)).status, 200);
  assert.equal((await r(e, 'GET', '/week/2026-11-16', MIA)).status, 404);
  assert.equal((await r(e, 'DELETE', `/${a.body.uid}`, MIA)).status, 404);
  assert.equal((await save(e, MIA, 'week', '2026-11-16', { text: 'again' })).status, 201);
});

test('earlier check-ins keep their dates, are labelled, and are never filed as a day or a week', async () => {
  const db = setup(); const e = envOf(db);
  const enc = await encryptString({ JWT_SECRET }, 'from before');
  db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, free_text_enc, mood_plain, created_at)
              VALUES ('old1', ?, '2026-10-06', ?, 3, '2026-10-06 20:00:00')`).run(MIA, enc);
  db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, mood_plain, created_at)
              VALUES ('old2', ?, '2026-10-07', 2, '2026-10-07 20:00:00')`).run(OTTO);
  const earlier = await r(e, 'GET', '/earlier', MIA);
  assert.equal(earlier.status, 200);
  assert.deepEqual(earlier.body.earlier.map((x: any) => [x.uid, x.day, x.kind, x.text]), [['old1', '2026-10-06', 'earlier_checkin', 'from before']]);
  assert.equal(earlier.body.earlier[0].week_start, '2026-10-05');
  assert.equal((await r(e, 'GET', '/?cadence=day', MIA)).body.reflections.length, 0);
  assert.equal((await r(e, 'GET', '/?cadence=week', MIA)).body.reflections.length, 0);
  assert.equal((await r(e, 'GET', '/months/2026-10/summary', MIA)).body.days_recorded, 0);
  assert.equal((await r(e, 'DELETE', '/earlier/old2', MIA)).status, 404, 'deleted another member\'s check-in');
  assert.equal((await r(e, 'DELETE', '/earlier/old1', MIA)).status, 200);
  assert.equal((await r(e, 'GET', '/earlier', MIA)).body.earlier.length, 0);
});

test('export: every own reflection and earlier check-in, as a file, with the retention rule', async () => {
  const db = setup(); const e = envOf(db);
  await save(e, MIA, 'day', '2026-11-17', { text: 'mine' });
  await save(e, OTTO, 'day', '2026-11-17', { text: 'not mine' });
  db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, mood_plain) VALUES ('old1', ?, '2026-10-06', 3)`).run(MIA);
  const x = await r(e, 'GET', '/export', MIA);
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-disposition') || '', /attachment/);
  assert.equal(x.headers.get('cache-control'), 'no-store');
  assert.deepEqual(x.body.reflections.map((y: any) => y.text), ['mine']);
  assert.deepEqual(x.body.earlier_checkins.map((y: any) => y.uid), ['old1']);
  assert.equal(x.body.retention.rule, 'until_deleted');
  assert.ok(!x.text.includes('not mine'));
});

// ---------------------------------------------------------------------------
// HQ aggregate
// ---------------------------------------------------------------------------

async function seedCohort(db: any, e: any, members: number) {
  const u = db.prepare('INSERT INTO users (id, role, email) VALUES (?, ?, ?)');
  for (let i = 0; i < members; i++) {
    const id = 100 + i;
    u.run(id, 'founder', `m${i}@example.test`);
    ROLE[id] = 'founder';
    await save(e, id, 'day', localDay(new Date(), TZ), { scores: { mood: 4 }, text: `secret ${i}`, topics: ['burnout'] });
  }
}

test('aggregate: reflections join the pulse, a cohort under seven stays suppressed, and no text or topic is read', async () => {
  const db = setup(); const e = envOf(db);
  await seedCohort(db, e, 6);
  const small = await quiet(() => call(wellbeing, e, 'GET', '/aggregate?days=30', ADMIN));
  assert.equal(small.status, 200);
  assert.equal(small.body.insufficient_data, true);
  assert.equal(small.body.averages, null);
  const db2 = setup(); const e2 = envOf(db2);
  await seedCohort(db2, e2, 7);
  const big = await quiet(() => call(wellbeing, e2, 'GET', '/aggregate?days=30', ADMIN));
  assert.equal(big.body.insufficient_data, false);
  assert.equal(big.body.averages.mood, 4);
  assert.ok(!big.text.includes('secret') && !big.text.includes('burnout'));
  assert.equal((await quiet(() => call(wellbeing, e2, 'GET', '/aggregate?days=30', MIA))).status, 403);
});

test('aggregate: the cohort counts members across earlier check-ins and reflections once each', async () => {
  const db = setup(); const e = envOf(db);
  await seedCohort(db, e, 4);
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, mood_plain, created_at) VALUES (?, ?, ?, 2, datetime('now'))`)
      .run(`p${i}`, 100 + i, localDay(new Date(), 'UTC'));
  }
  const still = await quiet(() => call(wellbeing, e, 'GET', '/aggregate?days=30', ADMIN));
  assert.equal(still.body.insufficient_data, true, 'a member in both stores counted twice');
  for (let i = 0; i < 3; i++) {
    db.prepare('INSERT INTO users (id, role, email) VALUES (?, ?, ?)').run(200 + i, 'founder', `p${i}@example.test`);
    db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, mood_plain, created_at) VALUES (?, ?, ?, 2, datetime('now'))`)
      .run(`q${i}`, 200 + i, localDay(new Date(), 'UTC'));
  }
  const now = await quiet(() => call(wellbeing, e, 'GET', '/aggregate?days=30', ADMIN));
  assert.equal(now.body.insufficient_data, false, 'seven distinct members across both stores');
});
