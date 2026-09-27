/**
 * D457 — #865 review: territory draft isolation, deploy version honesty, overlay shell.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('Detail remounts when the selected licence changes so territory drafts do not leak', () => {
  const page = codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx'));
  assert.match(page, /<Detail key=\{sel\} uid=\{sel\}/, 'territory draft state must reset on licence switch');
});

test('deploy version renders Not recorded when no SHA is stamped', () => {
  assert.match(read('frontend/src/pages/hq/PlatformPage.jsx'), /DEPLOY_VERSION_ABSENT_REASON/);
  assert.match(read('frontend/src/pages/admin/AdminLicences.jsx'), /deployVersionDisplay\(mine\)/);
  assert.match(read('cloudflare-worker/src/routes/admin_deployments.ts'), /version_display/);
  assert.match(read('.github/workflows/cloudflare-worker-deploy.yml'), /WORKER_DEPLOY_VERSION:\$\{GITHUB_SHA\}/);
});

test('HQ Home kind filter lives on the oxblood bar with aria-pressed', () => {
  const home = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
  assert.match(home, /data-testid="hq-kind-filter"[\s\S]*aria-pressed=\{kindFilter === id\}/);
  assert.match(home, /data-testid="hq-kind-filter-empty"/);
});

test('scoped overview names an unreadable licence shell instead of Axal chrome', () => {
  assert.match(read('cloudflare-worker/src/routes/admin_hq.ts'), /licence_shell:/);
  assert.match(read('frontend/src/pages/hq/HqBranchOverlay.jsx'), /hq-licence-shell-unreadable/);
  assert.match(read('frontend/src/pages/hq/HqBranchOverlay.jsx'), /hexWithAlpha/);
});
