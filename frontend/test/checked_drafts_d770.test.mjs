/**
 * D770 (#2095, D720 F3 §6), PR 2 — a draft is checked before it is shown.
 * While a fill band's or a zone draft's run is in flight, the band says
 * "Eadwyn is checking this draft." and every Accept waits; a withheld output
 * shows the guard's own words and link, never the draft. The Worker's side is
 * `founder_draft_surfaces.test.ts` and `founder_validate_proposals.test.mjs`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/checked_drafts_d770.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import FillProposals from '../src/workspaces/FillProposals.jsx';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';
import { CHECKING, GUARD_REFUSALS, guardRefusal } from '../src/workspaces/draftCheck.js';

const h = React.createElement;
const GUARD_OUTPUT = "I wrote something I can't show you, so I've held it back. Try asking another way.";

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = (pred) => walk(container).filter(pred);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, all, settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    // Starts a click and returns its promise unawaited, so a test can look while the run is in flight.
    press(n) { let p; act(() => { p = pr(n).onClick?.({ preventDefault() {} }); }); return p; },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

/** A promise the test settles by hand: the run "in flight". */
function gate() { let open; const p = new Promise((r) => { open = r; }); return { p, open }; }
const guardError = (code, words, link = { href: '/settings/safety', label: 'Open Wellbeing' }) => Object.assign(new Error(words), { code, data: { detail: code, message: words, link } });

test('guardRefusal: the two output refusals, by detail code or the propose body, with a same-site link only', () => {
  assert.deepEqual([...GUARD_REFUSALS], ['guard_blocked_output', 'guard_unavailable']);
  assert.deepEqual(guardRefusal(guardError('guard_blocked_output', GUARD_OUTPUT)), { code: 'guard_blocked_output', message: GUARD_OUTPUT, link: { href: '/settings/safety', label: 'Open Wellbeing' } });
  const propose = Object.assign(new Error('x'), { data: { ok: false, refusal: 'guard_unavailable', message: 'x' } });
  assert.equal(guardRefusal(propose).code, 'guard_unavailable');
  for (const href of ['https://evil.test/', '//evil.test', 'javascript:alert(1)']) {
    assert.equal(guardRefusal(guardError('guard_blocked_output', 'w', { href, label: 'L' })).link, null, href);
  }
  for (const e of [new Error('x'), Object.assign(new Error('x'), { code: 'nothing_to_draft' }), Object.assign(new Error('x'), { data: { refusal: 'guard_blocked' } }), null]) {
    assert.equal(guardRefusal(e), null);
  }
});

test('a zone draft: checking while the run is in flight, then the draft; a withheld one shows the guard\'s words and never its text', async () => {
  const orig = { ...api.research };
  const g = gate();
  api.research.zoneDrafts = async () => ({ items: [] });
  api.research.zoneDraftRun = () => g.p;
  const m = await mount(h(ZoneDraft, { surface: 'build/retro', label: 'Retro', empty: 'Nothing yet.', run: 'Draft it' }));
  try {
    assert.ok(!m.by('zone-draft-checking'), 'nothing to check before a run');
    const run = m.all((n) => n.tagName === 'BUTTON' && m.text(n) === 'Draft it')[0];
    const pending = m.press(run);
    await m.settle();
    assert.equal(m.text(m.by('zone-draft-checking')), CHECKING);
    assert.equal(m.pr(m.by('zone-draft-checking')).role, 'status');
    assert.ok(!m.text().includes('a drafted paragraph'));
    g.open({ item: { uid: 'd1', body: 'a drafted paragraph', accepted: false, cost_usd: 0 } });
    await act(async () => { await pending; });
    await m.settle();
    assert.ok(!m.by('zone-draft-checking'), 'checked');
    assert.ok(m.text().includes('a drafted paragraph'));
  } finally { await m.unmount(); }

  api.research.zoneDraftRun = async () => { throw guardError('guard_blocked_output', GUARD_OUTPUT); };
  const w = await mount(h(ZoneDraft, { surface: 'build/retro', label: 'Retro', empty: 'Nothing yet.', run: 'Draft it' }));
  try {
    await act(async () => { await w.press(w.all((n) => n.tagName === 'BUTTON' && w.text(n) === 'Draft it')[0]); });
    await w.settle();
    assert.equal(w.text(w.by('zone-draft-note')), `${GUARD_OUTPUT} Open Wellbeing`, 'the guard\'s words and link');
    assert.equal(w.pr(w.all((n) => n.tagName === 'A')[0]).href, '/settings/safety');
    assert.ok(!w.text().includes('That draft could not be written right now.'));
    assert.ok(!w.all((n) => n.tagName === 'BUTTON' && /Accept/.test(w.text(n))).length, 'nothing to accept');
  } finally { await w.unmount(); Object.assign(api.research, orig); }
});

test('a fill band: every Accept waits while a run is checked, and a withheld run shows the guard\'s words', async () => {
  const orig = { list: api.listValidateProposals, propose: api.proposeValidate };
  const KINDS = { hypothesis: { task: 'validate_draft_hypotheses', copy: { heading: 'Hypotheses', run: 'Propose', accept: 'Add it', empty: 'None yet.' } } };
  api.listValidateProposals = async () => ({ proposals: [{ id: 5, kind: 'hypothesis', payload: { claim: 'Founders lose a day a week' } }], kinds: KINDS });
  const g = gate();
  api.proposeValidate = () => g.p;
  const m = await mount(h(FillProposals, { projectId: 9, kind: 'hypothesis', enabled: true }));
  try {
    assert.equal(m.pr(m.by('action-accept-5')).disabled, false, 'before a run, Accept is open');
    const pending = m.press(m.by('action-propose-hypothesis'));
    await m.settle();
    assert.equal(m.text(m.by('proposals-checking-hypothesis')), CHECKING);
    assert.equal(m.pr(m.by('action-accept-5')).disabled, true, 'Accept waits for the check');
    g.open({ proposals: [], usage: null });
    await act(async () => { await pending; });
    await m.settle();
    assert.ok(!m.by('proposals-checking-hypothesis'));
    assert.equal(m.pr(m.by('action-accept-5')).disabled, false, 'and opens when it passes');
  } finally { await m.unmount(); }

  api.proposeValidate = async () => { throw Object.assign(new Error(GUARD_OUTPUT), { data: { ok: false, refusal: 'guard_blocked_output', message: GUARD_OUTPUT, link: { href: '/settings/safety', label: 'Open Wellbeing' } } }); };
  const w = await mount(h(FillProposals, { projectId: 9, kind: 'hypothesis', enabled: true }));
  try {
    await act(async () => { await w.press(w.by('action-propose-hypothesis')); });
    await w.settle();
    assert.equal(w.text(w.by('proposals-note-hypothesis')), `${GUARD_OUTPUT} Open Wellbeing`);
  } finally { await w.unmount(); api.listValidateProposals = orig.list; api.proposeValidate = orig.propose; }
});
