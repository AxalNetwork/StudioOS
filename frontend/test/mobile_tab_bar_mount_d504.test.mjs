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
 *   - The first bar under the status bar. `viewport-fit=cover` (D425) makes
 *     the installed app draw under a phone's status bar, and the top inset is
 *     no longer 0, so the shell's root reserves it — the root, not the header,
 *     because on an admin's phone PortalSwitcher and the strips render before
 *     the header (Codex on #1039). The header keeps its fixed 56px.
 *
 *   - The footer under the bar (Codex on #1039). D425's clearance padded the
 *     content block; the footer renders after it, so at the end of the scroll
 *     its Terms and Privacy row sat under the bar. The clearance is on the
 *     scroll container now.
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

test('the shell root reserves the top safe-area inset, the header keeps its fixed 56px, and the viewport asks for cover', () => {
  const INSET = "paddingTop: 'env(safe-area-inset-top, 0px)'";
  // The inset is on the shell's root, once. The root is the column every
  // strip renders in, so whichever bar is first — PortalSwitcher on an
  // admin's phone, a support or impersonation strip, the header — sits below
  // the status bar. Codex on #1039 found the first draft's inset on the header
  // alone, which left those earlier bars under the status bar.
  const rootAt = CODE.indexOf('<div className="flex flex-col h-screen overflow-hidden');
  assert.ok(rootAt > 0, 'the shell root is gone');
  const root = CODE.slice(rootAt, CODE.indexOf('>', rootAt) + 1);
  assert.ok(root.length < 300, 'the root tag is one element');
  assert.match(root, new RegExp(`style=\\{\\{ ${INSET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\}\\}`), 'the shell root does not reserve the top inset');
  assert.equal(CODE.split(INSET).length - 1, 1, 'the inset is reserved exactly once: a second one (on the header, say) would open a gap of two insets');
  for (const first of ['<SafeMount name="HqSupportSessionBar">', '<PortalSwitcher', '<SafeMount name="BranchNotDeployedBar">', '<header className="z-40']) {
    assert.ok(CODE.indexOf(first) > rootAt, `${first} renders outside the root that carries the inset`);
  }
  // The header is back to a fixed 56px row with no inset of its own. A
  // `min-h-14` with the inset as padding is border-box: a 20px inset left a
  // 36px row (Codex on #1039). With the inset on the root the row is just 56px.
  const header = CODE.slice(CODE.indexOf('<header className="z-40'), CODE.indexOf('<div className="flex items-center gap-2.5">'));
  assert.ok(header.length > 0 && header.length < 600, 'the header tag is one element');
  assert.match(header, /className="z-40 h-14 /, 'the header row is not a fixed 56px');
  assert.doesNotMatch(header, /min-h-14|safe-area-inset-top/, 'the header carries the inset itself: its 56px minimum would absorb it');
  assert.match(read('frontend/index.html'), /viewport-fit=cover/);
});

test('the tab bar\'s clearance is on the scroll container, so the footer after the page content clears the bar too (Codex on #1039)', () => {
  // D425 padded `[data-app-main]`, the content block, so as not to touch the
  // shell. The footer renders AFTER that block inside <main>, so at the end
  // of the scroll the footer's Terms and Privacy row sat under the bar. The
  // clearance now pads <main> itself, marked `data-app-scroll`; the footer is
  // the last thing in it, so it ends above the bar.
  const mainAt = CODE.indexOf('<main');
  const mainTag = CODE.slice(mainAt, CODE.indexOf('>', mainAt) + 1);
  assert.match(mainTag, /^<main\s+data-app-scroll\s/, 'the scroll container is not marked for the clearance');
  assert.match(mainTag, /overflow-y-auto/, 'the marked element is not the scroll container');
  assert.equal((CODE.match(/data-app-scroll/g) || []).length, 1, 'the mark is on one element');
  const mainEnd = CODE.indexOf('</main>', mainAt);
  const content = CODE.indexOf('data-app-main', mainAt);
  const footer = CODE.indexOf('<footer', mainAt);
  assert.ok(content > mainAt && footer > content && footer < mainEnd, 'the footer is not after the page content inside the scroll container');
  const css = read('frontend/src/components/mobileTabBar.css');
  assert.match(css, /:root\[data-mobile-tabbar="on"\] \[data-app-scroll\] \{\s*padding-bottom: var\(--mobile-tabbar-h\);\s*\}/, 'the scroll container is not padded by the bar\'s height');
  assert.doesNotMatch(css, /\[data-app-main\][^\n{]*\{/, 'the content block is still padded: the footer after it sits under the bar, or the page gets two clearances');
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
