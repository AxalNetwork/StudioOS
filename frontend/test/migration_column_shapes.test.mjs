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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  // 199 adds `users.is_super_admin`, the flag `shellRoleFor` keys the HQ shell
  // on. The runner is forward-only and ordered, so 199 cannot land while any
  // earlier pending file is unapplicable — which is how a broken 196 kept the
  // Super Admin invisible in production rather than merely late.
  const seq = ['196_partner_company', '197_advisor_profile_company', '198_perk_company', '199_super_admin'];
  for (const name of seq) {
    assert.ok(read(`${M}/${name}.sql`).trim().length > 0, `${name}.sql is missing`);
  }
  assert.match(read(`${M}/199_super_admin.sql`),
    /ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0/);
  assert.match(read('frontend/src/App.jsx'),
    /role === 'admin' && Number\(user\?\.is_super_admin \?\? 0\) === 1 \? 'super_admin' : role/,
    'the HQ shell must still key on the flag 199 adds');
});
