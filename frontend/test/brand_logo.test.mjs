/**
 * The wordmark is type, and the login logo goes home.
 *
 * WHY THIS FILE EXISTS. Nothing pinned the logo, so "unified platform logo"
 * was able to replace a mark-plus-text lockup with `/axal-wordmark.png` — a PNG
 * with the words baked in — across the login corner, the dashboard header, the
 * public nav and the footer, and no check noticed. A build does not care
 * whether type is type, and no test rendered any of those surfaces.
 *
 * What a baked wordmark costs: the words cannot be selected, searched or
 * translated, a screen reader gets them only through `alt`, they blur when the
 * page is zoomed, they are frozen in one colour whatever dark mode does, and it
 * is 13 KB to draw two words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const logo = read('frontend/src/components/AxalLogo.jsx');
const authShell = read('frontend/src/components/auth/AuthShell.jsx');

test('the wordmark is rendered as text, not as an image', () => {
  // The name must appear as a text node in the component, set from the shared
  // display token rather than a hardcoded family — a brand change should land
  // in `index.css`, not in eight call sites.
  assert.match(logo, />\s*Axal VC\s*</, 'the component must render the name as text');
  assert.match(logo, /fontFamily: 'var\(--font-display\)'/,
    'the type must come from the --font-display token');
  assert.match(read('frontend/src/index.css'), /--font-display:/,
    'the token the logo names must exist');

  // The icon stays an image — only the typography had to stop being one — but
  // it must not re-announce the name the text beside it already carries.
  assert.match(logo, /aria-hidden="true"/,
    'the decorative icon must not be read out beside the real text');
});

test('no screen renders the baked wordmark PNG', () => {
  // It survives for generated artefacts (brand kits, PDFs) where there is no
  // DOM to set type in. Any component or page reaching for it is the
  // regression coming back.
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(p)) files.push(p);
    }
  }(resolve(root, 'frontend/src')));

  const offenders = files
    .filter((f) => !f.endsWith('AxalLogo.jsx') && !f.endsWith('brandKit.js'))
    .filter((f) => /axal-wordmark|AXAL_WORDMARK/.test(codeOnly(readFileSync(f, 'utf8'))))
    .map((f) => relative(root, f));
  assert.deepEqual(offenders, [],
    `these render the baked wordmark instead of type: ${offenders.join(', ')}`);

  // And the one legitimate consumer still has it, so this is a scoping rule
  // rather than a deletion nobody noticed.
  assert.match(read('frontend/src/templates/brandKit.js'), /axal-wordmark\.png/,
    'brandKit feeds generated assets and keeps the flat image on purpose');
});

test('the login logo is a link home, and is not nested inside another link', () => {
  const code = codeOnly(authShell);
  assert.match(code, /<Link to="\/"[^>]*>\s*<AxalLogo/,
    'the auth shell logo must be wrapped in a link to /');
  assert.match(code, /aria-label="Axal VC home"/,
    'the link needs an accessible name — its only child is a decorative icon plus the wordmark');

  // AxalLogo itself must stay presentational: PublicNav already wraps it, and
  // an anchor inside an anchor is invalid HTML that browsers silently reflow.
  assert.doesNotMatch(codeOnly(logo), /<Link\b|<a\b/,
    'AxalLogo must not contain its own link — call sites wrap it');
  assert.match(codeOnly(read('frontend/src/components/PublicNav.jsx')), /<Link to="\/"[^>]*>\s*<AxalLogo/,
    'the public nav wraps it too, which is why the component cannot');
});

test('the app-header lockup stays ink on its dark-mode light island', () => {
  // The header wraps the logo in dark:bg-white/95 so the colourful mark sits
  // on a light chip against the dark header. Default AxalLogo ink is
  // dark:text-gray-100 — white words on that chip, which is how "Axal VC"
  // vanished in dark mode. onLight keeps gray-900 in both themes.
  const app = read('frontend/src/App.jsx');
  const headerStart = app.indexOf('Carta-style global top header');
  assert.ok(headerStart >= 0, 'the global header landmark must still exist');
  const header = app.slice(headerStart, headerStart + 1200);
  assert.match(header, /dark:bg-white\/95/,
    'the dark-mode header still uses a light island for the lockup');
  assert.match(header, /<AxalLogo size="sm" onLight/,
    'that island must pass onLight so the wordmark does not flip to near-white');
  assert.match(logo, /onLight \? 'text-gray-900 dark:text-gray-900'/,
    'onLight must keep ink in both themes, not dark:text-gray-100');
  assert.match(logo, /onDark \? 'text-white' : onLight/,
    'onDark (login photo) still wins over onLight');
});
