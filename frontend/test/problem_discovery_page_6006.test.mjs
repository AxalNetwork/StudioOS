/**
 * #6006 part 2 (V17, V19): Problem discovery's ranked list and the theme record, drawn from part 1's read.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/problem_discovery_page_6006.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { RECORDS, hypothesesCell, severityPill, sourcesLine, themeNotes } from '../src/pages/cycles/adapters/validate.js';
import { Cell } from '../src/pages/cycles/CycleModulePage.jsx';
import { phoneRow } from '../src/pages/cycles/PhoneModulePage.jsx';
import { cellView } from '../src/pages/cycles/cycleModel.js';
import { PainThemesSection, SelectionBar, ThemeRecordParts } from '../src/pages/cycles/ValidateSections.jsx';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const row = RECORDS['problem-discovery'].row;
const THEME = {
  id: 12, theme: 'Matching carrier invoices by hand', mentions: 7, severity: 'severe', trend: 3, supports: ['H1'], contradicts: null,
  grouped: true, rank: 1, rank_reason: 'Most mentions · 6 from ICP · mostly Severe',
  sources: { interviews: 7, people: 7, organisations: null, people_unrecorded: 0, organisations_unrecorded: 7 }, supporting: 1, contradicting: 0,
};
const LOOSE = { id: null, theme: 'Re-keying PDFs into the ERP', mentions: 2, severity: null, trend: 2, supports: [], contradicts: null, grouped: false, rank: 4, rank_reason: '2 mentions', sources: { interviews: 2, people: 2, organisations: 2 } };

test('a ranked theme says why it ranks there and names its sources beside its mentions', () => {
  const r = row(THEME, 0);
  assert.equal(r.recordId, '12');
  assert.deepEqual(cellView(r.cells.theme).note, ['Why rank 1: Most mentions · 6 from ICP · mostly Severe']);
  assert.equal(cellView(r.cells.mentions).text, '7 interviews');
  assert.deepEqual(cellView(r.cells.mentions).note, ['7 people · organisations not recorded']);
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(Cell, { cell: r.cells.theme, first: true })));
  assert.match(html, /data-testid="cell-note">Why rank 1: Most mentions/);
});

test('a phrase in no theme ranks as its own row, says Not grouped and opens no record', () => {
  const r = row(LOOSE, 3);
  assert.equal(r.recordId, null, 'the Worker sends no id, so the row links nowhere');
  assert.deepEqual(themeNotes(LOOSE), ['#4 · Not grouped · no record to open']);
  assert.equal(cellView(r.cells.mentions).note, undefined, 'no sources line for a loose phrase');
  assert.equal(cellView(r.cells.severity).nr, true, 'an unjudged loose phrase shows Not recorded, not a pill');
});

test('severity carries a word and a glyph; hypotheses read in both directions with their counts', () => {
  assert.deepEqual(severityPill('severe'), { text: '●●● Severe', tone: 'v1' });
  assert.deepEqual(severityPill('mild'), { text: '●○○ Mild', tone: 'v3' });
  assert.deepEqual(severityPill(null), { text: '○ Not judged', tone: 'grey' });
  assert.deepEqual(hypothesesCell({ supports: ['H3'], contradicts: ['H2'], supporting: 1, contradicting: 1 }),
    { text: '+ H3 · − H2', note: '1 supporting · 1 contradicting' });
  assert.deepEqual(hypothesesCell({ supports: [], contradicts: null }), { text: 'No hypothesis linked' });
  assert.equal(sourcesLine(null), null);
});

test('on a phone the rank reason follows the mentions line', () => {
  const cols = [{ key: 'theme', label: 'Theme' }, { key: 'mentions', label: 'Mentions' }, { key: 'severity', label: 'Severity' }];
  const view = phoneRow(cols, row(THEME, 0));
  assert.equal(view.description, '7 interviews · Why rank 1: Most mentions · 6 from ICP · mostly Severe');
});

const PARTS = {
  can_write: true,
  stats: { themes: 4, interviews: 12, ungrouped: 3, need_themes: 2, icp_themes: 4, fit_unrecorded_themes: 2 },
  themes: [{ id: 12, title: 'Matching carrier invoices by hand' }],
  unthemed: [{ interview_id: 41, phrase: 'we re-key every PDF', interviewee: 'Ana', date: '2026-11-10' }, { interview_id: 42, phrase: 'surcharges change weekly', interviewee: 'Karl', date: null }],
  unthemed_total: 2,
};

test('the strip names what each tile counts, and a writer picks quotes by box', () => {
  const html = ssr(h(PainThemesSection, { parts: PARTS, onExport: () => {}, onAssign: () => {}, onAssignMany: () => {} }));
  assert.match(html, />Phrases in no theme<[\s\S]*?distinct phrases, all time/);
  assert.match(html, /not the same as “Phrases in no theme” above/);
  assert.equal((html.match(/data-testid="validate-select-quote"/g) || []).length, 2);
  assert.match(html, /data-testid="validate-selection-empty"/);
  const reader = ssr(h(PainThemesSection, { parts: { ...PARTS, can_write: false }, onExport: () => {}, onAssign: () => {}, onAssignMany: () => {} }));
  assert.doesNotMatch(reader, /validate-select-quote|we re-key every PDF|Export map/, 'a reader gets no boxes, no quotes and no export');
});

async function mountBar(props) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(SelectionBar, props)); });
  const reactProps = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  const nodes = () => { const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (node) => (node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '');
  const by = (id) => nodes().find((n) => reactProps(n)?.['data-testid'] === id) || null;
  const byRole = (role) => nodes().find((n) => reactProps(n)?.role === role) || null;
  const byTag = (tag) => nodes().find((n) => String(n.tagName || n.nodeName || '').toLowerCase() === tag) || null;
  const fire = async (el, key, event) => { assert.ok(el, `found a node for ${key}`); await act(async () => { await reactProps(el)[key](event); }); };
  return { by, byRole, byTag, fire, text: () => text(container), close: () => { act(() => root.unmount()); restore(); } };
}

test('the selection bar assigns the chosen set to a theme, or to a new theme it names, in one write', async () => {
  const sent = [];
  const cleared = [];
  const selected = PARTS.unthemed;
  const m = await mountBar({ selected, themes: PARTS.themes, onAssignMany: async (b) => { sent.push(b); }, onClear: () => cleared.push(1) });
  try {
    assert.match(m.text(), /2 selected/);
    await m.fire(m.by('validate-assign-theme'), 'onChange', { target: { value: '12' } });
    assert.deepEqual(sent[0], { phrases: ['we re-key every PDF', 'surcharges change weekly'], group_id: 12 });
    assert.equal(cleared.length, 1, 'a saved assign clears the selection');
    await m.fire(m.by('validate-new-theme-from-selected'), 'onClick', {});
    await m.fire(m.by('validate-new-theme-title'), 'onChange', { target: { value: '  Re-keying invoices  ' } });
    await m.fire(m.byTag('form'), 'onSubmit', { preventDefault() {} });
    assert.deepEqual(sent[1], { phrases: ['we re-key every PDF', 'surcharges change weekly'], new_title: 'Re-keying invoices' });
  } finally { m.close(); }
});

test('a refused assign keeps the selection and shows the Worker sentence', async () => {
  const cleared = [];
  const m = await mountBar({ selected: PARTS.unthemed.slice(0, 1), themes: PARTS.themes, onAssignMany: async () => { throw new Error('Choose at most 100 phrases.'); }, onClear: () => cleared.push(1) });
  try {
    await m.fire(m.by('validate-assign-theme'), 'onChange', { target: { value: '12' } });
    assert.match(m.text(), /Choose at most 100 phrases\./);
    assert.ok(m.byRole('alert'), 'the failure is an alert');
    assert.equal(cleared.length, 0);
  } finally { m.close(); }
});

const RECORD_PARTS = {
  sources: { interviews: 7, people: 7, organisations: 6, people_unrecorded: 0, organisations_unrecorded: 1 },
  supporting: 1, contradicting: 0,
  used_on_slide: { state: 'unavailable', reason: 'Not tracked per theme yet. The deck reads the themes as a whole.', slide: 'problem' },
};

test('the theme record: sources, links, Used on slide as Unavailable with its reason, and handoffs that keep the venture', () => {
  const html = ssr(h(ThemeRecordParts, { parts: RECORD_PARTS, projectId: 7, canWrite: true }));
  assert.match(html, /7 interviews[\s\S]*?7 people · 6 organisations/);
  assert.match(html, /1 supporting · 0 contradicting/);
  assert.match(html, /Unavailable\.<\/b> Not tracked per theme yet\. The deck reads the themes as a whole\./);
  assert.match(html, /href="\/validate\/ideal-customer-profile\?project_id=7"[^>]*>See who has it/);
  assert.match(html, /href="\/validate\/experiments\/new\?project_id=7"[^>]*>Write a hypothesis from this/);
  assert.match(html, /href="\/raise\/pitch\/edit\?project_id=7"/);
  const reader = ssr(h(ThemeRecordParts, { parts: RECORD_PARTS, projectId: 7, canWrite: false }));
  assert.doesNotMatch(reader, /Write a hypothesis/, 'a reader gets no write handoff');
  assert.match(reader, /See who has it/);
  const unknown = ssr(h(ThemeRecordParts, { parts: { ...RECORD_PARTS, sources: { interviews: 2, people: null, organisations: null } }, projectId: 7 }));
  assert.match(unknown, /people not recorded · organisations not recorded/);
});
