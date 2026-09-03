/**
 * The guard that migration 196 needed, and a pin on 196 itself.
 *
 * 196 shipped naming `quotes.partner_id` and `service_offerings.owner_user_id`.
 * Both tables carry three `CREATE TABLE IF NOT EXISTS` definitions and those
 * two columns come from OPPOSITE lineages — `partner_id` only from
 * `t13_t14_t15.sql`, `owner_user_id` only from `schema.sql` / migration 034.
 * D1 keeps one table per name, so the first file to run won and the rest were
 * no-ops: no ordering of them yields a database holding both columns. The file
 * could not apply anywhere, and did not — the production run failed and D1
 * rolled the whole thing back, which is the only reason the schema is not now
 * half-migrated.
 *
 * `scripts/check-migration-column-shapes.mjs` fails the build on that class.
 * The danger with a checker of this shape is that it rots into a vacuous pass:
 * one regex that stops matching and it prints ✓ over anything. So the pure
 * functions are exercised against known input here, not just the live tree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  referencedColumns,
  alteredColumns,
  violations,
} from '../../scripts/check-migration-column-shapes.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const M = 'cloudflare-worker/sql/migrations';

test('the checker actually reads both reference forms', () => {
  const refs = referencedColumns(`
    -- a comment naming ghost.column that must not count
    CREATE INDEX IF NOT EXISTS ix ON widgets(owner_id, company_id);
    UPDATE gadgets SET x = (SELECT 1 FROM users u WHERE u.partner_id = gadgets.thing_id);
  `);
  assert.deepEqual([...(refs.get('widgets') ?? [])].sort(), ['company_id', 'owner_id'],
    'CREATE INDEX columns must be attributed to the indexed table');
  assert.ok(refs.get('u')?.has('partner_id'), 'qualified alias.column must be read');
  assert.ok(refs.get('gadgets')?.has('thing_id'), 'qualified table.column must be read');
  assert.ok(!refs.get('ghost'), 'a reference inside a comment is not a reference');
});

test('a column added by an ALTER counts as present whichever shape won', () => {
  const added = alteredColumns();
  // 196 adds these four; that is precisely why indexing `company_id` alone is
  // safe on a table whose base shape nobody here can determine.
  for (const t of ['quotes', 'engagements', 'comarketing_pitches', 'service_offerings']) {
    assert.ok(added.get(t)?.has('company_id'), `${t}.company_id must be seen as ALTER-added`);
  }
});

test('196 no longer reads a column from a shape that may not be live', () => {
  const sql = read(`${M}/196_partner_company.sql`);
  const code = sql.replace(/--.*$/gm, '');
  assert.ok(!/\bquotes\.partner_id\b/.test(code),
    '196 reads quotes.partner_id again — absent from the schema.sql shape');
  assert.ok(!/\bservice_offerings\.owner_user_id\b/.test(code),
    '196 reads service_offerings.owner_user_id again — absent from the t13 shape');
  assert.match(code, /CREATE INDEX IF NOT EXISTS idx_quotes_company ON quotes\(company_id\)/,
    'the quotes index must lead with the ALTER-added column, not the ambiguous one');
  assert.match(code, /CREATE INDEX IF NOT EXISTS idx_offerings_company ON service_offerings\(company_id\)/,
    'same for service_offerings');
  // The two single-definition tables keep their real backfills — dropping those
  // would be a retreat rather than a fix.
  assert.match(code, /UPDATE engagements/);
  assert.match(code, /UPDATE comarketing_pitches/);
});

test('no migration reads a shape-dependent column', () => {
  assert.deepEqual(
    violations().map((v) => `${v.file}: ${v.table}.${v.column}`),
    [],
    'a migration names a column only some definitions of its table have — it '
    + 'cannot apply unless that shape happened to win',
  );
});

test('the Super Admin migration is reachable behind a sequence that can apply', () => {
  // 199 creates `super_admins`, the side table `is_super_admin` — the flag
  // `shellRoleFor` keys the HQ shell on — is hydrated from. The runner is
  // forward-only and ordered, so 199 cannot land while any earlier pending
  // file is unapplicable — which is how a broken 196 kept the Super Admin
  // invisible in production rather than merely late.
  const seq = ['196_partner_company', '197_advisor_profile_company', '198_perk_company', '199_super_admin'];
  for (const name of seq) {
    assert.ok(read(`${M}/${name}.sql`).trim().length > 0, `${name}.sql is missing`);
  }
  assert.match(read(`${M}/199_super_admin.sql`).replace(/--.*$/gm, ''),
    /CREATE TABLE IF NOT EXISTS super_admins \(\s*user_id\s+INTEGER PRIMARY KEY/);
  assert.match(read('frontend/src/App.jsx'),
    /role === 'admin' && Number\(user\?\.is_super_admin \?\? 0\) === 1 \? 'super_admin' : role/,
    'the HQ shell must still key on the flag /me echoes from the side table');
});

test('no migration numbered above 198 adds a column to users', () => {
  // D1 caps a table at 100 columns and `users` is there. The first deploy
  // that ran migrations before shipping (#413, 2026-09-03) failed at 199's
  // `ALTER TABLE users ADD COLUMN` with "too many columns on
  // sqlite_altertab_users", and held 200–207 out of production behind it.
  // 198 was the last file production had applied when it hit. GOTCHAS names
  // the fix — a side table keyed by user_id — and this makes forgetting it a
  // build failure instead of a failed deploy.
  const offenders = readdirSync(M)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && parseInt(f, 10) > 198)
    .filter((f) => /ALTER\s+TABLE\s+users\s+ADD\s+COLUMN/i.test(read(`${M}/${f}`).replace(/--.*$/gm, '')));
  assert.deepEqual(offenders, [],
    'users cannot take another column on D1 — keep the fact in a side table keyed by user_id (GOTCHAS)');
});

test('migration 207 sits behind 199 and names a single holder', () => {
  // 199 grants nobody; 207 is the decision 199's header defers — one
  // franchisor, by name. It has to sort after 199 or its INSERT runs against
  // a table that does not exist yet.
  const sql = read(`${M}/207_super_admin_single_holder.sql`);
  assert.ok(sql.trim().length > 0, '207_super_admin_single_holder.sql is missing');
  const code = sql.replace(/--.*$/gm, '');
  assert.match(code, /LOWER\(email\) = 'guillaume\.lauzier@axal\.vc'/);
  assert.match(code, /INTO super_admins/, '207 writes the side table 199 creates');
  assert.ok(parseInt('207', 10) > parseInt('199', 10));
  assert.doesNotMatch(code, /ALTER TABLE/, '207 writes the table 199 creates; it must not re-shape anything');
});

/* ────────────────────────────────────────────────────────────────────────────
 * Migration 200 — the rebuild that moves production onto the shape the code
 * reads. A rebuild is the one migration shape that can lose data silently, so
 * the properties that stop it doing so are pinned rather than trusted.
 * ──────────────────────────────────────────────────────────────────────────── */

const M200 = `${M}/200_service_offerings_shape.sql`;
const codeOf = (p) => read(p).replace(/--.*$/gm, '');

test('200 fails before it mutates anything on a database already in the target shape', () => {
  const first = codeOf(M200).trim().split(';')[0].trim();
  assert.match(first, /SELECT\s+partner_id\s+FROM\s+service_offerings\s+WHERE\s+0/i,
    'the preflight must be the FIRST statement — a database built from migrations '
    + 'alone has no partner_id, and it must fail there rather than part-way through');
});

test('200 preserves the ids the service_engagements foreign key points at', () => {
  const insert = /INSERT INTO service_offerings_new\s*\(([^)]*)\)/i.exec(codeOf(M200));
  assert.ok(insert, 'the copy INSERT must name its columns explicitly');
  assert.match(insert[1], /\bid\b/,
    'id must be copied, not regenerated — service_engagements.offering_id references it');
  assert.match(read('cloudflare-worker/sql/schema.sql'),
    /offering_id INTEGER NOT NULL REFERENCES service_offerings\(id\)/,
    'if this reference ever moves, the id-preservation rule above moves with it');
});

test('200 archives the rows it cannot migrate instead of dropping them', () => {
  const code = codeOf(M200);
  assert.match(code, /CREATE TABLE IF NOT EXISTS service_offerings_orphans_pre200/,
    'rows whose partner_id resolves to no user cannot enter a NOT NULL owner_user_id '
    + 'and must be parked, not discarded');
  assert.ok(
    code.indexOf('service_offerings_orphans_pre200') < code.indexOf('DROP TABLE service_offerings'),
    'the archive has to be written while the source table still exists',
  );
  assert.ok(
    code.indexOf('DROP TABLE service_offerings') < code.indexOf('RENAME TO service_offerings'),
    'drop-then-rename: a RENAME TO rewrites the REFERENCES clause in '
    + 'service_engagements, so renaming the old table aside repoints the FK at it',
  );
});

test('the shape 200 builds is the shape routes/services.ts writes', () => {
  // The drift behind all of this was a route and a table disagreeing with
  // nothing in the build to notice. This is that check.
  const created = /CREATE TABLE service_offerings_new \(([\s\S]*?)\n\);/.exec(codeOf(M200));
  assert.ok(created, 'could not read the target shape out of 200');
  const columns = new Set(
    created[1].split('\n')
      .map((l) => /^\s*([a-z_]\w*)\s+\w/i.exec(l))
      .filter(Boolean)
      .map((m) => m[1].toLowerCase()),
  );
  assert.ok(columns.has('owner_user_id') && columns.has('company_id'),
    'the rebuild must carry both the target owner column and 196’s company_id');

  const route = read('cloudflare-worker/src/routes/services.ts');
  const inserted = /INSERT INTO service_offerings \(([^)]*)\)/.exec(route);
  assert.ok(inserted, 'services.ts must still have its INSERT');
  for (const col of inserted[1].split(',').map((c) => c.trim().toLowerCase())) {
    assert.ok(columns.has(col), `services.ts inserts ${col}, which 200 does not create`);
  }
});

test('the op.service checklist item queries a table and column that exist', () => {
  // Comment-stripped: the header deliberately still narrates the old typo, and
  // a test that cannot tell a query from a comment is how the typo survived.
  const src = codeOnly(read('cloudflare-worker/src/services/onboardingChecklist.ts'));
  assert.ok(!/services_offerings/.test(src),
    'services_offerings is a typo for a table that has never existed');
  assert.ok(!/FROM service_offerings WHERE user_id/.test(src),
    'service_offerings.user_id exists in neither declared shape');
  assert.match(src, /FROM service_offerings WHERE owner_user_id = \?/);
});
