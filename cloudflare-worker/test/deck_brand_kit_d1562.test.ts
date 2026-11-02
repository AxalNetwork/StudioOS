/**
 * D1562 (#3809, deck v2 D1) — the deck brand kit and Apply brand.
 *
 *  · migration 737 and `PUT /api/decks/brand-kit`: an OFL font pair from the
 *    fixed list only, the logo and every library image through the image
 *    guard, five palette roles, the image style, at most 3 references; the
 *    deck kit is read over the landing page's; a refusal writes nothing;
 *  · who: another venture cannot read, write or apply; a support session
 *    cannot write the kit;
 *  · the pure pick: Brand, the font pair, the logo corner and the image
 *    style, with the reason in words;
 *  · THE ISSUE'S TEST: a 12-card deck restyles in ONE answer (the editor's
 *    one op, one undo step) with zero contrast failures (`themeProblems` and
 *    every accent run), for a kind kit and for a hostile one; no model is
 *    called and nothing is written;
 *  · `themeTokens('brand', kit)` passes `themeProblems` for any kit;
 *  · the kit's image style feeds `artDirection` (dk-auto gap d).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_brand_kit_d1562.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import brandKitRoutes from '../src/routes/deck_brand_kit.ts';
import decks from '../src/routes/decks.ts';
import { BRAND_FONTS, FONT_LICENCE, fontPairOf } from '../src/services/decks/brandKitLists.ts';
import { applyBrandToDeck, brandKitPick, cardContrastProblems, kitView } from '../src/services/decks/brandKit.ts';
import { BASE_THEMES, themeProblems, themeTokens } from '../src/services/decks/designSystem.ts';
import { artDirection, imagePlan } from '../src/services/decks/visuals.ts';
import { modelProblems, sanitizeTheme } from '../src/services/decks/slideModel.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { fakeAi } from './_fake_ai.mjs';

const url = (u: string | null | undefined) => (typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(u) && !/localhost|127\./.test(u) ? u : null);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const FOUNDER = 10, OTHER = 20, P = 1, Q = 2;

/** Twelve cards: colour backgrounds, an image background, accent runs that will and will not read on the brand. */
function twelveCards() {
  return Array.from({ length: 12 }, (_, i) => ({
    uid: `0000000${i.toString(16)}-0000-4000-8000-000000000000`.slice(0, 36),
    title: `Synthetic card ${i + 1}`,
    layout: 'statement',
    ...(i % 3 === 0 ? { background: { color: '#111111', image_url: null } } : {}),
    ...(i === 4 ? { background: { color: null, image_url: 'https://images.example.com/bg.png', overlay: 'strong' } } : {}),
    blocks: [
      { id: 'h', kind: 'text', style: 'heading', grid: { c1: 1, r1: 1, c2: 12, r2: 2 }, text: `Heading ${i + 1}` },
      {
        id: 'p', kind: 'text', style: 'paragraph', grid: { c1: 1, r1: 3, c2: 12, r2: 6 }, text: 'Synthetic words with an accent',
        paras: [{ runs: [{ text: 'Synthetic words ' }, { text: 'with an accent', b: true, accent: i % 2 ? '#1d4ed8' : '#0f766e' }] }],
      },
    ],
  }));
}

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, display_name, email, is_active, founder_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', null, 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', null, 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${Q}, 'Other Co', 1002)`);
  const ins = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(2, P, 1, 'Seed v1', JSON.stringify(twelveCards()), 1);
  ins.run(3, Q, 1, 'Other deck', '[]', 1);
  return db;
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}, env: Record<string, unknown> = {}) {
  const app = new Hono<any>();
  app.route('/api/decks', brandKitRoutes);
  app.route('/api/decks', decks);
  const token = await new SignJWT({ user_id: who, role: 'founder', ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...env } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const KIT = {
  fonts: { heading: 'Fraunces', body: 'Inter' },
  logo_url: 'https://cdn.example.com/logo.png',
  palette: { ground: '#fbfaf7', ink: '#14213d', accent: '#5b21b6', secondary: '#0f766e', muted: '#4b5563' },
  image_style: 'photo',
  library: [
    { url: 'https://cdn.example.com/a.png', alt: 'Team at work', reference: true },
    { url: 'https://cdn.example.com/b.png', reference: true },
    { url: 'https://cdn.example.com/c.png' },
  ],
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('the kit: written whole, read over the landing page, with its roles, fonts, style, references, library, choices and pick', async () => {
  // Mutations checked: the deck kit's role not winning over the page's → ground reads the page's;
  // references not filtered → 3 references; `choices` dropped → the fonts list is missing.
  const db = world();
  let r = await call(db, FOUNDER, 'GET', `/api/decks/brand-kit?project_id=${P}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kit, null, 'no kit is null, never a sample');
  assert.equal(r.body.choices.fonts.length, BRAND_FONTS.length, 'the lists come with the read');
  db.exec(`INSERT INTO landing_pages (project_id, slug, name, palette_bg, palette_ink, theme_color, font_pairing) VALUES (${P}, 'live', 'Kestrel Labs', '#000000', '#ffffff', '#2bb39a', 'Outfit + Inter')`);
  r = await call(db, FOUNDER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, KIT);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const k = r.body.kit;
  assert.deepEqual(k.roles.map((x: any) => x.hex), ['#fbfaf7', '#14213d', '#5b21b6', '#0f766e', '#4b5563'], 'the deck kit\'s roles win over the page\'s');
  assert.deepEqual(k.palette, { bg: '#fbfaf7', ink: '#14213d', accent: '#5b21b6', secondary: '#0f766e' });
  assert.deepEqual(k.font_pair, { heading: { family: 'Fraunces', licence: 'OFL-1.1' }, body: { family: 'Inter', licence: 'OFL-1.1' } });
  assert.equal(k.image_style, 'photo');
  assert.equal(k.logo.light, 'https://cdn.example.com/logo.png', 'the deck kit\'s logo');
  assert.equal(k.references.length, 2);
  assert.equal(k.library.length, 3);
  assert.equal(k.name, 'Kestrel Labs', 'the page\'s name stays');
  assert.equal(k.fonts, 'Outfit + Inter', 'D898\'s font line stays the page\'s');
  assert.equal(r.body.choices.image_styles.map((s: any) => s.label).join(' · '), 'Photo · Illustration · Screenshot');
  // The read answers the same view.
  const g = await call(db, FOUNDER, 'GET', `/api/decks/brand-kit?project_id=${P}`);
  assert.deepEqual(g.body.kit, k);
  // The pick: Brand, the pair, the logo corner, the image style; and why.
  assert.equal(k.pick.theme.kind, 'brand');
  assert.deepEqual(k.pick.theme.fonts, { heading: 'Fraunces', body: 'Inter' });
  assert.equal(k.pick.theme.chrome.logo_corner, true);
  assert.equal(k.pick.theme.art_direction.style, 'scene', 'Photo draws as a scene');
  assert.equal(k.pick.reason, 'Brand, because your brand kit is recorded: Fraunces and Inter, 5 of 5 palette roles, the logo, Photo images.');
  // A second write replaces the library whole.
  r = await call(db, FOUNDER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, { ...KIT, fonts: null, library: [] });
  assert.equal(r.body.kit.library.length, 0);
  assert.equal(r.body.kit.font_pair, null);
  assert.match(r.body.kit.pick.reason, /the theme's own fonts/);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the write refuses in words and writes nothing: off-list or half fonts, an unsafe logo or image, a bad colour or style, past the caps', async () => {
  // Mutations checked: fontPairOf accepting any name → a 200; the reference cap removed → a 200;
  // the image guard skipped on the library → a 200.
  const db = world();
  const bad: Array<[unknown, number, string]> = [
    [{ ...KIT, fonts: { heading: 'Comic Sans MS', body: 'Inter' } }, 400, 'font_not_listed'],
    [{ ...KIT, fonts: { heading: 'Fraunces' } }, 400, 'font_not_listed'],
    [{ ...KIT, logo_url: 'http://cdn.example.com/logo.png' }, 422, 'unsafe_url'],
    [{ ...KIT, logo_url: 'https://localhost/logo.png' }, 422, 'unsafe_url'],
    [{ ...KIT, palette: { ground: 'red' } }, 400, 'invalid_colour'],
    [{ ...KIT, palette: { glow: '#ffffff' } }, 400, 'invalid_palette'],
    [{ ...KIT, image_style: 'watercolour' }, 400, 'invalid_image_style'],
    [{ ...KIT, library: Array.from({ length: 4 }, (_, i) => ({ url: `https://cdn.example.com/${i}.png`, reference: true })) }, 400, 'too_many_references'],
    [{ ...KIT, library: Array.from({ length: 25 }, (_, i) => ({ url: `https://cdn.example.com/${i}.png` })) }, 400, 'too_many_images'],
    [{ ...KIT, library: [{ url: 'javascript:alert(1)' }] }, 422, 'unsafe_url'],
  ];
  for (const [body, status, code] of bad) {
    const r = await call(db, FOUNDER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, body);
    assert.deepEqual([r.status, r.body?.error], [status, code], JSON.stringify(body).slice(0, 120));
    assert.equal(typeof r.body?.message, 'string');
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deck_brand_kits').get() as any).n, 0, 'nothing written');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deck_brand_kit_images').get() as any).n, 0, 'nothing written');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('who: another venture cannot read, write or apply the kit; a support session cannot write it', async () => {
  // Mutations checked: projectOwned skipped on PUT → OTHER writes P's kit; the support-session check removed → 200.
  const db = world();
  assert.equal((await call(db, OTHER, 'GET', `/api/decks/brand-kit?project_id=${P}`)).status, 403);
  assert.equal((await call(db, OTHER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, KIT)).status, 403);
  assert.equal((await call(db, OTHER, 'POST', '/api/decks/2/apply-brand', {})).status, 403);
  const support = await call(db, FOUNDER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, KIT, { impersonated_by: 1 });
  assert.deepEqual([support.status, support.body?.error], [403, 'support_session_refused']);
  assert.equal((await call(db, FOUNDER, 'PUT', '/api/decks/brand-kit', KIT)).status, 400, 'project_id required');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deck_brand_kits').get() as any).n, 0);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('THE ISSUE\'S TEST: a 12-card deck restyles in one answer, one undo step, with zero contrast failures; no model, nothing written', async () => {
  // Mutations checked: an accent kept when it does not read → cardContrastProblems is non-empty and the route
  // refuses; a colour background left in place → card 1 keeps #111111; the repair in themeTokens removed → the
  // hostile kit's themeProblems is non-empty; apply writing a version → the version count moves.
  const ai = fakeAi({ answer: () => { throw new Error('Apply brand must never call a model.'); } });
  for (const palette of [KIT.palette, { ground: '#202020', ink: '#2a2a2a', accent: '#fafafa', secondary: '#212121', muted: '#232323' }]) {
    const db = world();
    assert.equal((await call(db, FOUNDER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, { ...KIT, palette })).status, 200);
    const before = db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM pitch_decks WHERE project_id = ?').get(P) as any;
    const r = await call(db, FOUNDER, 'POST', '/api/decks/2/apply-brand', {}, {}, { AI: ai });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
    // One answer holds the whole deck: the editor applies it as one op (`setDoc`), so one undo step.
    assert.equal(r.body.cards.length, 12);
    assert.equal(r.body.theme.kind, 'brand');
    assert.deepEqual(r.body.theme.fonts, { heading: 'Fraunces', body: 'Inter' });
    assert.equal(r.body.theme.chrome.logo_corner, true);
    // Zero contrast failures, the theme's and every card's.
    assert.deepEqual(r.body.problems, []);
    assert.deepEqual(themeProblems(r.body.tokens), [], `themeProblems for ${palette.ground}`);
    assert.deepEqual(cardContrastProblems(r.body.cards, r.body.tokens), []);
    assert.deepEqual(modelProblems(r.body.cards, url), [], 'the restyled deck is a deck the save accepts');
    assert.ok(r.body.cards.every((cd: any) => !cd.background || cd.background.image_url), 'every colour background cleared; the image background stays');
    assert.equal(r.body.cards[4].background.image_url, 'https://images.example.com/bg.png');
    assert.ok(r.body.changed >= 4, 'the colour cards changed at least');
    assert.equal(ai.calls.length, 0, 'no model call');
    const after = db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM pitch_decks WHERE project_id = ?').get(P) as any;
    assert.deepEqual(after, before, 'nothing written');
  }
  // The deck as the editor holds it, sent in the body, is the one restyled.
  const db = world();
  await call(db, FOUNDER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, KIT);
  const cards = twelveCards().slice(0, 3);
  const r = await call(db, FOUNDER, 'POST', '/api/decks/2/apply-brand', { cards, theme: { kind: 'neutral_dark', background: null, aspect: '4:3', lang: 'fr' } });
  assert.equal(r.body.cards.length, 3);
  assert.equal(r.body.theme.aspect, '4:3', 'the deck\'s own settings stay');
  assert.equal(r.body.theme.lang, 'fr');
  assert.match(r.body.reason, /^Brand, because your brand kit is recorded/);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('Apply brand with no kit refuses in words; past the card cap it refuses rather than cut', async () => {
  const db = world();
  let r = await call(db, FOUNDER, 'POST', '/api/decks/2/apply-brand', {});
  assert.deepEqual([r.status, r.body?.error], [409, 'no_kit']);
  await call(db, FOUNDER, 'PUT', `/api/decks/brand-kit?project_id=${P}`, KIT);
  r = await call(db, FOUNDER, 'POST', '/api/decks/2/apply-brand', { cards: Array.from({ length: 101 }, () => ({ blocks: [] })) });
  assert.deepEqual([r.status, r.body?.error], [400, 'too_many_cards']);
  assert.equal((await call(db, FOUNDER, 'POST', '/api/decks/999/apply-brand', {})).status, 404);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('themeTokens for brand passes themeProblems for any kit (seeded random palettes)', () => {
  // Mutation checked: the final fallback to the base colours removed → a seeded kit fails.
  let seed = 1562;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  const col = () => `#${(rnd() & 0xffffff).toString(16).padStart(6, '0')}`;
  for (let i = 0; i < 400; i += 1) {
    const kit = { palette_bg: col(), palette_ink: col(), palette_accent: col(), palette_secondary: col(), palette_muted: i % 2 ? col() : null };
    const { tokens } = themeTokens('brand', kit);
    assert.deepEqual(themeProblems(tokens), [], JSON.stringify(kit));
  }
  // Mutation checked: the repair removed → a dark kit whose only fault is the theme's muted grey falls back to the base colours.
  const dark = themeTokens('brand', { palette_bg: '#1e1e1e', palette_ink: '#f5f5f5' }).tokens;
  assert.equal(dark.colours.ground, '#1e1e1e', 'the kit\'s ground is kept, its muted text repaired');
  assert.deepEqual(themeProblems(dark), []);
  // The kit's font pair replaces the families; the neutral themes ignore the kit.
  assert.deepEqual(themeTokens('brand', { font_heading: 'Fraunces', font_body: 'Lora' }).tokens.fonts.display, 'Fraunces');
  assert.equal(themeTokens('brand', { font_heading: 'Comic Sans MS', font_body: 'Lora' }).tokens.fonts.display, BASE_THEMES.brand.fonts.display, 'an off-list family is never used');
  assert.equal(themeTokens('sand', { font_heading: 'Fraunces', font_body: 'Lora' }).tokens.fonts.display, BASE_THEMES.sand.fonts.display);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the font list is Google Fonts under the OFL only, each named once; a theme keeps only a listed pair', () => {
  assert.ok(BRAND_FONTS.length >= 10);
  assert.ok(BRAND_FONTS.every((f) => f.licence === FONT_LICENCE && f.licence === 'OFL-1.1' && f.source === 'google_fonts'));
  assert.equal(new Set(BRAND_FONTS.map((f) => f.family)).size, BRAND_FONTS.length);
  assert.deepEqual(fontPairOf({ heading: 'Fraunces', body: 'Inter' }), { heading: 'Fraunces', body: 'Inter' });
  assert.equal(fontPairOf({ heading: 'Fraunces', body: 'Helvetica' }), null);
  assert.deepEqual(sanitizeTheme({ kind: 'brand', fonts: { heading: 'Fraunces', body: 'Inter' } }, url)?.fonts, { heading: 'Fraunces', body: 'Inter' });
  assert.equal(sanitizeTheme({ kind: 'brand', fonts: { heading: 'Arial', body: 'Inter' } }, url)?.fonts, undefined);
  assert.equal('fonts' in (sanitizeTheme({ kind: 'brand' }, url) as object), false, 'a theme saved without fonts hashes as it did');
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('the kit\'s image style feeds the art direction (dk-auto gap d), whatever the theme', () => {
  // Mutation checked: artDirection ignoring kit.image_style → photo draws flat.
  const photo = artDirection('neutral_light', { image_style: 'photo' });
  assert.deepEqual([photo.style, photo.from, photo.image_style], ['scene', 'brand_kit', 'photo']);
  assert.match(photo.suffix, /photographic look/);
  assert.match(photo.suffix, /No text, no numbers, no charts, no logos, no people\./, 'the refusals stay');
  assert.equal(artDirection('brand', { image_style: 'screenshot' }).style, 'line');
  assert.equal(artDirection('neutral_dark', { image_style: 'illustration' }).style, 'isometric', 'Illustration keeps the theme\'s style');
  assert.equal(artDirection('brand', null).from, 'theme');
  const plan = imagePlan([{ spec_id: 'solution', blocks: [] }], 'brand', { image_style: 'photo' }, { available: true, model: 'x', label: 'x' });
  assert.equal(plan.cards[0].style, 'scene', 'every proposed image takes the kit\'s style');
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('the pure pick and apply: same kit, same answer; cards nothing changed are the same objects', () => {
  const view = kitView(null, { heading_font: 'Sora', body_font: 'Inter', logo_url: null, palette_json: JSON.stringify({ accent: '#5b21b6' }), image_style: 'screenshot', updated_at: null }, [], url)!;
  assert.equal(view.font_pair?.heading.family, 'Sora');
  const a = brandKitPick(view, { kind: 'sand', background: { color: '#ffffff', image_url: null }, art_direction: 'Warm and calm' });
  assert.deepEqual(a, brandKitPick(view, { kind: 'sand', background: { color: '#ffffff', image_url: null }, art_direction: 'Warm and calm' }));
  assert.equal(a.theme.background, null, 'a deck background colour is cleared');
  assert.deepEqual(a.theme.art_direction, { note: 'Warm and calm', style: 'line' }, 'the note is kept, the style is the kit\'s');
  assert.equal(a.theme.chrome, undefined, 'no logo, no logo corner');
  assert.match(a.reason, /1 of 5 palette roles, no logo recorded, Screenshot images\.$/);
  const plain = { title: 'Plain', blocks: [{ id: 'h', kind: 'text', style: 'heading', grid: { c1: 1, r1: 1, c2: 12, r2: 2 }, text: 'Plain' }] };
  const r = applyBrandToDeck([plain], null, view);
  assert.equal(r.cards[0], plain);
  assert.equal(r.changed, 0);
  // Mutation checked: an accent run recoloured even when the brand accent does not read at 4.5:1 → a run keeps #0284c7.
  // #0284c7 reads 3:1 on the ground (so it is the theme's accent, for large type) but not 4.5:1 (so a run in body text drops it).
  const mid = kitView(null, { heading_font: null, body_font: null, logo_url: null, palette_json: JSON.stringify({ ground: '#fbfaf7', ink: '#000000', accent: '#0284c7' }), image_style: null, updated_at: null }, [], url)!;
  const m = applyBrandToDeck(twelveCards(), null, mid);
  assert.equal(m.tokens.colours.accent, '#0284c7');
  assert.ok(m.cards.every((cd: any) => cd.blocks.every((b: any) => (b.paras ?? []).every((pp: any) => pp.runs.every((rn: any) => rn.accent == null)))), 'the accent is left off, the words stay');
  assert.deepEqual(m.problems, []);
  // An empty palette reads "No palette recorded" in the reason.
  const bare = kitView(null, { heading_font: null, body_font: null, logo_url: null, palette_json: null, image_style: null, updated_at: null }, [], url)!;
  assert.match(bare.pick.reason, /no palette recorded/);
});
