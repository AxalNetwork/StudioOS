/**
 * D454 — GET /api/admin/contracts/doc-types returns the code registry + usage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractsSrc = readFileSync(resolve(ROOT, 'src/routes/admin_contracts.ts'), 'utf8');
const registrySrc = readFileSync(resolve(ROOT, 'src/routes/admin_contract_doc_registry.ts'), 'utf8');

test('doc-types read is on the registry router', () => {
  assert.doesNotMatch(contractsSrc, /adminContracts\.get\('\/doc-types'/);
  assert.match(registrySrc, /registry\.get\('\/doc-types'/);
});

test('buildTemplateCatalog includes party_roles on every type', () => {
  assert.match(contractsSrc, /party_roles: \[\.\.\.partyRolesFor\(k\)\]/);
  assert.match(registrySrc, /type_count: items\.length/);
});
