/**
 * D7119 (#7119): Wellness preferences, topic consent and recommendations, on
 * the real routers over node:sqlite. The expert tables are the baseline's
 * DDL; the new tables come from their migrations.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import { preferences, recommendations, preferenceChange } from '../src/routes/wellbeing_recommendations.ts';
import reflections from '../src/routes/wellbeing_reflections.ts';
import wellbeing from '../src/routes/wellbeing.ts';
import { DEFAULT_PREFERENCES, consentedTopics, recommend, usableTopics, wantedCategories } from '../src/services/wellbeing/recommend.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIA = 1, OTTO = 2, INVESTOR = 4;
const ROLE: Record<number, string> = { [MIA]: 'founder', [OTTO]: 'founder', [INVESTOR]: 'investor' };
const TZ = 'Europe/Paris';
const NOW = Date.parse('2026-11-17T12:00:00Z');
test.beforeEach(() => { mock.timers.enable({ apis: ['Date'], now: NOW }); });
test.afterEach(() => { mock.timers.reset(); });

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};

type Seen = { sql: string[] };
function setup() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
           CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, payload TEXT, created_at TEXT);`);
  for (const t of ['experts', 'expert_services', 'expert_availability', 'expert_bookings', 'expert_ratings', 'expert_profile_views', 'wellbeing_daily_pulses']) db.exec(ddl(t));
  for (const col of ['tags_plain TEXT', 'free_text_plain TEXT', 'mood_plain INTEGER']) {
    try { db.exec(`ALTER TABLE wellbeing_daily_pulses ADD COLUMN ${col}`); } catch { /* in the baseline */ }
  }
  db.exec(read('cloudflare-worker/sql/migrations/202611171643_7118_wellbeing_reflections.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/202611171711_7119_wellbeing_preferences.sql'));
  // D7120 — recommendations also read upcoming group sessions.
  db.exec(read('cloudflare-worker/sql/migrations/202611171724_7120_wellbeing_group_sessions.sql'));
  const u = db.prepare('INSERT INTO users (id, role, email, name, subscription_tier) VALUES (?, ?, ?, ?, ?)');
  u.run(MIA, 'founder', 'mia@example.test', 'Mia', 'growth');
  u.run(OTTO, 'founder', 'otto@example.test', 'Otto', 'growth');
  u.run(INVESTOR, 'investor', 'inv@example.test', 'Ivy', 'growth');
  const e = db.prepare(`INSERT INTO experts (uid, name, headline, is_active, verified, profile_completion_pct, hidden_by_admin,
                          categories_json, languages_json, timezones_json, calendly_url, first_session_free)
                        VALUES (?, ?, 'Synthetic', 1, ?, 90, ?, ?, ?, '["Europe/Paris"]', ?, 0)`);
  // id 1..8
  e.run('diet', 'Dana Dietitian', 1, 0, '["dietitian"]', '["en"]', null);
  e.run('nutr-fr', 'Noé Nutrition', 1, 0, '["nutritionist"]', '["fr"]', null);
  e.run('nutr-en', 'Nia Nutrition', 1, 0, '["nutritionist"]', '["en"]', null);
  e.run('coach', 'Cole Coach', 1, 0, '["executive_coach","sleep_coach"]', '["en"]', 'https://cal.example.test/cole');
  e.run('therapist', 'Theo Therapist', 1, 0, '["therapist_clinical"]', '["en"]', null);
  e.run('spirit', 'Sol Spirit', 1, 0, '["spiritual_philosophical_advisor"]', '["en"]', null);
  e.run('sample-x', 'Sample Person', 1, 0, '["nutritionist"]', '["en"]', null);
  e.run('hidden', 'Hidden Person', 1, 1, '["nutritionist"]', '["en"]', null);
  db.prepare(`UPDATE experts SET uid = 'seed_' || uid WHERE uid = 'sample-x'`).run();
  const s = db.prepare(`INSERT INTO expert_services (uid, expert_id, title, duration_minutes, price_cents, currency, is_active, sort_order) VALUES (?, ?, ?, 50, ?, 'usd', 1, 1)`);
  s.run('s-diet', 1, 'Dietetic consult', 12000);
  s.run('s-nfr', 2, 'Nutrition chat', 6000);
  s.run('s-nen', 3, 'Nutrition chat', 25000);
  s.run('s-coach', 4, 'Coaching', 9000);
  s.run('s-ther', 5, 'Therapy session', 14000);
  db.prepare(`INSERT INTO expert_availability (uid, expert_id, day_of_week, start_minute, end_minute, timezone) VALUES ('av1', 1, 2, 540, 720, 'Europe/Paris')`).run();
  return db;
}

/** A DB that records every statement, so a test can say a table was never read. */
function spied(db: any): { DB: any; seen: Seen } {
  const real: any = d1Over(db);
  const seen: Seen = { sql: [] };
  return { seen, DB: { ...real, prepare(sql: string) { seen.sql.push(sql); return real.prepare(sql); }, batch: real.batch?.bind(real) } };
}
const envOf = (DB: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB }) as any;

async function call(router: any, e: any, method: string, path: string, who: number, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const w = console.warn, er = console.error, i = console.info, l = console.log;
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try {
    const res = await router.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  } finally { console.warn = w; console.error = er; console.info = i; console.log = l; }
}
const prefs = (e: any, who: number, body: unknown) => call(preferences, e, 'PUT', '/', who, body);
const recs = (e: any, who: number) => call(recommendations, e, 'GET', '/', who);
const uids = (r: any) => (r.body.items || []).map((x: any) => x.uid);
// A read of a member's records: a SELECT naming either journal table. The
// Wellbeing schema bootstrap's DDL is not a read.
const readsJournal = (seen: Seen) => seen.sql.some((s) => /^\s*SELECT\b/i.test(s) && /wellbeing_reflections|wellbeing_daily_pulses/.test(s));

async function reflect(e: any, who: number, day: string, topics: string[], text = 'private words') {
  const r = await call(reflections, e, 'PUT', `/day/${day}`, who, { timezone: TZ, topics, text, scores: { mood: 2 } });
  assert.equal(r.status, 201);
}

// ---------------------------------------------------------------------------

test('defaults: nothing chosen and consent off; suggestions ask for interests and read no journal', async () => {
  const db = setup(); const { DB, seen } = spied(db); const e = envOf(DB);
  await reflect(envOf(d1Over(db)), MIA, '2026-11-16', ['executive_coach']);
  const p = await call(preferences, e, 'GET', '/', MIA);
  assert.equal(p.status, 200);
  assert.deepEqual([p.body.support_types, p.body.topic_consent, p.body.suggestions, p.body.revision], [[], false, true, 0]);
  assert.ok(p.body.support_type_options.some((o: any) => o.key === 'therapy' && o.suggested_from_topics === false));
  const r = await recs(e, MIA);
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'choose_interests');
  assert.equal(readsJournal(seen), false, 'an opted-out member\'s journal was read');
});

test('a chosen interest returns matching experts, each with Why this?, and never a sample or a hidden one', async () => {
  const e = envOf(d1Over(setup()));
  assert.equal((await prefs(e, MIA, { support_types: ['nutrition'], languages: ['en'], base_revision: 0 })).status, 200);
  const r = await recs(e, MIA);
  assert.equal(r.body.state, 'ok');
  assert.deepEqual(uids(r), ['nutr-en'], 'French-only, sample and hidden experts are not suggested');
  assert.equal(r.body.excluded.language, 1);
  const why = r.body.items[0].why;
  assert.ok(why.used.some((x: any) => x.kind === 'interest' && /General nutrition support/.test(x.label)));
  assert.ok(why.used.some((x: any) => x.kind === 'language'));
  assert.ok(why.not_used.includes('Anything you wrote in a reflection'));
  assert.deepEqual(r.body.items[0].support_types.map((t: any) => t.key), ['nutrition']);
  assert.equal(r.body.group_sessions.offered, true, 'D7120 offers group sessions');
});

test('registered dietetics and general nutrition are distinct choices', async () => {
  const e = envOf(d1Over(setup()));
  await prefs(e, MIA, { support_types: ['dietetics'], base_revision: 0 });
  assert.deepEqual(uids(await recs(e, MIA)), ['diet']);
});

test('topic consent: off by default; on, a chosen topic suggests coaching with its reason; revoked, it is gone', async () => {
  const db = setup(); const plain = envOf(d1Over(db));
  await reflect(plain, MIA, '2026-11-16', ['executive_coach']);
  await prefs(plain, MIA, { support_types: ['dietetics'], base_revision: 0 });
  assert.deepEqual(uids(await recs(plain, MIA)), ['diet'], 'a topic was used without consent');

  assert.equal((await prefs(plain, MIA, { topic_consent: true, base_revision: 1 })).body?.error, 'topic_sources_required');
  const on = await prefs(plain, MIA, { topic_consent: true, topic_sources: ['day'], base_revision: 1 });
  assert.equal(on.status, 200);
  assert.ok(on.body.topic_consent_at, 'the consent records when it was given');
  const withTopics = await recs(plain, MIA);
  assert.deepEqual(uids(withTopics).sort(), ['coach', 'diet']);
  const coach = withTopics.body.items.find((x: any) => x.uid === 'coach');
  assert.ok(coach.why.used.some((x: any) => x.kind === 'topic' && /Executive coach/.test(x.label)));
  assert.ok(!JSON.stringify(withTopics.body).includes('private words'), 'reflection text reached the answer');

  const { DB, seen } = spied(db);
  const off = await prefs(envOf(DB), MIA, { topic_consent: false, base_revision: 2 });
  assert.equal(off.body.topic_consent_at, null);
  seen.sql.length = 0;
  assert.deepEqual(uids(await recs(envOf(DB), MIA)), ['diet']);
  assert.equal(readsJournal(seen), false, 'revoked consent still read the journal');
});

test('a topic never adds therapy, dietetics or spiritual guidance, but may rank within a kind the member chose', async () => {
  assert.deepEqual(usableTopics(['therapist_clinical', 'dietitian', 'spiritual_philosophical_advisor', 'nutritionist'], []),
    { used: ['nutritionist'], ignored: ['therapist_clinical', 'dietitian', 'spiritual_philosophical_advisor'] });
  assert.deepEqual(usableTopics(['therapist_clinical'], ['therapy']).used, ['therapist_clinical']);
  const db = setup(); const e = envOf(d1Over(db));
  await reflect(e, MIA, '2026-11-16', ['therapist_clinical', 'spiritual_philosophical_advisor']);
  await prefs(e, MIA, { support_types: ['coaching'], topic_consent: true, topic_sources: ['day'], base_revision: 0 });
  assert.deepEqual(uids(await recs(e, MIA)), ['coach'], 'a topic prescribed therapy or spiritual guidance');
  await prefs(e, MIA, { support_types: ['coaching', 'therapy'], base_revision: 1 });
  const both = await recs(e, MIA);
  const ther = both.body.items.find((x: any) => x.uid === 'therapist');
  assert.ok(ther, 'therapy chosen by the member is suggested');
  assert.ok(ther.why.used.some((x: any) => x.kind === 'interest' && /Licensed therapy/.test(x.label)));
});

test('consent covers only the sources chosen, and only the member\'s own records', async () => {
  const db = setup(); const e = envOf(d1Over(db));
  await call(reflections, e, 'PUT', '/week/2026-11-16', MIA, { timezone: TZ, topics: ['executive_coach'] });
  await reflect(e, OTTO, '2026-11-16', ['mindfulness_coach']);
  db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, tags_plain) VALUES ('old', ?, '2026-11-10', '["nutritionist"]')`).run(MIA);
  await prefs(e, MIA, { topic_consent: true, topic_sources: ['day'], base_revision: 0 });
  assert.equal((await recs(e, MIA)).body.state, 'choose_interests', 'a weekly topic or another member\'s was used for a day-only consent');
  await prefs(e, MIA, { topic_sources: ['day', 'week', 'earlier'], base_revision: 1 });
  assert.deepEqual(uids(await recs(e, MIA)).sort(), ['coach', 'nutr-en', 'nutr-fr'].sort());
});

test('dismiss hides a suggestion, repeats are harmless, undo restores it, reset forgets everything', async () => {
  const e = envOf(d1Over(setup()));
  await prefs(e, MIA, { support_types: ['nutrition'], base_revision: 0 });
  assert.deepEqual(uids(await recs(e, MIA)).sort(), ['nutr-en', 'nutr-fr']);
  for (let i = 0; i < 2; i++) assert.equal((await call(recommendations, e, 'POST', '/dismiss', MIA, { kind: 'expert', uid: 'nutr-fr' })).status, 200);
  const after = await recs(e, MIA);
  assert.deepEqual(uids(after), ['nutr-en']);
  assert.equal(after.body.excluded.dismissed, 1);
  assert.equal(after.body.dismissed_count, 1);
  assert.deepEqual(uids(await recs(e, OTTO)), [], 'another member is untouched');
  await call(recommendations, e, 'DELETE', '/dismiss/expert/nutr-fr', MIA);
  assert.deepEqual(uids(await recs(e, MIA)).sort(), ['nutr-en', 'nutr-fr']);
  await call(recommendations, e, 'POST', '/dismiss', MIA, { kind: 'expert', uid: 'nutr-fr' });
  const reset = await call(preferences, e, 'POST', '/reset', MIA);
  assert.deepEqual([reset.body.support_types, reset.body.revision], [[], 0]);
  assert.equal((await recs(e, MIA)).body.state, 'choose_interests');
  await prefs(e, MIA, { support_types: ['nutrition'], base_revision: 0 });
  assert.equal(uids(await recs(e, MIA)).length, 2, 'a dismissal survived the reset');
});

test('no results, a group-only format, a price ceiling and suggestions off each answer honestly', async () => {
  const e = envOf(d1Over(setup()));
  await prefs(e, MIA, { support_types: ['mindfulness'], base_revision: 0 });
  assert.equal((await recs(e, MIA)).body.state, 'no_match');
  await prefs(e, MIA, { support_types: ['nutrition'], formats: ['group'], base_revision: 1 });
  const group = await recs(e, MIA);
  assert.equal(group.body.state, 'no_match');
  assert.equal(group.body.excluded.format, 2);
  assert.equal(group.body.group_sessions.offered, true);
  await prefs(e, MIA, { formats: ['one_to_one'], price_max_cents: 10000, base_revision: 2 });
  const cheap = await recs(e, MIA);
  assert.deepEqual(uids(cheap), ['nutr-fr']);
  assert.equal(cheap.body.excluded.price, 1);
  await prefs(e, MIA, { suggestions: false, base_revision: 3 });
  const off = await recs(e, MIA);
  assert.deepEqual([off.body.state, off.body.items], ['off', []]);
});

test('an expert with no times is still shown, marked unavailable and listed after those with times', async () => {
  const e = envOf(d1Over(setup()));
  await prefs(e, MIA, { support_types: ['dietetics', 'nutrition'], languages: ['en'], base_revision: 0 });
  const r = await recs(e, MIA);
  assert.deepEqual(r.body.items.map((x: any) => [x.uid, x.available]), [['diet', true], ['nutr-en', false]]);
});

test('preferences: a stale copy is refused, bad values are refused, investors are refused', async () => {
  const e = envOf(d1Over(setup()));
  await prefs(e, MIA, { support_types: ['nutrition'], base_revision: 0 });
  const stale = await prefs(e, MIA, { support_types: ['coaching'], base_revision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current_revision, 1);
  assert.equal((await prefs(e, MIA, { support_types: ['astrology'], base_revision: 1 })).body.error, 'invalid_support_types');
  assert.equal((await prefs(e, MIA, { price_max_cents: -1, base_revision: 1 })).body.error, 'invalid_price_max');
  assert.equal((await prefs(e, MIA, { timezone: 'Nowhere', base_revision: 1 })).body.error, 'invalid_timezone');
  assert.equal((await call(preferences, e, 'GET', '/', INVESTOR)).status, 403);
  assert.equal((await recs(e, INVESTOR)).status, 403);
  assert.equal((preferenceChange({ topic_consent: 'yes' }, DEFAULT_PREFERENCES) as any).code, 'invalid_topic_consent');
});

test('directory: personalise ranks by the member\'s choices and reads no journal without consent', async () => {
  const db = setup();
  await reflect(envOf(d1Over(db)), MIA, '2026-11-16', ['executive_coach']);
  const { DB, seen } = spied(db); const e = envOf(DB);
  await prefs(e, MIA, { support_types: ['dietetics'], base_revision: 0 });
  seen.sql.length = 0;
  const dir = await call(wellbeing, e, 'GET', '/experts?personalise=1&limit=50', MIA);
  assert.equal(dir.status, 200);
  assert.deepEqual(dir.body.personalised, { interests: ['dietetics'], topics_used: [], topic_consent: false });
  assert.equal(dir.body.matches[0].uid, 'diet');
  assert.equal(readsJournal(seen), false, 'the directory read the journal without consent');
  await prefs(e, MIA, { topic_consent: true, topic_sources: ['day'], base_revision: 1 });
  const withTopics = await call(wellbeing, e, 'GET', '/experts?personalise=1&limit=50', MIA);
  assert.deepEqual(withTopics.body.personalised.topics_used, ['executive_coach']);
  assert.deepEqual(wantedCategories({ ...DEFAULT_PREFERENCES, support_types: ['dietetics'] }, ['executive_coach']), ['executive_coach', 'dietitian']);
});

test('the booking page asks the Worker to personalise and never reads check-ins itself', () => {
  const page = read('frontend/src/pages/wellbeing/WellbeingBookPage.jsx');
  assert.doesNotMatch(page, /wellbeingMyCheckins|wantedCategories/);
  assert.match(page, /personalise: true/);
  assert.match(read('frontend/src/lib/api.js'), /set\('personalise', params\.personalise \? 1 : null\)/);
});

test('consentedTopics reads nothing while consent is off, even with sources still stored', async () => {
  const db = setup();
  await reflect(envOf(d1Over(db)), MIA, '2026-11-16', ['executive_coach']);
  const { DB, seen } = spied(db);
  const off = { ...DEFAULT_PREFERENCES, topic_consent: false, topic_sources: ['day', 'earlier'] as any };
  assert.deepEqual(await consentedTopics(envOf(DB), MIA, off), []);
  assert.equal(seen.sql.length, 0, 'a record was read without consent');
  assert.deepEqual(await consentedTopics(envOf(DB), MIA, { ...off, topic_consent: true }), ['executive_coach']);
});

test('an unavailable expert is listed after every available one, whatever its score', () => {
  const base = { headline: null, verified: true, languages: ['en'], timezones: [], first_session_free: false, services: [] };
  const out: any = recommend([
    { ...base, id: 1, uid: 'busy', name: 'A', categories: ['executive_coach', 'sleep_coach'], availability: 'none' },
    { ...base, id: 2, uid: 'free', name: 'B', categories: ['leadership_coach'], availability: 'external' },
  ], { ...DEFAULT_PREFERENCES, support_types: ['coaching'] }, ['executive_coach', 'sleep_coach'], new Set());
  assert.deepEqual(out.items.map((x: any) => [x.uid, x.available]), [['free', true], ['busy', false]]);
});
