/**
 * D751 (#1882) on the page: Admin → Integration keys says what to register
 * for each OAuth client — the Worker secret names (the Worker's, with the
 * page's map only as a fallback), the callback URL with Copy, what members
 * see while a key is missing, and the setup guide — and lists the clients set
 * only at deploy, read-only.
 *
 * `lib/integrationKeys.js` is pure, so every rule goes through it here. The
 * two new components are rendered to static markup; the panel's wiring is
 * read as source, bounded as `integration_keys_d227.test.mjs` bounds it. What
 * the Worker sends is pinned by
 * cloudflare-worker/test/integration_keys_setup_d751.test.ts. Each case names
 * the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/integration_keys_d751.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { adminConsoleSource } from './_adminConsoles.mjs';
import {
  CALLBACK_COPY, ENV_ONLY_NOTE, GUIDE_PREFIX, envNamesFor, membersSeeLine, safeGuideHref, wranglerPutLine,
} from '../src/lib/integrationKeys.js';
import { CallbackUrlField, EnvOnlyOauthCard } from '../src/pages/admin/consoles/IntegrationKeysConsole.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const h = React.createElement;
const RUNBOOK = 'https://github.com/AxalNetwork/StudioOS/blob/main/documentation/architecture/PRODUCTION.md';

// 1 ───────────────────────────────────────────────────────────────────────────
test('GitHub joins the page\'s maps, as the Worker already lists it', () => {
  // Mutation checked: GitHub removed from PROVIDER_ENV_NAMES.
  const src = adminConsoleSource();
  assert.match(src, /github:\s*'GitHub'/);
  assert.match(src, /github:\s*\['GITHUB_APP_CLIENT_ID',\s*'GITHUB_APP_CLIENT_SECRET'\]/);
  const hint = /github:\s*'([^']*)'/g;
  const hints = [...src.matchAll(hint)].map((m) => m[1]).filter((t) => t.includes('Read-only'));
  assert.equal(hints.length, 1, 'one GitHub hint');
  assert.match(hints[0], /\bIv\b/);
  assert.ok(!/\/api\/integrations\/oauth/.test(hints[0]), 'the hint names no callback: the Worker sends it');
  const worker = readFileSync(resolve(root, 'cloudflare-worker/src/services/providerOauthKeys.ts'), 'utf8');
  assert.match(worker, /github:\s*\{\s*id:\s*'GITHUB_APP_CLIENT_ID'/);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('envNamesFor prefers the Worker\'s names, and falls back to the map only when they are not two strings', () => {
  // Mutation checked: the map preferred over env_vars.
  const map = { slack: ['MAP_ID', 'MAP_SECRET'] };
  assert.deepEqual(envNamesFor({ provider_key: 'slack', env_vars: ['A', 'B'] }, map), ['A', 'B']);
  for (const env_vars of [undefined, ['A'], [1, 2], ['A', '']]) {
    assert.deepEqual(envNamesFor({ provider_key: 'slack', env_vars }, map), ['MAP_ID', 'MAP_SECRET'], JSON.stringify(env_vars));
  }
  assert.deepEqual(envNamesFor({ provider_key: 'nope' }, map), []);
  assert.deepEqual(envNamesFor({ provider_key: '__proto__' }, map), [], 'only own keys of the map');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('membersSeeLine: one sentence while a key is missing, coming soon apart, and nothing otherwise', () => {
  // Mutations checked: a line for a held key; the coming-soon branch dropped.
  const gh = { display_name: 'GitHub', status: 'beta', tier: 'free' };
  assert.equal(membersSeeLine({ connector: gh, unset: true }), 'Members see "Not set up here" on the GitHub card.');
  assert.equal(membersSeeLine({ connector: { display_name: 'Zoom', status: 'beta' }, unset: true }), 'Members see "Not set up here" on the Zoom card.');
  assert.equal(membersSeeLine({ connector: { display_name: 'Salesforce', status: 'coming_soon' }, unset: true }),
    "Salesforce is coming soon, so members can't connect it yet.");
  for (const args of [{ connector: gh, unset: false }, { connector: null, unset: true }, {}, undefined]) {
    assert.equal(membersSeeLine(args), '', JSON.stringify(args));
  }
  for (const c of [gh, { display_name: 'S', status: 'coming_soon' }]) assert.doesNotMatch(membersSeeLine({ connector: c, unset: true }), /refused|Ask your/);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('wranglerPutLine is the deploy runbook\'s form, from the repository root', () => {
  assert.equal(wranglerPutLine('ZOOM_CLIENT_ID'), 'npx wrangler secret put ZOOM_CLIENT_ID --config wrangler.toml --env production');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('safeGuideHref links only a document in this repository', () => {
  // Mutation checked: any https://github.com/ accepted.
  assert.equal(safeGuideHref(RUNBOOK), RUNBOOK);
  assert.ok(RUNBOOK.startsWith(GUIDE_PREFIX));
  for (const bad of ['https://evil.test/x', '//github.com/AxalNetwork/StudioOS/blob/main/documentation/x', 'javascript:alert(1)',
    'https://github.com/AxalNetwork/StudioOS/blob/main/cloudflare-worker/x', 'https://github.com/someone/else/blob/main/documentation/x',
    `${GUIDE_PREFIX}x" onmouseover="y`, undefined, null, 7]) {
    assert.equal(safeGuideHref(bad), null, String(bad));
  }
});

// 6 ───────────────────────────────────────────────────────────────────────────
const zoom = (extra = {}) => ({
  key: 'zoom', configured: false, env_vars: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN'], fallback_env_vars: null,
  callback_url: 'https://app.axal.vc/api/integrations/oauth/zoom/callback', connector: { display_name: 'Zoom', status: 'beta', tier: 'free' },
  guide_href: RUNBOOK, ...extra,
});
test('the callback field and the read-only deploy card', () => {
  // Mutation checked: a Test button on the env-only card.
  const field = renderToStaticMarkup(h(CallbackUrlField, { url: 'https://cb.example.test/x', name: 'GitHub', testid: 't', copyTestid: 'integration-key-callback-copy-github' }));
  assert.match(field, /Callback URL to register with GitHub/);
  assert.match(field, /https:\/\/cb\.example\.test\/x/);
  assert.match(field, /data-testid="integration-key-callback-copy-github"/);
  assert.match(field, new RegExp(`>${CALLBACK_COPY.idle}<`));

  const off = renderToStaticMarkup(h(EnvOnlyOauthCard, { row: zoom() }));
  for (const n of ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN']) assert.ok(off.includes(wranglerPutLine(n)), n);
  assert.match(off, /Members see &quot;Not set up here&quot; on the Zoom card\./);
  assert.ok(off.includes('data-testid="integration-key-guide-zoom"'), 'the guide link');
  assert.ok(off.includes(`href="${RUNBOOK}"`), 'to the guide');
  assert.match(off, /target="_blank"/);
  assert.match(off, /rel="noopener noreferrer"/);
  assert.match(off, /not configured/);
  for (const b of ['Configure', 'Rotate', 'Remove', '>Test<']) assert.ok(!off.includes(b), b);

  const on = renderToStaticMarkup(h(EnvOnlyOauthCard, { row: zoom({ configured: true }) }));
  assert.match(on, /Worker secret/);
  assert.ok(!on.includes('integration-key-members-zoom'), 'no members line once set up');

  const google = renderToStaticMarkup(h(EnvOnlyOauthCard, { row: zoom({
    key: 'google_calendar', env_vars: ['GOOGLE_CAL_CLIENT_ID', 'GOOGLE_CAL_CLIENT_SECRET'], fallback_env_vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    connector: { display_name: 'Google Calendar', status: 'live', tier: 'free' }, guide_href: null, callback_url: null,
  }) }));
  assert.match(google, /If these are unset, <code>GOOGLE_CLIENT_ID<\/code> and <code>GOOGLE_CLIENT_SECRET<\/code> are read instead\./);
  assert.ok(!google.includes('Callback URL'), 'no callback line without one');
  assert.ok(!google.includes('Setup guide'), 'no guide without one');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the panel reads the Worker\'s names, callback, members line and env-only list', () => {
  // Mutation checked: the other_oauth read removed.
  const PAGE = codeOnly(adminConsoleSource());
  const at = PAGE.indexOf('function IntegrationKeysPanel(');
  const PANEL = PAGE.slice(at, PAGE.indexOf('\nfunction ', at + 1));
  assert.match(PANEL, /envNamesFor\(row, PROVIDER_ENV_NAMES\)/);
  assert.match(PANEL, /membersSeeLine\(/);
  assert.match(PANEL, /<SetupLines/);
  assert.match(PANEL, /r\.other_oauth/);
  assert.match(PANEL, /integration-keys-env-only/);
  assert.match(PANEL, /callbackUrl: row\.callback_url/);
  assert.match(PANEL, /\{ENV_ONLY_NOTE\}/, 'the section says why these cannot be saved here');
  assert.match(ENV_ONLY_NOTE, /Nothing on this page shows a value\./);
});
