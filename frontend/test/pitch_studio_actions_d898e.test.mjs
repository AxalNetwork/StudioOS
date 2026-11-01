/**
 * D898 group E (#2676) — the old template builder's four actions, each now a
 * studio action (the owner's call, 2026-10-27), and the builder retired.
 *
 *   1. D1604 (#3716): no Fill control on the Decks tab. The deck's Ask
 *      proposes and nothing is filled without Accept (owner rule: Ask, never
 *      Fill); `FillFromProject` stays in StudioActions, unmounted.
 *   2. New deck's Start from marks the recommended template and says why; a
 *      stage nobody recorded is never shown as one.
 *   3. A Spin-Out deck shows its readiness from the preview read; any other
 *      deck draws nothing and reads nothing. The `draft` flag decides.
 *   4. Branding (D1604: the home's ⋯ › Brand kit) shows the plan, the footer and the watermark; a Studio plan
 *      changes the watermark behind a dialog that says what it changes, and
 *      the save names the venture so the Worker writes its ledger line.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_studio_actions_d898e.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { StudioDecks } from '../src/pages/raise/pitch/PitchStudio.jsx';
import { BrandingCard, SpinoutReadiness } from '../src/pages/raise/pitch/StudioActions.jsx';
import {
  SPINOUT_METHOD, WATERMARK_BAD, WATERMARK_PLAN, brandingView, fillRefusal, isSpinoutDeck, markRecommended,
  proposalHref, readinessView, recommendReason, watermarkInput, watermarkSentence,
} from '../src/pages/raise/pitch/studioActionsModel.js';
import { startOptions } from '../src/pages/raise/pitch/newDeckModel.js';
import { mountContracts } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ok = (data) => ({ status: 'ok', data });
const versions = { versions: [{ id: 40, version: 4, title: 'Seed', is_current: 1, created_at: '2026-10-20 10:00:00' }] };
const DECK = { id: 40, version: 4, title: 'Synthetic deck', slides: [{ title: 'Problem', method_id: 'yc_seed' }] };
const SPINOUT = { id: 41, version: 1, slides: JSON.stringify([{ title: 'Cover', method_id: SPINOUT_METHOD }]) };
const reads = (over = {}) => ({
  projects: ok([{ id: 7, name: 'Synthetic venture' }]), project: { id: 7, name: 'Synthetic venture' }, requested: '7',
  versions: ok(versions), module: { status: 'loading', data: null }, deck: ok(DECK), engagement: { status: 'loading', data: null },
  setPage() {}, reload() {}, ...over,
});
const decks = (r, readOnly = false) => renderToStaticMarkup(h(MemoryRouter, null, h(StudioDecks, { reads: r, readOnly, q: '?project_id=7' })));

/* ------------------------------------------------------------------ *
 * 1. Fill from project, on the Decks tab
 * ------------------------------------------------------------------ */

test('D1604: no Fill control on the Decks tab, for a writer or a reader; the fill\'s own rules stay', () => {
  // Owner rule: the button is Ask, never Fill, and nothing is saved without Accept.
  for (const html of [decks(reads()), decks(reads(), true), decks(reads({ deck: ok(SPINOUT) }))]) {
    assert.doesNotMatch(html, /data-testid="pitch-studio-fill"/);
    assert.doesNotMatch(html, />[^<]*\bFill\b[^<]*</, 'no Fill label on the home');
  }
  const home = read('src/pages/raise/pitch/StudioHome.jsx');
  assert.doesNotMatch(home, /FillFromProject|api\.deckAutofill\(/, 'the home mounts no fill');
  assert.doesNotMatch(read('src/pages/raise/pitch/PitchStudio.jsx'), /FillFromProject/);
  // Its proposal opens at New deck's step 4, on this venture.
  assert.equal(proposalHref('/raise/pitch/new', '?project_id=7', 55), '/raise/pitch/new?project_id=7&proposal=55');
  assert.equal(proposalHref('/raise/pitch/new', '', 55), '/raise/pitch/new?proposal=55');
  // A refused fill names its fix.
  assert.deepEqual(fillRefusal({ status: 409 }, '/raise/pitch/new?project_id=7').link, { href: '/raise/pitch/new?project_id=7', text: 'New deck ›' });
  assert.equal(fillRefusal({ status: 500, message: 'Synthetic outage.' }).message, 'The fill did not run. Nothing changed. Synthetic outage.');
});

/* ------------------------------------------------------------------ *
 * 2. Recommended, on New deck's Start from
 * ------------------------------------------------------------------ */

test('the recommended template is marked, first among the templates, with its reason', () => {
  const methods = [{ id: 'minimal_seed', label: 'Minimal' }, { id: 'yc_seed', label: 'YC Seed' }, { id: 'sequoia_classic', label: 'Sequoia', locked: true }];
  const options = startOptions([{ id: 40, version: 4 }], methods);
  const marked = markRecommended(options, { method_id: 'yc_seed', sector: 'Fintech', stage: 'pre_seed', source: 'sector' });
  // Mutation checked: skip the move → the recommended template stays second.
  assert.deepEqual(marked.map((o) => o.id), ['blank', 40, 'yc_seed', 'minimal_seed', 'sequoia_classic']);
  assert.deepEqual(marked.filter((o) => o.recommended).map((o) => [o.id, o.reason]), [['yc_seed', 'Fits a Fintech venture at pre-seed.']]);
  // A template the account cannot start, or one not offered, marks nothing.
  assert.equal(markRecommended(options, { method_id: 'not_a_template' }), options);
  assert.equal(markRecommended(options, null), options);
  assert.ok(markRecommended(options, { method_id: 'sequoia_classic', stage: 'seed', source: 'stage_default' }).find((o) => o.id === 'sequoia_classic').recommended);
});

test('why a template is recommended; a stage nobody recorded is said so, never shown as a stage', () => {
  assert.equal(recommendReason({ method_id: 'x', sector: 'Climate', stage: 'seed', source: 'override' }), 'HQ\'s default template for Climate at seed.');
  assert.equal(recommendReason({ method_id: 'x', sector: '', stage: 'series_a', source: 'stage_default' }), 'The usual template at Series A.');
  // Mutation checked: read `unknown` as a stage → "The usual template at unknown."
  assert.equal(recommendReason({ method_id: 'minimal_seed', sector: '', stage: 'unknown', source: 'stage_default' }), 'Your venture\'s stage is not recorded, so this is the plainest template.');
  assert.equal(recommendReason(null), null);
  const src = codeOnly(read('src/pages/raise/pitch/NewDeck.jsx'));
  assert.match(src, /useRead\(\(\) => api\.deckRecommend\(projectId\), \[projectId\]\)/);
  assert.match(src, /markRecommended\(startOptions\(/);
  assert.match(src, /data-testid="pitch-new-recommended-reason">Recommended: \{o\.label\}\. \{o\.reason\}/);
});

/* ------------------------------------------------------------------ *
 * 3. Spin-Out readiness
 * ------------------------------------------------------------------ */

test('a Spin-Out deck is one carrying the Spin-Out template, on the deck or on a card', () => {
  assert.equal(isSpinoutDeck({ method_id: SPINOUT_METHOD }), true);
  assert.equal(isSpinoutDeck(SPINOUT), true, 'slides as the Worker stores them, a string');
  assert.equal(isSpinoutDeck({ slides: [{ method_id: SPINOUT_METHOD }] }), true);
  assert.equal(isSpinoutDeck(DECK), false);
  assert.equal(isSpinoutDeck({ slides: 'not json' }), false);
  assert.equal(isSpinoutDeck(null), false);
});

test('readiness: the draft flag decides, never the gaps alone; a program day nobody recorded says so', () => {
  const gaps = readinessView({ gaps: ['Market sizing', 'Cap table', ''], draft: true, program_day: 12 });
  assert.deepEqual([gaps.state, gaps.title, gaps.gaps], ['gaps', '2 sections still empty', ['Market sizing', 'Cap table']]);
  assert.match(gaps.line, /^Spin-Out Lab · Day 12 of 28\./);
  // Mutation checked: decide from gaps alone → a mid-program deck reads ready.
  const draft = readinessView({ gaps: [], draft: true, program_day: 20 });
  assert.deepEqual([draft.state, draft.title], ['draft', 'All sections filled']);
  const ready = readinessView({ gaps: [], draft: false, program_day: null });
  assert.deepEqual([ready.state, ready.title], ['ready', 'Deck is ready']);
  assert.match(ready.line, /^Program day: Not recorded\./);
  assert.equal(readinessView(null).state, 'hidden');
});

async function mountWith(element, stubs) {
  const original = { ...api };
  Object.assign(api, stubs);
  const m = await mountContracts(element, '/raise/pitch?project_id=7');
  for (let i = 0; i < 3; i += 1) await m.flush();
  const byId = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  return { ...m, byId, async close() { await m.unmount(); Object.assign(api, original); } };
}

test('the readiness card reads the preview for a Spin-Out deck only, and a failed read offers Try again', async () => {
  const calls = [];
  const preview = async (pid) => { calls.push(pid); return { gaps: ['Market sizing'], draft: true, program_day: 9 }; };
  let m = await mountWith(h(SpinoutReadiness, { projectId: 7, deck: DECK }), { spinoutDeckPreview: preview });
  try {
    assert.equal(m.text(), '', 'another deck draws nothing');
    assert.deepEqual(calls, [], 'and reads nothing');
  } finally { await m.close(); }
  m = await mountWith(h(SpinoutReadiness, { projectId: 7, deck: SPINOUT }), { spinoutDeckPreview: preview });
  try {
    assert.deepEqual(calls, [7]);
    assert.ok(m.text().includes('1 section still empty'));
    assert.ok(m.text().includes('Market sizing'));
    assert.ok(m.text().includes('Draft'));
  } finally { await m.close(); }
  m = await mountWith(h(SpinoutReadiness, { projectId: 7, deck: SPINOUT }), { spinoutDeckPreview: async () => { throw Object.assign(new Error('Synthetic outage'), { status: 500 }); } });
  try {
    assert.ok(m.byId('pitch-studio-readiness-error'));
    assert.ok(m.text().includes('Readiness could not be read.'));
    assert.ok(m.text().includes('Try again'));
    assert.ok(!m.text().includes('Deck is ready'), 'a failed read never reads as ready');
  } finally { await m.close(); }
});

/* ------------------------------------------------------------------ *
 * 4. Branding and the watermark
 * ------------------------------------------------------------------ */

test('branding lines from the methods read; a plan nobody recorded says so', () => {
  assert.deepEqual(brandingView({ user_tier: 'studio', can_remove_footer: true, can_upload_watermark: true, watermark_url: 'https://example.test/m.png' }),
    { plan: 'Studio', footer: 'The Axal VC footer is off on your exports.', canWatermark: true, watermark: 'https://example.test/m.png' });
  const free = brandingView({ user_tier: 'free' });
  assert.deepEqual([free.plan, free.canWatermark, free.watermark], ['Free', false, null]);
  assert.equal(free.footer, 'Your exports carry the Axal VC footer.');
  assert.equal(brandingView({}).plan, 'Not recorded');
  assert.equal(brandingView(null), null);
  // The address: https only, as the Worker's own check.
  assert.equal(watermarkInput('  https://example.test/m.png '), 'https://example.test/m.png');
  assert.equal(watermarkInput(''), '');
  for (const bad of ['http://example.test/m.png', 'not a url', `https://example.test/${'a'.repeat(1000)}`]) assert.equal(watermarkInput(bad), null, bad);
  assert.match(watermarkSentence('https://example.test/m.png', null), /^Your exports carry this watermark on every venture: https:\/\/example\.test\/m\.png\. This is one line on this venture's activity\.$/);
  assert.match(watermarkSentence(null, 'https://example.test/m.png'), /^Your exports stop carrying a watermark/);
});

test('a Studio plan saves the watermark only after its dialog, naming the venture; a reader and a free plan get no input', async () => {
  const writes = [];
  const methods = async () => ({ user_tier: 'studio', can_remove_footer: true, can_upload_watermark: true, watermark_url: '' });
  const set = async (url, pid) => { writes.push([url, pid]); return { brand: { watermark_url: url || null } }; };
  let m = await mountWith(h(BrandingCard, { projectId: 7, readOnly: false }), { deckMethods: methods, deckSetWatermark: set });
  try {
    assert.ok(m.text().includes('Plan: Studio'));
    assert.ok(m.text().includes('No watermark.'));
    await m.fill('Watermark image address', 'http://example.test/m.png');
    assert.ok(m.text().includes(WATERMARK_BAD));
    assert.equal(m.props(m.byId('pitch-studio-watermark-save')).disabled, true, 'an address the Worker refuses cannot be saved');
    await m.fill('Watermark image address', 'https://example.test/m.png');
    await act(async () => { m.props(m.byId('pitch-studio-watermark-save')).onClick(); });
    // Mutation checked: save on press → a write before the dialog.
    assert.deepEqual(writes, [], 'nothing is written before the dialog is confirmed');
    assert.ok(m.byId('pitch-studio-watermark-dialog'));
    assert.ok(m.text().includes('This is one line on this venture\'s activity.'));
    await act(async () => { m.props(m.byId('pitch-studio-watermark-dialog-confirm')).onClick(); });
    for (let i = 0; i < 3; i += 1) await m.flush();
    // Mutation checked: drop `projectId` from the save → the Worker writes no ledger line.
    assert.deepEqual(writes, [['https://example.test/m.png', 7]]);
    assert.ok(m.text().includes('Watermark: https://example.test/m.png'));
    assert.equal(m.byId('pitch-studio-watermark-dialog'), undefined, 'the dialog closes on save');
  } finally { await m.close(); }

  m = await mountWith(h(BrandingCard, { projectId: 7, readOnly: true }), { deckMethods: methods, deckSetWatermark: set });
  try {
    assert.equal(m.byId('pitch-studio-watermark-input'), undefined, 'an admin reads the plan and changes nothing');
  } finally { await m.close(); }
  m = await mountWith(h(BrandingCard, { projectId: 7, readOnly: false }), { deckMethods: async () => ({ user_tier: 'growth', can_remove_footer: true, can_upload_watermark: false }), deckSetWatermark: set });
  try {
    assert.equal(m.byId('pitch-studio-watermark-input'), undefined);
    assert.ok(m.text().includes(WATERMARK_PLAN));
  } finally { await m.close(); }
  m = await mountWith(h(BrandingCard, { projectId: 7, readOnly: false }), { deckMethods: async () => { throw new Error('Synthetic outage'); }, deckSetWatermark: set });
  try {
    assert.ok(m.byId('pitch-studio-branding-error'));
    assert.ok(!m.text().includes('Plan:'), 'a failed read shows no plan');
  } finally { await m.close(); }
  assert.equal(writes.length, 1);
});

test('the client names the venture on the save; readiness sits on the home, Branding behind its ⋯ › Brand kit', () => {
  const api = read('src/lib/api.js');
  assert.match(api, /deckSetWatermark: \(url, projectId\) => request\('\/decks\/brand\/watermark', \{ method: 'PUT', body: JSON\.stringify\(\{ watermark_url: url, \.\.\.\(projectId \? \{ project_id: projectId \} : \{\}\) \}\) \}\)/);
  const html = decks(reads());
  // D1604 (#3716, pd1): Branding moved into ⋯ › Brand kit (`BrandKitSheet` mounts the same card).
  assert.doesNotMatch(html, /data-testid="pitch-studio-branding"/);
  const home = read('src/pages/raise/pitch/StudioHome.jsx');
  assert.match(home, /\{ id: 'brand', label: 'Brand kit' \}/);
  assert.match(home, /<BrandKitSheet projectId=\{projectId\}/);
  assert.match(read('src/pages/raise/pitch/DeckSheets.jsx'), /<BrandingCard projectId=\{projectId\} readOnly=\{readOnly\} \/>/);
  assert.doesNotMatch(html, /data-testid="pitch-studio-readiness"/, 'not a Spin-Out deck');
  assert.match(decks(reads({ deck: ok(SPINOUT) })), /data-testid="pitch-studio-readiness"/);
});
