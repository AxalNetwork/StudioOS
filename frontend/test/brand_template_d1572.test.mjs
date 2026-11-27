/**
 * D1572 (#3819, deck v2 D11) — pd31's brand locks and pd30's .pptx template
 * import, the browser half.
 *
 *   1. the words: lock rows, "Locked by [name]", pd30's count line (never a 0
 *      for a count the report does not hold), fonts with their stand-in, the
 *      unplaced reasons, what Save sends;
 *   2. the adapter: `brandLocks` and `pptxImport` go through their clients;
 *   3. the import sheet: drop → reading → report → Save as your layouts, which
 *      sends only the placed layouts;
 *   4. the Brand kit's switches: a member who is not the admin sees them set
 *      and cannot press them; the admin locks; a locked palette's fields are
 *      not editable here.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/brand_template_d1572.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { deckBrandLocksApi } from '../src/lib/api/deckBrandLocks.js';
import { deckLayoutsApi } from '../src/lib/api/deckLayouts.js';
import { deckBrandKitApi } from '../src/lib/api/deckBrandKit.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import TemplateImport from '../src/pages/raise/pitch/TemplateImport.jsx';
import { BrandKitSheet } from '../src/pages/raise/pitch/DeckSheets.jsx';
import {
  ADMINS_ONLY, LOCK_ROWS, TEMPLATE_PRIVACY, TEMPLATE_READING, areaRange, countsLine, fileProblem, fontLine, lockFor, lockedTag, placedOf, unplacedOf,
} from '../src/pages/raise/pitch/brandTemplateModel.js';

const h = React.createElement;
const ORIGINAL = { locks: { ...deckBrandLocksApi }, layouts: { ...deckLayoutsApi }, kit: { ...deckBrandKitApi } };

const REPORT = {
  source_name: 'Company template.pptx',
  palette: { ground: '#ffffff', ink: '#0f172a', accent: '#2563eb' },
  colours: [{ role: 'dk1', hex: '#0f172a' }, { role: 'lt1', hex: '#ffffff' }, { role: 'accent1', hex: '#2563eb' }],
  fonts: [{ role: 'display', found: 'Montserrat', use: 'Montserrat', fallback: false }, { role: 'body', found: 'Calibri', use: 'Inter', fallback: true }],
  layouts: [
    { name: 'Title and content', placed: true, areas: [{ kind: 'heading', c1: 1, c2: 12, r1: 1, r2: 1 }, { kind: 'text', c1: 1, c2: 12, r1: 2, r2: 6 }] },
    { name: 'Two content', placed: true, areas: [{ kind: 'text', c1: 1, c2: 6, r1: 2, r2: 6 }, { kind: 'text', c1: 7, c2: 12, r1: 2, r2: 6 }] },
    { name: 'Offset column', placed: false, reason: 'between_columns', why: 'A box sits between columns' },
  ],
  counts: { found: 3, placed: 2, not_placed: 1 },
};

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(element); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => [container, ...walk(document.body)];
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, pr, settle,
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    text: () => nodes().map(text).join(' ').replace(/\s+/g, ' '),
    async press(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async choose(id, file) { await act(async () => { await pr(by(id)).onChange({ target: { files: [file] } }); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount()); restore();
      Object.assign(deckBrandLocksApi, ORIGINAL.locks); Object.assign(deckLayoutsApi, ORIGINAL.layouts); Object.assign(deckBrandKitApi, ORIGINAL.kit);
    },
  };
}

test('1. the words: locks, pd30’s counts, fonts with their stand-in, the unplaced reasons, what Save sends', () => {
  // Mutation checked: a missing count shown as 0 → the null check fails; unplaced layouts sent by Save → placedOf fails.
  assert.deepEqual(LOCK_ROWS.map((r) => r.part), ['fonts', 'palette', 'logo']);
  assert.equal(ADMINS_ONLY, 'Only the venture’s admins can lock.');
  assert.equal(lockedTag({ part: 'palette', by: 'Olu Owner', at: '2026-11-03' }), 'Locked by Olu Owner');
  assert.equal(lockedTag(null), null);
  assert.deepEqual(lockFor({ available: true, value: { locks: { palette: { by: 'Olu' } } } }, 'palette'), { locked: true, tag: 'Locked by Olu' });
  assert.deepEqual(lockFor({ available: false, unreadable: true }, 'palette'), { locked: false, tag: null });
  assert.equal(countsLine(REPORT.counts), '3 layouts found · 2 placed on whole cells · 1 could not be placed');
  assert.equal(countsLine({ found: 1, placed: 1, not_placed: 0 }), '1 layout found · 1 placed on whole cells · 0 could not be placed');
  assert.equal(countsLine(null), null, 'no report, no line — never “0 layouts”');
  assert.deepEqual(REPORT.fonts.map(fontLine), ['Headings: Montserrat', 'Text: Calibri → Inter (stand-in)']);
  assert.deepEqual(unplacedOf(REPORT), [{ name: 'Offset column', why: 'A box sits between columns' }]);
  assert.deepEqual(placedOf(REPORT).map((l) => l.name), ['Title and content', 'Two content']);
  assert.equal(areaRange({ c1: 1, c2: 6, r1: 2, r2: 6 }), 'c1–6 × r2–6');
  assert.equal(areaRange({ c1: 3, c2: 3, r1: 1, r2: 1 }), 'c3 × r1');
  assert.equal(fileProblem({ name: 'deck.key', size: 10 }), 'Choose a PowerPoint template: a .pptx file.');
  assert.equal(fileProblem({ name: 'big.pptx', size: 51 * 1024 * 1024 }), 'A template can be up to 50 MB.');
  assert.equal(fileProblem({ name: 'ok.PPTX', size: 10 }), null);
});

test('2. the adapter: brandLocks and pptxImport go through their clients', async () => {
  // Mutation checked: either left off(...) → the availability and the call checks fail.
  assert.equal(adapter.availability('brandLocks'), null);
  assert.equal(adapter.availability('pptxImport'), null);
  const sent = [];
  deckBrandLocksApi.locks = async (pid) => { sent.push(['locks', pid]); return { locks: {}, can_lock: false }; };
  deckLayoutsApi.importTemplate = async (pid, file) => { sent.push(['import', pid, file.name]); return REPORT; };
  try {
    assert.equal((await adapter.brandLocks(7)).available, true);
    assert.equal((await adapter.pptxImport(7, { name: 't.pptx' })).value.counts.found, 3);
    assert.deepEqual(sent, [['locks', 7], ['import', 7, 't.pptx']]);
  } finally { Object.assign(deckBrandLocksApi, ORIGINAL.locks); Object.assign(deckLayoutsApi, ORIGINAL.layouts); }
});

test('3. the import sheet: drop → reading → the report → Save as your layouts, with only the placed layouts', async () => {
  // Mutation checked: Save sending report.layouts → the saved names include “Offset column”.
  let release;
  const saved = [];
  deckLayoutsApi.importTemplate = () => new Promise((r) => { release = () => r(REPORT); });
  deckLayoutsApi.save = async (pid, source, layouts) => { saved.push([pid, source, layouts.map((l) => l.name)]); return { saved: layouts.length }; };
  const v = await mount(h(TemplateImport, { projectId: 7, onClose() {} }));
  try {
    assert.match(v.of('pitch-template-drop'), /\.pptx up to 50 MB/);
    assert.ok(v.of('pitch-template-drop').includes(TEMPLATE_PRIVACY));
    await v.choose('pitch-template-file', { name: 'notes.docx', size: 10 });
    assert.equal(v.of('pitch-template-line'), 'Choose a PowerPoint template: a .pptx file.');
    await act(async () => { v.pr(v.by('pitch-template-file')).onChange({ target: { files: [{ name: 'Company template.pptx', size: 1000 }] } }); });
    assert.equal(v.of('pitch-template-reading'), TEMPLATE_READING);
    await act(async () => { release(); }); await v.settle();
    assert.equal(v.of('pitch-template-counts'), '3 layouts found · 2 placed on whole cells · 1 could not be placed');
    assert.equal(v.of('pitch-template-font-body'), 'Text: Calibri → Inter (stand-in)');
    assert.match(v.of('pitch-template-unplaced'), /Offset column · A box sits between columns/);
    await v.press('pitch-template-save');
    assert.deepEqual(saved, [[7, 'Company template.pptx', ['Title and content', 'Two content']]]);
    assert.equal(v.of('pitch-template-line'), '2 layouts saved for this venture.');
  } finally { await v.unmount(); }
});

test('4. the Brand kit’s switches: only the admin presses them; a locked palette’s fields are not editable', async () => {
  // Mutation checked: the switches enabled for everyone → the disabled check fails; the palette input not disabled → its check fails.
  const kit = { status: 'ok', data: { kit: { deck: { palette: { accent: '#2563eb' } } }, font_options: ['Inter'] }, retry() {} };
  const setLock = [];
  let canLock = false;
  let palette = null;
  deckBrandLocksApi.locks = async () => ({ locks: { fonts: null, palette, logo: null }, can_lock: canLock, admins_only: ADMINS_ONLY });
  deckBrandLocksApi.setLock = async (pid, part, locked) => { setLock.push([pid, part, locked]); palette = locked ? { part, by: 'Olu Owner', at: 'x' } : null; return {}; };
  let v = await mount(h(BrandKitSheet, { projectId: 7, kit, readOnly: false, onClose() {} }));
  try {
    assert.equal(v.pr(v.by('pitch-brand-lock-palette')).disabled, true, 'not the admin');
    assert.equal(v.pr(v.by('pitch-brand-lock-palette')).title, ADMINS_ONLY);
    assert.match(v.of('pitch-brand-locks'), /Only the venture’s admins can lock\./);
  } finally { await v.unmount(); }
  canLock = true;
  deckBrandLocksApi.locks = async () => ({ locks: { fonts: null, palette, logo: null }, can_lock: canLock });
  deckBrandLocksApi.setLock = async (pid, part, locked) => { setLock.push([pid, part, locked]); palette = locked ? { part, by: 'Olu Owner', at: 'x' } : null; return {}; };
  v = await mount(h(BrandKitSheet, { projectId: 7, kit, readOnly: false, onClose() {} }));
  try {
    assert.equal(v.pr(v.by('pitch-brand-lock-palette')).disabled, false);
    assert.equal(v.pr(v.by('pitch-brand-palette-accent')).disabled, false);
    await v.press('pitch-brand-lock-palette');
    assert.deepEqual(setLock, [[7, 'palette', true]]);
    assert.equal(v.of('pitch-brand-lock-tag-palette'), 'Locked by Olu Owner');
    assert.equal(v.pr(v.by('pitch-brand-lock-palette'))['aria-checked'], true);
    assert.equal(v.pr(v.by('pitch-brand-palette-accent')).disabled, true, 'a locked palette is not edited here');
  } finally { await v.unmount(); }
});
