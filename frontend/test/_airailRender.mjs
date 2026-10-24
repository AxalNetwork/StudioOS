/**
 * D781 (#2106) part 2 — EACH MAPPED ROUTE DRAWS EXACTLY ONE RAIL, WITH ITS
 * PAGE KEY IN THE DOM.
 *
 * Part 1 (`airail_every_page_d781.test.mjs`) checks that the three parts of
 * D720 reach every canvas page: the page map names its key, the matrix has
 * its row, the rail draws the switch. It reads files. This module renders.
 *
 * WHAT IS RENDERED. The real App, inside a `MemoryRouter`, at every route in
 * D768's page map (`RAIL_PAGES`, `frontend/src/lib/railPages.js`), signed in
 * as a member of the route's profile: the shell, its guard, the route's own
 * element and `RailPageProvider`, the way a browser mounts them. Effects run,
 * lazy pages load, redirects are followed. `_appDom.mjs` is the document.
 *
 * WHAT IT READS. Every `<aside class="fwr …">` in the document is one rail,
 * and its `data-page-key` is the page key the shell's provider gave it
 * (`WorkerRail.jsx`). A route passes when exactly one rail is drawn and its
 * key is the page map's key for where the app landed (`pageKeyFor`), which is
 * the route itself unless the route redirects.
 *
 * THE WORKER IS NOT CALLED. The session and the onboarding progress answer as
 * a finished member's would; `FIXTURES` answers what a page needs before it
 * draws anything; every other request answers in one of two states, tried in
 * this order:
 *   · `down`: 503. The page cannot read its data.
 *   · `empty`: 200 `{}`. The page read nothing.
 * A route passes if a state draws its rail; a second rail, or a rail with
 * another page's key, in any state tried fails it. A page whose rail waits for real
 * data adds the smallest payload that gets it there to `FIXTURES`, in the PR
 * that wires it.
 *
 * THE RATCHET. `RENDER_NOT_YET` lists every route that does not pass, as
 * `<Profile> <route>`, under the board task that finishes it (#2097–#2101) or,
 * for a page the canvas does not draw, under `offCanvas`. A route that is not
 * listed must pass; a listed route that passes must be deleted from the list.
 * The rules are pure (`renderStatus`, `renderRatchet`) and are run on
 * fixtures in `airail_every_page_d781.test.mjs`; the six
 * `airail_render_*_d781.test.mjs` files render one profile each, so `node
 * --test` runs them side by side.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NO_RAIL_ROUTES, RAIL_PAGES, pageKeyFor } from '../src/lib/railPages.js';

/** The task that finishes each profile's boards (part 1's `BOARD_TASK`). */
export const RENDER_TASK = {
  Founder: '2097', Investor: '2098', Advisor: '2099', 'Operating Partner': '2099', Admin: '2100', 'Super Admin': '2101',
};

/** The member each profile renders as: a finished account, nothing pending. */
const settled = { kyc_status: 'approved', access_level: 'full', onboarding_complete: 1, terms_acceptance_pending: false };
export const MEMBERS = {
  Founder: { id: 9101, role: 'founder', email: 'founder@d781.test', name: 'Founder D781', ...settled },
  Investor: { id: 9102, role: 'investor', email: 'investor@d781.test', name: 'Investor D781', investor_tier: 'institutional', ...settled },
  Advisor: { id: 9103, role: 'advisor', email: 'advisor@d781.test', name: 'Advisor D781', ...settled },
  'Operating Partner': { id: 9104, role: 'partner', email: 'partner@d781.test', name: 'Partner D781', ...settled },
  Admin: { id: 9105, role: 'admin', is_super_admin: 0, email: 'admin@d781.test', name: 'Admin D781', ...settled },
  'Super Admin': { id: 9106, role: 'admin', is_super_admin: 1, email: 'hq@d781.test', name: 'HQ D781', ...settled },
};

/**
 * What a request answers before the state does: `[pattern, (member) => body]`.
 * The first two are the session; the rest are pages that draw nothing until
 * their data arrives, each with the least that gets their rail drawn.
 */
export const FIXTURES = [
  [/\/api\/auth\/me(\?|$)/, (m) => m],
  [/\/api\/onboarding\/progress(\?|$)/, () => ({ flow: null, completed_at: '2026-01-01T00:00:00Z' })],
  // The Studio dashboard (`pages/Dashboard.jsx`) draws a spinner, then an
  // error card, until `/dashboard` returns its `user`.
  [/\/api\/dashboard(\?|$)/, (m) => ({ user: m, role_view: m.role })],
];

/** `<Profile> <route>`: how a route is named in `RENDER_NOT_YET`. */
export const caseName = (profile, route) => `${profile} ${route}`;

/** Every route in the page map, by profile, with its key and whether the canvas draws it. */
export function renderCases(pages = RAIL_PAGES) {
  return Object.entries(pages).flatMap(([profile, entries]) => entries.map((p) => ({
    profile, route: p.route, key: p.key, offCanvas: !!p.offCanvas, name: caseName(profile, p.route),
  })));
}

/**
 * One route's verdict from what each state drew: `[{ state, rails, keys,
 * landed, expected }]`, in the order tried. `pass` when a state drew exactly
 * one rail with the landed page's key and no state drew a second rail or a
 * wrong key.
 */
export function renderStatus(drawn) {
  const why = [];
  let pass = false;
  for (const d of drawn) {
    const keys = d.keys || [];
    // Owner-requested rail-free pages are rendered too: assert absence rather
    // than classifying an intentional removal as unfinished work.
    if (d.expectedRails === 0) {
      if (keys.length) why.push(`${d.state}: ${keys.length} rails on a page that should have none`);
      else if (d.escaped?.length) why.push(`${d.state}: the rail-free page threw while rendering`);
      else if (d.pageRendered) pass = true;
      continue;
    }
    if (keys.length > 1) why.push(`${d.state}: ${keys.length} rails`);
    const wrong = keys.filter((k) => k !== d.expected);
    if (wrong.length) why.push(`${d.state}: a rail keyed ${wrong.map((k) => JSON.stringify(k)).join(', ')} at ${d.landed}, which is ${JSON.stringify(d.expected)}`);
    if (keys.length === 1 && !wrong.length) pass = true;
  }
  if (why.length) return { pass: false, why };
  return pass ? { pass: true, why: [] } : { pass: false, why: drawn.map((d) => d.expectedRails === 0 ? `${d.state}: no page content at ${d.landed}` : `${d.state}: no rail at ${d.landed}`) };
}

/**
 * The ratchet's findings; empty when the list is exactly the routes that do
 * not pass. `verdicts` maps a case's name to its `renderStatus`; `inScope`
 * says which listed names this run judges (a profile's file, its own).
 */
export function renderRatchet(cases, notYet, verdicts, inScope = () => true) {
  const problems = [];
  const listed = new Map();
  for (const [group, names] of Object.entries(notYet)) {
    for (const name of names) {
      if (listed.has(name)) problems.push(`${name}: listed twice`);
      listed.set(name, group);
    }
  }
  const byName = new Map(cases.map((c) => [c.name, c]));
  for (const [name, group] of listed) {
    const c = byName.get(name);
    if (!c) {
      if (inScope(name)) problems.push(`${name}: listed, but the page map has no such route`);
      continue;
    }
    const owner = c.offCanvas ? 'offCanvas' : RENDER_TASK[c.profile];
    if (group !== owner) problems.push(`${name}: listed under ${group}; it belongs under ${owner}`);
  }
  for (const c of cases) {
    const v = verdicts.get(c.name);
    if (!v) continue;
    if (v.pass && listed.has(c.name)) problems.push(`${c.name}: draws its rail now, so delete it from RENDER_NOT_YET`);
    if (!v.pass && !listed.has(c.name)) problems.push(`${c.name}: ${v.why.join('; ')}, and not in RENDER_NOT_YET`);
  }
  return problems;
}

/**
 * The routes that do not yet draw exactly one rail with their page key, under
 * the task that finishes each, or `offCanvas` for a page the canvas does not
 * draw. Delete a line when its route passes; never add one.
 */
export const RENDER_NOT_YET = {
  2097: [
    'Founder /studio',
    'Founder /studio/tickets/new',
    'Founder /validate/inbox',
    'Founder /build/team',
    'Founder /build/marketplace',
    'Founder /build/brand',
    'Founder /raise/legal-engine',
  ],
  2098: [
    'Investor /studio',
    'Investor /funds/performance',
  ],
  2099: [
  ],
  2100: [
    'Admin /branch',
    'Admin /admin/fund-admin',
    'Admin /admin/programs/spinout-lab/applications',
    'Admin /admin/spinout-moderation',
    'Admin /admin/programs/spinout-lab',
    'Admin /admin/wellbeing',
  ],
  2101: [
    'Super Admin /admin/fund-admin',
    'Super Admin /admin/revenue/disputes',
  ],
  offCanvas: [
    'Founder /spinout-lab',
    'Founder /profile',
    'Founder /deals',
    'Founder /portfolio',
    'Founder /pipeline',
    'Founder /messages',
    'Founder /help',
    'Founder /pricing',
    'Founder /trust',
    'Founder /calendar',
    'Founder /my/events',
    'Founder /referrals',
    'Founder /company-settings',
    'Founder /updates',
    'Founder /studio/archetype',
    'Investor /build/competitors',
    'Investor /messages',
    'Investor /help',
    'Investor /pricing',
    'Investor /trust',
    'Investor /calendar',
    'Investor /my/events',
    'Investor /referrals',
    'Investor /company-settings',
    'Investor /updates',
    'Investor /studio/archetype',
    'Investor /wellbeing',
    'Investor /projects',
    'Advisor /messages',
    'Advisor /help',
    'Advisor /pricing',
    'Advisor /trust',
    'Advisor /calendar',
    'Advisor /my/events',
    'Advisor /referrals',
    'Advisor /company-settings',
    'Advisor /updates',
    'Advisor /studio/archetype',
    'Operating Partner /partner/relationships',
    'Operating Partner /build/competitors',
    'Operating Partner /raise/legal-engine',
    'Operating Partner /deals',
    'Operating Partner /messages',
    'Operating Partner /help',
    'Operating Partner /pricing',
    'Operating Partner /trust',
    'Operating Partner /calendar',
    'Operating Partner /my/events',
    'Operating Partner /referrals',
    'Operating Partner /company-settings',
    'Operating Partner /updates',
    'Operating Partner /studio/archetype',
    'Admin /admin/commissions',
    'Admin /admin/accounts/credits',
    'Admin /exploring',
    'Admin /messages',
    'Admin /help',
    'Admin /pricing',
    'Admin /trust',
    'Admin /calendar',
    'Admin /my/events',
    'Admin /referrals',
    'Admin /company-settings',
    'Admin /updates',
    'Admin /studio/archetype',
    'Super Admin /admin/accounts/credits',
    'Super Admin /exploring',
    'Super Admin /messages',
    'Super Admin /help',
    'Super Admin /pricing',
    'Super Admin /trust',
    'Super Admin /calendar',
    'Super Admin /my/events',
    'Super Admin /referrals',
    'Super Admin /company-settings',
    'Super Admin /updates',
    'Super Admin /studio/archetype',
  ],
};

const SETTLE_MS = 10;
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every file under `frontend/src` that some module imports with `import('./…')`. */
function lazyModules() {
  const out = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.isFile() || !/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
        const base = resolve(dirname(p), m[1]);
        // Only named here; the import below opens it, and a file gone by then stays lazy.
        const hit = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js'].map((e) => base + e)
          .find((f) => statSync(f, { throwIfNoEntry: false })?.isFile());
        if (hit) out.add(hit);
      }
    }
  };
  walk(SRC);
  return [...out].sort();
}

/**
 * A renderer: `draw(profile, route, state)` mounts App there and returns
 * `{ state, rails, keys, landed, expected }`. `close()` stops the app's timers.
 */
export async function railRenderer() {
  register(new URL('./_airailRender-hook.mjs', import.meta.url));
  const { installAppDom, select } = await import('./_appDom.mjs');
  let member = null;
  let state = 'down';
  let inFlight = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const answer = (url) => {
    for (const [pattern, body] of FIXTURES) if (pattern.test(url)) return json(body(member));
    return state === 'down' ? json({ error: 'D781 render: the Worker is not called' }, 503) : json({});
  };
  const fetch = async (input) => {
    inFlight += 1;
    try {
      await null;
      return answer(String(input?.url || input));
    } finally {
      inFlight -= 1;
    }
  };
  const dom = installAppDom({ fetch });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, useLocation } = await import('react-router-dom');
  const App = (await import('../src/App.jsx')).default;
  // Every module the app loads lazily, loaded now: a lazy page then resolves
  // in a microtask, and how long a cold import takes on a busy runner cannot
  // decide whether a page drew its rail in time.
  for (const file of lazyModules()) {
    try { await import(pathToFileURL(file).href); } catch { /* a module that cannot load under node stays lazy */ }
  }

  let at = null;
  function Landed() {
    const l = useLocation();
    at = l;
    return null;
  }
  // React reports what a page does with a stub's answer (a refusal, a missing
  // field) on console.error. The verdict is the DOM's; the noise is not kept.
  const quiet = () => {};
  const wait = () => new Promise((r) => { setImmediate(() => globalThis.setTimeout(r, SETTLE_MS)); });

  async function draw(profile, route, nextState) {
    member = MEMBERS[profile];
    state = nextState;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('user', JSON.stringify(member));
    const host = dom.document.createElement('div');
    dom.document.body.appendChild(host);
    const root = createRoot(host);
    const { error, warn } = console;
    console.error = quiet;
    console.warn = quiet;
    // A page that leaves a refused request uncaught (with the Worker down,
    // several do) raises an unhandled rejection, which `node --test` counts
    // against whichever test is running. That is the page's own bug and not
    // this check's finding: while App is mounted, the runner's listeners
    // step aside and what fires is kept on the verdict, then they return.
    const escaped = [];
    const held = ['unhandledRejection', 'uncaughtException'].map((event) => [event, process.listeners(event)]);
    for (const [event] of held) process.removeAllListeners(event);
    const keep = (e) => { escaped.push(String(e?.message || e)); };
    process.on('unhandledRejection', keep);
    process.on('uncaughtException', keep);
    try {
      await act(async () => {
        root.render(React.createElement(MemoryRouter, { initialEntries: [route] },
          React.createElement(App), React.createElement(Landed)));
      });
      // Settled when three ticks in a row change nothing. App's own Suspense
      // fallback ("Loading…" before a lazy page arrives) is never settled:
      // it is waited out for up to five seconds, the rest for up to one.
      let last = '';
      let same = 0;
      for (let i = 0; i < 500 && same < 3; i += 1) {
        await act(wait);
        const fallback = select(dom.document, 'div.h-screen').some((d) => d.textContent.trim() === 'Loading…');
        if (!fallback && i >= 100) break;
        const sig = `${at?.pathname}${at?.search}${at?.hash}|${select(dom.document, 'aside.fwr').length}|${host.textContent.length}`;
        same = !fallback && inFlight === 0 && sig === last ? same + 1 : 0;
        last = sig;
      }
      // Rejections land after the microtasks they ride on; one more tick holds them here.
      await act(wait);
      const rails = select(dom.document, 'aside.fwr');
      const landed = `${at?.pathname ?? ''}${at?.search ?? ''}${at?.hash ?? ''}`;
      const path = (at?.pathname ?? '').replace(/\/$/, '');
      const noRail = NO_RAIL_ROUTES.find((n) => (n.route === path || (n.prefix && path.startsWith(`${n.route}/`)))
        && n.roles.includes(MEMBERS[profile]?.role));
      return {
        state: nextState,
        escaped,
        rails: rails.length,
        keys: rails.map((a) => a.getAttribute('data-page-key')),
        landed,
        expected: pageKeyFor(at?.pathname ?? '', profile, { search: at?.search ?? '', hash: at?.hash ?? '' }),
        expectedRails: noRail?.railCount ?? 1,
        pageRendered: noRail?.pageTestIds?.some((id) => select(dom.document, `[data-testid="${id}"]`).length > 0) ?? false,
      };
    } finally {
      await act(async () => root.unmount());
      host.remove();
      await wait();
      process.removeListener('unhandledRejection', keep);
      process.removeListener('uncaughtException', keep);
      for (const [event, listeners] of held) for (const l of listeners) process.on(event, l);
      console.error = error;
      console.warn = warn;
    }
  }

  /** Every state, in order, until one passes. */
  async function verdict(profile, route) {
    const drawn = [];
    for (const s of ['down', 'empty']) {
      drawn.push(await draw(profile, route, s));
      if (renderStatus(drawn).pass) break;
    }
    return { ...renderStatus(drawn), drawn };
  }

  return { draw, verdict, close: () => dom.timers.clear() };
}

/**
 * The render check for one profile's routes: each is drawn, judged, and the
 * verdicts held against `RENDER_NOT_YET`. One test, so its message lists
 * every finding at once.
 */
export function renderProfile(profile) {
  test(`every ${profile} route draws its expected rail count and page key`, async () => {
    const cases = renderCases().filter((c) => c.profile === profile);
    assert.ok(cases.length > 0, `the page map has ${profile} routes`);
    const renderer = await railRenderer();
    const verdicts = new Map();
    try {
      for (const c of cases) verdicts.set(c.name, await renderer.verdict(c.profile, c.route));
    } finally {
      renderer.close();
    }
    assert.deepEqual(renderRatchet(cases, RENDER_NOT_YET, verdicts, (name) => name.startsWith(`${profile} `)), []);
  });
}
