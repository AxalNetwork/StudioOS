/**
 * D4817 part 10 (#5311): the Admin Investor preview of the company workspace
 * (`/portfolio/companies/:uid` and its tabs), held to PF-08's rule.
 *
 * Mounts the WHOLE App (`_appDom.mjs`, as the PF-08 test does) against a
 * stubbed `fetch` that would answer every company read with a held company,
 * as an administrator who picked Investor in Preview shell, on each tab:
 *   - exactly one preview banner and no shell strip;
 *   - the company is withheld ("Company withheld in preview"), every key fact
 *     and section carries "Private in preview", never a 0 or an empty list,
 *     and no private record is read (no positions, reporting, health, support,
 *     updates, cap table or activity read, and no request naming the company);
 *   - every write is disabled, `aria-describedby` the reason beside it;
 *   - the way back works;
 *   - a real investor, and an administrator in a support session (View As),
 *     get the company workspace with its data and its live writes, no banner.
 * Plus the model (`previewCompanyTabOf`, `pageOwnsPreviewBanner`) and App.jsx's
 * copy of the company addresses, held to the same answers.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_company_preview_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `PortfolioCompanyPage` dropping the preview branch (the real workspace
 *     draws and reads) → tests 1, 2, 3 and 4;
 *   - `CompanyPreview` passing no `banner` (no banner, no way back) → tests 1, 3 and 4;
 *   - App.jsx's `pageOwnsPreviewBanner` ignoring `PREVIEW_BANNER_COMPANY`
 *     (strip and banner both drawn) → tests 1 and 6;
 *   - `WithheldSection` dropping its chip → test 2;
 *   - a key fact drawn as "$0" in place of its chip → test 2;
 *   - `CompanyPreview` reading `/api/positions` in an effect → test 2;
 *   - an off write drawn without `disabled` → test 3;
 *   - `OffWrites` dropping `aria-describedby` → test 3;
 *   - `isInvestorPreview` ignoring `isImpersonating` → test 5;
 *   - `previewCompanyTabOf` answering for `/portfolio/companies` (no uid) → test 6.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  COMPANY_WITHHELD, PREVIEW_BANNER, PREVIEW_COMPANY_FACTS, PREVIEW_COMPANY_TABS, PRIVATE_IN_PREVIEW, pageOwnsPreviewBanner, previewCompanyTabOf,
} from '../src/pages/portfolio/previewModel.js';
import { COMPANY_TABS } from '../src/pages/portfolio/companyModel.js';
// #4574 H4 moved these shared modules out of the shell. Preload them as a browser would after their chunks arrive.
await import('../src/ui/index.js');
await import('../src/pages/founder/RecordingView.jsx');

const h = React.createElement;
const settled = { kyc_status: 'approved', access_level: 'full', onboarding_complete: 1, terms_acceptance_pending: false };
const SUPER = { id: 9701, role: 'admin', is_super_admin: 1, email: 'super@pf10.test', name: 'Super PF10', ...settled };
const PLAIN = { id: 9702, role: 'admin', is_super_admin: 0, email: 'admin@pf10.test', name: 'Admin PF10', ...settled };
const INVESTOR = { id: 9703, role: 'investor', email: 'investor@pf10.test', name: 'Investor PF10', ...settled };

const UID = 'pf10-acme';
const NAME = 'Acme Preview Robotics';
const BASE = `/portfolio/companies/${UID}`;
const TABS = COMPANY_TABS.map((t) => ({ id: t.id, route: `${BASE}${t.path}` }));

/* What the Worker would answer for this company. The preview must read none of it. */
const period = (uid, label, due, state, extra = {}) => ({ uid, duty_uid: 'd-kpi', label, start: null, end: null, due_on: due, expected_on: null, expected_note: null, waived_at: null, sent_at: null, days_late: null, days_left: null, asked: false, report_uid: null, state, ...extra });
const COMPANY = {
  uid: UID, name: NAME,
  duties: [{ uid: 'd-kpi', kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: [], source: { document: 'voting_rights', clause: '§1.1(b)', signed: true }, defaulted: [], holding: { route: 'direct' } }],
  periods: [period('pq3', '2026-Q3', '2026-10-14', 'late', { days_late: 6 })],
};
const POSITION = { project_id: 4, project: { uid: UID, name: NAME, stage: 'Seed' }, total_invested: 250000, rounds: 1, latest_ownership_pct: 6.2, latest_round: 'Seed', fmv: 400000, multiple: 1.6, mark_as_of: '2026-03-31', mark_basis: 'priced_round', unmarked: false };
const SUPPORT = {
  entries: [{ uid: 's-1', project_uid: UID, kind: 'introduction', state: 'promised', summary: 'Intro to a partner', promised_at: '2026-10-14', hours: null }],
  companies: [{ project_uid: UID, name: NAME, entries: 1, promised: 1, delivered: 0, withdrawn: 0, hours: 0, entries_without_hours: 1 }],
  page: { next_offset: null }, page_state: 'recorded', totals: { promised: 1, delivered: 0, withdrawn: 0 },
};

/** A read of an investor's own record: positions, reporting, health, support, updates, a cap table, or anything naming the company. */
const PRIVATE_READ = /\/api\/(positions|portfolio|portfolio-updates|portfolio-support|reporting|projects\/4\/)(\/|\?|$)/;
const isPrivate = (url) => {
  const u = new URL(url, 'http://localhost');
  return PRIVATE_READ.test(`${u.pathname}?`) || url.includes(UID);
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function app(member, { viewMode = null, hq = '1', impersonating = false } = {}, run) {
  register(new URL('./_airailRender-hook.mjs', import.meta.url));
  const { installAppDom, select } = await import('./_appDom.mjs');
  const App = (await import('../src/App.jsx')).default;
  const calls = [];
  const fetch = async (input) => {
    const url = String(input?.url || input);
    calls.push(url);
    const path = new URL(url, 'http://localhost').pathname;
    if (/\/api\/auth\/me$/.test(path)) return json(member);
    if (/\/api\/onboarding\/progress/.test(path)) return json({ flow: null, completed_at: '2026-01-01T00:00:00Z' });
    if (/\/api\/dashboard/.test(path)) return json({ user: member, role_view: viewMode || member.role });
    if (path === '/api/positions') return json({ items: [POSITION] });
    if (path === `/api/reporting/companies/${UID}`) return json({ ok: true, company: COMPANY });
    if (path === `/api/portfolio/health/${UID}`) return json({ latest: { badge: 'red', snapshot_date: '2026-11-06' }, history: [{ badge: 'red', snapshot_date: '2026-11-06' }] });
    if (path === '/api/portfolio-support') return json(SUPPORT);
    if (/\/api\/(positions|portfolio|introductions)/.test(path)) return json({ items: [] });
    return json({});
  };
  const dom = installAppDom({ fetch });
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('user', JSON.stringify(member));
  if (impersonating) {
    localStorage.setItem('realUser', JSON.stringify(SUPER));
    localStorage.setItem('realToken', 'real');
  }
  if (viewMode) localStorage.setItem('viewMode', viewMode);
  localStorage.setItem('hqView', hq);
  let at = null;
  let mounts = 0;
  function Landed() { at = useLocation(); return null; }
  const host = dom.document.createElement('div'); dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console; console.error = () => {}; console.warn = () => {};
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' '));
  const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
  const all = (sel) => select(dom.document, sel);
  const walk = (n) => (n.childNodes || []).filter((c) => c.nodeType === 1).flatMap((c) => [c, ...walk(c)]);
  const prefixed = (prefix, root = dom.document) => walk(root).filter((n) => String(n.getAttribute('data-testid') || '').startsWith(prefix));
  const wait = async (ready) => {
    // Bounded by turns of the event loop, not by the clock: each turn lets a lazy chunk or a stubbed read land.
    for (let i = 0; i < 20000 && !ready(); i += 1) {
      await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    }
  };
  const read = () => {
    const page = all('[data-testid="portfolio-company-preview"]')[0] || null;
    const real = all('[data-testid="portfolio-company-page"]')[0] || null;
    const buttons = page ? select(page, 'button') : [];
    const ids = new Set(walk(dom.document).map((n) => n.getAttribute('id')).filter(Boolean));
    return {
      path: at?.pathname,
      hash: at?.hash,
      banners: all('[data-testid="portfolio-preview-banner"]').length,
      banner: squash(all('[data-testid="portfolio-preview-banner"]').map(textOf).join(' | ')),
      strip: all('[data-testid="preview-shell-strip"]').length,
      preview: Boolean(page),
      real: Boolean(real),
      realText: real ? squash(textOf(real)) : '',
      heading: squash(all('h1').map(textOf).join(' | ')),
      tabs: prefixed('company-tab-').map((n) => ({ id: n.getAttribute('data-testid'), current: props(n)['aria-current'] === 'page' })),
      chips: all('[data-testid="chip-private-in-preview"]').map((n) => squash(textOf(n))),
      text: page ? squash(textOf(page)) : '',
      facts: prefixed('preview-fact-').map((n) => ({
        id: n.getAttribute('data-testid'),
        chip: select(n, '[data-testid="chip-private-in-preview"]').length,
        value: squash(textOf(select(n, 'b')[0] || n)),
      })),
      sections: prefixed('preview-section-').map((n) => ({
        id: n.getAttribute('data-testid'),
        heading: squash(textOf(select(n, 'h2')[0] || n)),
        chip: select(n, '[data-testid="chip-private-in-preview"]').length,
      })),
      enabled: buttons.filter((n) => !props(n).disabled).map((n) => props(n)['data-testid'] || squash(textOf(n))),
      writes: prefixed('button-preview-write-').map((n) => ({ label: squash(textOf(n)), disabled: props(n).disabled === true, why: props(n)['aria-describedby'] })),
      why: squash(walk(dom.document).filter((n) => n.getAttribute('id') === 'pf-preview-writes-why').map(textOf).join(' ')),
      hasWhy: ids.has('pf-preview-writes-why'),
      liveAsk: all('button').filter((n) => /Ask for this report/.test(textOf(n)) && !props(n).disabled).length,
      title: dom.document.title,
      privateReads: calls.filter(isPrivate),
    };
  };
  try {
    return await run({
      async load(route, ready, landed = route) {
        calls.length = 0;
        await act(async () => { root.render(h(MemoryRouter, { initialEntries: [route], key: `${route}:${(mounts += 1)}` }, h(App), h(Landed))); });
        await wait(() => at?.pathname === landed && (ready ? ready(read()) : all('h1').length > 0));
        // Let every effect the page starts settle, so a read it makes is counted.
        for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
        return read();
      },
      async exit() {
        const button = all('[data-testid="button-portfolio-preview-exit"]')[0];
        if (!button) throw new Error('no exit');
        await act(async () => { props(button).onClick({ preventDefault() {}, stopPropagation() {} }); });
        await wait(() => !String(at?.pathname || '').startsWith('/portfolio/companies'));
        for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
        return { ...read(), viewMode: localStorage.getItem('viewMode') };
      },
      read,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove(); dom.timers.clear(); dom.restore?.();
    console.error = error; console.warn = warn;
  }
}

const previewReady = (r) => r.preview || r.real;

test('1. every company tab in Investor preview draws exactly one banner and no shell strip; the frame and the five tabs stay', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    for (const { id, route } of TABS) {
      const r = await a.load(route, previewReady);
      assert.equal(r.preview, true, `${route}: the preview draws`);
      assert.equal(r.real, false, `${route}: the real workspace does not`);
      assert.equal(r.banners, 1, `${route}: exactly one preview banner, got ${r.banners}`);
      assert.equal(r.strip, 0, `${route}: the shell strip does not draw a second banner`);
      assert.ok(r.banner.includes(PREVIEW_BANNER), `${route}: names the Investor preview and what is withheld`);
      assert.match(r.banner, /Read-only/, `${route}: says it is read-only`);
      assert.match(r.banner, /Back to HQ/, `${route}: offers the way back`);
      assert.deepEqual(r.tabs.map((t) => t.id), COMPANY_TABS.map((t) => `company-tab-${t.id}`), `${route}: the five tabs are drawn`);
      assert.deepEqual(r.tabs.filter((t) => t.current).map((t) => t.id), [`company-tab-${id}`], `${route}: its own tab is current`);
      assert.match(r.title, / · Portfolio · Investor preview · Axal VC$/, `${route}: the title says Investor preview, got ${r.title}`);
    }
    // The old Terms address still lands on Financials' Ownership & rights, with the banner.
    const terms = await a.load(`${BASE}/terms`, previewReady, `${BASE}/financials`);
    assert.equal(terms.path, `${BASE}/financials`);
    assert.equal(terms.hash, '#ownership-rights');
    assert.equal(terms.banners, 1);
    assert.equal(terms.strip, 0);
  });
});

test('2. the company and every record are withheld: chips, never a 0 or an empty list, and nothing private is read', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    for (const { id, route } of TABS) {
      const r = await a.load(route, previewReady);
      assert.match(r.heading, new RegExp(COMPANY_WITHHELD), `${route}: the heading says the company is withheld, got ${r.heading}`);
      assert.ok(!r.text.includes(NAME) && !r.heading.includes(NAME) && !r.title.includes(NAME), `${route}: the company's name is never drawn`);
      assert.deepEqual(r.facts.map((f) => f.id), PREVIEW_COMPANY_FACTS.map((f) => `preview-fact-${f.key}`), `${route}: the six key facts`);
      for (const f of r.facts) assert.equal(f.value, PRIVATE_IN_PREVIEW, `${route}: ${f.id} reads only the chip, got ${f.value}`);
      assert.deepEqual(r.sections.map((s) => s.heading), PREVIEW_COMPANY_TABS[id].sections.map((s) => s.title), `${route}: the tab's sections, headed`);
      assert.ok(r.sections.length > 0, `${route}: draws its sections`);
      for (const s of r.sections) assert.equal(s.chip, 1, `${route}: ${s.id} carries the chip`);
      assert.ok(r.chips.length >= r.sections.length + r.facts.length, `${route}: chips on every withheld record`);
      assert.ok(r.chips.every((c) => c === PRIVATE_IN_PREVIEW));
      assert.doesNotMatch(r.text, /\$0|\b0\.00×|No support is recorded|No round is recorded|No mark is recorded|No activity is recorded|owes you no report|sent you no update|Not recorded|Unreadable/, `${route}: no zero, empty list or absence for a withheld record`);
      assert.deepEqual(r.privateReads, [], `${route}: no investor record is read`);
    }
  });
});

test('3. every write on the company tabs is disabled, with the reason beside it', async () => {
  await app(PLAIN, { viewMode: 'investor' }, async (a) => {
    const seen = {};
    for (const { id, route } of TABS) {
      const r = await a.load(route, previewReady);
      assert.deepEqual(r.enabled, ['button-portfolio-preview-exit'], `${route}: the only live button is the way back, got ${JSON.stringify(r.enabled)}`);
      assert.equal(r.liveAsk, 0, `${route}: no live Ask for this report anywhere`);
      assert.match(r.banner, /Back to HQ’s own accounts/, `${route}: a plain administrator goes back to their own shell`);
      seen[id] = r.writes;
      for (const w of r.writes) {
        assert.equal(w.disabled, true, `${route}: ${w.label} is off`);
        assert.equal(w.why, 'pf-preview-writes-why', `${route}: ${w.label} names its reason`);
        assert.equal(r.hasWhy, true, `${route}: the reason is on the page`);
        assert.match(r.why, /Writes are disabled in preview/, `${route}: the reason says why`);
      }
    }
    assert.deepEqual(seen.reports.map((w) => w.label), ['Ask for this report', 'Waive this period']);
    assert.deepEqual(seen.support.map((w) => w.label), ['Record support…']);
    assert.deepEqual(seen.financials.map((w) => w.label), ['Ask for access']);
    assert.deepEqual(seen.overview, []);
    assert.deepEqual(seen.activity, []);
  });
});

test('4. the way back works from a company tab: the shell returns to the administrator\'s own and the banner goes', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    const before = await a.load(`${BASE}/reports`, previewReady);
    assert.equal(before.banners, 1);
    const after = await a.exit();
    assert.equal(after.viewMode, 'admin', 'the preview ends');
    assert.equal(after.path, '/hq', 'the holder lands on HQ');
    assert.equal(after.banners, 0, 'the banner goes');
    assert.equal(after.preview, false, 'the company preview goes');
  });
});

test('5. a real investor, and an administrator in a support session, get the company workspace with its data and live writes, no banner', async () => {
  const realReady = (r) => r.real && r.heading.includes(NAME) && (r.path !== `${BASE}/reports` || r.liveAsk > 0);
  await app(INVESTOR, {}, async (a) => {
    for (const route of [BASE, `${BASE}/reports`]) {
      const r = await a.load(route, realReady);
      assert.equal(r.banners, 0, `${route}: an investor gets no preview banner`);
      assert.equal(r.preview, false, `${route}: an investor gets the real workspace`);
      assert.match(r.heading, new RegExp(NAME), `${route}: named from the investor's own read`);
      assert.ok(r.privateReads.length > 0, `${route}: the investor's records are read`);
    }
    const reports = await a.load(`${BASE}/reports`, realReady);
    assert.ok(reports.liveAsk > 0, 'the investor can ask for a late report');
  });
  await app(INVESTOR, { viewMode: 'investor', impersonating: true }, async (a) => {
    const r = await a.load(`${BASE}/reports`, realReady);
    assert.equal(r.banners, 0, 'View As is not a preview');
    assert.equal(r.preview, false);
    assert.equal(r.real, true, 'the support session sees the member\'s own workspace');
    assert.ok(r.liveAsk > 0, 'and its writes, as the member');
  });
});

test('6. the model and App.jsx agree on the company addresses that own the banner', () => {
  assert.equal(previewCompanyTabOf(BASE), 'overview');
  assert.equal(previewCompanyTabOf(`${BASE}/`), 'overview');
  for (const t of ['financials', 'reports', 'support', 'activity', 'terms']) assert.equal(previewCompanyTabOf(`${BASE}/${t}`), t);
  assert.equal(previewCompanyTabOf('/portfolio/companies'), null, 'no uid, no company');
  assert.equal(previewCompanyTabOf('/portfolio/companies/'), null);
  assert.equal(previewCompanyTabOf(`${BASE}/nope`), null, 'an address the app has no route for');
  assert.equal(previewCompanyTabOf('/portfolio/waterfall'), null);
  assert.equal(pageOwnsPreviewBanner(`${BASE}/reports`, 'investor'), true);
  assert.equal(pageOwnsPreviewBanner(`${BASE}/reports`, 'founder'), false, 'a founder preview keeps the strip');
  assert.equal(pageOwnsPreviewBanner('/portfolio/waterfall', 'investor'), false, 'Waterfall keeps the strip');
  // App.jsx's imports are frozen (D5615), so the strip's copy of the company rule lives there: it answers as the model does.
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const source = /const PREVIEW_BANNER_COMPANY = \/(.+)\/;\n/.exec(app);
  assert.ok(source, 'App.jsx holds the strip\'s company addresses');
  assert.match(app, /PREVIEW_BANNER_COMPANY\.test\(/, 'and the strip consults them');
  const strip = new RegExp(source[1]);
  for (const path of [...TABS.map((t) => t.route), `${BASE}/terms`, `${BASE}/reports/`, `${BASE}/nope`, '/portfolio/companies', '/portfolio/companies/', '/portfolio', '/portfolio/waterfall', '/studio']) {
    assert.equal(strip.test(path), previewCompanyTabOf(path) !== null, `${path}: the strip and the model agree`);
  }
  // Every tab the real workspace draws has a preview spec.
  assert.deepEqual(Object.keys(PREVIEW_COMPANY_TABS), COMPANY_TABS.map((t) => t.id));
});
