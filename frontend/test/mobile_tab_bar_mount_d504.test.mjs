/**
 * D504 — the phone's tab bar is mounted by the shell.
 *
 * D425 shipped `MobileTabBar` and its tests and left the mount to the shell,
 * so phones had a tested bar and no bottom navigation. This pins the three
 * things the mount can get wrong:
 *
 *   - The bar mounted somewhere the drawer can cover it, or twice. It sits
 *     beside the drawer's backdrop, once.
 *   - The role defaulted. The sidebar passes `shellRole || 'founder'` because
 *     a nav with no rows is a broken screen; the bar must NOT, because a
 *     viewer with no role would then get a founder's tabs. The mount passes
 *     the resolved role as it is.
 *   - The header under the status bar. `viewport-fit=cover` (D425) makes the
 *     installed app draw under a phone's status bar, and the top inset is no
 *     longer 0, so the header pads by it.
 *
 *   - The cookie banner over the bar (S1 on #985). Until it is answered the
 *     banner is a fixed z-50 card; at `bottom-4` it covered the bar's z-30,
 *     so the first tap on a tab landed on the banner. It now sits at the
 *     bar's height plus 16px, through the variable D425 left for this.
 *
 * The bar's own behaviour — mounts for a founder below 1024px, nothing for a
 * viewer with no role — is rendered here through the real component, so the
 * mount's contract and the component's agree.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mobile_tab_bar_mount_d504.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import MobileTabBar from '../src/components/MobileTabBar.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = read('frontend/src/App.jsx');
const CODE = codeOnly(APP);
const SIDEBAR = read('frontend/src/sidebarConfig.js');

const renderAs = (role) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/studio'] }, React.createElement(MobileTabBar, { role })),
);

test('the shell mounts the bar once, beside the drawer backdrop, with the resolved role and no founder default', () => {
  assert.match(CODE, /import MobileTabBar from '\.\/components\/MobileTabBar';/);
  assert.equal((CODE.match(/<MobileTabBar /g) || []).length, 1, 'mounted exactly once');
  assert.match(CODE, /<MobileTabBar role=\{shellRole\} \/>/, 'the role is the shell\'s as resolved');
  assert.doesNotMatch(CODE, /<MobileTabBar role=\{shellRole \|\| /, 'no `|| \'founder\'` on the bar: a viewer with no role gets no bar');
  // Beside the backdrop: the mount follows the drawer's backdrop block, inside
  // the same flex container as the aside, so the drawer (z-50) still covers it.
  const backdrop = CODE.indexOf("onClick={() => setSidebarOpen(false)} />");
  const mount = CODE.indexOf('<MobileTabBar role={shellRole} />');
  assert.ok(backdrop > 0 && mount > backdrop && mount - backdrop < 700, 'the bar is mounted right after the drawer backdrop');
  // The sidebar keeps its own default — that one is a nav, not a bar.
  assert.match(CODE, /<SidebarNav groups=\{sidebarGroups\} role=\{shellRole \|\| 'founder'\}/);
});

test('the bar mounts for a founder below 1024px and does not mount for a viewer with no role', () => {
  const founder = renderAs('founder');
  assert.match(founder, /data-testid="mobile-tab-bar"/);
  assert.match(founder, /class="[^"]*\blg:hidden\b/, 'drawn only below the 1024px breakpoint');
  assert.equal(renderAs(undefined), '', 'a viewer with no role gets no bar');
  assert.equal(renderAs(null), '', 'a null role gets no bar');
});

test('the header pads by the top safe-area inset, and the viewport asks for cover', () => {
  const header = CODE.slice(CODE.indexOf('<header className="z-40'), CODE.indexOf('<div className="flex items-center gap-2.5">'));
  assert.ok(header.length > 0 && header.length < 600, 'the header tag is one element');
  assert.match(header, /paddingTop: 'env\(safe-area-inset-top, 0px\)'/);
  assert.match(header, /min-h-14/, 'the 56px row is a minimum, so the box grows by the inset instead of clipping it');
  assert.doesNotMatch(header, /className="(?:[^"]*\s)?h-14[\s"]/, 'a fixed 56px height would clip the inset');
  assert.match(read('frontend/index.html'), /viewport-fit=cover/);
});

test('the FOUNDER_FULL_BLEED comment describes the three legacy routes as the redirects they are (D422)', () => {
  const block = SIDEBAR.slice(SIDEBAR.indexOf('export const FOUNDER_FULL_BLEED'), SIDEBAR.indexOf("'/build/discovery', '/execution', '/build/team', '/signals',"));
  assert.match(block, /Since D422, bare `\/build\/discovery`, `\/execution` and\s*\/\/ `\/signals` are `<Navigate replace>` redirects/);
  assert.doesNotMatch(block, /keep rendering the same desk/, 'the old sentence said they still render the desk');
  // The claim is true of App.jsx: each bare route is a Navigate for a founder.
  assert.match(CODE, /path="\/execution" element=\{guard\(\['admin', 'founder'\], effectiveRole === 'founder' && !founderExecutionEditor\s*\? <Navigate to=\{`\/build\$\{location\.search\}`\} replace \/>/);
  assert.match(CODE, /path="\/signals" element=\{guard\(\[[^\]]*\], founderResearchLanding\s*\? <Navigate to=\{`\/research\$\{location\.search\}`\} replace \/>/);
  const discovery = CODE.slice(CODE.indexOf('path="/build/discovery"'), CODE.indexOf('path="/build/discovery"') + 600);
  assert.match(discovery, /<Navigate to=\{`\/validate\$\{location\.search\}`\} replace \/>/);
});

test('the cookie banner sits above the bar on a phone (S1 on #985): its bottom is the bar\'s height plus 16px, and 16px where there is no bar', async () => {
  // D425 left `--mobile-tabbar-h` for exactly this: set on <html> only while a
  // bar is drawn and only below 1024px (mobileTabBar.css), so a fixed element
  // at `calc(var(--mobile-tabbar-h, 0px) + 16px)` clears the bar on a phone and
  // sits at the old `bottom-4` (16px) everywhere else. Without it the banner
  // (z-50) covered the bar (z-30) until it was answered, so the first tap on a
  // tab landed on the banner.
  const CARD_BOTTOM = "calc(var(--mobile-tabbar-h, 0px) + 16px)";
  const consent = read('frontend/src/components/CookieConsent.jsx');
  const consentCode = codeOnly(consent);
  const card = consentCode.slice(consentCode.indexOf('role="dialog"'), consentCode.indexOf('aria-label="Dismiss"'));
  assert.ok(card.length > 0 && card.length < 900, 'the card element is one tag');
  assert.match(card, new RegExp(`style=\\{\\{ bottom: '${CARD_BOTTOM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' \\}\\}`), 'the card does not offset by the bar\'s height');
  assert.doesNotMatch(card, /\bbottom-\d/, 'a Tailwind bottom-* class would fight the inline offset');
  assert.match(card, /fixed z-50/, 'the card is still the fixed z-50 element D425 measured the bar against');
  // The fallback is what makes the offset harmless off a phone: with no bar
  // the variable is unset, and `var(--x)` with no fallback is an invalid
  // value, which would drop the rule and pin the card to bottom: 0.
  assert.doesNotMatch(card, /var\(--mobile-tabbar-h\)/, 'no fallback: off a phone the card would lose its bottom entirely');
  // The variable the offset reads is the one D425 defines, with the bar's full height.
  const css = read('frontend/src/components/mobileTabBar.css');
  assert.match(css, /:root\[data-mobile-tabbar="on"\] \{\s*--mobile-tabbar-h: calc\(56px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  // Rendered: the undecided banner carries the offset as an inline style.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const { default: CookieConsent } = await import('../src/components/CookieConsent.jsx');
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(CookieConsent)));
    assert.match(html, /aria-labelledby="cookie-consent-title"/, 'the undecided banner is drawn');
    assert.match(html, /style="bottom:calc\(var\(--mobile-tabbar-h, 0px\) \+ 16px\)"/, 'the rendered card does not carry the offset');
  } finally {
    delete globalThis.localStorage;
  }
});
