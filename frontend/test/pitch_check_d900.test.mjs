/**
 * D900 (#2679, part 6 of #2434) — PD13, the deck's Check panel, and PD2's
 * check pills and Checks column:
 *
 *   - a Mismatch shows both figures and both sources, presuming neither right;
 *   - the founder's panel runs the check on open; anyone else reads states;
 *   - "Use Stripe's figure" says what changes, is held while edits are
 *     unsaved, and opens the new version;
 *   - "Keep mine, with a note" asks for the note, then checks again;
 *   - a version never checked is "Not checked", never zeros.
 *
 * Every name and figure is synthetic. The APIs are stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_check_d900.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import CheckPanel from '../src/pages/raise/pitch/CheckPanel.jsx';
import { deckCheckApi } from '../src/lib/api/deckCheck.js';
import { raiseEvidenceApi } from '../src/lib/api/raiseEvidence.js';
import {
  NOT_CHECKED, NO_FIGURES, checkNote, checkPills, checksByDeck, checksCell, claimLine, lastChecked, recordSource, sortClaims, summaryLine, useRecordLabel,
} from '../src/pages/raise/pitch/checkModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const MISMATCH = {
  uid: 'c1', slide: 2, figure: 'paying_customers', label: 'Paying customers', state: 'mismatch', display_state: 'mismatch', stale: false,
  stated_value: '42', stated_shown: '42', record: { value: 38, shown: '38', source_label: 'connector', provider: 'stripe', observed_on: '2026-10-20', items: ['item1'] },
  note: null, note_outdated: false,
};
const NOT_BACKED = { uid: 'c2', slide: 2, figure: 'raise', label: 'The raise', state: 'not_backed', display_state: 'not_backed', stale: false, stated_shown: '$2,000,000', record: null, note: null };
const BACKED = { uid: 'c3', slide: 1, figure: 'mrr', label: 'MRR', state: 'backed', display_state: 'backed', stale: false, stated_shown: '$10,000', record: { value: 10000, shown: '$10,000', source_label: 'connector', provider: 'stripe', observed_on: '2026-10-20' }, note: null };
const STALE = { ...BACKED, uid: 'c4', slide: 3, display_state: 'stale', stale: true };
const RUN = (over = {}) => ({
  deck_id: 21, version: 'v2', outcome: 'recorded', checked: true, checked_at: '2026-10-27 14:05:00', can_check: true,
  counts: { backed: 1, founders_figure: 0, mismatch: 1, not_backed: 1, stale: 1 }, figures: 4, claims: [BACKED, NOT_BACKED, MISMATCH, STALE], ...over,
});

function stub(over = {}) {
  const calls = [];
  const rec = (name, f) => async (...args) => { calls.push([name, ...args]); return (over[name] || f)(...args); };
  Object.assign(deckCheckApi, {
    run: rec('run', async () => RUN()),
    // #3657: the read is the Worker's answer on who checks; the default reader here is the founder.
    read: rec('read', async () => ({ ...RUN(), can_check: true, claims: [{ uid: 'c1', slide: 2, figure: 'paying_customers', label: 'Paying customers', state: 'mismatch', display_state: 'mismatch' }] })),
    useRecord: rec('useRecord', async () => ({ deck: { id: 40, version: 4 } })),
  });
  Object.assign(raiseEvidenceApi, { note: rec('note', async () => ({ ok: true })) });
  return calls;
}

async function mount(props) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(CheckPanel, { deck: { id: 21 }, projectId: 7, readOnly: false, dirty: false, ...props }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    by, props: (id) => pr(need(id)),
    text: (id) => txt(id ? need(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

// ------------------------------------------------------------------ the model

test('the words: both figures and sources on a Mismatch, neither presumed right; never zeros for a version not checked', () => {
  assert.equal(recordSource(MISMATCH.record), 'Stripe');
  assert.equal(recordSource({ provider: null, source_label: 'document' }), 'Document');
  assert.equal(useRecordLabel(MISMATCH.record), 'Use Stripe’s figure');
  assert.equal(claimLine(MISMATCH), 'Card 2 says 42. Stripe says 38 as of 2026-10-20. Neither figure is presumed right.');
  assert.match(claimLine(NOT_BACKED), /No pinned evidence measures this figure/);
  assert.match(claimLine(STALE), /changed since it was bound/);
  assert.equal(claimLine(BACKED), 'Backed by Stripe, as of 2026-10-20.');
  assert.equal(summaryLine(RUN().counts, 4), '4 figures: 1 Backed, 1 Mismatch, 1 Not backed, 1 Stale');
  assert.equal(summaryLine({}, 0), 'This version states no figure the check reads.');
  assert.equal(summaryLine(null, 3), null);
  assert.deepEqual(checkPills({ backed: 9, founders_figure: 0, mismatch: 1 }).map((p) => p.label), ['9 Backed', '1 Mismatch']);
  assert.equal(checksCell(undefined), NOT_CHECKED);
  assert.equal(checksCell({ checked: false, counts: null }), NOT_CHECKED);
  assert.equal(checksCell({ checked: true, counts: { backed: 0, mismatch: 0 } }), NO_FIGURES);
  assert.equal(checksCell({ checked: true, counts: { backed: 2, mismatch: 1, not_backed: 0 } }), '2 Backed · 1 Mismatch');
  assert.equal(checksByDeck({ versions: [{ deck_id: 21, checked: true }] }).get(21).checked, true);
  assert.equal(checksByDeck({}), null, 'a malformed read is not "Not checked"');
  assert.deepEqual(sortClaims([BACKED, NOT_BACKED, MISMATCH, STALE]).map((c) => c.uid), ['c1', 'c4', 'c2', 'c3']);
  assert.equal(lastChecked(null), NOT_CHECKED);
  assert.equal(lastChecked('2026-10-27 14:05:00'), 'Last checked 27 Oct 2026, 14:05 UTC');
  assert.deepEqual(checkNote('  '), { error: 'Say why you keep your figure.' });
  assert.match(checkNote('x'.repeat(501)).error, /at most 500/);
  assert.deepEqual(checkNote(' Trials convert after the sync. '), { note: 'Trials convert after the sync.' });
});

// ------------------------------------------------------------------ PD13

test('the founder\'s panel runs the check on open: the counts, each figure, and a Mismatch with both figures', async () => {
  const calls = stub();
  const v = await mount({});
  try {
    assert.deepEqual(calls.map((c) => c[0]), ['read', 'run'], 'the read says founder, then the run (#3657)');
    assert.equal(v.text('pitch-check-last'), 'Last checked 27 Oct 2026, 14:05 UTC');
    assert.match(v.text('pitch-check-summary'), /4 figures: 1 Backed, 1 Mismatch, 1 Not backed, 1 Stale/);
    assert.match(v.text('pitch-check-figures-c1'), /Your card 42 Stripe 38 · 2026-10-20/);
    assert.match(v.text('pitch-check-row-c1'), /Neither figure is presumed right\./);
    assert.equal(v.text('pitch-check-use-c1'), 'Use Stripe’s figure');
    assert.ok(v.by('pitch-check-keep-c1'));
    assert.ok(!v.by('pitch-check-use-c2'), 'only a Mismatch offers the record\'s figure');
    assert.ok(!v.by('pitch-check-use-c3') && !v.by('pitch-check-keep-c3'), 'a Backed figure with a record is offered nothing');
    assert.match(v.text('pitch-check-row-c4'), /Stale/);
    assert.equal(v.props('pitch-check-evidence-c1').to ?? v.props('pitch-check-evidence-c1').href, '/raise/evidence/claim/c1?project=7');
    await v.click('pitch-check-run');
    assert.deepEqual(calls.map((c) => c[0]), ['read', 'run', 'run']);
  } finally { await v.close(); }
});

test('a reader who is not the founder reads states only: no run, no figures, no actions', async () => {
  const calls = stub();
  const v = await mount({ readOnly: true });
  try {
    assert.deepEqual(calls.map((c) => c[0]), ['read']);
    assert.ok(!v.by('pitch-check-run'));
    assert.ok(!v.by('pitch-check-use-c1') && !v.by('pitch-check-keep-c1'));
    assert.ok(!v.by('pitch-check-figures-c1'));
  } finally { await v.close(); }
  // Read only means read only, whatever the read says.
  stub({ read: async () => RUN() });
  const r = await mount({ readOnly: true });
  try {
    assert.ok(!r.by('pitch-check-run'));
    assert.ok(!r.by('pitch-check-use-c1') && !r.by('pitch-check-keep-c1'));
  } finally { await r.close(); }
});

test('Use Stripe\'s figure says what changes, waits for unsaved edits, then opens the new version', async () => {
  const calls = stub();
  let opened = null;
  const dirty = await mount({ dirty: true });
  try {
    await dirty.click('pitch-check-use-c1');
    assert.match(dirty.text('pitch-check-use-dialog'), /Card 2 says 42\. Stripe says 38, as of 2026-10-20\./);
    assert.match(dirty.text('pitch-check-use-dialog'), /a new version is saved\. This version stays as it is\./);
    assert.ok(dirty.by('pitch-check-use-dirty'));
    assert.equal(dirty.props('pitch-check-use-confirm').disabled, true, 'held while edits are unsaved');
  } finally { await dirty.close(); }
  const v = await mount({ onReplaced: (d) => { opened = d; } });
  try {
    await v.click('pitch-check-use-c1');
    await v.click('pitch-check-use-confirm');
    assert.deepEqual(calls.filter((c) => c[0] === 'useRecord').map((c) => c.slice(1)), [[21, 'c1', 38]], 'the figure the dialog showed');
    assert.deepEqual(opened, { id: 40, version: 4 });
  } finally { await v.close(); }
});

test('a refused swap says why in the Worker\'s words, and nothing opens', async () => {
  stub({ useRecord: async () => { throw new Error('The record’s figure changed since you opened this. Run the check again.'); } });
  let opened = null;
  const v = await mount({ onReplaced: (d) => { opened = d; } });
  try {
    await v.click('pitch-check-use-c1');
    await v.click('pitch-check-use-confirm');
    assert.equal(v.text('pitch-check-use-error'), 'The record’s figure changed since you opened this. Run the check again.');
    assert.equal(opened, null);
  } finally { await v.close(); }
});

test('Keep mine, with a note asks for the note, saves it, and checks again; a kept figure shows its note', async () => {
  let kept = false;
  const calls = stub({ run: async () => (kept ? RUN({ claims: [{ ...MISMATCH, note: { text: 'Trials convert after the sync.', at: '2026-10-27 14:06:00' } }] }) : RUN()) });
  const v = await mount({});
  try {
    await v.click('pitch-check-keep-c1');
    assert.match(v.text('pitch-check-keep-dialog'), /It stays a Mismatch with Stripe’s 38, shown with your note\./);
    await v.click('pitch-check-keep-confirm');
    assert.equal(v.text('pitch-check-keep-error'), 'Say why you keep your figure.');
    assert.equal(calls.filter((c) => c[0] === 'note').length, 0);
    await v.type('pitch-check-keep-note', ' Trials convert after the sync. ');
    kept = true;
    await v.click('pitch-check-keep-confirm');
    assert.deepEqual(calls.filter((c) => c[0] === 'note').map((c) => c.slice(1)), [[7, 'c1', 'Trials convert after the sync.']]);
    assert.ok(!v.by('pitch-check-keep-dialog'));
    assert.match(v.text('pitch-check-note-c1'), /Kept, with your note: Trials convert after the sync\./);
    assert.ok(!v.by('pitch-check-keep-c1'), 'a kept figure is not offered Keep again');
    assert.equal(v.text('pitch-check-row-c1').includes('Mismatch'), true, 'still a Mismatch');
  } finally { await v.close(); }
});

test('a failed check says so with Try again, never an empty panel', async () => {
  stub({ run: async () => { throw new Error('This version’s slides could not be read, so nothing was checked. Its last check stands.'); } });
  const v = await mount({});
  try {
    assert.match(v.text('pitch-check-error'), /slides could not be read/);
    assert.ok(v.by('pitch-check-retry'), 'Try again');
    // #3657: the panel read the last check first, so it still stands under the error.
    assert.match(v.text('pitch-check-summary'), /4 figures/);
  } finally { await v.close(); }
});

test('the source: the editor opens Check from ⋯ › Check claims, PD2 draws the pills and the Checks column, the dialogs are in-page', () => {
  // D1604 (#3716): the right panel's Check tab moved behind ⋯, a sheet that mounts the same panel.
  const editor = read('../src/pages/raise/pitch/PitchEditor.jsx');
  assert.doesNotMatch(editor, /\['check', 'Check'\]/, 'no Check tab');
  assert.match(editor, /\{sheet === 'check' && base\.deck\?\.id \? \(\s*<CheckSheet deck=\{base\.deck\}/);
  // D1555 (#3802): the sheet also passes Go to card for the Consistency findings.
  assert.match(read('../src/pages/raise/pitch/DeckSheets.jsx'), /<CheckPanel key=\{deck\.id\} deck=\{deck\} projectId=\{projectId\} readOnly=\{readOnly\} dirty=\{dirty\} onReplaced=\{onReplaced\} onGoToCard=\{onGoToCard\} \/>/);
  assert.match(read('../src/pages/raise/pitch/deckV2Model.js'), /\{ id: 'check', label: 'Check claims', note: 'Free checks' \}/);
  // D1604 (#3716, pd1): the pills are on the home's deck card, the Checks column in ⋯ › Versions…'s table.
  assert.match(read('../src/pages/raise/pitch/StudioHome.jsx'), /<CheckPills /);
  const table = read('../src/pages/raise/pitch/DeckVersions.jsx');
  assert.match(table, />Checks<\/th>/);
  assert.match(table, /pitch-studio-version-checks-/);
  const panel = read('../src/pages/raise/pitch/CheckPanel.jsx');
  assert.doesNotMatch(panel, /window\.(confirm|prompt|alert)/);
  assert.equal((panel.match(/<Lightbox /g) || []).length, 2);
});
