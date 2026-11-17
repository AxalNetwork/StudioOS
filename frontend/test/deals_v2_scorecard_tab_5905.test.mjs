/**
 * D4815 part 51 (#5905) — the deal page's Scorecard tab redrawn to board DE05
 * (canvas section DX5): the eleven scopes in SCORING's order with no overall
 * score; per scope the shared score (band and confidence, or the state's own
 * word), the value when valid, coverage, change and the evidence's grades;
 * the five states kept apart (Scored, Not enough recorded, Not expected yet,
 * Locked, Unreadable); each scope expanding in place into its evidence; and
 * Team, Market and Traction's context one link away.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_scorecard_tab_5905.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import VentureScorecard from '../src/components/scoring/scorecard/Scorecard.jsx';
import {
  CHANGE_NOT_RECORDED, SCOPES, evidenceOf, inputOf, scoreCellOf, scopeOf, valueOf,
} from '../src/components/scoring/scorecard/scorecardModel.js';

const h = React.createElement;
const AT = '2026-10-27T09:40:00Z';
const TEAM_INPUTS = [
  { key: 'function_coverage', label: 'Function coverage', personal: true, shown: false, state: 'recorded', band: 'Fair' },
  { key: 'build_evidence', label: 'Build evidence', state: 'recorded', value: 80, grade: 'measured', as_of: '2026-10-20', words: '212 commits in 90 days.', weight: 20, contribution: 16 },
  { key: 'experience', label: 'Experience linked to skills', state: 'not_recorded', value: null, grade: 'not_recorded', reason: 'No experience entry is linked to a skill yet.', weight: 15 },
  { key: 'archetype_mix', label: 'Archetype mix', state: 'recorded', value: 60, grade: 'stated', as_of: '2026-04-01', words: 'Builder and Operator.', weight: 10, contribution: 6, stale: true },
];
const scored = (scope, value, band, word, extra = {}) => ({ scope, state: 'scored', value, band, confidence_word: word, coverage: { present: 3, applies: 4 }, computed_at: AT, masked: false, review: null, inputs: [], ...extra });
const OPEN = {
  project_id: 7, deal_id: 4, locked: false, nda: true, model: '1.0',
  scopes: [
    scored('team', 62, 'Fair', 'Medium', { inputs: TEAM_INPUTS }),
    scored('market', 74, 'Strong', 'High'),
    scored('pmf', 64, 'Fair', 'Medium', { inputs: [{ key: 'icp', label: 'ICP interviews held', group: 'who', state: 'recorded', value: 70, grade: 'measured', as_of: '2026-10-10', weight: 10, contribution: 7 }] }),
    scored('technical', 55, 'Fair', 'Medium'),
    { scope: 'traction', state: 'unreadable', masked: false, review: null },
    scored('financial', 58, 'Fair', 'Low'),
    scored('risk', 51, 'Fair', 'Medium'),
    { scope: 'geographic', state: 'not_enough', band: null, confidence_word: null, value: null, masked: false, review: null, inputs: [] },
    { scope: 'political', state: 'not_expected', band: null, confidence_word: null, value: null, masked: false, review: null, inputs: [] },
    scored('governance', 81, 'Strong', 'High'),
    { scope: 'legal_ip', state: 'not_read', masked: false, review: null, inputs: [] },
  ],
};
const MASKED = {
  ...OPEN, nda: false,
  scopes: OPEN.scopes.filter((s) => s.scope !== 'traction').map((s) => ({ scope: s.scope, state: s.state, band: s.band ?? null, confidence_word: s.confidence_word ?? null, masked: true, review: null })),
};

// ------------------------------------------------------------------ the model

test('scoreCellOf: the five states DE05 keeps apart, and a scope never scored, each its own kind and word', () => {
  const cell = (raw) => scoreCellOf(scopeOf(raw, raw.scope));
  assert.deepEqual(cell(scored('market', 74, 'Strong', 'High')), { kind: 'scored', word: 'Strong', band: 'Strong', confidence: 'High', title: 'Market: Strong, high confidence' });
  assert.equal(cell(scored('risk', 51, 'Fair', 'Medium')).word, 'Medium risk', 'Risk reads in its risk word');
  assert.equal(cell({ scope: 'geographic', state: 'not_enough' }).kind, 'not_enough');
  assert.equal(cell({ scope: 'geographic', state: 'not_enough' }).word, 'Not enough recorded');
  assert.equal(cell({ scope: 'political', state: 'not_expected' }).word, 'Not expected yet');
  assert.equal(cell({ scope: 'traction', state: 'unreadable' }).kind, 'unreadable');
  assert.equal(cell({ scope: 'legal_ip', state: 'not_read' }).word, 'Not scored yet');
  assert.equal(cell({ scope: 'team', state: 'scored', value: 40, band: 'Fair', confidence_word: null }).kind, 'not_enough', 'a value with no confidence is never a band');
  assert.equal(scoreCellOf(null).kind, 'not_scored');
  const kinds = new Set([cell(scored('team', 62, 'Fair', 'Medium')).kind, cell({ scope: 'geographic', state: 'not_enough' }).kind, cell({ scope: 'political', state: 'not_expected' }).kind, valueOf(scopeOf(scored('team', 62, 'Fair', 'Medium'), 'team'), true).cell.kind, cell({ scope: 'traction', state: 'unreadable' }).kind]);
  assert.equal(kinds.size, 5, 'five states, five kinds');
});

test('valueOf and evidenceOf: the value only when valid, Locked before the NDA; the evidence as its grades, never a value', () => {
  const team = scopeOf(scored('team', 62.4, 'Fair', 'Medium', { inputs: TEAM_INPUTS }), 'team');
  assert.deepEqual(valueOf(team, false), { kind: 'value', text: '62' });
  assert.equal(valueOf(team, true).kind, 'locked');
  assert.equal(valueOf(team, true).cell.word, 'Locked');
  assert.equal(valueOf(scopeOf({ scope: 'geographic', state: 'not_enough' }, 'geographic'), false).kind, 'none');
  assert.equal(valueOf(scopeOf({ ...scored('team', null, 'Fair', 'Medium') }, 'team'), false).kind, 'none', 'no value sent, none drawn');
  assert.equal(valueOf({ key: 'team', state: 'not_enough', value: 40 }, false).kind, 'none', 'a value on a scope that is not scored is never drawn');
  assert.equal(evidenceOf(team, false).text, '1 measured · 1 stated', 'graded inputs only: a personal or missing input is not a grade');
  assert.equal(evidenceOf(team, false).state, 'graded');
  assert.equal(evidenceOf(team, true).text, 'After the NDA');
  assert.equal(evidenceOf(scopeOf(scored('market', 74, 'Strong', 'High'), 'market'), false).text, 'None recorded');
  assert.equal(evidenceOf(scopeOf({ scope: 'political', state: 'not_expected' }, 'political'), false).text, 'Not expected yet');
  assert.equal(evidenceOf({ key: 'team', state: 'scored', inputs: null }, false).text, 'Not read here');
  assert.equal(evidenceOf({ key: 'team', state: 'scored', inputs: [inputOf({ key: 'x', state: 'recorded', value: 1, grade: 'reviewed' })] }, false).text, '1 reviewed');
  assert.match(CHANGE_NOT_RECORDED, /no change since your last visit/);
});

// ------------------------------------------------------------------ mounted

async function mount(deal) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (u, init = {}) => {
    const p = new URL(String(u), 'http://x').pathname;
    calls.push(`${init.method || 'GET'} ${p}`);
    if (p === '/api/venture-scores/deal/4') return json(deal());
    if (p === '/api/venture-scores/weights') return json({ weights: null });
    return json({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/deals/4/scorecard'] }, h(VentureScorecard, { dealId: 4, ndaHref: '/deals/4/documents' }))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    calls, by, props, has: (id) => Boolean(by(id)),
    ids: () => walk(container).map((n) => props(n)['data-testid']).filter(Boolean),
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    page: () => text(container).replace(/\s+/g, ' ').trim(),
    heads: () => walk(container).filter((n) => props(n).role === 'columnheader').map((n) => text(n).trim()),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('mounted, open: eleven scopes in order, DE05\'s columns, the shared score, the value, Change and Evidence; no overall score', async () => {
  const v = await mount(() => OPEN);
  try {
    assert.deepEqual(v.heads(), ['Scope', 'Score', 'Value', 'Coverage', 'Change', 'Evidence', '']);
    assert.deepEqual(v.ids().filter((id) => /^scorecard-scope-/.test(id)), SCOPES.map((s) => `scorecard-scope-${s.key}`), 'SCORING\'s order');
    assert.match(v.of('scorecard-scopes'), /Eleven scopes · no overall score/);
    assert.doesNotMatch(v.page(), /overall (total|score) \d|Overall \d/i);
    // The shared score, one family per state.
    const family = (k) => v.props(v.by(`scorecard-score-${k}`))['data-family'];
    assert.equal(family('team'), 'value');
    assert.equal(family('geographic'), 'not_recorded');
    assert.equal(family('political'), 'not_expected');
    assert.equal(family('traction'), 'unreadable');
    assert.equal(family('legal_ip'), 'missing');
    assert.equal(v.props(v.by('scorecard-score-team'))['aria-label'], 'Team: Fair, medium confidence');
    assert.equal(v.of('scorecard-score-risk'), 'Medium risk · Medium');
    // The value only when valid, never 0 for a missing one.
    assert.equal(v.of('scorecard-value-team'), '62');
    assert.equal(v.of('scorecard-value-geographic'), '—');
    assert.equal(v.of('scorecard-value-legal_ip'), '—');
    assert.equal(v.of('scorecard-change-team'), 'Not recorded');
    assert.equal(v.props(v.by('scorecard-change-team')).title, CHANGE_NOT_RECORDED);
    assert.equal(v.of('scorecard-evidence-state-team'), '1 measured · 1 stated');
    assert.equal(v.of('scorecard-evidence-state-market'), 'None recorded');
    assert.match(v.of('scorecard-scope-team'), /3 of 4 inputs/);
    // An unreadable scope says so with Try again, and is not a disclosure.
    assert.match(v.of('scorecard-scope-traction'), /Traction could not be read\. The other scopes are current\./);
    assert.equal(v.props(v.by('scorecard-scope-traction'))['aria-expanded'], undefined);
    assert.ok(v.has('scorecard-retry-traction'));
  } finally { await v.close(); }
});

test('mounted: a scope expands in place into its evidence and closes again; more than one can be open; the drawer is one step further', async () => {
  const v = await mount(() => OPEN);
  try {
    const row = () => v.props(v.by('scorecard-scope-team'));
    assert.equal(row()['aria-expanded'], false);
    assert.equal(row()['aria-controls'], 'scorecard-evidence-team');
    assert.equal(row().type, 'button', 'a native button: Enter and Space work');
    assert.equal(v.has('scorecard-expansion-team'), false);
    await v.click('scorecard-scope-team');
    assert.equal(row()['aria-expanded'], true);
    assert.equal(v.props(v.by('scorecard-expansion-team')).id, 'scorecard-evidence-team');
    assert.match(v.of('scorecard-expansion-team'), /Build evidence 80 16\.0 pts/);
    assert.match(v.of('scorecard-expansion-team'), /Not recorded · lowers confidence/);
    assert.match(v.of('scorecard-expansion-team'), /Individual skills and values are never shown/);
    assert.equal(v.props(v.by('scorecard-context-team')).href, '/deals/4/team', 'Team\'s context on the Evidence tab');
    await v.click('scorecard-scope-pmf');
    assert.ok(v.has('scorecard-expansion-team') && v.has('scorecard-expansion-pmf'), 'two open at once');
    assert.equal(v.has('scorecard-context-pmf'), false, 'only Team, Market and Traction have a context view');
    assert.equal(v.has('scorecard-drawer-team'), false);
    await v.click('scorecard-detail-team');
    assert.ok(v.has('scorecard-drawer-team'), 'Open full detail opens the drawer');
    await v.click('scorecard-scope-team');
    assert.equal(v.has('scorecard-expansion-team'), false);
    assert.equal(row()['aria-expanded'], false);
    // The context for all three, from the tab itself.
    assert.deepEqual(['team', 'market', 'traction'].map((k) => v.props(v.by(`scorecard-context-link-${k}`)).href), ['/deals/4/team', '/deals/4/market', '/deals/4/traction']);
  } finally { await v.close(); }
});

test('mounted: a scope that becomes unreadable on a re-read closes its evidence and offers Try again', async () => {
  let n = 0;
  const v = await mount(() => { n += 1; return n === 1 ? OPEN : { ...OPEN, scopes: OPEN.scopes.map((s) => (s.scope === 'team' ? { scope: 'team', state: 'unreadable' } : s.scope === 'traction' ? scored('traction', 31, 'Weak', 'Medium') : s)) }; });
  try {
    await v.click('scorecard-scope-team');
    assert.ok(v.has('scorecard-expansion-team'));
    await v.click('scorecard-retry-traction');
    assert.equal(n, 2);
    assert.equal(v.has('scorecard-expansion-team'), false, 'an unreadable scope shows no evidence');
    assert.ok(v.has('scorecard-retry-team'));
    assert.equal(v.of('scorecard-value-traction'), '31');
  } finally { await v.close(); }
});

test('mounted, before the NDA: bands and confidence, the value Locked, the evidence after the NDA, and no figure or input', async () => {
  const v = await mount(() => MASKED);
  try {
    assert.equal(v.props(v.by('scorecard-score-team'))['data-family'], 'value');
    assert.equal(v.of('scorecard-value-team'), 'Locked');
    assert.equal(v.props(v.by('scorecard-value-team').childNodes[0])['data-family'], 'locked', 'the shared score\'s Locked mark');
    assert.equal(v.of('scorecard-evidence-state-team'), 'After the NDA');
    assert.doesNotMatch(v.page(), /\b62\b|\b74\b|\b81\b/);
    await v.click('scorecard-scope-team');
    assert.match(v.of('scorecard-expansion-team'), /open after you sign the NDA/);
    assert.equal(v.props(v.by('scorecard-expansion-nda-team')).href, '/deals/4/documents');
    assert.equal(v.has('scorecard-detail-team'), false);
    assert.equal(v.has('scorecard-input-build_evidence'), false);
  } finally { await v.close(); }
});

test('the part file names the columns, the five states, the gaps and the departures', () => {
  const f = 'documentation/architecture/decisions/D4815-p51.md';
  assert.ok(existsSync(f));
  const d = readFileSync(f, 'utf8');
  assert.match(d, /^## D4815 part 51 — .*\(#4815, #5905\)$/m);
  for (const s of ['DE05', 'Not enough recorded', 'Not expected yet', 'Locked', 'Unreadable', 'Change', '#6173', 'aria-expanded', 'Team, Market and Traction']) assert.ok(d.includes(s), s);
});
