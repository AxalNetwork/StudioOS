// D1171 (#2449, part 5) — Account › Usage › Storage complete (STG1–STG16):
// the allowance bar with its plan, by kind (and as a table), by company with
// ventures, the ten largest files, what counts; near, full and over; the
// profiles; empty, loading and error; the one storage refusal in the data
// room upload, the message composer and Record a Session (STG4); and A2m's
// Storage moved to the page (STG15).
//
// Every allowance here is the Worker's catalogue (`storagePlans.ts`), and every
// plan name the public catalogue's (`planCatalogue.ts`): no byte count of a
// plan is typed in this file.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/storage_page_d1171.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import StoragePage, { StorageView } from '../src/pages/account/StoragePage.jsx';
import StorageRefusal from '../src/pages/account/StorageRefusal.jsx';
import { StorageOverview } from '../src/pages/account/UsageOverview.jsx';
import { storageGroup } from '../src/pages/account/AccountUsage.jsx';
import { MAX_UPLOAD_MB, uploadRefusal } from '../src/pages/raise/dataroom/filesModel.js';
import { startRefusal } from '../src/pages/founder/recordSetup.js';
import {
  AREA_PLACE, KINDS, allowanceView, companyRows, emptyDoor, filterLargest, kindRows, largestRows, noticeFor, storageRefusal,
  storageSize, upgradeRows,
} from '../src/pages/account/storagePageModel.js';

const { storagePlan } = await import('../../cloudflare-worker/src/services/storagePlans.ts');
const { publicCatalogue } = await import('../../cloudflare-worker/src/services/planCatalogue.ts');

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const MB = 1024 ** 2;
const PLANS = { plans: [], catalogue: publicCatalogue() };
const ALLOW = (key) => storagePlan(key).allowance_bytes;

/** A storage read, as D1169 returns it, using a share of the plan's own allowance. */
function readOf({ plan = 'founder:growth', share = 0.32, state = 'ok', unknown = 0, unreadKind = null, allowance } = {}) {
  const allow = allowance === undefined ? ALLOW(plan) : allowance;
  const used = Math.round((allow ?? ALLOW('founder:growth')) * share);
  const parts = [0.42, 0.16, 0.31, 0.07, 0.01, 0.03];
  const sizes = parts.map((p) => Math.round(used * p));
  sizes[0] += used - sizes.reduce((a, b) => a + b, 0);
  const kinds = KINDS.map(([key], i) => (key === unreadKind
    ? { key, files: null, bytes: null, measured_bytes: null, unknown_size_files: null, recorded: false }
    : { key, files: 10 + i, bytes: sizes[i], measured_bytes: sizes[i], unknown_size_files: 0, recorded: true }));
  return {
    total_bytes: unreadKind ? null : used, files: unreadKind ? null : 75, unknown_size_files: unreadKind ? null : unknown,
    measured_bytes: unreadKind ? null : used, areas: [],
    plan_key: plan, allowance_bytes: allow, allowance_reason: storagePlan(plan)?.allowance_reason ?? null, plan_recorded: true,
    state: unreadKind ? null : state, kinds,
    companies: [
      { uid: 'c1', name: 'Acme Robotics', personal: false, files: 50, bytes: Math.round(used * 0.8), measured_bytes: Math.round(used * 0.8), unknown_size_files: 0,
        ventures: [{ uid: 'v1', name: 'Acme Field', files: 30, measured_bytes: Math.round(used * 0.5), unknown_size_files: 0 }, { uid: 'v2', name: 'Acme Labs', files: 20, measured_bytes: Math.round(used * 0.3), unknown_size_files: 0 }] },
      { uid: null, name: null, personal: true, files: 25, measured_bytes: used - Math.round(used * 0.8), unknown_size_files: 0, ventures: [] },
    ],
    largest: [
      { area: 'interview_recordings', kind: 'recordings', name: 'Customer interview 14.webm', version: null, bytes: 418 * MB, added_at: '2026-10-14 09:00:00', ref: 'i14', brand: null, venture_name: 'Acme Field', company_name: 'Acme Robotics' },
      { area: 'data_room_versions', kind: 'data_room', name: 'Series A deck.pdf', version: 6, bytes: 24 * MB, added_at: '2026-09-20 10:00:00', ref: 'f6', brand: null, venture_name: 'Acme Field', company_name: 'Acme Robotics' },
      { area: 'brand_files', kind: 'brand', name: null, version: null, bytes: 2 * MB, added_at: '2026-10-01 10:00:00', ref: 'b1', brand: 'brand_logo', venture_name: null, company_name: null },
      { area: 'csv_imports', kind: 'other', name: 'ledger.csv', version: null, bytes: MB, added_at: '2026-10-02 10:00:00', ref: '9', brand: null, venture_name: null, company_name: null },
    ],
    largest_complete: true,
  };
}

const page = (s, role = 'founder', plans = PLANS) => renderToStaticMarkup(h(MemoryRouter, null, h(StorageView, { s, plans, role, reload() {} })));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('sizes are binary, as the catalogue counts them: 1 GB = 1,024 MB, and a missing size is null, never 0', () => {
  assert.equal(storageSize(ALLOW('founder:growth')), '10 GB');
  assert.equal(storageSize(ALLOW('investor:professional')), '250 GB');
  assert.equal(storageSize(1024 * MB), '1 GB');
  assert.equal(storageSize(1000 * MB), '1000 MB', 'a thousand MB is not yet a GB');
  assert.equal(storageSize(Math.round(3.2 * 1024 * MB)), '3.2 GB');
  assert.equal(storageSize(0), '0 B');
  for (const missing of [null, undefined, -1, 1.5, '12']) assert.equal(storageSize(missing), null, String(missing));
});

test('STG1: your storage of your plan, the plan by name, what is left, the bar\'s parts and ticks, and Compare plans', () => {
  const v = allowanceView(readOf(), PLANS);
  assert.equal(v.mode, 'meter');
  assert.equal(v.label, 'Validate + Build');
  assert.equal(v.headline, '3.2 GB of 10 GB');
  assert.equal(v.side, '6.8 GB left');
  assert.equal(v.pct, 32);
  assert.equal(v.pill, null, 'below 80% there is no state pill');
  assert.equal(v.compare, true);
  assert.deepEqual(v.ticks.map((t) => +t.toFixed(2)), [0.8, 0.95], 'the ticks sit at 80% and 95% of the plan');
  assert.equal(+v.kinds.reduce((a, k) => a + k.share, 0).toFixed(4), 0.32, 'the kinds fill what is used, to scale');
  assert.equal(v.foot, 'Your plan includes 10 GB. Files you upload to your companies count toward your storage.');
  assert.equal(allowanceView(readOf(), null).label, null, 'without the plans read the pill names no plan');
});

test('STG2, STG3: near, almost full and full, each with the canvas\'s words; full keeps every file and a recording in progress', () => {
  const near = allowanceView(readOf({ share: 0.81, state: 'near_80' }), PLANS);
  assert.equal(near.pill.label, 'Near your limit'); assert.equal(near.warn, true); assert.equal(near.compare, true);
  assert.deepEqual(noticeFor(near), { tone: 'amber', text: 'You have used 80% of your storage. Uploads keep working.', compare: false, largest: true });
  const almost = allowanceView(readOf({ share: 0.96, state: 'near_95' }), PLANS);
  assert.equal(almost.pill.label, 'Almost full'); assert.equal(almost.compare, false, 'the notice carries Compare plans');
  assert.equal(noticeFor(almost).text, 'Your storage is almost full. At 100%, new uploads pause.');
  const full = allowanceView(readOf({ share: 1, state: 'full' }), PLANS);
  assert.equal(full.pill.label, 'Storage full'); assert.equal(full.side, 'None left'); assert.equal(full.full, true);
  const n = noticeFor(full);
  assert.equal(n.text, 'Storage full. New uploads are paused. Everything you stored stays, and you can still open and download it.');
  assert.equal(n.recording, 'A recording already in progress finishes and is kept.');
  assert.equal(noticeFor(allowanceView(readOf(), PLANS)), null, 'below 80% no notice');
  const drawn = text(page(readOf({ share: 0.96, state: 'near_95' })));
  assert.match(drawn, /Your storage is almost full\. At 100%, new uploads pause\. Compare plans See largest files/);
  const fullPage = page(readOf({ share: 1, state: 'full' }));
  assert.match(text(fullPage), /A recording already in progress finishes and is kept\./);
  assert.doesNotMatch(page(readOf()), /storage-notice/);
});

test('STG5: over the plan after a change is drawn past the plan\'s end, never clipped, and nothing was deleted', () => {
  const s = readOf({ share: 6.2, state: 'over' });
  const v = allowanceView(s, PLANS);
  assert.equal(v.pill.label, 'Over your plan');
  assert.equal(v.over, '52 GB'); assert.equal(v.side, '52 GB over');
  assert.equal(v.pct, 100, 'the progress value stops at 100');
  assert.ok(v.end < 1 && Math.abs(v.end - 1 / 6.2) < 1e-9, 'the plan ends inside the bar');
  assert.equal(+v.kinds.reduce((a, k) => a + k.share, 0).toFixed(4), 1, 'every byte used is drawn: the bar is scaled to what is used, so nothing is clipped');
  assert.match(noticeFor(v).text, /^Your plan is Validate \+ Build\. You are using 62 GB of 10 GB\. Nothing was deleted\. New uploads resume once you are under 10 GB\.$/);
  const out = page(s);
  assert.match(out, /data-testid="storage-meter-over"/);
  assert.match(text(out), /End of your plan · 10 GB · 52 GB over/);
  assert.ok(out.indexOf('storage-card-largest') >= 0 && out.indexOf('storage-card-largest') < out.indexOf('storage-card-kinds'), 'over the plan, the largest files come first');
  assert.equal(out.split('storage-card-largest').length, 2, 'and once');
});

test('no bar or percentage without an allowance: staff, a negotiated plan, an unread plan, and an unread kind', () => {
  const staff = allowanceView({ ...readOf({ plan: 'admin', allowance: null }), state: 'no_allowance' }, PLANS);
  assert.equal(staff.mode, 'staff'); assert.equal(staff.used, '3.2 GB');
  const inst = allowanceView(readOf({ plan: 'investor:institutional', state: null }), PLANS);
  assert.equal(inst.mode, 'negotiated'); assert.equal(inst.reason, 'Negotiated. How much of it you use is not shown.');
  const unread = allowanceView({ ...readOf(), plan_key: null, allowance_bytes: null, plan_recorded: false, state: null }, PLANS);
  assert.equal(unread.mode, 'negotiated'); assert.match(unread.reason, /Your plan could not be read/);
  assert.equal(allowanceView({ ...readOf(), allowance_bytes: undefined, state: null }, PLANS).mode, 'negotiated', 'an allowance the read leaves out is no figure');
  assert.equal(allowanceView({ ...readOf(), allowance_bytes: 0, state: null }, PLANS).mode, 'negotiated', 'a zero allowance draws no bar to divide by');
  assert.equal(allowanceView({ ...readOf({ plan: 'admin', allowance: null }), state: null }, PLANS).mode, 'staff', 'a staff account is known by its plan');
  const kind = allowanceView(readOf({ unreadKind: 'recordings' }), PLANS);
  assert.deepEqual([kind.mode, kind.reason], ['unread', 'Total not shown: Recordings could not be read, so a total would be wrong.']);
  for (const s of [{ ...readOf({ plan: 'admin', allowance: null }), state: 'no_allowance' }, readOf({ plan: 'investor:institutional', state: null }), readOf({ unreadKind: 'recordings' })]) {
    const out = page(s);
    assert.doesNotMatch(out, /storage-meter|role="progressbar"/, 'no bar');
    assert.doesNotMatch(text(out.replace(/data-testid="storage-kind-table"[\s\S]*$/, '')), /\d+% used|\d+(\.\d+)?% /, 'no percentage of a plan');
  }
});

test('STG13b: one kind unread blanks only itself, every share and the total; the rest stand', () => {
  const k = kindRows(readOf({ unreadKind: 'recordings' }));
  assert.equal(k.rows.find((r) => r.key === 'recordings').unread, true);
  assert.ok(k.rows.filter((r) => r.key !== 'recordings').every((r) => r.size && r.share === null), 'sizes stand, shares withheld');
  assert.equal(k.totalSize, null);
  const out = text(page(readOf({ unreadKind: 'recordings' })));
  assert.match(out, /Recordings Could not be read Try again/);
  assert.match(out, /In total — Total not shown/);
  assert.match(out, /Shares are not shown while one kind cannot be read\./);
});

test('by kind: sizes, files and shares of what is used; a kind with no files reads None, never 0 B', () => {
  const s = readOf();
  s.measured_bytes -= s.kinds[4].measured_bytes;
  s.kinds[4] = { ...s.kinds[4], files: 0, bytes: 0, measured_bytes: 0 };
  const k = kindRows(s);
  assert.equal(k.rows[4].size, 'None'); assert.equal(k.rows[4].files, 'None'); assert.equal(k.rows[4].share, null);
  const total = k.rows.filter((r) => r.share).reduce((a, r) => a + parseFloat(r.share), 0);
  assert.ok(Math.abs(total - 100) < 0.2, 'the shares add to what is used');
  assert.equal(k.totalSize, storageSize(s.measured_bytes));
});

test('by company: largest first, ventures under their company, the personal row last, and a withheld figure as null', () => {
  const rows = companyRows(readOf());
  assert.deepEqual(rows.map((r) => r.name), ['Acme Robotics', 'Not tied to a company']);
  assert.deepEqual(rows[0].ventures.map((v) => v.name), ['Acme Field', 'Acme Labs']);
  assert.equal(rows[0].share, 80);
  const blank = companyRows({ ...readOf(), companies: [{ uid: 'c1', name: 'Acme', personal: false, files: null, measured_bytes: null, ventures: [] }] });
  assert.deepEqual([blank[0].files, blank[0].size, blank[0].share], [null, null, null]);
  assert.equal(companyRows({ ...readOf(), companies: null }), null);
  const out = text(page(readOf()));
  assert.match(out, /This counts every company at once\. Switching company in the sidebar does not change it\./);
  assert.match(out, /▾ Acme Robotics/); assert.match(out, /└ Acme Field/);
});

test('the largest files: their names, kinds, companies, sizes and days, where Open goes, and the toolbar\'s filters and sort', () => {
  const rows = largestRows(readOf());
  assert.equal(rows[0].name, 'Customer interview 14.webm');
  assert.equal(rows[0].size, '418 MB'); assert.equal(rows[0].added, '14 Oct'); assert.equal(rows[0].to, '/validate/customer-research');
  assert.equal(rows[1].name, 'Series A deck.pdf · version 6'); assert.equal(rows[1].place, 'the data room, as an earlier version');
  assert.equal(rows[2].name, 'Your logo', 'a logo has no file name to show');
  assert.equal(rows[2].company, 'Personal');
  assert.equal(rows[3].to, null, 'no page opens imports, so no Open');
  for (const [area, [, to]] of Object.entries(AREA_PLACE)) if (to) assert.match(to, /^\/[a-z]/, area);
  assert.deepEqual(filterLargest(rows, { kind: 'brand' }).map((r) => r.name), ['Your logo']);
  assert.deepEqual(filterLargest(rows, { company: 'Personal' }).map((r) => r.kind), ['brand', 'other']);
  assert.deepEqual(filterLargest(rows, { sort: 'added' }).map((r) => r.added), ['14 Oct', '2 Oct', '1 Oct', '20 Sept'].map((d) => d.replace('Sept', new Date(Date.UTC(2026, 8, 20)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }))));
  const out = text(page(readOf()));
  assert.match(page(readOf()), /href="\/validate\/customer-research"[^>]*>Open ›/);
  assert.match(out, /Opens the interview/); assert.match(out, /No page opens it/); assert.match(out, /Open takes you to where the file lives\./);
  assert.match(text(page({ ...readOf(), largest_complete: false })), /a larger file may be missing from this list/);
});

/* ------------------------------------------------------------------ *
 * The profiles (STG6–STG10) and the empty state (STG11)
 * ------------------------------------------------------------------ */

test('STG6, STG9a: a Free or Basic plan shows the plans with more room, from the catalogue, and no Compare button of its own', () => {
  const rows = upgradeRows(PLANS, 'founder:free', ALLOW('founder:free'));
  assert.deepEqual(rows.map((r) => r.label), ['Validate + Build', 'Raise + Grow']);
  assert.deepEqual(rows.map((r) => r.size), [storageSize(ALLOW('founder:growth')), storageSize(ALLOW('founder:studio'))]);
  assert.equal(rows[0].best, storagePlan('founder:growth').best_suited);
  assert.deepEqual(upgradeRows(PLANS, 'advisor:free', ALLOW('advisor:free')).map((r) => r.label), ['Advisor Pro']);
  assert.deepEqual(upgradeRows(PLANS, 'founder:growth', ALLOW('founder:growth')), [], 'a paid plan is not upsold here');
  const same = { catalogue: [{ key: 'founder:free', family: 'founder', label: 'Free', storage: { bytes: ALLOW('founder:free') } }, { key: 'x', family: 'founder', label: 'Same', storage: { bytes: ALLOW('founder:free') } }] };
  assert.deepEqual(upgradeRows(same, 'founder:free', ALLOW('founder:free')), [], 'only a plan with more room is offered');
  const v = allowanceView(readOf({ plan: 'founder:free', share: 0.62 }), PLANS);
  assert.equal(v.compare, false);
  const priced = upgradeRows({ ...PLANS, plans: [{ catalogue: { key: 'advisor:pro' }, monthly: { unit_amount: 2000, currency: 'usd' } }] }, 'advisor:free', ALLOW('advisor:free'));
  assert.equal(priced[0].price, '$20 a month', 'a price is the read\'s, never typed');
  assert.match(text(page(readOf({ plan: 'founder:free', share: 0.62 }))), /More room as you grow/);
});

test('STG7: LP Access is personal storage, and fund documents are the fund\'s', () => {
  const v = allowanceView(readOf({ plan: 'lp_access', share: 0.11 }), PLANS);
  assert.equal(v.label, 'LP Access');
  assert.match(v.headline, / of 10 GB personal storage$/);
  assert.equal(v.foot, 'LP Access includes 10 GB of personal storage. Files you upload count toward it.');
  assert.match(text(page(readOf({ plan: 'lp_access', share: 0.11 }), 'investor')), /Fund documents don’t count\. Statements, notices and reports from your funds are kept by the fund, not in your storage\./);
});

test('STG10: a staff account has no allowance, and its uploads are never paused for space', () => {
  const out = text(page({ ...readOf({ plan: 'admin', allowance: null }), state: 'no_allowance' }, 'admin'));
  assert.match(out, /Staff account/); assert.match(out, /3\.2 GB used/);
  assert.match(out, /Staff accounts have no storage allowance\. Uploads are never paused for space\./);
});

test('STG11: no files yet, with the door each profile can open', () => {
  assert.deepEqual(emptyDoor('founder'), { label: 'Open the data room', to: '/raise/data-room/files' });
  assert.deepEqual(emptyDoor('investor'), { label: 'Open your research library', to: '/research/library' });
  for (const r of ['advisor', 'partner', 'admin', undefined]) assert.equal(emptyDoor(r), null, String(r));
  const empty = { ...readOf({ share: 0 }), files: 0, kinds: KINDS.map(([key]) => ({ key, files: 0, bytes: 0, measured_bytes: 0, unknown_size_files: 0, recorded: true })), largest: [] };
  const out = page(empty, 'investor');
  assert.match(text(out), /0 B of 10 GB/); assert.match(text(out), /No files yet\./); assert.match(text(out), /Open your research library/);
  assert.doesNotMatch(out, /storage-card-kinds|storage-card-largest/, 'one card in place of the lists');
  assert.doesNotMatch(text(page(empty, 'advisor')), /Open the data room|Open your research library/);
});

test('files whose size is not recorded yet are counted and said, never taken as 0', () => {
  const v = allowanceView(readOf({ unknown: 12 }), PLANS);
  assert.equal(v.pending, '12 files were stored before sizes were recorded. They are being measured.');
  assert.match(text(page(readOf({ unknown: 12 }))), /Size not recorded yet · 12 files/);
});

/* ------------------------------------------------------------------ *
 * Mounted: the reads, loading and error (STG12, STG13a)
 * ------------------------------------------------------------------ */

async function mounted(storageBody, { storageStatus = 200 } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    requests.push(path);
    if (/\/usage\/storage/.test(path)) { await gate; return { ok: storageStatus < 400, status: storageStatus, headers: { get: () => 'application/json' }, json: async () => storageBody, text: async () => JSON.stringify(storageBody) }; }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => PLANS, text: async () => JSON.stringify(PLANS) };
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(StoragePage, { role: 'founder' }))));
  const walk = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(walk).join(' ') : n.textContent || '');
  const txt = () => walk(container).replace(/\s+/g, ' ');
  const loading = txt();
  release();
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  return { requests, loading, text: txt, container, async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); } };
}

test('STG12, STG1 mounted: the cards read at once, then the page from two reads, the storage read and the plans', async () => {
  const v = await mounted(readOf());
  try {
    assert.match(v.loading, /Your storage Reading…/); assert.match(v.loading, /Largest files Reading…/);
    assert.doesNotMatch(v.loading, /\d+(\.\d)? (GB|MB)/, 'no figure while reading');
    assert.match(v.text(), /3\.2 GB of 10 GB/); assert.match(v.text(), /◆ Validate \+ Build/);
    assert.deepEqual([...v.requests].sort(), ['/public/plans-and-packs', '/usage/storage']);
  } finally { await v.close(); }
});

test('STG13a: the whole read failed, said as not the same as having none, with Try again, and no zero', async () => {
  const v = await mounted({ error: 'storage_unreadable' }, { storageStatus: 503 });
  try {
    assert.match(v.text(), /Your storage could not be read\. That is not the same as having none\. Try again/);
    assert.doesNotMatch(v.text(), /0 B|\b0 GB/);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * STG4: the one refusal, the same in all three places
 * ------------------------------------------------------------------ */

const refused = (data) => Object.assign(new Error('There is no room for this file.'), { status: 413, code: 'storage_full', data: { error: 'storage_full', ...data } });

test('STG4: the refusal from its own figures, yours or the company owner\'s, and full', () => {
  const allow = ALLOW('founder:growth');
  const e = refused({ used_bytes: allow - 3 * MB, allowance_bytes: allow, incoming_bytes: 24 * MB, counts_to: 'you' });
  assert.deepEqual(storageRefusal(e), {
    text: 'This file needs 24 MB. You have 3 MB left on your plan.', yours: true, full: false,
    links: [{ label: 'Open Storage', to: '/account/usage/storage' }, { label: 'Compare plans', to: '/pricing' }],
  });
  const owner = storageRefusal(refused({ used_bytes: allow - 3 * MB, allowance_bytes: allow, incoming_bytes: 24 * MB, counts_to: 'company_owner' }));
  assert.equal(owner.text, 'This file needs 24 MB. It counts to the company owner’s plan, which has 3 MB left.');
  assert.deepEqual(owner.links, [], 'the owner\'s plan is not yours to open or change');
  const full = storageRefusal(refused({ used_bytes: allow, allowance_bytes: allow, incoming_bytes: 0, counts_to: 'you' }));
  assert.equal(full.text, 'Storage full. Nothing new can be stored until you free up space or change plan. Everything you stored stays.');
  const noneLeft = storageRefusal(refused({ used_bytes: allow, allowance_bytes: allow, incoming_bytes: 24 * MB, counts_to: 'you' }));
  assert.equal(noneLeft.full, true, 'nothing left is full whatever the file\'s size');
  assert.match(noneLeft.text, /^Storage full\./);
    assert.equal(storageRefusal(Object.assign(new Error('x'), { status: 413 })), null, 'a file over the size limit is not a storage refusal');
  assert.equal(storageRefusal(null), null);
});

test('STG4: the data room upload, the message composer and Record a Session draw the same sentence and links', () => {
  const allow = ALLOW('founder:growth');
  const e = refused({ used_bytes: allow - 3 * MB, allowance_bytes: allow, incoming_bytes: 24 * MB, counts_to: 'you' });
  const want = storageRefusal(e);
  // The data room keeps its queue's short word, and draws the shared block.
  assert.equal(uploadRefusal(e), 'Refused: no room left on the storage plan');
  assert.equal(uploadRefusal({ status: 413 }), `Refused: larger than ${MAX_UPLOAD_MB} MB`, 'the size limit keeps its own words');
  const room = read('frontend/src/pages/raise/dataroom/DataRoomUpload.jsx');
  assert.match(room, /storage: storageRefusal\(e\)/); assert.match(room, /<StorageRefusal refusal=\{x\.storage\} \/>/);
  const composer = read('frontend/src/pages/MessagesPage.jsx');
  assert.match(composer, /const full = file \? storageRefusal\(ex\) : null;/); assert.match(composer, /<StorageRefusal refusal=\{storage\} \/>/);
  assert.match(composer, /Send without the file/);
  const rec = startRefusal(e);
  assert.deepEqual(rec.storage, want); assert.equal(rec.text, want.text);
  assert.match(read('frontend/src/pages/founder/RecordLightbox.jsx'), /<StorageRefusal refusal=\{refusal\.storage\} recording testId="record-storage-full" \/>/);
  const drawn = text(renderToStaticMarkup(h(MemoryRouter, null, h(StorageRefusal, { refusal: want }))));
  assert.equal(drawn.trim(), '! This file needs 24 MB. You have 3 MB left on your plan. Open Storage Compare plans');
  const recording = text(renderToStaticMarkup(h(MemoryRouter, null, h(StorageRefusal, { refusal: want, recording: true }))));
  assert.match(recording, /Start returns once there is room\. A recording already in progress finishes and is kept\./);
  for (const f of ['frontend/src/pages/account/StoragePage.jsx', 'frontend/src/pages/account/StorageRefusal.jsx', 'frontend/src/pages/account/storagePageModel.js']) {
    assert.doesNotMatch(read(f), /method:\s*['"](DELETE|POST|PUT|PATCH)['"]|\bapi\.\w*(delete|remove)\w*\(/i, `${f}: the page only reads; nothing in storage deletes or hides a file`);
  }
});

/* ------------------------------------------------------------------ *
 * STG15, STG17: A2m's Storage moved, and the Overview card
 * ------------------------------------------------------------------ */

test('STG15: A2m\'s Storage keeps its section and opens the Storage page, drawing no figure of its own', () => {
  const g = storageGroup();
  assert.equal(g.label, 'Storage');
  assert.deepEqual(g.rows.map((r) => [r.title, r.to]), [['Open Storage', '/account/usage/storage']]);
  const usage = read('frontend/src/pages/account/AccountUsage.jsx');
  assert.ok(!/usageApi\.storage\(\)/.test(usage.split('export default function UsageSection')[1]), 'the phone section no longer reads storage');
});

test('STG17a: the Overview card draws X of Y and the share used, from the same rules; never a zero for a missing total', () => {
  const ready = (data) => ({ status: 'ready', data, reload() {} });
  const out = text(renderToStaticMarkup(h(MemoryRouter, null, h(StorageOverview, { storage: ready(readOf()) }))));
  assert.match(out, /3\.2 GB of 10 GB/); assert.match(out, /32% used/);
  const unread = renderToStaticMarkup(h(MemoryRouter, null, h(StorageOverview, { storage: ready(readOf({ unreadKind: 'recordings' })) })));
  assert.match(text(unread), /Not recorded/); assert.doesNotMatch(unread, /% used|0 B/);
});

test('dark: every light surface the page and the refusal draw has its dark pair', () => {
  for (const f of ['frontend/src/pages/account/StoragePage.jsx', 'frontend/src/pages/account/StorageRefusal.jsx']) {
    const src = read(f);
    for (const m of src.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
      const cls = m[1];
      if (/\b(bg-white|bg-red-50|bg-amber-50|bg-axal-ground|bg-axal-lavender)\b/.test(cls)) assert.match(cls, /dark:bg-/, `${f}: ${cls}`);
      if (/\btext-axal-muted\b/.test(cls)) assert.match(cls, /dark:text-/, `${f}: ${cls}`);
    }
  }
});
