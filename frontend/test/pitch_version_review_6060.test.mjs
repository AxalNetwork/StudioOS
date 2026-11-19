/**
 * D6060 (#6060, Pitch Studio v2 build 6/9, PS-06) — Review of one exact saved
 * version: six groups, no readiness score, each finding linked to its card,
 * "Couldn't check" never a pass, and D6066's "intentionally qualitative" mark
 * read as "Qualitative by choice" while the card's figures are still checked.
 * The Worker half (the mark kept on the card, left out of every outside
 * reader) is `cloudflare-worker/test/deck_qualitative_d6060.test.ts`.
 *
 * Every name and figure is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_version_review_6060.test.mjs
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
import { cyclesApi } from '../src/lib/api/cycles.js';
import { deckFiguresApi } from '../src/lib/api/deckFigures.js';
import { deckCheckApi } from '../src/lib/api/deckCheck.js';
import { deckCommentsApi } from '../src/lib/api/deckComments.js';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { deckPreflightApi } from '../src/lib/api/deckPreflight.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PitchStudio from '../src/pages/raise/pitch/PitchStudio.jsx';
import { cardMenuItems } from '../src/pages/raise/pitch/CardsStrip.jsx';
import { runPreflight } from '../src/pages/raise/pitch/preflightModel.js';
import { groupsOf } from '../src/pages/raise/pitch/preflightUiModel.js';
import {
  CLEAR_MARK, MARK, NO_SCORE, NO_VERSION, STATUS,
  actionOf, cardHref, checkingLine, countPills, isQualitative, reviewOf, withQualitative,
} from '../src/pages/raise/pitch/versionReviewModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const ok = (data) => ({ status: 'ok', data });
const failed = { status: 'error', data: null };
const heading = (t, id = 'b1') => ({ id, kind: 'text', style: 'heading', text: t, grid: { c1: 1, c2: 12, r1: 1, r2: 1 } });
const metric = (v, id = 'b2') => ({ id, kind: 'metric', label: 'ARR', value: v, grid: { c1: 1, c2: 6, r1: 2, r2: 4 } });
const deckOf = (slides, theme = null) => ({ id: 41, version: 4, slides, theme });
const measured = (slides) => Object.fromEntries(slides.flatMap((s, i) => (s.blocks || []).filter((b) => b.kind === 'text').map((b) => [`${i}:${b.id}`, { clipped: false, font_px: 64 }])));
/** The preflight as Review runs it: `runPreflight` on the saved version, then `groupsOf`. */
function pfOf(deck, { failedSlides = [], measure = true } = {}) {
  const result = runPreflight(deck, { measurements: measure ? measured(deck.slides) : null });
  const groups = groupsOf(result, { slides: deck.slides, failed: failedSlides });
  return { state: 'done', groups, checks: result.checks, dismissed: groups.dismissed, kitFailed: false };
}
const linked = (card) => ({ card, block_id: 'b2', kind: 'metric', label: 'ARR', value: '€410k', state: 'linked', source: { label: 'Revenue', as_of: '2026-10-01' } });
const backed = (slide) => ({ uid: `c${slide}`, slide, label: 'ARR', state: 'backed', display_state: 'backed', record: { provider: 'stripe', shown: '€410k' } });
const cleanReads = (cards) => ({
  figures: ok({ figures: cards.map(linked) }),
  check: ok({ checked: true, can_check: true, claims: cards.map((c) => backed(c + 1)), consistency: { state: 'ok', findings: [] } }),
  refresh: ok({ rows: cards.map((c) => ({ slide: c, state: 'fresh' })) }),
  approval: ok({ approvers: [{ user_id: 3, name: 'Synthetic Approver', approved: true, approved_at: '2026-11-01 10:00:00' }] }),
});
const rowsOf = (review) => review.groups.flatMap((g) => g.rows.map((r) => ({ ...r, group: g.key })));

const CLEAN = [
  { title: 'Synthetic cover', blocks: [heading('Synthetic seed'), metric('€410k')] },
  { title: 'Synthetic traction', blocks: [heading('Synthetic traction'), metric('€410k')] },
  { title: 'Synthetic market', blocks: [heading('Synthetic market'), metric('€410k')] },
];

test('6060 pass: a clean saved version reads Passed in every group, with no score and nothing counted but Passed', () => {
  // Mutations checked: count a linked figure as To fix; drop the consistency pass; read a waiting approver as approved.
  const deck = deckOf(CLEAN);
  const review = reviewOf({ deck, ...cleanReads([0, 1, 2]), pf: pfOf(deck) });
  assert.deepEqual(review.groups.map((g) => g.title), ['Completeness', 'Evidence & freshness', 'Readability & layout', 'Technical preflight', 'Disclosure & legal', 'Approvals']);
  const rows = rowsOf(review);
  assert.deepEqual(rows.filter((r) => r.status !== 'passed').map((r) => `${r.group}: ${r.title}`), []);
  for (const g of review.groups) assert.ok(g.rows.length > 0, `${g.title} says what it checked`);
  assert.ok(rows.some((r) => r.title === '3 figures linked to their records'));
  assert.ok(rows.some((r) => r.title === 'Figures agree across cards'));
  assert.ok(rows.some((r) => r.title === 'Approved by Synthetic Approver'));
  assert.deepEqual(countPills(review.counts).map((p) => p.key), ['passed']);
  assert.equal(actionOf(rows[0]), null, 'a pass offers no action');
  assert.doesNotMatch(JSON.stringify(review), /score/i, 'no readiness score anywhere in the review');
  assert.match(NO_SCORE, /^No readiness score/);
});

test('6060 finding: an unsourced figure is To fix on its card, and the row links to that card in the Editor', () => {
  // Mutations checked: read an uncited figure as Passed; link the card counted from 0; drop the venture from the link.
  const deck = deckOf(CLEAN);
  const reads = cleanReads([0, 2]);
  reads.figures = ok({ figures: [linked(0), { card: 1, block_id: 'b2', kind: 'metric', label: 'ARR', value: '€410k', state: 'uncited' }, linked(2)] });
  const review = reviewOf({ deck, ...reads, pf: pfOf(deck) });
  const fix = rowsOf(review).filter((r) => r.status === 'fix');
  assert.equal(fix.length, 1);
  assert.equal(fix[0].group, 'evidence');
  assert.equal(fix[0].card, 1);
  assert.match(fix[0].title, /^Card 2 · Synthetic traction: ARR · €410k$/);
  assert.match(fix[0].detail, /No source/);
  assert.deepEqual(actionOf(fix[0]), { kind: 'card', label: 'Go to card' });
  assert.equal(cardHref(7, fix[0].card), '/raise/pitch/edit?project_id=7&card=2');
  assert.equal(review.counts.fix, 1);
  assert.deepEqual(countPills(review.counts).map((p) => p.label).slice(0, 1), ['1 to fix']);
  // Every finding names a card or says what to do: none is a bare line.
  for (const r of rowsOf(review).filter((x) => !['passed', 'running'].includes(x.status))) assert.ok(actionOf(r), `${r.title} offers an action`);
});

test('6060 could-not-check: a failed read, a check never run and a card the page could not draw are Couldn’t check, never Passed', () => {
  // Mutations checked: count a failed read as Passed; treat checked:false as a pass; let a failed slide's overflow pass.
  const deck = deckOf(CLEAN);
  const reads = cleanReads([0, 1, 2]);
  reads.figures = failed;
  reads.check = ok({ checked: false, can_check: true, claims: [] });
  reads.approval = failed;
  const review = reviewOf({ deck, ...reads, pf: pfOf(deck, { failedSlides: [1], measure: false }), canCheck: true });
  const rows = rowsOf(review);
  const by = (id) => rows.find((r) => r.id === id);
  assert.equal(by('figures').status, 'unchecked');
  assert.deepEqual(actionOf(by('figures')), { kind: 'retry', label: 'Try again', read: 'figures' });
  assert.equal(by('check').status, 'unchecked');
  assert.deepEqual(actionOf(by('check')), { kind: 'run-check', label: 'Run the check' });
  assert.equal(by('approval').status, 'unchecked');
  const slide = rows.filter((r) => r.id === 'pf:slide:1');
  assert.deepEqual(slide.map((r) => [r.group, r.status, r.card]), [['readability', 'unchecked', 1], ['preflight', 'unchecked', 1]]);
  assert.deepEqual(actionOf(slide[0]), { kind: 'remeasure', label: 'Try again', card: 1 });
  // Clipped content was not measured: it is not among the passes.
  assert.equal(rows.some((r) => r.id === 'pf:pass:overflow'), false);
  assert.equal(rows.filter((r) => r.status === 'unchecked').every((r) => STATUS[r.status] === 'Couldn’t check'), true);
  assert.equal(review.counts.unchecked, rows.filter((r) => r.status === 'unchecked').length);
  assert.ok(review.counts.unchecked >= 5);
  assert.equal(review.counts.passed, rows.filter((r) => r.status === 'passed').length, 'nothing unchecked is counted as Passed');
  // A reader who may not run the check is told so, and offered no run.
  const reader = reviewOf({ deck, ...reads, pf: pfOf(deck), canCheck: false });
  assert.equal(actionOf(rowsOf(reader).find((r) => r.id === 'check')), null);
});

test('6060 qualitative by choice: a marked card is never a gap and never evidence, and its figures are still checked', () => {
  // Mutations checked: ask a marked card for a figure; count the mark as Passed; skip a marked card's figures.
  const slides = [
    { title: 'Synthetic vision', qualitative: true, blocks: [heading('Synthetic vision')] },
    { title: 'Synthetic team', qualitative: true, blocks: [heading('Synthetic team'), metric('40 people')] },
    { title: 'Synthetic problem', blocks: [heading('Synthetic problem')] },
  ];
  const deck = deckOf(slides);
  const reads = cleanReads([]);
  reads.figures = ok({ figures: [{ card: 1, block_id: 'b2', kind: 'metric', label: 'Team', value: '40 people', state: 'uncited' }] });
  const review = reviewOf({ deck, ...reads, pf: pfOf(deck) });
  const rows = rowsOf(review);
  const marked = rows.filter((r) => r.status === 'qualitative');
  assert.deepEqual(marked.map((r) => [r.group, r.card, r.title]), [['evidence', 0, 'Card 1 · Synthetic vision'], ['evidence', 1, 'Card 2 · Synthetic team']]);
  assert.equal(STATUS.qualitative, 'Qualitative by choice');
  assert.match(marked[0].detail, /not evidence/);
  assert.match(marked[1].detail, /Its 1 figure is still checked here\./);
  assert.equal(rows.some((r) => r.id === 'nofigure:0' || r.id === 'nofigure:1'), false, 'a marked card is not asked for a figure');
  assert.equal(rows.find((r) => r.id === 'nofigure:2')?.status, 'look', 'an unmarked card with no figure still is');
  const figure = rows.find((r) => r.id.startsWith('figure:1:'));
  assert.equal(figure.status, 'fix', 'the marked card\'s unsourced figure is still To fix');
  assert.equal(rows.some((r) => r.id === 'linked'), false, 'the mark never counts as a linked figure');
  assert.equal(review.counts.qualitative, 2);
  assert.equal(countPills(review.counts).find((p) => p.key === 'qualitative').label, '2 qualitative by choice');
  // The Editor's card menu sets and clears it; unmarked is the field absent.
  assert.equal(cardMenuItems(0, 3, {}).find((i) => i.id === 'qualitative').label, MARK);
  assert.equal(cardMenuItems(0, 3, { qualitative: true }).find((i) => i.id === 'qualitative').label, CLEAR_MARK);
  assert.deepEqual(withQualitative({ title: 'x' }, true), { title: 'x', qualitative: true });
  assert.deepEqual(withQualitative({ title: 'x', qualitative: true }, false), { title: 'x' });
  assert.equal(isQualitative({ qualitative: 'yes' }), false);
  const editor = read('frontend/src/pages/raise/pitch/PitchEditor.jsx');
  assert.match(editor, /id === 'qualitative' && cards\[i\]\) edit\(\{ type: 'setFlag', index: i, key: 'qualitative', value: isQualitative\(cards\[i\]\) \? undefined : true \}/);
});

test('6060 disclosure: a projection with the notice turned off is To fix on its card; the notice\'s words are not this build\'s', () => {
  // Mutations checked: read the deck's turned-off notice as on.
  const proj = { title: 'Synthetic plan', blocks: [heading('Synthetic plan'), { ...metric('€2m'), binding: { source_key: 'raise.projection_revenue', grade: 'Projected', as_of: '2026-11-01' } }] };
  const deck = deckOf([CLEAN[0], proj], { kind: 'brand', background: null, compliance_fls: false });
  const rows = rowsOf(reviewOf({ deck, ...cleanReads([0, 1]), pf: pfOf(deck) })).filter((r) => r.group === 'disclosure');
  assert.deepEqual(rows.filter((r) => r.status === 'fix').map((r) => r.card), [1]);
  const on = rowsOf(reviewOf({ deck: deckOf([CLEAN[0], proj]), ...cleanReads([0, 1]), pf: pfOf(deck) })).filter((r) => r.group === 'disclosure');
  assert.deepEqual(on.map((r) => [r.status, r.title]), [['passed', 'Forward-looking notice on card 2'], ['passed', 'Confidential on every card']]);
  assert.doesNotMatch(read('frontend/src/pages/raise/pitch/versionReviewModel.js'), /may not be achieved/, 'the footnote is complianceModel\'s, never restated');
});

// ─────────────────────────────────────────────────────────── the page

const versions = { versions: [{ id: 41, version: 4, title: 'Synthetic seed', is_current: 1, created_at: '2026-10-21 09:00:00' }] };
const SAVED = { id: 41, version: 4, title: 'Synthetic seed', theme: null, slides: [
  { title: 'Synthetic cover', blocks: [heading('Synthetic seed')] },
  { title: 'Synthetic traction', blocks: [heading('Synthetic traction'), metric('€410k')] },
] };
const MODULES = { deckFiguresApi, deckCheckApi, deckCommentsApi, deckEditorApi, deckSourcesApi, deckPreflightApi };
const ORIGINAL = { api: { ...api }, deckReviewer: { ...api.deckReviewer }, cycles: { ...cyclesApi }, ...Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, { ...m }])) };

async function mount({ list = versions, deck = SAVED } = {}) {
  const calls = [];
  const note = (name, fn) => (...a) => { calls.push([name, ...a]); return fn(...a); };
  Object.assign(api, {
    listProjects: async () => [{ id: 7, name: 'Synthetic venture' }],
    deckListVersions: async () => list,
    deckGet: async () => deck,
    deckEngagement: async () => ({ deck_id: 41, views: [], shares: [] }),
    deckReviews: async () => ({ viewer: 'founder', reviews: [] }),
  });
  api.deckReviewer = { ...api.deckReviewer, list: async () => ({ reviews: [] }) };
  cyclesApi.module = async () => ({ card: null, records: null });
  deckFiguresApi.list = note('figures', async () => ({ figures: [{ card: 1, block_id: 'b2', kind: 'metric', label: 'ARR', value: '€410k', state: 'uncited' }] }));
  deckCheckApi.read = note('check', async () => ({ checked: false, can_check: true, claims: [] }));
  deckSourcesApi.refresh = note('refresh', async () => ({ rows: [] }));
  deckCommentsApi.approval = note('approval', async () => ({ approvers: [] }));
  deckCommentsApi.list = async () => ({ comments: [], viewer: { user_id: 1 } });
  deckEditorApi.brandKit = note('kit', async () => ({ kit: null }));
  deckPreflightApi.dismissals = async () => ({ dismissed: [] });
  api.getMe = async () => ({ id: 1, role: 'founder' });
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder' }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => { rootEl.render(h(MemoryRouter, { initialEntries: ['/raise/pitch/review?project_id=7'] }, h(AuthProvider, null, h(PitchStudio, { tab: 'review' })))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, all, pr, by: (id) => all(id)[0], ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    /** Until the preflight has measured every card (each card is drawn off screen in turn). */
    async measured() {
      for (let i = 0; i < 2000 && all('pitch-version-review-row').some((n) => pr(n)['data-status'] === 'running'); i += 1) {
        await act(async () => { await new Promise((r) => setImmediate(r)); });
      }
    }, within: (node, id) => walk(node).filter((n) => pr(n)['data-testid'] === id), text: (n) => text(n).replace(/\s+/g, ' ').trim(),
    async unmount() {
      await act(async () => rootEl.unmount()); restore();
      Object.assign(api, ORIGINAL.api); api.deckReviewer = ORIGINAL.deckReviewer; Object.assign(cyclesApi, ORIGINAL.cycles);
      for (const [k, m] of Object.entries(MODULES)) Object.assign(m, ORIGINAL[k]);
    },
  };
}

test('6060 page: Review names the version it checked, reads that version only, and links each finding to its card', async () => {
  // Mutations checked: read the figures of another deck id; drop the version line; drop Go to card.
  const m = await mount();
  try {
    await m.measured();
    assert.equal(m.text(m.by('pitch-version-review-version')), 'v4 · saved 21 Oct, 09:00');
    assert.equal(checkingLine({ version: 4 }, null), 'v4');
    for (const name of ['figures', 'check', 'refresh', 'approval']) {
      const ids = m.calls.filter((c) => c[0] === name).map((c) => c[1]);
      assert.ok(ids.length >= 1, `${name} is read`);
      assert.deepEqual([...new Set(ids)], [41], `${name} is read for v4 alone`);
    }
    assert.match(m.text(m.by('pitch-version-review-no-score')), /^No readiness score/);
    const rows = m.all('pitch-version-review-row');
    const fix = rows.filter((n) => m.pr(n)['data-status'] === 'fix');
    assert.equal(fix.length, 1);
    assert.equal(m.pr(fix[0])['data-card'], 2);
    const go = m.within(fix[0], 'pitch-version-review-go');
    assert.equal(go.length, 1);
    assert.equal(m.pr(go[0]).href ?? go[0].getAttribute?.('href'), '/raise/pitch/edit?project_id=7&card=2');
    // The page here cannot draw a card at export size: every such card is Couldn't check, with Try again, never Passed.
    const unmeasured = rows.filter((n) => /couldn’t be measured/.test(m.text(n)));
    assert.ok(unmeasured.length >= 1);
    for (const n of unmeasured) assert.equal(m.pr(n)['data-status'], 'unchecked');
    assert.equal(rows.some((n) => m.pr(n)['data-status'] === 'passed' && /Clipped content/.test(m.text(n))), false);
    // The check never ran on v4: offered to the founder, counted under Couldn't check.
    assert.ok(m.by('pitch-version-review-run-check'));
    assert.match(m.text(m.by('pitch-version-review-count-unchecked')), /couldn’t check/);
    assert.match(m.text(m.by('pitch-review-current')), /AI review of v4/);
  } finally { await m.unmount(); }
});

test('6060 no saved version: the page says so and checks nothing', async () => {
  // Mutations checked: draw the Review with no version.
  const m = await mount({ list: { versions: [] } });
  try {
    assert.equal(m.text(m.by('pitch-review-no-deck')), NO_VERSION);
    assert.deepEqual(m.ids().filter((id) => id.startsWith('pitch-version-review')), [], 'no Review, no skeleton, no error for a version that does not exist');
    assert.deepEqual(m.calls.filter((c) => ['figures', 'check', 'refresh', 'approval'].includes(c[0])), []);
  } finally { await m.unmount(); }
});

test('6060 freshness: a moved or vanished bound figure is Stale on its card, an unknown one is Couldn’t check, and a stale claim is Stale', () => {
  // Mutations checked: read a stale claim as Passed; drop the unknown-freshness row; let a later "stale" row hide an earlier "gone" on the same card.
  const deck = deckOf(CLEAN);
  const reads = cleanReads([0, 1, 2]);
  reads.check.data.claims[0] = { ...backed(1), state: 'stale', display_state: 'stale' };
  reads.refresh = ok({ rows: [{ slide: 1, state: 'gone' }, { slide: 1, state: 'stale' }, { slide: 2, state: 'stale' }, { slide: 0, state: 'unknown' }] });
  const rows = rowsOf(reviewOf({ deck, ...reads, pf: pfOf(deck) }));
  const stale = rows.filter((r) => r.status === 'stale').map((r) => `${r.card}: ${r.title}`);
  assert.deepEqual(stale, [
    '0: Card 1 · Synthetic cover: ARR · €410k',
    '1: Card 2 · Synthetic traction: a bound figure is no longer in its store',
    '2: Card 3 · Synthetic market: a bound figure has changed in its store',
  ]);
  const unknown = rows.filter((r) => r.id === 'fresh:unknown');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].status, 'unchecked');
  assert.equal(rows.some((r) => r.title === 'Every bound figure is current'), false, 'nothing moved is not claimed when something did');
});

test('6060 Done: "Every card is Done" is said only on a deck whose cards carry a status', () => {
  // Mutations checked: claim every card Done on a deck nobody tracks.
  const untracked = rowsOf(reviewOf({ deck: deckOf(CLEAN), ...cleanReads([0, 1, 2]), pf: pfOf(deckOf(CLEAN)) }));
  assert.equal(untracked.some((r) => r.id === 'done'), false);
  const tracked = CLEAN.map((s) => ({ ...s, status: 'done' }));
  const rows = rowsOf(reviewOf({ deck: deckOf(tracked), ...cleanReads([0, 1, 2]), pf: pfOf(deckOf(tracked)) }));
  assert.equal(rows.find((r) => r.id === 'done')?.status, 'passed');
});
