/**
 * #4650 part 4 (D4650) — the curriculum coverage record, `GET /api/admin/learning/coverage`
 * (`admin_learning.ts`, `services/learningCoverage.ts`), over the Learning migrations and 202611071012.
 *
 *   1. the four states: published, inaccessible (draft, archived, program-only), unknown and missing;
 *   2. a course with no audience makes a journey unknown, never missing, and is counted, never zero;
 *   3. the Super Admin only: a member and a plain admin are refused;
 *   4. a catalogue from before the audience column reads every journey unknown;
 *   5. a failed read is Unreadable (503), never an empty catalogue;
 *   6. a catalogue cut at the cap never calls a journey missing.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_coverage_4650.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminLearning from '../src/routes/admin_learning.ts';
import { courseCoverage } from '../src/services/learningCoverage.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../sql/migrations');
const sqlOf = (n: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${n}_`)) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, PLAIN_ADMIN = 2, MEMBER = 10;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [PLAIN_ADMIN]: 'admin', [MEMBER]: 'founder' };

function db({ meta = true } = {}): DatabaseSync {
  const d = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(d, { below: 388 });
  for (const n of ['388', '389', '390', '202611062214']) d.exec(sqlOf(n));
  if (meta) d.exec(sqlOf('202611071012'));
  d.exec(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Super Holder', 'admin', 1),
      (${PLAIN_ADMIN}, 'u-plain', 'plain@example.test', 'Plain Admin', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  return d;
}

let n = 0;
function course(d: DatabaseSync, { audience, status = 'published', visibility = 'open', stage = null }: { audience?: string[]; status?: string; visibility?: string; stage?: string | null }) {
  n += 1;
  const cols = audience === undefined ? '' : ', audience_json, stage';
  const vals = audience === undefined ? '' : ', ?, ?';
  const args: (string | number | null)[] = [`crs-${n}`, `course-${n}`, `Course ${n}`, status, visibility, SUPER];
  if (audience !== undefined) args.push(JSON.stringify(audience), stage);
  d.prepare(`INSERT INTO learning_courses (uid, slug, title, status, visibility, created_by${cols}) VALUES (?, ?, ?, ?, ?, ?${vals})`).run(...args);
  return `crs-${n}`;
}

async function call(d: DatabaseSync, who: number, path = '/coverage') {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await adminLearning.request(path, { headers: { Authorization: `Bearer ${tok}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(d) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const byJourney = (body: any) => Object.fromEntries(body.coverage.journeys.map((j: any) => [j.journey, j]));

test('1. the four states: published, inaccessible, unknown and missing', async () => {
  // Mutation checked: `reachable` ignoring visibility → the program-only course reads published;
  // the missing branch returning 'unknown' → advisor reads unknown; reasonOf always 'draft' → reasons differ.
  const d = db();
  const seed = course(d, { audience: ['founder'], stage: 'Pre-seed' });
  const plain = course(d, { audience: ['founder'], stage: null });
  const draft = course(d, { audience: ['investor'], status: 'draft' });
  const prog = course(d, { audience: ['investor'], visibility: 'program' });
  const old = course(d, { audience: ['investor', 'founder'], status: 'archived' });
  const res = await call(d, SUPER);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const j = byJourney(res.body);
  assert.deepEqual(res.body.coverage.journeys.map((x: any) => x.journey), ['founder', 'investor', 'advisor', 'partner']);
  assert.equal(j.founder.state, 'published');
  assert.deepEqual(j.founder.published.map((c: any) => c.uid).sort(), [seed, plain].sort());
  assert.deepEqual(j.founder.stages, ['Pre-seed']);
  assert.equal(j.founder.stage_not_recorded, 1, 'a published course with no stage is counted as not recorded');
  assert.deepEqual(j.founder.inaccessible.map((c: any) => [c.uid, c.reason]), [[old, 'archived']]);
  assert.equal(j.investor.state, 'inaccessible');
  assert.deepEqual(j.investor.published, []);
  assert.deepEqual(Object.fromEntries(j.investor.inaccessible.map((c: any) => [c.uid, c.reason])), { [draft]: 'draft', [prog]: 'program_only', [old]: 'archived' });
  assert.equal(j.advisor.state, 'missing');
  assert.equal(j.partner.state, 'missing');
  assert.equal(j.advisor.unknown, 0);
  assert.equal(res.body.coverage.courses, 5);
  assert.equal(res.body.coverage.audience_recorded, true);
  assert.deepEqual(Object.keys(j.founder.published[0]).sort(), ['slug', 'stage', 'status', 'title', 'uid', 'visibility'], 'catalogue fields only');
});

test('2. a course with no audience makes a journey unknown, never missing, and is counted', async () => {
  // Mutation checked: the `untagged.length` branch removed → advisor reads missing; `unknown: 0` → the count is 0;
  // the `untaggedReachable` branch moved below inaccessible → investor reads inaccessible.
  const d = db();
  course(d, { audience: ['founder'] });
  course(d, { audience: ['investor'], status: 'draft' });
  const hidden = course(d, { audience: [], status: 'draft' });
  let j = byJourney((await call(d, SUPER)).body);
  assert.equal(j.advisor.state, 'unknown');
  assert.equal(j.partner.state, 'unknown');
  assert.equal(j.advisor.unknown, 1);
  assert.equal(j.investor.state, 'inaccessible', 'an untagged draft cannot be the published material');
  assert.equal(j.founder.state, 'published');

  const open = course(d, { audience: [] });
  const res = await call(d, SUPER);
  j = byJourney(res.body);
  assert.equal(j.investor.state, 'unknown', 'an untagged published course may be the investor material');
  assert.equal(j.investor.unknown, 2);
  assert.equal(j.founder.state, 'published');
  assert.deepEqual(res.body.coverage.audience_not_recorded.map((c: any) => c.uid).sort(), [hidden, open].sort());
});

test('3. the Super Admin only', async () => {
  // Mutation checked: the route without `gate` → the member and the plain admin read 200.
  const d = db();
  course(d, { audience: ['founder'] });
  assert.equal((await call(d, MEMBER)).status, 403);
  assert.equal((await call(d, PLAIN_ADMIN)).status, 403, 'a plain admin authors nothing and reads no coverage');
  assert.equal((await call(d, SUPER)).status, 200);
});

test('4. a catalogue from before the audience column reads every journey unknown', async () => {
  // Mutation checked: the missing-column fallback removed → 503; audience_recorded left true → the flag differs.
  const d = db({ meta: false });
  course(d, {});
  const res = await call(d, SUPER);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.coverage.audience_recorded, false);
  assert.deepEqual(res.body.coverage.journeys.map((x: any) => x.state), ['unknown', 'unknown', 'unknown', 'unknown']);
  assert.equal(res.body.coverage.journeys[0].unknown, 1);
});

test('5. a failed read is Unreadable, never an empty catalogue', async () => {
  // Mutation checked: the catch answering `{ coverage: courseCoverage([]) }` → 200 with four missing journeys.
  const d = db();
  course(d, { audience: ['founder'] });
  d.exec('ALTER TABLE learning_courses RENAME TO learning_courses_gone');
  const res = await call(d, SUPER);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'coverage_unreadable');
  assert.match(res.body.message, /not a claim that any journey has no material/);
  assert.equal(res.body.coverage, undefined);
});

test('6. a catalogue cut at the cap never calls a journey missing; an empty one calls every journey missing', () => {
  // Mutation checked: `|| truncated` dropped → advisor reads missing on a cut catalogue.
  const rows = [{ uid: 'a', slug: 'a', title: 'A', status: 'published', visibility: 'open', audience_json: '["founder"]', stage: null }];
  const cut = courseCoverage(rows, { truncated: true });
  assert.deepEqual(cut.journeys.map((x) => x.state), ['published', 'unknown', 'unknown', 'unknown']);
  assert.equal(cut.truncated, true);
  const whole = courseCoverage(rows);
  assert.deepEqual(whole.journeys.map((x) => x.state), ['published', 'missing', 'missing', 'missing']);
  const empty = courseCoverage([]);
  assert.equal(empty.courses, 0);
  assert.deepEqual(empty.journeys.map((x) => x.state), ['missing', 'missing', 'missing', 'missing']);
  // A stored audience that is not a list names no journey: unknown, not an error.
  const junk = courseCoverage([{ ...rows[0], audience_json: 'not json' }]);
  assert.deepEqual(junk.journeys.map((x) => x.state), ['unknown', 'unknown', 'unknown', 'unknown']);
});
