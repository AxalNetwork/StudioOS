/**
 * D583 (#1210) — the Brand page's voice chips, dark logo and Archived status.
 * The Worker's half is cloudflare-worker/test/brand_voice_logo_archive_d583.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/brand_voice_logo_archive_d583.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { VOICE_MAX, VOICE_TAG_MAX_CHARS, addVoiceTag, removeVoiceTag, pageStatus } from '../src/lib/brand/brandKitExtras.js';
import { VoiceChips, DarkLogoField } from '../src/components/spinout/BrandKitExtras.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/SpinoutLabBrandPage.jsx'));
const PAGE_RAW = read('frontend/src/pages/SpinoutLabBrandPage.jsx');
const ROUTE = read('cloudflare-worker/src/routes/brand.ts');

test('the page\'s limits are the Worker\'s', () => {
  assert.equal(VOICE_MAX, 3);
  assert.ok(ROUTE.includes(`export const VOICE_MAX = ${VOICE_MAX};`));
  assert.ok(ROUTE.includes(`export const VOICE_TAG_MAX_CHARS = ${VOICE_TAG_MAX_CHARS};`));
});

test('a tag is trimmed, a duplicate is dropped, a fourth or an over-long one is refused', () => {
  let r = addVoiceTag([], '  Warm   and direct ');
  assert.deepEqual(r, { tags: ['Warm and direct'], error: null });
  r = addVoiceTag(['Calm'], 'calm');
  assert.deepEqual(r.tags, ['Calm']);
  assert.equal(r.error, null);
  r = addVoiceTag(['a', 'b', 'c'], 'd');
  assert.deepEqual(r.tags, ['a', 'b', 'c']);
  assert.match(r.error, /At most 3/);
  r = addVoiceTag([], 'x'.repeat(33));
  assert.deepEqual(r.tags, []);
  assert.match(r.error, /32 characters/);
  assert.deepEqual(addVoiceTag(['a'], '   ').tags, ['a']);
  assert.deepEqual(removeVoiceTag(['a', 'b'], 'a'), ['b']);
});

test('a page is Archived, Published or Draft', () => {
  assert.equal(pageStatus({ archived_at: '2026-10-06', published: false }), 'Archived');
  assert.equal(pageStatus({ published: true }), 'Published');
  assert.equal(pageStatus({ published: false }), 'Draft');
});

test('the chips show the tags, and the input goes once three are set', () => {
  const two = renderToStaticMarkup(h(VoiceChips, { tags: ['Calm', 'Bold'], onChange: () => {} }));
  assert.match(two, /Brand voice · 3 max/);
  assert.equal((two.match(/data-testid="brand-voice-chip"/g) || []).length, 2);
  assert.match(two, /data-testid="input-brand-voice"/);
  const three = renderToStaticMarkup(h(VoiceChips, { tags: ['a', 'b', 'c'], onChange: () => {} }));
  assert.doesNotMatch(three, /input-brand-voice/);
  assert.match(renderToStaticMarkup(h(VoiceChips, { tags: [], onChange: () => {} })), /No voice tags yet\./);
});

test('the dark logo field shows the logo on a dark tile, or an upload prompt', () => {
  const set = renderToStaticMarkup(h(DarkLogoField, { url: 'https://cdn.example.test/dark.png', onPick: () => {}, onClear: () => {} }));
  assert.match(set, /src="https:\/\/cdn\.example\.test\/dark\.png"/);
  assert.match(set, /Remove the dark logo/);
  const none = renderToStaticMarkup(h(DarkLogoField, { onPick: () => {}, onClear: () => {} }));
  assert.match(none, /Upload a dark-background logo/);
  assert.doesNotMatch(none, /Remove the dark logo/);
});

test('the page wires the chips, the dark logo, the status and archive/restore', () => {
  assert.match(PAGE, /<VoiceChips tags=\{draft\.voice_tags\} onChange=\{\(voice_tags\) => setDraft\(\(d\) => \(\{ \.\.\.d, voice_tags \}\)\)\} \/>/);
  assert.match(PAGE, /<DarkLogoField[\s\S]*?onPick=\{onUploadDarkLogo\}/);
  assert.match(PAGE, /const r = await api\.brandUploadLogo\(fd\);\s*setDraft\(\(d\) => \(\{ \.\.\.d, logo_dark_asset_id: r\?\.asset_id \|\| null, logo_dark_url: r\?\.url \|\| null, logo_dark_svg: null \}\)\);/);
  assert.match(PAGE, /voice_tags: Array\.isArray\(v\.voice_tags\) \? v\.voice_tags : \[\],/);
  assert.match(PAGE, /\{pageStatus\(p\)\}/);
  assert.match(PAGE, /onClick=\{\(\) => onArchivePage\(p, true\)\}/);
  assert.match(PAGE, /onClick=\{\(\) => onArchivePage\(p, false\)\}/);
  assert.match(PAGE, /setArchivedPages\('unreadable'\)/);
  assert.doesNotMatch(PAGE_RAW, /Omitted \(no backend\): brand-voice tags/, 'the header still lists them as omitted');
});

test('the client calls the archive route and the archived list', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.brandArchivePage(7, true);
    await api.brandArchivePage(7, false);
    await api.brandListPages(1);
    await api.brandListPages(1, { archived: true });
    assert.deepEqual(calls, [
      ['POST', '/brand/landing/pages/7/archive', { archived: true }],
      ['POST', '/brand/landing/pages/7/archive', { archived: false }],
      ['GET', '/brand/landing/by-project/1/pages', null],
      ['GET', '/brand/landing/by-project/1/pages?archived=1', null],
    ]);
  } finally { globalThis.fetch = original; }
});
