/**
 * D1415 (#3697, part 2) — slugs per scope: company slugs on create, project
 * slugs within their company or among standalone projects, moves, and path
 * resolution through `slug_history`, on real SQLite (see `_portfolio_d1415_fixture.ts`).
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/portfolio_slugs_d1415.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, envOf, call, M685, ADA, BEN, CY, DEE, EVE, NORTH, SOUTH, WEST, VENTURE, SOLO, DOCK, RELIC, PRIVATE } from './_portfolio_d1415_fixture.ts';

const history = (db: any) => (db.prepare('SELECT kind, scope_company_id, slug, target_id FROM slug_history ORDER BY id').all() as any[]).map((r) => ({ ...r }));
const slugOf = (db: any, id: number) => (db.prepare('SELECT slug FROM projects WHERE id = ?').get(id) as any).slug;

// ── Company create ──────────────────────────────────────────────────────────

test('company create: a slug from the name, -2 on a clash, a given slug checked, and the legal fields stored', async () => {
  // Mutation checked: generateSlug returning the base without checking it is free (the second "Northwind Labs" clashes).
  const db = fixture(); const env = envOf(db);
  const a = await call(env, DEE, 'POST', '/api/company/create', { company_name: 'Northwind Labs', legal_form: 'llc', jurisdiction: 'us-de' });
  assert.equal(a.status, 200, a.text);
  const row = db.prepare("SELECT slug, legal_form, jurisdiction FROM company_profiles WHERE company_name = 'Northwind Labs'").get() as any;
  assert.deepEqual({ ...row }, { slug: 'northwind-labs', legal_form: 'llc', jurisdiction: 'US-DE' });
  const b = await call(env, BEN, 'POST', '/api/company/create', { company_name: 'Northwind Labs' });
  assert.equal(b.status, 200, b.text);
  assert.equal((db.prepare("SELECT slug FROM company_profiles WHERE uid = ?").get(b.body.uid) as any).slug, 'northwind-labs-2');
  assert.equal((await call(env, BEN, 'POST', '/api/company/create', { company_name: 'Other', slug: 'northwind' })).body.error, 'slug_taken');
  assert.equal((await call(env, BEN, 'POST', '/api/company/create', { company_name: 'Other', slug: 'settings' })).body.error, 'slug_reserved');
  assert.equal((await call(env, BEN, 'POST', '/api/company/create', { company_name: 'Other', legal_form: 'corp' })).body.error, 'legal_form_invalid');
  assert.equal((await call(env, BEN, 'POST', '/api/company/create', { company_name: 'New' })).status, 200, 'a reserved name gets a suffixed slug');
  assert.equal((db.prepare("SELECT slug FROM company_profiles WHERE company_name = 'New'").get() as any).slug, 'new-2');
});

// ── Project slugs per scope ─────────────────────────────────────────────────

test('project slugs: the same slug in two companies, refused twice in one company and twice among standalone projects', async () => {
  // Mutations checked: the per-scope partial indexes replaced by one global unique index (migration); slugHolder
  // ignoring the scope.
  const db = fixture(); const env = envOf(db);
  const inSouth = await call(env, ADA, 'PUT', `/api/projects/${DOCK}/slug`, { slug: 'venture' });
  assert.equal(inSouth.status, 200, inSouth.text);
  assert.deepEqual(inSouth.body, { slug: 'venture', path: '/c/co-south/p/venture', previous_slug: null });
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (20, 'p-twin', 'Twin', 101, ?)").run(NORTH);
  const twin = await call(env, ADA, 'PUT', '/api/projects/20/slug', { slug: 'venture' });
  assert.equal(twin.status, 409);
  assert.equal(twin.body.error, 'slug_taken');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (21, 'p-loose', 'Loose', 101, NULL)").run();
  assert.equal((await call(env, ADA, 'PUT', '/api/projects/21/slug', { slug: 'solo' })).body.error, 'slug_taken', 'twice among standalone projects');
  assert.equal((await call(env, ADA, 'PUT', '/api/projects/21/slug', { slug: 'venture' })).status, 200, 'a standalone slug does not clash with a company\'s');
  assert.equal((await call(env, ADA, 'PUT', '/api/projects/21/slug', { slug: 'p' })).body.error, 'slug_reserved');
  assert.equal((await call(env, ADA, 'PUT', '/api/projects/21/slug', { slug: 'Has Space' })).body.error, 'slug_invalid');
  assert.equal((await call(env, BEN, 'PUT', `/api/projects/${VENTURE}/slug`, { slug: 'mine' })).status, 403, 'a co-founder is not the owner');
});

test('the per-scope indexes themselves refuse a second row in a scope and allow one per company', () => {
  const db = fixture();
  assert.throws(() => db.prepare("INSERT INTO projects (name, company_id, slug) VALUES ('X', ?, 'venture')").run(NORTH), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO projects (name, company_id, slug) VALUES ('X', NULL, 'solo')").run(), /UNIQUE/);
  db.prepare("INSERT INTO projects (name, company_id, slug) VALUES ('X', ?, 'venture')").run(WEST);
  db.prepare("INSERT INTO projects (name, company_id, slug) VALUES ('Y', NULL, 'venture')").run();
  // A global index would refuse these two: the mutation that swaps the partial indexes for one plain index fails here.
  const plain = M685.replace(/CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_in_company[\s\S]*?standalone ON projects\(slug\)\n  WHERE company_id IS NULL AND slug IS NOT NULL;/,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_global ON projects(slug) WHERE slug IS NOT NULL;');
  assert.notEqual(plain, M685, 'the mutation applies');
  const mutated = fixture({ migration685: plain });
  assert.throws(() => mutated.prepare("INSERT INTO projects (name, company_id, slug) VALUES ('X', ?, 'venture')").run(WEST), /UNIQUE/, 'a plain index would refuse the same slug in another company');
});

test('rename: the old slug goes to slug_history in the same batch, resolves with redirected, and no other project may claim it', async () => {
  // Mutations checked: retireSlug left out of the batch (no history); slugHolder reading only current slugs
  // (Twin claims the retired slug).
  const db = fixture(); const env = envOf(db);
  const renamed = await call(env, ADA, 'PUT', `/api/projects/${VENTURE}/slug`, { slug: 'venture-two' });
  assert.equal(renamed.body.previous_slug, 'venture');
  assert.deepEqual(history(db), [{ kind: 'project', scope_company_id: NORTH, slug: 'venture', target_id: VENTURE }]);
  const old = await call(env, BEN, 'GET', '/api/account/resolve?path=/c/northwind/p/venture');
  assert.equal(old.status, 200, old.text);
  assert.deepEqual(old.body, { kind: 'project', company_uid: 'co-north', project_id: VENTURE, canonical_path: '/c/northwind/p/venture-two', redirected: true });
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (20, 'p-twin', 'Twin', 101, ?)").run(NORTH);
  assert.equal((await call(env, ADA, 'PUT', '/api/projects/20/slug', { slug: 'venture' })).body.error, 'slug_taken', 'a retired slug stays with its project');
  assert.equal((await call(env, ADA, 'PUT', `/api/projects/${VENTURE}/slug`, { slug: 'venture' })).status, 200, 'its own project may take it back');
  assert.equal((await call(env, ADA, 'PUT', `/api/projects/${VENTURE}/slug`, { slug: 'venture-two' })).status, 200, 'and leave it again');
});

// ── Moves ───────────────────────────────────────────────────────────────────

test('move: into a scope that holds the slug is 409 with nothing changed; a move out retires the old address', async () => {
  // Mutations checked: the clash check dropped (the move lands and the batch fails or duplicates); the retire left
  // out of the move batch (the old path stops resolving).
  const db = fixture(); const env = envOf(db);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id, slug) VALUES (22, 'p-clash', 'Clash', 101, NULL, 'venture')").run();
  const clash = await call(env, ADA, 'POST', '/api/projects/22/move', { company_id: NORTH });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'slug_taken');
  assert.equal((db.prepare('SELECT company_id FROM projects WHERE id = 22').get() as any).company_id, null, 'company_id unchanged');

  const out = await call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: null });
  assert.equal(out.status, 409, 'Venture into the standalone scope clashes with Clash, which holds "venture" there');
  db.prepare('DELETE FROM projects WHERE id = 22').run();
  const moved = await call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: null });
  assert.equal(moved.status, 200, moved.text);
  assert.deepEqual(history(db), [{ kind: 'project', scope_company_id: NORTH, slug: 'venture', target_id: VENTURE }]);
  const old = await call(env, ADA, 'GET', '/api/account/resolve?path=/c/northwind/p/venture');
  assert.deepEqual([old.body.canonical_path, old.body.redirected], ['/p/venture', true], 'the old address follows the project');
  const back = await call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: NORTH });
  assert.equal(back.status, 200, 'its own retired slug does not block it coming back');
});

// ── Resolve ─────────────────────────────────────────────────────────────────

test('resolve: slugs, uids and ids; a non-member gets the same 404 as an unknown path; malformed paths are 400', async () => {
  // Mutations checked: the non-member answered 403 (differs from unknown); the project visibility check dropped
  // (Ben resolves Private); archived companies resolving.
  const db = fixture(); const env = envOf(db);
  const ok = async (who: number, path: string) => (await call(env, who, 'GET', `/api/account/resolve?path=${encodeURIComponent(path)}`)).body;
  assert.deepEqual(await ok(BEN, '/c/northwind'), { kind: 'company', company_uid: 'co-north', project_id: null, canonical_path: '/c/northwind', redirected: false });
  assert.deepEqual(await ok(BEN, '/c/co-north'), { kind: 'company', company_uid: 'co-north', project_id: null, canonical_path: '/c/northwind', redirected: true }, 'a uid resolves to the slug path');
  assert.equal((await ok(ADA, '/c/co-south')).redirected, false, 'a company without a slug is addressed by uid');
  assert.equal((await ok(ADA, `/c/co-south/p/${DOCK}`)).canonical_path, `/c/co-south/p/${DOCK}`, 'a project without a slug by id');
  assert.equal((await ok(ADA, `/p/${SOLO}`)).canonical_path, '/p/solo', 'an id resolves to the slug path');
  assert.equal((await ok(ADA, '/p/solo')).redirected, false);
  assert.equal((await ok(BEN, `/c/northwind/p/${VENTURE}`)).project_id, VENTURE);

  const status = async (who: number, path: string) => (await call(env, who, 'GET', `/api/account/resolve?path=${encodeURIComponent(path)}`));
  const unknown = await status(DEE, '/c/nowhere');
  const notMine = await status(DEE, '/c/northwind');
  assert.equal(notMine.status, 404);
  assert.deepEqual(notMine.body, unknown.body, 'a non-member reads exactly what an unknown path reads');
  assert.equal((await status(BEN, '/p/private')).status, 404);
  assert.equal((await status(BEN, `/p/${PRIVATE}`)).status, 404, 'a project id reached directly is still checked for visibility');
  const seat = await status(CY, `/p/${DOCK}`);
  assert.equal(seat.status, 200, 'a seat alone makes a project visible');
  assert.equal(seat.body.canonical_path, `/c/co-south/p/${DOCK}`);
  assert.equal((await status(BEN, `/c/westwind/p/${PRIVATE}`)).status, 404);
  assert.equal((await status(ADA, '/c/oldwind')).status, 404, 'an archived company does not resolve');
  assert.equal((await status(ADA, `/c/oldwind/p/${RELIC}`)).status, 404);
  assert.equal((await status(EVE, '/c/westwind')).status, 200, 'a platform admin resolves any');
  for (const bad of ['/x/northwind', '/c', '/c/northwind/p', '/c/north/wind/p/x', 'c/northwind', '/p/a/b']) {
    const r = await status(ADA, bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error, 'path_invalid');
  }
});

test('resolve: a company slug that was retired redirects to the company', async () => {
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: 'northwind-co' })).status, 200);
  const r = await call(env, BEN, 'GET', '/api/account/resolve?path=/c/northwind/p/venture');
  assert.deepEqual([r.body.canonical_path, r.body.redirected], ['/c/northwind-co/p/venture', true]);
  assert.equal(slugOf(db, VENTURE), 'venture');
  void SOUTH;
});
