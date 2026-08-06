/**
 * `GET /api/legal/entities` — cross-tenant read guard.
 *
 * The bug: the route was `SELECT * FROM entities` behind a bare `requireAuth`,
 * so any authenticated principal received every incorporated company in the
 * studio — legal name, jurisdiction, incorporation date, and the `parent_id`
 * chain that discloses who owns what. No parameter had to be tampered with:
 * /legal fetches entities in the same `Promise.all` as /legal/documents, and
 * documents was already scoped. Zero effort, fires on a normal page load.
 *
 * Two layers of test, because neither alone is enough:
 *
 *  1. `entityListScope` is the whole access decision, so it gets real
 *     behavioural tests. legal.ts cannot be imported under the strip-types
 *     gate (stripe, catalog, incorporations, …), which is exactly why the
 *     decision was lifted into auth.ts.
 *  2. Source assertions that the route actually CALLS it and that the founder
 *     branch binds `founder_id`. A perfect predicate nothing consults is the
 *     original bug wearing a hat.
 *
 * Run with:  node --experimental-strip-types --test cloudflare-worker/test/legalEntitiesAccess.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entityListScope } from '../src/auth';

const mk = (role: string, founder_id: number | null = null) =>
  ({ id: 1, role, founder_id }) as any;

// --- the decision ----------------------------------------------------------

test('admin and partner list every entity', () => {
  assert.deepEqual(entityListScope(mk('admin')), { kind: 'all' });
  assert.deepEqual(entityListScope(mk('partner')), { kind: 'all' });
});

test('a founder is scoped to entities their own projects point at', () => {
  assert.deepEqual(entityListScope(mk('founder', 42)), { kind: 'own_projects', founderId: 42 });
  assert.deepEqual(entityListScope(mk('founder', 7)), { kind: 'own_projects', founderId: 7 });
});

test('two founders never resolve to the same scope — the leak, restated', () => {
  const a = entityListScope(mk('founder', 42));
  const b = entityListScope(mk('founder', 43));
  assert.notDeepEqual(a, b);
  // and neither may widen to the staff scope
  assert.notEqual(a.kind, 'all');
  assert.notEqual(b.kind, 'all');
});

test('a founder with no founder_id gets nothing, not everything', () => {
  // The pre-fix route had no such branch: a founder row with a null founder_id
  // still received the full table.
  assert.deepEqual(entityListScope(mk('founder', null)), { kind: 'none' });
});

test('investor, exploring and unknown roles get nothing', () => {
  // No masked entity view exists to fall back on, so the safe default is empty
  // rather than the `is_privileged`-style investor bypass used on some legacy
  // read paths.
  for (const role of ['investor', 'exploring', 'advisor', 'guest', '']) {
    assert.deepEqual(entityListScope(mk(role)), { kind: 'none' }, `role: ${role || '<empty>'}`);
  }
});

test('a residual founder_id on a non-founder role does not grant a scope', () => {
  // A founder later converted to an investor keeps founder_id on the row.
  assert.deepEqual(entityListScope(mk('investor', 42)), { kind: 'none' });
  assert.deepEqual(entityListScope(mk('exploring', 42)), { kind: 'none' });
});

// --- the wiring ------------------------------------------------------------

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/routes/legal.ts'),
  'utf8',
);

/** The body of a `legal.<verb>('/entities', …)` handler, comments stripped. */
function handler(verb: 'get' | 'post'): string {
  const start = SRC.indexOf(`legal.${verb}('/entities'`);
  assert.notEqual(start, -1, `legal.${verb}('/entities') not found — route renamed?`);
  const end = SRC.indexOf('\n});', start);
  assert.notEqual(end, -1, 'could not find the end of the handler');
  return SRC.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the GET route consults entityListScope and binds the founder id', () => {
  const body = handler('get');
  assert.match(body, /entityListScope\(user\)/);
  assert.match(body, /scope\.kind === 'none'/, 'must short-circuit to an empty list');
  assert.match(body, /founder_id = \$\{scope\.founderId\}/, 'founder branch must bind the scoped id');
});

test('the GET route never runs an unscoped SELECT outside the staff branch', () => {
  const body = handler('get');
  // The single bare `SELECT * FROM entities` is the `kind === 'all'` arm of the
  // ternary. A second one would mean a path back to the leak.
  const bare = body.match(/SELECT \* FROM entities ORDER BY/g) || [];
  assert.equal(bare.length, 1, `expected exactly one unscoped SELECT, found ${bare.length}`);
  assert.match(body, /scope\.kind === 'all'\s*\?\s*await sql`SELECT \* FROM entities ORDER BY/);
});

test('the POST route on the same path is staff-only', () => {
  // The write half of the same hole: unguarded, it let any principal graft a
  // row into the corporate tree, including under another founder's parent_id.
  const body = handler('post');
  assert.match(body, /user\.role !== 'admin' && user\.role !== 'partner'/);
  assert.match(body, /403/);
  assert.ok(
    body.indexOf("role !== 'admin'") < body.indexOf('INSERT INTO entities'),
    'the role check must precede the INSERT',
  );
});
