// D5398: keep the CI age encryption-test tool independently verifiable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const installer = readFileSync(new URL('../../scripts/ci/install-age-linux.sh', import.meta.url), 'utf8');

test('CI installs age for both frontend test shards, not by an unreliable apt mirror', () => {
  assert.match(workflow, /- name: Install age\s+if: startsWith\(matrix\.part, 'frontend'\)\s+run: bash scripts\/ci\/install-age-linux\.sh/);
  assert.doesNotMatch(workflow, /apt-get install[^\n]*age/);
  assert.match(workflow, /node scripts\/test-drift-parts\.mjs/);
});

test('installer pins the upstream release URL and its GitHub-provided SHA256 digest', () => {
  assert.match(installer, /version="1\.3\.2"/);
  assert.match(installer, /digest="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"/);
  assert.match(installer, /github\.com\/FiloSottile\/age\/releases\/download/);
  assert.match(installer, /sha256sum --check --status/);
  assert.match(installer, /--retry 3 --retry-all-errors/);
  assert.match(installer, /age\/age-keygen/);
  assert.match(installer, /GITHUB_PATH/);
});
