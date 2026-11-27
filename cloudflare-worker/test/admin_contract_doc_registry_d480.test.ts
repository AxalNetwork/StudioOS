/**
 * D480 — registry routes mounted outside admin_contracts; publish gated + audited.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = readFileSync(resolve(ROOT, 'src/index.ts'), 'utf8');
const registrySrc = readFileSync(resolve(ROOT, 'src/routes/admin_contract_doc_registry.ts'), 'utf8');
const contractsSrc = readFileSync(resolve(ROOT, 'src/routes/admin_contracts.ts'), 'utf8');

test('registry mount precedes the contracts router', () => {
  const reg = indexSrc.indexOf("app.route('/api/admin/contracts/registry'");
  const con = indexSrc.indexOf("app.route('/api/admin/contracts', adminContracts)");
  assert.ok(reg >= 0 && con > reg);
});

test('doc-types read lives in the registry route file, not admin_contracts', () => {
  assert.doesNotMatch(contractsSrc, /adminContracts\.get\('\/doc-types'/);
  assert.match(registrySrc, /registry\.get\('\/doc-types'/);
});

test('publish requires the super-admin write bar and audits registry.type.publish', () => {
  assert.match(registrySrc, /requireSuperAdminWriteBar\(c\)/);
  assert.match(registrySrc, /registry\.type\.publish/);
  assert.match(registrySrc, /logAdminAction/);
  assert.match(registrySrc, /REGISTRY_PUBLISH_REASON_MIN/);
});
