/**
 * D4817 part 6 (#5311, canvas PF-06 A–E; addendum PFA01, PFA02, PFA09,
 * PFA16): one portfolio company's workspace at `/portfolio/companies/:uid` —
 * Overview, Financials, Reports, Support and Activity — in the shared
 * Portfolio frame. The real page is mounted against a stubbed `fetch` in its
 * populated, Not recorded and Unreadable states; Ask and Waive on Reports are
 * checked to behave exactly as before.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_company_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `identityOf` reading a failed positions read as "not held" → tests 3 and 5;
 *   - `companyDocTitle` naming the company before an authorised read named it
 *     (the uid in the title) → tests 2 and 3;
 *   - `keyFactsOf` reading an unmarked position's FMV as its cost → test 2;
 *   - `keyFactsOf` reading "no support row" as a measured 0 → test 2;
 *   - the Financials failure Retry reading the positions list as well as the
 *     detail read → test 3;
 *   - `returnOf` computing a per-company IRR from the multiple → tests 1 and 5;
 *   - `supportOf` keeping another company's ledger entries → test 1;
 *   - `holdingRouteOf` reading a failed reporting read as "Not recorded" → test 3;
 *   - the old `/terms` address drawing Overview instead of Financials'
 *     Ownership & rights → test 1;
 *   - the Activity filter leaving the other sources drawn → test 1;
 *   - the Ask dialog's confirm posting to `/waive` → test 4.
 * D6227 (#6227) moved Activity onto the Worker's joined read; test 6 checks
 * it, each mutation both ways:
 *   - `activityOf` dropping the failed sources → test 6;
 *   - `activityOf` reading an empty group beside a failed source as complete → test 6;
 *   - the older page read without its cursor → test 6;
 *   - the Activity switch ignoring its group → tests 1 and 6;
 *   - a measured $0 amount dropped from a row → test 6.
 * (Reverted, all six pass.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PortfolioCompanyPage from '../src/pages/investor/PortfolioCompanyPage.jsx';
import { activityOf, companyDocTitle, companyTabOfPath, identityOf, keyFactsOf, returnOf } from '../src/pages/portfolio/companyModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['x']) });

/* ------------------------------------------------------------------ fixtures */

const period = (uid, duty, label, due, state, extra = {}) => ({ uid, duty_uid: duty, label, start: null, end: null, due_on: due, expected_on: null, expected_note: null, waived_at: null, sent_at: null, days_late: null, days_left: null, asked: false, report_uid: null, state, ...extra });
const ACME = {
  uid: 'p-abc', name: 'Acme Robotics',
  duties: [
    { uid: 'd-kpi', kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: ['mrr'], source: { document: 'voting_rights', clause: '§1.1(b)', signed: true }, defaulted: [], holding: { route: 'direct' } },
    { uid: 'd-mon', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30, required_figures: [], source: { document: 'term_sheet', clause: '§2.2', signed: false }, defaulted: [], holding: { route: 'direct' } },
  ],
  periods: [
    period('pq2', 'd-kpi', '2026-Q2', '2026-08-14', 'sent', { sent_at: '2026-08-18 10:00:00', report_uid: 'r2' }),
    period('pm8', 'd-mon', '2026-08', '2026-09-30', 'waived', { waived_at: '2026-09-02 10:00:00' }),
    period('pm9', 'd-mon', '2026-09', '2026-10-30', 'late', { days_late: 6, expected_on: '2026-11-14', expected_note: 'Waiting on our accountant’s close' }),
    period('pq3', 'd-kpi', '2026-Q3', '2026-11-14', 'due', { days_left: 9 }),
  ],
};
const POSITION = { project_id: 4, project: { uid: 'p-abc', name: 'Acme Robotics', stage: 'Seed', sector: 'Robotics' }, total_invested: 250000, rounds: 2, latest_ownership_pct: 6.2, latest_round: 'Seed extension', first_date: '2025-06-15', fmv: 400000, multiple: 1.6, mark_as_of: '2026-03-31', mark_basis: 'priced_round', unmarked: false, mark_unavailable_reason: null };
const DETAIL = {
  project: { uid: 'p-abc', name: 'Acme Robotics' },
  rounds: [
    { uid: 'r-1', round_name: 'Seed', invested_amount: 150000, ownership_pct: 4.1, shares: 15000, price_per_share: 10, position_date: '2025-06-15' },
    { uid: 'r-2', round_name: 'Seed extension', invested_amount: 100000, ownership_pct: 6.2, shares: null, price_per_share: null, position_date: '2026-03-31' },
  ],
  cap_table_snapshot: [],
  marks: [
    { uid: 'm-0', as_of_date: '2025-06-15', fmv: 150000, post_money: 24200000, event: 'Investment', basis: 'cost', source: 'Closing docs' },
    { uid: 'm-1', as_of_date: '2026-03-31', fmv: 400000, post_money: 38700000, event: 'Priced round', basis: 'priced_round', source: 'Term sheet' },
  ],
  distributions: [{ uid: 'x-1', distribution_date: '2026-09-01', amount: 50000, kind: 'secondary', note: null }],
  rollup: { invested: 250000, fmv: 400000, multiple: 1.6, unmarked: false, distributed: 50000, latest_mark_as_of: '2026-03-31' },
};
const HEALTH = { latest: { badge: 'red', snapshot_date: '2026-11-06', stale: false, intervention: true }, history: [{ badge: 'red', snapshot_date: '2026-11-06' }] };
const SUPPORT = {
  entries: [
    { uid: 's-1', project_uid: 'p-abc', kind: 'introduction', state: 'promised', summary: 'Intro to two climate-fund partners', promised_at: '2026-10-14', hours: null },
    { uid: 's-2', project_uid: 'p-abc', kind: 'workshop', state: 'delivered', summary: 'Pricing workshop', promised_at: '2026-08-02', delivered_at: '2026-08-20', hours: 3 },
    { uid: 's-9', project_uid: 'p-other', kind: 'introduction', state: 'promised', summary: 'Another company’s intro', promised_at: '2026-10-01' },
  ],
  companies: [{ project_uid: 'p-abc', name: 'Acme Robotics', entries: 2, promised: 1, delivered: 1, withdrawn: 0, hours: 3, entries_without_hours: 1 }, { project_uid: 'p-other', name: 'Other', entries: 1, promised: 1, delivered: 0, withdrawn: 0, hours: 0, entries_without_hours: 1 }],
  page: { next_offset: null }, page_state: 'recorded', totals: { promised: 2, delivered: 1, withdrawn: 0 },
};
const HISTORY = { items: [
  { uid: 'e1', revision: 1, action: 'create', to_state: 'promised', actor: { name: 'M. Okafor' }, created_at: '2026-08-02T09:31:00Z' },
  { uid: 'e2', revision: 2, action: 'deliver', to_state: 'delivered', actor: { name: 'M. Okafor' }, created_at: '2026-08-20T16:10:00Z' },
] };
/** D6227: the joined read, newest first, one page with a cursor to an older one. */
const SRC_OK = ['investments', 'marks', 'distributions', 'reports', 'requests', 'support'].map((source) => ({ source, state: 'ok', count: 1 }));
const fin = (tab) => ({ tab, href: `/portfolio/companies/p-abc/${tab}` });
const ACTIVITY = {
  project: { uid: 'p-abc', name: 'Acme Robotics' },
  items: [
    { id: 'support_promised:s-1', kind: 'support_promised', at: '2026-10-14', date: '2026-10-14', source: 'support', label: 'Support promised: Intro to two climate-fund partners', link: fin('support') },
    { id: 'waived:7', kind: 'waived', at: '2026-09-02T10:00:00', date: '2026-09-02', source: 'requests', label: 'You waived the 2026-08 Monthly financial statements', link: fin('reports') },
    { id: 'distribution:x-1', kind: 'distribution', at: '2026-09-01', date: '2026-09-01', source: 'distributions', label: 'Distribution · secondary', amount: 50000, link: fin('financials') },
    { id: 'support_delivered:s-2', kind: 'support_delivered', at: '2026-08-20', date: '2026-08-20', source: 'support', label: 'Support delivered: Pricing workshop', link: fin('support') },
    { id: 'report_received:r2', kind: 'report_received', at: '2026-08-18T10:00:00', date: '2026-08-18', source: 'reports', label: '2026-Q2 report received', link: fin('reports') },
  ],
  sources: SRC_OK, partial: false, order: 'newest_first',
  page: { limit: 50, before: null, total: 7, next_cursor: 'Y3Vyc29y' },
};
const ACTIVITY_OLDER = {
  ...ACTIVITY,
  items: [
    { id: 'mark:m-1', kind: 'mark', at: '2026-03-31', date: '2026-03-31', source: 'marks', label: 'Valuation mark · round price · Priced round', amount: 400000, link: fin('financials') },
    { id: 'investment:r-1', kind: 'investment', at: '2025-06-15', date: '2025-06-15', source: 'investments', label: 'Investment · Seed', amount: 150000, link: fin('financials') },
  ],
  page: { limit: 50, before: 'Y3Vyc29y', total: 7, next_cursor: null },
};
const ROUTES = (over = {}) => ({
  '/positions': { items: [POSITION] },
  '/positions/p-abc': DETAIL,
  '/reporting/companies/p-abc': { ok: true, company: ACME },
  '/reporting/companies/p-abc/figures': { ok: true, reports: [] },
  '/portfolio/health/p-abc': HEALTH,
  '/portfolio-support': SUPPORT,
  '/portfolio-support/s-2/history': HISTORY,
  '/positions/p-abc/activity': ACTIVITY,
  '/portfolio-updates?project_id=4': { items: [{ uid: 'u9', project_id: 4, title: 'September note', submitted_at: '2026-10-02 10:00:00' }] },
  ...over,
});

/* ------------------------------------------------------------------ harness */

const PATHS = ['', '/reports', '/terms', '/financials', '/support', '/activity'];

async function at(url, routes) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch };
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method });
    const hit = routes[`${method} ${path}`] ?? routes[path];
    const out = typeof hit === 'function' ? await hit(path, opts) : hit;
    if (out && out.__status) return response({ detail: out.detail || 'refused', message: out.detail }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 16; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    ...PATHS.map((p) => h(Route, { key: p, path: `/portfolio/companies/:uid${p}`, element: h(PortfolioCompanyPage) }))))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    heading: () => txt(walk(document.body).find((n) => n.tagName === 'H1')).trim(),
    count: (path) => asked.filter((a) => a.path === path && a.method === 'GET').length,
    writes: () => asked.filter((a) => a.method !== 'GET'),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    /** Press the Retry inside a figure. */
    retryIn: async (id) => {
      const n = walk(by(id)).find((x) => x.tagName === 'BUTTON' && /Retry/.test(x.textContent || ''));
      assert.ok(n, `no Retry in ${id}`);
      await act(async () => { pr(n).onClick(); });
      await flush();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev.fetch; localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ tests */

test('1 · populated: each tab drawn from its own read, with the company named and every figure sourced', async () => {
  const v = await at('/portfolio/companies/p-abc', ROUTES());
  try {
    // The frame: the authorised name, the holding and its route, the health, the tabs.
    assert.equal(v.heading(), 'Acme Robotics');
    assert.equal(document.title, 'Acme Robotics · Portfolio · Axal VC');
    assert.match(v.text('company-holding'), /Seed · Your holding: Seed extension · \$250,000 invested · since 15 Jun 2025 · Direct/);
    assert.match(v.text('portfolio-context'), /Holding route: Direct · 6\.2% ownership as recorded/);
    assert.equal(v.props('company-tab-overview')['aria-current'], 'page');
    assert.equal(v.props('company-tab-financials').href, '/portfolio/companies/p-abc/financials');
    assert.match(v.props('company-tab-reports').className, /\bmin-h-11\b/);
    // Six key facts.
    assert.match(v.text('metric-invested'), /Invested \$250,000 2 rounds · gross/);
    assert.match(v.text('metric-ownership'), /6\.2% Recorded after Seed extension/);
    assert.match(v.text('metric-fmv'), /\$400,000 As of 31 Mar 2026 · Priced round/);
    assert.match(v.text('metric-multiple'), /1\.60×/);
    assert.match(v.text('metric-report'), /Q2 2026 Received 18 Aug 2026 · Sep 2026 · Late · 6 days/);
    assert.match(v.text('metric-support'), /Open support 1 Promised · 1 delivered/);
    // Overview: why, next actions, the reported figures.
    assert.match(v.text('company-why'), /Why Attention.*Attention in the snapshot of 6 Nov 2026 · flagged for intervention/);
    assert.match(v.text('company-evidence-mark'), /Latest mark · \$400,000 as of 31 Mar 2026 · Priced round/);
    assert.match(v.text('company-evidence-report'), /Monthly financial statements · Late · 6 days · expected 14 Nov 2026/);
    assert.match(v.text('company-next-ask-pm9'), /Sep 2026 report late · 6 days.*Open Reports/);
    assert.match(v.text('company-next-support-s-1'), /Intro to two climate-fund partners.*Promised 14 Oct 2026/);
    assert.ok(v.has('company-figures-none'), 'the reported figures keep their own read');
    assert.equal(v.count('/positions/p-abc'), 0, 'the Overview reads no round or mark history');
  } finally { await v.close(); }

  const f = await at('/portfolio/companies/p-abc/financials', ROUTES());
  try {
    assert.equal(document.title, 'Acme Robotics · Financials · Portfolio · Axal VC');
    assert.equal(f.props('company-tab-financials')['aria-current'], 'page');
    assert.match(f.text('company-round-r-1'), /15 Jun 2025 Seed \$150,000 4\.1% 15,000 \$10/);
    assert.match(f.text('company-round-r-2'), /31 Mar 2026 Seed extension \$100,000 6\.2% Not recorded Not recorded/);
    assert.match(f.text('company-rounds-total'), /Total 2 rounds \$250,000 6\.2%/);
    assert.match(f.text('metric-moic'), /1\.60×/);
    assert.match(f.text('metric-distributed'), /\$50,000 1 recorded/);
    assert.match(f.text('metric-irr'), /IRR Not recorded A per-company IRR is not computed by the platform/);
    assert.match(f.text('company-marks'), /31 Mar 2026 \$400,000 \$38,700,000 Priced round Priced round Term sheet.*15 Jun 2025 \$150,000 \$24,200,000 Investment Cost Closing docs/);
    assert.match(f.text('company-distribution-x-1'), /1 Sep 2026 \$50,000 secondary/);
    assert.match(f.text('company-financial-history'), /not recorded/);
    assert.match(f.text('company-ownership-rights'), /Ownership & rights.*Quarterly KPI report/);
    assert.ok(f.has('company-terms') && f.has('company-captable'));
  } finally { await f.close(); }

  // The old Terms address lands on Financials, at Ownership & rights.
  const t = await at('/portfolio/companies/p-abc/terms?from=reports', ROUTES());
  try {
    assert.equal(t.props('company-tab-financials')['aria-current'], 'page');
    assert.ok(t.has('company-ownership-rights') && t.has('company-terms'));
    assert.ok(!t.has('company-why'));
  } finally { await t.close(); }

  const s = await at('/portfolio/companies/p-abc/support', ROUTES());
  try {
    assert.match(s.text('company-support-totals'), /1 promised · 1 delivered · 0 withdrawn · 3 h recorded · 1 with no hours recorded/);
    assert.match(s.text('company-support-s-1'), /Intro to two climate-fund partners.*Promised.*14 Oct 2026.*Not recorded/);
    assert.match(s.text('company-support-s-2'), /Pricing workshop.*Delivered.*2 Aug 2026.*20 Aug 2026.*3 h/);
    assert.ok(!s.has('company-support-s-9') && !/Another company/.test(s.text()), 'never another company’s entry');
    assert.equal(s.count('/portfolio-support/s-2/history'), 0, 'history is read on request');
    await s.click('button-company-support-history-s-2');
    assert.match(s.text('company-support-history-s-2'), /2 Aug 2026 Promised · by M\. Okafor 20 Aug 2026 Delivered · by M\. Okafor/);
    assert.match(s.text('company-support-scope'), /Owners, due dates, In progress, Cancelled and the meetings that came of it are not recorded/);
    assert.deepEqual(s.writes(), []);
  } finally { await s.close(); }

  // Activity (D6227): the Worker's joined timeline; the switch narrows it to one group.
  const a = await at('/portfolio/companies/p-abc/activity', ROUTES());
  try {
    assert.equal(a.text('company-activity-rows'), '14 Oct 2026 Support promised: Intro to two climate-fund partners 2 Sep 2026 You waived the 2026-08 Monthly financial statements 1 Sep 2026 Distribution · secondary · $50,000 20 Aug 2026 Support delivered: Pricing workshop 18 Aug 2026 2026-Q2 report received');
    await a.click('button-company-activity-support');
    assert.ok(!a.has('company-activity-row-distribution:x-1') && a.has('company-activity-row-support_delivered:s-2'));
    assert.equal(a.props('button-company-activity-support')['aria-pressed'], true);
  } finally { await a.close(); }
});

test('2 · Not recorded: no mark, no ownership, no rounds, nothing owed, no snapshot, not in the ledger — each says so, none is a zero', async () => {
  const bare = { ...POSITION, latest_ownership_pct: null, fmv: 250000, multiple: 1, unmarked: true, mark_as_of: null, mark_basis: null, mark_unavailable_reason: 'no_mark', rounds: 1 };
  const routes = ROUTES({
    '/positions': { items: [bare] },
    '/positions/p-abc': { rounds: [], marks: [], distributions: [], rollup: { multiple: 1, unmarked: true, distributed: 0 } },
    '/reporting/companies/p-abc': { __status: 404 },
    '/portfolio/health/p-abc': { latest: null, history: [] },
    '/portfolio-support': { ...SUPPORT, entries: [], companies: [] },
  });
  const v = await at('/portfolio/companies/p-abc', routes);
  try {
    assert.equal(v.heading(), 'Acme Robotics', 'a position alone names it');
    assert.match(v.text('metric-ownership'), /Not recorded No ownership is recorded on your latest round/);
    assert.match(v.text('metric-fmv'), /Not recorded No mark is recorded\. Carried at cost for NAV/);
    assert.doesNotMatch(v.text('metric-fmv'), /\$250,000/, 'an unmarked position’s FMV is not its cost');
    assert.match(v.text('metric-multiple'), /1\.00× At cost: no usable mark/);
    assert.match(v.text('metric-report'), /Not recorded This company owes you no report under a document you signed/);
    assert.match(v.text('metric-support'), /Not recorded This company is not in your support ledger/);
    assert.doesNotMatch(v.text('metric-support'), /\b0\b/);
    assert.match(v.text('portfolio-context'), /Holding route: Not recorded/);
    assert.match(v.text('company-why'), /Health and evidence.*No health snapshot is recorded for this company.*No mark recorded · carried at cost/);
    assert.match(v.text('company-next-none'), /No report is late or missing/);
  } finally { await v.close(); }
  const f = await at('/portfolio/companies/p-abc/financials', routes);
  try {
    assert.match(f.text('company-rounds-none'), /No round is recorded/);
    assert.match(f.text('company-marks-none'), /No mark is recorded for this company/);
    assert.match(f.text('company-distributions-none'), /\$0 has come back/);
    assert.match(f.text('metric-distributed'), /\$0 None recorded/, 'a read that holds no distribution is a measured $0');
    assert.match(f.text('metric-coverage'), /Not recorded No mark is recorded/);
    assert.match(f.text('company-terms-none'), /owes you no report under a document you signed/);
  } finally { await f.close(); }
  const s = await at('/portfolio/companies/p-abc/support', routes);
  try { assert.match(s.text('company-support-none'), /Acme Robotics is not in your support ledger/); } finally { await s.close(); }
  // A company you neither hold nor are owed by: nothing of it, and no name in the title.
  const x = await at('/portfolio/companies/p-zzz', ROUTES({ '/reporting/companies/p-zzz': { __status: 404 } }));
  try {
    assert.ok(x.has('company-not-held'));
    assert.equal(x.heading(), 'Company');
    assert.equal(document.title, 'Company · Portfolio · Axal VC');
    assert.ok(!x.has('company-tabs') && !x.has('company-facts'));
  } finally { await x.close(); }
});

test('3 · Unreadable: each failed source says so with its own Retry; its neighbours stand', async () => {
  // Positions fail; the reporting read still names the company.
  let positionsUp = false;
  const routes = ROUTES({ '/positions': () => (positionsUp ? { items: [POSITION] } : { __status: 503 }) });
  const v = await at('/portfolio/companies/p-abc', routes);
  try {
    assert.equal(v.heading(), 'Acme Robotics', 'named by the reporting read');
    for (const k of ['invested', 'ownership', 'fmv', 'multiple']) assert.match(v.text(`metric-${k}`), /Unreadable · Retry/, k);
    assert.match(v.text('metric-report'), /Q2 2026/, 'the reporting fact stands');
    assert.match(v.text('status-company-partial'), /Your positions could not be read/);
    const before = { pos: v.count('/positions'), owed: v.count('/reporting/companies/p-abc') };
    positionsUp = true;
    await v.retryIn('metric-invested');
    assert.equal(v.count('/positions'), before.pos + 1, 'Retry reads positions again');
    assert.equal(v.count('/reporting/companies/p-abc'), before.owed, 'and nothing else');
    assert.match(v.text('metric-invested'), /\$250,000/);
  } finally { await v.close(); }

  // Positions fail and nothing is owed: Unreadable, never "not held", and no name.
  const u = await at('/portfolio/companies/p-abc', ROUTES({ '/positions': { __status: 503 }, '/reporting/companies/p-abc': { __status: 404 } }));
  try {
    assert.match(u.text('company-positions-unreadable'), /Your positions could not be read\. This is not a claim that you hold nothing here/);
    assert.ok(!u.has('company-not-held'));
    assert.equal(document.title, 'Company · Portfolio · Axal VC');
  } finally { await u.close(); }

  // The reporting read fails: the route says Unreadable, Reports offers its own Retry, the updates still draw.
  const r = await at('/portfolio/companies/p-abc/reports', ROUTES({ '/reporting/companies/p-abc': { __status: 503 } }));
  try {
    assert.match(r.text('portfolio-context'), /Holding route: Unreadable/);
    assert.match(r.text('company-owed-unreadable'), /The reports owed to you could not be read\. This is not a claim that nothing is owed to you/);
    assert.ok(r.has('button-retry-company-owed') && r.has('company-reports'));
  } finally { await r.close(); }

  // The detail read fails on Financials: its own Retry; Ownership & rights stands.
  const f = await at('/portfolio/companies/p-abc/financials', ROUTES({ '/positions/p-abc': { __status: 503 } }));
  try {
    assert.match(f.text('company-financials-unreadable'), /rounds, marks and distributions could not be read/);
    assert.ok(f.has('company-ownership-rights') && f.has('company-terms'));
    const counts = { detail: f.count('/positions/p-abc'), pos: f.count('/positions'), health: f.count('/portfolio/health/p-abc') };
    await f.click('button-retry-company-financials');
    assert.equal(f.count('/positions/p-abc'), counts.detail + 1);
    assert.equal(f.count('/positions'), counts.pos, 'Retry reads that source alone');
    assert.equal(f.count('/portfolio/health/p-abc'), counts.health);
  } finally { await f.close(); }

  // Health and the ledger fail: the header says Unreadable, Overview and Support each offer a Retry.
  const hs = ROUTES({ '/portfolio/health/p-abc': { __status: 503 }, '/portfolio-support': { __status: 503 } });
  const o = await at('/portfolio/companies/p-abc', hs);
  try {
    assert.match(o.text('company-health-unreadable'), /Health could not be read/);
    assert.match(o.text('metric-support'), /Unreadable · Retry/);
    assert.match(o.text('status-company-partial'), /Health, The support ledger could not be read/);
    const n = o.count('/portfolio/health/p-abc');
    await o.click('button-retry-company-health');
    assert.equal(o.count('/portfolio/health/p-abc'), n + 1);
  } finally { await o.close(); }
  const s = await at('/portfolio/companies/p-abc/support', hs);
  try {
    assert.match(s.text('company-support-unreadable'), /The support ledger could not be read\. It is not a claim that no support was given/);
    const n = s.count('/portfolio-support');
    await s.click('button-retry-company-support');
    assert.equal(s.count('/portfolio-support'), n + 1);
  } finally { await s.close(); }
  const a = await at('/portfolio/companies/p-abc/activity', ROUTES({ '/positions/p-abc/activity': { __status: 503 } }));
  try {
    assert.match(a.text('company-activity-unreadable'), /This company’s activity could not be read\. It is not a claim that nothing happened/);
    assert.ok(!a.has('company-activity-none'), 'a failed read is not an empty timeline');
    const n = a.count('/positions/p-abc/activity');
    await a.click('button-retry-company-activity');
    assert.equal(a.count('/positions/p-abc/activity'), n + 1);
  } finally { await a.close(); }
});

test('4 · Reports: the timeline’s Ask and Waive are unchanged — an in-page dialog each, nothing posted before the press', async () => {
  const posted = [];
  const routes = ROUTES({
    'POST /reporting/periods/pm9/ask': (p) => { posted.push(p); return { ok: true, asked: true }; },
    'POST /reporting/periods/pm9/waive': (p) => { posted.push(p); return { ok: true, waived: true }; },
  });
  const v = await at('/portfolio/companies/p-abc/reports', routes);
  try {
    assert.equal(document.title, 'Acme Robotics · Reports · Portfolio · Axal VC');
    assert.match(v.text('company-reports-route'), /Holding route: Direct · 6\.2% ownership as recorded/);
    assert.ok(v.has('company-period-ask-pm9') && v.has('company-period-waive-pm9') && !v.has('company-period-ask-pq3'));
    assert.match(v.text('company-reports'), /Updates you received.*September note/);
    await v.click('company-period-ask-pm9');
    assert.match(v.text('company-ask-dialog'), /Ask Acme Robotics for the Sep 2026 · Monthly financial statements\?.*The company is told.*Nobody else sees your request.*once per period/);
    assert.deepEqual(v.writes(), []);
    await v.click('company-ask-confirm');
    assert.deepEqual(posted, ['/reporting/periods/pm9/ask']);
    await v.click('company-period-waive-pm9');
    assert.match(v.text('company-waive-dialog'), /Waive Sep 2026 for Acme Robotics\?.*waived by you.*cannot be undone here/);
    await v.click('company-waive-confirm');
    assert.deepEqual(posted, ['/reporting/periods/pm9/ask', '/reporting/periods/pm9/waive']);
  } finally { await v.close(); }
});

test('5 · the model: tabs and titles, identity, facts and return', () => {
  assert.deepEqual(['/portfolio/companies/p', '/portfolio/companies/p/financials', '/portfolio/companies/p/terms', '/portfolio/companies/p/activity/', '/portfolio/companies/p/nope'].map(companyTabOfPath),
    ['overview', 'financials', 'terms', 'activity', 'overview']);
  assert.equal(companyDocTitle(null, 'support'), 'Company · Portfolio · Axal VC');
  assert.equal(companyDocTitle('Acme', 'support'), 'Acme · Support · Portfolio · Axal VC');
  const ok = (value) => ({ state: 'ok', value });
  assert.equal(identityOf('p-abc', { state: 'unreadable' }, ok({ company: null })).state, 'unreadable');
  assert.equal(identityOf('p-abc', ok({ items: [] }), { state: 'unreadable' }).state, 'unreadable');
  assert.equal(identityOf('p-abc', ok({ items: [] }), ok({ company: null })).state, 'not_held');
  assert.equal(identityOf('../x', ok({ items: [POSITION] }), ok({ company: null })).state, 'not_held');
  assert.equal(identityOf('p-abc', ok({ items: [POSITION] }), { state: 'loading' }).name, 'Acme Robotics');
  const facts = keyFactsOf({ positions: ok({ items: [POSITION] }), owed: { state: 'loading' }, support: { state: 'unreadable' } }, 'p-abc');
  assert.deepEqual(facts.map((x) => x.state), ['ok', 'ok', 'ok', 'ok', 'loading', 'unreadable']);
  const ret = returnOf(DETAIL);
  assert.deepEqual(ret.map((m) => [m.key, m.value]), [['moic', '1.60×'], ['distributed', '$50,000'], ['irr', 'Not recorded'], ['coverage', '2']]);
});

test('6 · Activity (D6227): one joined timeline — populated with an older page, empty, and one source failed with its own Retry', async () => {
  // Populated: the first page, then the older one from its cursor; each row links to the tab that holds it.
  const v = await at('/portfolio/companies/p-abc/activity', ROUTES({ '/positions/p-abc/activity?before=Y3Vyc29y': ACTIVITY_OLDER }));
  try {
    assert.equal(v.count('/positions/p-abc'), 0, 'Activity reads the joined feed, not the detail read');
    assert.equal(v.count('/reporting/companies/p-abc/figures'), 0);
    assert.equal(v.props('company-activity-row-distribution:x-1').children[1].props.children.props.to, '/portfolio/companies/p-abc/financials');
    assert.ok(!v.has('company-activity-none') && !v.has('company-activity-marks-unreadable'));
    assert.match(v.text('company-activity-joined'), /One timeline, newest first.*Another investor’s asks, waivers and names are never in it/);
    // mutation: reading the older page without `before` (the first page again) fails the next line.
    await v.click('button-company-activity-older');
    assert.match(v.text('company-activity-rows'), /18 Aug 2026 2026-Q2 report received 31 Mar 2026 Valuation mark · round price · Priced round · \$400,000 15 Jun 2025 Investment · Seed · \$150,000$/);
    assert.ok(!v.has('button-company-activity-older'), 'the last page offers no older one');
    await v.click('button-company-activity-financial');
    assert.equal(v.text('company-activity-rows'), '1 Sep 2026 Distribution · secondary · $50,000 31 Mar 2026 Valuation mark · round price · Priced round · $400,000 15 Jun 2025 Investment · Seed · $150,000');
  } finally { await v.close(); }

  // Empty: every source answered with nothing.
  const e = await at('/portfolio/companies/p-abc/activity', ROUTES({ '/positions/p-abc/activity': { ...ACTIVITY, items: [], sources: SRC_OK.map((x) => ({ ...x, count: 0 })), page: { limit: 50, total: 0, next_cursor: null } } }));
  try {
    assert.equal(e.text('company-activity-none'), 'No activity is recorded for this company.');
    assert.ok(!e.has('button-company-activity-older'));
  } finally { await e.close(); }

  // One source failed: named with its own Retry; the rows of the others stand; never "no activity".
  const failed = { ...ACTIVITY, items: ACTIVITY.items.filter((x) => x.source !== 'support'), sources: SRC_OK.map((x) => (x.source === 'support' ? { source: 'support', state: 'failed', reason: 'Unreadable: support could not be read. Try again.' } : x)), partial: true, page: { limit: 50, total: 3, next_cursor: null } };
  const f = await at('/portfolio/companies/p-abc/activity', ROUTES({ '/positions/p-abc/activity': failed }));
  try {
    // mutation: `activityOf` dropping failed sources (no `failed` list) fails this line.
    assert.match(f.text('company-activity-support-unreadable'), /Support could not be read\. Its events are missing from this timeline; it is not a claim that none happened/);
    assert.match(f.text('company-activity-rows'), /You waived the 2026-08 Monthly financial statements/);
    await f.click('button-company-activity-support');
    assert.ok(f.has('company-activity-support-unreadable'));
    // mutation: reading an empty group with a failed source as complete says "No support activity is recorded".
    assert.equal(f.text('company-activity-none'), 'Nothing is recorded in the sources that answered.');
    await f.click('button-company-activity-financial');
    assert.ok(!f.has('company-activity-support-unreadable'), 'a failure is shown with its own group');
    await f.click('button-company-activity-all');
    const n = f.count('/positions/p-abc/activity');
    await f.click('button-retry-company-activity-support');
    assert.equal(f.count('/positions/p-abc/activity'), n + 1, 'Retry reads again');
  } finally { await f.close(); }

  // The model, alone.
  assert.deepEqual(activityOf({ state: 'unreadable' }), { state: 'unreadable' });
  const m = activityOf({ state: 'ok', value: { items: [{ id: 'x:1', at: '2026-01-02', source: 'marks', label: 'Valuation mark', amount: 0 }], sources: [{ source: 'marks', state: 'ok' }, { source: 'support', state: 'not_in_scope', reason: 'Support is read for companies in your investor book.' }] } });
  assert.deepEqual(m.rows, [{ key: 'x:1', date: '2 Jan 2026', source: 'marks', text: 'Valuation mark · $0', href: null }], 'a measured zero stays $0');
  assert.deepEqual(m.outOfScope.map((x) => x.source), ['support']);
  assert.equal(m.complete, true);
});
