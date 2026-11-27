/**
 * D4574 H3 (#4574) — the deck icon set's nodes are a static asset, not part of
 * the Worker script.
 *
 * What this pins: the split is faithful (the names file carries no nodes and
 * no licence text, and the asset carries exactly the set `elements.ts` names);
 * drawing needs the loaded geometry and answers null without it; the loader
 * refuses what a missing or wrong asset really returns; and every caller says
 * the set could not be read instead of showing an empty one.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_icon_assets_4574.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckElements from '../src/routes/deck_elements.ts';
import {
  ICON_ASSET, ICON_SET_VERSION, LICENCE_RECORD, decorSvg, iconCount, iconSvg, isIcon, licenceText, searchIcons,
} from '../src/services/decks/elements.ts';
import { loadIconGeometry } from '../src/services/decks/iconGeometry.ts';
import { writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { assetsForIcons, iconAssetText, iconGeometryFromDisk } from './_icon_geometry.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const namesFile = JSON.parse(readFileSync(new URL('../src/services/decks/iconNames.json', import.meta.url), 'utf8'));
const assetBody = JSON.parse(iconAssetText());

test('the split is faithful: names in the script, nodes in the asset, nothing duplicated', () => {
  // Mutation checked: the generator writing `icons` into the names file, or
  // `licence_text` alongside it, fails the first two asserts — which is the
  // whole point of the change, since those were the 395.5 KiB.
  const text = readFileSync(new URL('../src/services/decks/iconNames.json', import.meta.url), 'utf8');
  assert.equal(text.includes('licence_text'), false, 'the licence text is not in the Worker script');
  assert.equal('icons' in namesFile, false, 'no node data in the Worker script');
  assert.ok(text.length < 64 * 1024, `the names file is ${text.length} bytes`);
  assert.equal(namesFile.asset, ICON_ASSET);
  assert.equal(namesFile.set.version, ICON_SET_VERSION);
  assert.deepEqual(namesFile.set, { ...LICENCE_RECORD, viewBox: '0 0 24 24', stroke: 'currentColor', fill: 'none', stroke_width: 2 });

  // The asset holds the same set, and only that set.
  assert.equal(assetBody.version, ICON_SET_VERSION);
  assert.match(assetBody.licence_text, /^ISC License/);
  assert.deepEqual(Object.keys(assetBody.icons), namesFile.names, 'the asset draws exactly the names the script knows');
  assert.equal(iconCount(), namesFile.names.length);
  assert.ok(iconCount() >= 1000, `${iconCount()} icons`);
  assert.equal(isIcon('house'), true);
  assert.equal(isIcon('not-an-icon'), false);
});

test('drawing takes the geometry; without it an icon draws nothing and nothing else changes', () => {
  // Mutation checked: `iconSvg` falling back to a bundled table → the two null
  // asserts fail; `decorSvg` passing no geometry through → the icon assert fails.
  const geo = iconGeometryFromDisk();
  assert.match(iconSvg(geo, 'house')!, /^<svg /);
  assert.equal(iconSvg(null, 'house'), null);
  assert.equal(iconSvg(geo, 'not-an-icon'), null);
  assert.equal(decorSvg({ kind: 'icon', ref: 'house' }), null, 'no geometry, no icon');
  assert.match(decorSvg({ kind: 'icon', ref: 'house' }, geo)!, /^<svg /);
  // A shape, a divider and a texture are drawn from parameters, so they need nothing.
  for (const kind of ['shape', 'divider', 'texture'] as const) {
    const ref = kind === 'shape' ? 'circle' : kind === 'divider' ? 'line' : 'dots';
    assert.match(decorSvg({ kind, ref })!, /^<svg /, `${kind} draws without the geometry`);
  }
  assert.equal(licenceText(null), null);
  assert.match(licenceText(geo)!, /^ISC License/);
  assert.equal(searchIcons('rocket', 0, 5).names.every((n) => n.includes('rocket')), true);
});

test('the loader: the asset once per isolate, and nothing else accepted', async () => {
  // Mutation checked: dropping the version check, the content-type check or the
  // node-element check each lets one of these through; remembering a failed
  // read fails the retry assert.
  const env: any = { DB: {}, ASSETS: assetsForIcons() };
  const first = await loadIconGeometry(env);
  assert.ok(first && Object.keys(first.nodes).length === namesFile.names.length);
  let calls = 0;
  env.ASSETS = { fetch: async (u: string) => { calls += 1; return assetsForIcons().fetch(u); } };
  assert.equal(await loadIconGeometry(env), first, 'remembered for this isolate');

  // The SPA shell is what a missing static file really answers.
  const shell: any = { DB: {}, ASSETS: assetsForIcons({ fail: true }) };
  assert.equal(await loadIconGeometry(shell), null);
  // A failed read is not remembered: the next request tries again.
  shell.ASSETS = assetsForIcons();
  assert.ok(await loadIconGeometry(shell), 'retried after a failed read');

  const bodyEnv = (body: unknown) => ({
    DB: {},
    ASSETS: { fetch: async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) },
  }) as any;
  assert.equal(await loadIconGeometry(bodyEnv({ ...assetBody, version: '0.0.0' })), null, 'another version is refused');
  assert.equal(await loadIconGeometry(bodyEnv({ version: ICON_SET_VERSION, licence_text: '', icons: {} })), null, 'no licence text is refused');
  assert.equal(
    await loadIconGeometry(bodyEnv({ version: ICON_SET_VERSION, licence_text: 'ISC', icons: { bad: [['script', {}]] } })),
    null,
    'an element the set may not draw is refused',
  );
  assert.equal(await loadIconGeometry({ DB: {} } as any), null, 'no assets binding, no geometry');
  assert.ok(calls >= 0);
});

test('the routes say the set could not be read, rather than showing an empty one', async () => {
  // Mutation checked: answering `icons: []` without `unreadable` → the shape
  // assert fails; caching the unreadable page → the Cache-Control assert fails;
  // the licence route answering empty text with 200 → the 503 assert fails.
  const secret = 'synthetic-4574-only-not-a-real-credential'.repeat(2);
  const app = new Hono<any>().route('/api/decks', deckElements);
  const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const get = (p: string, env: any) => app.request(p, { headers: { Authorization: `Bearer ${jwt}` } }, env);
  // One env per case, each with its OWN DB binding: the loader remembers the
  // geometry per isolate and keys that memory on the DB, so sharing one here
  // would let a readable case answer for an unreadable one.
  const envOf = (assets: unknown) => {
    const { DB } = makeD1(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);',
      "INSERT INTO users VALUES (2, 'm@example.invalid', 'Member', 'founder', 1);",
    );
    return { DB, JWT_SECRET: secret, ENVIRONMENT: 'development', ASSETS: assets } as any;
  };

  const ok = await get('/api/decks/elements/icons?q=rocket&limit=5', envOf(assetsForIcons()));
  const read = await ok.json() as any;
  assert.ok(read.icons.length >= 1 && read.icons.every((i: any) => String(i.svg).startsWith('<svg ')));
  assert.equal('unreadable' in read, false);
  assert.match(String(ok.headers.get('Cache-Control')), /max-age=3600/);

  const bad = await get('/api/decks/elements/icons?q=rocket&limit=5', envOf(assetsForIcons({ fail: true })));
  const unread = await bad.json() as any;
  assert.equal(bad.status, 200);
  assert.deepEqual(unread.icons, []);
  assert.equal(unread.unreadable, true);
  assert.equal(unread.reason, 'The icon set could not be read.');
  assert.ok(unread.total >= 1, 'the names are still counted: it is the nodes that are missing');
  assert.equal(bad.headers.get('Cache-Control'), null, 'an unreadable page is not cached');

  // The library index needs no geometry at all, so it answers as it always did.
  const lib = await (await get('/api/decks/elements', envOf(assetsForIcons({ fail: true })))).json() as any;
  assert.deepEqual(lib.licence, LICENCE_RECORD);
  assert.ok(lib.icons.total >= 1000);
  for (const seg of ['shapes', 'dividers', 'textures']) assert.ok(lib[seg].every((x: any) => String(x.svg).startsWith('<svg ')));

  assert.match(await (await get('/api/decks/elements/licence', envOf(assetsForIcons()))).text(), /^ISC License/);
  const refused = await get('/api/decks/elements/licence', envOf(assetsForIcons({ fail: true })));
  assert.equal(refused.status, 503);
  assert.deepEqual(await refused.json(), { detail: 'The icon set could not be read.' });
});

test('the PowerPoint writer counts an icon it could not draw, instead of dropping it', async () => {
  // Mutation checked: `continue` without the count → the not_drawn asserts fail;
  // passing the geometry when it is null → the first report would read svg: 1.
  const card = {
    blocks: [{ id: 'b1', kind: 'heading', text: 'Synthetic', grid: { c1: 1, c2: 12, r1: 1, r2: 2 } }],
    decor: [{ id: 'd1', kind: 'icon', ref: 'rocket', tone: 'accent', at: { x: 1600, y: 96, w: 160, h: 160 } }],
  };
  const input: any = { slides: [card], renderable: [{ title: 'Synthetic', fields: [] }], brand: { show_footer: false, footer_text: '' }, notes: false, images: new Map() };
  const without = await writeEditableDeck(input);
  assert.equal(without.decor.svg, 0, 'nothing drawn without the geometry');
  assert.equal(without.decor.not_drawn, 1, 'and it is counted, not silently dropped');

  const with_ = await writeEditableDeck({ ...input, icons: iconGeometryFromDisk() });
  assert.equal(with_.decor.svg, 1, 'drawn with the geometry');
  assert.equal(with_.decor.not_drawn, 0);
});
