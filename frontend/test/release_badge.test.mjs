// The version beside the logo (frontend/src/lib/release.js, AxalLogo's ReleaseBadge).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AxalLogo, { ReleaseBadge } from '../src/components/AxalLogo.jsx';

const h = React.createElement;

test('a release tag shows as itself, amber while alpha', () => {
  const html = renderToStaticMarkup(h(ReleaseBadge, { tag: 'v0.2.0-alpha' }));
  assert.match(html, />v0\.2\.0-alpha</);
  assert.match(html, /bg-amber-100/);
  assert.match(html, /title="Alpha: features are still being built and may change\."/);
});

test('with no release built in, the badge says the stage alone', () => {
  assert.match(renderToStaticMarkup(h(ReleaseBadge, { tag: '' })), />alpha</);
});

test('the logo shows the badge only where asked', () => {
  assert.doesNotMatch(renderToStaticMarkup(h(AxalLogo, {})), /release-badge/);
  assert.match(renderToStaticMarkup(h(AxalLogo, { showRelease: true })), /release-badge/);
});

test('the app header and the public nav show it beside the logo', () => {
  for (const f of ['frontend/src/App.jsx', 'frontend/src/components/PublicNav.jsx']) {
    assert.match(readFileSync(f, 'utf8'), /<AxalLogo size="sm" onLight showRelease \/>/, f);
  }
});

test('the deploy builds the newest published release into VITE_AXAL_RELEASE, and publishing redeploys main', () => {
  const deploy = readFileSync('.github/workflows/cloudflare-worker-deploy.yml', 'utf8');
  assert.match(deploy, /gh release list [^\n]*--exclude-drafts/);
  assert.match(deploy, /VITE_AXAL_RELEASE: \$\{\{ steps\.release\.outputs\.tag \}\}/);
  const published = readFileSync('.github/workflows/release-published.yml', 'utf8');
  assert.match(published, /types: \[published\]/);
  assert.match(published, /gh workflow run cloudflare-worker-deploy\.yml [^\n]*--ref main/);
});
