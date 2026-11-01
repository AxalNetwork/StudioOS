/**
 * D1604 (#3716, PD-9, plan §8 and §11 step 16) — the deck studio's states,
 * and the Slides-suite (.odp) export on its real route.
 *
 *   · Export: the .odp card is D1603's `POST /api/decks/:id/export/odp`
 *     (#3882, now on main) through `api.deckExportOdp`, not the adapter; the
 *     adapter no longer lists it; its file, failure and options read as the
 *     other formats do;
 *   · AI paused: the editor and the studio home draw one line saying what
 *     still works, Ask on an area is greyed with the reason, and a phone's Ask
 *     is off with the same words;
 *   · out of AI tokens: a quote refused with a 402 turns Ask off for the
 *     session, the line carries Add tokens, and the header's ⋯ is told;
 *   · the plan gate: a press the plan does not include links to the plans,
 *     never to a top-up;
 *   · read-only HQ and the Explorer: no AI line, no Ask and no New deck;
 *   · dark: every class the new line carries has its dark pair.
 *
 * Every venture, card and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { ADMIN, mountEditor } from './_pitch_editor_mount.mjs';
import { __resetAssistModeForTest, seedAssistModes } from '../src/hooks/useAssistMode.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import ExportDialog from '../src/pages/raise/pitch/ExportDialog.jsx';
import PitchBoundary from '../src/pages/raise/pitch/PitchBoundary.jsx';
import { StudioDecks } from '../src/pages/raise/pitch/PitchStudio.jsx';
import { AiOffBanner } from '../src/pages/raise/pitch/DeckAsk.jsx';
import { RefusalLine } from '../src/pages/raise/pitch/AssistParts.jsx';
import {
  ASK_OFF_PAUSED, ASK_OFF_TOKENS, PAUSED_BANNER, TOKENS_BANNER, aiOffState,
} from '../src/pages/raise/pitch/deckV2Model.js';
import { PLANS_PATH, SEE_PLANS, refusalOf } from '../src/pages/raise/pitch/newDeckModel.js';
import { FORMATS, OPTIONS_WHERE, exportButton, exportFailure, exportFileName, exportedLine, optionsApply } from '../src/pages/raise/pitch/presentExportModel.js';
import { ADD_TOKENS_PATH } from '../src/lib/aiTokens.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/pages/raise/pitch/${rel}`, import.meta.url), 'utf8');
const node = (m, id) => { const n = m.by(id); assert.ok(n, `no ${id}`); return n; };

/* ------------------------------------------------------------------ *
 * Export: the .odp card on D1603's route
 * ------------------------------------------------------------------ */

const DECK = { id: 10, version: 4, title: 'Synthetic seed deck', is_current: 1, created_at: '2026-10-20 10:00:00' };
const response = (body, status = 200, blob = null) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body), blob: async () => blob || new Blob([]),
});

async function mountExport(handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const requests = [];
  const saved = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  URL.createObjectURL = () => 'blob:synthetic';
  URL.revokeObjectURL = () => {};
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    if (tag === 'a') { n.click = () => saved.push(n.download); n.remove = () => {}; }
    return n;
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(ExportDialog, { versions: [DECK], current: DECK, onClose() {} }))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    requests, saved, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke;
      restore();
    },
  };
}
const exportsList = (url) => (url.includes('/decks/10/exports') ? response({ exports: [] }) : null);

test('the .odp card is a format like the others: its words, its options and its file', () => {
  // Mutation checked: the card left `available: false` → the first check fails; the extension left 'pdf' → the file check fails.
  const odp = FORMATS.find((f) => f.id === 'odp');
  assert.deepEqual([odp.label, odp.available], ['Slides-suite file (.odp)', true]);
  assert.match(odp.line, /LibreOffice/);
  assert.equal(optionsApply('odp'), true, 'speaker notes and the Sources appendix apply, as the Worker writes them');
  assert.match(OPTIONS_WHERE.odp, /speaker notes.*Sources appendix is the last slide/);
  assert.equal(exportFileName('Synthetic seed deck', 4, 'odp'), 'Synthetic-seed-deck-v4.odp');
  assert.equal(exportButton('odp'), 'Export Slides-suite file (.odp)');
  assert.equal(exportedLine('odp', DECK), 'Exported Slides-suite file (.odp) of v4. The export is recorded.');
  assert.equal(exportFailure('odp', 500, null), 'The .odp file could not be produced. Try again in a moment. Nothing was shared.');
  assert.equal(exportFailure('odp', 503, { error: 'export_not_recorded', message: 'Synthetic: the export could not be recorded.' }), 'Synthetic: the export could not be recorded.', 'the Worker\'s own sentence when the ledger write failed');
});

test('the .odp export goes through api.deckExportOdp to POST /api/decks/:id/export/odp, never the adapter', async () => {
  // Mutation checked: ExportDialog sending odp through deckExport → the URL check fails; the adapter keeping exportOdp → the seam check fails.
  const v = await mountExport((url, options) => exportsList(url) || (url.endsWith('/decks/10/export/odp') && options.method === 'POST' ? response(null, 200, new Blob(['PK'])) : response({})));
  try {
    assert.equal(v.props('pitch-export-format-odp').disabled, false, 'the card can be chosen');
    await v.click('pitch-export-format-odp');
    assert.equal(v.props('pitch-export-format-odp')['aria-checked'], true);
    assert.match(v.textOf('pitch-export-where'), /In the \.odp file/);
    await v.click('pitch-export-run');
    const posts = v.requests.filter((q) => q.method === 'POST');
    assert.deepEqual(posts.map((q) => [new URL(q.url, 'https://x.test').pathname, q.body]), [['/api/decks/10/export/odp', { notes: true, sources: true }]]);
    assert.deepEqual(v.saved, ['Synthetic-seed-deck-v4.odp']);
    assert.equal(v.textOf('pitch-export-done'), 'Exported Slides-suite file (.odp) of v4. The export is recorded.');
    assert.ok(v.requests.filter((q) => q.url.includes('/decks/10/exports')).length >= 2, 'the ledger is read again after the export');
  } finally { await v.close(); }
  assert.equal('exportOdp' in adapter, false, 'a surface whose route is on main is not in the seam');
  assert.equal(adapter.availability('exportOdp'), null);
  const dialog = codeOnly(read('ExportDialog.jsx'));
  assert.match(dialog, /api\.deckExportOdp\(version\.id, \{ notes, sources \}\)/);
  assert.doesNotMatch(dialog, /deckV2Adapter/);
});

test('a refused .odp export says what could not be produced and that nothing was shared', async () => {
  const v = await mountExport((url) => exportsList(url) || (url.endsWith('/export/odp') ? response({ error: 'forbidden' }, 403) : response({})));
  try {
    await v.click('pitch-export-format-odp');
    await v.click('pitch-export-run');
    assert.equal(v.textOf('pitch-export-failed'), 'The .odp file could not be produced. Try again in a moment. Nothing was shared.');
    assert.deepEqual(v.saved, [], 'no file on a refusal');
    assert.ok(!v.has('pitch-export-done'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * AI paused, out of tokens, and the plan gate
 * ------------------------------------------------------------------ */

test('the AI-off state: paused wins over tokens, and each has its line and its Ask words', () => {
  // Mutation checked: tokens checked before paused → the first check fails.
  assert.equal(aiOffState({ aiOn: false, outOfTokens: true }).kind, 'paused', 'adding tokens would not lift a pause');
  assert.deepEqual(aiOffState({ aiOn: false }), { kind: 'paused', banner: PAUSED_BANNER, ask: ASK_OFF_PAUSED });
  assert.deepEqual(aiOffState({ outOfTokens: true }), { kind: 'tokens', banner: TOKENS_BANNER, ask: ASK_OFF_TOKENS });
  assert.equal(aiOffState({}), null);
  assert.equal(aiOffState(), null);
  for (const line of [PAUSED_BANNER, TOKENS_BANNER]) assert.match(line, /Present, Share and Export still work/, 'it says what still works');
  assert.doesNotMatch(`${PAUSED_BANNER} ${TOKENS_BANNER}`, /\$0|\b0 tokens/, 'never a zero balance');
});

test('the line: a polite status; out of tokens carries Add tokens; every class has its dark pair', () => {
  assert.equal(renderToStaticMarkup(h(AiOffBanner, { state: null })), '');
  const paused = renderToStaticMarkup(h(AiOffBanner, { state: aiOffState({ aiOn: false }) }));
  assert.match(paused, /role="status"/);
  assert.doesNotMatch(paused, /role="alert"/);
  assert.doesNotMatch(paused, /Add tokens/, 'tokens would not lift a pause');
  const tokens = renderToStaticMarkup(h(AiOffBanner, { state: aiOffState({ outOfTokens: true }) }));
  assert.ok(tokens.includes(`href="${ADD_TOKENS_PATH.replace(/&/g, '&amp;')}"`), 'Add tokens goes to the token packs');
  for (const cls of [...tokens.matchAll(/class="([^"]+)"/g)].flatMap((x) => x[1].split(/\s+/))) {
    if (/^(bg|border|text)-(amber|axal-violet)/.test(cls) && !/^text-\[/.test(cls)) {
      const kind = cls.split('-')[0];
      assert.ok(tokens.includes(`dark:${kind}-`), `${cls} has a dark pair`);
    }
  }
});

test('the plan gate links to the plans, never to a top-up; tokens link to the top-up', () => {
  // Mutation checked: tier_required given no link → the first check fails.
  const gate = refusalOf({ status: 402, code: 'tier_required', message: 'Synthetic: this needs a paid plan.' });
  assert.deepEqual([gate.link, gate.topUp], [{ text: SEE_PLANS, href: PLANS_PATH }, null]);
  assert.equal(SEE_PLANS, 'See plans ›');
  const tokens = refusalOf({ status: 402, code: 'tokens', message: 'Synthetic: out of tokens.' });
  assert.deepEqual([tokens.link, tokens.topUp?.href], [null, ADD_TOKENS_PATH]);
  const line = renderToStaticMarkup(h(RefusalLine, { refusal: gate, testId: 'synthetic-refusal' }));
  assert.match(line, /Synthetic: this needs a paid plan\./);
  assert.match(line, new RegExp(`href="${PLANS_PATH}"[^>]*>See plans ›<`), 'the card tools draw the plan link too');
  assert.doesNotMatch(line, /Add tokens/);
});

test('AI paused in the editor: the line, and Ask on the area greyed with the reason', async () => {
  seedAssistModes({ raise: false });
  const m = await mountEditor();
  try {
    const line = node(m, 'pitch-ai-off');
    assert.equal(m.text(line), PAUSED_BANNER);
    assert.equal(m.pr(line)['data-state'], 'paused');
    await m.press(m.by('pitch-editor-block-b2'));
    const ask = node(m, 'pitch-editor-ask-area');
    assert.equal(m.pr(ask)['aria-disabled'], true);
    assert.equal(m.pr(ask).title, ASK_OFF_PAUSED);
    await m.press(ask);
    assert.ok(!m.by('pitch-areas-generate'), 'nothing opens');
  } finally { localStorage.removeItem('assist_mode:raise'); await m.close(); __resetAssistModeForTest(); }
});

test('AI paused on a phone: the line, and the area\'s Ask is off with the same words', async () => {
  const before = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  seedAssistModes({ raise: false });
  const m = await mountEditor();
  try {
    assert.ok(m.by('pitch-editor-phone'));
    assert.equal(m.text(node(m, 'pitch-ai-off')), PAUSED_BANNER);
    await m.press(node(m, 'pitch-editor-phone-area-b2'));
    assert.equal(m.pr(node(m, 'pitch-editor-phone-ask')).disabled, true);
    assert.equal(m.text(node(m, 'pitch-editor-phone-ask-why')), ASK_OFF_PAUSED);
  } finally { localStorage.removeItem('assist_mode:raise'); await m.close(); __resetAssistModeForTest(); globalThis.matchMedia = before; }
});

test('out of tokens: a 402 on the quote turns Ask off for the session, with Add tokens', async () => {
  // Mutation checked: AreaLightbox not calling onTokens on a 402 quote → the line check fails.
  const refused = async () => { throw Object.assign(new Error('Synthetic: you are out of AI tokens.'), { status: 402, code: 'tokens' }); };
  const m = await mountEditor({ answers: { 'assist.quote': refused, 'prefs.page': async () => ({ models: [], pick: null }) } });
  try {
    assert.ok(!m.by('pitch-ai-off'), 'no line before anything is refused');
    await m.press(m.by('pitch-editor-block-b2'));
    await m.press(node(m, 'pitch-editor-ask-area'));
    assert.ok(m.calls.some((c) => c[0] === 'assist.quote'), 'the lightbox quoted the area');
    const line = node(m, 'pitch-ai-off');
    assert.equal(m.pr(line)['data-state'], 'tokens');
    assert.match(m.text(line), /^You are out of AI tokens\./);
    assert.equal(m.pr(node(m, 'pitch-ai-off-add')).href, ADD_TOKENS_PATH);
    const ask = node(m, 'pitch-editor-ask-area');
    assert.equal(m.pr(ask)['aria-disabled'], true);
    assert.equal(m.pr(ask).title, ASK_OFF_TOKENS);
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 0, 'nothing ran');
  } finally { await m.close(); }
  // The header's ⋯ is told, so an item that runs a model counts into ", N off: out of AI tokens".
  assert.match(codeOnly(read('PitchEditor.jsx')), /outOfTokens=\{Boolean\(chrome\?\.outOfTokens\)\}/);
  assert.match(codeOnly(read('DeckToolbar.jsx')), /<DeckMoreMenu[^>]*outOfTokens=\{outOfTokens\}/);
  assert.match(codeOnly(read('InstructionBox.jsx')), /if \(refusal\?\.topUp\) onTokens\?\.\(\);[\s\S]*if \(refusal\?\.topUp\) onTokens\?\.\(\);/, 'the instruction box reports a 402 on its quote and on its run');
});

test('out of tokens on a phone: the area\'s Ask turns off with the tokens words', async () => {
  // Mutation checked: the phone's Ask ignoring the AI-off state → the disabled check fails.
  const before = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const refused = async () => { throw Object.assign(new Error('Synthetic: you are out of AI tokens.'), { status: 402, code: 'tokens' }); };
  const m = await mountEditor({ answers: { 'assist.quote': refused, 'prefs.page': async () => ({ models: [], pick: null }) } });
  try {
    await m.press(node(m, 'pitch-editor-phone-area-b2'));
    assert.equal(m.pr(node(m, 'pitch-editor-phone-ask')).disabled, false, 'on before anything is refused');
    await m.press(node(m, 'pitch-editor-phone-ask'));
    assert.equal(m.pr(node(m, 'pitch-ai-off'))['data-state'], 'tokens');
    assert.equal(m.pr(node(m, 'pitch-editor-phone-ask')).disabled, true);
    assert.equal(m.text(node(m, 'pitch-editor-phone-ask-why')), ASK_OFF_TOKENS);
  } finally { await m.close(); globalThis.matchMedia = before; }
});

/* ------------------------------------------------------------------ *
 * The studio home, read-only HQ and the Explorer
 * ------------------------------------------------------------------ */

const ok = (data) => ({ status: 'ok', data });
const homeReads = {
  projects: ok([{ id: 7, name: 'Synthetic Labs' }]), project: { id: 7, name: 'Synthetic Labs' }, requested: '7',
  versions: ok({ versions: [] }), deck: { status: 'idle', data: null }, engagement: { status: 'idle', data: null },
  module: { status: 'idle', data: null }, setPage() {}, reload() {},
};
/** The studio home mounted on the client (the assist mode is a client read), with every other read answering empty. */
async function home(readOnly) {
  const restore = installDocument();
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(StudioDecks, { reads: homeReads, readOnly, q: '?project_id=7' }))); });
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const ids = new Map(walk(container).map((n) => [pr(n)['data-testid'], n]).filter(([k]) => k));
  const out = { has: (id) => ids.has(id), text: (id) => text(ids.get(id)) };
  await act(async () => root.unmount());
  globalThis.fetch = fetchBefore; restore();
  return out;
}

test('the studio home: AI paused draws the line for a founder, and nothing for read-only HQ', async () => {
  // Mutation checked: the line drawn for a reader → the read-only check fails.
  try {
    assert.equal((await home(false)).has('pitch-studio-ai-off'), false, 'AI on: no line');
    seedAssistModes({ raise: false });
    const founder = await home(false);
    assert.equal(founder.text('pitch-studio-ai-off'), PAUSED_BANNER);
    assert.ok(founder.has('pitch-studio-empty'), 'the empty state still draws beside it');
    seedAssistModes({ raise: false });
    assert.equal((await home(true)).has('pitch-studio-ai-off'), false, 'a reader runs nothing, so nothing is off');
  } finally { __resetAssistModeForTest(); }
});

test('read-only HQ in the editor: Present only, no Ask and no AI line, even with AI paused', async () => {
  seedAssistModes({ raise: false });
  const m = await mountEditor({ user: ADMIN });
  try {
    assert.ok(m.by('deck-toolbar-present'), 'a reader keeps Present');
    assert.ok(!m.by('pitch-header-ask'), 'no Ask');
    assert.ok(!m.by('pitch-ai-off'), 'no AI line');
  } finally { localStorage.removeItem('assist_mode:raise'); await m.close(); __resetAssistModeForTest(); }
});

test('the Explorer (and the other boundary roles) read the boundary: no New deck, no Ask', () => {
  for (const role of ['exploring', 'advisor', 'operating_partner']) {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(PitchBoundary, { role })));
    assert.match(html, /data-testid="pitch-studio-boundary"/, role);
    assert.doesNotMatch(html, /New deck|Ask Eadwyn|>Ask</, role);
  }
});
