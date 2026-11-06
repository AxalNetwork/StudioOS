// #4570 (S1 of #4554) — the authorization inventory's reader and its ledger guard.
//
//   node --test scripts/lib/authInventory.test.mjs
//
// The reader errs towards review: each case below is one where an earlier
// version of it read a gated route as public, or a public one as gated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, closeOf, covers, functionBody, inventory, stripComments } from './authInventory.mjs';
import { kindOf, ledgerProblems } from '../build-auth-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gateOf = (text) => classify({ path: '/api/x', text }).gate;

test('closeOf steps over strings, templates and comments', () => {
  const src = "f(a, ')', `x ${g(')')} y`, /* ) */ b) // )\nrest";
  assert.equal(src.slice(0, closeOf(src, 1)), "f(a, ')', `x ${g(')')} y`, /* ) */ b)");
});

test('functionBody reads past a return type with braces, and through a curried arrow', () => {
  const src = [
    'async function scope(c: any, gate: (p: P, u: U) => boolean): Promise<{ user: User } | Response> {',
    '  const user = await requireAuth(c);',
    '  return { user };',
    '}',
    'const handle = (fn: (c: any, ctx: Ctx) => Promise<Response>) => async (c: any) => {',
    '  let user: User;',
    '  try { user = await requireAuth(c); } catch { return c.json({}, 401); }',
    '  return fn(c, { user });',
    '};',
    'const getRoot = async (c: Context<{ Bindings: Env }>) => {',
    '  const u = await requireAuth(c);',
    '};',
  ].join('\n');
  // Mutation checked: the body taken from the first `{` after `)` → the return type `{ user: User }` and this fails.
  assert.match(functionBody(src, 'scope'), /requireAuth/);
  // Mutation checked: an expression body cut at its first `;` → `let user: User` only, and this fails.
  assert.match(functionBody(src, 'handle'), /requireAuth/);
  // Mutation checked: the arrow's body taken from its first `{` → `{ Bindings: Env }` and this fails.
  assert.match(functionBody(src, 'getRoot'), /requireAuth/);
  assert.equal(functionBody(src, 'nope'), null);
});

test('stripComments keeps strings whole: a glob path is not the start of a comment', () => {
  // Mutation checked: a regex stripper → '/api/*' opens a "comment" that swallows requireAuth and this fails.
  assert.equal(stripComments("use('/api/*', x); requireAuth(c); /* note */ // requireAdmin"), "use('/api/*', x); requireAuth(c);  ");
  assert.equal(gateOf('/* requireSuperAdmin(c) */ const u = 1;'), 'public', 'a gate named only in a comment is not a gate');
});

test('classify: the strongest gate, called or handed to a wrapper; forwards and optional sign-ins are their own', () => {
  assert.equal(gateOf('await requireAuth(c); await requireSuperAdmin(c);'), 'super_admin');
  // Mutation checked: gates matched only when called (`requireX(`) → this reads public and fails.
  assert.equal(gateOf('const u = await gate(c, requireSuperAdmin);'), 'super_admin');
  assert.equal(gateOf("await requireRole(c, ['admin'])"), 'admin');
  assert.equal(gateOf('const u = await getCurrentUser(c);'), 'optional_auth');
  assert.equal(gateOf('return relay(c, `/metrics/${id}`);'), 'forwarded');
  assert.equal(gateOf('return r.fetch(new Request(url), c.env);'), 'forwarded');
  assert.equal(gateOf('return c.json({ ok: true });'), 'public');
  const e = classify({ path: '/api/p/:id', text: "await requireAuth(c); if (!(await canAccessProject(env, u, id))) return no(); db.prepare('SELECT * FROM x WHERE founder_id = ?')" });
  assert.deepEqual(e, { gate: 'authenticated', evidence: ['canAccessProject', 'owner_bound_sql'], params: ['id'] });
});

test('covers: Hono path patterns', () => {
  assert.equal(covers('*', '/a'), true);
  assert.equal(covers('/admin/*', '/admin/x/y'), true);
  assert.equal(covers('/admin/*', '/admin'), true);
  assert.equal(covers('/admin/*', '/public'), false);
  assert.equal(covers('/x/:id', '/x/7'), true);
  assert.equal(covers(null, '/anything'), true);
});

test('ledgerProblems: a new unknown, a stale entry, a changed reason, and unvouched states each fail', () => {
  const rows = [
    { method: 'GET', path: '/api/a', review: 'no_gate_found', gate: 'public', file: 'f.ts', line: 1 },
    { method: 'GET', path: '/api/b', review: null, gate: 'authenticated', file: 'f.ts', line: 2 },
    { method: 'POST', path: '/api/c', review: 'forwarded', gate: 'forwarded', file: 'f.ts', line: 3 },
    { method: 'GET', path: '/api/d', review: 'no_gate_found', gate: 'public', file: 'f.ts', line: 4 },
  ];
  const ledger = { routes: {
    'GET /api/b': { review: 'no_gate_found', kind: 'unclassified', state: 'unreviewed' },
    'POST /api/c': { review: 'no_gate_found', kind: 'alias', state: 'unreviewed' },
    'GET /api/d': { review: 'no_gate_found', kind: 'public_content', state: 'public_by_design' },
    'GET /api/gone': { review: 'no_gate_found', kind: 'unclassified', state: 'unreviewed' },
  } };
  const p = ledgerProblems(rows, ledger, { root: ROOT, mounts: [{ path: '/api/empty', file: 'e.ts' }] });
  // Mutation checked: the missing-entry check dropped → GET /api/a passes unlisted and this fails.
  assert.ok(p.some((x) => x.startsWith('GET /api/a — no_gate_found')), 'a new unknown');
  assert.ok(p.some((x) => x.startsWith('GET /api/b — the route now reads as gated')), 'an entry the route outgrew');
  assert.ok(p.some((x) => x.startsWith('POST /api/c — the ledger says no_gate_found, the reader says forwarded')));
  assert.ok(p.some((x) => x.startsWith('GET /api/d — public_by_design needs a note')));
  assert.ok(p.some((x) => x.startsWith('GET /api/gone — the ledger names a route')));
  assert.ok(p.some((x) => x.startsWith('/api/empty (e.ts) — the mount resolves to no route')));
  assert.equal(p.length, 6);
  const ok = ledgerProblems(rows.slice(0, 1), { routes: { 'GET /api/a': { review: 'no_gate_found', kind: 'public_content', state: 'verified', test: 'scripts/lib/authInventory.test.mjs' } } }, { root: ROOT });
  assert.deepEqual(ok, []);
  assert.equal(ledgerProblems(rows.slice(0, 1), { routes: { 'GET /api/a': { review: 'no_gate_found', kind: 'x', state: 'verified', test: 'no/such.test.ts' } } }, { root: ROOT }).length, 2);
});

test('kindOf: hints for the reviewer', () => {
  const k = (path, review = 'no_gate_found') => kindOf({ path, review });
  assert.deepEqual(
    [k('/api/channels/zoom/webhook'), k('/api/calendar/google/callback'), k('/api/pipeline/ws/:deal_id'), k('/api/auth/magic/start'),
      k('/api/decks/print-export/:token'), k('/api/public/x'), k('/api/metrics/:p', 'forwarded'), k('/api/odd')],
    ['webhook', 'oauth_callback', 'websocket', 'sign_in', 'link_token', 'public_content', 'alias', 'unclassified'],
  );
});

test('the real Worker: routes an earlier reader misread are read right, and every route is in a family', () => {
  const rows = inventory(ROOT);
  const at = (method, path) => rows.find((r) => r.method === method && r.path === path);
  assert.ok(rows.length > 3000, `${rows.length} routes`);
  // A gate handed to a wrapper: `gate(c, requireSuperAdmin)`.
  assert.equal(at('GET', '/api/admin/event-syndication/channels')?.gate, 'super_admin');
  // A handler passed by name, its gate in a dynamic import: `await import('./admin_cohort')`.
  assert.equal(at('POST', '/api/admin/spinout-applications/:app_id/decide')?.gate, 'admin');
  // A local scope helper whose return type holds braces.
  assert.equal(at('GET', '/api/founder/board/:projectId')?.gate, 'authenticated');
  // A curried wrapper: `handle(async (c, ctx) => …)`.
  assert.equal(at('GET', '/api/publish/destinations')?.gate, 'authenticated');
  // A relay to another router is named for what it is.
  assert.equal(at('GET', '/api/metrics/:projectId')?.gate, 'forwarded');
  // App middleware on every /api/* request gates nothing: a published article still reads as public.
  // Mutation checked: '/api/*' middleware counted → this reads optional_auth and fails.
  assert.equal(at('GET', '/api/articles')?.gate, 'public');
  for (const r of rows) assert.match(r.family, /^\/api\/[^/]+$/, `${r.method} ${r.path}`);
});
