/**
 * D1562 (#3809, deck v2 D1): the deck brand kit, Apply brand and the one-click
 * pick. The mounted routes on the real migrated schema in memory; synthetic
 * rows only. No model is bound: Apply brand must never call one.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deck_brand_kit_d1562.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import deckBrandKit from '../src/routes/deck_brand_kit.ts';
import { BRAND_FONTS, applyBrand, artDirectionOf, brandKitPick, paletteOf, sanitizeBrandKit } from '../src/services/decks/brandKit.ts';
import { themeProblems, themeTokens } from '../src/services/decks/designSystem.ts';
import { sanitizeTheme } from '../src/services/decks/slideModel.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
  .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b)).map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d1562-only-not-a-real-credential'.repeat(2);
const UID = (n: number) => `0b6a2c1e-3f4d-4a5b-8c9d-${String(n).padStart(12, '0')}`;
const TWELVE = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ title: `Card ${i + 1}`, blocks: [{ id: 't', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 2 }, style: 'heading', text: `Heading ${i + 1}` }] })));

async function fixture(o: { landing?: Record<string, string | null> | null } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  db.exec("INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (2, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 1, 'studio'), (3, 'founder', 300, 'Other founder', 'synthetic-3@example.invalid', 1, 'studio')");
  db.exec("INSERT INTO projects(id, name, founder_id) VALUES (1, 'Synthetic venture', 100), (2, 'Other synthetic venture', 300)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, theme_json) VALUES (7, 1, 3, ?, ?, 1, ?)')
    .run(TWELVE, 'Synthetic deck', JSON.stringify({ kind: 'neutral_light', background: null, chrome: { page_number: true } }));
  if (o.landing !== null) {
    const l = { palette_bg: '#ffffff', palette_ink: '#111827', palette_accent: '#7c3aed', ...(o.landing ?? {}) };
    db.prepare("INSERT INTO landing_pages (project_id, name, slug, palette_bg, palette_ink, palette_accent) VALUES (1, 'Synthetic venture', 'synthetic', ?, ?, ?)").run(l.palette_bg, l.palette_ink, l.palette_accent);
  }
  db.prepare("INSERT INTO deck_images (uid, project_id, r2_key, mime, source, use, state) VALUES (?, 1, 'deck-images/1/a.png', 'image/png', 'upload', 'content', 'kept'), (?, 1, 'deck-images/1/b.png', 'image/png', 'generated', 'content', 'proposed'), (?, 2, 'deck-images/2/c.png', 'image/png', 'upload', 'content', 'kept')")
    .run(UID(1), UID(2), UID(3));
  const AI = { run: async () => { throw new Error('Apply brand called a model'); } };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckBrandKit).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const call = async (who: number, method: string, path: string, json?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request('https://axal.vc' + path, { method, headers: { Authorization: `Bearer ${jwt}`, ...(json !== undefined ? { 'content-type': 'application/json' } : {}) }, body: json !== undefined ? JSON.stringify(json) : undefined }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const versions = () => db.prepare('SELECT id, version, theme_json, slides FROM pitch_decks WHERE project_id = 1 ORDER BY id').all() as any[];
  return { db, env, call, versions };
}

test('a 12-card deck restyles in one undo step, with zero contrast failures and no model', async () => {
  const f = await fixture();
  const put = await f.call(2, 'PUT', '/api/decks/brand-kit?project_id=1', {
    fonts: { display: 'Manrope', body: 'Inter' }, palette: { accent: '#0f766e', ground: '#fbfaf7' }, image_style: 'photo', references: [UID(1)],
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const before = f.versions();
  const r = await f.call(2, 'POST', '/api/decks/7/apply-brand');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = f.versions();
  assert.equal(after.length, before.length + 1, 'exactly one new version: one undo step');
  assert.equal(r.body.one_undo_step, true);
  const v = after.at(-1);
  const cards = (j: string) => JSON.parse(j).map((s: any) => [s.title, s.blocks]);
  assert.deepEqual(cards(v.slides), cards(before.at(-1).slides), 'the cards are the same cards');
  assert.equal(JSON.parse(v.slides).length, 12);
  const theme = JSON.parse(v.theme_json);
  assert.deepEqual([theme.kind, theme.fonts, theme.chrome.logo_corner, theme.chrome.page_number], ['brand', { display: 'Manrope', body: 'Inter' }, true, true]);
  assert.deepEqual([theme.art_direction.style, theme.art_direction.reference_uid], ['scene', UID(1)]);
  const kit = sanitizeBrandKit({ palette: { accent: '#0f766e', ground: '#fbfaf7' } });
  const { tokens } = themeTokens('brand', paletteOf({ palette_bg: '#ffffff', palette_ink: '#111827', palette_accent: '#7c3aed' }, kit));
  assert.deepEqual(themeProblems(tokens), [], 'zero contrast failures');
  assert.equal(tokens.chart[0], '#0f766e', 'the brand accent leads the chart');
  assert.equal(new Set(tokens.chart).size, 6, 'an accent equal to a base series colour does not repeat it');
});

test('a palette that would fail contrast is left out and named, never applied', () => {
  const kit = sanitizeBrandKit({ palette: { ground: '#ffffff', ink: '#f5f5f5', accent: '#fefefe' } });
  const r = applyBrand({ kind: 'neutral_light', background: null }, null, kit);
  assert.deepEqual(r.problems, []);
  assert.ok(r.adjustments.length >= 2, 'the unreadable ink and accent are named');
  assert.match(r.adjustments.join(' '), /keeps its own/);
});

test('the writer refuses a font not on the list and an image that is not a kept image of this venture', async () => {
  const f = await fixture();
  assert.equal((await f.call(2, 'PUT', '/api/decks/brand-kit?project_id=1', { fonts: { display: 'Comic Sans MS', body: 'Inter' } })).body.error, 'font_not_offered');
  for (const uid of [UID(2), UID(3)]) {
    const r = await f.call(2, 'PUT', '/api/decks/brand-kit?project_id=1', { references: [uid] });
    assert.deepEqual([r.status, r.body.error, r.body.image_uid], [422, 'image_not_kept', uid], uid === UID(2) ? 'a proposal is not kept' : 'another venture\'s image');
  }
  assert.equal((await f.call(2, 'PUT', '/api/decks/brand-kit?project_id=1', { logo_uid: UID(3) })).body.error, 'image_not_kept');
  assert.equal((await f.call(3, 'PUT', '/api/decks/brand-kit?project_id=1', { image_style: 'photo' })).status, 403, 'another venture\'s founder');
  assert.equal((await f.call(3, 'POST', '/api/decks/7/apply-brand')).status, 403);
  const ok = await f.call(2, 'PUT', '/api/decks/brand-kit?project_id=1', { palette: { ink: 'black', accent: '#0F766E' }, image_style: 'watercolour', references: [UID(1), UID(1)] });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.deck.palette, ok.body.deck.image_style, ok.body.deck.references], [{ accent: '#0f766e' }, null, [UID(1)]], 'malformed parts are dropped, not guessed');
});

test('the kit read carries the deck kit, the font list and the one-click pick', async () => {
  const f = await fixture();
  const none = await f.call(2, 'GET', '/api/decks/brand-kit?project_id=1');
  assert.equal(none.body.kit.deck, null);
  assert.deepEqual(none.body.font_options, [...BRAND_FONTS]);
  assert.equal(none.body.pick, null, 'no deck kit: the run picks as before');
  await f.call(2, 'PUT', '/api/decks/brand-kit?project_id=1', { fonts: { display: 'Lora', body: 'Inter' }, image_style: 'illustration' });
  const got = await f.call(2, 'GET', '/api/decks/brand-kit?project_id=1');
  assert.deepEqual(got.body.kit.deck.fonts, { display: 'Lora', body: 'Inter' });
  assert.equal(got.body.pick.reason, 'Brand · from your brand kit');
  assert.deepEqual([got.body.pick.theme.kind, got.body.pick.theme.fonts.display, got.body.pick.theme.art_direction.style], ['brand', 'Lora', 'flat']);
});

test('no kit at all: Apply brand says so and writes nothing', async () => {
  const f = await fixture({ landing: null });
  const before = f.versions().length;
  const r = await f.call(2, 'POST', '/api/decks/7/apply-brand');
  assert.deepEqual([r.status, r.body.error], [409, 'no_brand_kit']);
  assert.equal(f.versions().length, before);
});

test('a theme keeps a font pair only when both are on the list; the pick and the art direction', () => {
  const url = (u: any) => u;
  assert.deepEqual((sanitizeTheme({ kind: 'brand', fonts: { display: 'Manrope', body: 'Inter' } }, url) as any).fonts, { display: 'Manrope', body: 'Inter' });
  assert.equal('fonts' in (sanitizeTheme({ kind: 'brand', fonts: { display: 'Manrope', body: 'Papyrus' } }, url) as any), false);
  assert.equal(brandKitPick(null, null), null);
  assert.equal(brandKitPick(null, sanitizeBrandKit({})), null, 'an empty kit and no landing palette: nothing to apply');
  assert.deepEqual(artDirectionOf(sanitizeBrandKit({ image_style: 'screenshot', references: [UID(1)] }), 'Keep it calm.'),
    { style: 'diagram', reference_uid: UID(1), note: 'Images are clean product screenshots, as the brand kit sets.' });
  assert.equal(BRAND_FONTS.length, 12);
  assert.deepEqual(sanitizeBrandKit({ references: [UID(1), UID(2), UID(3), UID(4)] }).references, [UID(1), UID(2), UID(3)], 'at most three references');
});

test('cards that cannot be read are refused, never saved over with an empty deck', async () => {
  const f = await fixture();
  f.db.prepare("UPDATE pitch_decks SET slides = '[{not json' WHERE id = 7").run();
  const before = f.versions().length;
  const r = await f.call(2, 'POST', '/api/decks/7/apply-brand');
  assert.deepEqual([r.status, r.body.error], [503, 'unreadable']);
  assert.equal(f.versions().length, before, 'nothing written');
});

test('a theme that would still fail contrast is refused and nothing is written', async () => {
  const f = await fixture();
  // A dark ground with light ink: the surface and muted text stay the base's, and read under 4.5:1.
  assert.equal((await f.call(2, 'PUT', '/api/decks/brand-kit?project_id=1', { palette: { ground: '#111111', ink: '#f5f5f5' } })).status, 200);
  const before = f.versions().length;
  const r = await f.call(2, 'POST', '/api/decks/7/apply-brand');
  assert.deepEqual([r.status, r.body.error], [409, 'contrast']);
  assert.match(r.body.message, /under 4\.5:1/);
  assert.equal(f.versions().length, before, 'nothing written');
});
