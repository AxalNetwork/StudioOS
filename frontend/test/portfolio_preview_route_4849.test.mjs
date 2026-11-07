/**
 * #4849 (P0): in Super Admin → Preview shell → Investor, `/portfolio` must draw
 * the Portfolio workspace, never the Investor Studio home.
 *
 * The live report: the shell said "Previewing · Investor shell" with Portfolio
 * selected, the URL said /portfolio, and the body was `InvestorStudioHome`
 * ("Studio", "Investor", "private investor records are withheld"). Route,
 * navigation and content disagreed.
 *
 * This mounts the WHOLE App (`_appDom.mjs`, as D781 and D940 do) as an admin
 * previewing the investor shell, and holds each route to its own surface:
 *   - every Portfolio address draws Portfolio, direct, on refresh and after
 *     navigating from Studio and back, with the HQ view on and off;
 *   - the API answering empty, refused or failing never swaps in another workspace;
 *   - the other licence-owned investor workspaces are held to the same rule;
 *   - a real investor session still draws its own Portfolio;
 *   - a founder previewing /portfolio is never given the investor's Studio.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_preview_route_4849.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

const h = React.createElement;
const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const settled = { kyc_status: 'approved', access_level: 'full', onboarding_complete: 1, terms_acceptance_pending: false };
const SUPER = { id: 9501, role: 'admin', is_super_admin: 1, email: 'super@p4849.test', name: 'Super P4849', ...settled };
const PLAIN = { id: 9502, role: 'admin', is_super_admin: 0, email: 'admin@p4849.test', name: 'Admin P4849', ...settled };
const INVESTOR = { id: 9503, role: 'investor', email: 'investor@p4849.test', name: 'Investor P4849', ...settled };
const FOUNDER = { id: 9504, role: 'founder', email: 'founder@p4849.test', name: 'Founder P4849', ...settled };

/** The Studio home's own marks: the page title and the preview line. */
const STUDIO = '[data-testid="text-investor-studio-title"]';
/** What each Portfolio address reads as its page heading. */
const PORTFOLIO_ROUTES = {
  '/portfolio': 'Know how my investments are doing',
  '/portfolio/health': 'Know how my investments are doing',
  '/portfolio/positions': 'Positions book',
  '/portfolio/updates': 'Updates & KPI collection',
  '/portfolio/performance': 'Portfolio',
  '/portfolio/value-add': 'Value-add desk',
};
/** Other workspaces a licence owns, and what each reads as. */
const OTHER_ROUTES = {
  '/deals': 'Deal flow',
  '/trust/me': 'Trust',
  '/spinout-lab/investor-workspace': 'Axal VC Fund',
  '/network': 'Work my relationships',
  '/research': 'Go deep before money moves',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The whole App for `member`, in `viewMode`, with the API answering `api`. `run(go)` drives it. */
async function app(member, { viewMode = null, hq = '1', api = 'empty' } = {}, run) {
  register(new URL('./_airailRender-hook.mjs', import.meta.url));
  const { installAppDom, select } = await import('./_appDom.mjs');
  const App = (await import('../src/App.jsx')).default;
  const fetch = async (input) => {
    const url = String(input?.url || input);
    if (/\/api\/auth\/me(\?|$)/.test(url)) return json(member);
    if (/\/api\/onboarding\/progress/.test(url)) return json({ flow: null, completed_at: '2026-01-01T00:00:00Z' });
    const bad = api === 'refused' ? 403 : api === 'failing' ? 500 : 0;
    if (/\/api\/dashboard/.test(url)) return bad ? json({ detail: 'x' }, bad) : json({ user: member, role_view: viewMode || member.role });
    if (/\/api\/(positions|portfolio|introductions)/.test(url)) return bad ? json({ detail: 'x' }, bad) : json({ items: [] });
    return json({});
  };
  const dom = installAppDom({ fetch });
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('user', JSON.stringify(member));
  if (viewMode) localStorage.setItem('viewMode', viewMode);
  localStorage.setItem('hqView', hq);
  let at = null, navigate = null;
  function Landed() { at = useLocation(); navigate = useNavigate(); return null; }
  const host = dom.document.createElement('div'); dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console; console.error = () => {}; console.warn = () => {};
  const tick = async (n = 40) => { for (let i = 0; i < n; i += 1) await act(() => new Promise((r) => setImmediate(() => setTimeout(r, 5)))); };
  const read = () => ({
    path: at?.pathname,
    studio: select(dom.document, STUDIO).length,
    canvas: select(dom.document, '[data-testid="investor-portfolio-canvas"]').length,
    h1: select(dom.document, 'h1').map((n) => n.textContent.trim()),
    links: select(dom.document, 'a').map((n) => n.getAttribute?.('href')).filter(Boolean),
  });
  try {
    return await run({
      /** A direct load, as a refresh is. */
      async load(route) {
        await act(async () => { root.render(h(MemoryRouter, { initialEntries: [route], key: `${route}:${Math.random()}` }, h(App), h(Landed))); });
        await tick(); return read();
      },
      /** A client-side move, as a click in the shell is. */
      async go(route) { await act(async () => { navigate(route); }); await tick(); return read(); },
      read,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove(); dom.timers.clear(); dom.restore?.();
    console.error = error; console.warn = warn;
  }
}

test('1. Super Admin → Investor preview: every Portfolio address draws Portfolio, on a direct load and after Studio, never the Studio home', async () => {
  // Mutation checked: the `/portfolio` route given `<Dashboard activeRole={effectiveRole} authUser={user} />` → the root draws "Studio" and this fails.
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    for (const [route, heading] of Object.entries(PORTFOLIO_ROUTES)) {
      const direct = await a.load(route);
      assert.equal(direct.path, route, `${route}: no bounce`);
      assert.equal(direct.studio, 0, `${route}: the Studio home is not drawn`);
      assert.ok(direct.h1.includes(heading), `${route}: reads "${heading}", got ${JSON.stringify(direct.h1)}`);
    }
    // From Studio and back: a client-side move lands on the requested workspace each time.
    const studio = await a.load('/studio');
    assert.equal(studio.studio, 1, 'Studio is Studio');
    for (const route of ['/portfolio', '/portfolio/positions', '/portfolio/updates', '/portfolio', '/portfolio/health']) {
      const moved = await a.go(route);
      assert.deepEqual([moved.path, moved.studio], [route, 0], `${route}: after Studio`);
      assert.ok(moved.h1.includes(PORTFOLIO_ROUTES[route]), `${route}: reads its own heading after a move`);
    }
    assert.equal((await a.go('/studio')).studio, 1, 'and Studio is still Studio');
  });
});

test('2. the root is the I4 overview, not a withheld-records stub: it draws the Portfolio canvas', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    for (const route of ['/portfolio', '/portfolio/health']) {
      const r = await a.load(route);
      assert.equal(r.canvas, 1, `${route} draws InvestorPortfolioCanvas`);
    }
  });
});

test('3. the HQ view and a plain admin change nothing: Portfolio stays Portfolio', async () => {
  for (const [member, hq] of [[SUPER, '0'], [PLAIN, '1']]) {
    await app(member, { viewMode: 'investor', hq }, async (a) => {
      for (const route of ['/portfolio', '/portfolio/positions']) {
        const r = await a.load(route);
        assert.deepEqual([r.path, r.studio], [route, 0], `${member.name} hq=${hq} ${route}`);
        assert.ok(r.h1.includes(PORTFOLIO_ROUTES[route]));
      }
    });
  }
});

test('4. an empty, refused or failing API never swaps another workspace in for Portfolio', async () => {
  // Mutation checked: the canvas's error path given the Studio home → refused and failing reads draw "Studio".
  for (const api of ['empty', 'refused', 'failing']) {
    await app(SUPER, { viewMode: 'investor', api }, async (a) => {
      for (const route of ['/portfolio', '/portfolio/health', '/portfolio/positions']) {
        const r = await a.load(route);
        assert.deepEqual([r.path, r.studio], [route, 0], `${api}: ${route}`);
        assert.ok(r.h1.includes(PORTFOLIO_ROUTES[route]), `${api}: ${route} reads its own heading`);
      }
    });
  }
});

test('5. the same class, checked across the other licence-owned investor workspaces', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    for (const [route, heading] of Object.entries(OTHER_ROUTES)) {
      const r = await a.load(route);
      assert.equal(r.studio, 0, `${route}: the Studio home is not drawn`);
      assert.ok(r.h1.includes(heading), `${route}: reads "${heading}", got ${JSON.stringify(r.h1)}`);
    }
  });
});

test('6. a real investor session still draws its own Portfolio, and Studio is still Studio', async () => {
  await app(INVESTOR, {}, async (a) => {
    for (const route of ['/portfolio', '/portfolio/positions']) {
      const r = await a.load(route);
      assert.deepEqual([r.path, r.studio], [route, 0]);
      assert.ok(r.h1.includes(PORTFOLIO_ROUTES[route]));
    }
    assert.equal((await a.load('/studio')).studio, 1);
  });
});

test('7. previewing another role never hands /portfolio the investor\'s Studio', async () => {
  for (const viewMode of ['founder', 'partner']) {
    await app(SUPER, { viewMode }, async (a) => {
      const r = await a.load('/portfolio');
      assert.equal(r.studio, 0, `${viewMode} preview of /portfolio`);
    });
  }
});

test('8. every Portfolio address is mounted by PortfolioWorkspace inside the one investor wrapper, which hands its children through', () => {
  // The route table is where a substitution would be written.
  for (const route of Object.keys(PORTFOLIO_ROUTES)) {
    const line = APP.split('\n').find((l) => l.includes(`<Route path="${route}"`));
    assert.ok(line, `${route} is routed`);
    assert.match(line, /investorWorkspace\('portfolio', <PortfolioWorkspace activeRole=\{effectiveRole\} \/>\)/, `${route} mounts the Portfolio workspace`);
    assert.doesNotMatch(line, /<Dashboard|InvestorStudioHome/, `${route} never names the Studio home`);
  }
  const page = readFileSync(new URL('../src/pages/investor/InvestorWorkspacePage.jsx', import.meta.url), 'utf8');
  assert.match(page, /if \(key === 'portfolio' && children\) return children;/, 'the wrapper hands Portfolio its own page');
});
