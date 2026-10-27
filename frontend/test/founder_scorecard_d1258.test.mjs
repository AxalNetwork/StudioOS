/**
 * D1258 (#3281) — Venture scorecard part 5: the founder's page live
 * (`/raise/scorecard`, SC8), Ask to correct (SC9), Add review (SC10), Your
 * weighting (SC7), the trajectory (SC12) and an advisor's read-only view
 * (SC21), over part 3's reads (D1256).
 *
 * Mounted against the Worker's own shapes (`routes/venture_scores.ts`
 * fullRead, `/trajectory`, `/sharing`, `/weights`) through a stubbed fetch.
 * Every venture, person and figure is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_scorecard_d1258.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import FounderScorecardPage from '../src/pages/scoring/FounderScorecardPage.jsx';
import AdvisorScorecardPage from '../src/pages/scoring/AdvisorScorecardPage.jsx';
import WeightingControl from '../src/components/scoring/scorecard/Weighting.jsx';
import {
  advisorHref, bandWord, coverageText, equalWeights, inputRow, isEqual, messageProblem, openCorrection, previewRow, reviewBody, reviewLine,
  reviewPreview, reviewProblem, scopeRow, sharingChange, trajectoryOf, trajectoryRows, weightsProblem,
} from '../src/components/scoring/scorecard/founderModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

const KEYS = ['team', 'market', 'pmf', 'technical', 'traction', 'financial', 'risk', 'geographic', 'political', 'governance', 'legal_ip'];
const LABEL = { team: 'Team', market: 'Market', pmf: 'Product-market fit', technical: 'Technical', traction: 'Traction', financial: 'Financial', risk: 'Risk', geographic: 'Geographic', political: 'Political and regulatory', governance: 'Governance', legal_ip: 'Legal and IP' };

const MRR = { key: 'mrr', label: 'MRR', weight: 35, state: 'recorded', value: 74, grade: 'Measured', grade_factor: 1, stale: false, contribution: 25.9, words: '€1,200 this month', reason: null, source: 'connector', as_of: '2026-10-20', personal: false };
const RETENTION = { key: 'retention', label: 'Retention', weight: 15, state: 'not_recorded', value: null, grade: 'Not recorded', grade_factor: 0, stale: false, contribution: null, words: '', reason: 'No renewal has come due yet', source: 'recorded', as_of: null, personal: false };
const SCOPE = (key, extra = {}) => ({ scope: key, model: 'v1', state: 'not_enough', value: null, band: null, confidence: 0.1, confidence_word: null, coverage: { present: 1, applies: 6 }, partial: false, reason: null, inputs: [], changed: false, review: null, ...extra });
const CARD = (extra = {}) => ({
  project_id: 10, viewer: 'founder', read_only: false, model: 'v1', stage: 'build',
  scopes: KEYS.map((k) => (k === 'traction' ? SCOPE(k, { state: 'scored', value: 62, band: 'Fair', confidence: 0.6, confidence_word: 'Medium', coverage: { present: 3, applies: 4 }, inputs: [MRR, RETENTION] })
    : k === 'risk' ? SCOPE(k, { state: 'scored', value: 51, band: 'Fair', confidence: 0.5, confidence_word: 'Medium', review: { scope: 'risk', adjustment: 6, reason: 'A second supplier qualified.', note: null, reviewer: 'Operating Partner', computed_value: 51, reviewed_value: 57, current: true } })
      : k === 'geographic' ? SCOPE(k, { state: 'not_expected' }) : SCOPE(k))),
  corrections: [{ uid: 'c1', scope: 'traction', input_key: 'retention', message: 'Renewal due next month.', state: 'open', created_at: '2026-10-21' }],
  sharing: { investors: { on: true, set: false, default_rule: 'On once the venture is listed, until you turn it off.' }, advisors: [], candidates: { readable: true, items: [{ user_id: 3, name: 'Ada Advisor' }] } },
  investor_preview: {
    before_nda: KEYS.map((k) => ({ scope: k, label: LABEL[k], state: k === 'traction' || k === 'risk' ? 'scored' : 'not_enough', band: k === 'traction' || k === 'risk' ? 'Fair' : null, confidence_word: k === 'traction' ? 'Medium' : null, masked: true, review: null })),
    after_nda: KEYS.map((k) => ({ scope: k, label: LABEL[k], state: k === 'traction' ? 'scored' : 'not_enough', band: k === 'traction' ? 'Fair' : null, confidence_word: k === 'traction' ? 'Medium' : null, masked: false, value: k === 'traction' ? 62 : null, review: null,
      inputs: k === 'traction' ? [{ key: 'mrr', label: 'MRR', personal: false, shown: true, state: 'recorded', value: 74, grade: 'Measured', words: '€1,200 this month' }, { key: 'commitment', label: 'Commitment', personal: true, shown: false, note: 'Counted, not shown' }] : [] })),
  },
  ...extra,
});
const TRAJ = () => ({
  project_id: 10, rows: 5,
  models: [{ version: 'v1', first_at: '2026-09-01 10:00:00' }, { version: 'v1.1', first_at: '2026-10-02 10:00:00' }],
  scopes: KEYS.map((k) => ({ scope: k, label: LABEL[k], points: k === 'traction' ? [
    { at: '2026-09-01 10:00:00', model: 'v1', state: 'not_enough', value: null, band: null, confidence_word: null },
    { at: '2026-09-15 10:00:00', model: 'v1', state: 'scored', value: 40, band: 'Fair', confidence_word: 'Low' },
    { at: '2026-10-02 10:00:00', model: 'v1.1', state: 'scored', value: 62, band: 'Fair', confidence_word: 'Medium' },
  ] : k === 'market' ? [{ at: '2026-10-02 10:00:00', model: 'v1.1', state: 'scored', value: 74, band: 'Strong', confidence_word: 'High' }] : [] })),
});

const response = (body, status = 200) => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});
function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, v] of Object.entries(over)) if (url.includes(k) && (v.method || 'GET') === method) return v.answer(url, options);
    if (/\/api\/venture-scores\/10\/trajectory$/.test(url)) return response(TRAJ());
    if (/\/api\/venture-scores\/10\/corrections$/.test(url)) return response({ uid: 'c2', state: 'open' }, 201);
    if (/\/api\/venture-scores\/10\/sharing$/.test(url)) return response(CARD().sharing);
    if (/\/api\/venture-scores\/10\/scopes\/\w+\/review$/.test(url)) return response({ uid: 'r2' }, 201);
    if (/\/api\/venture-scores\/10\/recompute$/.test(url)) return response({ changed: 2, scopes: [] });
    if (/\/api\/venture-scores\/weights$/.test(url)) return response(method === 'PUT' ? { weights: null, equal: true } : { weights: null, equal: true, updated_at: null });
    if (/\/api\/venture-scores\/10$/.test(url)) return response(CARD());
    return response({});
  };
}

async function mounted(element, { handle = handler(), url = '/raise/scorecard?project_id=10', path = '*' } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, open: globalThis.open, alert: globalThis.alert, confirm: globalThis.confirm };
  const requests = [];
  const popups = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.open = (...a) => { popups.push(['open', ...a]); return null; };
  globalThis.alert = (...a) => popups.push(['alert', ...a]);
  globalThis.confirm = (...a) => { popups.push(['confirm', ...a]); return true; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path, element })))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, popups, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(container),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value, checked: value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET' && q.url !== '/api/client-error');
const PROJECTS = { listProjects: async () => [{ id: 10 }] };

// ---------------------------------------------------------------- model

test('a scope row: a value only when scored; otherwise why, never 0 and never 50', () => {
  const card = CARD();
  const traction = scopeRow(card.scopes[4]);
  assert.deepEqual([traction.value, traction.band, traction.confidence, traction.coverage], [62, 'Fair', 'Medium', '3 of 4 inputs']);
  const team = scopeRow(card.scopes[0]);
  assert.deepEqual([team.value, team.band, team.state], [null, null, 'Not enough recorded']);
  assert.equal(scopeRow(card.scopes[7]).state, 'Not expected yet');
  assert.equal(scopeRow(SCOPE('team', { state: 'unreadable' })).state, 'Could not be read');
  assert.equal(scopeRow(SCOPE('team', { state: 'scored', value: null })).value, null, 'scored without a value is not a number');
  assert.equal(scopeRow(SCOPE('team', { state: 'not_enough', value: 33 })).value, null, 'a value under the floor is never drawn');
  assert.equal(scopeRow({ scope: 'risk', state: 'scored', value: 80, confidence_word: 'High' }).band, 'Low risk');
  assert.equal(coverageText(0.4), null, 'a stored share is not a count');
  assert.match(scopeRow(card.scopes[6]).review.text, /^Computed 51 · after review 57 · \+6 by Operating Partner: A second supplier qualified\.$/);
  assert.equal(reviewLine({ adjustment: 0, note: 'Checked the register.', reviewer: 'Admin' }).text, 'Note by Admin: Checked the register.');
});

test('an input: its words, source and grade, or why it is missing; one open correction per input', () => {
  assert.deepEqual([inputRow(MRR).words, inputRow(MRR).source, inputRow(MRR).grade], ['€1,200 this month', 'Connector', 'Measured']);
  const r = inputRow(RETENTION);
  assert.deepEqual([r.recorded, r.words, r.missing], [false, null, 'No renewal has come due yet']);
  assert.equal(inputRow({ key: 'pull', state: 'not_applicable' }).missing, 'Does not apply yet');
  assert.ok(openCorrection(CARD().corrections, 'traction', 'retention'));
  assert.equal(openCorrection(CARD().corrections, 'traction', 'mrr'), null);
  assert.match(messageProblem('short'), /at least 10/);
  assert.equal(messageProblem('Stripe misses one contract.'), null);
});

test('Add review: a note, or ±15 with a reason; never on an unscored scope; never a value sent', () => {
  assert.match(reviewProblem({ kind: 'adjust', adjustment: 6, reason: 'too short' }, true), /reason of at least 10/);
  assert.match(reviewProblem({ kind: 'adjust', adjustment: 16, reason: 'A long enough reason.' }, true), /at most 15/);
  assert.match(reviewProblem({ kind: 'adjust', adjustment: 0, reason: 'A long enough reason.' }, true), /other than 0/);
  assert.match(reviewProblem({ kind: 'adjust', adjustment: 5, reason: 'A long enough reason.' }, false), /takes a note/);
  assert.equal(reviewProblem({ kind: 'adjust', adjustment: -15, reason: 'A long enough reason.' }, true), null);
  assert.match(reviewProblem({ kind: 'note', note: ' ' }, true), /Write the note/);
  assert.deepEqual(reviewBody({ kind: 'adjust', adjustment: 6, reason: ' Supplier qualified. ', note: 'x' }), { adjustment: 6, reason: 'Supplier qualified.', note: null });
  assert.deepEqual(reviewBody({ kind: 'note', adjustment: 9, reason: 'x', note: ' Checked. ' }), { adjustment: 0, reason: null, note: 'Checked.' });
  assert.equal(reviewPreview(51, 6), 'Shown as: computed 51 · after review 57, with your reason.');
  assert.equal(reviewPreview(97, 6), 'Shown as: computed 97 · after review 100, with your reason.', 'clamped at 100 as the Worker clamps');
  assert.equal(reviewPreview(null, 6), null);
});

test('Your weighting: 0 to 5 per scope; equal saves as none; all zero is refused', () => {
  const eq = equalWeights();
  assert.equal(Object.keys(eq).length, 11);
  assert.equal(isEqual(eq), true);
  assert.equal(isEqual({ ...eq, team: 5 }), false);
  assert.equal(isEqual(Object.fromEntries(Object.keys(eq).map((k) => [k, 3]))), true);
  assert.equal(weightsProblem({ ...eq, team: 6 }), 'Each weight is a whole number from 0 to 5.');
  assert.equal(weightsProblem({ ...eq, team: 1.5 }), 'Each weight is a whole number from 0 to 5.');
  assert.match(weightsProblem(Object.fromEntries(Object.keys(eq).map((k) => [k, 0]))), /at least one scope/);
  assert.equal(weightsProblem({ ...eq, team: 0, market: 5 }), null);
});

test('a sharing change says who gains or loses access before it is made', () => {
  const cur = { investors: { on: true }, advisors: [{ user_id: 3, name: 'Ada Advisor' }] };
  assert.match(sharingChange(cur, { investors: false })[0], /lose access/);
  assert.deepEqual(sharingChange(cur, { investors: true }), [], 'no change, nothing said');
  assert.deepEqual(sharingChange(cur, { advisors: [3, 4] }, [{ user_id: 4, name: 'Ben Advisor' }]), ['Ben Advisor gains read-only access: bands, values and confidence. Inputs stay hidden. They are told.']);
  assert.deepEqual(sharingChange(cur, { advisors: [] }), ['Ada Advisor loses access.']);
});

test('what investors see: before the NDA no value and no input; Risk reads as a risk word', () => {
  const before = previewRow(CARD().investor_preview.before_nda[4]);
  assert.deepEqual([before.band, before.confidence, before.value, before.inputs.length], ['Fair', 'Medium', null, 0]);
  const after = previewRow(CARD().investor_preview.after_nda[4]);
  assert.equal(after.value, 62);
  assert.deepEqual(after.inputs.map((i) => i.hidden || i.words), ['€1,200 this month', 'Counted, not shown']);
  assert.equal(previewRow({ scope: 'traction', state: 'scored', band: 'Fair', masked: true, value: 62 }).value, null, 'a masked row never shows a value');
  assert.equal(bandWord('Fair', 'risk'), 'Medium risk');
  assert.equal(bandWord('Strong', 'risk'), 'Low risk');
  assert.equal(bandWord(null, 'team'), null);
  assert.equal(advisorHref(10), '/practice/scorecards/10');
  assert.equal(advisorHref('../1'), '/practice/scorecards');
});

test('the trajectory: a gap is null, never 0; a model change is marked; an empty one draws no line', () => {
  const t = trajectoryOf(TRAJ());
  assert.deepEqual(t.days, ['2026-09-01', '2026-09-15', '2026-10-02']);
  assert.deepEqual(t.lines.map((l) => l.key), ['market', 'traction'], 'scope order, scored scopes only');
  assert.deepEqual(t.lines.find((l) => l.key === 'traction').values, [null, 40, 62]);
  assert.deepEqual(t.lines.find((l) => l.key === 'market').values, [null, null, 74]);
  assert.deepEqual(t.markers, [{ version: 'v1.1', day: '2026-10-02', index: 2 }]);
  assert.equal(trajectoryOf({ scopes: KEYS.map((k) => ({ scope: k, points: [] })), models: [] }).empty, true);
  assert.equal(trajectoryOf(null), null);
  const rows = trajectoryRows(TRAJ());
  assert.deepEqual(rows[0], { scope: 'Market', day: '2 Oct 2026', model: 'v1.1', value: '74', band: 'Strong', confidence: 'High' });
  const first = rows.find((r) => r.scope === 'Traction' && r.model === 'v1' && r.band === '—');
  assert.equal(first.value, 'Not enough recorded', 'a gap is said in words, never 0');
});

// ---------------------------------------------------------------- mounted

test('mounted SC8: the founder sees every input, asks to correct one, and an open ask waits; no pop-up', async () => {
  const r = await mounted(h(FounderScorecardPage, { projects: PROJECTS }));
  try {
    assert.equal(r.requests[0].url, '/api/venture-scores/10');
    assert.match(r.textOf('scorecard-value-traction'), /Fair62Medium confidence · 3 of 4 inputs/);
    assert.match(r.textOf('scorecard-state-team'), /Not enough recorded/);
    assert.ok(!/\b0\b/.test(r.textOf('scorecard-state-team')), 'no zero for a missing scope');
    assert.match(r.textOf('scorecard-reviewed-risk'), /after review 57/);
    await r.click('scorecard-open-traction');
    assert.match(r.textOf('scorecard-input-traction-mrr'), /MRR€1,200 this monthConnectorMeasured/);
    assert.match(r.textOf('scorecard-input-traction-retention'), /No renewal has come due yet/);
    assert.ok(r.has('scorecard-ask-open-traction-retention'), 'an open ask waits');
    assert.ok(!r.has('scorecard-ask-traction-retention'));
    await r.click('scorecard-ask-traction-mrr');
    assert.match(r.textOf('scorecard-ask-input'), /Traction › MRR/);
    assert.equal(r.props('scorecard-ask-go').disabled, true);
    await r.change('scorecard-ask-message', 'too short');
    await r.click('scorecard-ask-go');
    assert.deepEqual(writes(r), [], 'a short message sends nothing, even if the button is pressed');
    await r.change('scorecard-ask-message', '  Stripe misses one annual contract.  ');
    await r.click('scorecard-ask-go');
    assert.deepEqual(writes(r).map((w) => [w.method, w.url, w.body]), [['POST', '/api/venture-scores/10/corrections', { scope: 'traction', input_key: 'mrr', message: 'Stripe misses one annual contract.' }]]);
    assert.match(r.textOf('founder-scorecard-notice'), /sent to the studio’s Admins/);
    assert.ok(!r.has('scorecard-review-traction'), 'a founder never reviews');
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }
});

test('mounted: What investors see, before and after an NDA, from the Worker’s own preview', async () => {
  const r = await mounted(h(FounderScorecardPage, { projects: PROJECTS }));
  try {
    await r.click('founder-scorecard-view-investors');
    assert.match(r.textOf('scorecard-preview-row-traction'), /TractionFairMedium confidence/);
    assert.ok(!r.textOf('scorecard-preview-row-traction').includes('62'), 'no value before the NDA');
    await r.click('scorecard-preview-after');
    assert.match(r.textOf('scorecard-preview-row-traction'), /62/);
    assert.match(r.textOf('scorecard-preview-row-traction'), /Commitment: Counted, not shown/);
    assert.deepEqual(writes(r), []);
  } finally { await r.close(); }
});

test('mounted: sharing changes open a dialog that says who gains or loses access, then save', async () => {
  const r = await mounted(h(FounderScorecardPage, { projects: PROJECTS }));
  try {
    await r.change('scorecard-share-investors', true);
    assert.ok(!r.has('scorecard-sharing'), 'no change, no dialog');
    await r.change('scorecard-share-investors', false);
    assert.match(r.textOf('scorecard-sharing-lines'), /lose access/);
    assert.deepEqual(writes(r), [], 'nothing until confirmed');
    await r.click('scorecard-sharing-go');
    assert.deepEqual(writes(r).at(-1).body, { investors: false });
    await r.change('scorecard-share-advisor-3', true);
    assert.match(r.textOf('scorecard-sharing-lines'), /Ada Advisor gains read-only access/);
    await r.click('scorecard-sharing-go');
    assert.deepEqual([writes(r).at(-1).method, writes(r).at(-1).url, writes(r).at(-1).body], ['PUT', '/api/venture-scores/10/sharing', { advisors: [3] }]);
  } finally { await r.close(); }
  const none = await mounted(h(FounderScorecardPage, { projects: PROJECTS }), {
    handle: handler({ '/venture-scores/10': { answer: (u) => (/10$/.test(u) ? response(CARD({ sharing: { ...CARD().sharing, candidates: { readable: false, items: [] } } })) : handler()(u)) } }),
  });
  try { assert.ok(none.has('scorecard-share-advisors-unreadable'), 'unreadable advisors are not "none"'); } finally { await none.close(); }
});

test('mounted SC10: an Admin reads the staff view and adds a review within ±15 with a reason', async () => {
  const staff = () => response(CARD({ viewer: 'staff', sharing: undefined, investor_preview: undefined }));
  const r = await mounted(h(FounderScorecardPage, { projects: PROJECTS }), { handle: handler({ '/venture-scores/10': { answer: (u) => (/10$/.test(u) ? staff() : handler()(u)) } }) });
  try {
    assert.ok(r.has('founder-scorecard-staff'));
    assert.ok(!r.has('scorecard-sharing-card') && !r.has('founder-scorecard-view-investors'), 'staff never change sharing');
    await r.click('scorecard-open-traction');
    assert.ok(r.has('scorecard-input-traction-mrr') && !r.has('scorecard-ask-traction-mrr'), 'staff read inputs but never ask to correct');
    await r.click('scorecard-review-traction');
    await r.change('scorecard-review-adjustment', 6);
    assert.equal(r.props('scorecard-review-go').disabled, true, 'a reason first');
    assert.match(r.textOf('scorecard-review-preview'), /computed 62 · after review 68/);
    await r.change('scorecard-review-reason', 'A renewal landed on 20 Oct.');
    await r.click('scorecard-review-go');
    assert.deepEqual([writes(r).at(-1).method, writes(r).at(-1).url, writes(r).at(-1).body], ['PUT', '/api/venture-scores/10/scopes/traction/review', { adjustment: 6, reason: 'A renewal landed on 20 Oct.', note: null }]);
    await r.click('scorecard-review-team');
    assert.equal(r.props('scorecard-review-adjust').disabled, true, 'an unscored scope takes a note only');
  } finally { await r.close(); }
});

test('mounted: a failed read is Unreadable with Try again, never an empty list; recompute says what changed', async () => {
  const r = await mounted(h(FounderScorecardPage, { projects: PROJECTS }), { handle: handler({ '/venture-scores/10': { answer: () => response({ error: 'scorecard_unreadable', message: 'x' }, 503) } }) });
  try {
    assert.ok(r.has('founder-scorecard-unreadable'));
    assert.ok(!r.has('scorecard-scopes'));
  } finally { await r.close(); }
  const ok = await mounted(h(FounderScorecardPage, { projects: PROJECTS }));
  try {
    await ok.click('founder-scorecard-recompute');
    assert.equal(writes(ok).at(-1).url, '/api/venture-scores/10/recompute');
    assert.equal(ok.textOf('founder-scorecard-notice'), 'Recomputed. 2 scopes changed.');
  } finally { await ok.close(); }
  const novent = await mounted(h(FounderScorecardPage, { projects: { listProjects: async () => [] } }), { url: '/raise/scorecard' });
  try { assert.ok(novent.has('founder-scorecard-no-venture')); } finally { await novent.close(); }
});

test('mounted SC12: the trajectory at its own address, with a model marker and a table', async () => {
  const r = await mounted(h(FounderScorecardPage, { tab: 'trajectory', projects: PROJECTS }), { url: '/raise/scorecard/trajectory?project_id=10' });
  try {
    assert.equal(r.requests[0].url, '/api/venture-scores/10/trajectory');
    assert.equal(r.props('founder-scorecard-tab-trajectory')['aria-current'], 'page');
    assert.ok(r.has('scorecard-trajectory-chart'));
    assert.ok(r.has('scorecard-trajectory-marker-v1.1'));
    assert.match(r.textOf('scorecard-trajectory-legend'), /Market 74Traction 62/);
    await r.click('scorecard-trajectory-table-toggle');
    assert.match(r.textOf('scorecard-trajectory-table'), /Traction.*v1Not enough recorded/);
  } finally { await r.close(); }
  const empty = await mounted(h(FounderScorecardPage, { tab: 'trajectory', projects: PROJECTS }), {
    url: '/raise/scorecard/trajectory?project_id=10',
    handle: handler({ '/trajectory': { answer: () => response({ project_id: 10, rows: 0, models: [], scopes: KEYS.map((k) => ({ scope: k, points: [] })) }) } }),
  });
  try { assert.ok(empty.has('scorecard-trajectory-empty')); assert.ok(!empty.has('scorecard-trajectory-chart')); } finally { await empty.close(); }
});

test('mounted SC21: a shared advisor reads read-only with inputs hidden; an advisor not shared with sees nothing', async () => {
  const advisor = () => response({ project_id: 10, viewer: 'advisor', read_only: true, model: 'v1', scopes: CARD().scopes.map((s) => ({ ...s, inputs: [] })) });
  const r = await mounted(h(AdvisorScorecardPage), { url: '/practice/scorecards/10', path: '/practice/scorecards/:projectId',
    handle: handler({ '/venture-scores/10': { answer: () => advisor() } }) });
  try {
    assert.match(r.textOf('scorecard-value-traction'), /Fair62/);
    await r.click('scorecard-open-traction');
    assert.ok(r.has('scorecard-inputs-hidden-traction'));
    assert.ok(!r.has('scorecard-ask-traction-mrr') && !r.has('scorecard-review-traction'), 'read only');
    assert.deepEqual(writes(r), []);
  } finally { await r.close(); }
  const no = await mounted(h(AdvisorScorecardPage), { url: '/practice/scorecards/10', path: '/practice/scorecards/:projectId',
    handle: handler({ '/venture-scores/10': { answer: () => response({ error: 'no_access', message: 'You cannot read this scorecard.' }, 403) } }) });
  try {
    assert.ok(no.has('advisor-scorecard-refused'));
    assert.ok(!no.has('scorecard-scopes'), 'nothing is drawn unless shared');
  } finally { await no.close(); }
});

test('mounted SC7: Your weighting opens a dialog, saves eleven weights, and equal saves as none', async () => {
  const r = await mounted(h(WeightingControl));
  try {
    assert.equal(r.textOf('scorecard-weighting-word'), 'Equal');
    await r.click('scorecard-weighting-edit');
    await r.change('scorecard-weight-team', 5);
    await r.click('scorecard-weighting-go');
    const w = writes(r).at(-1);
    assert.equal(w.url, '/api/venture-scores/weights');
    assert.equal(w.method, 'PUT');
    assert.equal(Object.keys(w.body.weights).length, 11);
    assert.equal(w.body.weights.team, 5);
    await r.click('scorecard-weighting-edit');
    await r.click('scorecard-weighting-reset');
    await r.click('scorecard-weighting-go');
    assert.deepEqual(writes(r).at(-1).body, { weights: null });
  } finally { await r.close(); }
  const off = await mounted(h(WeightingControl), { handle: handler({ '/weights': { answer: () => response({ error: 'no_weighting' }, 403) } }) });
  try { assert.ok(!off.has('scorecard-weighting-control'), 'not offered to a role without weighting'); } finally { await off.close(); }
});

// ---------------------------------------------------------------- guards and wiring

const FILES = [
  'frontend/src/pages/scoring/FounderScorecardPage.jsx', 'frontend/src/pages/scoring/AdvisorScorecardPage.jsx',
  'frontend/src/components/scoring/scorecard/FounderScorecard.jsx', 'frontend/src/components/scoring/scorecard/ScorecardDialogs.jsx',
  'frontend/src/components/scoring/scorecard/Weighting.jsx', 'frontend/src/components/scoring/scorecard/founderModel.js',
];

test('no browser pop-up, no raw hex, no value sent, and every light hover has its dark pair', () => {
  for (const f of FILES) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\s*\(/, `${f}: a browser pop-up`);
    assert.doesNotMatch(src, /-\[#[0-9a-fA-F]{3,8}\]/, `${f}: a raw hex colour`);
    assert.doesNotMatch(src, /confidence_word:|band:\s*[a-z]+\s*[,}]\s*\}?\)\s*\)|value:\s*\w+\s*\}\)/, `${f}: a computed field sent`);
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] || m[2];
      if (/(^|\s)hover:(bg|text|border)-/.test(cls)) assert.match(cls, /dark:hover:/, `${f}: ${cls}`);
    }
  }
});

test('the wiring: both founder addresses, the advisor address, Deal flow’s weighting, the client and the docs', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/raise/scorecard/trajectory" element={guard(labRoles(['admin', 'founder']), <FounderScorecardPage tab="trajectory" />)} />`));
  assert.ok(app.includes(`<Route path="/practice/scorecards/:projectId" element={guard(['admin', 'advisor'], <AdvisorScorecardPage />)} />`));
  assert.match(read('frontend/src/pages/investor/dealflow/DealFlow.jsx'), /\{scope !== 'new' && <WeightingControl \/>\}/);
  assert.match(read('frontend/src/lib/api/ventureScores.js'), /trajectory: \(projectId\) => request\(`\/venture-scores\/\$\{enc\(projectId\)\}\/trajectory`\)/);
  assert.match(read('cloudflare-worker/src/services/ventureScoring/access.ts'), /link: `\/practice\/scorecards\/\$\{projectId\}`/, 'the advisor’s notice opens SC21');
  assert.match(read('documentation/architecture/decisions/D1258.md'), /## D1258/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /D1258/);
});
