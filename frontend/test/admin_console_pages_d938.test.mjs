/**
 * D938 (#2743, part 1 of #2375) — the Admin Console is retired: every tool is
 * a page at its own address under the shared header, and `/admin?tab=`
 * forwards there before anything mounts, through one map.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_console_pages_d938.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';
import { ADMIN_TAB_MOVES, legacyContractsTarget, movedNoticesFor } from '../src/pages/admin/LegacyContractsRedirect.jsx';
import AdminPageHeader, { HeaderMenuItem } from '../src/ui/AdminPageHeader.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = readRoutesSource();
const routeLine = (path) => APP.split('\n').find((l) => l.includes(`path="${path}"`)) || '';

// #2375's route map, as D938 builds it.
const MAP = {
  users: '/admin/accounts/all',
  profiles: '/admin/partner-profiles',
  kyc: '/admin/kyc',
  personas: '/admin/persona-segments',
  directory: '/admin/directory',
  wellbeing: '/admin/wellbeing',
  payments: '/admin/platform/payments',
  'bank-accounts': '/admin/platform/bank-accounts',
  'product-testing': '/admin/platform/product-testing',
  promos: '/admin/platform/promo-codes',
  billing: '/admin/revenue/billing',
};
const HQ_ONLY = ['payments', 'bank-accounts', 'product-testing', 'promos', 'billing'];

test('every old tab forwards to its #2375 address, adding ?moved=<tab>', () => {
  for (const [tab, to] of Object.entries(MAP)) {
    assert.equal(ADMIN_TAB_MOVES[tab].to, to, tab);
    assert.equal(legacyContractsTarget(`?tab=${tab}`), `${to}?moved=${tab}`, tab);
  }
  // D937, D972, D647 and the owner's ruling keep their targets.
  assert.equal(legacyContractsTarget('?tab=lab-applications'), '/admin/programs/spinout-lab/applications?moved=lab-applications');
  assert.equal(legacyContractsTarget('?tab=network-profiles'), '/admin/advisors-partners/deck?moved=network-profiles');
  assert.equal(legacyContractsTarget('?tab=legal'), '/admin/contracts?moved=legal');
  assert.equal(legacyContractsTarget('?tab=integration-keys'), '/admin/integration-keys');
});

test('the forward keeps every other query and the hash, and drops an old moved', () => {
  assert.equal(legacyContractsTarget('?tab=kyc&status=pending&moved=x', '#row-4'), '/admin/kyc?status=pending&moved=kyc#row-4');
  assert.equal(legacyContractsTarget('?q=ana&tab=promos'), '/admin/platform/promo-codes?q=ana&moved=promos');
  assert.equal(legacyContractsTarget('?tab=github&x=1', '#old'), '/admin/integration-keys?x=1#github');
  assert.equal(legacyContractsTarget('?tab=integration-keys&moved=kyc'), '/admin/integration-keys', 'an old moved travels to a page that shows no notice');
  // A bare or unknown tab opens All accounts, as the console opened Users.
  for (const q of ['', '?tab=', '?tab=nope', '?tab=hasOwnProperty']) assert.equal(legacyContractsTarget(q), '/admin/accounts/all?moved=users', q);
});

test('each notice is one of #2375\'s three forms, and a page shows only its own', () => {
  const forms = [
    /^The Admin Console has moved: [A-Z][\w &]+ now lives under (Approvals|Community|Platform|Revenue|Accounts)\.$/,
    /^[A-Z][\w &]+ has a new address\. Update your bookmark\.$/,
    /^[A-Z][\w &]+ is now [A-Z][\w &]+, under (Accounts|Approvals)\.$/,
  ];
  for (const [tab, m] of Object.entries(ADMIN_TAB_MOVES)) {
    if (!m.notice) continue;
    assert.ok(forms.some((f) => f.test(m.notice)), `${tab}: "${m.notice}" is none of the three forms`);
  }
  assert.deepEqual(movedNoticesFor('/admin/kyc'), { kyc: 'KYC Queue is now KYC & KYB, under Approvals.' });
  assert.deepEqual(movedNoticesFor('/admin/accounts/all'), { users: 'Users is now All accounts, under Accounts.' });
  assert.deepEqual(movedNoticesFor('/admin/platform/payments'), { payments: 'The Admin Console has moved: Payments now lives under Platform.' });
  assert.deepEqual(movedNoticesFor('/admin/contracts'), {}, 'Contracts shows its own D647 notice');
});

test('/admin mounts nothing, and each new address is registered behind its guard', () => {
  assert.match(routeLine('/admin'), /element=\{guard\(\['admin'\], <LegacyContractsRedirect \/>\)\}/);
  assert.ok(!existsSync(resolve(process.cwd(), 'frontend/src/pages/AdminPage.jsx')), 'AdminPage.jsx is back');
  assert.doesNotMatch(APP, /AdminPage'\)|<AdminPage\b/, 'App.jsx still mounts the console');
  for (const [tab, path] of Object.entries(MAP)) {
    const line = routeLine(path);
    assert.ok(line, `${path} is not registered`);
    assert.match(line, /guard\(\['admin'\], /, `${path} is not behind the admin guard`);
    assert.equal(/hqOnly\(/.test(line), HQ_ONLY.includes(tab), `${path}: hqOnly is ${!HQ_ONLY.includes(tab)}`);
  }
  // /admin/accounts itself stays HQ › Team until #2375's question 1 is answered.
  assert.match(routeLine('/admin/accounts'), /hqOnly\(<HqAccountsPage/);
});

test('no page draws the old shell: no Admin Console title, dropdown or ?tab= door', () => {
  const pages = read('frontend/src/pages/admin/ConsolePages.jsx');
  assert.doesNotMatch(pages, /<h1|Admin Console<|AdminSectionNav|aria-label="Select admin section"/);
  const hits = [];
  for (const f of ['frontend/src/App.jsx', 'frontend/src/lib/hqStrips.js', 'frontend/src/lib/railPages.js', 'frontend/src/lib/adminPlacement.js',
    'frontend/src/lib/railOptions/admin.js', 'frontend/src/lib/railOptions/superAdmin.js', 'frontend/src/pages/hq/PlatformPage.jsx',
    'frontend/src/pages/hq/ContentPage.jsx', 'frontend/src/pages/admin/approvals/AdminApprovals.jsx', 'frontend/src/pages/admin/HeldAccounts.jsx']) {
    for (const m of read(f).matchAll(/(?:to|href|route)[=:] ?["'`](\/admin\?tab=[\w-]+)/g)) hits.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(hits, [], 'a door still opens the retired console');
});

test('the More menu opens, closes on Escape and on a pick, and holds literal links', async () => {
  let copied = 0;
  const v = await mountContracts(React.createElement(AdminPageHeader, {
    title: 'All accounts',
    line: 'Every account.',
    more: React.createElement(React.Fragment, null,
      React.createElement(HeaderMenuItem, { onSelect: () => { copied += 1; } }, 'Copy page link'),
      React.createElement(HeaderMenuItem, { to: '/admin/trash' }, 'Trash')),
  }), '/admin/accounts/all');
  const byTestId = (id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
  try {
    const more = byTestId('admin-page-more');
    assert.equal(v.props(more)['aria-haspopup'], 'menu');
    assert.equal(v.props(more)['aria-expanded'], false);
    assert.equal(byTestId('admin-page-more-menu'), undefined, 'the menu is open before it is asked for');
    await v.click('⋯');
    const menu = byTestId('admin-page-more-menu');
    assert.ok(menu, 'the menu did not open');
    assert.equal(v.props(menu).role, 'menu');
    assert.equal(v.props(byTestId('admin-page-more'))['aria-expanded'], true);
    const items = v.nodes().filter((n) => v.props(n)?.role === 'menuitem');
    assert.deepEqual(items.map((n) => v.props(n).tabIndex), [-1, -1]);
    assert.ok(items.some((n) => n.tagName === 'A'), 'Trash is not a link');
    // Escape closes it.
    const wrap = more.parentNode;
    await act(async () => { v.props(wrap).onKeyDown({ key: 'Escape', preventDefault() {} }); });
    assert.equal(byTestId('admin-page-more-menu'), undefined, 'Escape did not close the menu');
    // A pick runs its action and closes it.
    await v.click('⋯');
    await v.click('Copy page link');
    assert.equal(copied, 1);
    assert.equal(byTestId('admin-page-more-menu'), undefined, 'a pick did not close the menu');
  } finally { await v.unmount(); }
  // All accounts carries the Trash door the console's header held.
  assert.match(read('frontend/src/pages/admin/ConsolePages.jsx'), /<HeaderMenuItem to="\/admin\/trash"/);
});

test('a page with no More draws no "⋯"', async () => {
  const v = await mountContracts(React.createElement(AdminPageHeader, { title: 'Directory', line: 'x' }), '/admin/directory');
  try {
    assert.ok(!v.nodes().some((n) => v.props(n)?.['data-testid'] === 'admin-page-more'));
  } finally { await v.unmount(); }
});


test('merged dedicated pages keep a single native route and their own rail host', async () => {
  const raw = read('frontend/src/App.jsx');
  for (const [path, component] of [['/admin/partner-profiles', 'PartnerProfiles'], ['/admin/persona-segments', 'PersonaSegments'], ['/admin/platform/payments', 'Payments']]) {
    const rows = raw.split('\n').filter((l) => l.includes(`path="${path}"`));
    assert.equal(rows.length, 1, `${path} must not be shadowed by a console wrapper`);
    assert.ok(rows[0].includes(`<${component} />`), `${path} keeps its dedicated page`);
    if (component === 'Payments') assert.ok(rows[0].includes('hqOnly('));
  }
  const { ADMIN_BOARDS } = await import('../src/lib/railOptions/admin.js');
  const { SUPER_ADMIN_BOARDS } = await import('../src/lib/railOptions/superAdmin.js');
  for (const [boards, id, host] of [[ADMIN_BOARDS, 'S7', 'pages/admin/profiles/PartnerProfiles.jsx'], [SUPER_ADMIN_BOARDS, 'H22', 'pages/admin/segments/PersonaSegments.jsx'], [SUPER_ADMIN_BOARDS, 'H29', 'pages/admin/payments/Payments.jsx']]) {
    assert.equal(boards.find((b) => b.id === id).host, host, id);
  }
});
