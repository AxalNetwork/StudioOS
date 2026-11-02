/**
 * D1541 (#3779, deck v2 B3) — the elements library: `services/decks/elements.ts`,
 * `GET /api/decks/elements[/icons|/licence]` and the decor items `slideModel`
 * keeps.
 *
 *   · the SVG sanitiser rejects script, href (and xlink:) and foreignObject,
 *     event handlers, javascript: URLs, entities, <style> and external url();
 *   · decor is capped at 16 per card;
 *   · the icon set is open-licence (ISC), at least 1,000 icons, its licence
 *     recorded, and an icon's licence travels with the block;
 *   · every SVG the library draws passes the sanitiser.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_elements_d1541.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckElements from '../src/routes/deck_elements.ts';
import {
  DIVIDERS, ICON_LICENCE, LICENCE_RECORD, MAX_DECOR, SHAPES, TEXTURES, cleanDecorItem, decorSvg, iconCount, iconSvg, sanitizeSvg, searchIcons,
} from '../src/services/decks/elements.ts';
import { modelProblems, sanitizeModel } from '../src/services/decks/slideModel.ts';

const url = (u: string | null | undefined) => u ?? null;
const sanitizeSlides = (cards: any[]) => cards.map((c) => sanitizeModel(c, url) as any);
const slideProblems = (cards: any[]) => modelProblems(cards, url);
import { makeD1 } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { contractErrors } from '../src/contracts/validate.ts';

const OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h2"/></svg>';

test('the sanitiser rejects script, href and foreignObject, and every other way out of a drawing', () => {
  // Mutations checked: each BAD pattern removed in turn → its own assert fails (script, href, foreignObject first).
  assert.equal(sanitizeSvg(OK).ok, true);
  for (const [svg, why] of [
    ['<svg><script>alert(1)</script></svg>', 'script'],
    ['<svg><a href="https://x.example"><path d="M0 0"/></a></svg>', 'href'],
    ['<svg><use xlink:href="#a"/></svg>', 'href'],
    ['<svg><foreignObject><div>x</div></foreignObject></svg>', 'foreignObject'],
    ['<svg onload="x()"><path d="M0 0"/></svg>', 'event handler'],
    ['<svg><path d="M0 0" fill="javascript:x"/></svg>', 'javascript: URL'],
    ['<!DOCTYPE svg [<!ENTITY a "b">]><svg><path d="M0 0"/></svg>', 'entity'],
    ['<svg><style>path{}</style></svg>', 'style'],
    ['<svg><rect fill="url(https://x.example/a.svg)"/></svg>', 'external url()'],
    ['<svg><image width="1"/></svg>', 'the image element'],
    ['<svg><path d="M0 0" filter="x"/></svg>', 'the filter attribute'],
    ['<div></div>', 'not an SVG'],
  ] as const) {
    const r = sanitizeSvg(svg);
    assert.equal(r.ok, false, svg);
    assert.equal((r as any).reason, why, svg);
  }
  assert.equal(sanitizeSvg('<svg><rect fill="url(#t)"/></svg>').ok, true, 'a local pattern fill is a drawing');
});

test('the icon set: open-licence, at least 1,000 icons, its licence recorded with the full text', () => {
  assert.ok(iconCount() >= 1000, `${iconCount()} icons`);
  assert.ok(['MIT', 'ISC', 'Apache-2.0', 'OFL-1.1'].includes(LICENCE_RECORD.spdx), LICENCE_RECORD.spdx);
  assert.equal(LICENCE_RECORD.id, 'lucide');
  assert.match(LICENCE_RECORD.copyright, /^Copyright \(c\) .*Lucide/);
  assert.match(LICENCE_RECORD.derived, /Feather \(MIT/);
  const data = JSON.parse(readFileSync(new URL('../src/services/decks/iconSet.json', import.meta.url), 'utf8'));
  assert.match(data.set.licence_text, /^ISC License/);
  assert.match(data.set.licence_text, /Feather/, 'the Feather notice is kept');
  // The record names the version it was written from; when the package is installed, they agree.
  const pkg = new URL('../../node_modules/lucide-react/package.json', import.meta.url);
  if (existsSync(pkg)) assert.equal(JSON.parse(readFileSync(pkg, 'utf8')).license, data.set.spdx);
  assert.deepEqual(searchIcons('chart bar', 0, 5).names.every((n) => n.includes('chart') && n.includes('bar')), true);
  assert.equal(searchIcons('', 0, 500).names.length, 120, 'a page is at most 120');
});

test('every SVG the library draws passes the sanitiser, and an unknown item draws nothing', () => {
  // Mutation checked: `checked` returning its input unsanitised and an icon node gaining an onload → would ship; the
  // sanitiser assert on every drawn item holds the gate.
  for (const name of searchIcons('', 0, 120).names) assert.equal(sanitizeSvg(iconSvg(name)).ok, true, name);
  for (const [kind, list] of [['shape', SHAPES], ['divider', DIVIDERS], ['texture', TEXTURES]] as const) {
    assert.ok(list.length >= 6, `${kind}: ${list.length}`);
    for (const x of list) assert.equal(sanitizeSvg(decorSvg({ kind, ref: x.id, tone: 'accent' })).ok, true, `${kind}:${x.id}`);
  }
  assert.equal(decorSvg({ kind: 'shape', ref: 'nope' }), null);
  assert.equal(decorSvg({ kind: 'texture', ref: 'noise', seed: 7 }), decorSvg({ kind: 'texture', ref: 'noise', seed: 7 }), 'a texture draws the same from its seed');
  assert.notEqual(decorSvg({ kind: 'texture', ref: 'noise', seed: 7 }), decorSvg({ kind: 'texture', ref: 'noise', seed: 8 }));
  assert.match(iconSvg('house')!, /stroke="var\(--deck-ink\)"/, 'a theme tone, never a colour');
});

test('decor: at most 16 per card; an icon\'s licence is recorded and travels with the block; an unknown item is dropped', () => {
  // Mutations checked: cleanDecorItem without `licence` → the licence asserts fail; MAX_DECOR raised → the 16 asserts fail;
  // the unknown ref kept → the dropped assert fails.
  assert.equal(MAX_DECOR, 16);
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `d${i + 1}`, kind: 'icon', ref: 'house' }));
  const [card] = sanitizeSlides([{ title: 'Decor', decor: items }]);
  assert.equal(card.decor.length, 16, 'kept at 16');
  assert.ok(slideProblems([{ title: 'Decor', decor: items }]).some((p: string) => /at most 16 decor items/.test(p)));
  assert.deepEqual(card.decor[0], { id: 'd1', kind: 'icon', ref: 'house', tone: 'ink', licence: { set: 'lucide', version: ICON_LICENCE.version, spdx: 'ISC' } });
  // A client cannot write another licence: it is set from the library.
  assert.deepEqual(cleanDecorItem({ kind: 'icon', ref: 'house', licence: { set: 'mine', spdx: 'proprietary' } })!.licence, ICON_LICENCE);
  const mixed = sanitizeSlides([{ title: 'x', decor: [{ kind: 'icon', ref: 'not-an-icon' }, { kind: 'shape', ref: 'circle', tone: 'accent' }, { kind: 'sparkle' }] }])[0].decor;
  assert.deepEqual(mixed.map((d: any) => [d.kind, d.ref ?? null]), [['shape', 'circle'], ['sparkle', null]], 'an unknown icon dropped; a D1500 free kind kept as it was');
  assert.ok(slideProblems([{ title: 'x', decor: [{ kind: 'icon', ref: 'not-an-icon' }] }]).some((p: string) => /not in the elements library/.test(p)));
});

test('the routes: the library with its licence, a page of icons with their SVG, the licence text; generate is Coming later', async () => {
  const { DB } = makeD1('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);', "INSERT INTO users VALUES (2, 'm@example.invalid', 'Member', 'founder', 1);");
  const env: any = { DB, JWT_SECRET: 'synthetic-d1541-only-not-a-real-credential'.repeat(2), ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', deckElements);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const get = async (p: string) => app.request(p, { headers: { Authorization: `Bearer ${jwt}` } }, env);
  const lib = await (await get('/api/decks/elements')).json() as any;
  assert.deepEqual(lib.licence, LICENCE_RECORD);
  assert.equal(lib.decor_max, 16);
  assert.ok(lib.icons.total >= 1000);
  assert.deepEqual(lib.generate, { available: false, reason: 'Coming later' });
  // D1511: the reply the adapter's elementsLibrary passes on matches its contract.
  const schema = JSON.parse(readFileSync(new URL(`../src/contracts/${CONTRACTS.elementsLibrary.schema}`, import.meta.url), 'utf8'));
  assert.deepEqual(contractErrors(schema, lib), []);
  assert.deepEqual(contractErrors(schema, { ...lib, decor_max: 17 }), ['$.decor_max: must be 16']);
  for (const seg of ['shapes', 'dividers', 'textures']) for (const x of lib[seg]) assert.equal(sanitizeSvg(x.svg).ok, true, `${seg}:${x.ref}`);
  const icons = await (await get('/api/decks/elements/icons?q=rocket&limit=5')).json() as any;
  assert.ok(icons.icons.length >= 1 && icons.icons.every((i: any) => i.ref.includes('rocket') && sanitizeSvg(i.svg).ok));
  assert.deepEqual(icons.licence, { set: 'lucide', version: ICON_LICENCE.version, spdx: 'ISC' });
  assert.match(await (await get('/api/decks/elements/licence')).text(), /^ISC License/);
  assert.equal((await app.request('/api/decks/elements', {}, env)).status, 401, 'signed in only');
});
