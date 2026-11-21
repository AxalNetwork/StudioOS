// D6199 (#6199) — the investor's closing room: the deadline and days left (or
// Not recorded), what is left (the steps that wait on them and a count of the
// rest, never another investor's line), and after Closed their amount, signed
// and received days, their signed copy, the duties the paper names for them
// and a link to the company in Portfolio. Read from `for_investor` on their
// own closing read (closings.ts, closingInvestorRoom.ts). The phone keeps the
// same content.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closing_investor_room_6199.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ClosingRoom from '../src/pages/closing/ClosingRoom.jsx';
import {
  ROOM_WAITS, investorDuties, investorLeft, investorSummary, portfolioCompanyHref, roomLines, roomTiles,
} from '../src/pages/closing/roomModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
  blob: async () => ({ size: 3, type: 'application/pdf' }),
});

/* ------------------------------------------------------------------ *
 * Fixtures: investor Harbor's own line on Acme's seed round
 * ------------------------------------------------------------------ */

const stage = (position, role, state, signed_at = null) => ({ position, role, name: null, state, sent_at: '2026-10-10', signed_at });
const MY_TURN = [{ uid: 's1', title: 'SAFE', complete: false, countersign: false, voided: false, stages: [stage(1, 'company', 'signed', '2026-10-09'), stage(2, 'investor', 'sent')] }];
const SIGNED = [{ uid: 's1', title: 'SAFE', complete: true, countersign: false, voided: false, stages: [stage(1, 'company', 'signed', '2026-10-09'), stage(2, 'investor', 'signed', '2026-10-11 12:00:00')] }];
const MINE = { uid: 'l2', commitment_id: 12, prospect_id: null, investor_name: 'Harbor Ventures', route: 'direct', amount_cents: 30000000, currency: 'USD', status: 'open', vehicle_ref: null, evidence: [] };

const OPEN_PART = {
  project_uid: 'proj-acme',
  // `l9` is not the viewer's line: a step tied to it is never drawn.
  conditions: { waiting_on_you: [{ line_uid: 'l2', step: 'sign' }, { line_uid: 'l9', step: 'send_payment' }], rest: { your_lines: 2, other_lines: 1, round: 1 }, rest_count: 4 },
  summary: [{ line_uid: 'l2', amount_cents: 30000000, currency: 'USD', signed_at: null, received_at: null, signed_copy: null }],
  reporting: { state: 'not_closed', duties: [] },
};
const CLOSED_PART = {
  project_uid: 'proj-acme',
  conditions: { waiting_on_you: [], rest: { your_lines: 0, other_lines: 0, round: 0 }, rest_count: 0 },
  summary: [{ line_uid: 'l2', amount_cents: 30000000, currency: 'USD', signed_at: '2026-10-11 12:00:00', received_at: '2026-10-15 14:02:00', signed_copy: { envelope_id: 55 } }],
  reporting: { state: 'ok', duties: [
    { uid: 'du1', line_uid: 'l2', kind: 'quarterly_update', title: 'Quarterly investor update', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, source: { document: 'voting_rights', clause: 'Investors’ Rights Agreement §1.1(c)', signed: true }, defaulted: [], starts_on: '2026-11-02', status: 'active' },
    { uid: 'du2', line_uid: 'l2', kind: 'annual_budget', title: 'Annual budget', cadence: 'annual', due_rule: 'before_start', due_days: 30, source: { document: 'voting_rights', clause: 'Investors’ Rights Agreement §1.1(d)', signed: true }, defaulted: ['due_days'], starts_on: '2026-11-02', status: 'active' },
  ] },
};
const CLOSING = (over = {}) => ({
  uid: 'c7', deal_id: 7, project_id: 5, round_label: 'Seed', instrument: 'Post-money SAFE', currency: 'USD', status: 'open', deadline: '2026-11-30',
  reach: 'own', total_cents: 65000000, line_count: 3, captable: { state: 'not_ready', decided_at: null }, lines: [MINE], events: null, closed_at: null,
  for_investor: OPEN_PART, ...over,
});
const CLOSED = (part = CLOSED_PART) => CLOSING({
  status: 'closed', closed_at: '2026-11-02T10:00:00Z', captable: { state: 'accepted', decided_at: '2026-11-01' },
  lines: [{ ...MINE, status: 'received', evidence: [{ uid: 'e1', kind: 'company_mercury', side: 'receiving', created_at: '2026-10-15 14:02:00' }] }], for_investor: part,
});
const ENTRY = { uid: 'c7', deal_id: 7, project_id: 5, project_name: 'Acme Robotics', round_label: 'Seed', instrument: 'Post-money SAFE', status: 'open', reach: 'own' };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('what is left: the viewer’s own steps only, and a count of the rest with its parts', () => {
  const c = CLOSING();
  const rows = roomLines(c, { l2: MY_TURN }, 'investor');
  const left = investorLeft(c, rows);
  assert.deepEqual(left.items.map((i) => [i.key, i.text, i.row.uid]), [['l2-sign', 'Sign the paper', 'l2']], 'a step on another line is dropped');
  assert.equal(left.restCount, 4);
  assert.equal(left.restText, '4 more steps are open in this round.');
  assert.deepEqual(left.restParts, ['2 on your line, waiting on another party or an earlier step', '1 line of other investors not yet received', '1 for the round as a whole']);
  assert.equal(investorLeft(CLOSING({ for_investor: undefined }), rows), null, 'no part in the read: null, never an empty list');
  assert.equal(investorLeft(CLOSING({ for_investor: { ...OPEN_PART, conditions: { waiting_on_you: [], rest: {}, rest_count: null } } }), rows).restText, null,
    'a missing count is not 0');
  assert.equal(investorLeft(CLOSING({ for_investor: { ...OPEN_PART, conditions: { waiting_on_you: [], rest: {}, rest_count: 0 } } }), rows).restText, 'Nothing else is open in this round.');
});

test('the deadline and days left come from the closing, or are null', () => {
  const t = roomTiles(CLOSING(), {}, new Date('2026-11-14T00:00:00Z'));
  assert.equal(t.deadline, '30 Nov 2026');
  assert.equal(t.left, 'in 16 days');
  assert.equal(roomTiles(CLOSING({ deadline: null }), {}).deadline, null);
});

test('after Closed: the summary, the duties and the Portfolio address, each honest when absent', () => {
  assert.deepEqual(investorSummary(CLOSED()), [{ key: 'l2', amount: '$300,000.00', signed: '11 Oct 2026', received: '15 Oct 2026', copyId: 55 }]);
  assert.deepEqual(investorSummary(CLOSED({ ...CLOSED_PART, summary: [{ line_uid: 'l2', amount_cents: null, signed_at: null, received_at: null, signed_copy: null }] })),
    [{ key: 'l2', amount: null, signed: null, received: null, copyId: null }]);
  assert.equal(investorSummary(CLOSED(null)), null);
  const d = investorDuties(CLOSED());
  assert.equal(d.state, 'ok');
  assert.deepEqual(d.rows.map((r) => [r.title, r.cadence, r.due, r.from, r.defaulted]), [
    ['Quarterly investor update', 'Quarterly', '45 days after the period ends', 'From Investors’ Rights Agreement §1.1(c)', false],
    ['Annual budget', 'Yearly', '30 days before the period starts', 'From Investors’ Rights Agreement §1.1(d)', true],
  ]);
  assert.equal(investorDuties(CLOSED({ ...CLOSED_PART, reporting: { state: 'unreadable', duties: [] } })).state, 'unreadable');
  assert.equal(investorDuties(CLOSED(null)).state, 'unrecorded');
  assert.equal(portfolioCompanyHref(CLOSED()), '/portfolio/companies/proj-acme');
  assert.equal(portfolioCompanyHref(CLOSED({ ...CLOSED_PART, project_uid: null })), null);
  assert.equal(portfolioCompanyHref(CLOSED({ ...CLOSED_PART, project_uid: '../admin' })), null, 'only a uid becomes an address');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount({ routes = {}, phone = false } = {}) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const asked = [];
  const saved = [];
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  URL.createObjectURL = () => 'blob:closing';
  URL.revokeObjectURL = () => {};
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    if (String(tag).toLowerCase() === 'a') Object.assign(n, { click() { saved.push(n.download); }, remove() {} });
    return n;
  };
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    asked.push(path);
    const hit = routes[path.split('?')[0]];
    if (hit instanceof Error) return response({ detail: hit.message }, Number(hit.status) || 500);
    return response(hit ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'investor', name: 'U' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(MemoryRouter, null, h(ClosingRoom, { dealId: 7, role: 'investor', deal: { id: 7, project_name: 'Acme Robotics', instrument: 'SAFE' } }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, saved, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { fetch: prev.fetch, matchMedia: prev.matchMedia });
      URL.createObjectURL = prev.create; URL.revokeObjectURL = prev.revoke;
      localStorage.removeItem('user'); restore();
    },
  };
}

const err = (status, message = 'down') => Object.assign(new Error(message), { status });
const ROUTES = (closing, over = {}) => ({
  '/closings': { closings: [ENTRY] },
  '/closings/c7': closing,
  '/legal/esign/staged/line/12': { envelopes: closing.status === 'closed' ? SIGNED : MY_TURN },
  '/mercury/investor/proposals': { proposals: [] },
  ...over,
});

test('mounted, open: the deadline with days left, the step that waits on you, and the count of the rest; no other line', async () => {
  const v = await mount({ routes: ROUTES(CLOSING()) });
  try {
    assert.match(v.text('closing-your-deadline'), /Closing deadline 30 Nov 2026 · (in \d+ days?|\d+ days? past)/);
    assert.match(v.text('closing-left-sign'), /Waits on you: Sign the paper.*Open the signing order/);
    assert.ok(!v.has('closing-left-send_payment'), 'the step tied to another investor’s line is not drawn');
    assert.match(v.text('closing-left-rest'), /4 more steps are open in this round\. 2 on your line.*1 line of other investors not yet received; 1 for the round as a whole\./);
    assert.ok(!v.text().includes('l9'));
    for (const id of ['closing-your-summary', 'closing-reporting', 'closing-portfolio-link']) assert.ok(!v.has(id), `${id} waits for Closed`);
    await v.click('closing-left-sign-open');
    assert.ok(v.has('closing-sign'), 'the signing order opens on the investor’s own line');
    assert.ok(!v.asked.some((a) => /reporting|closing-checklist|commitments|transfers/.test(a)), 'no read beyond the investor’s own');
  } finally { await v.close(); }
});

test('mounted, open: no deadline reads Not recorded with its reason; a read without the part says so, never "Nothing waits"', async () => {
  const v = await mount({ routes: ROUTES(CLOSING({ deadline: null, for_investor: undefined })) });
  try {
    assert.match(v.text('closing-your-deadline'), /Not recorded No deadline is recorded on this closing\./);
    assert.match(v.text('closing-left'), new RegExp(`Not recorded ${ROOM_WAITS.investorLeft}`));
    assert.ok(!v.has('closing-left-none'));
  } finally { await v.close(); }
});

test('mounted, closed: amount, signed and received days, the signed copy, the duties on the investor’s line, and the company in Portfolio', async () => {
  const v = await mount({ routes: ROUTES(CLOSED()) });
  try {
    assert.match(v.text('closing-summary-amount'), /Amount \$300,000\.00/);
    assert.match(v.text('closing-summary-signed'), /Signed 11 Oct 2026/);
    assert.match(v.text('closing-summary-received'), /Received 15 Oct 2026/);
    assert.equal(v.props('closing-portfolio-link').href, '/portfolio/companies/proj-acme');
    assert.match(v.text('closing-portfolio-link'), /Open Acme Robotics in Portfolio/);
    assert.match(v.text('closing-duty-du1'), /Quarterly investor update.*Quarterly · 45 days after the period ends.*§1\.1\(c\) ?, in the signed paper/);
    assert.match(v.text('closing-duty-du2'), /Annual budget.*Yearly · 30 days before the period starts.*Default, not in the paper/);
    assert.ok(!v.has('closing-left') && !v.has('closing-your-deadline'), 'nothing is left once Closed');
    assert.doesNotMatch(v.text('closing-reporting'), /Not read here yet/);
    await v.click('closing-signed-copy');
    assert.ok(v.asked.includes('/legal/esign/55/document'), 'the signed copy is the investor’s own envelope');
    assert.deepEqual(v.saved, ['axal-signed-55.pdf']);
  } finally { await v.close(); }
});

test('mounted, closed: no signed copy, no Portfolio address, no duty and an unreadable duty read each say so', async () => {
  const bare = { ...CLOSED_PART, project_uid: null, summary: [{ ...CLOSED_PART.summary[0], signed_copy: null, received_at: null }], reporting: { state: 'ok', duties: [] } };
  const v = await mount({ routes: ROUTES(CLOSED(bare)) });
  try {
    assert.match(v.text('closing-summary-copy'), new RegExp(ROOM_WAITS.signedCopy));
    assert.match(v.text('closing-summary-received'), /Not recorded No receiving-side evidence day is recorded\./);
    assert.match(v.text('closing-portfolio-none'), new RegExp(ROOM_WAITS.portfolio));
    assert.ok(!v.has('closing-portfolio-link'));
    assert.match(v.text('closing-reporting-empty'), new RegExp(ROOM_WAITS.investorReporting));
  } finally { await v.close(); }
  const u = await mount({ routes: ROUTES(CLOSED({ ...CLOSED_PART, reporting: { state: 'unreadable', duties: [] } })) });
  try {
    assert.match(u.text('closing-reporting-unread'), /could not be read.*not a claim that nothing is owed/);
  } finally { await u.close(); }
  const f = await mount({ routes: ROUTES(CLOSED(), { '/legal/esign/55/document': err(404, 'Envelope not found') }) });
  try {
    await f.click('closing-signed-copy');
    assert.deepEqual(f.saved, []);
    assert.match(f.text('closing-summary-copy'), /could not be downloaded/);
  } finally { await f.close(); }
});

test('mounted: when the Worker could not read the investor part, each block says Unreadable with Retry, and the line still draws', async () => {
  const open = await mount({ routes: ROUTES(CLOSING({ for_investor: { unreadable: true } })) });
  try {
    assert.match(open.text('closing-left'), /What is left could not be read\. This is not a claim that nothing is left\..*Retry/);
    assert.ok(open.has('closing-your-amount'), 'the line still draws');
  } finally { await open.close(); }
  const closed = await mount({ routes: ROUTES(CLOSED({ unreadable: true })) });
  try {
    assert.match(closed.text('closing-your-summary'), /Your closing’s summary could not be read/);
    assert.match(closed.text('closing-reporting'), /Your reporting duties could not be read\. This is not a claim that nothing is owed to you\./);
    assert.ok(!closed.has('closing-reporting-empty'), 'an unreadable read is never "no duty"');
  } finally { await closed.close(); }
});

test('mounted, refused:another investor’s closing reads as not theirs, and nothing of the investor part draws', async () => {
  const v = await mount({ routes: { '/closings': { closings: [ENTRY] }, '/closings/c7': err(404, 'No closing here.') } });
  try {
    assert.ok(v.has('closing-no-access'));
    for (const id of ['closing-left', 'closing-your-deadline', 'closing-your-summary', 'closing-reporting', 'closing-portfolio-link']) assert.ok(!v.has(id), id);
    assert.ok(!v.asked.some((a) => a.startsWith('/legal/esign/')), 'no paper read');
  } finally { await v.close(); }
});

test('mounted, phone: the same content, one column, actions the full width', async () => {
  const open = await mount({ phone: true, routes: ROUTES(CLOSING()) });
  try {
    for (const id of ['closing-your-deadline', 'closing-left-sign', 'closing-left-rest']) assert.ok(open.has(id), id);
    assert.match(open.text('closing-left-rest'), /4 more steps are open in this round/);
  } finally { await open.close(); }
  const closed = await mount({ phone: true, routes: ROUTES(CLOSED()) });
  try {
    for (const id of ['closing-summary-amount', 'closing-summary-signed', 'closing-summary-received', 'closing-signed-copy', 'closing-duty-du1', 'closing-duty-du2']) assert.ok(closed.has(id), id);
    assert.match(closed.props('closing-portfolio-link').className, /min-h-\[48px\] w-full/);
    assert.match(closed.props('closing-signed-copy').className, /w-full/);
  } finally { await closed.close(); }
});

test('the wiring: the signed copy is a mounted route, light classes carry their dark pair, and the decision file', () => {
  assert.match(read('cloudflare-worker/src/routes/esign.ts'), /esign\.get\('\/:id\{\[0-9\]\+\}\/document'/);
  assert.match(read('frontend/src/lib/api/closings.js'), /signedCopyBlob: async \(envelopeId\) =>[\s\S]*\/api\/legal\/esign\/\$\{encodeURIComponent\(envelopeId\)\}\/document/);
  assert.match(read('frontend/src/App.jsx'), /path="\/portfolio\/companies\/:uid"/, 'the Portfolio company address exists');
  const src = read('frontend/src/pages/closing/RecordRoom.jsx');
  for (const m of src.matchAll(/className="([^"]+)"/g)) {
    if (/\bbg-white\b/.test(m[1])) assert.match(m[1], /dark:bg-/, m[1]);
    if (/\bborder-gray-(100|200|300)\b/.test(m[1])) assert.match(m[1], /dark:border-/, m[1]);
    if (/\btext-(gray|red|amber)-\d00\b/.test(m[1])) assert.match(m[1], /dark:text-/, m[1]);
  }
  assert.match(read('documentation/architecture/decisions/D6199.md'), /^## D6199 — .+ \(#6199\)/m);
});
