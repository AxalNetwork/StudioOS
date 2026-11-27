import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('Studio Ops is not routed, linked, or exposed through the client API', () => {
  const app = read('frontend/src/App.jsx');
  const sidebar = read('frontend/src/sidebarConfig.js');
  const workspace = read('frontend/src/pages/SpinoutLabWorkspace.jsx');
  const api = read('frontend/src/lib/api.js');

  for (const source of [app, sidebar, workspace, api]) {
    assert.doesNotMatch(source, /\/studio-ops|\/studioops|StudioOpsPage|SpinoutLabStudioOpsPage/);
  }
});

test('Studio Ops implementation files and Worker routes are removed', () => {
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/StudioOpsPage.jsx')), false);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/SpinoutLabStudioOpsPage.jsx')), false);
  assert.equal(existsSync(resolve(root, 'cloudflare-worker/src/routes/studioops.ts')), false);

  const worker = read('cloudflare-worker/src/index.ts');
  const labRoutes = read('cloudflare-worker/src/routes/spinout_lab.ts');
  const catalog = read('cloudflare-worker/src/services/spinoutLabCatalog.ts');
  assert.doesNotMatch(worker, /\/api\/studioops/);
  assert.doesNotMatch(labRoutes, /\/studio-ops/);
  assert.doesNotMatch(catalog, /studio_ops_cadence_set/);
});