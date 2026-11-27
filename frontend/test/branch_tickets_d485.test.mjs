/**
 * D485 (#1025) — HQ · Support shows the tickets each branch's administrators
 * filed on their own host, read from that branch over RPC.
 *
 * The worker half is pinned on real SQLite at both tiers in
 * `cloudflare-worker/test/branch_tickets_d485.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_tickets_d485.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import {
  BranchTicketsSection, branchTicketCardProps, TenantMatrix, supportCoverage, supportBandText, SUPPORT_UNAVAILABLE,
} from '../src/pages/hq/HqSupportPage.jsx';

const html = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));

const FR = {
  code: 'fr', label: 'Axal VC France', state: 'ok', complete: true, count: 2, oldest_age_hours: 30.2,
  bands: { ok: 1, due_soon: 0, past: 1, undated: 0 },
  items: [
    { id: 101, title: 'Approvals board slow', status: 'open', priority: 'high', created_at: 'x', age_hours: 30.2, sla_band: 'past', requester: 'K. Weber' },
    { id: 102, title: 'Seat count looks wrong', status: 'in_progress', priority: 'medium', created_at: 'x', age_hours: 2, sla_band: 'ok', requester: 'noname@fr.example' },
  ],
};
const DE = { code: 'de', label: 'Axal VC DACH', state: 'unreadable', reason: 'BRANCH_DE.openTickets timed out' };
const ES = { code: 'es', label: 'Axal VC Iberia', state: 'not_deployed', reason: 'This Worker has no service binding to that branch.' };
const BT = {
  lines: [DE, ES, FR],
  coverage: { total: 3, answered: 1, complete: false, unreadable: ['de', 'es'] },
  whose: 'Each branch’s active administrators, filing on its own host about the Admin product.',
};

test('each branch is a queue card: its tickets, banded, or Unreadable with its reason', () => {
  const markup = html(BranchTicketsSection, { branchTickets: BT, onRetry() {} });
  assert.match(markup, /data-testid="hq-support-branch-tickets"/);
  const t = renderedText(markup);
  assert.match(t, /Tickets filed on branch hosts/);
  assert.match(t, /1 of 3 branches answered/);
  assert.ok(t.includes(BT.whose));
  const from = (id) => markup.lastIndexOf('<', markup.indexOf(`data-testid="${id}"`));
  const fr = renderedText(markup.slice(from('hq-support-branch-fr')));
  assert.match(fr, /^Admins on Axal VC France2/);
  assert.match(fr, /1 on time · 0 due soon · 1 past SLA/);
  assert.match(fr, /Approvals board slowK\. Weber · high · open/);
  assert.match(fr, /Seat count looks wrongnoname@fr\.example · medium · in progress/);
  const de = markup.slice(from('hq-support-branch-de'), from('hq-support-branch-es'));
  assert.match(renderedText(de), /Admins on Axal VC DACHUnreadable/);
  assert.match(renderedText(de), /BRANCH_DE\.openTickets timed out/);
  assert.doesNotMatch(renderedText(de), /Nothing is waiting/, 'an unread branch is never an empty one');
  const es = markup.slice(from('hq-support-branch-es'), from('hq-support-branch-fr'));
  assert.match(renderedText(es), /no service binding/);
});

test('a branch past its ceiling shows no count, and an empty branch says nothing is waiting', () => {
  const cut = branchTicketCardProps({ ...FR, count: null, complete: false, bands: null });
  assert.equal(cut.state, 'ready');
  assert.equal(cut.count, null);
  const cutMarkup = html(BranchTicketsSection, { branchTickets: { ...BT, lines: [{ ...FR, count: null, complete: false, bands: null }] } });
  assert.match(renderedText(cutMarkup), /Not counted/);
  const empty = html(BranchTicketsSection, { branchTickets: { ...BT, lines: [{ ...FR, count: 0, items: [], bands: { ok: 0, due_soon: 0, past: 0, undated: 0 } }] } });
  assert.match(renderedText(empty), /Nothing is waiting\./);
  assert.equal(html(BranchTicketsSection, { branchTickets: { ...BT, lines: [] } }), '', 'no branch deployed, nothing drawn');
  assert.equal(html(BranchTicketsSection, { branchTickets: undefined }), '');
});

test('the matrix cell shows the whole load and how it splits between the two hosts', () => {
  const matrix = {
    available: true, omitted_terminated: 0,
    rows: [{
      key: 'lic_fr', kind: 'licence', label: 'Axal VC France', licence_ref: 'AXL-001', status: 'active', branch_code: 'fr',
      escalations: { value: 0, oldest_age_hours: null },
      hq_held: { value: null, why: 'does_not_apply', reason: 'An HQ-held account belongs to no branch.' },
      about_admin: { value: 3, oldest_age_hours: 30, on_branch: 2, on_hq: 1 },
    }, {
      key: 'lic_wl', kind: 'licence', label: 'Studio Lyon', licence_ref: 'AXL-002', status: 'active', branch_code: null,
      escalations: { value: null, why: 'does_not_apply', reason: 'No branch is deployed.' },
      hq_held: { value: null, why: 'does_not_apply', reason: 'An HQ-held account belongs to no branch.' },
      about_admin: { value: 2, oldest_age_hours: 9 },
    }],
  };
  const markup = html(TenantMatrix, { matrix, failed: false, onRetry() {} });
  const splits = [...markup.matchAll(/data-testid="hq-support-matrix-split">([^<]*(?:<!-- -->[^<]*)*)</g)].map((m) => renderedText(m[1]));
  assert.deepEqual(splits, ['2 on its host · 1 on axal.vc'], 'only a branch cell carries the split');
});

test('the band names a branch when its oldest ticket is the oldest, and the rail reads back what loaded', () => {
  const data = {
    total: { value: 6, oldest: { queue: 'branch:fr', age_hours: 30 } },
    branch_tickets: { ...BT, lines: [FR] },
  };
  assert.equal(supportBandText(data, false), '6 open · oldest 30h · admin on Axal VC France');
  const lines = supportCoverage({ branch_tickets: BT });
  assert.ok(lines.includes('2 open tickets on 1 of 3 branch hosts'));
  assert.ok(!supportCoverage({ branch_tickets: { ...BT, lines: [DE] } }).some((l) => /branch hosts/.test(l)),
    'no branch read, no line');
  assert.ok(supportCoverage({ branch_tickets: { ...BT, lines: [FR, { ...FR, code: 'it', count: null, complete: false }] } })
    .includes('2 open tickets on 1 of 2 branch hosts'), 'a cut count is not added in');
});

test('the rail no longer says no branch call returns tickets', () => {
  assert.ok(!SUPPORT_UNAVAILABLE.some(([title]) => /branch host/i.test(title)));
  assert.ok(!SUPPORT_UNAVAILABLE.some(([, detail]) => /no branch call returns tickets/.test(detail)));
});
