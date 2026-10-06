/**
 * D457 — #865 review: territory draft isolation, deploy version honesty, overlay shell.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DeployVersion from '../src/components/DeployVersion.jsx';
import { LicenceShellNotice } from '../src/pages/hq/HqBranchOverlay.jsx';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('Detail remounts when the selected licence changes so territory drafts do not leak', () => {
  const page = codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx'));
  assert.match(page, /<Detail key=\{sel\} uid=\{sel\}/, 'territory draft state must reset on licence switch');
});

test('deploy version renders Not recorded when no SHA is stamped', () => {
  // D515: rendered, not matched as text. The same component draws the line on
  // HQ's Platform page and on Admin · Licences.
  const none = renderToStaticMarkup(React.createElement(DeployVersion, { row: { live_state: 'ok', live: { deploy_version: null }, last_version: null } }));
  assert.match(none, />Not recorded</);
  assert.match(none, /title="No deploy version is stamped on this Worker yet\./);
  const live = renderToStaticMarkup(React.createElement(DeployVersion, { row: { live_state: 'ok', live: { deploy_version: 'abc123' }, last_version: 'old999' }, codeClassName: 'font-mono' }));
  assert.equal(live, '<code class="font-mono">abc123</code>');
  for (const page of ['frontend/src/pages/hq/PlatformPage.jsx', 'frontend/src/pages/admin/AdminLicences.jsx']) {
    assert.match(codeOnly(read(page)), /<DeployVersion row=\{(d|mine)\}/, `${page} draws the version through DeployVersion`);
  }
  assert.match(read('.github/workflows/cloudflare-worker-deploy.yml'), /WORKER_DEPLOY_VERSION:\$\{GITHUB_SHA\}/);
});

test('HQ Home kind filter lives on the oxblood bar with aria-pressed', () => {
  const home = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
  assert.match(home, /data-testid="hq-kind-filter"[\s\S]*aria-pressed=\{kindFilter === id\}/);
  assert.match(home, /data-testid="hq-kind-filter-empty"/);
});

test('scoped overview names an unreadable licence shell instead of Axal chrome', () => {
  // D515: rendered. A failed licence read is Unreadable with the route's
  // reason; it is never drawn as Axal's chrome or as a white-label panel.
  const html = renderToStaticMarkup(React.createElement(LicenceShellNotice, {
    licenceShell: { readable: false, reason: 'The territory licence ledger could not be read.' }, code: 'NO',
  }));
  assert.match(html, /data-testid="hq-licence-shell-unreadable"/);
  assert.match(html, /could not be read\. This is not Axal branding/);
  assert.match(html, /The territory licence ledger could not be read\./);
  assert.doesNotMatch(html, /hq-white-label-overlay/);
  const sub = renderToStaticMarkup(React.createElement(LicenceShellNotice, { licenceShell: { readable: true, kind: 'subsidiary', brand_name: 'Axal FR' }, code: 'FR' }));
  assert.equal(sub, '', 'an Axal subsidiary needs no shell notice');
  const wl = renderToStaticMarkup(React.createElement(LicenceShellNotice, {
    licenceShell: { readable: true, kind: 'white_label', brand_name: 'Nordlys', brand_kit: { primary_hex: '#1a7f5a' } }, code: 'NO',
  }));
  assert.match(wl, /data-testid="hq-white-label-overlay"/);
  assert.match(wl, /background-color:#1a7f5a/, 'the stored #rrggbb (brand.ts HEX_RE) is drawn as the swatch');
  assert.match(read('cloudflare-worker/src/routes/admin_hq.ts'), /licence_shell:/);
});
