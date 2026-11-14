/**
 * D1235 (#3243) — KYC part 7: Renewals (KYC9), Audit (KYC10), how long a
 * check lasts (KYC17c) and HQ's export (KYC17d, KYC14b), over part 4's reads
 * (D1232, `routes/kyc_governance.ts`).
 *
 * The model's rules, then the tabs mounted against the Worker's own shapes
 * through a stubbed fetch. Every person and admin is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/kyc_governance_d1235.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import KycRenewals from '../src/pages/admin/kyc/KycRenewals.jsx';
import KycAudit from '../src/pages/admin/kyc/KycAudit.jsx';
import {
  actionOptions, auditLead, auditParams, auditRow, canExport, changeLine, dayBars, exportProblem, exportedLine, monthLead, periodChanges,
  periodRow, rangeLine, renewalChipCount, renewalRow, renewalTiles, warnedLine, windowDates,
} from '../src/pages/admin/kyc/governanceModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-10-21T10:42:00Z');
const ADMIN = { id: 2, name: 'Ada Admin', role: 'admin', is_super_admin: 0 };
const SUPER = { id: 1, name: 'Hana HQ', role: 'admin', is_super_admin: 1 };

/* ------------------------------------------------------------------ *
 * The Worker's shapes (services/kycGovernance.ts)
 * ------------------------------------------------------------------ */

const W = (sent) => [30, 14, 7].map((days, i) => ({ days, sent_at: sent[i] ? '2026-10-01 08:00:00' : null }));
const RENEWALS = (over = {}) => ({
  as_of: '2026-10-21T10:42:00.000Z', horizon: '2027-10-21T10:42:00.000Z',
  counts: {
    expire_30: { count: 6, next: '2026-11-02 00:00:00' }, expired: 2, all: 8,
    rechecks: { recorded: false, unreadable: true, reason: 'The re-check requests could not be read, so they are not counted.' },
    screened_over_12: { recorded: true, count: 41, never_screened: 5 },
  },
  months: Array.from({ length: 12 }, (_, k) => ({ month: `20${k < 3 ? '26' : '27'}-${String(((k + 9) % 12) + 1).padStart(2, '0')}`, people: [6, 0, 1, 0, 0, 7, 0, 0, 7, 0, 0, 0][k], businesses: [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0][k] })),
  filter: 'all', total: 2, page: 1, page_size: 25,
  items: [
    { id: 11, who: { id: 9, name: 'Finn Mock', role: 'investor' }, kind: 'person', check: 'kyc_v1', what: 'Identity verification (KYC)',
      expires_at: '2026-10-03 00:00:00', days_left: -18, expired: true, warned: W([1, 1, 1]), obligation_status: 'expired', kyc_status: 'expired', recheck_asked_at: '2026-10-20 09:00:00' },
    { id: 12, who: { id: 40, name: null, role: 'partner' }, kind: 'business', check: 'kyb_v1', what: 'Entity verification (KYB)',
      expires_at: '2026-11-02 00:00:00', days_left: 11, expired: false, warned: W([1, 0, 0]), obligation_status: 'satisfied', kyc_status: null, recheck_asked_at: null },
  ],
  ...over,
});
const PERIODS = (canChange) => ({
  can_change: canChange,
  periods: [
    { key: 'kyc_v1', label: 'Identity (KYC)', months: 24, default_months: 24, set_by_hq: false, updated_at: null, updated_by: null, applied: true },
    { key: 'kyb_v1', label: 'Entity (KYB)', months: 24, default_months: 24, set_by_hq: true, updated_at: '2026-10-02 12:00:00', updated_by: 'Hana HQ', applied: true },
    { key: 'accreditation_v1', label: 'Accreditation evidence', months: 12, default_months: 12, set_by_hq: false, updated_at: null, updated_by: null, applied: false, reason: 'No route approves accreditation evidence yet, so this period is kept and not yet used.' },
  ],
});
const DAYS = (n) => Array.from({ length: n }, (_, i) => ({ day: new Date(NOW - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10), looks: i % 3, decisions: i % 2 }));
const AUDIT = () => ({
  from: '2026-09-22T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z',
  per_day: DAYS(30),
  admins: [{ id: 2, name: 'Ada Admin' }, { id: 3, name: 'Ben Second' }],
  actions: [
    { key: 'kyc_queue_access', word: 'Opened the list', kind: 'look' },
    { key: 'kyc_record_access', word: 'Opened a case', kind: 'look' },
    { key: 'kyc_case_access', word: 'Opened a case', kind: 'look' },
    { key: 'kyc_rejected_by_admin', word: 'Rejected', kind: 'decision' },
  ],
  total: 2, page: 1, page_size: 25,
  items: [
    { id: 501, at: '2026-10-21 10:45:00', admin: { id: 2, name: 'Ada Admin' }, action: 'kyc_field_shown', word: 'Showed a value', kind: 'look', case: { id: 7, name: 'Dev Testcase' }, detail: 'Date of birth' },
    { id: 500, at: '2026-10-21 10:42:00', admin: { id: 3, name: null }, action: 'kyc_queue_access', word: 'Opened the list', kind: 'look', case: null, detail: '10 rows' },
  ],
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a count the read did not return is Not recorded with its reason; a counted 0 stays 0', () => {
  const t = Object.fromEntries(renewalTiles(RENEWALS().counts).map((x) => [x.key, x]));
  assert.deepEqual([t.expire_30.value, t.expire_30.sub], [6, 'Next: 2 Nov 2026']);
  // Mutation checked: read an unrecorded count as 0 → value 0.
  assert.equal(t.rechecks.value, null, 'unreadable re-checks are not counted');
  assert.match(t.rechecks.sub, /could not be read/);
  assert.deepEqual([t.screened.value, t.screened.sub], [41, '5 people never screened, counted apart. Screen again from each case.']);
  // Measured zeros are drawn as 0.
  const zero = Object.fromEntries(renewalTiles({ expire_30: { count: 0, next: null }, expired: 0, all: 0,
    rechecks: { recorded: true, count: 0, oldest: null }, screened_over_12: { recorded: true, count: 0, never_screened: 0 } }).map((x) => [x.key, x]));
  assert.deepEqual([zero.expire_30.value, zero.expired.value, zero.rechecks.value, zero.screened.value], [0, 0, 0, 0]);
  assert.equal(zero.rechecks.sub, 'None open.');
  // No counts at all (the read failed): every tile is Not recorded.
  assert.deepEqual(renewalTiles(null).map((x) => x.value), [null, null, null, null]);
  assert.equal(renewalChipCount(null, 'all'), null);
  assert.deepEqual(['soon', 'expired', 'all'].map((k) => renewalChipCount(RENEWALS().counts, k)), [6, 2, 8]);
});

test('a renewal row in words: expired first, a business, a gone name, the warnings sent', () => {
  const [p, b] = RENEWALS().items.map(renewalRow);
  assert.deepEqual([p.name, p.kind, p.expires, p.when, p.status, p.personId, p.recheck],
    ['Finn Mock', 'Person', '3 Oct 2026', 'Expired 18 days ago', 'Expired', 9, 'Re-check asked 20 Oct 2026']);
  // Mutation checked: link a business to a person's case → personId 40.
  assert.deepEqual([b.name, b.kind, b.when, b.status, b.personId], ['Account 40', 'Business', 'In 11 days', 'Approved', null]);
  assert.equal(renewalRow({ ...RENEWALS().items[1], days_left: 0 }).when, 'Expires today');
  assert.equal(renewalRow({ ...RENEWALS().items[1], days_left: null }).when, 'Date not recorded');
  assert.equal(renewalRow({ ...RENEWALS().items[1], obligation_status: 'pending' }).status, 'Not recorded');
  assert.equal(warnedLine(p.warned), 'Warned at 30, 14 and 7 days');
  assert.equal(warnedLine(b.warned), 'Warned at 30 days');
  assert.equal(warnedLine(renewalRow({ ...RENEWALS().items[1], warned: W([0, 0, 0]) }).warned), 'Not warned yet');
  assert.equal(rangeLine(8, 1, 25), '1–8 of 8');
  assert.equal(rangeLine(0, 1, 25), '0 of 0');
  assert.equal(rangeLine(undefined, 1, 25), 'Not recorded');
});

test('the month chart’s lead names the busiest months, and a year with none says so', () => {
  assert.equal(monthLead(RENEWALS().months), 'March 2027 and June 2027 carry the most renewals (8 each). October has 6 checks to warn and re-check.');
  assert.equal(monthLead(RENEWALS().months.map((m) => ({ ...m, people: 0, businesses: 0 }))), 'No check expires in the next 12 months.');
});

test('periods: only changed values are sent, each a whole number of months from 1 to 120', () => {
  const ps = PERIODS(true).periods;
  assert.deepEqual(periodChanges(ps, { kyc_v1: '24', kyb_v1: '24', accreditation_v1: '18' }),
    { changes: [{ key: 'accreditation_v1', label: 'Accreditation evidence', from: 12, to: 18 }], error: null });
  assert.equal(periodChanges(ps, { kyc_v1: '24' }).error, 'Nothing has changed yet.');
  // Mutation checked: let 0 through → no error.
  assert.match(periodChanges(ps, { kyc_v1: '0' }).error, /from 1 to 120/);
  assert.match(periodChanges(ps, { kyc_v1: '121' }).error, /from 1 to 120/);
  assert.match(periodChanges(ps, { kyc_v1: '2.5' }).error, /whole number/);
  assert.equal(changeLine({ label: 'Accreditation evidence', from: 12, to: 18 }), 'Accreditation evidence: 12 months → 18 months.');
  assert.deepEqual([periodRow(ps[0]).source, periodRow(ps[1]).source], ['The default', 'Set by Hana HQ on 2 Oct 2026']);
  assert.match(periodRow(ps[2]).unused, /not yet used/);
});

test('only a Super Admin at HQ is offered Export; an Admin and a branch never are', () => {
  assert.equal(canExport(SUPER), true);
  // Mutation checked: drop the elevation check → an Admin is offered Export.
  assert.equal(canExport(ADMIN), false);
  // Mutation checked: drop the branch check → a branch's flagged account is offered it.
  assert.equal(canExport({ ...SUPER, branch: { code: 'lisbon', name: 'Studio Lisbon' } }), false);
  assert.equal(canExport(null), false);
  assert.equal(exportProblem({ from: '2026-09-22', to: '2026-10-21', reason: 'short' }), 'Say why, in 10 to 500 characters. The reason is recorded with the export.');
  assert.equal(exportProblem({ from: '2026-10-22', to: '2026-10-21', reason: 'Quarterly review.' }), 'The start comes before the end.');
  assert.equal(exportProblem({ from: '2025-01-01', to: '2026-10-21', reason: 'Quarterly review.' }), 'Ask for at most a year at a time.');
  assert.equal(exportProblem({ from: '2026-09-22', to: '2026-10-21', reason: 'Quarterly review.' }), null);
  // The export is recorded before the file leaves: a file the browser refused is said as that.
  assert.equal(exportedLine(1, true), 'Exported 1 row. The export is recorded.');
  assert.match(exportedLine(2, false), /^The export of 2 rows is recorded, but this browser did not take the file\./);
});

test('the audit query, its window, its options, its chart and its rows', () => {
  assert.deepEqual(windowDates('30', NOW), { from: '2026-09-22', to: '2026-10-21' });
  assert.deepEqual(windowDates('7', NOW), { from: '2026-10-15', to: '2026-10-21' });
  assert.deepEqual(auditParams({ window: '30', action: '', admin: '', case: null, q: ' ', page: 1 }, NOW), { from: '2026-09-22', to: '2026-10-21' });
  assert.deepEqual(auditParams({ window: '7', action: 'kyc_rejected_by_admin', admin: '3', case: { id: 7 }, q: 'dev', page: 2 }, NOW),
    { from: '2026-10-15', to: '2026-10-21', action: 'kyc_rejected_by_admin', admin: '3', case: 7, q: 'dev', page: 2 });
  // Two actions share a word; the options never read alike.
  const labels = actionOptions(AUDIT().actions).map((o) => o.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(labels, ['Opened the list', 'Opened a case · the record', 'Opened a case · its history', 'Rejected']);
  // A day each up to two months; a week each beyond.
  assert.equal(dayBars(DAYS(30)).length, 30);
  // Mutation checked: never group → 365 bars.
  assert.equal(dayBars(DAYS(365)).length, 53);
  assert.equal(dayBars(DAYS(365)).reduce((t, b) => t + b.looks, 0), DAYS(365).reduce((t, d) => t + d.looks, 0), 'grouping keeps every look');
  assert.match(auditLead(DAYS(30), NOW), /^30 looks and 15 decisions in this window\. Today so far: 2 looks and 1 decision\.$/);
  const [a, b] = AUDIT().items.map(auditRow);
  assert.deepEqual([a.when, a.admin, a.word, a.case.name, a.detail], ['21 Oct 2026 10:45', 'Ada Admin', 'Showed a value', 'Dev Testcase', 'Date of birth']);
  assert.deepEqual([b.admin, b.case], ['Account 3', null]);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (url.includes('/api/kyc/admin/renewals')) return response(RENEWALS());
    if (url.includes('/api/kyc/admin/periods')) return response(PERIODS(false));
    if (url.includes('/api/kyc/admin/audit/export')) return response({ filename: 'kyc-audit_2026-09-22_2026-10-21.csv', rows: 2, csv: 'when,admin\n' });
    if (url.includes('/api/kyc/admin/audit')) return response(AUDIT());
    return response({});
  };
}

async function mounted(element, { handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, open: globalThis.open, alert: globalThis.alert, confirm: globalThis.confirm, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const requests = [];
  const popups = [];
  const files = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.open = (...a) => { popups.push(['open', ...a]); return null; };
  globalThis.alert = (...a) => popups.push(['alert', ...a]);
  globalThis.confirm = (...a) => { popups.push(['confirm', ...a]); return true; };
  URL.createObjectURL = (blob) => { files.push(blob); return 'blob:kyc'; };
  const clicks = [];
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const el = make(tag); if (tag === 'a') { el.click = () => clicks.push(el.download); el.remove = () => {}; } return el; };
  URL.revokeObjectURL = () => {};
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, popups, files, clicks, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(document.body),
    count: (id) => nodes().filter((n) => props_(n)['data-testid'] === id).length,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value } }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { fetch: previous.fetch, open: previous.open, alert: previous.alert, confirm: previous.confirm });
      URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke;
      restore();
    },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET');

test('mounted KYC9: the counts, the chart, expired first, the warnings, and Not recorded where the read did not count', async () => {
  const r = await mounted(h(KycRenewals));
  try {
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/admin/renewals?filter=all'), JSON.stringify(r.requests.map((q) => q.url)));
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/admin/periods'));
    assert.equal(r.textOf('kyc-renewal-tile-expire_30-value'), '6');
    assert.equal(r.textOf('kyc-renewal-tile-expired-value'), '2');
    assert.equal(r.textOf('kyc-renewal-tile-screened-value'), '41');
    // Mutation checked: draw an unrecorded count as 0 → a value node and no Not recorded.
    assert.ok(r.has('kyc-renewal-tile-rechecks-unrecorded'));
    assert.ok(!r.has('kyc-renewal-tile-rechecks-value'), 'never a 0 for the re-checks it could not count');
    assert.match(r.textOf('kyc-renewal-tile-rechecks'), /could not be read/);
    assert.match(r.textOf('kyc-renewals-chart-lead'), /March 2027 and June 2027 carry the most renewals/);
    assert.equal(r.count('kyc-renewal-row'), 2);
    assert.equal(r.textOf('kyc-renewal-when-11'), 'Expired 18 days ago');
    assert.equal(r.textOf('kyc-renewal-chip-all'), 'All8');
    assert.equal(r.textOf('kyc-renewals-range'), '1–2 of 2');
    // An Admin reads the periods; HQ sets them.
    assert.equal(r.textOf('kyc-period-months-kyc_v1'), '24 months');
    assert.ok(r.has('kyc-periods-hq') && !r.has('kyc-periods-edit'));
    await r.click('kyc-renewal-chip-expired');
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/admin/renewals?filter=expired'));
    assert.deepEqual(writes(r), [], 'reading writes nothing');
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }
});

test('mounted: a failed renewals read is Unreadable with Try again, and the periods still draw', async () => {
  let fail = true;
  const r = await mounted(h(KycRenewals), { handle: handler({ '/api/kyc/admin/renewals': { answer: () => (fail ? response({ state: 'unreadable', detail: 'The renewals could not be read. Try again.' }, 503) : response(RENEWALS())) } }) });
  try {
    assert.ok(r.has('kyc-renewals-failed'));
    assert.ok(!r.has('kyc-renewals-tiles'), 'no tile, so no 0');
    assert.ok(!r.has('kyc-renewal-row'));
    assert.match(r.all(), /This is not a sign that there are none/);
    assert.ok(r.has('kyc-period-kyc_v1'), 'one failed block never blanks the page');
    fail = false;
    await r.click('kyc-renewals-failed-retry');
    assert.equal(r.count('kyc-renewal-row'), 2);
  } finally { await r.close(); }
});

test('mounted KYC17c: HQ changes a period in a dialog that says existing dates do not move', async () => {
  let periods = PERIODS(true);
  const r = await mounted(h(KycRenewals), { handle: handler({
    '/api/kyc/admin/periods': { answer: (u, o) => {
      if (o.method === 'PUT') { periods = { ...periods, periods: periods.periods.map((p) => (p.key === 'accreditation_v1' ? { ...p, months: 18, set_by_hq: true, updated_by: 'Hana HQ', updated_at: '2026-10-21 10:50:00' } : p)) }; return response({ changes: [{ key: 'accreditation_v1', from: 12, to: 18 }], periods: periods.periods }); }
      return response(periods);
    } },
  }) });
  try {
    await r.click('kyc-periods-edit');
    assert.equal(r.textOf('kyc-periods-problem'), 'Nothing has changed yet.');
    await r.change('kyc-period-input-accreditation_v1', '18');
    await r.click('kyc-periods-save');
    assert.equal(r.textOf('kyc-periods-change-accreditation_v1'), 'Accreditation evidence: 12 months → 18 months.');
    assert.equal(r.textOf('kyc-periods-note'), 'New periods apply to checks approved from today. Existing dates do not move.');
    assert.deepEqual(writes(r), [], 'nothing is saved before the dialog’s button');
    await r.click('kyc-periods-dialog-go');
    // Mutation checked: send every period → kyc_v1 and kyb_v1 in the body too.
    assert.deepEqual(writes(r).map((q) => [q.method, q.url, q.body]), [['PUT', '/api/kyc/admin/periods', { periods: { accreditation_v1: 18 } }]]);
    assert.ok(!r.has('kyc-periods-dialog'));
    assert.equal(r.textOf('kyc-period-months-accreditation_v1'), '18 months');
    assert.equal(r.textOf('kyc-periods-saved'), 'Saved. Existing dates did not move.');
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }
});

test('mounted KYC10 as an Admin: the record, the filters, and one sentence where Export would be', async () => {
  const r = await mounted(h(KycAudit, { me: ADMIN, nowMs: NOW }));
  try {
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/admin/audit?from=2026-09-22&to=2026-10-21'), JSON.stringify(r.requests.map((q) => q.url)));
    // Mutation checked: draw Export for everyone → kyc-export-open exists.
    assert.ok(!r.has('kyc-export-open'), 'an Admin never sees Export');
    assert.equal(r.textOf('kyc-export-hq-only'), 'Only a Super Admin can export the audit record.');
    assert.equal(r.count('kyc-audit-row'), 2);
    assert.match(r.textOf('kyc-audit-chart-lead'), /Today so far: 2 looks and 1 decision\./);
    await r.change('kyc-audit-action', 'kyc_rejected_by_admin');
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/admin/audit?from=2026-09-22&to=2026-10-21&action=kyc_rejected_by_admin'));
    await r.click('kyc-audit-only-501');
    assert.ok(r.requests.some((q) => q.url.endsWith('&action=kyc_rejected_by_admin&case=7')));
    assert.match(r.textOf('kyc-audit-case-clear'), /Dev Testcase/);
    await r.click('kyc-audit-window-7');
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/admin/audit?from=2026-10-15&to=2026-10-21&action=kyc_rejected_by_admin&case=7'));
    assert.deepEqual(writes(r), []);
  } finally { await r.close(); }
});

test('mounted KYC17d as a Super Admin: Export asks for a reason, the export is recorded, and the file arrives in the page', async () => {
  const r = await mounted(h(KycAudit, { me: SUPER, nowMs: NOW }));
  try {
    assert.ok(!r.has('kyc-export-hq-only'));
    await r.click('kyc-export-open');
    assert.ok(r.has('kyc-export-dialog'));
    assert.equal(r.props('kyc-export-from').value, '2026-09-22');
    assert.equal(r.props('kyc-export-dialog-go').disabled, true, 'no reason yet');
    await r.change('kyc-export-reason', 'too short');
    assert.equal(r.props('kyc-export-dialog-go').disabled, true);
    await r.change('kyc-export-reason', 'Quarterly review for the compliance file.');
    assert.equal(r.props('kyc-export-dialog-go').disabled, false);
    await r.click('kyc-export-dialog-go');
    assert.deepEqual(writes(r).map((q) => [q.method, q.url, q.body]),
      [['POST', '/api/kyc/admin/audit/export', { from: '2026-09-22', to: '2026-10-21', reason: 'Quarterly review for the compliance file.' }]]);
    assert.equal(r.files.length, 1, 'the CSV is handed over as a blob');
    assert.deepEqual(r.clicks, ['kyc-audit_2026-09-22_2026-10-21.csv']);
    assert.equal(r.textOf('kyc-export-done'), 'Exported 2 rows. The export is recorded.');
    assert.deepEqual(r.popups, [], 'never a new tab or a browser pop-up');
  } finally { await r.close(); }
});

test('mounted: an export that could not be recorded is not made, and says so in the dialog', async () => {
  const r = await mounted(h(KycAudit, { me: SUPER, nowMs: NOW }), { handle: handler({
    '/api/kyc/admin/audit/export': { method: 'POST', answer: () => response({ state: 'unrecorded', detail: 'The export could not be recorded, so it was not made. Try again.' }, 503) },
  }) });
  try {
    await r.click('kyc-export-open');
    await r.change('kyc-export-reason', 'Quarterly review for the compliance file.');
    await r.click('kyc-export-dialog-go');
    assert.equal(r.textOf('kyc-export-dialog-refused'), 'The export could not be recorded, so it was not made. Try again.');
    assert.equal(r.files.length, 0);
    assert.ok(r.has('kyc-export-dialog'), 'the dialog stays open');
  } finally { await r.close(); }
});

test('mounted: a failed audit read is Unreadable with Try again, never an empty record', async () => {
  const r = await mounted(h(KycAudit, { me: ADMIN, nowMs: NOW }), { handle: handler({ '/api/kyc/admin/audit': { answer: () => response({ state: 'unreadable', detail: 'The audit record could not be read. Try again.' }, 503) } }) });
  try {
    assert.ok(r.has('kyc-audit-failed'));
    assert.ok(!r.has('kyc-audit-empty') && !r.has('kyc-audit-row'));
    assert.ok(r.has('kyc-export-hq-only'), 'the bar still says who may export');
  } finally { await r.close(); }
});

test('the wiring: the tabs draw the two pages, the waits are gone, HQ › Team names the page, and nothing pops up', () => {
  const tabs = read('frontend/src/pages/admin/kyc/KycTabs.jsx');
  assert.ok(tabs.includes("if (view.tab === 'renewals') return <KycRenewals />;"));
  assert.ok(tabs.includes("if (view.tab === 'audit') return <KycAudit />;"));
  const team = read('frontend/src/pages/hq/HqTeamActions.jsx');
  assert.ok(team.includes('KYC &amp; KYB &rarr;') && !team.includes('KYC queue'));
  for (const f of ['KycRenewals.jsx', 'KycAudit.jsx', 'KycParts.jsx', 'governanceModel.js']) {
    const src = read(`frontend/src/pages/admin/kyc/${f}`);
    assert.ok(!/window\.(open|alert|confirm)\(|\balert\(|\bconfirm\(/.test(src), `${f}: no browser pop-up`);
    assert.ok(!/target="_blank"/.test(src), `${f}: no new tab`);
  }
});
