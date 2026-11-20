/**
 * D7719 (#7719) — the market study of a Research Project and its customer
 * segments, on a schema built from the baseline plus every migration (this
 * issue's included): owner scope, archived and support-session refusals, the
 * versioned study and segment writes, `/with-study` all or nothing with a
 * request id, the venture and Validate links, the origin record, the beachhead
 * rule, archived segments and the receipts.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_studies_7719.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import projects from '../src/routes/research_projects.ts';
import studies, {
  ORIGIN_FILTERS_KEY, ORIGIN_FILTERS_LABEL, SEGMENT_MAX, STUDY_LIMITS, readOrigin, readSegmentFields,
} from '../src/routes/research_studies.ts';

const app = new Hono().route('/api/research/projects', studies).route('/api/research/projects', projects);
app.onError((error, c) => c.json({ detail: error.message }, error.message === 'Unauthorized' ? 401 : 500));
const SECRET = 'unit-research-studies-7719-0123456789abcdef';
const RID = '5d1c7e2a-0b0f-4e8b-9a61-3f2d7c9e4a77';
const OWNER = 701, OTHER = 702, COFOUNDER = 703;

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO founders (id, name, email) VALUES (50, 'Ada', 'ada@example.test'), (51, 'Bo', 'bo@example.test');
    INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES
      (701, 'owner@example.test', 'Owner', 'founder', 50, 1),
      (702, 'other@example.test', 'Other', 'founder', 51, 1),
      (703, 'cofounder@example.test', 'Cofounder', 'founder', 50, 1);
    INSERT INTO projects (id, name, founder_id) VALUES (900, 'North Venture', 50), (901, 'South Venture', 51);
    INSERT INTO customer_segments (id, project_id, name, name_norm, archived_at) VALUES
      (11, 900, 'Clinics', 'clinics', NULL), (12, 900, 'Old list', 'old list', '2026-10-01 00:00:00'),
      (13, 901, 'Theirs', 'theirs', NULL), (14, 900, 'Labs', 'labs', NULL);`);
  db.exec('PRAGMA foreign_keys=ON');
  const underlying = d1Over(db);
  const hooks: { failBatch?: boolean } = {};
  const DB = {
    ...underlying,
    async batch(stmts: any[]) {
      if (hooks.failBatch) throw new Error('D1_ERROR: connection closed');
      return underlying.batch(stmts);
    },
  };
  return { db, hooks, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, method: string, path: string, body?: unknown, who = OWNER, support = false) {
  const token = await new SignJWT({ user_id: who, role: 'founder', ...(support ? { impersonated_by: 9000 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research/projects${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const count = (f: F, table: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
const row = (f: F, sql: string, ...args: any[]) => f.db.prepare(sql).get(...args) as any;
const receipts = (f: F) => f.db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'research_%' ORDER BY id").all() as any[];
const newProject = async (f: F, who = OWNER) => (await call(f, 'POST', '', { question: 'Who buys clinic scheduling software?' }, who)).body.item.uid as string;
/** A project with a study and one segment. */
async function withSegment(f: F, extra: Record<string, unknown> = {}) {
  const uid = await newProject(f);
  assert.equal((await call(f, 'PUT', `/${uid}/study`, { version: 0, product: 'Clinic scheduling' })).status, 201);
  const seg = await call(f, 'POST', `/${uid}/study/segments`, { name: 'Small clinics', ...extra });
  assert.equal(seg.status, 201);
  return { uid, seg: seg.body.segment };
}

test('the migration holds NULL for not written, its bounds, one live beachhead and one study per request id', () => {
  const f = fixture();
  f.db.exec("INSERT INTO research_projects (id, uid, owner_user_id, title, question, created_by) VALUES (1, 'p1', 701, 'T', 'Q', 701), (2, 'p2', 701, 'T', 'Q', 701)");
  const study = (pid: number, product: string | null, rid: string | null = null) => f.db.prepare(
    'INSERT INTO research_studies (project_id, owner_user_id, product, request_id, created_by) VALUES (?, 701, ?, ?, 701)',
  ).run(pid, product, rid);
  // Mutation checked: drop the CHECK on product → '' and an over-long product insert.
  assert.throws(() => study(1, ''), /CHECK/);
  assert.throws(() => study(1, 'x'.repeat(STUDY_LIMITS.product + 1)), /CHECK/);
  study(1, null, RID);
  // Mutation checked: drop idx_research_studies_request → a second study under the same member and request id inserts.
  assert.throws(() => study(2, 'Other', RID), /UNIQUE/);
  // An origin slug without its name is refused: the origin is written whole.
  assert.throws(() => f.db.prepare("INSERT INTO research_studies (project_id, owner_user_id, origin_market_slug, created_by) VALUES (2, 701, 'ai', 701)").run(), /CHECK/);
  const seg = (uid: string, beachhead: number, archived: string | null = null) => f.db.prepare(
    'INSERT INTO research_study_segments (uid, project_id, name, beachhead, position, archived_at, created_by) VALUES (?, 1, ?, ?, 1, ?, 701)',
  ).run(uid, `Segment ${uid}`, beachhead, archived);
  seg('segment-a1', 1);
  // Mutation checked: drop idx_research_study_segments_beachhead → a second live beachhead inserts.
  assert.throws(() => seg('segment-a2', 1), /UNIQUE/);
  seg('segment-a3', 1, '2026-11-01 00:00:00');
  // A segment hangs off a study: none for project 2, so none can be written.
  assert.throws(() => f.db.prepare("INSERT INTO research_study_segments (uid, project_id, name, position, created_by) VALUES ('segment-b1', 2, 'N', 1, 701)").run(), /FOREIGN KEY/);
  // Deleting the project takes its study and segments with it.
  f.db.exec('DELETE FROM research_projects WHERE id = 1');
  assert.equal(count(f, 'research_studies') + count(f, 'research_study_segments'), 0);
});

test('every route answers 404 for another member’s project, the same as one that does not exist', async () => {
  const f = fixture();
  const { uid, seg } = await withSegment(f);
  const routes: Array<[string, string, unknown?]> = [
    ['GET', `/${uid}/study`], ['PUT', `/${uid}/study`, { version: 1, product: 'Mine now' }],
    ['POST', `/${uid}/study/segments`, { name: 'Theirs' }], ['GET', `/${uid}/study/segments/${seg.uid}`],
    ['PUT', `/${uid}/study/segments/${seg.uid}`, { version: 1, name: 'Theirs' }],
    ['POST', `/${uid}/study/segments/${seg.uid}/archive`], ['POST', `/${uid}/study/segments/${seg.uid}/restore`],
    ['POST', `/${uid}/study/segments/reorder`, { uids: [seg.uid] }],
  ];
  for (const [method, path, body] of routes) {
    const theirs = await call(f, method, path, body, OTHER);
    const missing = await call(f, method, path.replace(uid, 'no-such-project'), body, OTHER);
    // Mutation checked: read the project without `owner_user_id = ?` → another member reads and writes it.
    assert.deepEqual([theirs.status, theirs.body.error], [404, 'project_not_found'], `${method} ${path}`);
    assert.deepEqual(theirs.body, missing.body, `${method} ${path} says the same as a missing project`);
  }
  // A venture member is not given the study by the link either.
  assert.equal((await call(f, 'PUT', `/${uid}/study`, { version: 1, product: 'Clinic scheduling', venture_id: 900 })).status, 200);
  assert.equal((await call(f, 'GET', `/${uid}/study`, undefined, COFOUNDER)).status, 404);
  assert.equal(row(f, 'SELECT product FROM research_studies').product, 'Clinic scheduling');
});

test('an archived project refuses every write, and a support session cannot write', async () => {
  const f = fixture();
  const { uid, seg } = await withSegment(f);
  const writes: Array<[string, string, unknown?]> = [
    ['PUT', `/${uid}/study`, { version: 1, product: 'Changed' }], ['POST', `/${uid}/study/segments`, { name: 'More' }],
    ['PUT', `/${uid}/study/segments/${seg.uid}`, { version: 1, name: 'Changed' }],
    ['POST', `/${uid}/study/segments/${seg.uid}/archive`], ['POST', `/${uid}/study/segments/reorder`, { uids: [seg.uid] }],
  ];
  for (const [method, path, body] of writes) {
    const r = await call(f, method, path, body, OWNER, true);
    // Mutation checked: drop the support_session check → each write lands.
    assert.deepEqual([r.status, r.body.error], [403, 'support_read_only'], `${method} ${path}`);
  }
  const support = await call(f, 'POST', '/with-study', { project: { question: 'Q?' }, study: { product: 'P' } }, OWNER, true);
  assert.deepEqual([support.status, support.body.error], [403, 'support_read_only']);
  assert.equal(count(f, 'research_projects'), 1);
  assert.equal((await call(f, 'GET', `/${uid}/study`, undefined, OWNER, true)).status, 200, 'a support session still reads');
  await call(f, 'POST', `/${uid}/archive`);
  for (const [method, path, body] of [...writes, ['POST', `/${uid}/study/segments/${seg.uid}/restore`] as [string, string]]) {
    const r = await call(f, method, path, body);
    // Mutation checked: drop the archived check → each write lands on the archived project.
    assert.deepEqual([r.status, r.body.error], [409, 'project_archived'], `${method} ${path}`);
  }
  assert.deepEqual([row(f, 'SELECT product, version FROM research_studies').product, count(f, 'research_study_segments')], ['Clinic scheduling', 1]);
  assert.equal(row(f, 'SELECT name FROM research_study_segments').name, 'Small clinics');
});

test('a project with no study reads null, its first write creates one, and a stale version changes nothing', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const empty = await call(f, 'GET', `/${uid}/study`);
  // Mutation checked: answer an empty study object instead of null → this fails.
  assert.deepEqual(empty.body, { study: null, venture: null, segments: [], archived_segments: [] });
  assert.deepEqual((await call(f, 'PUT', `/${uid}/study`, { version: 0 })).body.error, 'study_empty');
  assert.deepEqual((await call(f, 'PUT', `/${uid}/study`, { version: 3, product: 'P' })).body.error, 'study_changed', 'no study, so no version 3');
  const made = await call(f, 'PUT', `/${uid}/study`, { version: 0, product: 'Clinic scheduling', decision: 'Enter Germany first or not', horizon_months: 18 });
  assert.deepEqual([made.status, made.body.study.version, made.body.study.product, made.body.study.horizon_months, made.body.study.origin], [201, 1, 'Clinic scheduling', 18, null]);
  // Version 0 again is a second create: refused, the first stays.
  assert.equal((await call(f, 'PUT', `/${uid}/study`, { version: 0, product: 'Other' })).status, 409);
  const next = await call(f, 'PUT', `/${uid}/study`, { version: 1, product: 'Clinic scheduling', business_model: 'Subscription' });
  assert.deepEqual([next.status, next.body.study.version, next.body.study.decision], [200, 2, null], 'a PUT replaces: a field not sent is not recorded');
  const stale = await call(f, 'PUT', `/${uid}/study`, { version: 1, product: 'Stale edit' });
  // Mutation checked: drop `WHERE research_studies.version = ?` → the stale write lands.
  assert.deepEqual([stale.status, stale.body.error], [409, 'study_changed']);
  assert.deepEqual({ ...row(f, 'SELECT product, business_model, version FROM research_studies') }, { product: 'Clinic scheduling', business_model: 'Subscription', version: 2 });
  // Over a limit is a refusal, never a cut.
  const long = await call(f, 'PUT', `/${uid}/study`, { version: 2, product: 'x'.repeat(STUDY_LIMITS.product + 1) });
  assert.deepEqual([long.status, long.body.error], [400, 'product_too_long']);
  assert.equal(row(f, 'SELECT version FROM research_studies').version, 2);
});

test('segments: a stale version is refused unchanged, a second beachhead is refused, archived ones are still read by uid', async () => {
  const f = fixture();
  const { uid, seg } = await withSegment(f, { beachhead: true, statistical_unit: 'establishment', industry_scheme: 'nace_rev2', industry_codes: ['Q86.2'] });
  // A new segment's customer countries start empty: Markets' company-location filter never fills them.
  assert.deepEqual([seg.customer_countries, seg.beachhead, seg.statistical_unit, seg.industry_codes, seg.position], [[], true, 'establishment', ['Q86.2'], 1]);
  const second = await call(f, 'POST', `/${uid}/study/segments`, { name: 'Hospitals', beachhead: true });
  // Mutation checked: drop the beachhead count check → the partial unique index still refuses (caught as beachhead_taken).
  assert.deepEqual([second.status, second.body.error], [409, 'beachhead_taken']);
  const other = (await call(f, 'POST', `/${uid}/study/segments`, { name: 'Hospitals', customer_countries: ['de', 'AT'] })).body.segment;
  assert.deepEqual(other.customer_countries, ['DE', 'AT']);
  assert.equal((await call(f, 'PUT', `/${uid}/study/segments/${other.uid}`, { version: 1, name: 'Hospitals', beachhead: true })).body.error, 'beachhead_taken');
  const edited = await call(f, 'PUT', `/${uid}/study/segments/${seg.uid}`, { version: 1, name: 'Small clinics', buyer: 'Practice manager', beachhead: true });
  assert.deepEqual([edited.status, edited.body.segment.version, edited.body.segment.statistical_unit], [200, 2, null]);
  const stale = await call(f, 'PUT', `/${uid}/study/segments/${seg.uid}`, { version: 1, name: 'Stale' });
  // Mutation checked: drop `version = ?` from the segment UPDATE → the stale write lands.
  assert.deepEqual([stale.status, stale.body.error], [409, 'segment_changed']);
  assert.deepEqual({ ...row(f, 'SELECT name, buyer, version FROM research_study_segments WHERE uid = ?', seg.uid) }, { name: 'Small clinics', buyer: 'Practice manager', version: 2 });
  // Archive, then read by uid; the beachhead slot is free while it is archived.
  assert.equal((await call(f, 'POST', `/${uid}/study/segments/${seg.uid}/archive`)).status, 200);
  const archived = await call(f, 'GET', `/${uid}/study/segments/${seg.uid}`);
  assert.deepEqual([archived.status, archived.body.segment.archived, archived.body.segment.name], [200, true, 'Small clinics']);
  const read = await call(f, 'GET', `/${uid}/study`);
  assert.deepEqual([read.body.segments.map((s: any) => s.uid), read.body.archived_segments.map((s: any) => s.uid)], [[other.uid], [seg.uid]]);
  assert.equal((await call(f, 'PUT', `/${uid}/study/segments/${seg.uid}`, { version: 3, name: 'X' })).body.error, 'segment_archived');
  assert.equal((await call(f, 'PUT', `/${uid}/study/segments/${other.uid}`, { version: 1, name: 'Hospitals', beachhead: true })).status, 200);
  // Restoring the old beachhead now would make two.
  assert.equal((await call(f, 'POST', `/${uid}/study/segments/${seg.uid}/restore`)).body.error, 'beachhead_taken');
  assert.equal(count(f, 'research_study_segments'), 2, 'nothing is deleted');
  // Reorder takes every live segment once.
  assert.equal((await call(f, 'POST', `/${uid}/study/segments/reorder`, { uids: [] })).body.error, 'invalid_order');
  const third = (await call(f, 'POST', `/${uid}/study/segments`, { name: 'Dentists' })).body.segment;
  const order = await call(f, 'POST', `/${uid}/study/segments/reorder`, { uids: [third.uid, other.uid] });
  assert.deepEqual(order.body.segments.map((s: any) => s.name), ['Dentists', 'Hospitals']);
});

test('segment fields are checked against their lists and limits', async () => {
  assert.equal(readSegmentFields({ name: 'A', statistical_unit: 'company' }).error, 'invalid_statistical_unit');
  assert.equal(readSegmentFields({ name: 'A', industry_scheme: 'sic' }).error, 'invalid_industry_scheme');
  assert.equal(readSegmentFields({ name: 'A', industry_codes: ['62.01'] }).error, 'industry_scheme_required');
  assert.equal(readSegmentFields({ name: 'A', customer_countries: ['DEU'] }).error, 'invalid_customer_country');
  assert.equal(readSegmentFields({ name: '  ' }).error, 'name_required');
  const f = fixture();
  const { uid } = await withSegment(f);
  // A well-formed code that is not on the country list is refused too.
  assert.equal((await call(f, 'POST', `/${uid}/study/segments`, { name: 'B', customer_countries: ['ZZ'] })).body.error, 'invalid_customer_country');
  for (let i = 1; i < SEGMENT_MAX; i += 1) assert.equal((await call(f, 'POST', `/${uid}/study/segments`, { name: `S${i}` })).status, 201);
  // Mutation checked: drop the live-count check → a thirteenth segment is written.
  assert.deepEqual((await call(f, 'POST', `/${uid}/study/segments`, { name: 'One more' })).body.error, 'segment_limit');
  assert.equal(count(f, 'research_study_segments'), SEGMENT_MAX);
});

test('a venture the caller cannot read gets the same answer as one that does not exist, and losing access hides its name', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const theirs = await call(f, 'PUT', `/${uid}/study`, { version: 0, product: 'P', venture_id: 901 });
  const none = await call(f, 'PUT', `/${uid}/study`, { version: 0, product: 'P', venture_id: 99999 });
  // Mutation checked: skip canAccessProject in readableVenture → 901 is linked.
  assert.deepEqual([theirs.status, theirs.body], [404, none.body]);
  assert.equal(theirs.body.error, 'venture_not_found');
  assert.equal(count(f, 'research_studies'), 0);
  const linked = await call(f, 'PUT', `/${uid}/study`, { version: 0, product: 'P', venture_id: 900 });
  assert.deepEqual(linked.body.venture, { linked: true, state: 'readable', id: 900, name: 'North Venture' });
  await call(f, 'POST', `/${uid}/study/segments`, { name: 'Clinics', validate_segment_id: 11 });
  // The owner leaves the venture: the next read says a venture is linked, with no name or id.
  f.db.exec('UPDATE projects SET founder_id = 51 WHERE id = 900');
  const read = await call(f, 'GET', `/${uid}/study`);
  // Mutation checked: answer the stored venture without checking access again → the name comes back.
  assert.deepEqual(read.body.venture, { linked: true, state: 'no_access', message: 'A venture is linked that you can no longer read.' });
  assert.deepEqual(read.body.segments[0].validate_segment, { state: 'no_access' });
  assert.equal(JSON.stringify(read.body).includes('North Venture'), false);
});

test('the Validate link takes only a live segment of the linked venture, and changing or clearing the venture clears it', async () => {
  const f = fixture();
  const uid = await newProject(f);
  await call(f, 'PUT', `/${uid}/study`, { version: 0, product: 'P' });
  // No venture yet: no Validate link at all.
  assert.equal((await call(f, 'POST', `/${uid}/study/segments`, { name: 'A', validate_segment_id: 11 })).body.error, 'validate_segment_not_found');
  await call(f, 'PUT', `/${uid}/study`, { version: 1, product: 'P', venture_id: 900 });
  const otherVenture = await call(f, 'POST', `/${uid}/study/segments`, { name: 'A', validate_segment_id: 13 });
  const archived = await call(f, 'POST', `/${uid}/study/segments`, { name: 'A', validate_segment_id: 12 });
  // Mutation checked: drop `project_id = ?` from the customer_segments check → venture 901's segment is linked.
  assert.deepEqual([otherVenture.status, otherVenture.body.error], [404, 'validate_segment_not_found']);
  // Mutation checked: drop `archived_at IS NULL` from the customer_segments check → the archived segment is linked.
  assert.deepEqual([archived.status, archived.body.error], [404, 'validate_segment_not_found']);
  const a = (await call(f, 'POST', `/${uid}/study/segments`, { name: 'A', validate_segment_id: 11 })).body.segment;
  const b = (await call(f, 'POST', `/${uid}/study/segments`, { name: 'B', validate_segment_id: 14 })).body.segment;
  assert.deepEqual(a.validate_segment, { state: 'readable', id: 11, name: 'Clinics', archived: false });
  // Keeping the venture keeps the links.
  await call(f, 'PUT', `/${uid}/study`, { version: 2, product: 'P2', venture_id: 900 });
  assert.equal(count(f, 'research_study_segments WHERE validate_segment_id IS NOT NULL'), 2);
  // Clearing it clears both, in the same write.
  const cleared = await call(f, 'PUT', `/${uid}/study`, { version: 3, product: 'P2' });
  // Mutation checked: drop the segment UPDATE from the batch → both links stay.
  assert.deepEqual([cleared.status, cleared.body.venture, cleared.body.segments.map((s: any) => s.validate_segment)], [200, null, [null, null]]);
  assert.deepEqual(f.db.prepare('SELECT version FROM research_study_segments ORDER BY id').all().map((r: any) => r.version), [2, 2]);
  // A stale study write clears nothing.
  await call(f, 'PUT', `/${uid}/study`, { version: 4, product: 'P2', venture_id: 900 });
  await call(f, 'PUT', `/${uid}/study/segments/${a.uid}`, { version: 2, name: 'A', validate_segment_id: 11 });
  const stale = await call(f, 'PUT', `/${uid}/study`, { version: 4, product: 'P2' });
  assert.equal(stale.status, 409);
  // Mutation checked: drop the version condition from the clearing UPDATE → the stale write still clears the link.
  assert.equal(row(f, 'SELECT validate_segment_id AS v FROM research_study_segments WHERE uid = ?', a.uid).v, 11);
  assert.equal(b.validate_segment.id, 14);
});

test('with-study writes the project and its study together, or neither, and a repeated request id writes nothing', async () => {
  const f = fixture();
  const body = {
    project: { question: 'Is there room for clinic scheduling in Germany?' },
    study: { product: 'Clinic scheduling', decision: 'Enter Germany' },
    origin: { market_slug: 'ai', q: 'health', country: ['de', 'NL'], fresh: '90', src: 'named' },
    request_id: RID,
  };
  f.db.exec("CREATE TRIGGER t_fail_study BEFORE INSERT ON research_studies BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
  const failed = await call(f, 'POST', '/with-study', body);
  // Mutation checked: run the two inserts one by one instead of env.DB.batch → the project stays without its study.
  assert.deepEqual([failed.status, failed.body.error, failed.body.rolled_back], [500, 'save_rolled_back', true]);
  assert.equal(count(f, 'research_projects') + count(f, 'research_studies'), 0);
  f.db.exec('DROP TRIGGER t_fail_study');
  const made = await call(f, 'POST', '/with-study', body);
  assert.deepEqual([made.status, made.body.repeat, made.body.rolled_back, made.body.study.product], [201, false, false, 'Clinic scheduling']);
  const again = await call(f, 'POST', '/with-study', body);
  // Mutation checked: skip the request-id lookup → the unique index refuses the batch and the reply finds the first.
  assert.deepEqual([again.status, again.body.repeat, again.body.project.uid], [200, true, made.body.project.uid]);
  assert.deepEqual([count(f, 'research_projects'), count(f, 'research_studies')], [1, 1]);
  // A broken batch whose outcome cannot be read is not called rolled back.
  f.hooks.failBatch = true;
  const brokenReads = f.env.DB.prepare;
  f.env.DB.prepare = (q: string) => (q.includes('FROM research_projects WHERE uid = ? AND owner_user_id = ?') && !q.includes('INSERT')
    ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: network'); } }) } : brokenReads(q));
  const unknown = await call(f, 'POST', '/with-study', { ...body, request_id: undefined });
  assert.deepEqual([unknown.status, unknown.body.error, unknown.body.rolled_back], [503, 'save_outcome_unknown', null]);
});

test('the origin comes back labelled as company-location filters, with the Worker’s own tracked sector, and is checked', async () => {
  const f = fixture();
  const made = await call(f, 'POST', '/with-study', {
    project: { question: 'Where is AI tooling for clinics heading?' },
    origin: { market_slug: 'ai', q: ' clinic ', country: ['de'], fresh: '30', src: 'sector' },
  });
  assert.equal(made.status, 201, 'an origin alone is a study');
  // Mutation checked: take the sector from research_market_sectors for another slug, or from the request → this fails.
  assert.deepEqual(made.body.study.origin, {
    market: { slug: 'ai', name: 'AI' },
    tracked_sector: { state: 'tracked', name: 'Enterprise AI' },
    [ORIGIN_FILTERS_KEY]: { label: ORIGIN_FILTERS_LABEL, q: 'clinic', country: ['DE'], fresh: '30', src: 'sector' },
  });
  assert.equal(ORIGIN_FILTERS_KEY, 'markets_company_location_filters');
  // The origin's country filter never becomes a customer geography.
  const seg = (await call(f, 'POST', `/${made.body.project.uid}/study/segments`, { name: 'Clinics' })).body.segment;
  assert.deepEqual(seg.customer_countries, []);
  const none = await call(f, 'POST', '/with-study', { project: { question: 'Ad tech?' }, origin: { market_slug: 'advertising' } });
  assert.deepEqual(none.body.study.origin.tracked_sector, { state: 'none' });
  // A sector sent by the client is not a field the origin takes.
  const sent = await call(f, 'POST', '/with-study', { project: { question: 'Q?' }, origin: { market_slug: 'advertising', tracked_sector: 'Enterprise AI' } });
  assert.deepEqual([sent.status, sent.body.error], [400, 'invalid_origin']);
  for (const [origin, code] of [
    [{ market_slug: 'not-a-market' }, 'unknown_market'],
    [{ market_slug: 'ai', country: ['ZZ'] }, 'invalid_country'],
    [{ market_slug: 'ai', country: ['DEU'] }, 'invalid_country'],
    [{ market_slug: 'ai', fresh: '60' }, 'invalid_fresh'],
    [{ market_slug: 'ai', src: 'rumour' }, 'invalid_src'],
  ] as const) {
    const r = await call(f, 'POST', '/with-study', { project: { question: 'Q?' }, origin });
    // Mutation checked (unknown slug): drop the market directory read → the slug is stored.
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(origin));
  }
  assert.equal(count(f, 'research_projects'), 2);
  // The origin is written once: a PUT carries no origin and keeps it.
  const uid = made.body.project.uid;
  const put = await call(f, 'PUT', `/${uid}/study`, { version: 1, product: 'P', origin: { market_slug: 'advertising' } });
  assert.deepEqual(put.body.study.origin.market, { slug: 'ai', name: 'AI' });
  assert.equal(readOrigin({ market_slug: 'ai', extra: 1 }).error, 'invalid_origin');
});

test('each write leaves a receipt naming uids and field names, never the text typed', async () => {
  const f = fixture();
  const typed = ['Secret product name', 'Confidential buyer', 'private clinic search'];
  const made = await call(f, 'POST', '/with-study', {
    project: { question: 'Q?' }, study: { product: typed[0] }, origin: { market_slug: 'ai', q: typed[2] },
  });
  const uid = made.body.project.uid;
  const seg = (await call(f, 'POST', `/${uid}/study/segments`, { name: 'Seg', buyer: typed[1] })).body.segment;
  await call(f, 'PUT', `/${uid}/study`, { version: 1, product: typed[0], decision: 'Go' });
  await call(f, 'PUT', `/${uid}/study/segments/${seg.uid}`, { version: 1, name: 'Seg', buyer: typed[1], end_user: 'Nurse' });
  await call(f, 'POST', `/${uid}/study/segments/${seg.uid}/archive`);
  await call(f, 'POST', `/${uid}/study/segments/${seg.uid}/restore`);
  await call(f, 'POST', `/${uid}/study/segments/reorder`, { uids: [seg.uid] });
  const rows = receipts(f);
  // Mutation checked: drop any one logAdminAction → its action is missing here.
  assert.deepEqual(rows.map((r) => r.action), [
    'research_project_created', 'research_study_created', 'research_study_segment_created', 'research_study_updated',
    'research_study_segment_updated', 'research_study_segment_archived', 'research_study_segment_restored', 'research_study_segments_reordered',
  ]);
  const details = rows.map((r) => JSON.parse(r.details));
  assert.deepEqual(details[1].fields, ['product', 'origin']);
  assert.deepEqual(details[3].fields, ['decision']);
  assert.deepEqual(details[4], { project_uid: uid, segment_uid: seg.uid, fields: ['end_user'] });
  const all = JSON.stringify(rows);
  for (const text of typed) assert.equal(all.includes(text), false, `receipt carries "${text}"`);
});
