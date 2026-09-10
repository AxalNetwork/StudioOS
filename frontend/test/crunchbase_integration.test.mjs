/**
 * Guard: Crunchbase stays on the connectable Integrations path, not the
 * Coming Soon waitlist. Project detail and Market Intel already call the
 * worker; this file pins the UI contract that lets a user paste a user_key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('registry lists Crunchbase as beta (Connect), not coming_soon', () => {
  const src = readFileSync(resolve(root, 'cloudflare-worker/src/integrations/registry.ts'), 'utf8');
  const block = src.slice(src.indexOf("key: 'crunchbase'"), src.indexOf("key: 'stripe'"));
  assert.match(block, /status:\s*'beta'/);
  assert.doesNotMatch(block, /status:\s*'coming_soon'/);
  assert.match(block, /auth_type:\s*'api_key'/);
});

test('registry lists Carta and DocuSign as beta (Connect), not coming_soon', () => {
  const src = readFileSync(resolve(root, 'cloudflare-worker/src/integrations/registry.ts'), 'utf8');
  const carta = src.slice(src.indexOf("key: 'carta'"), src.indexOf("key: 'slack'"));
  assert.match(carta, /status:\s*'beta'/);
  assert.doesNotMatch(carta, /status:\s*'coming_soon'/);
  assert.match(carta, /auth_type:\s*'oauth2'/);
  const ds = src.slice(src.indexOf("key: 'docusign'"), src.indexOf("key: 'crunchbase'"));
  assert.match(ds, /status:\s*'beta'/);
  assert.doesNotMatch(ds, /status:\s*'coming_soon'/);
  assert.match(ds, /auth_type:\s*'oauth2'/);
});

test('Integrations connect modal has a Crunchbase user_key field', () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/IntegrationsPage.jsx'), 'utf8');
  assert.match(src, /data-testid=\{provider\.key === 'crunchbase' \? 'crunchbase-user-key'/);
  assert.match(src, /Crunchbase Basic user key/);
  assert.match(src, /data\.crunchbase\.com/);
});

test('DocuSign connect modal sends demo=0|1 and has an account picker', () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/IntegrationsPage.jsx'), 'utf8');
  assert.match(src, /data-testid="docusign-env-picker"/);
  assert.match(src, /params\.demo = dsDemo \? '1' : '0'/);
});

test('SPA calls the three Crunchbase enrichment routes the worker mounts', () => {
  const api = readFileSync(resolve(root, 'frontend/src/lib/api.js'), 'utf8');
  assert.match(api, /\/crunchbase\/search\?/);
  assert.match(api, /\/crunchbase\/projects\/\$\{projectId\}\/apply/);
  assert.match(api, /\/crunchbase\/projects\/\$\{projectId\}\/competitors/);
  const worker = readFileSync(resolve(root, 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.match(worker, /app\.route\('\/api\/crunchbase'/);
  assert.match(worker, /integrations\/providers\/crunchbase/);
});

test('ProjectDetail lookup / apply / competitors are wired to api.crunchbase*', () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/ProjectDetail.jsx'), 'utf8');
  assert.match(src, /api\.crunchbaseSearch\(/);
  assert.match(src, /api\.crunchbaseApply\(/);
  assert.match(src, /api\.crunchbaseCompetitors\(/);
});
