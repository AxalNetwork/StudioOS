/**
 * D979 (#2765) — Advisors & Partners › Firms complete: search, filters, sort
 * and pages from the Worker's list read (AP5), the "No firm" strip with Attach
 * (AP10), the firm's drawer (AP6) with its directory switches behind a
 * confirm, deals and settlements read only, the profile and office hours, and
 * Detach (AP9d). Mounted on a stubbed `fetch`, reading React props through
 * `__reactProps$`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_advisors_firms_d979.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AP_FIRMS_PATH } from '../src/pages/admin/advisors/apModel.js';
import {
  FIRMS_PAGE, INITIAL_QUERY, LIST_FIRST, attachCopy, detachCopy, directoryCopy, directorySavedLine, drawerOf, firmRows, listParams, money, rangeText, unattachedOf, unreadableLine,
} from '../src/pages/admin/advisors/firmsModel.js';
import AdvisorsPartners from '../src/pages/admin/advisors/AdvisorsPartners.jsx';

const h = React.createElement;
const value = (v) => ({ available: true, recorded: true, value: v });
const notRecorded = (reason) => ({ available: true, recorded: false, reason });
const down = (reason = 'could not be read') => ({ available: false, reason });

// ---------------------------------------------------------------- fixtures

const ITEM = (id, over = {}) => ({
  id, name: `Firm ${id}`, company: null, specialization: null, status: 'active', directory: { listed: false, featured: false },
  accounts: value(0), deal: value({ count: 0, types: [], soonest_end: null, ending_soon: false }), redemptions: value(0),
  rating: value({ count: 0, average: null }), settlements_due: value({ currency: 'usd', count: 0, to_member_cents: 0, from_member_cents: 0 }),
  ...over,
});
const LIST = {
  items: [
    ITEM(100, { name: 'Example', company: 'Example Ventures Ltd', specialization: 'Go-to-market', directory: { listed: true, featured: true }, accounts: value(3),
      deal: value({ count: 1, types: ['services_partnership'], soonest_end: '2026-11-03T00:00:00.000Z', ending_soon: true }), redemptions: value(12),
      rating: value({ count: 7, average: 4.4 }), settlements_due: value({ currency: 'usd', count: 2, to_member_cents: 120000, from_member_cents: 80050 }) }),
    ITEM(101, { company: 'Sample Growth', directory: { listed: true, featured: false }, accounts: value(2),
      deal: value({ count: 2, types: ['capital_partnership', 'custom'], soonest_end: '2027-02-02T00:00:00.000Z', ending_soon: false }) }),
    ITEM(102, { name: 'Testwell Ops', deal: down(), redemptions: down(), settlements_due: notRecorded('Settlements are kept by HQ.') }),
  ],
  total: 57, limit: 25, offset: 0, sort: 'name_asc', unreadable: ['deals', 'redemptions'],
  filters: { deal_types: ['equity_partnership', 'services_partnership', 'deal_sourcing_revshare', 'capital_partnership', 'custom'] },
};
const LINKS = {
  accounts: [
    { id: 10, name: 'Teo Sample', email: 'teo@example.test', partner_id: null },
    { id: 14, name: '', email: 'noname@example.test', partner_id: null },
    { id: 11, name: 'Pia Example', email: 'pia@example.test', partner_id: 100 },
  ],
  firms: [
    { id: 100, name: 'Example', company: 'Example Ventures Ltd', accounts: 3 },
    { id: 101, name: 'Firm 101', company: 'Sample Growth', accounts: 2 },
    { id: 102, name: 'Testwell Ops', company: null, accounts: 0 },
  ],
  attached: 1, unattached: 2,
};
const FIRM = {
  firm: { id: 100, name: 'Example', company: 'Example Ventures Ltd', specialization: 'Go-to-market', status: 'active' },
  scope: 'hq',
  accounts: value([{ id: 11, name: 'Pia Example', headline: 'Sales lead', active: true }, { id: 12, name: null, headline: null, active: false }]),
  directory: { listed: true, featured: false, decided_at: '2026-10-01 10:00:00' },
  deals: value({ more: false, rows: [{ id: 7, user_id: 11, deal_type: 'services_partnership', status: 'active', term_months: 12, activated_at: '2026-03-12 00:00:00', expires_at: '2027-03-12 00:00:00', granted_tier_founder: null, granted_tier_investor: 'professional', redemptions: 12 }] }),
  settlements: value({ more: false, rows: [
    { id: 1, partner_deal_id: 7, kind: 'revenue_share', direction: 'to_member', amount_cents: 120000, currency: 'usd', due_on: '2026-11-02', state: 'issued' },
    { id: 2, partner_deal_id: 7, kind: 'other', direction: 'from_member', amount_cents: 80000, currency: 'usd', due_on: '2026-10-01', state: 'matched' },
  ] }),
  profiles: value([{ user_id: 11, organization: value('Example Ventures Ltd'), role_title: value('Partner'), expertise: value(['Go-to-market', 'Sales hiring']), sectors: notRecorded('Sectors not recorded.'), geography: down(), capacity_per_month: value('3 engagements'), capital_capacity: notRecorded('Capital capacity not recorded.'), updated_at: null }]),
  office_hours: { when_to_book: value('After the first paying customers'), stage_fit: value('Pre-seed · Seed'), session_outcome: notRecorded('x'), rating: value({ count: 7, average: 4.4 }), lab_host: value({ status: 'approved', decided_at: null }) },
};

// ---------------------------------------------------------------- the model

test('only what is chosen travels to the list read, and a page is an offset of 25', () => {
  // Mutation checked: the default sort sent → `sort` present on the first call; page 3 as offset 50 → 75.
  assert.deepEqual(JSON.parse(JSON.stringify(listParams(INITIAL_QUERY))), { limit: 25 });
  assert.deepEqual(JSON.parse(JSON.stringify(listParams({ ...INITIAL_QUERY, q: '  growth ', directory: 'featured', dealType: 'custom', endsWithin: '30', noAccounts: true, sort: 'rating_desc', page: 3 }))),
    { q: 'growth', directory: 'featured', deal_type: 'custom', ends_within: '30', no_accounts: 'true', sort: 'rating_desc', limit: FIRMS_PAGE, offset: 50 });
});

test('AP5 rows: the nine columns from the blocks, a failed column says so, never a zero', () => {
  // Mutation checked: a failed deal block read as "No active deal" → row 102's deal differs; HQ's note read as "—" → its settlements differ.
  const [a, b, c] = firmRows(LIST);
  assert.deepEqual([a.title, a.sub, a.accounts, a.specialization, a.deal.word, a.deal.ends, a.deal.soon, a.redemptions, a.directory, a.rating],
    ['Example Ventures Ltd', 'Example', '3', 'Go-to-market', 'Services partnership', '3 Nov 2026', true, '12', '★ Featured', '4.4 (7)']);
  assert.deepEqual([a.settlements.text, a.settlements.sub], ['$1,200 to the firm · $800.50 to the studio', '2 issued, due within 30 days']);
  assert.deepEqual([b.title, b.sub, b.deal.word, b.deal.soon, b.directory, b.rating, b.specialization, b.settlements.text], ['Sample Growth', 'Firm 101', '2 active deals', false, '✓ Listed', 'No ratings yet', 'Not recorded', '—']);
  assert.deepEqual([c.title, c.deal.word, c.deal.ends, c.redemptions, c.directory, c.settlements.text], ['Testwell Ops', 'Could not be read', 'Could not be read', 'Could not be read', 'Not listed', 'Kept by HQ']);
  assert.equal(rangeText(LIST), '1–3 of 57');
  assert.equal(rangeText({ items: [], total: 57, offset: 75 }), 'None on this page · 57 in all');
  assert.equal(rangeText({ items: [], total: 0 }), 'No firms');
  assert.match(unreadableLine(LIST), /The active deals, redemptions could not be read, so those columns say so/);
  assert.equal(unreadableLine({ unreadable: [] }), null);
  assert.equal(money(80050), '$800.50');
  const u = unattachedOf(LINKS);
  assert.deepEqual([u.count, u.rows.map((r) => r.id)], [2, [10, 14]]);
});

test('AP6 drawer blocks, and every dialog says what it changes', () => {
  // Mutation checked: unlisting a featured firm without the feature sentence → the body lacks it; "she" for an account → the detach body differs.
  const d = drawerOf(FIRM);
  assert.deepEqual(d.accounts.rows.map((a) => [a.name, a.sub, a.inactive]), [['Pia Example', 'Sales lead · Operating partner', false], ['Name not recorded', 'Operating partner', true]]);
  assert.deepEqual(d.deals.rows[0], { id: 7, type: 'Services partnership', status: 'active', term: '12 Mar 2026 – 12 Mar 2027', tiers: 'Investor Professional', redemptions: '12' });
  assert.deepEqual(d.settlements.rows.map((s) => [s.kind, s.direction, s.amount, s.due, s.state.word]), [['Revenue share', 'Studio → firm', '$1,200', '2 Nov 2026', 'Issued'], ['Other', 'Firm → studio', '$800', '1 Oct 2026', 'Matched']]);
  assert.deepEqual(Object.fromEntries(d.profiles.rows[0].facts), { Organisation: 'Example Ventures Ltd', 'Role title': 'Partner', Expertise: 'Go-to-market · Sales hiring', Sectors: 'Not recorded', Geography: 'Could not be read', 'Capacity per month': '3 engagements', 'Capital capacity': 'Not recorded' });
  assert.deepEqual(Object.fromEntries(d.officeHours), { 'When to book': 'After the first paying customers', 'Stage fit': 'Pre-seed · Seed', 'Session outcome': 'Not recorded', Rating: '4.4 (7)', 'Lab host': '✓ Approved' });
  assert.deepEqual(drawerOf({ ...FIRM, settlements: notRecorded('Settlements are kept by HQ.') }).settlements, { state: 'hq', text: 'Settlements are kept by HQ.' });
  assert.equal(drawerOf({ ...FIRM, deals: down() }).deals.state, 'unreadable');

  const firm = FIRM.firm;
  assert.match(directoryCopy(firm, 'listed', false, { listed: true, featured: true }).body, /Its feature is removed too, because featuring needs listing\./);
  assert.doesNotMatch(directoryCopy(firm, 'listed', false, { listed: true, featured: false }).body, /feature is removed/);
  assert.deepEqual(directoryCopy(firm, 'featured', true, { listed: true }).payload, { featured: true });
  assert.deepEqual(directoryCopy(firm, 'listed', true, {}).payload, { listed: true });
  assert.equal(directoryCopy(firm, 'featured', false, { listed: true, featured: true }).title, 'Stop featuring Example Ventures Ltd?');
  assert.equal(directorySavedLine({ partner: { listed: true, featured: false } }), 'Listed in the public directory, not featured.');
  assert.deepEqual(detachCopy({ name: 'Pia Example' }, firm), {
    title: 'Detach Pia Example from Example Ventures Ltd?',
    body: 'Pia Example loses the firm’s pipeline, offers and earnings until they are attached again. The change is recorded in the admin audit log.',
    action: 'Detach',
  });
  assert.equal(attachCopy({ account: LINKS.accounts[1] }).title, 'Attach noname@example.test to a firm', 'an account with no name is its address, from the links read');
  assert.equal(attachCopy({ firm }).pick, 'account');
});

// ---------------------------------------------------------------- mounted

function worker({ list = (q, json) => json(LIST), firm = (json) => json(FIRM), writes = {} } = {}) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = init.method || 'GET';
    seen.push(`${method} ${u.pathname}${u.search}`);
    const p = u.pathname;
    if (method === 'POST') {
      const body = init.body ? JSON.parse(init.body) : null;
      seen.push(body);
      if (p === '/api/admin/partners/links') return writes.link ? writes.link(body) : json({ ok: true, ...body });
      const m = p.match(/^\/api\/admin\/partners\/(\d+)\/directory$/);
      if (m) return writes.directory ? writes.directory(body) : json({ ok: true, partner: { id: Number(m[1]), listed: body.listed ?? true, featured: !!body.featured } });
    }
    if (p === '/api/admin/partners/firms') return list(u.searchParams, json);
    if (/^\/api\/admin\/partners\/firms\/\d+$/.test(p)) return firm(json);
    if (p === '/api/admin/partners/links') return json(LINKS);
    return json({});
  };
  return seen;
}

function Where({ onAt }) { const l = useLocation(); onAt(l.pathname + l.search); return null; }

async function mount(url, opts) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const seen = worker(opts);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let where = url;
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdvisorsPartners), h(Where, { onAt: (x) => { where = x; } }))); });
  const settle = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    seen,
    where: () => where,
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    prop: (id, k) => props(node(id))[k],
    async change(id, v) { await act(async () => { props(node(id)).onChange({ target: { value: v } }); }); await settle(); },
    async click(id) { await act(async () => { props(node(id)).onClick(); }); await settle(); },
    async pick(id) { await act(async () => { props(node(id)).onChange(); }); await settle(2); },
    async clickText(scope, label) {
      const btn = walk(node(scope)).find((n) => n.tagName === 'BUTTON' && textOf(n) === label);
      assert.ok(btn, `no ${label} in ${scope}`);
      await act(async () => { props(btn).onClick(); }); await settle();
    },
    gets: () => seen.filter((s) => typeof s === 'string' && s.startsWith('GET /api/admin/partners/firms')),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('mounted AP5: the table, the strip, the columns that failed, and each filter, sort and page sent to the Worker', async () => {
  // Mutation checked: the page reset dropped on a filter change → the filter's call carries offset=25.
  const m = await mount(AP_FIRMS_PATH);
  try {
    assert.match(m.of('ap-firm-100'), /Example Ventures Ltd.*Example.*3.*Go-to-market.*Services partnership.*3 Nov 2026.*within 30 days.*12.*★ Featured.*4\.4 \(7\).*\$1,200 to the firm/s);
    assert.match(m.of('ap-firm-102-deal'), /Could not be read/);
    assert.match(m.of('ap-firm-102-settlements'), /Kept by HQ/);
    assert.match(m.of('ap-firms-columns-unreadable'), /active deals, redemptions could not be read/);
    assert.match(m.of('ap-firms-unattached'), /no firm: 2.*Teo Sample.*noname@example\.test/s);
    assert.equal(m.of('ap-firms-range'), '1–3 of 57');
    assert.deepEqual(m.gets(), ['GET /api/admin/partners/firms?limit=25']);
    await m.change('ap-firms-search', 'growth');
    await m.change('ap-firms-directory', 'listed');
    await m.change('ap-firms-deal-type', 'custom');
    await m.change('ap-firms-ends', '60');
    await m.click('ap-firms-no-accounts');
    await m.change('ap-firms-sort', 'deal_ends_asc');
    assert.equal(m.gets().at(-1), 'GET /api/admin/partners/firms?q=growth&directory=listed&deal_type=custom&ends_within=60&no_accounts=true&sort=deal_ends_asc&limit=25');
  } finally { await m.unmount(); }
});

test('mounted AP5: pages move by 25 and a filter goes back to page one; a failed list and an unanswerable filter say so', async () => {
  // Mutation checked: the page reset dropped on a filter change → the filter's call carries offset=25;
  // a failed list drawn as "No firm is recorded yet" → ap-firms-none is present.
  const m = await mount(AP_FIRMS_PATH);
  try {
    await m.clickText('ap-firms', 'Next');
    assert.equal(m.gets().at(-1), 'GET /api/admin/partners/firms?limit=25&offset=25');
    await m.change('ap-firms-directory', 'featured');
    assert.equal(m.gets().at(-1), 'GET /api/admin/partners/firms?directory=featured&limit=25');
  } finally { await m.unmount(); }
  let fail = 'filter';
  const f = await mount(AP_FIRMS_PATH, { list: (q, json) => (fail === 'filter'
    ? json({ error: 'filter_unreadable', message: 'The deals could not be read, so this filter or sort cannot be answered. That is not the same as no firms.' }, 503)
    : fail === 'all' ? json({ error: 'firms_unreadable', message: 'x' }, 503) : json(LIST)) });
  try {
    assert.match(f.of('ap-firms-unreadable'), /The deals could not be read, so this filter or sort cannot be answered/);
    assert.ok(!f.has('ap-firms-table'));
    assert.ok(!f.has('ap-firms-none'), 'a failed read is not "no firms"');
    fail = 'all';
    await f.clickText('ap-firms-unreadable', 'Try again');
    assert.equal(f.of('ap-firms-unreadable'), 'The firms could not be read. That is not the same as no firms.Try again');
    fail = null;
    await f.clickText('ap-firms-unreadable', 'Try again');
    assert.ok(f.has('ap-firms-table'));
  } finally { await f.unmount(); }
});

test('mounted AP5 → AP6: a row opens the firm at ?firm=, its blocks each stand alone, and Close takes the address back', async () => {
  // Mutation checked: the drawer's 404 read as Unreadable → "no longer exists" is missing.
  const m = await mount(AP_FIRMS_PATH, { firm: (json) => json({ ...FIRM, profiles: down() }) });
  try {
    await m.click('ap-firm-open-100');
    assert.equal(m.where(), `${AP_FIRMS_PATH}?firm=100`);
    assert.match(m.of('ap-firm-drawer'), /Firm.*Example Ventures Ltd/s);
    assert.match(m.of('ap-firm-accounts'), /Accounts2.*Pia Example.*Sales lead · Operating partner.*Detach.*Name not recorded.*account inactive/s);
    assert.match(m.of('ap-firm-deals'), /Services partnership.*Active.*12 Mar 2026 – 12 Mar 2027.*Investor Professional · Referral redemptions 12.*Open on Partner invitations.*Deals are ended on Partner invitations, not here\./s);
    assert.match(m.of('ap-firm-settlements'), /Revenue share.*Studio → firm.*\$1,200.*2 Nov 2026.*Issued.*Read only\. Settlements are drafted and issued in Contracts\./s);
    assert.match(m.of('ap-firm-profile-unreadable'), /The partner profiles could not be read/);
    assert.match(m.of('ap-firm-office-hours'), /When to book.*After the first paying customers.*Lab host.*Approved/s);
    assert.equal(m.prop('ap-firm-featured', 'disabled'), false);
    assert.equal(m.seen.filter((s) => s === 'GET /api/admin/partners/firms/100').length, 1);
    await m.clickText('ap-firm-drawer', 'Close');
    assert.equal(m.where(), AP_FIRMS_PATH);
    assert.ok(!m.has('ap-firm-drawer'));
  } finally { await m.unmount(); }
  const gone = await mount(`${AP_FIRMS_PATH}?firm=999`, { firm: (json) => json({ error: 'not_found', message: 'This firm no longer exists.' }, 404) });
  try { assert.equal(gone.of('ap-firm-gone'), 'This firm no longer exists.'); } finally { await gone.unmount(); }
});

test('mounted AP6: a directory switch asks first, saves the one flag, and says the result; Featured waits for listing', async () => {
  // Mutation checked: the switch saving without its confirm → a POST before the click on Feature; Featured enabled on an unlisted firm → disabled is false.
  const m = await mount(`${AP_FIRMS_PATH}?firm=100`);
  try {
    await m.click('ap-firm-featured');
    assert.match(m.of('ap-firm-directory-confirm'), /Feature Example Ventures Ltd\?.*drawn above the standard rows/s);
    assert.ok(!m.seen.some((s) => typeof s === 'string' && s.startsWith('POST')), 'nothing is saved before the confirm');
    await m.click('ap-firm-directory-confirm-go');
    assert.ok(m.seen.includes('POST /api/admin/partners/100/directory'));
    assert.deepEqual(m.seen[m.seen.indexOf('POST /api/admin/partners/100/directory') + 1], { featured: true });
    assert.equal(m.of('ap-firm-done'), 'Listed and featured in the public directory.');
    assert.ok(!m.has('ap-firm-directory-confirm'));
  } finally { await m.unmount(); }
  const unlisted = await mount(`${AP_FIRMS_PATH}?firm=100`, { firm: (json) => json({ ...FIRM, directory: { listed: false, featured: false } }) });
  try {
    assert.equal(unlisted.prop('ap-firm-featured', 'disabled'), true);
    assert.equal(unlisted.of('ap-firm-featured-note'), LIST_FIRST);
  } finally { await unlisted.unmount(); }
  const refused = await mount(`${AP_FIRMS_PATH}?firm=100`, { writes: { directory: () => new Response(JSON.stringify({ error: 'admin_frozen', code: 'admin_frozen' }), { status: 423, headers: { 'Content-Type': 'application/json' } }) } });
  try {
    await refused.click('ap-firm-listed');
    await refused.click('ap-firm-directory-confirm-go');
    assert.match(refused.of('ap-firm-directory-confirm-refusal'), /Changes are refused while HQ has paused your admin access/);
    assert.ok(refused.has('ap-firm-directory-confirm'), 'a refusal stays inside its dialog');
  } finally { await refused.unmount(); }
});

test('mounted AP9d and AP10: detach asks and sends null; attach from the strip and from the drawer, both sides chosen', async () => {
  // Mutation checked: Detach sending the firm's id → partner_id is 100; the strip's Attach saving the first firm without a choice → Attach is enabled before a pick.
  const m = await mount(`${AP_FIRMS_PATH}?firm=100`);
  try {
    await m.click('ap-firm-detach-11');
    assert.equal(m.of('ap-firm-detach-confirm-body'), 'Pia Example loses the firm’s pipeline, offers and earnings until they are attached again. The change is recorded in the admin audit log.');
    await m.click('ap-firm-detach-confirm-go');
    assert.deepEqual(m.seen[m.seen.indexOf('POST /api/admin/partners/links') + 1], { user_id: 11, partner_id: null });
    assert.equal(m.of('ap-firm-done'), 'Detached Pia Example from Example Ventures Ltd.');
    await m.click('ap-firm-attach');
    assert.match(m.of('ap-attach-dialog'), /Attach an account to Example Ventures Ltd.*Teo Sample.*noname@example\.test.*You choose both\. Nothing is matched for you\./s);
    await m.change('ap-attach-search', 'noname');
    assert.ok(!m.has('ap-attach-choice-10'), 'the search narrows the accounts');
    await m.pick('ap-attach-choice-14');
    await m.click('ap-attach-save');
    assert.deepEqual(m.seen.filter((s) => s && typeof s === 'object' && 'user_id' in s).at(-1), { user_id: 14, partner_id: 100 });
  } finally { await m.unmount(); }

  const s = await mount(AP_FIRMS_PATH, { writes: { link: (body) => (body.partner_id === 102
    ? new Response(JSON.stringify({ error: 'only a partner account can be attached to a firm; read a firm as an admin by impersonating one of its accounts' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    : new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { 'Content-Type': 'application/json' } })) } });
  try {
    await s.click('ap-nofirm-attach-10');
    assert.match(s.of('ap-attach-dialog'), /Attach Teo Sample to a firm.*Teo Sample · Operating partner/s);
    assert.equal(s.prop('ap-attach-save', 'disabled'), true, 'nothing is chosen for you');
    await s.pick('ap-attach-choice-102');
    await s.click('ap-attach-save');
    assert.equal(s.of('ap-attach-refusal'), 'Only a partner account can be attached to a firm.');
    await s.pick('ap-attach-choice-101');
    await s.click('ap-attach-save');
    assert.deepEqual(s.seen.filter((x) => x && typeof x === 'object' && 'user_id' in x).at(-1), { user_id: 10, partner_id: 101 });
    assert.equal(s.of('ap-firms-done'), 'Attached Teo Sample to Sample Growth.');
    assert.ok(!s.has('ap-attach-dialog'));
  } finally { await s.unmount(); }
});
