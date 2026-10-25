/**
 * D940 (#2745), part 3 of the admin page header (#2375) — canvas SHL7a and
 * SHL7b.
 *
 * What this file holds the pages to:
 *   · SHL7a: an admin without the elevation, on an HQ-only page, reads the
 *     dashed "HQ only" card, its title as the page's one h1, with "Go to
 *     Studio" and "My licence" and no "Admin Console" link;
 *   · SHL7b: a member who is not an admin, on an `/admin` page, stays on that
 *     address and reads "This page is for studio admins" in their own shell,
 *     with "Go to your home", instead of being sent to Studio with no word;
 *   · every other guarded route keeps its redirect, an admin is never shown
 *     the member's card, and a pending impersonation handoff still wins.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_page_refusals_d940.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import SuperAdminOnlyNotice from '../src/pages/hq/SuperAdminOnlyNotice.jsx';
import AdminOnlyNotice from '../src/pages/hq/AdminOnlyNotice.jsx';
import { ADMIN_TITLE, ADMIN_LINE, ADMIN_HOME_LABEL, HQ_TITLE, HQ_EYEBROW, hqLine, adminRefusal } from '../src/pages/hq/hqNoticeModel.js';

const h = React.createElement;
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const APP = read('frontend/src/App.jsx');

/** One component, mounted alone: its text, its links, its headings. */
async function mounted(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/licences'] }, element)));
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const tag = (n) => String(n.tagName || n.nodeName || '').toLowerCase();
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  return {
    text: () => text(container).replace(/\s+/g, ' ').trim(),
    links: () => nodes().filter((n) => tag(n) === 'a').map((n) => ({ text: text(n).trim(), href: n.getAttribute?.('href') ?? props(n).href })),
    headings: () => nodes().filter((n) => /^h[1-6]$/.test(tag(n))).map((n) => [tag(n), text(n).trim()]),
    byTestId: (id) => nodes().find((n) => props(n)['data-testid'] === id),
    props,
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('SHL7a: the HQ-only card, its one h1, Go to Studio and My licence, and no Admin Console link', async () => {
  // Mutation checked: the "Admin Console" link put back → the link list differs; the title as an h2 → no h1;
  // the eyebrow dropped → the text check fails.
  const page = await mounted(h(SuperAdminOnlyNotice));
  try {
    assert.ok(page.byTestId('super-admin-only-notice'));
    assert.deepEqual(page.headings(), [['h1', 'This page belongs to the Super Admin']]);
    assert.equal(HQ_TITLE, 'This page belongs to the Super Admin');
    assert.equal(page.text(), `${HQ_EYEBROW}${HQ_TITLE}${hqLine('/admin/licences')}Go to StudioMy licence`);
    assert.deepEqual(page.links(), [{ text: 'Go to Studio', href: '/studio' }, { text: 'My licence', href: '/admin/my-licence' }]);
    assert.doesNotMatch(page.text(), /Admin Console/);
    const card = page.byTestId('super-admin-only-notice');
    assert.equal(page.props(card)['aria-labelledby'], 'super-admin-only-title');
    assert.match(page.props(card).className, /border-dashed/);
    assert.match(page.props(card).className, /dark:bg-gray-900/, 'drawn in dark too');
  } finally { await page.close(); }
});

test('SHL7b: the member card, its one h1, and Go to your home to the member’s own home', async () => {
  // Mutation checked: the action linked to "/" instead of `home` → the href differs; the line changed → the text check fails.
  const page = await mounted(h(AdminOnlyNotice, { home: '/exploring' }));
  try {
    assert.deepEqual(page.headings(), [['h1', 'This page is for studio admins']]);
    assert.equal(page.text(), '⊘This page is for studio adminsIf you run a studio, ask HQ for admin access.Go to your home');
    assert.deepEqual(page.links(), [{ text: 'Go to your home', href: '/exploring' }]);
    assert.deepEqual([ADMIN_TITLE, ADMIN_LINE, ADMIN_HOME_LABEL], ['This page is for studio admins', 'If you run a studio, ask HQ for admin access.', 'Go to your home']);
    assert.equal(page.props(page.byTestId('admin-only-notice'))['aria-labelledby'], 'admin-only-title');
    assert.match(page.props(page.byTestId('admin-only-notice')).className, /dark:bg-gray-900/, 'drawn in dark too');
  } finally { await page.close(); }
  const fallback = await mounted(h(AdminOnlyNotice));
  try { assert.deepEqual(fallback.links(), [{ text: 'Go to your home', href: '/studio' }]); } finally { await fallback.close(); }
});

test('the guard: only /admin routes and only non-admin members, after a pending handoff, in place of the redirect', () => {
  // The canonical policy and the pending-handoff check both precede the redirect.
  for (const realRole of ['founder', 'partner', 'investor', 'advisor', 'exploring']) {
    assert.equal(adminRefusal({ pathname: '/admin/kyc', realRole, isImpersonating: false }), true);
  }
  assert.equal(adminRefusal({ pathname: '/admin/kyc', realRole: 'admin', isImpersonating: false }), false);
  assert.equal(adminRefusal({ pathname: '/admin/kyc', realRole: 'founder', isImpersonating: true }), false);
  assert.match(APP, /<Route path="\/admin\/\*" element=\{guard\(\['admin'\], <NotFoundPage \/>\)\} \/>/);
  const guard = APP.slice(APP.indexOf('function RoleGuard('), APP.indexOf('function AuthScreen('));
  const pending = guard.indexOf('const pendingTarget = isImpersonating ? impersonationTargetRef?.current : null;');
  const boundary = guard.indexOf('const boundary = !pendingTarget && ROUTE_BOUNDARIES.find(');
  const drawn = guard.indexOf('if (boundary) return <boundary.Panel home={defaultPath} />;');
  const refused = guard.indexOf('if (adminRefusal(');
  const redirect = guard.indexOf('return <Navigate to={defaultPath} replace />;');
  assert.ok(pending > 0 && pending < boundary && boundary < drawn && drawn < refused && refused < redirect, 'the handoff is read first, and the card is drawn instead of the redirect');
  // The /admin pattern does not catch a neighbour that only starts with the letters.
  const under = /^\/admin(\/|$)/;
  assert.ok(under.test('/admin') && under.test('/admin/kyc') && !under.test('/administrator') && !under.test('/studio'));
});

/** The whole App, mounted at `route` for `member`: where it landed and what it drew. */
async function appAt(member, route) {
  register(new URL('./_airailRender-hook.mjs', import.meta.url));
  const { installAppDom, select } = await import('./_appDom.mjs');
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (input) => {
    const url = String(input?.url || input);
    if (/\/api\/auth\/me(\?|$)/.test(url)) return json(member);
    if (/\/api\/onboarding\/progress(\?|$)/.test(url)) return json({ flow: null, completed_at: '2026-01-01T00:00:00Z' });
    if (/\/api\/dashboard(\?|$)/.test(url)) return json({ user: member, role_view: member.role });
    return json({});
  };
  const dom = installAppDom({ fetch });
  const { useLocation } = await import('react-router-dom');
  const App = (await import('../src/App.jsx')).default;
  // The two cards are lazy in App; loaded now so they resolve in a microtask.
  await import('../src/pages/hq/AdminOnlyNotice.jsx');
  await import('../src/pages/hq/SuperAdminOnlyNotice.jsx');
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('user', JSON.stringify(member));
  let at = null;
  function Landed() { at = useLocation(); return null; }
  const host = dom.document.createElement('div'); dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console; console.error = () => {}; console.warn = () => {};
  try {
    await act(async () => { root.render(h(MemoryRouter, { initialEntries: [route] }, h(App), h(Landed))); });
    for (let i = 0; i < 120; i += 1) {
      await act(() => new Promise((r) => setImmediate(() => setTimeout(r, 5))));
      if (select(dom.document, '[data-testid="admin-only-notice"]').length || (at && at.pathname !== route)) break;
    }
    return {
      landed: at?.pathname,
      boundary: select(dom.document, '[data-testid="admin-only-notice"]').length,
      h1s: select(dom.document, 'h1').map((n) => n.textContent.trim()),
    };
  } finally {
    await act(async () => root.unmount());
    host.remove(); dom.timers.clear(); dom.restore?.();
    console.error = error; console.warn = warn;
  }
}

const settled = { kyc_status: 'approved', access_level: 'full', onboarding_complete: 1, terms_acceptance_pending: false };

test('in the app: a founder on /admin/kyc stays there and reads the card; on another guarded route the redirect stands', async () => {
  // The canonical refusal policy covers the splat as well as named admin pages.
  const founder = { id: 9401, role: 'founder', email: 'founder@d940.test', name: 'Founder D940', ...settled };
  const kyc = await appAt(founder, '/admin/kyc');
  assert.equal(kyc.landed, '/admin/kyc', 'no silent bounce');
  assert.equal(kyc.boundary, 1);
  assert.deepEqual(kyc.h1s, ['This page is for studio admins'], 'one h1 on the page');
  // A named admin page too.
  const trash = await appAt(founder, '/admin/trash');
  assert.equal(trash.landed, '/admin/trash');
  assert.equal(trash.boundary, 1);
  // A route for admins and investors, outside /admin, keeps its redirect for a founder.
  const other = await appAt(founder, '/spinout-lab/investor-workspace');
  assert.notEqual(other.landed, '/spinout-lab/investor-workspace');
  assert.equal(other.boundary, 0);
});

test('in the app: an admin on an /admin address no route names reads Not found, never the member card', async () => {
  // Mutation checked: the /admin/* route given `['admin', 'founder']` → the founder reads Not found, not the card (test above);
  // Admins are admitted by the guard and never receive the member refusal.
  const admin = { id: 9402, role: 'admin', is_super_admin: 0, email: 'admin@d940.test', name: 'Admin D940', ...settled };
  const unknown = await appAt(admin, '/admin/not-a-real-page-d940');
  assert.equal(unknown.landed, '/admin/not-a-real-page-d940');
  assert.equal(unknown.boundary, 0);
  assert.deepEqual(unknown.h1s, ['Page not found']);
  const founder = { ...admin, id: 9403, role: 'founder' };
  const refused = await appAt(founder, '/admin/not-a-real-page-d940');
  assert.equal(refused.boundary, 1);
  assert.deepEqual(refused.h1s, ['This page is for studio admins']);
});
