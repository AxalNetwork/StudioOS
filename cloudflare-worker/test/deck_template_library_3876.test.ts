/**
 * #3876 — HQ's 24 Gallery templates (`services/decks/templateLibrary.ts`),
 * held to the issue's seed-data tests and to the one-click bar:
 *
 *  · contract: every template passes `templateProblems`; 24 of them, unique
 *    uids and names, no name from the quality bar or a well-known fund;
 *  · no figures: `numberIn` finds nothing in any user-visible string, and
 *    every placeholder is at most 40 characters with no nesting;
 *  · cards: 10 to 14, in H7 order (BASE, the audience's lead cards after
 *    title), with each stage's narrative (no traction at pre-seed; traction at
 *    seed; traction and unit economics at Series A and B+);
 *  · ids: catalogue cards, layouts in `ROLE_LAYOUTS`, chart types in
 *    `CHART_TYPES`, every binding a slot `sources.ts` knows;
 *  · theme: `themeProblems` is [], muted reads on surface; each swatch three
 *    times, each style eight, each stage six; fonts under OFL-1.1 or
 *    Apache-2.0 with a 700 weight for display, fallbacks always set;
 *  · fit and the rubric: `fitProblems` is [] and `deckRubric` scores at least
 *    80 once applied (the one-click bar), and the slide model keeps every
 *    authored block and decor item;
 *  · values and models: no metric value, no chart points, no image URL, no
 *    model id; records and founder areas call no model; each other area names
 *    its AIRail group;
 *  · coverage: every stage × each of New deck's seven audiences returns a
 *    template, so the one-click pick never comes back empty.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_template_library_3876.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASE_ORDER, FALLBACK_FONTS, FONT_LICENCES, LAYOUT_AREAS, LIBRARY, SPECS, compose, orderFor } from '../src/services/decks/templateLibrary.ts';
import { HQ_TEMPLATES } from '../src/services/decks/templateSeeds.ts';
import { STAGES, metaOf, pickTemplate, templateProblems, toSlides, visibleStrings } from '../src/services/decks/templates.ts';
import { CARD_IDS, numberIn } from '../src/services/decks/newDeck.ts';
import { AUDIENCES, CHART_TYPES, LAYOUT_IDS } from '../src/services/decks/slideModel.ts';
import { ROLE_LAYOUTS, contrast, fitProblems, themeProblems } from '../src/services/decks/designSystem.ts';
import { deckRubric } from '../src/services/decks/rubric.ts';
import { isIcon } from '../src/services/decks/elements.ts';
import { sanitizeSlides } from '../src/routes/decks.ts';

const ALL = LIBRARY as any[];
const SLOT_KEYS = new Set([...readFileSync(new URL('../src/services/decks/sources.ts', import.meta.url), 'utf8').matchAll(/key: '([a-z]+\.[a-z0-9_]+)'/g)].map((m) => m[1]));
const applied = (t: any) => sanitizeSlides(toSlides(t));

test('the seed is the library: 24 templates, each passing templateProblems', () => {
  // Mutation checked: a digit in one description → templateProblems names it; an empty seed → 24 fails.
  assert.equal(HQ_TEMPLATES, LIBRARY);
  assert.equal(ALL.length, 24);
  for (const t of ALL) assert.deepEqual(templateProblems(t), [], t.name);
  assert.equal(new Set(ALL.map((t) => t.uid)).size, 24);
  assert.equal(new Set(ALL.map((t) => t.name)).size, 24);
  assert.deepEqual(ALL.map((t) => t.provenance.prompt_id), Array.from({ length: 24 }, (_, i) => `TPL-${String(i + 1).padStart(2, '0')}`));
  for (const t of ALL) assert.ok(t.name.length <= 40 && /^tpl_hq_[a-z_]+$/.test(t.uid));
});

test('names: none is a quality-bar product, its template names, or a well-known fund', () => {
  const DENY = /\b(gamma|canva|pitch\.com|genspark|dokie|beautiful|slidebean|sequoia|a16z|andreessen|accel|benchmark|index ventures|y combinator|techstars|greylock|kleiner|lightspeed|founders fund|tiger)\b/i;
  for (const t of ALL) assert.doesNotMatch(t.name, DENY, t.name);
});

test('no figures: numberIn finds nothing in any user-visible string; placeholders are at most 40 characters, never nested', () => {
  // Mutation checked: "[Q3 2026 target]" in a card message → the scan names it.
  for (const t of ALL) {
    const strings = visibleStrings(t);
    assert.ok(strings.length > 50, `${t.name}: its strings are read`);
    for (const s of strings) {
      assert.equal(numberIn(s), null, `${t.name}: ${s}`);
      for (const m of s.matchAll(/\[[^\]]*\]?/g)) assert.match(m[0], /^\[[A-Z][^\[\]]{0,39}\]$/, `${t.name}: ${m[0]}`);
    }
    for (const c of t.cards) for (const a of c.areas) if (a.art) assert.equal(numberIn(a.art.prompt), null);
  }
  const broken = compose({ ...SPECS[0], description: 'A deck for Q3 2026' } as any);
  assert.ok(templateProblems(broken).some((p) => /holds a figure/.test(p)), 'the guard is live');
});

test('cards: 10 to 14, in H7 order, with each stage’s narrative; pending cards are kept aside and not counted', () => {
  // Mutation checked: lead cards for seed_fund moved after solution → TPL-07's order fails.
  for (const t of ALL) {
    const ids = t.cards.map((c: any) => c.card);
    assert.ok(ids.length >= 10 && ids.length <= 14, `${t.name}: ${ids.length} cards`);
    assert.equal(t.card_count, ids.length);
    assert.deepEqual(ids, orderFor(ids, t.deck_audience), `${t.name}: H7 order`);
    assert.equal(ids[0], 'title');
    if (t.stage === 'pre_seed') assert.ok(!ids.includes('traction'), `${t.name}: no traction at pre-seed`);
    if (t.stage === 'seed') assert.ok(ids.includes('traction'), `${t.name}: traction at seed`);
    if (t.stage === 'series_a' || t.stage === 'series_b_plus') assert.ok(ids.includes('traction') && ids.includes('unit_economics'), `${t.name}: traction and unit economics`);
    assert.ok(t.pending_cards.length >= 1 && t.pending_cards.every((p: any) => ['closing', 'business_model', 'gtm'].includes(p.card)));
    assert.equal(t.length, ids.every((c: string) => ['title', 'problem', 'why_now', 'solution', 'traction', 'validation', 'product', 'market', 'unit_economics', 'team', 'round', 'use_of_funds'].includes(c)) ? 'standard' : 'full');
  }
  assert.equal(new Set(BASE_ORDER).size, BASE_ORDER.length);
});

test('ids and shapes: catalogue cards, allowed layouts, drawable charts, known slots; no values, points, URLs or models', () => {
  // Mutation checked: a metric value of "[ARR]" → named; a binding to grow.made_up → named.
  for (const t of ALL) {
    assert.doesNotMatch(JSON.stringify(t), /@cf\/|gpt-|claude|llama|mistral|gemini/i, `${t.name}: no model named`);
    for (const c of t.cards) {
      const at = `${t.name} · ${c.card}`;
      assert.ok(CARD_IDS.includes(c.card), at);
      assert.ok(LAYOUT_IDS.includes(c.layout) && (ROLE_LAYOUTS[c.card] as string[]).includes(c.layout), `${at}: ${c.layout}`);
      assert.ok(c.blocks.length <= 24 && c.areas.length <= 12, at);
      assert.deepEqual(c.blocks.map((b: any) => b.grid), LAYOUT_AREAS[c.layout].map((a) => a.grid), `${at}: blocks on the preset ranges`);
      assert.ok(c.title.length <= 80 && c.purpose.length <= 200 && c.message.length <= 140 && c.notes.length <= 240, at);
      for (const b of c.blocks) {
        assert.ok(!['video', 'audio', 'link'].includes(b.kind), at);
        if (b.kind === 'metric') assert.equal(b.value, null, at);
        if (b.kind === 'chart') {
          assert.ok((CHART_TYPES as readonly string[]).includes(b.chart_type), `${at}: ${b.chart_type}`);
          for (const s of b.series) { assert.equal(s.points, undefined, at); assert.ok(SLOT_KEYS.has(s.binding.source_key), `${at}: ${s.binding.source_key}`); }
        }
        if (b.kind === 'image') assert.equal(b.image_url, null, at);
        if (b.binding) assert.ok(SLOT_KEYS.has(b.binding.source_key), `${at}: ${b.binding.source_key}`);
        if (b.kind === 'graphic') {
          const n = b.diagram.items.length;
          assert.ok(n >= 2 && n <= 8 && b.diagram.type !== 'matrix', `${at}: diagram`);
        }
      }
    }
  }
});

test('areas: records and founder areas call no model; every other area names its AIRail group; art only where a prompt is', () => {
  for (const t of ALL) {
    const spec = SPECS.find((s) => s.name === t.name)!;
    for (const c of t.cards) {
      for (const a of c.areas) {
        assert.ok(['text', 'chart', 'image', 'records', 'founder'].includes(a.generation_kind), `${t.name}: ${a.generation_kind}`);
        assert.ok(['text', 'data', 'images', 'venture', 'diagrams'].includes(a.rail_group), `${t.name}: ${a.rail_group}`);
        if (a.generation_kind === 'records' || a.generation_kind === 'founder') assert.equal(a.rail_group, 'venture', `${t.name}: no model for ${a.id}`);
        if (a.art) {
          assert.equal(spec.image?.card, c.card, `${t.name}: art on its prompt's card`);
          assert.equal(a.art.style, t.art_direction.style);
          assert.match(a.art.prompt, /no text, no people, no logos$/);
        }
      }
    }
    const metrics = t.cards.flatMap((c: any) => c.areas.filter((a: any) => a.element === 'metric'));
    assert.ok(metrics.every((a: any) => a.generation_kind === 'records'), `${t.name}: a figure is bound by code`);
  }
});

test('theme: legible on every pair, muted on surface too; each swatch three times, each style eight, each stage six', () => {
  // Mutation checked: TPL-10's lime accent swapped for #555555 on near-black → accent on ground fails.
  const count = (k: string) => ALL.reduce((m, t) => m.set(t[k], (m.get(t[k]) ?? 0) + 1), new Map());
  for (const t of ALL) {
    assert.deepEqual(themeProblems(t.theme), [], t.name);
    assert.ok(contrast(t.theme.colours.muted, t.theme.colours.surface) >= 4.5, `${t.name}: muted on surface`);
    assert.ok(['neutral_light', 'neutral_dark'].includes(t.theme.kind));
  }
  assert.deepEqual([...count('swatch').values()], Array(8).fill(3));
  assert.deepEqual([...count('style').values()], [8, 8, 8]);
  assert.deepEqual([...count('stage').values()], [6, 6, 6, 6]);
});

test('fonts: every family under OFL-1.1 or Apache-2.0, recorded in provenance; display faces ship 700; fallbacks always set', () => {
  for (const t of ALL) {
    assert.deepEqual(t.theme.fallback_fonts, FALLBACK_FONTS);
    for (const f of Object.values(t.theme.fonts) as string[]) {
      assert.ok(FONT_LICENCES[f], `${t.name}: ${f} is recorded`);
      assert.ok(['OFL-1.1', 'Apache-2.0'].includes(t.provenance.fonts[f]), `${t.name}: ${f}`);
    }
    assert.ok(FONT_LICENCES[t.theme.fonts.display].bold700, `${t.name}: display at 700`);
    assert.equal(t.provenance.origin, 'original');
    assert.equal(t.provenance.reviewed_by, null, 'reviewed by a designer or the owner later');
  }
});

test('the one-click bar: fitProblems is [], the rubric scores at least 80, and the slide model keeps every block and decor item', () => {
  // Mutation checked: a four-step integration flow in a six-column area → fitProblems names too_many_items and the score drops.
  for (const t of ALL) {
    const slides = applied(t);
    assert.deepEqual(fitProblems(slides), [], t.name);
    const r = deckRubric(slides);
    assert.ok(r.score >= 80, `${t.name}: ${r.score} ${JSON.stringify(r.checks)}`);
    assert.ok(r.checks.every((c) => c.id === 'gaps'), `${t.name}: only figures not yet recorded cost anything`);
    slides.forEach((s: any, i: number) => {
      const c = t.cards[i];
      assert.deepEqual(s.blocks.map((b: any) => [b.id, b.kind, b.grid, b.text ?? b.label ?? null, b.binding?.source_key ?? null]),
        c.blocks.map((b: any) => [b.id, b.kind, b.grid, b.text ?? b.label ?? null, b.binding?.source_key ?? null]), `${t.name} · ${c.card}: every block kept`);
      assert.equal((s.decor ?? []).length, (c.decor ?? []).length, `${t.name} · ${c.card}: every decor item kept`);
      assert.equal(s.layout, c.layout);
    });
  }
});

test('decor: at most 16 per card, never text; icons, shapes and textures in free cells; dividers on a heading or a gutter', () => {
  for (const t of ALL) {
    for (const c of t.cards) {
      const decor = c.decor ?? [];
      assert.ok(decor.length <= 16);
      for (const d of decor) {
        assert.ok(['icon', 'shape', 'divider', 'texture'].includes(d.kind) && !('text' in d), `${t.name}: ${d.kind}`);
        if (d.kind === 'icon') assert.ok(isIcon(d.ref), `${t.name}: icon ${d.ref}`);
        const covered = c.blocks.some((b: any) => !(d.grid.c2 < b.grid.c1 || d.grid.c1 > b.grid.c2 || d.grid.r2 < b.grid.r1 || d.grid.r1 > b.grid.r2));
        if (d.kind === 'divider') {
          const onHeading = c.blocks.some((b: any) => b.style === 'heading' && JSON.stringify(b.grid) === JSON.stringify(d.grid));
          assert.ok(onHeading || (d.grid.c1 === 7 && d.grid.c2 === 7), `${t.name} · ${c.card}: a divider sits on a heading or the gutter`);
        } else {
          assert.equal(covered, false, `${t.name} · ${c.card}: ${d.kind} ${d.ref} covers a block`);
        }
      }
    }
  }
});

test('coverage: every stage × each of the seven audiences returns a template; the pick finds both, every time', () => {
  // Mutation checked: TPL-02's grant tag removed (and 06's) → pre-seed × grant comes back empty.
  const metas = ALL.map(metaOf);
  for (const stage of STAGES) {
    for (const audience of AUDIENCES) {
      const hits = metas.filter((m) => m.stage === stage && m.audience_tags.includes(audience));
      assert.ok(hits.length >= 1, `${stage} × ${audience}`);
      const pick = pickTemplate(metas, { stage, audience, sector: 'climate' });
      assert.match(pick.reason, /its stage and audience/, `${stage} × ${audience}`);
      assert.deepEqual(pickTemplate(metas, { stage, audience, sector: 'climate' }), pick, 'deterministic');
    }
    for (const style of ['editorial', 'bold', 'minimal']) assert.equal(metas.filter((m) => m.stage === stage && m.style === style).length, 2, `${stage} × ${style}`);
  }
  for (const t of ALL) assert.ok(t.audience_tags.every((a: string) => (AUDIENCES as readonly string[]).includes(a)) && t.audience_tags.includes(t.deck_audience));
});

test('distinctness: the two templates of a stage × style differ in swatch and display face', () => {
  for (const stage of STAGES) for (const style of ['editorial', 'bold', 'minimal']) {
    const [a, b] = ALL.filter((t) => t.stage === stage && t.style === style);
    assert.notEqual(a.swatch, b.swatch, `${stage} × ${style}`);
    assert.notEqual(a.theme.fonts.display === b.theme.fonts.display && a.theme.colours.accent === b.theme.colours.accent, true);
  }
});
