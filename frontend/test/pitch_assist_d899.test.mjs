/**
 * D899 (#2678, part 5 of #2434) — Eadwyn's card tools in the Pitch deck editor.
 *
 *   · the model: the tools and their rail options, the cost line, what a press
 *     sends, why a bound figure takes no tool, the connector groups and the
 *     card they make, the rail row's models priced from the catalogue;
 *   · PD7, mounted: the bar on a selected text block shows each tool's cost,
 *     a press opens its cost first, Run sends the press's rail option, the
 *     proposal is the before struck and the after, Accept places it and Save
 *     writes it; a metric tile takes no tool; AI off greys the bar; a 402
 *     opens the tokens dialog;
 *   · the Add menu: Text and Image open Add a block on that kind, Background
 *     opens Design, Chart proposes a block whose series are bindings;
 *   · PD9d: connectors with their last sync, figures grouped by connector, a
 *     headline from Eadwyn with its cost, a typed figure refused, and a new
 *     card of bound tiles.
 *
 * Every venture, card and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { deckAssistApi } from '../src/lib/api/deckAssist.js';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { railProposalsApi } from '../src/lib/api/railProposals.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { __resetAssistModeForTest, seedAssistModes } from '../src/hooks/useAssistMode.js';
import PitchEditor from '../src/pages/raise/pitch/PitchEditor.jsx';
import { FIRST_RUN_KEY } from '../src/pages/raise/pitch/editorModel.js';
import {
  AI_OFF_LINE, CHART_TOOLS, FIGURE_LINE, RAIL_MODELS, TEXT_TOOLS,
  blockRefusal, chartProposal, connectorCard, connectorGroups, connectorOf, costLine, railModelRows, syncLine, textBody, textProposal,
} from '../src/pages/raise/pitch/deckAssistModel.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const MODEL = {
  grid: { cols: 12, rows: 6 }, max_blocks: 24, notes_max: 4000,
  layouts: [{ id: 'statement', label: 'Statement', blocks: [{ kind: 'text', grid: { c1: 2, c2: 11, r1: 2, r2: 5 }, style: 'heading' }] }],
  block_kinds: ['text', 'chart', 'graphic', 'image', 'video', 'audio', 'link', 'metric'],
  chart_types: ['columns'], chart_ranges: ['all'], text_styles: ['heading', 'paragraph', 'list'], image_tags: ['photo'],
  video_ratios: ['16:9', '9:16'], audiences: ['seed_fund'], themes: ['brand', 'neutral_light', 'neutral_dark'],
};
const BINDING = { source_key: 'grow.mrr', record_ref: 'synthetic:1', as_of: '2026-10-01', grade: 'Measured', snapshot_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6' };
const CARD = {
  title: 'Synthetic traction', layout: 'title',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Synthetic customers love it' },
    { id: 'b2', kind: 'metric', grid: { c1: 1, c2: 3, r1: 5, r2: 6 }, label: 'MRR', value: '4200', binding: BINDING },
  ],
};
const DECK = { id: 31, project_id: 7, version: 3, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00', audience: 'seed_fund', theme: null, slides: [CARD] };
const ITEMS = [
  { source_key: 'grow.mrr', label: 'MRR', value: 4200, unit: 'usd', as_of: '2026-10-01', grade: 'Measured', source: 'Stripe', state: 'recorded', record_ref: 'synthetic:1', snapshot_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6', module: 'Grow › Revenue' },
  { source_key: 'build.commits_90d', label: 'Commits, 90 days', value: 311, unit: 'count', as_of: '2026-10-20', grade: 'Measured', source: 'GitHub', state: 'recorded', record_ref: 'synthetic:2', snapshot_hash: 'b1b2c3d4e5f6a1b2c3d4e5f6', module: 'Build › Engineering' },
  { source_key: 'grow.runway', label: 'Runway', value: null, unit: 'months', state: 'not_recorded', module: 'Grow › Finance' },
  { source_key: 'validate.interviews', label: 'Interviews', value: 14, unit: 'count', state: 'recorded', source: 'Manual', record_ref: 'synthetic:3', snapshot_hash: 'c1b2c3d4e5f6a1b2c3d4e5f6' },
];
const SOURCES = { project_id: 7, items: ITEMS, coverage: { slots: 4, filled: 3, by_grade: {}, not_recorded: 1, unreadable: 0 } };
const INTEGRATIONS = { ok: true, items: [{ uid: 'i1', provider_key: 'github', display_name: 'GitHub', status: 'connected', last_synced_at: '2026-10-25T09:00:00Z', last_error: null }] };
const CATALOGUE = {
  ok: true,
  models: [
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', billed: { tokens_in: 0.35, tokens_out: 2.7 }, unit_words: { tokens_in: 'per 1M input tokens', tokens_out: 'per 1M output tokens' } },
    { id: '@cf/black-forest-labs/flux-1-schnell', billed: { tiles: 0.0000634, steps: 0.000127 }, unit_words: { tiles: 'per tile', steps: 'per step' } },
    { id: '@cf/google/gemma-4-26b-a4b-it', billed: { tokens_in: 0.12, tokens_out: 0.36 }, unit_words: { tokens_out: 'per 1M output tokens' } },
  ],
};
const FOUNDER = { id: 2, role: 'founder', founder_id: 20, name: 'Synthetic Founder' };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('each tool is a founder rail option on the Pitch deck page, wired where it is pressed', () => {
  const keys = new Set([...TEXT_TOOLS, ...CHART_TOOLS].map((t) => t.option));
  assert.deepEqual([...keys].sort(), ['deck:chart', 'deck:expand', 'deck:rewrite', 'deck:shorten', 'deck:table', 'deck:timeline', 'deck:tone', 'deck:translate']);
  for (const key of keys) {
    const o = FOUNDER_OPTIONS.find((x) => x.key === key);
    assert.ok(o, key);
    assert.equal(o.page, 'Founder · Raise · Pitch deck', key);
    assert.equal(o.kind, 'write', key);
  }
  assert.equal(TEXT_TOOLS.find((t) => t.action === 'ask').option, 'deck:rewrite', 'Ask is a rewrite with an instruction');
  assert.deepEqual(TEXT_TOOLS.map((t) => t.label), ['Rewrite', 'Shorten', 'Expand', 'Change tone', 'Translate', 'Ask'], 'PD7\'s bar, in its order');
});

test('the cost line, what a press sends, and why a figure takes no tool', () => {
  assert.equal(costLine({ ai: true, hold_microusd: 1200 }), 'Up to $0.0012 in AI tokens, charged to you when it runs.');
  assert.equal(costLine({ ai: false, reason: 'assist_off' }), AI_OFF_LINE);
  assert.equal(costLine(null), 'Reading the cost…');
  assert.deepEqual(textBody('tone', CARD.blocks[0], { tone: 'warm' }), { action: 'tone', block: { id: 'b1', kind: 'text' }, text: 'Synthetic customers love it', tone: 'warm' });
  assert.deepEqual(textBody('metric-ish', CARD.blocks[1]).block.binding, BINDING, 'a bound block sends its binding so the Worker refuses it');
  assert.equal(textBody('ask', CARD.blocks[0], { instruction: '  warmer ' }).instruction, 'warmer');
  assert.equal(blockRefusal(CARD.blocks[1], ITEMS), FIGURE_LINE('Grow › Revenue'));
  assert.equal(blockRefusal(CARD.blocks[1], ITEMS), 'Figures come from your records. Update Grow › Revenue to change this one.');
  assert.equal(blockRefusal({ kind: 'text', text: 'x', binding: { source_key: 'grow.runway' } }, ITEMS), FIGURE_LINE('Grow › Finance'), 'any bound block');
  assert.equal(blockRefusal(CARD.blocks[0], ITEMS), null);
  assert.match(blockRefusal({ kind: 'text', text: '  ' }), /no words yet/);
  assert.match(blockRefusal({ kind: 'image' }), /Select a text block/);
  assert.equal(textProposal({ proposal: { uid: 'u1' }, before: 'a', after: 'b', cost: { charged_microusd: 900 } }).cost, '$0.0009');
  assert.equal(textProposal({}), null);
  const chart = chartProposal({ proposal: { uid: 'u2' }, block: { kind: 'chart', series: [] }, title: null }, CHART_TOOLS[2]);
  assert.deepEqual(chart.size, { cols: 12, rows: 2 }, 'a timeline is a wide band');
});

test('connectors group what they feed, and the card they make binds every tile', () => {
  assert.equal(connectorOf(ITEMS[0]), 'stripe');
  assert.equal(connectorOf({ ...ITEMS[0], source: 'Manual' }), null, 'MRR typed by hand is no connector\'s');
  assert.equal(connectorOf(ITEMS[1]), 'github');
  assert.equal(connectorOf(ITEMS[3]), null);
  const groups = connectorGroups(INTEGRATIONS.items, ITEMS);
  assert.deepEqual(groups.map((g) => [g.provider, g.items.map((i) => i.source_key)]), [['github', ['build.commits_90d']], ['stripe', ['grow.mrr']]],
    'GitHub from the integrations list; Stripe from the figure it feeds');
  assert.equal(syncLine(groups[0], Date.parse('2026-10-25T09:30:00Z')), 'Last sync 30 min ago');
  assert.equal(syncLine({ status: 'connected' }), 'Connected');
  const card = connectorCard([ITEMS[1], ITEMS[0]], 'Synthetic momentum');
  assert.equal(card.blocks[0].text, 'Synthetic momentum');
  assert.deepEqual(card.blocks.slice(1).map((b) => [b.kind, b.binding.source_key, b.value]), [['metric', 'build.commits_90d', '311'], ['metric', 'grow.mrr', '4200']],
    'each value is the record\'s, each tile bound to it');
  assert.equal(connectorCard([ITEMS[0]], '').title, 'From your records');
});

test('the rail row lists the four models, priced from the catalogue; FLUX.2 Klein 9B says why it is not routed', () => {
  assert.deepEqual(RAIL_MODELS.map((m) => m.name), ['Llama 3.3 70B Fast', 'FLUX.2 Klein 9B', 'FLUX.1 Schnell', 'Gemma 4 26B']);
  const rows = railModelRows(CATALOGUE.models);
  assert.equal(rows[0].price, '$2.70 per 1M output tokens');
  assert.equal(rows[2].price, '$0.000063 per tile');
  assert.equal(rows[1].offered, false);
  assert.equal(rows[1].price, 'Not offered on your plan', 'a partner model behind AI_PARTNER_MODELS is not in the member catalogue');
  assert.match(rows[1].unrouted, /Not routed on this page yet/);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const ORIGINAL = { api: { ...api }, editor: { ...deckEditorApi }, sources: { ...deckSourcesApi }, assist: { ...deckAssistApi }, proposals: { ...railProposalsApi }, pricing: { ...publicPricingApi } };

async function mount(answers = {}, { aiOff = false } = {}) {
  const calls = [];
  const stub = (name, fn) => (...a) => { calls.push([name, ...a]); return fn(...a); };
  const reads = {
    listProjects: async () => [{ id: 7, name: 'Synthetic Labs' }],
    deckListVersions: async () => ({ versions: [{ id: 31, version: 3, is_current: true }] }),
    deckGet: async () => DECK,
    integrationsList: async () => INTEGRATIONS,
    getMe: async () => FOUNDER,
    'editor.model': async () => MODEL,
    'editor.brandKit': async () => ({ project_id: 7, kit: null }),
    'sources.refresh': async () => ({ rows: [] }),
    'sources.list': async () => SOURCES,
    'assist.quote': async (_id, _card, body) => ({ action: body.action, option: 'deck:x', ai: true, hold_microusd: { rewrite: 1200, chart: 800, headline: 500 }[body.action] ?? 1000, model: 'synthetic' }),
    'assist.run': async () => { throw new Error('no run stubbed'); },
    'proposals.decide': async () => ({ ok: true }),
    'pricing.aiModels': async () => CATALOGUE,
    ...answers,
  };
  const homes = { editor: deckEditorApi, sources: deckSourcesApi, assist: deckAssistApi, proposals: railProposalsApi, pricing: publicPricingApi };
  for (const [name, fn] of Object.entries(reads)) {
    const [home, key] = name.includes('.') ? name.split('.') : [null, name];
    (home ? homes[home] : api)[key] = stub(name, fn);
  }
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify(FOUNDER));
  localStorage.setItem(FIRST_RUN_KEY, '1');
  __resetAssistModeForTest();
  if (aiOff) seedAssistModes({ raise: false });
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { rootEl.render(h(MemoryRouter, { initialEntries: ['/raise/pitch/edit?project_id=7'] }, h(AuthProvider, null, h(PitchEditor)))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, settle, pr,
    named: (name) => calls.filter((c) => c[0] === name),
    text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(node, value) { await act(async () => { pr(node).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() {
      await act(async () => rootEl.unmount()); restore(); __resetAssistModeForTest();
      Object.assign(api, ORIGINAL.api); Object.assign(deckEditorApi, ORIGINAL.editor); Object.assign(deckSourcesApi, ORIGINAL.sources);
      Object.assign(deckAssistApi, ORIGINAL.assist); Object.assign(railProposalsApi, ORIGINAL.proposals); Object.assign(publicPricingApi, ORIGINAL.pricing);
    },
  };
}

test('PD7: a text block\'s bar shows each cost, a press shows its cost first, and Accept places the words that Save writes', async () => {
  let saved = null;
  const m = await mount({
    'assist.run': async (id, card, body) => ({ proposal: { uid: 'p1' }, action: body.action, option: 'deck:rewrite', before: body.text, after: 'Synthetic founders keep coming back', cost: { charged_microusd: 900, usage_log_id: 5 } }),
    deckUpdate: async (id, body) => { saved = body; return { ...DECK, id: 32, version: 4, slides: body.slides }; },
  });
  try {
    assert.ok(!m.by('pitch-assist-bar'), 'no bar until a block is selected');
    await m.press(m.by('pitch-editor-block-b1'));
    assert.ok(m.by('pitch-assist-bar'));
    assert.match(m.text(m.by('pitch-assist-rewrite-cost')), /up to \$0\.0012/, 'each tool shows its cost on the bar');
    assert.match(m.text(m.by('pitch-assist-shorten-cost')), /up to \$0\.0010/);
    assert.equal(m.named('assist.run').length, 0, 'reading costs runs nothing');
    await m.press(m.by('pitch-assist-rewrite'));
    assert.match(m.text(m.by('pitch-assist-dialog-cost')), /Up to \$0\.0012 in AI tokens, charged to you when it runs\./, 'the cost before it runs');
    assert.equal(m.named('assist.run').length, 0, 'opening the dialog runs nothing');
    await m.press(m.by('pitch-assist-dialog-run'));
    const [, deckId, card, body, headers] = m.named('assist.run')[0];
    assert.equal(deckId, 31); assert.equal(card, 0);
    assert.deepEqual(body, { action: 'rewrite', block: { id: 'b1', kind: 'text' }, text: 'Synthetic customers love it' });
    assert.equal(decodeURIComponent(headers['X-Rail-Option']), 'deck:rewrite', 'the press names its own option');
    assert.match(m.text(m.by('pitch-assist-proposal-before')), /Synthetic customers love it/);
    assert.match(m.text(m.by('pitch-assist-proposal-after')), /Synthetic founders keep coming back/);
    assert.match(m.text(m.by('pitch-editor-save-state')), /Saved/, 'a proposal is not a change');
    await m.press(m.by('pitch-assist-proposal-accept'));
    assert.deepEqual(m.named('proposals.decide').map((c) => c.slice(1)), [['p1', 'accept']]);
    assert.match(m.text(m.by('pitch-editor-block-b1')), /Synthetic founders keep coming back/, 'Accept places it on the card');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
    await m.press(m.by('pitch-editor-save'));
    await m.press(m.by('pitch-editor-save-run'));
    assert.equal(saved.slides[0].blocks[0].text, 'Synthetic founders keep coming back', 'Save writes the version');
    assert.deepEqual(saved.slides[0].blocks[1], CARD.blocks[1], 'the bound tile is untouched');
  } finally { await m.unmount(); }
});

test('PD7: Change tone, Translate and Ask send their choice; Discard places nothing', async () => {
  const m = await mount({
    'assist.run': async (id, card, body) => ({ proposal: { uid: `p-${body.action}` }, before: body.text, after: 'Synthetic other words', cost: { charged_microusd: 100 } }),
  });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.type(m.by('pitch-assist-tone-choice'), 'formal');
    await m.press(m.by('pitch-assist-tone'));
    await m.press(m.by('pitch-assist-dialog-run'));
    assert.equal(m.named('assist.run').at(-1)[3].tone, 'formal');
    assert.equal(decodeURIComponent(m.named('assist.run').at(-1)[4]['X-Rail-Option']), 'deck:tone');
    await m.press(m.by('pitch-assist-proposal-discard'));
    assert.deepEqual(m.named('proposals.decide').at(-1).slice(1), ['p-tone', 'discard']);
    assert.match(m.text(m.by('pitch-editor-block-b1')), /Synthetic customers love it/, 'Discard places nothing');
    await m.type(m.by('pitch-assist-language-choice'), 'German');
    await m.press(m.by('pitch-assist-translate'));
    await m.press(m.by('pitch-assist-dialog-run'));
    assert.equal(m.named('assist.run').at(-1)[3].language, 'German');
    await m.press(m.by('pitch-assist-proposal-discard'));
    assert.equal(m.pr(m.by('pitch-assist-ask')).disabled, true, 'Ask needs an instruction');
    await m.type(m.by('pitch-assist-instruction'), 'Synthetic: say it warmer');
    await m.press(m.by('pitch-assist-ask'));
    await m.press(m.by('pitch-assist-dialog-run'));
    assert.equal(m.named('assist.run').at(-1)[3].instruction, 'Synthetic: say it warmer');
    assert.equal(decodeURIComponent(m.named('assist.run').at(-1)[4]['X-Rail-Option']), 'deck:rewrite');
  } finally { await m.unmount(); }
});

test('PD7: a bound figure takes no tool, a refused run shows its sentence, and a 402 opens the tokens dialog', async () => {
  let fail = Object.assign(new Error('Eadwyn’s wording named a figure your text did not, so it was not placed. Figures come from your records. It was charged for the run.'), { status: 422, code: 'figure_in_output' });
  const m = await mount({ 'assist.run': async () => { throw fail; } });
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    assert.equal(m.pr(m.by('pitch-assist-rewrite')).disabled, true, 'no tool on a metric tile');
    assert.match(m.text(m.by('pitch-assist-why')), /Figures come from your records\. Update Grow › Revenue to change this one\./);
    assert.equal(m.named('assist.quote').length, 0, 'a bound figure is not even quoted');
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-assist-rewrite'));
    await m.press(m.by('pitch-assist-dialog-run'));
    assert.match(m.text(m.by('pitch-assist-dialog-refusal')), /named a figure your text did not/);
    assert.ok(!m.by('pitch-assist-proposal'), 'nothing to accept');
    fail = Object.assign(new Error('You are out of AI tokens.'), { status: 402, code: 'budget' });
    await m.press(m.by('pitch-assist-dialog-run'));
    assert.ok(m.by('pitch-assist-tokens'), 'PD25\'s tokens dialog');
    assert.match(m.text(m.by('pitch-assist-tokens')), /Your records still fill every figure/);
    assert.ok(!m.by('pitch-assist-dialog'), 'the press dialog gives way to it');
  } finally { await m.unmount(); }
});

test('AI off: the bar is greyed with the sentence, and the records still fill', async () => {
  const m = await mount({}, { aiOff: true });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    assert.ok(m.text(m.by('pitch-assist-off')).includes(AI_OFF_LINE));
    for (const t of TEXT_TOOLS) assert.equal(m.pr(m.by(`pitch-assist-${t.action}`)).disabled, true, t.action);
    assert.equal(m.named('assist.quote').length, 0, 'nothing is quoted while it is off');
    await m.press(m.by('pitch-add-menu-open'));
    await m.press(m.by('pitch-add-chart'));
    assert.match(m.text(m.by('pitch-add-off')), /AI assistance is off on this page/);
    for (const t of CHART_TOOLS) assert.equal(m.pr(m.by(`pitch-add-${t.action}`)).disabled, true, t.action);
  } finally { await m.unmount(); }
});

test('the Add menu: Text and Image open Add a block on that kind, Background opens Design', async () => {
  const m = await mount();
  try {
    await m.press(m.by('pitch-add-menu-open'));
    assert.deepEqual(['text', 'chart', 'image', 'background', 'connector', 'layout'].map((id) => Boolean(m.by(`pitch-add-${id}`))), [true, true, true, true, true, true]);
    await m.press(m.by('pitch-add-image'));
    assert.ok(m.by('pitch-editor-add-dialog'), 'the existing dialog (PD8c)');
    assert.equal(m.pr(m.by('pitch-editor-kind-image'))['aria-checked'], true);
  } finally { await m.unmount(); }
  const n = await mount();
  try {
    await n.press(n.by('pitch-add-menu-open'));
    await n.press(n.by('pitch-add-text'));
    assert.equal(n.pr(n.by('pitch-editor-kind-text'))['aria-checked'], true);
  } finally { await n.unmount(); }
  const o = await mount();
  try {
    assert.equal(o.pr(o.by('pitch-editor-tab-design'))['aria-selected'], false);
    await o.press(o.by('pitch-add-menu-open'));
    await o.press(o.by('pitch-add-background'));
    assert.equal(o.pr(o.by('pitch-editor-tab-design'))['aria-selected'], true);
  } finally { await o.unmount(); }
});

test('the Add menu\'s Chart: costs and the rail row first, then a block whose series are bindings', async () => {
  const series = [{ label: 'MRR', binding: BINDING }];
  const m = await mount({
    'assist.run': async (id, card, body) => ({ proposal: { uid: 'c1' }, action: body.action, block: { kind: 'chart', chart_type: 'columns', series, range: 'all', previous: false, labels: true }, title: 'Synthetic growth', cost: { charged_microusd: 700 } }),
  });
  try {
    await m.press(m.by('pitch-add-menu-open'));
    await m.press(m.by('pitch-add-chart'));
    assert.match(m.text(m.by('pitch-add-chart-cost')), /up to \$0\.0008/);
    assert.match(m.text(m.by('pitch-add-models')), /Llama 3\.3 70B Fast.*\$2\.70 per 1M output tokens.*FLUX\.2 Klein 9B.*Not routed on this page yet.*FLUX\.1 Schnell.*Gemma 4 26B/);
    assert.match(m.text(m.by('pitch-add-charts')), /Figures from your records are free/);
    await m.press(m.by('pitch-add-chart'));
    assert.match(m.text(m.by('pitch-add-dialog-cost')), /Up to \$0\.0008/);
    await m.press(m.by('pitch-add-dialog-run'));
    assert.deepEqual(m.named('assist.run')[0][3], { action: 'chart', heading: 'Synthetic traction' });
    assert.equal(decodeURIComponent(m.named('assist.run')[0][4]['X-Rail-Option']), 'deck:chart');
    assert.match(m.text(m.by('pitch-add-proposal')), /Synthetic growth: a columns of MRR/);
    await m.press(m.by('pitch-add-proposal-accept'));
    assert.deepEqual(m.named('proposals.decide').map((c) => c.slice(1)), [['c1', 'accept']]);
    assert.ok(m.by('pitch-editor-block-b3'), 'the chart is placed as a new block');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.unmount(); }
});

test('PD9d: connectors with their last sync, figures by connector, a headline from Eadwyn, and a new card of bound tiles', async () => {
  const m = await mount({
    'assist.run': async (id, card, body) => ({ proposal: { uid: 'h1' }, action: body.action, before: '', after: 'Synthetic momentum, shipped weekly', cost: { charged_microusd: 400 } }),
  });
  try {
    await m.press(m.by('pitch-add-menu-open'));
    await m.press(m.by('pitch-add-connector'));
    assert.ok(m.by('pitch-connector'));
    assert.equal(m.named('integrationsList').length, 1, 'GET /api/integrations');
    assert.match(m.text(m.by('pitch-connector-sync-github')), /Last sync/);
    assert.ok(m.by('pitch-connector-item-build.commits_90d'), 'GitHub feeds commits');
    assert.ok(m.by('pitch-connector-item-grow.mrr'), 'Stripe feeds MRR');
    assert.ok(!m.by('pitch-connector-item-validate.interviews'), 'a hand-typed figure is no connector\'s');
    assert.ok(!m.by('pitch-connector-item-grow.runway'), 'a figure not recorded is not offered');
    assert.equal(m.pr(m.by('pitch-connector-add')).disabled, true, 'choose a figure first');
    await m.type(m.by('pitch-connector-item-build.commits_90d'), true);
    await m.type(m.by('pitch-connector-item-grow.mrr'), true);
    assert.match(m.text(m.by('pitch-connector-cost')), /Up to \$0\.0005/, 'the headline\'s cost before it runs');
    assert.deepEqual(m.named('assist.quote').at(-1)[3], { action: 'headline', source_keys: ['build.commits_90d', 'grow.mrr'] });
    await m.press(m.by('pitch-connector-write'));
    assert.equal(decodeURIComponent(m.named('assist.run')[0][4]['X-Rail-Option']), 'deck:rewrite');
    await m.press(m.by('pitch-connector-proposal-accept'));
    assert.equal(m.pr(m.by('pitch-connector-headline')).value, 'Synthetic momentum, shipped weekly');
    assert.deepEqual(m.named('proposals.decide').map((c) => c.slice(1)), [['h1', 'accept']]);
    await m.type(m.by('pitch-connector-headline'), 'Synthetic 3x growth');
    assert.ok(m.by('pitch-connector-figure'), 'a typed figure is refused');
    assert.equal(m.pr(m.by('pitch-connector-add')).disabled, true);
    await m.type(m.by('pitch-connector-headline'), 'Synthetic momentum');
    await m.press(m.by('pitch-connector-add'));
    assert.ok(!m.by('pitch-connector'), 'the lightbox closes');
    assert.match(m.text(m.by('pitch-editor-rail')), /02 Synthetic momentum/, 'a new card, selected');
    assert.match(m.text(m.by('pitch-editor-card')), /Commits, 90 days.*311.*MRR.*4200/, 'tiles read the records');
  } finally { await m.unmount(); }
});

test('no tool writes a number: the components never build a value from a model\'s answer', () => {
  for (const f of ['CardAssistBar.jsx', 'AddMenu.jsx', 'ConnectorLightbox.jsx']) {
    const src = read(`frontend/src/pages/raise/pitch/${f}`);
    assert.ok(src.includes('deckAssistApi.run('), `${f} runs through the Worker`);
    assert.ok(src.includes('deckAssistApi.quote('), `${f} shows the cost first`);
    assert.ok(!/value:\s*r\./.test(src) && !/binding:\s*r\./.test(src), `${f} takes no value or binding from a run`);
  }
  const editor = read('frontend/src/pages/raise/pitch/PitchEditor.jsx');
  for (const f of ['AddMenu', 'CardAssistBar']) assert.ok(editor.includes(`import ${f} from './${f}';`), `PitchEditor mounts ${f}`);
});
