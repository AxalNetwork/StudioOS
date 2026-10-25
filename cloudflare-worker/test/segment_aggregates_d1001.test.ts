/** D1001: real Hono reads over real SQLite tables, not mocked count results. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import aggregates from '../src/routes/persona_segment_aggregates.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'unit-test-d1001-0123456789-abcdef';
const app = new Hono<any>();
app.route('/api/personas/segments', aggregates);
app.onError((e, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] ?? 500));
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const snapshot = readFileSync('cloudflare-worker/sql/migrations/363_profile_snapshots.sql', 'utf8');
function table(source: string, name: string) {
  const start = source.indexOf(`CREATE TABLE ${name} (`) >= 0 ? source.indexOf(`CREATE TABLE ${name} (`)
    : source.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf(');', start) + 2);
}
type Db = InstanceType<typeof DatabaseSync>;
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'user_personas', 'user_profile_extras']) db.exec(table(baseline, name));
  db.exec(table(snapshot, 'profile_snapshots'));
  db.exec('CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY)');
  member(db, 1, 'admin');
  return db;
}
function member(db: Db, id: number, role = 'investor', active = 1, segment = 'angel_scout') {
  db.prepare('INSERT INTO users(id,name,email,role,is_active) VALUES(?,?,?,?,?)').run(id, `Private member ${id}`, `m${id}@example.test`, role, active);
  db.prepare('INSERT INTO user_personas(user_id,persona_id,is_primary) VALUES(?,?,1)').run(id, segment);
}
function answer(db: Db, id: number, key: string, value: string | null, segment = 'angel_scout') {
  db.prepare('INSERT INTO user_profile_extras(user_id,persona_id,key,value) VALUES(?,?,?,?)').run(id, segment, key, value);
}
function profile(db: Db, id: number, slug: string | null, persona = 'investor', computed = 'inv_disciplined_allocator') {
  db.prepare(`INSERT INTO profile_snapshots(user_id,persona,engine_version,trigger_kind,displayed_slug,computed_slug,
    traits_json,skills_json,values_json,axal_values_json,computed_at) VALUES(?,?,'v2','answer',?,?, '{}','{}','{}','{}','2026-10-25')`)
    .run(id, persona, slug, computed);
}
function d1(db: Db, mode = '') {
  return { prepare(sql: string) {
    let bindings: any[] = [];
    const p: any = {
      bind(...args: any[]) { bindings = args; return p; },
      async all() {
        if (mode === 'throw' && sql.includes('WITH members')) throw new Error('D1 down');
        if (mode === 'missing' && sql.includes('WITH members')) return {};
        if (mode === 'failure' && sql.includes('WITH members')) return { success: false, results: [] };
        return { results: db.prepare(sql).all(...bindings) };
      },
      async first() { return db.prepare(sql).get(...bindings) ?? null; },
    }; return p;
  } };
}
async function read(db: Db, suffix = 'answers', key = 'angel_scout', userId: number | null = 1, mode = '') {
  const token = userId === null ? null : await new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.fetch(new Request(`http://x/api/personas/segments/${key}/${suffix}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }), { DB: d1(db, mode), JWT_SECRET: SECRET, ENVIRONMENT: 'development' });
  return { status: response.status, body: await response.json() as any };
}
const question = (r: any, key: string) => r.body.questions.find((q: any) => q.key === key);
const visible = (count: number) => ({ count, suppressed: false });
const hidden = { count: null, suppressed: true };

test('number buckets have fixed boundaries; aggregate all members, exclude admins/inactive/secondary/older primaries', async () => {
  const db = fixture();
  const values = ['0', '9999', '10000', '24999', '25000', '49999', '50000'];
  for (let n = 0; n < 35; n++) { member(db, n + 2); answer(db, n + 2, 'check_size_usd', values[n % 7]); }
  for (const [id, role, active] of [[50, 'admin', 1], [51, 'investor', 0]] as const) {
    member(db, id, role, active); answer(db, id, 'check_size_usd', '0');
  }
  member(db, 52); answer(db, 52, 'check_size_usd', '0');
  db.prepare("INSERT INTO user_personas(user_id,persona_id,is_primary) VALUES(52,'gp_external',1)").run();
  member(db, 53, 'investor', 1, 'gp_external');
  db.prepare("INSERT INTO user_personas(user_id,persona_id,is_primary) VALUES(53,'angel_scout',0)").run();
  answer(db, 53, 'check_size_usd', '0');
  // Cross-segment extras cannot fill this segment's question.
  answer(db, 2, 'deals_per_year', '99', 'gp_external');
  const r = await read(db); assert.equal(r.status, 200);
  const q = question(r, 'check_size_usd');
  assert.deepEqual(q.buckets.map((b: any) => b.count), [10, 10, 10, 5]);
  assert.deepEqual(q.buckets.map((b: any) => b.label), ['Under $10k', '$10k to under $25k', '$25k to under $50k', '$50k and over']);
  assert.deepEqual(q.answered, visible(35));
  assert.deepEqual(q.not_recorded, { label: 'Not recorded', ...visible(0) });
  assert.deepEqual(question(r, 'deals_per_year').not_recorded, { label: 'Not recorded', ...visible(35) });
  assert.equal(r.body.small_cell_min, 5);
  assert.equal(r.body.themes_enabled, false);
});

test('AUM uses fixed million bands and hours use the experience bands; finite scientific numbers count', async () => {
  const db = fixture();
  for (let i = 0; i < 20; i++) {
    member(db, i + 2, 'investor', 1, 'lp_institutional');
    answer(db, i + 2, 'aum_usd', ['0', '1e6', '1e7', '1e8'][i % 4], 'lp_institutional');
    member(db, i + 30, 'advisor', 1, 'operator_advisor');
    answer(db, i + 30, 'time_per_week_hours', ['0', '5', '10', '20'][i % 4], 'operator_advisor');
  }
  let r = await read(db, 'answers', 'lp_institutional');
  const aum = question(r, 'aum_usd');
  assert.deepEqual(aum.buckets.map((b: any) => b.count), [5, 5, 5, 5]);
  assert.deepEqual(aum.buckets.map((b: any) => b.label), ['Under $1m', '$1m to under $10m', '$10m to under $100m', '$100m and over']);
  r = await read(db, 'answers', 'operator_advisor');
  assert.deepEqual(question(r, 'time_per_week_hours').buckets.map((b: any) => b.count), [5, 5, 5, 5]);
});

test('choices use only the question bank; invalid choices and malformed numbers are Not recorded', async () => {
  const db = fixture();
  const invalid = ['NaN', 'Infinity', '1e400', '-1', '1,000', '12people', '"12"', 'null', '', ' '];
  for (let n = 0; n < 10; n++) {
    member(db, n + 2, 'investor', 1, 'lp_individual');
    answer(db, n + 2, 'check_size_usd', invalid[n], 'lp_individual');
    answer(db, n + 2, 'accreditation', n < 5 ? 'yes' : 'private invented label', 'lp_individual');
  }
  const r = await read(db, 'answers', 'lp_individual');
  assert.equal(r.status, 200);
  assert.deepEqual(question(r, 'check_size_usd').buckets.map((b: any) => b.count), [0, 0, 0, 0]);
  assert.deepEqual(question(r, 'check_size_usd').not_recorded, { label: 'Not recorded', ...visible(10) });
  assert.deepEqual(question(r, 'accreditation').buckets.map((b: any) => [b.label, b.count]), [['yes', 5], ['no', 0], ['non-US', 0]]);
  assert.deepEqual(question(r, 'accreditation').not_recorded, { label: 'Not recorded', ...visible(5) });
  assert.doesNotMatch(JSON.stringify(r.body), /private invented label/);
});

test('open answers are counts only; one small cell suppresses its complement and subtotal', async () => {
  const db = fixture();
  for (let id = 2; id < 14; id++) {
    member(db, id);
    if (id < 6) answer(db, id, 'sector_focus', 'PRIVATE OPEN RESPONSE');
    answer(db, id, 'check_size_usd', id < 6 ? '9999' : '20000');
  }
  const r = await read(db);
  const open = question(r, 'sector_focus');
  assert.deepEqual(open.answered, hidden);
  assert.deepEqual(open.not_recorded, { label: 'Not recorded', ...hidden });
  assert.deepEqual(open.buckets, []);
  const numeric = question(r, 'check_size_usd');
  assert.deepEqual(numeric.buckets.slice(0, 2).map(({ count, suppressed }: any) => ({ count, suppressed })), [hidden, hidden]);
  assert.deepEqual(numeric.answered, hidden);
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE OPEN|Private member|@example|user_id|computed_slug|themes"/);
});

test('a missing minority suppresses another bucket and the recorded subtotal; 5 is visible, empty is a known zero', async () => {
  const db = fixture();
  for (let id = 2; id < 11; id++) { member(db, id); if (id < 10) answer(db, id, 'sector_focus', 'private'); }
  let r = await read(db);
  assert.deepEqual(question(r, 'sector_focus').answered, hidden);
  assert.deepEqual(question(r, 'sector_focus').not_recorded, { label: 'Not recorded', ...hidden });
  for (let id = 20; id < 25; id++) { member(db, id, 'advisor', 1, 'operator_advisor'); answer(db, id, 'years_experience', '5', 'operator_advisor'); }
  r = await read(db, 'answers', 'operator_advisor');
  assert.deepEqual(question(r, 'years_experience').buckets.map((b: any) => b.count), [0, 5, 0, 0]);
  r = await read(db, 'answers', 'academic');
  assert.equal(r.status, 200);
  assert.ok(r.body.questions.every((q: any) => q.answered.count === 0 && q.not_recorded.count === 0));
});

test('no newest-500 cutoff; blank text and unknown keys contribute no recorded answers', async () => {
  const db = fixture();
  for (let id = 2; id < 507; id++) {
    member(db, id);
    answer(db, id, 'deals_per_year', id < 502 ? '2' : '6');
    answer(db, id, 'sector_focus', id % 2 ? '\t\n\r ' : null);
    answer(db, id, 'unknown_private_key', 'PRIVATE EXTRA');
  }
  const r = await read(db);
  assert.deepEqual(question(r, 'deals_per_year').buckets.map((b: any) => b.count), [500, 0, 5]);
  assert.deepEqual(question(r, 'sector_focus').answered, visible(0));
  assert.deepEqual(question(r, 'sector_focus').not_recorded, { label: 'Not recorded', ...visible(505) });
  assert.doesNotMatch(JSON.stringify(r.body), /unknown_private_key|PRIVATE EXTRA/);
});

test('two small cells stay hidden without hiding an unrelated large cell', async () => {
  const db = fixture();
  for (let id = 2; id < 16; id++) {
    member(db, id, 'investor', 1, 'lp_individual');
    answer(db, id, 'accreditation', id < 4 ? 'yes' : id < 6 ? 'no' : 'non-US', 'lp_individual');
  }
  const r = await read(db, 'answers', 'lp_individual');
  assert.deepEqual(question(r, 'accreditation').buckets.map(({ count, suppressed }: any) => ({ count, suppressed })), [hidden, hidden, visible(10)]);
  assert.deepEqual(question(r, 'accreditation').answered, hidden);
});

test('a whole segment under five hides every cell, since D999 exposes its total', async () => {
  const db = fixture();
  for (let id = 2; id < 6; id++) {
    member(db, id); answer(db, id, 'check_size_usd', '1');
    answer(db, id, 'sector_focus', 'private'); profile(db, id, 'inv_thesis_backer');
  }
  const answers = await read(db);
  for (const q of answers.body.questions) {
    const cells = q.type === 'text' ? [q.answered, q.not_recorded] : [...q.buckets, q.not_recorded];
    assert.ok(cells.every((c: any) => c.suppressed && c.count === null), q.key);
    assert.deepEqual(q.answered, hidden);
  }
  const archetypes = await read(db, 'archetypes');
  assert.ok([...archetypes.body.archetypes, archetypes.body.not_recorded].every((c: any) => c.suppressed && c.count === null));
  assert.deepEqual(archetypes.body.profiled, hidden);
});

test('small-segment suppression patterns are identical whichever bucket or missing value holds the members', async () => {
  let previous: any;
  for (const value of ['0', '10000', '25000', '50000', null]) {
    const db = fixture();
    for (let id = 2; id < 6; id++) { member(db, id); answer(db, id, 'check_size_usd', value); }
    const r = question(await read(db), 'check_size_usd');
    if (previous) assert.deepEqual(r, previous);
    previous = r;
    assert.deepEqual(r.buckets.map(({ count, suppressed }: any) => ({ count, suppressed })), [hidden, hidden, hidden, hidden]);
    assert.deepEqual(r.not_recorded, { label: 'Not recorded', ...hidden });
  }
});

test('archetypes count the latest snapshot once per member, displayed rather than computed, joined to current primary', async () => {
  const db = fixture();
  for (let id = 2; id < 17; id++) {
    member(db, id);
    profile(db, id, 'inv_disciplined_allocator');
    if (id < 12) profile(db, id, 'inv_thesis_backer');
    else profile(db, id, 'fo_architect', 'founder');
  }
  profile(db, 1, 'inv_thesis_backer');
  member(db, 40, 'investor', 0); profile(db, 40, 'inv_thesis_backer');
  member(db, 41); profile(db, 41, 'inv_thesis_backer');
  db.prepare("INSERT INTO user_personas(user_id,persona_id,is_primary) VALUES(41,'gp_external',1)").run();
  const r = await read(db, 'archetypes'); assert.equal(r.status, 200);
  const a = (slug: string) => r.body.archetypes.find((x: any) => x.slug === slug);
  assert.equal(a('inv_thesis_backer').count, 10);
  assert.equal(a('fo_architect').count, 5);
  assert.equal(a('inv_disciplined_allocator').count, 0);
  assert.deepEqual(r.body.profiled, visible(15));
  assert.deepEqual(r.body.not_recorded, { label: 'Not recorded', ...visible(0) });
  assert.doesNotMatch(JSON.stringify(r.body), /Private member|@example|user_id|computed_slug|engine_version/);
});

test('null latest display never falls back to an old or computed slug; unknown slugs are Not recorded', async () => {
  const db = fixture();
  for (let id = 2; id < 14; id++) {
    member(db, id); profile(db, id, 'inv_thesis_backer');
    if (id < 6) profile(db, id, null);
  }
  let r = await read(db, 'archetypes');
  assert.deepEqual(r.body.profiled, hidden);
  assert.deepEqual(r.body.not_recorded, { label: 'Not recorded', ...hidden });
  assert.deepEqual(r.body.archetypes.find((a: any) => a.slug === 'inv_thesis_backer'), {
    persona: 'investor', slug: 'inv_thesis_backer', label: 'Thesis-Driven Backer', ...hidden,
  });
  for (let id = 20; id < 25; id++) { member(db, id, 'investor', 1, 'lp_individual'); profile(db, id, 'PRIVATE UNKNOWN SLUG'); }
  r = await read(db, 'archetypes', 'lp_individual');
  assert.deepEqual(r.body.not_recorded, { label: 'Not recorded', ...visible(5) });
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE UNKNOWN/);
  for (let id = 30; id < 35; id++) member(db, id, 'investor', 1, 'gp_external');
  r = await read(db, 'archetypes', 'gp_external');
  assert.deepEqual(r.body.not_recorded, { label: 'Not recorded', ...visible(5) });
  assert.deepEqual(r.body.profiled, visible(0));
  assert.ok(r.body.archetypes.every((a: any) => a.count === 0 && !a.suppressed));
});

for (const suffix of ['answers', 'archetypes']) {
  test(`${suffix}: anonymous and every non-admin role refused before aggregate access`, async () => {
    const db = fixture();
    assert.equal((await read(db, suffix, 'angel_scout', null)).status, 401);
    let id = 10;
    for (const role of ['founder', 'investor', 'advisor', 'partner', 'exploring']) {
      member(db, id, role);
      assert.equal((await read(db, suffix, 'angel_scout', id++, 'throw')).status, 403);
    }
  });
  test(`${suffix}: unknown/injection segment is 404; arbitrary scope and cohort filters refused`, async () => {
    const db = fixture();
    for (const key of ['__proto__', 'unknown', encodeURIComponent("' OR 1=1 --")]) assert.equal((await read(db, suffix, key)).status, 404);
    for (const query of ['scope=all', 'user_id=2', 'min=1']) assert.equal((await read(db, `${suffix}?${query}`)).status, 400);
  });
  test(`${suffix}: thrown D1, malformed result, failure flag and absent table are 503 without figures`, async () => {
    const db = fixture();
    for (const mode of ['throw', 'missing', 'failure']) {
      const r = await read(db, suffix, 'angel_scout', 1, mode);
      assert.equal(r.status, 503); assert.deepEqual(Object.keys(r.body).sort(), ['code', 'detail']);
      assert.equal(r.body.code, 'unreadable');
    }
    db.exec(`DROP TABLE ${suffix === 'answers' ? 'user_profile_extras' : 'profile_snapshots'}`);
    assert.equal((await read(db, suffix)).status, 503);
  });
}
