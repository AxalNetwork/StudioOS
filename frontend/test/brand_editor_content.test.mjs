/**
 * Guards the shared content model that ties the editors, the previews and the
 * published page together.
 *
 * The failure this suite prevents: the inline editor on /spinout-lab/brand used
 * to expose four generic copy blocks and preview them on a generic artboard,
 * while each template's real sections lived only in TEMPLATE_CONTENT_SCHEMA and
 * were rendered only by the worker. Editing a page therefore showed the founder
 * something the published page would never look like.
 *
 * So this asserts, for every catalog template:
 *   1. templateContent() has the SAME fallback semantics as the worker's
 *      landingContent() — saved value wins, blank falls back to the schema
 *      default, an all-blank list falls back to the default list, lists clamp
 *      to `max`, percents clamp to 0-100.
 *   2. contentForTemplate() rehydrates an editor block without ever letting a
 *      default overwrite something the founder saved.
 *   3. Every editable field in the schema actually reaches the preview: inject a
 *      unique sentinel into each one and it must appear in the rendered HTML.
 *   4. The previews read that content instead of hard-coding it: with sentinels
 *      supplied, the schema's own default copy must be GONE from the render.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/brand_editor_content.test.mjs
 * MUST stay in the test:drift file list via the frontend glob.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PREVIEW_REGISTRY } from '../src/components/brand/templates/templateRegistry.js';
import { TEMPLATE_CONTENT_SCHEMA, TEMPLATES } from '../src/lib/brand/templates.js';
import {
  templateContent, contentForTemplate, defaultsForTemplate, contentFieldsFor,
  blankItem, parseContentJson, pct,
} from '../src/lib/brand/templateContent.js';

const CATALOG_KEYS = [...new Set(TEMPLATES.map((t) => t.visualTemplate))];

/** Item fields the designs render as geometry or a flag rather than as text —
 *  a bar width, a highlight toggle, a status tone. Their VALUE never appears in
 *  the markup, so the sentinel sweep skips them (they're still editable). */
const NON_TEXTUAL_ITEM_FIELDS = new Set(['pct', 'on', 'tone']);

const sentinelFor = (tkey, field, itemField) => `ZQ${tkey.replace(/-/g, '')}${field}${itemField || ''}X`;

/** A content block where every editable field carries a unique sentinel. */
function sentinelContent(tkey) {
  const out = {};
  for (const f of contentFieldsFor(tkey)) {
    if (f.kind === 'groupList') {
      const item = {};
      for (const itf of f.itemFields || []) {
        item[itf.key] = NON_TEXTUAL_ITEM_FIELDS.has(itf.key)
          ? (itf.key === 'pct' ? '55' : itf.key === 'on' ? 'yes' : 'ok')
          : sentinelFor(tkey, f.key, itf.key);
      }
      out[f.key] = [item];
    } else {
      out[f.key] = sentinelFor(tkey, f.key);
    }
  }
  return out;
}

function expectedSentinels(tkey) {
  const out = [];
  for (const f of contentFieldsFor(tkey)) {
    if (f.kind === 'groupList') {
      for (const itf of f.itemFields || []) {
        if (!NON_TEXTUAL_ITEM_FIELDS.has(itf.key)) out.push(sentinelFor(tkey, f.key, itf.key));
      }
    } else {
      out.push(sentinelFor(tkey, f.key));
    }
  }
  return out;
}

// ── 1. accessor semantics (the worker's landingContent, mirrored) ───────────

test('templateContent falls back to the schema default for a blank scalar', () => {
  const c = templateContent({ thesis: '   ' }, 'capital-storyteller');
  const def = TEMPLATE_CONTENT_SCHEMA['capital-storyteller'].find((f) => f.key === 'thesis').default;
  assert.equal(c.t('thesis'), def);
  assert.equal(templateContent({ thesis: 'Mine.' }, 'capital-storyteller').t('thesis'), 'Mine.');
});

test('templateContent falls back to the default LIST when every item is blank', () => {
  const spec = TEMPLATE_CONTENT_SCHEMA['capital-ready-kit'].find((f) => f.key === 'traction');
  const empty = templateContent({ traction: [{ value: '', label: '  ' }] }, 'capital-ready-kit');
  assert.deepEqual(empty.list('traction').map((i) => i.value), spec.default.map((i) => i.value));
  const one = templateContent({ traction: [{ value: 'X', label: 'Y' }] }, 'capital-ready-kit');
  assert.equal(one.list('traction').length, 1);
  assert.equal(one.list('traction')[0].value, 'X');
});

test('templateContent clamps a list to the field max', () => {
  const spec = TEMPLATE_CONTENT_SCHEMA['capital-ready-kit'].find((f) => f.key === 'why_now');
  const many = Array.from({ length: spec.max + 4 }, (_, i) => ({ title: `T${i}`, body: `B${i}` }));
  assert.equal(templateContent({ why_now: many }, 'capital-ready-kit').list('why_now').length, spec.max);
});

test('templateContent accepts either the block or a whole content_json map', () => {
  const block = { thesis: 'Direct.' };
  assert.equal(templateContent(block, 'capital-storyteller').t('thesis'), 'Direct.');
  assert.equal(templateContent({ 'capital-storyteller': block }, 'capital-storyteller').t('thesis'), 'Direct.');
});

test('pct clamps to 0-100 and survives junk', () => {
  assert.equal(pct('55'), 55);
  assert.equal(pct('120%'), 100);
  assert.equal(pct('-3'), 3); // sign is stripped with the other non-digits, as in the worker
  assert.equal(pct(''), 0);
  assert.equal(pct(null), 0);
  assert.equal(pct('abc'), 0);
});

// ── 2. editor rehydration ──────────────────────────────────────────────────

test('parseContentJson handles a parsed object, a JSON string, and junk', () => {
  assert.deepEqual(parseContentJson({ a: 1 }), { a: 1 });
  assert.deepEqual(parseContentJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseContentJson('not json'), {});
  assert.deepEqual(parseContentJson(null), {});
  assert.deepEqual(parseContentJson('[1,2]'), {});
});

test('contentForTemplate never overwrites a saved value with a default', () => {
  const saved = { 'capital-ready-kit': { traction: [{ value: 'Mine', label: 'Real' }], why_now: [] } };
  const block = contentForTemplate(saved, 'capital-ready-kit');
  assert.deepEqual(block.traction, [{ value: 'Mine', label: 'Real' }]);
  // A deliberately emptied list stays empty — reopening must not resurrect defaults.
  assert.deepEqual(block.why_now, []);
  // Untouched fields fill in from the schema so the form is complete.
  assert.deepEqual(block.team, defaultsForTemplate('capital-ready-kit').team);
});

test('contentForTemplate reads a block stored under the legacy template_kit key', () => {
  const saved = JSON.stringify({ 'capital-ready-kit-legacy': { traction: [{ value: 'Kit', label: 'K' }] } });
  const block = contentForTemplate(saved, 'capital-ready-kit', 'capital-ready-kit-legacy');
  assert.deepEqual(block.traction, [{ value: 'Kit', label: 'K' }]);
});

test('defaultsForTemplate deep-copies, so editing a draft cannot mutate the catalog', () => {
  const a = defaultsForTemplate('advisor-connect');
  a.help_areas[0].title = 'MUTATED';
  assert.notEqual(defaultsForTemplate('advisor-connect').help_areas[0].title, 'MUTATED');
});

test('blankItem covers every itemField of a groupList', () => {
  const f = TEMPLATE_CONTENT_SCHEMA['partner-hub'].find((x) => x.key === 'models');
  assert.deepEqual(Object.keys(blankItem(f)).sort(), f.itemFields.map((i) => i.key).sort());
});

// ── 3 + 4. every editable field reaches the preview, and replaces the default ──

for (const tkey of CATALOG_KEYS) {
  test(`"${tkey}" preview renders EVERY editable content field from data.content`, () => {
    const Comp = PREVIEW_REGISTRY[tkey];
    assert.ok(Comp, `no preview component registered for "${tkey}"`);
    const html = renderToStaticMarkup(
      React.createElement(Comp, { data: { content: sentinelContent(tkey) } }),
    );
    const missing = expectedSentinels(tkey).filter((s) => !html.includes(s));
    assert.deepEqual(
      missing, [],
      `"${tkey}" preview does not render these editable fields — editing them would do nothing on screen: ${missing.join(', ')}`,
    );
  });

  test(`"${tkey}" preview shows the founder's content instead of hard-coded copy`, () => {
    const Comp = PREVIEW_REGISTRY[tkey];
    const html = renderToStaticMarkup(
      React.createElement(Comp, { data: { content: sentinelContent(tkey) } }),
    );
    // Long default strings are distinctive enough that a match means the
    // component printed its own copy rather than reading the supplied content.
    const leaked = [];
    for (const f of contentFieldsFor(tkey)) {
      const defs = f.kind === 'groupList'
        ? (f.default || []).flatMap((it) => Object.entries(it)
          .filter(([k]) => !NON_TEXTUAL_ITEM_FIELDS.has(k))
          .map(([, v]) => v))
        : [f.default];
      for (const d of defs) {
        if (typeof d === 'string' && d.length > 25 && html.includes(d)) leaked.push(`${f.key}: "${d.slice(0, 40)}…"`);
      }
    }
    assert.deepEqual(
      leaked, [],
      `"${tkey}" preview still prints schema default copy while content was supplied — that section is hard-coded, not data-driven: ${leaked.join(' | ')}`,
    );
  });
}

test('every catalog template has an editable-field schema entry', () => {
  for (const t of TEMPLATES) {
    assert.ok(
      Array.isArray(TEMPLATE_CONTENT_SCHEMA[t.visualTemplate]),
      `"${t.id}" (visual "${t.visualTemplate}") has no content schema — its editor would show shared fields only`,
    );
    assert.ok(
      contentFieldsFor(t.visualTemplate).length > 0,
      `"${t.id}" has an EMPTY content schema — the editor would expose no template sections`,
    );
  }
});
