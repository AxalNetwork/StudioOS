/**
 * D8771 part 3 (#8771) — the export history, the states around an export and
 * what is announced (canvas boards PTX05, PTX06, PTX07 and PTX11):
 *
 *   1. pure: a history row says what an export carried, and Not recorded for
 *      a row from before that was recorded, never "not included"; only the
 *      file this dialog made can be saved again (Q3, answered no: no file is
 *      kept); who recorded an export and when; the copy's announcement; the
 *      phone's one-line fold;
 *   2. mounted: while an export runs the copy, format, version and both
 *      settings are locked and the start is said; the finished export takes
 *      focus and says who recorded it; the history lists the new row with
 *      Download again and the older row as Not recorded and File not kept;
 *   3. mounted: an unreadable history says so with Try again and never reads
 *      as "No export recorded yet"; a failure moves focus to Try again; a
 *      change of copy is announced; the phone fold opens the preview.
 *
 * The deck, its notes, names and fingerprints are invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_export_history_8771_p3.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ExportDialog from '../src/pages/raise/pitch/ExportDialog.jsx';
import {
  FILE_NOT_KEPT, HISTORY_UNREADABLE, copyAnnouncement, exportingLine, foldLine, historyFoot, historyHash, historyRows, planOf, recordedLine,
  whenLabel,
} from '../src/pages/raise/pitch/exportDisclosureModel.js';

const h = React.createElement;
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });

// [Testventure] · Seed deck: twelve cards, two with notes.
function cardsOf() {
  const out = [];
  for (let i = 0; i < 12; i += 1) out.push({ title: `Card ${i + 1}`, blocks: [{ id: `t${i}`, kind: 'text', style: 'paragraph', text: `Line ${i + 1}`, grid: g(1, 12, 2, 3) }] });
  out[0] = { ...out[0], notes: 'Open with the late invoices.' };
  out[10] = { ...out[10], notes: 'Private: the lead has not confirmed yet.' };
  return out;
}
const CARDS = cardsOf();
const OLD_HASH = 'a'.repeat(60) + '4c12';
const NEW_HASH = '51d2a8' + 'b'.repeat(54) + '3b90';
const OLD = { id: 1, deck_id: 9, version: 4, format: 'pdf', content_hash: OLD_HASH, by: '[Noah Brandt]', created_at: '2026-11-18 09:30:00', notes: null, sources: null, copy: null };
const NEW = { id: 2, deck_id: 10, version: 7, format: 'pptx', content_hash: NEW_HASH, by: '[Maya Ruiz]', created_at: '2026-11-26 14:20:00', notes: 1, sources: 1, copy: 'working' };

test('1. pure: history rows, the file that can be saved again, who recorded it, the announcement and the fold', () => {
  // Mutation checked: an older row read as "Not included" → the older row's check fails; every row offered Download again →
  // the File not kept check fails; the announcement without the Sources page → its check fails.
  const [newer, older] = historyRows([NEW, OLD], { fileHash: NEW_HASH });
  assert.deepEqual(
    { when: newer.when, version: newer.version, format: newer.format, copy: newer.copy, notes: newer.notes, sources: newer.sources, hash: newer.hash, by: newer.by, again: newer.again },
    { when: 'Thu 26 Nov, 14:20', version: 'v7', format: 'PowerPoint', copy: 'Working copy', notes: 'Included', sources: 'Included', hash: '51d2a8…3b90', by: '[Maya Ruiz]', again: true },
  );
  assert.deepEqual([older.copy, older.notes, older.sources, older.recorded, older.again], ['Not recorded', 'Not recorded', 'Not recorded', false, false], 'never "not included"');
  assert.equal(historyRows([{ ...NEW, notes: 0, sources: 1, copy: 'investor' }])[0].notes, 'Not included');
  assert.equal(historyRows([NEW])[0].again, false, 'no file made in this dialog, nothing to save again');
  assert.equal(historyHash('nope'), 'Not recorded');
  assert.equal(whenLabel(null), 'Date not recorded');
  assert.equal(FILE_NOT_KEPT, 'File not kept');
  assert.match(historyFoot([NEW, OLD]), /^2 exports · newest first · up to 50\. Rows from before notes and appendix were recorded say Not recorded/);
  assert.doesNotMatch(historyFoot([NEW]), /Not recorded/);

  assert.equal(recordedLine([OLD, NEW], NEW_HASH), 'Recorded Thu 26 Nov, 14:20 UTC · by [Maya Ruiz]');
  assert.equal(recordedLine([OLD], NEW_HASH), null, 'not read back yet: nothing said');
  assert.equal(recordedLine([NEW], null), null);

  const investor = planOf('pdf', CARDS, { notes: false, sources: true });
  assert.equal(copyAnnouncement('investor', investor, { notes: false, sources: true }), 'Investor copy. Speaker notes not included. Sources appendix included, page 13.');
  assert.equal(copyAnnouncement('custom', null, { notes: true, sources: false }), 'Custom. Speaker notes included. Sources appendix not included.');
  assert.equal(foldLine('pptx', CARDS, { notes: false, sources: true }), '13 slides · 16:9 · notes not included');
  assert.equal(foldLine('pdf', CARDS, { notes: true, sources: true }), '15 pages · 16:9 · notes included');
  assert.equal(exportingLine('pptx', { version: 7 }), 'Exporting PowerPoint of v7. The settings and version are locked until it ends.');
});

// ── mounted ──

const DECK = { id: 10, project_id: 3, version: 7, title: 'Seed deck', is_current: 1, created_at: '2026-11-20 10:00:00' };
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob([]) });
const file = (headers) => ({ ok: true, status: 200, headers: { get: (k) => headers[k] ?? null }, json: async () => null, blob: async () => new Blob(['PK']) });

async function mounted({ ledger, exportAnswer }) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, createObjectURL: URL.createObjectURL };
  const requests = [];
  let downloads = 0;
  URL.createObjectURL = () => { downloads += 1; return 'blob:x'; };
  globalThis.fetch = async (u, options = {}) => {
    const url = String(u);
    requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/decks/10/exports')) return ledger();
    if (url.endsWith('/decks/10/export') && options.method === 'POST') return exportAnswer();
    if (/\/decks\/10(\?|$)/.test(url)) return json({ deck: { id: 10, version: 7, slides: CARDS, theme: null } });
    return json({});
  };
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
    requests, flush, downloads: () => downloads, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    all: () => text(document.body),
    focused: () => props(document.activeElement)['data-testid'] ?? null,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    tick: async (id, checked) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { checked } }); }); await flush(); },
    posts: () => requests.filter((q) => q.method === 'POST'),
    async confirmChecks() {
      for (let i = 0; i < 40 && byId('pitch-export-checking'); i += 1) await flush();
      assert.ok(!byId('pitch-export-checking'), 'the check finished');
      if (byId('pitch-export-gate-anyway')) await v.click('pitch-export-gate-anyway');
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; URL.createObjectURL = previous.createObjectURL; restore(); },
  };
  return v;
}

test('2. mounted: locked while exporting, the finished export takes focus, and the history lists what each export carried', async () => {
  // Mutation checked: the copy picker not locked while busy → the disabled check fails; no focus on the done heading → the focus
  // check fails; the recorded line not read back → its check fails; Download again on the older row → File not kept fails.
  let rows = [OLD];
  let release;
  const v = await mounted({
    ledger: () => json({ exports: rows }),
    exportAnswer: () => new Promise((resolve) => { release = () => { rows = [NEW, OLD]; resolve(file({ 'X-Content-SHA256': NEW_HASH })); }; }),
  });
  try {
    assert.equal(v.textOf('pitch-export-last-settings'), 'Notes and appendix Not recorded');
    await v.click('pitch-export-format-pptx');
    await v.click('pitch-export-copy-working');
    await v.confirmChecks();
    await v.tick('pitch-export-ack-check', true);
    await act(async () => { v.props('pitch-export-run').onClick(); });
    await v.flush();
    assert.equal(v.textOf('pitch-export-exporting'), 'Exporting PowerPoint of v7. The settings and version are locked until it ends.');
    for (const id of ['pitch-export-copy-investor', 'pitch-export-format-pdf', 'pitch-export-version', 'pitch-export-notes', 'pitch-export-sources', 'pitch-export-ack-check']) {
      assert.equal(v.props(id).disabled, true, `${id} is locked while the export runs`);
    }
    await act(async () => { release(); });
    await v.flush();
    assert.ok(!v.has('pitch-export-exporting'));
    assert.equal(v.props('pitch-export-copy-investor').disabled, false, 'unlocked once it ends');
    assert.equal(v.focused(), 'pitch-export-done', 'focus moves to the result heading');
    assert.equal(v.textOf('pitch-export-done-recorded'), 'Recorded Thu 26 Nov, 14:20 UTC · by [Maya Ruiz]');

    assert.equal(v.textOf('pitch-export-history-toggle').trim(), '▸ Export history (2)');
    assert.ok(!v.has('pitch-export-history-table'), 'folded until opened');
    await v.click('pitch-export-history-toggle');
    assert.equal(v.textOf('pitch-export-history-copy-2').trim(), 'Working copy');
    assert.equal(v.textOf('pitch-export-history-notes-1').trim(), '○ Not recorded', 'an older row never reads as "not included"');
    assert.equal(v.textOf('pitch-export-history-file-1').trim(), 'File not kept');
    assert.match(v.textOf('pitch-export-history-foot'), /^2 exports · newest first · up to 50\./);
    assert.equal(v.downloads(), 1);
    await v.click('pitch-export-history-again-2');
    assert.equal(v.downloads(), 2, 'the same file from this dialog, no second export');
    assert.equal(v.posts().length, 1);
  } finally { await v.close(); }
});

test('3. mounted: an unreadable history, a failure’s focus, the copy announcement and the phone fold', async () => {
  // Mutation checked: the unreadable history read as empty → the "No export recorded yet" check fails; the history's Try again
  // not reading again → the toggle check fails; no focus on Try again → the focus check fails; no announcement → its check fails.
  let reads = 0;
  const v = await mounted({
    ledger: () => { reads += 1; return reads === 1 ? json({ error: 'down' }, 503) : json({ exports: [OLD] }); },
    exportAnswer: () => json({ error: 'pptx_render_failed' }, 502),
  });
  try {
    assert.equal(v.textOf('pitch-export-history-failed').replace('Try again', '').trim(), HISTORY_UNREADABLE);
    assert.doesNotMatch(v.all(), /No export recorded yet/, 'unreadable is never empty');
    await v.click('pitch-export-history-retry');
    assert.ok(!v.has('pitch-export-history-failed'));
    assert.equal(v.textOf('pitch-export-history-toggle').trim(), '▸ Export history (1)');

    assert.equal(v.textOf('pitch-export-copy-said'), '', 'nothing is said when the dialog opens');
    await v.click('pitch-export-copy-working');
    assert.equal(v.textOf('pitch-export-copy-said'), 'Working copy. Speaker notes included. Sources appendix included, page 15.');

    assert.equal(v.textOf('pitch-export-fold').replace(/[▾▴]/, '').trim(), '15 pages · 16:9 · notes included');
    assert.equal(v.props('pitch-export-preview-body')['data-open'], false);
    await v.click('pitch-export-fold');
    assert.equal(v.props('pitch-export-preview-body')['data-open'], true);

    await v.click('pitch-export-format-pptx');
    await v.confirmChecks();
    await v.tick('pitch-export-ack-check', true);
    await v.click('pitch-export-run');
    assert.ok(v.has('pitch-export-failed'));
    assert.equal(v.focused(), 'pitch-export-retry', 'a failure moves focus to Try again');
  } finally { await v.close(); }
});
