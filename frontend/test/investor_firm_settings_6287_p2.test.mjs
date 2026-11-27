// D6287 part 2 (#6287): Firm Settings' status blocks, "In your deal flow now"
// with the session-only compare, and Team seats. Synthetic fixtures only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { api } from '../src/lib/api.js';
import InvestorFirmSettings from '../src/pages/investor/settings/InvestorFirmSettings.jsx';
import {
  firmCompleteness, fitMoves, fitRow, flowDeals, inviteRefusal, kycWord, seatsIncluded,
} from '../src/pages/investor/settings/firmSettingsModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const route = '/account/portfolio/settings';
const PROFILE = {
  firm_name: 'Example Firm', investor_type: 'angel', ticket_band: '$50k-$250k', sectors: ['Climate'], stages: ['Seed', 'Series A'],
  accreditation_status: 'accredited', contribute_to_signals: true,
};
const INSTITUTIONAL = { held: [{ licence: 'investor', label: 'Investor', is_primary: true, plan: { key: 'investor:institutional', name: 'Institutional' } }] };
const PROFESSIONAL = { held: [{ licence: 'investor', label: 'Investor', is_primary: true, plan: { key: 'investor:professional', name: 'Professional' } }] };
const crit = (stage) => [
  { key: 'sector', state: 'match' }, { key: 'stage', state: stage }, { key: 'region', state: 'not_set' }, { key: 'ticket', state: 'not_recorded' },
];

function stubClient(over = {}) {
  return {
    kycStatus: async () => ({ kyc_status: 'approved' }),
    fundsList: async () => ({ items: [{ id: 1, name: 'Sample Fund I', relationship: 'gp' }, { id: 2, name: 'Sample Fund II', relationship: 'lp' }] }),
    licences: async () => INSTITUTIONAL,
    seats: async () => ({ seats: [{ id: 7, seat_email: 'colleague@example.test', invited_at: '2026-11-01 10:00:00', accepted_at: null, revoked_at: null, state: 'invited' }], cap: 4, used: 1 }),
    inviteSeat: async () => ({}),
    revokeSeat: async () => ({ ok: true }),
    dealFlow: async () => ({ items: [{ deal_id: 11, venture: 'Sample Venture', sector: 'Climate', can_open: true }] }),
    dealFit: async () => ({ items: [{ deal_id: 11, state: 'recorded', criteria: crit('match') }] }),
    ...over,
  };
}

async function mount(t, client, profile = PROFILE) {
  t.mock.method(api, 'getInvestorProfile', async () => ({ profile }));
  const view = await mountContracts(createElement(InvestorFirmSettings, { client }), route);
  await view.flush();
  return view;
}
const text = (x) => (x.nodeType === 3 ? x.textContent || '' : x.childNodes?.length ? x.childNodes.map(text).join('') : x.textContent || '');
const within = (view, testid) => {
  const node = view.nodes().find((n) => view.props(n)?.['data-testid'] === testid);
  if (!node) return '';
  return text(node);
};
const buttonIn = (view, testid, label) => {
  const root = view.nodes().find((n) => view.props(n)?.['data-testid'] === testid);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  return walk(root).find((n) => n.tagName === 'BUTTON' && text(n).includes(label));
};
const press = async (view, node) => { await act(async () => { view.props(node).onClick({ stopPropagation() {}, preventDefault() {} }); }); await view.flush(); };
const submit = async (view, index) => {
  const form = view.nodes().filter((n) => n.tagName === 'FORM')[index];
  await act(async () => view.props(form).onSubmit({ preventDefault() {} }));
  await view.flush();
};

test('the four status blocks read on their own and say what each read returned', async (t) => {
  const view = await mount(t, stubClient());
  try {
    assert.match(within(view, 'firm-status-identity'), /Identity check\s*Verified/);
    assert.match(within(view, 'firm-status-identity'), /Accredited self-declared/);
    assert.match(within(view, 'firm-status-licences'), /Investor\s*Plan: Institutional\s*primary/);
    assert.match(within(view, 'firm-status-funds'), /2funds you manage or sit in, now/);
    assert.match(within(view, 'firm-status-funds'), /Sample Fund IYou manage/);
    assert.match(within(view, 'firm-status-funds'), /Sample Fund IIYou are an LP/);
    assert.match(within(view, 'firm-status-seats'), /1of 4 on the Institutional plan/);
    assert.match(view.text(), /✓ Complete/);
  } finally { await view.unmount(); }
});

test('one failed block says Unavailable with Try again and the others still show', async (t) => {
  let fundReads = 0;
  const view = await mount(t, stubClient({
    fundsList: async () => { if (++fundReads === 1) throw Object.assign(new Error('down'), { status: 503 }); return { items: [] }; },
  }));
  try {
    assert.match(within(view, 'firm-status-funds'), /Funds could not be read\./);
    assert.doesNotMatch(within(view, 'firm-status-funds'), /\b0\b/);
    assert.match(within(view, 'firm-status-identity'), /Verified/);
    assert.match(within(view, 'firm-status-licences'), /Institutional/);
    await press(view, buttonIn(view, 'firm-status-funds', 'Try again'));
    assert.equal(fundReads, 2);
    assert.match(within(view, 'firm-status-funds'), /0funds you manage or sit in, now/);
  } finally { await view.unmount(); }
});

test('a failed profile read draws no form and the status blocks still read (CS-21)', async (t) => {
  t.mock.method(api, 'getInvestorProfile', async () => { throw new Error('read unavailable'); });
  const view = await mountContracts(createElement(InvestorFirmSettings, { client: stubClient() }), route);
  await view.flush();
  try {
    assert.match(view.text(), /Firm settings unavailable/);
    assert.equal(view.nodes().filter((n) => n.tagName === 'FORM').length, 1, 'only the seat invite form');
    assert.match(within(view, 'firm-status-identity'), /Verified/);
    assert.match(within(view, 'firm-status-identity'), /Accreditation could not be read/);
  } finally { await view.unmount(); }
});

test('the fit panel shows only after a save, and compares the read before Save with the read after', async (t) => {
  const order = [];
  let saved = false;
  const client = stubClient({
    dealFit: async () => {
      order.push(saved ? 'fit-after' : 'fit-before');
      return { items: [{ deal_id: 11, state: 'recorded', criteria: crit(saved ? 'outside' : 'match') }] };
    },
  });
  t.mock.method(api, 'saveInvestorProfile', async (body) => { order.push('put'); saved = true; return { profile: { ...PROFILE, ...body } }; });
  const view = await mount(t, client);
  try {
    assert.equal(within(view, 'deal-fit'), '', 'no fit panel before a save');
    await view.fill('Firm name', 'Example Firm Two');
    await submit(view, 0);
    assert.deepEqual(order, ['fit-before', 'put', 'fit-after']);
    const panel = within(view, 'deal-fit');
    assert.match(panel, /In your deal flow now/);
    assert.match(panel, /1 deal in your flow/);
    assert.match(within(view, 'fit-compare'), /Sample Venture: Stage moved Match → Outside/);
    assert.match(panel, /Outside/);
    assert.match(panel, /Not set/);
  } finally { await view.unmount(); }
});

test('a save with no criterion moved says so, and a free plan or a failed fit read never shows a fit', async (t) => {
  t.mock.method(api, 'saveInvestorProfile', async (body) => ({ profile: { ...PROFILE, ...body } }));
  const same = await mount(t, stubClient());
  try {
    await same.fill('Firm name', 'Example Firm Two');
    await submit(same, 0);
    assert.match(within(same, 'fit-compare'), /No deal changed on sector, stage, region or cheque/);
  } finally { await same.unmount(); }

  const plan = await mount(t, stubClient({ dealFlow: async () => { throw Object.assign(new Error('plan'), { status: 402 }); } }));
  try {
    await plan.fill('Firm name', 'Example Firm Two');
    await submit(plan, 0);
    assert.match(within(plan, 'deal-fit'), /Deal fit comes with the Professional plan/);
    assert.doesNotMatch(within(plan, 'deal-fit'), /Match|Try again/);
  } finally { await plan.unmount(); }

  let fits = 0;
  const failed = await mount(t, stubClient({
    dealFit: async () => { fits += 1; if (fits === 2) throw Object.assign(new Error('down'), { status: 503 }); return { items: [{ deal_id: 11, state: 'recorded', criteria: crit('match') }] }; },
  }));
  try {
    await failed.fill('Firm name', 'Example Firm Two');
    await submit(failed, 0);
    assert.match(within(failed, 'deal-fit'), /Thesis fit could not be read\.\s*Your thesis was saved\./);
    await press(failed, buttonIn(failed, 'deal-fit', 'Try again'));
    assert.equal(fits, 3);
    assert.match(within(failed, 'deal-fit'), /Sample Venture/);
  } finally { await failed.unmount(); }
});

test('Team seats: invite shows the link once, revoke goes Scope → Review → Result', async (t) => {
  let seats = [{ id: 7, seat_email: 'colleague@example.test', invited_at: '2026-11-01 10:00:00', accepted_at: null, revoked_at: null, state: 'invited' }];
  const invited = [];
  const revoked = [];
  const client = stubClient({
    seats: async () => ({ seats, cap: 4 }),
    inviteSeat: async (email) => {
      invited.push(email);
      seats = [{ id: 8, seat_email: email, invited_at: '2026-11-27 09:00:00', accepted_at: null, revoked_at: null, state: 'invited' }, ...seats];
      return { ok: true, id: 8, email, email_sent: false, invite_link: 'https://example.test/investor-seats/accept?token=sample' };
    },
    revokeSeat: async (id) => {
      revoked.push(id);
      seats = seats.map((s) => (s.id === id ? { ...s, revoked_at: '2026-11-27 09:05:00', state: 'revoked' } : s));
      return { ok: true };
    },
  });
  const view = await mount(t, client);
  try {
    assert.match(within(view, 'team-seats'), /1of 4 on the Institutional plan/);
    assert.match(within(view, 'team-seats'), /3 seats left/);
    await view.fill('Invite a colleague', 'new.colleague@example.test');
    await submit(view, 1);
    assert.deepEqual(invited, ['new.colleague@example.test']);
    assert.match(within(view, 'firm-seat-invite-once'), /Invite created for new\.colleague@example\.test/);
    assert.match(within(view, 'firm-seat-invite-once'), /accept\?token=sample/);
    assert.match(within(view, 'firm-seat-invite-once'), /Shown once/);
    assert.match(within(view, 'team-seats'), /2of 4 on the Institutional plan/);

    await press(view, buttonIn(view, 'firm-seat-7', 'Revoke…'));
    assert.equal(revoked.length, 0, 'the first press only opens the review');
    assert.match(within(view, 'revoke-review'), /Revoke colleague@example\.test\?/);
    assert.match(within(view, 'revoke-review'), /What stops\s*The invite link stops working/);
    assert.match(within(view, 'revoke-review'), /What stays\s*Your firm settings and thesis/);
    await press(view, buttonIn(view, 'revoke-review', 'Revoke seat'));
    assert.deepEqual(revoked, [7]);
    assert.match(within(view, 'team-seats'), /Seat revoked · 1 of 4 used/);
    assert.match(within(view, 'firm-seat-7'), /Revoked/);
    assert.equal(within(view, 'revoke-review'), '');
  } finally { await view.unmount(); }
});

test('Team seats: a refused invite says why in the page’s words; a plan without seats offers Billing', async (t) => {
  const colleague = await mount(t, stubClient({
    inviteSeat: async () => { throw Object.assign(new Error('raw server words'), { status: 403, code: 'forbidden' }); },
  }));
  try {
    await colleague.fill('Invite a colleague', 'someone@example.test');
    await submit(colleague, 1);
    assert.match(within(colleague, 'firm-seat-invite-error'), /^Ask the account owner to add seats\.$/);
    assert.doesNotMatch(colleague.text(), /raw server words/);
  } finally { await colleague.unmount(); }

  const pro = await mount(t, stubClient({ licences: async () => PROFESSIONAL, seats: async () => ({ seats: [], cap: 4 }) }));
  try {
    assert.match(within(pro, 'team-seats'), /Colleague seats come with the Institutional plan\./);
    assert.match(within(pro, 'firm-status-seats'), /See plans in Billing/);
    assert.equal(pro.nodes().filter((n) => n.tagName === 'FORM').length, 1, 'no invite form');
  } finally { await pro.unmount(); }
});

test('model: completeness, kyc words, fit rows, moves, flow deals, refusals, seat plan', () => {
  assert.deepEqual(firmCompleteness({ investor_type: null, sectors: [], stages: ['Seed'], ticket_band: null }).needs, ['investor type', 'a sector', 'a cheque size']);
  assert.equal(firmCompleteness(PROFILE).complete, true);
  assert.equal(kycWord('approved'), 'Verified');
  assert.equal(kycWord(''), null);
  assert.deepEqual(fitRow({ state: 'recorded', criteria: [{ key: 'stage', state: 'outside' }] }).cells, { sector: 'not_recorded', stage: 'outside', region: 'not_recorded', ticket: 'not_recorded' });
  assert.equal(fitRow({ state: 'unavailable' }).kind, 'unavailable');
  assert.equal(fitRow({ state: 'unreadable' }).kind, 'unreadable');
  const before = new Map([['1', { criteria: crit('match') }], ['2', { criteria: crit('match') }]]);
  const after = new Map([['1', { criteria: crit('outside') }], ['2', { state: 'unreadable' }], ['3', { criteria: crit('match') }]]);
  assert.deepEqual(fitMoves(before, after), [{ dealId: '1', key: 'stage', label: 'Stage', from: 'match', to: 'outside' }]);
  assert.equal(fitMoves(null, after), null);
  const many = { items: Array.from({ length: 60 }, (_, i) => ({ deal_id: i + 1 })).concat([{ deal_id: 1 }, { deal_id: 'x' }]) };
  assert.deepEqual([flowDeals(many).deals.length, flowDeals(many).total], [50, 60]);
  assert.equal(inviteRefusal({ code: 'seat_cap_exceeded' }), 'All seats are in use. Revoke one to invite someone new.');
  assert.equal(inviteRefusal({ status: 402 }), 'Colleague seats come with the Institutional plan.');
  assert.equal(inviteRefusal(new Error('anything')), 'The invite could not be created. Try again.');
  assert.equal(seatsIncluded({ kind: 'ok', data: INSTITUTIONAL }), true);
  assert.equal(seatsIncluded({ kind: 'ok', data: PROFESSIONAL }), false);
  assert.equal(seatsIncluded({ kind: 'failed' }), null);
});
