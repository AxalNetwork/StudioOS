/**
 * #3876 (S1, 2026-11-04): the three Worker items after the owner's template
 * canvas.
 *
 *   1. TPL-01 to 12 carry the canvas's AI-native headings, support lines,
 *      metric tiles and competition rows, held to the house rules; TPL-13 to
 *      24 keep the general words. Every new tile is bound to a slot that
 *      reads Not recorded, never a value.
 *   2. A seed whose content changed is written again into a database that
 *      already holds it; an unchanged one is left alone; a user's own row is
 *      never touched, even when its uid is a seed's.
 *   3. The list's Meta carries `cover: { accent, accent_ink, display_font }`
 *      from the stored theme, or null, and nothing but a hex or a family name.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_templates_ai_native_3876.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckTemplates, { __resetSeedForTest } from '../src/routes/deck_templates.ts';
import { coverOf, templateProblems } from '../src/services/decks/templates.ts';
import { AI_COMPETITION_ROWS, AI_HEADINGS, AI_SUPPORT, AI_TILES, LIBRARY, isAiNative } from '../src/services/decks/templateLibrary.ts';
import { HQ_TEMPLATES } from '../src/services/decks/templateSeeds.ts';
import { DECK_SOURCES, readSources } from '../src/services/decks/sources.ts';
import { numberIn } from '../src/services/decks/newDeck.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'test-test-test-test-test-test-test-test';

const byN = (n: string) => LIBRARY.find((t) => t.provenance.prompt_id === `TPL-${n}`)!;
const textOf = (card: any, id: string) => card.blocks.find((b: any) => b.id === id)?.text ?? null;
const ALL_AI_TEXT = [...Object.values(AI_HEADINGS), ...Object.values(AI_SUPPORT), ...Object.values(AI_TILES).flat().map(([l]) => l), ...AI_COMPETITION_ROWS];
const strings = (t: any): string[] => JSON.stringify(t.cards).match(/\[[^\[\]"]+\]/g) ?? [];

test('1. TPL-01 to 12 are AI-native: the canvas’s headings, support lines, tiles and competition rows; TPL-13 to 24 keep the general words', () => {
  assert.deepEqual(LIBRARY.map((t) => isAiNative(t.provenance.prompt_id.slice(4))), Array.from({ length: 24 }, (_, i) => i < 12));
  // Pencil Margins (TPL-01): its why_now statement, its validation and team cards, its competition flow (a template override) kept.
  const p = byN('01');
  const card = (t: any, id: string) => t.cards.find((c: any) => c.card === id);
  assert.equal(textOf(card(p, 'why_now'), 'S'), AI_HEADINGS.why_now);
  assert.equal(textOf(card(p, 'validation'), 'H'), AI_HEADINGS.validation);
  assert.equal(textOf(card(p, 'use_of_funds'), 'H'), AI_HEADINGS.use_of_funds);
  // A template's own override still wins: Field Letter (TPL-02) names its competition card itself.
  // Mutation checked: let the AI words win over a template's override → this heading becomes AI_HEADINGS.competition.
  assert.equal(textOf(card(byN('02'), 'competition'), 'H'), '[Alternatives the partner could choose]');
  // A support line lands in the card's paragraph area: use_of_funds·two_columns's R.
  assert.equal(textOf(card(p, 'use_of_funds'), 'R'), AI_SUPPORT.use_of_funds);
  // Tiles, bound to their slots: Field Letter's validation tiles (TPL-02).
  const tiles = card(byN('02'), 'validation').blocks.filter((b: any) => b.kind === 'metric').map((b: any) => [b.label, b.binding.source_key, b.value ?? null]);
  assert.deepEqual(tiles.slice(0, 3), AI_TILES.validation.map(([l, k]) => [l, k, null]));
  // The competition table's rows (TPL-03 Lantern Ridge).
  const comp = card(byN('03'), 'competition').blocks.find((b: any) => b.kind === 'chart');
  assert.deepEqual(comp.series.map((s: any) => [s.label, s.binding.source_key]), AI_COMPETITION_ROWS.map((r) => [r, 'validate.competitors']));
  // Mutation checked: apply to every template → the general decks carry AI words.
  for (const t of LIBRARY.slice(12)) {
    const words = strings(t);
    for (const ai of ALL_AI_TEXT) assert.ok(!words.includes(ai) || ['[MRR]', '[Paying customers]', '[Interviews]', '[The round]', '[Ownership after the round]', '[Who buys, and how many there are]'].includes(ai), `${t.name}: ${ai}`);
  }
  // Every AI-native template uses the AI words somewhere in each of the four groups.
  for (const t of LIBRARY.slice(0, 12)) assert.ok(strings(t).some((w) => Object.values(AI_HEADINGS).includes(w)), t.name);
});

test('1. the AI words keep the house rules: numberIn finds nothing, at most 40 characters inside the brackets; every template still passes its contract', () => {
  // Mutation checked: the canvas's own wording ("[The next 18 months, on the models we have]") → numberIn and the length both fail.
  for (const w of ALL_AI_TEXT) {
    assert.equal(numberIn(w), null, w);
    assert.match(w, /^\[[A-Z][^\[\]]{0,39}\]$/, w);
  }
  for (const t of HQ_TEMPLATES as any[]) assert.deepEqual(templateProblems(t), [], t.name);
});

test('1. every new tile is bound to a slot that reads Not recorded, never a value', async () => {
  const slots = new Map(DECK_SOURCES.flatMap((a) => a.slots.map((s) => [s.key, s] as const)));
  for (const [label, key] of Object.values(AI_TILES).flat()) assert.ok(slots.has(key), `${label} → ${key} has no slot`);
  for (const t of LIBRARY) for (const c of t.cards) for (const b of c.blocks) {
    if (b.kind === 'metric') { assert.equal(b.value ?? null, null, `${t.name}: ${b.label}`); assert.ok(slots.has(b.binding.source_key), `${t.name}: ${b.binding.source_key}`); }
  }
  // Read against an empty database: the AI-native slots are listed and not recorded.
  const db = new DatabaseSync(':memory:');
  const env: any = { DB: d1Over(db) };
  const { items } = await readSources({ env, projectId: 1, today: '2026-11-04', mercury: { withheld: true } } as any, { only: ['ai_native'] });
  assert.deepEqual(items.map((i) => [i.source_key, i.state, i.value]), [
    'validate.pilots', 'validate.tasks_without_correction', 'grow.active_accounts', 'grow.runs_per_week', 'grow.accepted_without_edits',
    'grow.cac', 'grow.ltv', 'grow.compute_per_customer', 'grow.gross_margin', 'grow.gross_margin_after_compute',
  ].map((k) => [k, 'not_recorded', null]));
  db.close();
});

async function world() {
  __resetSeedForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  db.prepare("INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (2, 'founder', 100, 'Synthetic founder', 'f@example.invalid', 1, 'studio')").run();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', deckTemplates);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const get = async (path: string) => {
    const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const r = await app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    return { status: r.status, body: await r.json() as any };
  };
  return { db, env, get };
}

test('2. a changed seed is written again; an unchanged one is left alone; a user’s own row is never touched', async () => {
  const w = await world();
  const [first, second] = HQ_TEMPLATES as any[];
  // An older copy of the first seed, and a user's template that shares the second seed's uid.
  const stale = { ...first, description: 'An older description.' };
  w.db.prepare(`INSERT INTO deck_templates (uid, scope, owner_id, name, description, stage, audience_tags, deck_audience, style, swatch, card_count, structure_json, theme_json, provenance_json)
    VALUES (?, 'hq', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(first.uid, first.name, stale.description, first.stage, JSON.stringify(first.audience_tags), first.deck_audience,
    first.style, first.swatch, first.card_count, JSON.stringify(stale), JSON.stringify(first.theme), JSON.stringify(first.provenance));
  w.db.prepare(`INSERT INTO deck_templates (uid, scope, owner_id, name, card_count, structure_json, provenance_json) VALUES (?, 'user', 2, 'Mine', 3, '{"mine":true}', '{}')`).run(second.uid);
  const r = await w.get('/api/decks/templates');
  assert.equal(r.status, 200);
  const row = (uid: string) => w.db.prepare('SELECT scope, owner_id, description, structure_json FROM deck_templates WHERE uid = ?').get(uid) as any;
  // Mutation checked: keep INSERT OR IGNORE → the stale copy stays.
  assert.equal(row(first.uid).description, first.description);
  assert.equal(row(first.uid).structure_json, JSON.stringify(first));
  // Mutation checked: drop the scope guard → the user's row becomes HQ's.
  assert.deepEqual([row(second.uid).scope, row(second.uid).owner_id, row(second.uid).structure_json], ['user', 2, '{"mine":true}']);
  // An unchanged seed is not rewritten: a third read changes nothing (the seed flag reset makes it run again).
  const third = (HQ_TEMPLATES as any[])[2];
  const before = w.db.prepare('SELECT id, created_at FROM deck_templates WHERE uid = ?').get(third.uid) as any;
  __resetSeedForTest();
  w.db.exec("CREATE TRIGGER no_rewrite BEFORE UPDATE ON deck_templates WHEN OLD.structure_json = NEW.structure_json BEGIN SELECT RAISE(ABORT, 'unchanged seed rewritten'); END;");
  assert.equal((await w.get('/api/decks/templates')).status, 200);
  assert.deepEqual(w.db.prepare('SELECT id, created_at FROM deck_templates WHERE uid = ?').get(third.uid), before);
  w.db.close();
});

test('3. the list’s Meta carries the cover from the stored theme, or null; only a hex or a family name gets through', async () => {
  const w = await world();
  const list = (await w.get('/api/decks/templates')).body.templates;
  const pencil = list.find((t: any) => t.name === 'Pencil Margins');
  // Mutation checked: drop `cover` from metaRow → it is undefined.
  assert.deepEqual(pencil.cover, { accent: '#B5452A', accent_ink: '#FFFFFF', display_font: 'Fraunces' });
  for (const t of list) assert.match(t.cover.accent, /^#[0-9A-F]{6}$/i, t.name);
  // A user's template saved without a theme answers null on Yours.
  w.db.prepare(`INSERT INTO deck_templates (uid, scope, owner_id, name, card_count, structure_json, provenance_json) VALUES ('tpl_user_mine', 'user', 2, 'Mine', 3, '{}', '{}')`).run();
  assert.equal((await w.get('/api/decks/templates/mine')).body.templates[0].cover, null);
  // Mutation checked: skip the checks → a style injection or a non-hex reaches the Gallery.
  assert.deepEqual(coverOf({ colours: { accent: 'red;background:url(x)', accent_ink: '#fff' }, fonts: { display: 'Fraunces;}' } }), null);
  assert.deepEqual(coverOf({ colours: { accent: '#2747C8' } }), { accent: '#2747C8', accent_ink: null, display_font: null });
  w.db.close();
});
