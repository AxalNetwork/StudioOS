/**
 * #4650 part 2 (D4650) — a course's structured metadata: audience, stage,
 * outcomes, prerequisites, author, reviewer, review date and practical output,
 * through the authoring routes (`admin_learning.ts`) and the member's course
 * read (`learning.ts`), over the Learning migrations and 202611071012.
 *
 *   1. the author writes every field; the studio and the member read them back;
 *   2. each bad value is refused with its own code, and nothing is written;
 *   3. a patch writes only what it names; null or an empty list clears a field;
 *      the audience is stored once each, in a fixed order;
 *   4. a course from before the migration reads every field as not recorded,
 *      its summary and resources unchanged;
 *   5. the stored shape is held by the table too: a list column refuses a
 *      non-array and a review date refuses a non-date.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_course_meta_4650.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminLearning from '../src/routes/admin_learning.ts';
import learning from '../src/routes/learning.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../sql/migrations');
const sqlOf = (n: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${n}_`)) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, MEMBER = 10;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [MEMBER]: 'founder' };

function db(): DatabaseSync {
  const d = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(d, { below: 388 });
  for (const n of ['388', '389', '390', '202611062214']) d.exec(sqlOf(n));
  // A course written before the metadata migration, with a summary and a resource.
  d.exec(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Super Holder', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO learning_courses (id, uid, slug, title, summary, resources_json, status, visibility, created_by, published_at)
      VALUES (1, 'crs-old', 'old-course', 'Older course', 'Kept as written.', '[{"title":"Template","url":"https://example.com/t.pdf"}]', 'published', 'open', ${SUPER}, '2026-10-01');`);
  d.exec(sqlOf('202611071012'));
  return d;
}

async function call(app: any, d: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(d) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const studio = (d: DatabaseSync, path: string, init?: { method?: string; body?: unknown }) => call(adminLearning, d, SUPER, path, init);
const member = (d: DatabaseSync, path: string) => call(learning, d, MEMBER, path);

const FULL_META = {
  audience: ['investor', 'founder'], stage: 'Pre-seed', outcomes: ['Read a term sheet', 'Price a round'],
  prerequisites: ['Know what equity is'], author: 'A. Author', reviewer: 'R. Reviewer', reviewed_on: '2026-10-01',
  practical_output: 'A model cap table',
};
const NONE = { audience: [], stage: null, outcomes: [], prerequisites: [], author: null, reviewer: null, reviewed_on: null, practical_output: null };

test('1. the author writes every field; the studio and the member read them back', async () => {
  // Mutation checked: the member read without `meta` → undefined; the INSERT binding stage to author → the values swap.
  const d = db();
  const made = await studio(d, '/courses', { method: 'POST', body: { title: 'Seed basics', slug: 'seed-basics', ...FULL_META } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const expected = { ...FULL_META, audience: ['founder', 'investor'] };
  assert.deepEqual(made.body.course.meta, expected);
  d.exec("UPDATE learning_courses SET status = 'published' WHERE slug = 'seed-basics'");
  const read = await member(d, '/courses/seed-basics');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.course.meta, expected);
  const listed = (await studio(d, '/courses')).body.courses.find((c: any) => c.slug === 'seed-basics');
  assert.deepEqual(listed.meta, expected);
  assert.equal(listed.audience_json, undefined, 'the stored JSON columns are not answered as they are stored');
});

test('2. each bad value is refused with its own code, and nothing is written', async () => {
  // Mutation checked: outcomes allowed past 8 → 201; a future review date allowed → 201.
  const d = db();
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ audience: ['founder', 'everyone'] }, 'bad_audience'],
    [{ audience: 'founder' }, 'bad_audience'],
    [{ outcomes: Array.from({ length: 9 }, (_, i) => `Outcome ${i}`) }, 'bad_outcomes'],
    [{ prerequisites: ['x'.repeat(201)] }, 'bad_prerequisites'],
    [{ outcomes: [3] }, 'bad_outcomes'],
    [{ stage: 'x'.repeat(121) }, 'bad_stage'],
    [{ author: 42 }, 'bad_author'],
    [{ reviewed_on: '2026-02-30' }, 'bad_reviewed_on'],
    [{ reviewed_on: tomorrow }, 'bad_reviewed_on'],
    [{ practical_output: 'x'.repeat(301) }, 'bad_practical_output'],
  ];
  for (const [body, code] of cases) {
    const r = await studio(d, '/courses', { method: 'POST', body: { title: 'Bad', slug: 'bad-course', ...body } });
    assert.deepEqual([r.status, r.body?.error], [400, code], JSON.stringify(body));
  }
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM learning_courses WHERE slug = 'bad-course'").get() as any).n, 0);
  const patched = await studio(d, '/courses/crs-old', { method: 'PATCH', body: { outcomes: 'not a list' } });
  assert.deepEqual([patched.status, patched.body?.error], [400, 'bad_outcomes']);
});

test('3. a patch writes only what it names; null or an empty list clears; the audience is stored once each, in order', async () => {
  // Mutation checked: an omitted key written as null → the stage is lost on the second patch.
  const d = db();
  await studio(d, '/courses/crs-old', { method: 'PATCH', body: FULL_META });
  const second = await studio(d, '/courses/crs-old', { method: 'PATCH', body: { audience: ['partner', 'founder', 'partner'], outcomes: [], reviewer: null } });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.course.meta, { ...FULL_META, audience: ['founder', 'partner'], outcomes: [], reviewer: null });
  const cleared = await studio(d, '/courses/crs-old', { method: 'PATCH', body: { audience: null, stage: '  ', prerequisites: null } });
  assert.deepEqual([cleared.body.course.meta.audience, cleared.body.course.meta.stage, cleared.body.course.meta.prerequisites], [[], null, []]);
});

test('4. a course from before the migration reads every field as not recorded; its summary and resources are unchanged', async () => {
  const d = db();
  const read = await member(d, '/courses/old-course');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.course.meta, NONE);
  assert.equal(read.body.course.summary, 'Kept as written.');
  assert.deepEqual(read.body.course.resources, [{ title: 'Template', url: 'https://example.com/t.pdf' }]);
  assert.deepEqual((await studio(d, '/courses/crs-old')).body.course.meta, NONE);
});

test('5. the table holds the stored shape too', () => {
  // Mutation checked: the migration without its json_type check → the object is stored.
  const d = db();
  assert.throws(() => d.exec(`UPDATE learning_courses SET outcomes_json = '{"a":1}' WHERE uid = 'crs-old'`), /CHECK constraint failed/);
  assert.throws(() => d.exec(`UPDATE learning_courses SET audience_json = 'founder' WHERE uid = 'crs-old'`), /CHECK constraint failed/);
  assert.throws(() => d.exec(`UPDATE learning_courses SET reviewed_on = 'last week' WHERE uid = 'crs-old'`), /CHECK constraint failed/);
});
