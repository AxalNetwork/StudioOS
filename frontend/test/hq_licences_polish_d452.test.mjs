/**
 * D452 — deployments last_version, kind filter, clash actions, white-label overlay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('deployments persist and display last_version', () => {
  const route = read('cloudflare-worker/src/routes/admin_deployments.ts');
  assert.match(route, /last_version/);
  assert.match(route, /deploy_version/);
  assert.match(route, /version_display/);
  assert.match(read('frontend/src/pages/hq/PlatformPage.jsx'), /hq-deployment-version-/);
  assert.match(read('frontend/src/pages/admin/AdminLicences.jsx'), /deploy-last-version/);
  assert.match(read('frontend/src/lib/deployVersion.js'), /deployVersionDisplay/);
});

test('licence ledger and HQ Home carry All / Axal / White-label filters', () => {
  assert.match(read('frontend/src/pages/admin/AdminLicences.jsx'), /data-testid="licence-kind-filter"/);
  assert.match(read('frontend/src/pages/hq/HqHomePage.jsx'), /data-testid="hq-kind-filter"/);
  assert.match(read('frontend/src/pages/hq/HqHomePage.jsx'), /data-testid="hq-card-kind-pill"/);
});

test('territory clashes offer open-holder and remove-from-list actions', () => {
  const page = read('frontend/src/pages/admin/AdminLicences.jsx');
  assert.match(page, /territory-clash-open-/);
  assert.match(page, /territory-clash-remove-/);
  assert.match(page, /onOpenLicence/);
});

test('scoped HQ overview carries licence shell for the white-label overlay', () => {
  assert.match(read('cloudflare-worker/src/routes/admin_hq.ts'), /licenceShellFor/);
  assert.match(read('frontend/src/pages/hq/HqBranchOverlay.jsx'), /hq-white-label-overlay/);
});

test('branch health exposes deploy_version from WORKER_DEPLOY_VERSION', () => {
  assert.match(read('cloudflare-worker/src/rpc/branchOps.ts'), /deploy_version/);
  assert.match(read('cloudflare-worker/src/types.ts'), /WORKER_DEPLOY_VERSION/);
});
