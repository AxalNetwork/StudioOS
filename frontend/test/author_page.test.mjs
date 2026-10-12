/**
 * Owner, 2026-10-12 — the author page is a profile with a photo, in the site
 * frame, at /authors/<id> and /authors/<name slug>.
 *
 * Pins:
 *   - the photo is the author's upload when one is offered, and their initials
 *     when none is (or it fails), never an empty circle;
 *   - the page reads the author by the address's key, id or slug, and replaces
 *     an id address with the slug the Worker names;
 *   - a logged-out visitor is not sent to /login from an author page;
 *   - the route stays mounted, and the page draws in the site frame.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const SRC = read('frontend/src/pages/AuthorProfilePage.jsx');

const { AuthorPhoto } = await import('../src/pages/AuthorProfilePage.jsx');
const { isPublicPath } = await import('../src/lib/api.js');

test('the photo is the upload when offered, the initials otherwise', () => {
  const withPhoto = renderToStaticMarkup(React.createElement(AuthorPhoto, {
    author: { id: 1, name: 'Guillaume Lauzier', headshot_url: '/api/settings/headshot/u1' },
  }));
  assert.match(withPhoto, /<img[^>]+src="\/api\/settings\/headshot\/u1"/);
  assert.match(withPhoto, /alt="Guillaume Lauzier"/);

  const without = renderToStaticMarkup(React.createElement(AuthorPhoto, { author: { id: 1, name: 'Guillaume Lauzier', headshot_url: null } }));
  assert.doesNotMatch(without, /<img/);
  assert.match(without, />GL</, 'the initials stand in for a missing photo');
  assert.match(SRC, /onError=\{\(\) => setFailed\(true\)\}/, 'a photo that fails to load falls back to the initials');
});

test('the page reads by the address key and shows the slug address', () => {
  assert.match(SRC, /api\.authorProfile\(key\)/, 'the id or the slug, as typed, goes to the Worker');
  assert.match(SRC, /navigate\(`\/authors\/\$\{author\.slug\}`, \{ replace: true \}\)/, 'an id address becomes the slug address');
  assert.match(SRC, /<SitePage /, 'the page draws in the site frame');
  assert.match(SRC, /<ArticleCard /, 'the articles are the Articles page cards');
});

test('an author page is public, and its route is mounted', () => {
  assert.equal(isPublicPath('/authors/guillaumelauzier'), true);
  assert.equal(isPublicPath('/authors/1'), true);
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/authors\/:userId" element=\{<AuthorProfilePage \/>\} \/>/);
});
