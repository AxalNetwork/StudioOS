/**
 * D8838 (#8838, canvas D6158 DX22 board DCL24, dark DX28 B) — the investor's
 * Open my closing room in the closing workspace at /deals/closing?deal=<id>.
 *
 *   · drawn only for an investor, and only on a line that is their own (the
 *     line's investor_user_id is the signed-in user's id);
 *   · never for an Admin or an Operating Partner, even when the read carries
 *     a line;
 *   · it leads to /deals/:dealId/closing, the deal page's Closing tab where
 *     ClosingRoom.jsx is: no new route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { myClosingRoomHref } from '../src/pages/investor/deals/closingWorkspaceModel.js';
import ClosingWorkspace, { OpenMyClosingRoom } from '../src/pages/investor/deals/ClosingWorkspace.jsx';
import { SUB_PAGES } from '../src/pages/dealPageModel.js';
import { api } from '../src/lib/api.js';
import { closingsApi } from '../src/lib/api/closings.js';
import { dealStaffApi } from '../src/lib/api/dealStaff.js';
import { dealClosingHistoryApi } from '../src/lib/api/dealClosingHistory.js';

const h = React.createElement;
const ME = 41;
const OWN = { uid: 'line-own', investor_user_id: ME, amount_cents: 10000000, status: 'open' };
const OTHER = { uid: 'line-other', investor_user_id: 52, amount_cents: 25000000, status: 'open' };

test('the href is the deal page’s Closing tab, for an investor on their own line only', () => {
  assert.equal(myClosingRoomHref({ role: 'investor', userId: ME, line: OWN, dealId: 4 }), '/deals/4/closing');
  assert.equal(myClosingRoomHref({ role: 'investor', userId: String(ME), line: { ...OWN, investor_user_id: String(ME) }, dealId: '4' }), '/deals/4/closing', 'ids compare as numbers');
  assert.equal(myClosingRoomHref({ role: 'investor', userId: ME, line: OTHER, dealId: 4 }), null, 'another investor’s line');
  assert.equal(myClosingRoomHref({ role: 'investor', userId: ME, line: { ...OWN, investor_user_id: null }, dealId: 4 }), null, 'a line with no investor user');
  assert.equal(myClosingRoomHref({ role: 'investor', userId: null, line: OWN, dealId: 4 }), null, 'no signed-in id');
  assert.equal(myClosingRoomHref({ role: 'investor', userId: null, line: { ...OWN, investor_user_id: null }, dealId: 4 }), null, 'two missing ids are not a match');
  assert.equal(myClosingRoomHref({ role: 'investor', userId: ME, line: null, dealId: 4 }), null, 'no line');
  for (const role of ['admin', 'partner', 'founder', undefined]) {
    assert.equal(myClosingRoomHref({ role, userId: ME, line: OWN, dealId: 4 }), null, `role ${role}`);
  }
  for (const dealId of [0, '', 'abc', '4/x', null]) {
    assert.equal(myClosingRoomHref({ role: 'investor', userId: ME, line: OWN, dealId }), null, `deal id ${dealId}`);
  }
  // The route already opens the room to an investor (no new route).
  assert.ok(SUB_PAGES.closing.roles.includes('investor'));
  assert.equal(SUB_PAGES.closing.path, 'closing');
});

test('the action is one link, Open my closing room, and nothing without an href', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(OpenMyClosingRoom, { href: '/deals/4/closing' })));
  assert.match(html, /href="\/deals\/4\/closing"/);
  assert.match(html, />\s*Open my closing room\s*</);
  assert.match(html, /min-h-\[44px\]/, 'a 44px target on a phone');
  assert.match(html, /dark:bg-violet-500/, 'a dark token');
  assert.equal(renderToStaticMarkup(h(MemoryRouter, null, h(OpenMyClosingRoom, { href: null }))), '');
});

// The workspace mounted on the reads main serves, with the closing read
// carrying `line` as its only line, as the Worker scopes it for an investor.
async function mountWorkspace(user, line) {
  const saved = [];
  const stub = (obj, key, fn) => { saved.push([obj, key, obj[key]]); obj[key] = fn; };
  stub(api, 'dealClosingChecklist', async () => ({ checklist: null }));
  stub(api, 'esignList', async () => ({ envelopes: [] }));
  stub(api, 'icConditions', async () => ({ items: [] }));
  stub(api, 'dealTransfers', async () => ({ items: [] }));
  stub(dealStaffApi, 'transferGate', async () => ({ held: false }));
  stub(dealClosingHistoryApi, 'events', async () => ({ events: [] }));
  stub(closingsApi, 'list', async () => ({ closings: [{ uid: 'cl-1', deal_id: 4 }] }));
  stub(closingsApi, 'read', async () => ({
    uid: 'cl-1', deal_id: 4, status: 'open', currency: 'USD', total_cents: 35000000, line_count: 2,
    lines: line ? [line] : [], events: [], captable: { state: 'not_ready' },
  }));
  const m = await mountContracts(h(ClosingWorkspace, { dealId: 4, deal: { project_name: 'Tidewater' }, user, onBack() {}, onRecordTransfer() {} }), '/deals/closing?deal=4');
  await m.flush();
  await m.flush();
  const links = m.nodes().filter((n) => n.tagName === 'A' && m.props(n)?.['data-testid'] === 'closing-workspace-open-my-room');
  const out = { text: m.text(), hrefs: links.map((n) => m.props(n).href) };
  await m.unmount();
  for (const [obj, key, fn] of saved.reverse()) obj[key] = fn;
  return out;
}

test('the investor sees Open my closing room on their own line, leading to /deals/4/closing', async () => {
  const r = await mountWorkspace({ id: ME, role: 'investor' }, OWN);
  assert.match(r.text, /Your line/);
  assert.deepEqual(r.hrefs, ['/deals/4/closing']);
  assert.match(r.text, /Open my closing room/);
});

test('it is not drawn on a line that is not the investor’s own', async () => {
  const r = await mountWorkspace({ id: ME, role: 'investor' }, OTHER);
  assert.deepEqual(r.hrefs, []);
  assert.doesNotMatch(r.text, /Open my closing room/);
});

test('an Admin and an Operating Partner never see it, even with a line in the read', async () => {
  for (const role of ['admin', 'partner']) {
    const r = await mountWorkspace({ id: ME, role }, OWN);
    assert.match(r.text, /Total committed/, `${role}: the workspace rendered`);
    assert.deepEqual(r.hrefs, [], role);
    assert.doesNotMatch(r.text, /Open my closing room/, role);
  }
});
