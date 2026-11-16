/**
 * D5074 slice 5 (#5074) — Use of funds reads who the viewer is from the plan read's capability map alone. The pure
 * view (`uofViewer`, `planViewer`), the link form, and source pins that no Use of funds page reads the plan's old
 * `viewer` field or the account. The mounted cases are in `use_of_funds_tool_d1177.test.mjs` (its plan fixture), and
 * the Worker side, with the mirror pin, is `cloudflare-worker/test/uof_capabilities_5074.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/uof_capabilities_5074.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planViewer, tabSearch, uofViewer } from '../src/pages/raise/useoffunds/useOfFundsModel.js';
import { uofCapabilities } from './_uof_capabilities.mjs';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('the view: each map reads as it says; no map, or a non-true value, allows nothing', () => {
  const pick = ({ known, kind, can_write, mercury }) => ({ known, kind, can_write, mercury });
  assert.deepEqual(pick(uofViewer(uofCapabilities({ founderAccount: true }))), { known: true, kind: 'founder', can_write: true, mercury: true });
  assert.deepEqual(pick(uofViewer(uofCapabilities({ admin: true }))), { known: true, kind: 'admin', can_write: true, mercury: false });
  assert.deepEqual(pick(uofViewer(uofCapabilities({ founderAccount: true, support: true }))), { known: true, kind: 'founder', can_write: false, mercury: false });
  for (const none of [null, undefined, 'edit', { edit: 'true' }, { edit: 1, mercury: 'yes', admin_logged: 1 }]) {
    const v = uofViewer(none);
    assert.equal(v.can_write, false, JSON.stringify(none));
    assert.equal(v.mercury, false);
    assert.equal(v.kind, 'founder');
  }
  // The plan's own `viewer` field is never read.
  assert.equal(planViewer({ viewer: { kind: 'admin', can_write: true, mercury: true } }).can_write, false);
  assert.equal(planViewer({ viewer: { kind: 'admin' }, capabilities: { edit: true, admin_logged: true } }).kind, 'admin');
});

test('a tab link names the venture in the one form, whatever alias came in', () => {
  for (const search of ['?project_id=3', '?project=3', '?project=3&moved=1', '?project_id=3&project=9']) assert.equal(tabSearch(search), '?project_id=3', search);
  assert.equal(tabSearch('?project=abc'), '');
  assert.equal(tabSearch(''), '');
});

test('no Use of funds page reads the plan\'s viewer field, the account, or parses the venture itself', () => {
  const dir = 'pages/raise/useoffunds';
  for (const f of ['UseOfFundsTool.jsx', 'UseOfFundsParts.jsx', 'ScenariosForecast.jsx', 'useOfFundsModel.js']) {
    const s = src(`${dir}/${f}`);
    assert.ok(!/plan\??\.viewer\b/.test(s), `${f} reads plan.viewer`);
    assert.ok(!/useAuth\(|user\??\.role/.test(s), `${f} reads the account`);
    assert.ok(!/get\('project_id'\)\s*\|\|\s*\w+\.get\('project'\)/.test(s), `${f} parses project_id || project`);
  }
  assert.match(src(`${dir}/useOfFundsModel.js`), /export const planViewer = \(plan\) => uofViewer\(plan\?\.capabilities\);/);
});
