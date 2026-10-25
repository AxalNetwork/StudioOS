/**
 * D902 (#2681) — Pitch deck studio part 8: the share dialog (PD18), the
 * investor's viewer (PD20, PD22) and Share & analytics per version (PD19).
 *
 * What this file holds the frontend to:
 *   · one link writer: the editor's Share and the studio's "New link" open one
 *     dialog, and it writes through `cyclesWrite.raise.deckLink` with one body;
 *   · the dialog's defaults are the canvas's (14 days, Download and Forwarding
 *     off, the NDA on, figures and sources in) and it says what it writes
 *     before it writes; the link is shown once, and only a path the writer
 *     returned becomes one;
 *   · the viewer: a closed link shows the sentence and who to ask and nothing
 *     from the deck; the NDA gate shows the text and Accept and open, or Sign
 *     in; each figure carries the chip of its recorded source;
 *   · analytics per version: seconds per card with the version before dotted,
 *     a funnel over unique viewers with "Reached the ask", and a version with
 *     no ask card says so rather than drawing 0.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_share_d902.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { api } from '../src/lib/api.js';
import { cyclesWrite } from '../src/lib/api/cycles.js';
import ShareDialog from '../src/pages/raise/pitch/ShareDialog.jsx';
import { ClosedLink, FigureSources, NdaGate } from '../src/pages/raise/pitch/ShareViewerParts.jsx';
import { StudioAnalytics } from '../src/pages/raise/pitch/PitchStudio.jsx';
import {
  DEFAULT_INCLUDE, DEFAULT_SHARE, EXPIRIES, INCLUDE_ROWS, LINK_CLOSED, NDA_SWITCH, NEVER_SHARED, NO_DECK, TYPED,
  analyticsOf, cardSeries, chipOf, closedCard, figureChips, frozenLine, ndaCell, settingsLine, shareBody, shareFailure, shareFunnel,
  shareProblem, shareUrl, viewLimitOf, viewerNote, viewerState, whatShareDoes,
} from '../src/pages/raise/pitch/shareModel.js';
import { NOT_RECORDED as NOT_RECORDED_CHIP } from '../src/lib/absence.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const draw = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

const deck = { id: 40, version: 4, created_at: '2026-10-21 09:00:00' };

/* ------------------------------------------------------------------ *
 * The dialog's model
 * ------------------------------------------------------------------ */

test('the dialog\'s defaults are the canvas\'s: 14 days, Download and Forwarding off, the NDA on, figures and sources in', () => {
  assert.equal(DEFAULT_SHARE.expires, 14);
  assert.deepEqual([DEFAULT_SHARE.allowDownload, DEFAULT_SHARE.allowForwarding, DEFAULT_SHARE.ndaRequired], [false, false, true]);
  assert.deepEqual(DEFAULT_INCLUDE, { figures: true, sources: true, notes: false, bands: false });
  assert.deepEqual(EXPIRIES.map((x) => x.id), [7, 14, 30, null]);
  assert.deepEqual(INCLUDE_ROWS.map((r) => r.label), ['Figures with chips', 'Sources appendix', 'Speaker notes', 'Scorecard and Product-market fit bands']);
  assert.ok(!INCLUDE_ROWS.some((r) => /bank|account|score\b|quote/i.test(r.key)), 'what is never shared has no switch');
});

test('a view limit is a whole number 1–100 or empty; anything else stops Create link', () => {
  assert.equal(viewLimitOf(''), null);
  assert.equal(viewLimitOf('  '), null);
  assert.equal(viewLimitOf('1'), 1);
  assert.equal(viewLimitOf('100'), 100);
  for (const bad of ['0', '101', '2.5', '-1', 'ten', '1e2']) assert.ok(Number.isNaN(viewLimitOf(bad)), bad);
  const ok = { ...DEFAULT_SHARE, investor: '5' };
  assert.equal(shareProblem(ok, deck), null);
  assert.equal(shareProblem(ok, null), NO_DECK);
  assert.match(shareProblem({ ...ok, investor: '' }, deck), /Name the investor/);
  assert.match(shareProblem({ ...ok, investor: TYPED, label: '  ' }, deck), /Type the investor's name/);
  assert.match(shareProblem({ ...ok, viewLimit: '101' }, deck), /1 to 100/);
});

test('one body for the one writer: a prospect or a typed name, never both', () => {
  const prospect = shareBody({ ...DEFAULT_SHARE, investor: '5', viewLimit: '3' }, deck);
  assert.deepEqual(prospect, {
    deck_id: 40, expires_days: 14, view_limit: 3, allow_download: false, allow_forwarding: false, nda_required: true,
    include: { figures: true, sources: true, notes: false, bands: false }, prospect_id: 5,
  });
  const typed = shareBody({ ...DEFAULT_SHARE, investor: TYPED, label: ' Fund Z ', expires: null, ndaRequired: false }, deck);
  assert.equal(typed.investor_label, 'Fund Z');
  assert.equal('prospect_id' in typed, false);
  assert.equal(typed.expires_days, null, 'Never is no expiry, not 0 days');
  assert.equal(typed.view_limit, null);
  assert.equal(typed.nda_required, false);
});

test('the dialog says what Create link writes before it writes, and the link it shows is only the writer\'s path', () => {
  assert.equal(
    whatShareDoes({ ...DEFAULT_SHARE, viewLimit: '1' }, deck, 'Fund A'),
    'Creates one link to v4 for Fund A. It expires in 14 days and opens once. It asks for the NDA before any card shows. Every link is logged on the deck.',
  );
  assert.match(whatShareDoes({ ...DEFAULT_SHARE, expires: null, ndaRequired: false }, deck), /for this investor\. It never expires and has no view limit\. Every link/);
  assert.equal(frozenLine(deck), 'Frozen at v4 as of 21 Oct');
  assert.equal(shareUrl({ share_path: '/share/deck/abc.DEF_1-2' }, 'https://axal.vc'), 'https://axal.vc/share/deck/abc.DEF_1-2');
  for (const path of [null, '', 'https://evil.example/x', '/share/deck/a b', '/share/deck/../x/y', '//evil.example/share/deck/x']) {
    assert.equal(shareUrl({ share_path: path }, 'https://axal.vc'), null, String(path));
  }
  assert.equal(shareFailure({ status: 400, data: { detail: 'include has an unknown key' } }), 'include has an unknown key No link was made.');
  assert.equal(shareFailure(new Error('network')), 'The link could not be made. Nothing was sent.');
});

test('the dialog draws the canvas\'s rows, the frozen version, and what is never on a link', () => {
  const html = draw(h(ShareDialog, { projectId: 7, deck, onClose() {} }));
  const t = renderedText(html);
  assert.match(html, /data-testid="pitch-share-dialog"/);
  for (const id of ['investor', 'expires-7', 'expires-14', 'expires-30', 'expires-never', 'limit', 'download', 'forwarding', 'nda', 'include-figures', 'include-sources', 'include-notes', 'include-bands', 'frozen', 'what', 'create']) {
    assert.match(html, new RegExp(`data-testid="pitch-share-${id}"`), id);
  }
  assert.match(html, /role="radio" aria-checked="true"[^>]*data-testid="pitch-share-expires-14"/);
  assert.match(t, new RegExp(NDA_SWITCH));
  assert.match(t, /Frozen at v4 as of 21 Oct/);
  assert.ok(t.includes(NEVER_SHARED));
});

/* ------------------------------------------------------------------ *
 * The dialog, mounted: it writes once, through the one writer
 * ------------------------------------------------------------------ */

async function mountDialog(answers) {
  const saved = { formOptions: cyclesWrite.formOptions, deckLink: cyclesWrite.raise.deckLink };
  const calls = [];
  cyclesWrite.formOptions = async (...a) => { calls.push(['formOptions', ...a]); return answers.formOptions(...a); };
  cyclesWrite.raise.deckLink = async (...a) => { calls.push(['deckLink', ...a]); return answers.deckLink(...a); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const created = [];
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { rootEl.render(h(ShareDialog, { projectId: 7, deck, onClose() {}, onCreated: (r) => created.push(r) })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, created, by, pr, settle,
    text: () => text(container).replace(/\s+/g, ' '),
    async change(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async press(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() {
      await act(async () => rootEl.unmount()); restore();
      cyclesWrite.formOptions = saved.formOptions; cyclesWrite.raise.deckLink = saved.deckLink;
    },
  };
}

test('Create link writes once through the one writer, and shows the link once', async () => {
  const m = await mountDialog({
    formOptions: async () => ({ prospects: [{ value: 5, label: 'Fund A' }, { value: 6, label: 'Fund B' }] }),
    deckLink: async () => ({ id: 91, share_path: '/share/deck/tok.abc', deck_version: 4 }),
  });
  try {
    assert.deepEqual(m.calls[0], ['formOptions', 'raise', 7, 'pitch-deck']);
    assert.match(m.text(), /for Fund A\./, 'the first prospect is picked');
    await m.change('pitch-share-investor', '6');
    await m.change('pitch-share-limit', '2');
    await m.change('pitch-share-include-bands', true);
    assert.match(m.text(), /for Fund B\. It expires in 14 days and opens 2 times\./);
    await m.press('pitch-share-create');
    const writes = m.calls.filter((c) => c[0] === 'deckLink');
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1], 7);
    assert.deepEqual(writes[0][2], {
      deck_id: 40, expires_days: 14, view_limit: 2, allow_download: false, allow_forwarding: false, nda_required: true,
      include: { figures: true, sources: true, notes: false, bands: true }, prospect_id: 6,
    });
    assert.equal(m.created.length, 1, 'the caller refreshes its links');
    assert.ok(m.by('pitch-share-made'));
    assert.match(m.text(), /\/share\/deck\/tok\.abc/);
    assert.match(m.text(), /The link is shown once\./);
    assert.equal(m.by('pitch-share-create'), undefined, 'no second link from the same dialog');
  } finally { await m.unmount(); }
});

test('a failed prospects read falls back to a typed name, and a refusal makes no link and says so', async () => {
  const m = await mountDialog({
    formOptions: async () => { throw new Error('read failed'); },
    deckLink: async () => { const e = new Error('Bad'); e.status = 400; e.data = { detail: 'view_limit is 1 to 100' }; throw e; },
  });
  try {
    assert.match(m.text(), /Your prospects could not be read\. Type a name instead\./);
    assert.ok(m.by('pitch-share-label'));
    assert.equal(m.pr(m.by('pitch-share-create')).disabled, true, 'no name, no link');
    await m.change('pitch-share-label', 'Fund Z');
    await m.press('pitch-share-create');
    assert.match(m.text(), /view_limit is 1 to 100 No link was made\./);
    assert.equal(m.created.length, 0);
    assert.equal(m.by('pitch-share-made'), undefined);
  } finally { await m.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The viewer (PD20, PD22)
 * ------------------------------------------------------------------ */

test('a closed link shows the sentence and who to ask, and nothing from the deck', () => {
  const err = { status: 410, data: { code: 'link_closed', venture: 'Acme', message: LINK_CLOSED } };
  assert.equal(viewerState(null, err), 'closed');
  assert.equal(viewerState(null, { status: 404 }), 'failed');
  assert.equal(viewerState({ gate: 'nda' }, null), 'gate');
  assert.equal(viewerState({ slides: [] }, null), 'deck');
  assert.equal(viewerState(null, null), 'loading');
  assert.deepEqual(closedCard(err), { title: 'This link is no longer open.', line: 'Ask Acme for a new one.' });
  assert.equal(closedCard({ status: 410, data: { venture: '  ' } }).line, 'Ask the venture for a new one.');
  const t = renderedText(draw(h(ClosedLink, { error: err })));
  assert.equal(t, 'This link is no longer open.Ask Acme for a new one.');
});

test('the NDA gate: signed in, a name and Accept and open; signed out, Sign in back to this link', () => {
  const gate = { gate: 'nda', project_name: 'Acme', frozen: { version: 4, as_of: '2026-10-21 09:00:00' } };
  const inHtml = draw(h(NdaGate, { token: 't', gate: { ...gate, signed_in: true } }));
  assert.match(inHtml, /data-testid="share-nda-name"/);
  assert.match(renderedText(inHtml), /Accept and open/);
  assert.match(renderedText(inHtml), /Acme · Frozen at v4 as of 21 Oct/);
  assert.match(inHtml, /data-testid="share-nda-accept"[^>]*disabled|disabled=""[^>]*data-testid="share-nda-accept"/, 'no Accept until the text is read and a name typed');
  const outHtml = draw(h(NdaGate, { token: 't', gate: { ...gate, signed_in: false } }));
  assert.match(outHtml, /href="\/login\?next=[^"]*" data-testid="share-nda-sign-in"/);
  assert.doesNotMatch(outHtml, /share-nda-accept/);
});

test('the NDA gate records the name through the share NDA write, and an unreadable text keeps the deck closed', async () => {
  const saved = { text: api.deckShareNdaText, sign: api.deckShareNda };
  const restore = installDocument();
  const calls = [];
  let accepted = 0;
  const run = async (textFn) => {
    api.deckShareNdaText = async (...a) => { calls.push(['text', ...a]); return textFn(); };
    api.deckShareNda = async (...a) => { calls.push(['sign', ...a]); return { ok: true }; };
    const c = document.createElement('div'); document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => { r.render(h(NdaGate, { token: 'tok', gate: { signed_in: true, frozen: { version: 4 } }, onAccepted: () => { accepted += 1; } })); });
    await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((x) => setTimeout(x, 0)); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const by = (id) => walk(c).find((n) => pr(n)['data-testid'] === id);
    return { r, by, pr };
  };
  try {
    const g = await run(async () => ({ text: 'Mutual NDA between Acme and [Your name].' }));
    assert.ok(g.by('share-nda-text'));
    await act(async () => { g.pr(g.by('share-nda-name')).onChange({ target: { value: ' Jo Investor ' } }); });
    await act(async () => { await g.pr(g.by('share-nda-accept')).onClick(); });
    assert.deepEqual(calls.filter((x) => x[0] === 'sign'), [['sign', 'tok', { signed_by: 'Jo Investor' }]]);
    assert.equal(accepted, 1);
    await act(async () => g.r.unmount());

    const bad = await run(async () => { throw new Error('503'); });
    assert.ok(bad.by('share-nda-unreadable'));
    assert.equal(bad.pr(bad.by('share-nda-accept')).disabled, true, 'nobody accepts a text they could not read');
    await act(async () => bad.r.unmount());
  } finally {
    restore(); api.deckShareNdaText = saved.text; api.deckShareNda = saved.sign;
  }
});

test('each figure carries the chip of its recorded source, and a value nobody recorded says so', () => {
  assert.equal(chipOf({ source: 'data' }), 'From records');
  assert.equal(chipOf({ source: 'auto' }), 'Computed');
  assert.equal(chipOf({ source: 'ai' }), 'Drafted');
  assert.equal(chipOf({ source: 'placeholder' }), NOT_RECORDED_CHIP);
  assert.equal(chipOf({}), null);
  // D896: a figure bound to a record carries that record's grade.
  assert.equal(chipOf({ source: 'ai', binding: { grade: 'Measured', as_of: '2026-10-20' } }), 'Measured');
  assert.equal(chipOf({ source: 'data', binding: { grade: 'Not recorded' } }), NOT_RECORDED_CHIP);
  assert.equal(chipOf({ source: 'data', binding: { grade: 'Made up' } }), 'From records', 'a grade the Worker does not send falls back to the source');
  const slides = [
    { title: 'Title', fields: [{ key: 'headline', kind: 'title', value: 'Acme' }] },
    { title: 'Traction', fields: [{ key: 'kpis', kind: 'metric_grid', source: 'data', value: [{ label: 'MRR', value: '$12k' }, { label: 'Churn', value: '' }] }] },
  ];
  assert.deepEqual(figureChips(slides), [
    { card: '02', label: 'MRR', value: '$12k', chip: 'From records' },
    { card: '02', label: 'Churn', value: NOT_RECORDED_CHIP, chip: 'From records' },
  ]);
  assert.equal(draw(h(FigureSources, { slides: [slides[0]] })), '', 'no figures, no strip');
  assert.match(renderedText(draw(h(FigureSources, { slides }))), /MRR · \$12kCard 02 · From records/);
  assert.equal(viewerNote({ version: 4, as_of: '2026-10-21 09:00:00' }), 'Frozen at v4 as of 21 Oct. The deal page shows this same viewer.');
  assert.equal(viewerNote(null), null);
});

test('the viewer page wires the closed card, the gate, the frozen note, the chips, and no deal pack on a studio link', () => {
  const page = read('frontend/src/pages/PitchDeckPrintPage.jsx');
  assert.match(page, /<ClosedLink\b/);
  assert.match(page, /<NdaGate\b/);
  assert.match(page, /share-frozen-note/);
  assert.match(page, /<FigureSources\b/);
  assert.match(page, /offers_deal_pack/);
});

/* ------------------------------------------------------------------ *
 * One writer: the editor's Share and the studio's New link
 * ------------------------------------------------------------------ */

test('the editor\'s Share and the studio\'s New link open the one dialog; no page writes a link another way', () => {
  const editor = read('frontend/src/pages/PitchDeckPage.jsx');
  const studio = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  for (const src of [editor, studio]) {
    assert.match(src, /import ShareDialog from '\.\/(raise\/pitch\/)?ShareDialog'/);
    assert.match(src, /<ShareDialog\b/);
    assert.doesNotMatch(src, /api\.(shareDeck|createDeckShare)\(/, 'the Spin-Out Lab writer stays the Lab\'s');
  }
  const dialog = read('frontend/src/pages/raise/pitch/ShareDialog.jsx');
  assert.equal((dialog.match(/cyclesWrite\.raise\.deckLink\(/g) || []).length, 1);
  assert.ok(existsSync(resolve(root, 'documentation/architecture/decisions/D902.md')), 'the decision exists');
});

/* ------------------------------------------------------------------ *
 * Share & analytics per version (PD19)
 * ------------------------------------------------------------------ */

const block = {
  available: true, viewers: 4, median_seconds_per_viewer: 75,
  cards: { version: 4, seconds: [{ index: 0, seconds: 30 }, { index: 2, seconds: 90 }] },
  previous: { version: 3, deck_id: 39, seconds: [{ index: 0, seconds: 20 }, { index: 1, seconds: 10 }] },
  reached_ask: { recorded: true, ask_index: 2, viewers: 1 },
};

test('seconds per card are this version\'s, with the version before dotted; an unread card on a read version is 0', () => {
  assert.equal(analyticsOf({ analytics: block }), block);
  assert.equal(analyticsOf({ analytics: { available: false, unreadable: true } }), null);
  assert.equal(analyticsOf(null), null);
  const s = cardSeries(block);
  assert.deepEqual(s.rows.map((r) => [r.label, r.seconds, r.previous]), [['01', 30, 20], ['02', 0, 10], ['03', 90, 0]]);
  assert.deepEqual([s.version, s.previousVersion, s.max], [4, 3, 90]);
  const first = cardSeries({ ...block, previous: null });
  assert.ok(first.rows.every((r) => r.previous === null), 'no version before: nothing dotted, not a dotted 0');
});

test('the funnel is over unique viewers, and a version with no ask card says so instead of 0', () => {
  assert.deepEqual(shareFunnel({ ndaSigned: 2 }, block).map((r) => [r.label, r.n, r.width]), [['Opened', 4, 100], ['Accepted the NDA', 2, 50], ['Reached the ask', 1, 25]]);
  const noAsk = shareFunnel({ ndaSigned: 0 }, { ...block, reached_ask: { recorded: false, reason: 'This version has no ask card, so how many reached it is not known.' } });
  assert.equal(noAsk[2].n, null);
  assert.match(noAsk[2].reason, /no ask card/);
  assert.deepEqual(shareFunnel(null, null).map((r) => r.n), [null, null, null]);
});

test('per link: its settings in one line, and its NDA signatures', () => {
  assert.equal(settingsLine({ view_limit: 1, allow_download: false, allow_forwarding: true }), '1 view · Download off · Forwarding on');
  assert.equal(settingsLine({ view_limit: null, allow_download: true, allow_forwarding: false }), 'No view limit · Download on · Forwarding off');
  assert.equal(settingsLine({ allow_download: null }), NOT_RECORDED_CHIP);
  assert.equal(ndaCell({ nda_required: false }), 'No NDA');
  assert.equal(ndaCell({ nda_required: true, nda_signed: 0 }), 'None signed yet');
  assert.equal(ndaCell({ nda_required: true, nda_signed: 2 }), '2 signed');
  assert.equal(ndaCell({ nda_required: null }), NOT_RECORDED_CHIP);
});

test('Share & analytics draws the per-version block: the chart with its legend, the funnel, the median per viewer', () => {
  const engagement = {
    deck_id: 40, total_views: 5, total_read_seconds: 400, conversions: { nda_signed: 2 },
    shares: [{ id: 11, created_at: '2026-10-20 10:00:00', expires_at: '2026-11-04 00:00:00', view_limit: 3, view_count: 1, exhausted: false, revoked_at: null, investor: 'Fund A', allow_download: false, allow_forwarding: false, nda_required: true, nda_signed: 2 }],
    views: [{ id: 1, ip_hash: 'a', ua_fingerprint: 'x', read_seconds: 60 }],
    analytics: block,
  };
  const ok = (data) => ({ status: 'ok', data });
  const reads = {
    projects: ok([{ id: 7, name: 'Acme' }]), project: { id: 7, name: 'Acme' }, requested: '7',
    versions: ok({ versions: [{ id: 40, version: 4, title: 'Seed', is_current: 1, created_at: '2026-10-20 10:00:00' }] }),
    module: ok({ card: { slug: 'pitch-deck', state: 'ok', reason: null, series: [{ kind: 'vbars', values: [0, 0, 0, 0, 0, 0, 0, 1], labels: [] }, { kind: 'hbar', items: [{ label: 'Slide 1', value: 30 }] }] }, records: { cols: [], total: 1, page: 1, page_size: 25, rows: [{ id: 11, cells: { link: 'Fund A', expires: { text: '2026-11-04', tone: 'ok' }, views: 1, time: '1 min' } }] } }),
    deck: ok({ id: 40, version: 4, slides: [] }), engagement: ok(engagement), setPage() {}, reload() {},
  };
  const html = draw(h(StudioAnalytics, { reads, readOnly: false }));
  const t = renderedText(html);
  assert.match(t, /Median time\s*1:15\s*per viewer, every view of this version/);
  assert.match(html, /data-testid="pitch-studio-seconds-legend"/);
  assert.match(t, /v4, with v3 dotted\./);
  assert.match(html, /data-testid="pitch-studio-previous-1"/);
  assert.match(html, /aria-label="Card 01: 30 seconds, 20 on v3, Card 02: 0 seconds, 10 on v3, Card 03: 90 seconds, 0 on v3"/);
  assert.match(t, /Opened\s*4\s*Accepted the NDA\s*2\s*Reached the ask\s*1/);
  assert.match(html, /data-testid="pitch-studio-link-nda-11"/);
  assert.match(t, /2 signed/);
  assert.match(t, /3 views · Download off · Forwarding off/);

  const unreadable = { ...engagement, analytics: { available: false, unreadable: true, reason: 'x' } };
  const u = renderedText(draw(h(StudioAnalytics, { reads: { ...reads, engagement: ok(unreadable) }, readOnly: false })));
  assert.match(u, /Seconds per card on this version could not be read\./, 'a block that could not be read is not drawn as nobody reading');
});
