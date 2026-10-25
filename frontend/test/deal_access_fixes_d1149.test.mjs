import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import DealRoomPage, { CommitModal, CommitmentTotal } from '../src/pages/DealRoomPage.jsx';
import DealFreePlan from '../src/components/deals/DealFreePlan.jsx';
import { dealMoney, dealBackLink } from '../src/components/deals/dealMoney.js';
import DealSyndicates, { SyndicateDrawer } from '../src/components/deals/DealSyndicates.jsx';
import { InvitationsList } from '../src/components/deals/DealInvitationsTab.jsx';
import { TransfersView } from '../src/components/deals/DealTransfersTab.jsx';
import { JoinLeaveButton } from '../src/components/deals/DealRoomJoin.jsx';
import { api } from '../src/lib/api.js';
const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const header = { id: 100, project_name: 'Synthetic venture', project_sector: 'Synthetic sector', status: 'active', currency: 'EUR', target_raise: 100000, capital_committed: 25000, progress_pct: 25, closing_deadline: null, my_commitment: null, plan_limited: true };

test('Free header and key strip show recorded figures and DL22b copy without private sections', () => {
  const result = html(h(DealFreePlan, { deal: { ...header, notes: 'PRIVATE NOTE', description: 'PRIVATE DESCRIPTION' } }));
  assert.match(result, /Synthetic venture/); assert.match(result, /€100,000/); assert.match(result, /€25,000/);
  assert.match(result, /Deal pages are on the Professional plan/); assert.match(result, /See plans/); assert.match(result, /href="\/pricing\?for=investor"/);
  assert.match(result, /Not committed yet/); assert.match(result, /Not recorded/);
  assert.doesNotMatch(result, /PRIVATE NOTE|PRIVATE DESCRIPTION|Commit Capital|deal-tab/);
  const missing = html(h(DealFreePlan, { deal: { ...header, target_raise: null, progress_pct: null } }));
  assert.doesNotMatch(missing, /0% of the round|€0/); assert.match(missing, /Not recorded/);
  const unreadable = html(h(DealFreePlan, { deal: { ...header, my_commitment_unreadable: true } }));
  assert.match(unreadable, /Unreadable/); assert.match(unreadable, /Try again/); assert.doesNotMatch(unreadable, /Not committed yet/);
});

test('the mounted Free page makes only its restricted detail read', async () => {
  const originals = { getDeal: api.getDeal, myDealInvitations: api.myDealInvitations, dealroomQuota: api.dealroomQuota, dealCommitments: api.dealCommitments };
  const calls = [];
  api.getDeal = async () => { calls.push('detail'); return header; };
  for (const method of ['myDealInvitations','dealroomQuota','dealCommitments']) api[method] = async () => { calls.push(method); throw new Error('Unexpected private read'); };
  const view = await mountContracts(h(Routes, null, h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) })), '/deals/100', { id: 4, role: 'investor' });
  try { await view.flush(); await view.flush(); assert.deepEqual(calls, ['detail']); assert.match(view.text(), /Professional plan/); assert.doesNotMatch(view.text(), /Commit Capital|Overview|Documents tab/); }
  finally { await view.unmount(); Object.assign(api, originals); }
});

test('founder back navigation returns to Raise; other roles keep Deal Flow', () => {
  assert.deepEqual(dealBackLink('founder'), { path: '/raise/capital-relationships', label: 'Back to Capital relationships' });
  assert.equal(dealBackLink('investor').path, '/deals');
});

test('the commitment dialog, totals and transfer amounts use the deal currency; missing figures stay missing', () => {
  assert.equal(dealMoney(0, 'EUR'), '€0'); assert.equal(dealMoney(1.5, 'EUR'), '€1.5'); assert.equal(dealMoney(null, 'EUR'), null); assert.equal(dealMoney(100, 'bad'), null);
  const modal = html(h(CommitModal, { deal: { ...header, minimum_check: 1000 }, onClose() {}, onDone() {} }));
  assert.match(modal, /Amount \(EUR\)/); assert.match(modal, /€1,000/); assert.doesNotMatch(modal, /Amount \(USD\)|\$1,000/);
  assert.match(html(h(CommitmentTotal, { total: 3000, currency: 'EUR' })), /€3,000/);
  const transfers = html(h(TransfersView, { dealId: 100, currency: 'EUR', state: { loading: false, rows: [{ uid: 't', amount_cents: 125050, recorded_by: 1 }] }, onRetry() {}, canRecord: false }));
  assert.match(transfers, /€1,250\.50/); assert.doesNotMatch(transfers, /\$1,250/);
});

test('joining records a request and explains that it grants no access', async () => {
  const original = api.dealroomJoin; const calls = []; api.dealroomJoin = async (id) => { calls.push(id); return { requested: true }; };
  const view = await mountContracts(h(JoinLeaveButton, { dealId: 100, member: false, quotaState: { quota: { full: false } } }));
  try { await view.click('Request an invitation'); await view.flush(); assert.deepEqual(calls, [100]); assert.match(view.text(), /invitation request is recorded/); assert.match(view.text(), /Access starts after an invitation or commitment/); }
  finally { await view.unmount(); api.dealroomJoin = original; }
});

test('the founder page back button actually navigates to Capital relationships', async () => {
  const originals = { getDeal: api.getDeal, networkFxProjectSyndicates: api.networkFxProjectSyndicates };
  api.getDeal = async () => ({ ...header, plan_limited: false, project_id: 10 }); api.networkFxProjectSyndicates = async () => [];
  const view = await mountContracts(h(Routes, null,
    h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
    h(Route, { path: '/raise/capital-relationships', element: h('p', null, 'Founder capital relationships') })), '/deals/100', { id: 5, role: 'founder' });
  try { await view.flush(); await view.click('Back to Capital relationships'); await view.flush(); assert.match(view.text(), /Founder capital relationships/); }
  finally { await view.unmount(); Object.assign(api, originals); }
});


test('staff can distinguish a pending invitation request from an issued invitation', () => {
  const result = html(h(InvitationsList, { state: { loading: false, rows: [{ id: 'request-1', investor_user_id: 1, investor_name: 'Synthetic requester', status: 'requested', created_at: '2026-10-25 12:00:00' }] } }));
  assert.match(result, /Invitation requested/); assert.match(result, /No access has been granted/); assert.match(result, />Requested</);
  const issued = html(h(InvitationsList, { state: { loading: false, rows: [{ id: 1, investor_user_id: 1, status: 'invited' }] } }));
  assert.doesNotMatch(issued, /Invitation requested|No access has been granted/);
});


test('a EUR deal never relabels project-level USD syndicates', async () => {
  const result = html(h(SyndicateDrawer, { currency: 'EUR', state: { loading: false, syndicate: { name: 'Synthetic syndicate', status: 'open', target_cents: 100000, committed_cents: 12500, members: [{ id: 1, commitment_cents: 12500 }] } } }));
  assert.match(result, /\$1,000\.00/); assert.match(result, /\$125\.00/); assert.doesNotMatch(result, /€/);
  const original = api.networkFxProjectSyndicates;
  api.networkFxProjectSyndicates = async () => [{ id: 1, name: 'Synthetic syndicate', committed_cents: 12500, members: 1 }];
  const view = await mountContracts(h(DealSyndicates, { projectId: 10, currency: 'EUR' }));
  try { await view.flush(); assert.match(view.text(), /\$125\.00/); assert.doesNotMatch(view.text(), /€/); }
  finally { await view.unmount(); api.networkFxProjectSyndicates = original; }
});
