/**
 * D454 — GET /api/admin/contracts/doc-types returns the code registry + usage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/routes/admin_contracts.ts'), 'utf8');

test('doc-types is mounted before the :uid catch-all', () => {
  const docTypesAt = src.indexOf("adminContracts.get('/doc-types'");
  const uidAt = src.indexOf("adminContracts.get('/:uid'");
  assert.ok(docTypesAt >= 0, 'doc-types route missing');
  assert.ok(uidAt > docTypesAt, 'doc-types would be swallowed by /:uid');
});

test('buildTemplateCatalog includes party_roles on every type', () => {
  assert.match(src, /party_roles: \[\.\.\.partyRolesFor\(k\)\]/);
  assert.match(src, /type_count: items\.length/);
});
