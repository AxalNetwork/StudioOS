// D6897 part 4 (#6897, canvas D6054 RA-31) — the Raise status page shared outside Axal: the sheet's list of what is on
// the page and what is left out, its checks, the reader's page and its refusal, the A4 copy, Shared links naming a
// status page, the public route, the client and the founder-only button on /raise. Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_status_share_6897.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createPdfStub } from './_pdf-stub.mjs';
import { RaiseStatusView } from '../src/pages/share/RaiseStatusPage.jsx';
import { OnThePage, ShareStatusSheet } from '../src/pages/cycles/evidence/ShareStatus.jsx';
import { SharedLinksList } from '../src/pages/cycles/evidence/ShareOutside.jsx';
import { renderSharePdf } from '../src/lib/raiseSharePdf.js';
import { isPublicPath } from '../src/lib/api.js';
import { raiseEvidenceShareApi } from '../src/lib/api/raiseEvidenceShare.js';
import { whatItShares, countWord, remakeOf } from '../src/pages/cycles/evidence/shareOutsideModel.js';
import { copyShares } from '../src/pages/cycles/evidence/sharePdfModel.js';
import { STATUS_ON_PAGE, STATUS_LEFT_OUT, investorRows, stageDone, statusErrors, statusPdfModel, statusRequest, toolLine } from '../src/pages/cycles/evidence/statusPageModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(p, 'utf8');

const PAGE = {
  kind: 'status', venture: '[Sample venture]', made_at: '2026-11-14T14:40:00Z',
  stage: { key: 'prepare_diligence', label: 'Prepare diligence', stages: [
    { key: 'prepare', label: 'Prepare', state: 'done' }, { key: 'build_the_story', label: 'Build the story', state: 'done' },
    { key: 'prepare_diligence', label: 'Prepare diligence', state: 'current' }, { key: 'run_the_raise', label: 'Run the raise', state: 'ahead' }] },
  materials: [
    { key: 'investor-narrative', label: 'Investor narrative', state: 'ok', words: 'Saved' },
    { key: 'pitch-deck', label: 'Pitch', state: 'reviewed', words: 'Reviewed, ready to send' },
    { key: 'data-room', label: 'Data room', state: 'too_little', words: 'Partial' },
    { key: 'cap-table', label: 'Cap table', state: 'ok', words: 'Recorded' },
    { key: 'use-of-funds', label: 'Use of funds', state: 'empty', words: 'Not started' },
  ],
  investors: { in_pipeline: 14, active_conversations: 6, in_diligence: 2, committed: 0 },
  readiness: { areas: [
    { key: 'narrative', label: 'Investor narrative', score: 7, evidence: 'Stated', missing: 'One customer story.', scored_on: '2026-11-02', words: '7 of 10' },
    { key: 'data_room', label: 'Data room', score: null, evidence: null, missing: null, scored_on: null, words: 'Not scored yet' },
    { key: 'team', label: 'Team', score: null, evidence: null, missing: null, scored_on: null, words: 'Team is assessed by a person' },
  ] },
  next_steps: [{ label: 'Data room', text: 'Not scored yet' }, { label: 'Use of funds', text: 'Scored 4 of 10' }, { label: 'Traction proof', text: 'Bank-connected revenue.' }],
  tools: [
    { key: 'mercury', label: 'Mercury', state: 'connected', words: 'Connected', as_of: '2026-11-14T14:05:00Z' },
    { key: 'github', label: 'GitHub', state: 'not_connected', words: 'Not connected', as_of: null },
    { key: 'google', label: 'Google Workspace', state: 'unreadable', words: 'Unavailable', as_of: null },
  ],
};
const READY = { status: 'ready', body: { state: 'ok', status: PAGE, link: { made_at: '2026-11-14T14:40:00Z', expires_at: '2026-11-21T14:40:00Z' } } };

test('the sheet lists what is on the page and leaves out investor names and amounts; its checks match the Worker', () => {
  const on = html(h(OnThePage));
  assert.equal((on.match(/data-testid="share-status-on"/g) || []).length, STATUS_ON_PAGE.length);
  for (const r of ['Stage', 'Materials', 'Readiness by area', 'Next steps', 'Connected tools']) assert.match(on, new RegExp(r));
  assert.match(on, /<li class="flex gap-2" data-testid="share-status-left-out">/, 'the left-out row is drawn, not hidden');
  assert.match(on, /Investor names and commitment amounts/); assert.match(on, /Left out; counts by stage only/);
  assert.equal(STATUS_LEFT_OUT.word, 'Investor names and commitment amounts');
  const sheet = html(h(ShareStatusSheet, { projectId: 1, onClose() {} }));
  assert.match(sheet, /Create status page/); assert.match(sheet, /a one-page summary of the Overview/);
  assert.match(sheet, /does not update/);
  const base = { output: 'link', label: '[Sample co-founder]', expires_in_days: 7, view_limit: 5 };
  assert.deepEqual(statusErrors(base), {});
  assert.ok(statusErrors({ ...base, label: ' ' }).label);
  assert.ok(statusErrors({ ...base, expires_in_days: 91 }).expires_in_days);
  assert.ok(statusErrors({ ...base, view_limit: 0 }).view_limit);
  // Mutation checked: check bounds for a PDF too → the PDF is refused for a link's bounds.
  assert.deepEqual(statusErrors({ ...base, output: 'pdf', view_limit: 0 }), {});
  assert.deepEqual(statusRequest(base), { label: '[Sample co-founder]', expires_in_days: 7, view_limit: 5 });
  // A PDF sends only its label: the Worker refuses an expiry or view limit on a copy.
  assert.deepEqual(statusRequest({ ...base, output: 'pdf' }), { label: '[Sample co-founder]' });
});

test('the reader’s page: dated, the stage with the stages done, five materials in words, counts only, readiness, steps, tools', () => {
  const out = html(h(RaiseStatusView, { state: READY }));
  assert.match(out, /Shared on 14 Nov 2026\. This shows the raise as of that day; it does not update\./);
  assert.match(out, /data-testid="raise-status-stage">Prepare diligence</);
  // Mutation checked: keep 'current' in stageDone → "… and Prepare diligence done".
  assert.match(out, /Prepare and Build the story done/);
  assert.equal((out.match(/data-testid="raise-status-materials-value"/g) || []).length, 5);
  assert.match(out, /Reviewed, ready to send/); assert.match(out, /Partial/);
  assert.match(out, /No investor names or commitment amounts\./);
  // Mutation checked: Number.isInteger → truthy → a recorded 0 reads Not recorded.
  assert.deepEqual(investorRows(PAGE.investors), [['In pipeline', '14'], ['Active conversations', '6'], ['In diligence', '2'], ['Committed', '0']]);
  assert.deepEqual(investorRows(null).map((r) => r[1]), ['Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
  assert.equal((out.match(/data-testid="raise-status-area"/g) || []).length, 3);
  assert.match(out, /Team is assessed by a person/);
  assert.equal((out.match(/<li>/g) || []).length, 3);
  assert.match(out, /Connected · read 14 Nov 2026/); assert.match(out, /Not connected/); assert.match(out, /Unavailable/);
  assert.equal(toolLine({ state: 'not_connected', words: 'Not connected', as_of: '2026-11-14' }), 'Not connected');
  assert.equal(stageDone({ stages: [{ label: 'Prepare', state: 'current' }] }), null);
  assert.doesNotMatch(out, /Product-market|overall/i);
  const refused = html(h(RaiseStatusView, { state: { status: 'refused', body: { state: 'expired', title: 'This link has expired', sentence: 'Ask the sender for a new link.' } } }));
  assert.match(refused, /This link has expired/); assert.doesNotMatch(refused, /Sample venture|Prepare|Mercury/);
  assert.match(html(h(RaiseStatusView, { state: { status: 'loading' } })), /Opening the status page…/);
});

test('the A4 copy: the same sections, dated, counts only, every page footed', () => {
  const model = statusPdfModel(PAGE);
  assert.equal(model.filename, 'axal-raise-status-sample-venture-2026-11-14.pdf');
  assert.match(model.dated, /Shared on 14 Nov 2026\. This shows the raise as of that day; it does not update\./);
  assert.deepEqual(model.sections.map((s) => s.heading), ['Stage', 'Materials', 'Investors · counts by stage', 'Readiness by area', 'Next steps', 'Connected tools']);
  assert.equal(model.sections[0].empty, 'Prepare diligence · Prepare and Build the story done');
  assert.deepEqual(model.sections[1].rows[1], ['Pitch', 'Reviewed, ready to send']);
  assert.deepEqual(model.sections[2].rows[3], ['Committed', '0']);
  assert.match(model.foot, /No investor names or commitment amounts\./);
  const doc = createPdfStub();
  assert.equal(renderSharePdf(doc, model), 1);
  const text = doc.calls.filter((c) => c.op === 'text').map((c) => String(c.args?.[0] ?? c.text ?? '')).join('\n');
  assert.match(text, /Raise status/); assert.match(text, /Page 1 of 1/);
});

test('Shared links names a status page, counts its materials and offers a new one from /raise', () => {
  const link = { uid: 'u1', output: 'status', label: '[Sample advisor]', reader: 'before_nda', item_count: 5, created_at: '2026-11-14', expires_at: '2026-11-21', view_count: 1, view_limit: 5, state: 'live', changed_since_sent: true };
  assert.equal(whatItShares(link), 'Raise status'); assert.equal(countWord(link), 'materials');
  assert.deepEqual(remakeOf(link), { to: '/raise', word: 'Make a new status page' });
  assert.equal(remakeOf({ output: 'pack' }), null);
  assert.equal(countWord({ output: 'pack', item_count: 1 }), 'item');
  const out = html(h(SharedLinksList, { links: [link], onRevoke() {}, onMakeNew() {} }));
  assert.match(out, /Raise status/); assert.match(out, /Make a new status page/); assert.match(out, /href="\/raise"/);
  assert.doesNotMatch(out, /Make a new pack/);
  assert.equal(copyShares({ output: 'status', item_count: 5 }), 'Raise status · 5 materials');
});

test('the public route, the client and the founder-only button on the Overview', async () => {
  assert.equal(isPublicPath('/share/status/abc'), true);
  const routes = read('frontend/src/routes/raiseEvidenceShare.jsx');
  assert.match(routes, /<Route path="\/share\/status\/:token" element=\{<RaiseStatusPage \/>\} \/>/, 'no guard on the public page');
  let seen = null;
  const r = await raiseEvidenceShareApi.openStatus('tok_en', async (url, init) => { seen = { url, init }; return { status: 410, json: async () => ({ state: 'revoked' }) }; });
  assert.equal(r.status, 410); assert.equal(seen.url, '/api/share/status/tok_en');
  assert.equal(seen.init.credentials, 'omit'); assert.ok(!('Authorization' in (seen.init.headers || {})));
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /more=\{projectId \? def\?\.overviewMore\?\.\(\{ projectId, role: user\?\.role \?\? null \}\) \?\? null : null\}/);
  // Mutation checked: drop the role check → a non-founder is offered the button.
  const def = (await import('../src/pages/cycles/defs/raise.jsx')).default;
  assert.equal(def.overviewMore({ projectId: 1, role: 'admin' }), null);
  assert.equal(def.overviewMore({ projectId: 1, role: 'founder' }).type.name, 'ShareStatusButton');
});
