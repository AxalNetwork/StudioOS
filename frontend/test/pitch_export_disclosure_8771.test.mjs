/**
 * D8771 (#8771) — export disclosure and PowerPoint editability, before a
 * founder sends the file.
 *
 *   1. the words: PowerPoint is no longer "One picture per card", and the
 *      editor's notes no longer promise "Only you see these.";
 *   2. the presets and the preview, pure: the investor copy has no notes and
 *      the Sources appendix; the PDF's page plan (cards, notes pages six a
 *      page, Sources); the PowerPoint's slide size and editability table from
 *      the version's own blocks; What leaves Axal VC; the writer's report;
 *      the ledger's "Not recorded" for an older row;
 *   3. mounted: the dialog opens on the investor copy and sends no notes; the
 *      working copy quotes the private note and keeps Export off until the
 *      acknowledgment is ticked; the finished export names the version, copy,
 *      settings, fingerprint and the writer's counts, with Download again and
 *      Present; a failure offers Try again with the same settings.
 *
 * The deck, its notes and its figures are invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_export_disclosure_8771.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ExportDialog from '../src/pages/raise/pitch/ExportDialog.jsx';
import { FORMATS } from '../src/pages/raise/pitch/presentExportModel.js';
import { NOTES_HELPER, NOTES_PLACEHOLDER } from '../src/pages/raise/pitch/editorModel.js';
import { DEFAULT_INCLUDE } from '../src/pages/raise/pitch/shareModel.js';
import { NOTES_PER_PAGE as PRINT_NOTES_PER_PAGE } from '../src/pages/raise/pitch/PrintExtras.jsx';
import {
  DEFAULT_PRESET, NOTES_PER_PAGE, PRESETS, ackNeeded, completedLines, editabilityOf, leavesOf, ledgerSettings, parseReport, planOf,
  presetOf, privateNote, reportLines, shortHash,
} from '../src/pages/raise/pitch/exportDisclosureModel.js';

const h = React.createElement;
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const LONG = 'A very long title that cannot possibly fit inside one narrow heading area at its full size';

// [Testventure] · Seed deck: twelve cards, two with notes, one hidden.
function cardsOf() {
  const out = [];
  for (let i = 0; i < 12; i += 1) out.push({ title: `Card ${i + 1}`, blocks: [{ id: `t${i}`, kind: 'text', style: 'paragraph', text: `Line ${i + 1}`, grid: g(1, 12, 2, 3) }] });
  out[0] = { title: 'Problem', notes: 'Open with the late invoices.', blocks: [{ id: 'h', kind: 'text', style: 'heading', text: LONG, grid: g(1, 3, 1, 1) }] };
  out[3] = {
    title: 'Traction', blocks: [
      { id: 'c', kind: 'chart', chart_type: 'columns', grid: g(1, 6, 1, 6), series: [{ label: 'Pilots', points: [{ x: '2026-07', y: 1 }, { x: '2026-08', y: 2 }] }] },
      { id: 'k', kind: 'chart', chart_type: 'cohort_heatmap', grid: g(7, 12, 1, 6), series: [{ label: 'Retention', binding: { source_key: 'grow.retention' } }] },
    ],
  };
  out[4] = { title: 'Team', blocks: [{ id: 'i', kind: 'image', image_url: 'https://img.example.test/a.png', alt: 'Team', grid: g(1, 6, 1, 6) }] };
  out[5] = { title: 'Plan', blocks: [{ id: 'd', kind: 'graphic', diagram: { v: 1, type: 'flow', items: [{ label: 'Sign' }, { label: 'Pay' }] }, grid: g(1, 12, 1, 6) }] };
  out[6] = { title: 'Ask', fields: [{ key: 'p', label: 'Ask', kind: 'paragraph', value: 'Raising a seed round.' }] };
  out[10] = { title: 'The ask', notes: 'Private: the lead has not confirmed yet.', blocks: [{ id: 'm', kind: 'metric', label: 'Raising', value: '[1.5M]', grid: g(1, 4, 1, 2), binding: { source_key: 'raise.target' } }] };
  return out;
}
const CARDS = cardsOf();

test('1. the words: PowerPoint is the editable file, and the notes field says who reads it', () => {
  // Mutation checked: the old "One picture per card" back → the first check fails; "Only you see these." back → the helper check fails.
  const pptx = FORMATS.find((f) => f.id === 'pptx').line;
  assert.doesNotMatch(pptx, /picture per card/i);
  assert.match(pptx, /Editable text, shapes and most charts · some charts as pictures/);
  assert.match(FORMATS.find((f) => f.id === 'odp').line, /charts as pictures or text/, 'the .odp writes no native chart');
  assert.doesNotMatch(`${NOTES_PLACEHOLDER} ${NOTES_HELPER}`, /Only you/);
  assert.match(NOTES_HELPER, /People who can open this deck in Axal VC can read these notes\. They go into a file or an investor link only when you include them\./);
});

test('2. the presets, the page plan, the editability table, what leaves and the report, pure', () => {
  // Mutation checked: the investor copy given notes → the link-default check fails; notes pages at eight a page → the 15 fails;
  // the heatmap counted native → the fallback row fails; the old row read as "not included" → the Not recorded check fails.
  assert.equal(DEFAULT_PRESET, 'investor');
  assert.deepEqual({ ...PRESETS.investor }, { notes: DEFAULT_INCLUDE.notes, sources: DEFAULT_INCLUDE.sources }, 'an investor copy carries what an investor link does');
  assert.equal(presetOf(true, true), 'working');
  assert.equal(presetOf(true, false), 'custom');
  assert.equal(NOTES_PER_PAGE, PRINT_NOTES_PER_PAGE, 'the print page’s six cards a page');

  assert.equal(planOf('pdf', CARDS, { notes: false, sources: true }).line, '13 pages · 12 cards, Sources · no notes pages');
  assert.equal(planOf('pdf', CARDS, { notes: true, sources: true }).line, '15 pages · 12 cards, 2 notes pages, Sources');
  assert.equal(planOf('pdf', CARDS, { notes: false, sources: false, theme: { aspect: '4:3' } }).size, '1440 × 1080 px (4:3)');
  assert.equal(planOf('pdf', CARDS, { notes: false, sources: false, theme: { aspect: '4:3' }, methodId: 'yc' }).size, '1920 × 1080 px (16:9)', 'a template deck prints at 16:9');
  const pptx = planOf('pptx', CARDS, { notes: false, sources: true });
  assert.deepEqual([pptx.count, pptx.size, pptx.line], [13, '13.33 × 7.5 in (16:9)', '13 slides, the last one Sources · speaker notes empty']);

  const rows = Object.fromEntries(editabilityOf('pptx', CARDS, { sources: true }).map((r) => [r.key, r]));
  assert.match(rows.text.detail, /^8 areas as editable text at its place\. Long text is set smaller to fit its box, down to 40% of its size/);
  assert.match(rows.native.detail, /^1 chart \(card 4\) as native charts/);
  assert.match(rows.fallback.detail, /^1 chart \(card 4\) with no native chart: a picture of the chart, not editable/);
  assert.match(rows.diagrams.detail, /^1 diagram as native shapes/);
  assert.match(rows.images.detail, /^1 image as pictures with their crop\. One that is not PNG, JPEG or GIF, or cannot be fetched,/);
  assert.match(rows.frames.detail, /^2 slides \(1 card made of fields and the Sources appendix\)/);
  const odp = Object.fromEntries(editabilityOf('odp', CARDS).map((r) => [r.key, r]));
  assert.ok(!odp.native && /^2 charts .* The \.odp file has no native charts\./.test(odp.charts.detail));
  assert.equal(editabilityOf('pdf', CARDS), null);

  const investor = Object.fromEntries(leavesOf('pptx', [...CARDS, { title: 'Hidden', hidden: true }], CARDS, PRESETS.investor).map((r) => [r.key, r]));
  assert.equal(investor.notes.state, 'out');
  assert.equal(investor.notes.detail, 'Not in the file. Every slide’s speaker notes are empty.');
  assert.match(investor.sources.detail, /^The last slide\. 2 source lines: each figure’s card, name, grade and date\.$/);
  assert.equal(investor.hidden.detail, '1 hidden card is in no export.');
  const working = Object.fromEntries(leavesOf('pdf', CARDS, CARDS, PRESETS.working).map((r) => [r.key, r]));
  assert.match(working.notes.detail, /^The notes of 2 cards, on 2 notes pages after the cards, six cards a page\./);
  assert.ok(ackNeeded(true, CARDS) && !ackNeeded(false, CARDS) && !ackNeeded(true, [{ title: 'Quiet' }]));
  assert.deepEqual(privateNote(CARDS), { n: 1, title: 'Problem', note: 'Open with the late invoices.', quote: 'Open with the late invoices.' });

  const report = { charts: { native: 1, pictured: 1, as_text: 0 }, images: { placed: 1, not_placed: 0 }, text: { boxes: 11, shrunk: 1, smallest: 0.7 }, diagrams: 1, slides: { total: 13, from_blocks: 11, text_frames: 2 } };
  assert.deepEqual(reportLines(report), ['11 text boxes, 1 set smaller to fit (the smallest at 70%)', '1 native chart', '1 chart as a picture', '1 diagram as shapes', '1 picture', '2 slides as stacked text']);
  assert.equal(parseReport('application/json'), null);
  assert.deepEqual(parseReport(JSON.stringify(report)), report);
  assert.equal(shortHash('a'.repeat(64)), 'aaaaaaaaaaaa');
  assert.equal(shortHash('application/json'), null);
  assert.deepEqual(completedLines({ format: 'pptx', version: { version: 7 }, notes: false, sources: true }),
    { what: 'PowerPoint of v7 · Investor copy', settings: 'Speaker notes not included · Sources appendix included' });
  assert.equal(ledgerSettings({ notes: null, sources: null, copy: null }), 'Notes and appendix Not recorded');
  assert.equal(ledgerSettings({ notes: true, sources: true, copy: 'working' }), 'Working copy · notes included · appendix included');
});

// ── mounted ──

const DECK = { id: 10, project_id: 3, version: 7, title: 'Seed deck', is_current: 1, created_at: '2026-11-20 10:00:00' };
const HASH = 'b'.repeat(64);
const REPORT = JSON.stringify({ charts: { native: 1, pictured: 0, as_text: 1 }, images: { placed: 1, not_placed: 0 }, text: { boxes: 11, shrunk: 1, smallest: 0.6 }, diagrams: 1, slides: { total: 13, from_blocks: 11, text_frames: 2 } });
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob([]) });
const file = (headers) => ({ ok: true, status: 200, headers: { get: (k) => headers[k] ?? null }, json: async () => null, blob: async () => new Blob(['PK']) });

async function mounted(handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, createObjectURL: URL.createObjectURL };
  const requests = [];
  let downloads = 0;
  URL.createObjectURL = () => { downloads += 1; return 'blob:x'; };
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  // The download's anchor: this document has no click().
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); if (tag === 'a') { n.click = () => {}; n.remove ||= () => {}; } return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(ExportDialog, { versions: [DECK], current: DECK, onClose() {} }))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const v = {
    requests, downloads: () => downloads, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    tick: async (id, checked) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { checked } }); }); await flush(); },
    posts: () => requests.filter((q) => q.method === 'POST'),
    /** The preflight's own confirm, when its warnings ask for one (D4598): not what this test is about. */
    async confirmChecks() {
      for (let i = 0; i < 40 && byId('pitch-export-checking'); i += 1) await flush();
      assert.ok(!byId('pitch-export-checking'), 'the check finished');
      if (byId('pitch-export-gate-anyway')) await v.tick('pitch-export-gate-anyway', true); // D8772 part 3: a checkbox now
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; URL.createObjectURL = previous.createObjectURL; restore(); },
  };
  return v;
}
const ledgerRow = { id: 1, deck_id: 9, version: 4, format: 'pptx', content_hash: 'a'.repeat(64), by: 'Founder', created_at: '2026-11-20 10:00:00', notes: null, sources: null, copy: null };
const handler = (exportAnswer) => (url, o = {}) => {
  if (url.includes('/decks/10/exports')) return json({ exports: [ledgerRow] });
  if (url.endsWith('/decks/10/export') && o.method === 'POST') return exportAnswer();
  if (/\/decks\/10(\?|$)/.test(url)) return json({ deck: { id: 10, version: 7, slides: CARDS, theme: null } });
  return json({});
};

test('3. mounted: the investor copy by default, the working copy’s acknowledgment, the completed export', async () => {
  // Mutation checked: notes defaulting on → the default body fails; the acknowledgment not gating Export → the disabled check fails;
  // the fingerprint not read from X-Content-SHA256 → the hash line fails; the report header ignored → the report line fails.
  const v = await mounted(handler(() => file({ 'X-Content-SHA256': HASH, 'X-Deck-Export-Report': REPORT })));
  try {
    assert.equal(v.props('pitch-export-copy-investor')['aria-checked'], true, 'the investor copy, every time it opens');
    assert.equal(v.props('pitch-export-notes').checked, false);
    assert.equal(v.props('pitch-export-sources').checked, true);
    assert.equal(v.textOf('pitch-export-last-settings'), 'Notes and appendix Not recorded', 'an older row never reads as "not included"');
    await v.click('pitch-export-format-pptx');
    assert.match(v.textOf('pitch-export-plan'), /^13 slides, the last one Sources · speaker notes empty · 13\.33 × 7\.5 in \(16:9\)$/);
    assert.equal(v.props('pitch-export-leaves-notes')['data-state'], 'out');
    assert.match(v.textOf('pitch-export-editable-fallback'), /card 4/);
    assert.ok(!v.has('pitch-export-ack'), 'no notes, no acknowledgment');

    await v.click('pitch-export-copy-working');
    assert.equal(v.props('pitch-export-notes').checked, true);
    assert.equal(v.props('pitch-export-leaves-notes')['data-state'], 'in');
    assert.match(v.textOf('pitch-export-ack-quote'), /Card 1 · Problem: “Open with the late invoices\.”/);
    await v.confirmChecks();
    assert.equal(v.props('pitch-export-run').disabled, true, 'Export waits for the acknowledgment');
    await v.tick('pitch-export-ack-check', true);
    assert.equal(v.props('pitch-export-run').disabled, false);
    // Back to the investor copy and back again: the acknowledgment is asked again.
    await v.click('pitch-export-copy-investor');
    await v.click('pitch-export-copy-working');
    assert.equal(v.props('pitch-export-run').disabled, true, 'a new combination asks again');
    await v.tick('pitch-export-ack-check', true);
    await v.click('pitch-export-run');
    // D8772 part 3: the export carries the ids of the warnings its check confirmed, for the ledger row.
    const confirmed = ['density:0:h:0', 'sources:3:c:0', 'placeholder:10:m:0', 'sources:10:m:0'];
    assert.deepEqual(v.posts().map((q) => q.body), [{ format: 'pptx', notes: true, sources: true, confirmed }]);
    assert.equal(v.textOf('pitch-export-done'), 'Exported PowerPoint of v7. The export is recorded.');
    assert.equal(v.textOf('pitch-export-done-what'), 'PowerPoint of v7 · Working copy · 13 slides');
    assert.equal(v.textOf('pitch-export-done-settings'), 'Speaker notes included · Sources appendix included');
    assert.equal(v.textOf('pitch-export-done-hash'), 'Fingerprint bbbbbbbbbbbb…');
    assert.match(v.textOf('pitch-export-done-report'), /^The writer made: 11 text boxes, 1 set smaller to fit \(the smallest at 60%\) · 1 native chart · 1 chart as text · 1 diagram as shapes · 1 picture · 2 slides as stacked text\.$/);
    assert.match(v.textOf('pitch-export-done-recover'), /not kept in Axal VC\. To get it again after you close this, export v7 again/);
    assert.equal(v.props('pitch-export-present-link').href, '/raise/pitch/present?project_id=3&deck=10');
    assert.equal(v.downloads(), 1);
    await v.click('pitch-export-download-again');
    assert.equal(v.downloads(), 2, 'the same file again, no second export');
    assert.equal(v.posts().length, 1);
  } finally { await v.close(); }
});

test('4. mounted: a failure keeps its settings, and Try again sends the same export', async () => {
  // Mutation checked: Try again resetting to the investor copy → the second body fails.
  let calls = 0;
  const v = await mounted(handler(() => { calls += 1; return calls === 1 ? json({ error: 'pptx_render_failed' }, 502) : file({ 'X-Content-SHA256': HASH }); }));
  try {
    await v.click('pitch-export-format-pptx');
    await v.click('pitch-export-copy-working');
    await v.confirmChecks();
    await v.tick('pitch-export-ack-check', true);
    await v.click('pitch-export-run');
    assert.ok(v.has('pitch-export-failed') && !v.has('pitch-export-completed'));
    await v.click('pitch-export-retry');
    const confirmed = ['density:0:h:0', 'sources:3:c:0', 'placeholder:10:m:0', 'sources:10:m:0'];
    assert.deepEqual(v.posts().map((q) => q.body), [{ format: 'pptx', notes: true, sources: true, confirmed }, { format: 'pptx', notes: true, sources: true, confirmed }]);
    assert.ok(v.has('pitch-export-completed') && !v.has('pitch-export-failed'));
    assert.equal(v.textOf('pitch-export-done-hash'), 'Fingerprint bbbbbbbbbbbb…');
    assert.ok(!v.has('pitch-export-done-report'), 'no report header, no report line');
  } finally { await v.close(); }
});
