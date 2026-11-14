/**
 * D4817 part 8 (#5311, canvas PF-08): the Admin Investor preview of Portfolio.
 *
 * Mounts the WHOLE App (`_appDom.mjs`, as #4849's preview test does) against a
 * stubbed `fetch`, as an administrator who picked Investor in Preview shell,
 * on every Portfolio address, and holds each page to the board:
 *   - exactly one preview banner, saying who is previewed, that it is
 *     read-only, and how to leave; the shell's strip stands down there and
 *     stays on every other page;
 *   - every withheld figure and section carries "Private in preview", never a
 *     0 or an empty book, and no investor record is read;
 *   - no write action is enabled, and the reason is beside the writes;
 *   - the way back works: the shell returns to the administrator's own and
 *     the banner goes;
 *   - a real investor, and an administrator in a support session (View As),
 *     see their own Portfolio with no banner.
 * Plus the pure model (`previewModel.js`).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_preview_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `PortfolioWorkspace` dropping the preview branch (the real boards draw
 *     and read) → tests 1, 2, 3 and 4;
 *   - the frame drawing `banner` twice (a second copy under the nav) → tests 1, 3 and 4;
 *   - `PortalSwitcher` ignoring `pageOwnsPreviewBanner` (strip and banner both
 *     drawn) → test 1;
 *   - `WithheldSection` dropping its chip → test 2;
 *   - `PREVIEW_FIGURES` chip replaced by "$0" in `WithheldPerformance` → test 2;
 *   - an off write drawn without `disabled` → test 3;
 *   - `exitPreview` calling `onViewModeChange('investor')` (no way back) → test 4;
 *   - `isInvestorPreview` ignoring `isImpersonating` → tests 5 and 6;
 *   - `previewBoardOf` answering for `/portfolio/companies/:uid` → test 6;
 *   - the preview board reading `/api/positions` in an effect → test 2;
 *   - App.jsx's `PREVIEW_BANNER_BOARDS` also matching `/portfolio/companies/…` → test 6.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  PREVIEW_BANNER, PRIVATE_IN_PREVIEW, isInvestorPreview, pageOwnsPreviewBanner, previewBoardOf, previewDocTitle, previewExitLabel,
} from '../src/pages/portfolio/previewModel.js';
// #4574 H4 moved these shared modules out of the shell. Preload them as a browser would after their chunks arrive.
await import('../src/ui/index.js');
await import('../src/pages/founder/RecordingView.jsx');

const h = React.createElement;
const settled = { kyc_status: 'approved', access_level: 'full', onboarding_complete: 1, terms_acceptance_pending: false };
const SUPER = { id: 9601, role: 'admin', is_super_admin: 1, email: 'super@pf08.test', name: 'Super PF08', ...settled };
const PLAIN = { id: 9602, role: 'admin', is_super_admin: 0, email: 'admin@pf08.test', name: 'Admin PF08', ...settled };
const INVESTOR = { id: 9603, role: 'investor', email: 'investor@pf08.test', name: 'Investor PF08', ...settled };

const BOARDS = ['/portfolio', '/portfolio/health', '/portfolio/positions', '/portfolio/updates', '/portfolio/performance', '/portfolio/value-add'];
/** The investor records a Portfolio board reads. The preview reads none of them. */
const PRIVATE_READ = /\/api\/(positions|portfolio|portfolio-updates|portfolio-support|reporting\/portfolio)(\/|\?|$)/;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function app(member, { viewMode = null, hq = '1', impersonating = false } = {}, run) {
  register(new URL('./_airailRender-hook.mjs', import.meta.url));
  const { installAppDom, select } = await import('./_appDom.mjs');
  const App = (await import('../src/App.jsx')).default;
  const calls = [];
  const fetch = async (input) => {
    const url = String(input?.url || input);
    calls.push(url);
    if (/\/api\/auth\/me(\?|$)/.test(url)) return json(member);
    if (/\/api\/onboarding\/progress/.test(url)) return json({ flow: null, completed_at: '2026-01-01T00:00:00Z' });
    if (/\/api\/dashboard/.test(url)) return json({ user: member, role_view: viewMode || member.role });
    if (/\/api\/positions\/analytics/.test(url)) return json({ position_count: 0, nav: 0, paid_in: 0, distributed: 0 });
    if (/\/api\/(positions|portfolio|introductions)/.test(url)) return json({ items: [] });
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
    const deadline = performance.now() + 30_000;
    while (!ready() && performance.now() < deadline) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  };
  const read = () => {
    const board = all('[data-testid="portfolio-preview"]')[0] || null;
    const buttons = board ? select(board, 'button') : [];
    return {
      path: at?.pathname,
      banners: all('[data-testid="portfolio-preview-banner"]').length,
      banner: squash(all('[data-testid="portfolio-preview-banner"]').map(textOf).join(' | ')),
      strip: all('[data-testid="preview-shell-strip"]').length,
      board: Boolean(board),
      canvas: all('[data-testid="investor-portfolio-canvas"]').length,
      chips: all('[data-testid="chip-private-in-preview"]').map((n) => squash(textOf(n))),
      text: board ? squash(textOf(board)) : '',
      sections: prefixed('preview-section-').map((n) => ({
        id: n.getAttribute('data-testid'),
        chip: select(n, '[data-testid="chip-private-in-preview"]').length,
      })),
      metrics: prefixed('preview-metric-').map((n) => ({
        id: n.getAttribute('data-testid'),
        chip: select(n, '[data-testid="chip-private-in-preview"]').length,
        value: squash(textOf(select(n, 'b')[0] || n)),
      })),
      enabled: buttons.filter((n) => !props(n).disabled).map((n) => props(n)['data-testid'] || squash(textOf(n))),
      writes: prefixed('button-preview-write-').map((n) => ({ label: squash(textOf(n)), disabled: props(n).disabled === true, why: props(n)['aria-describedby'] })),
      why: squash(walk(dom.document).filter((n) => n.getAttribute('id') === 'pf-preview-writes-why').map(textOf).join(' ')),
      title: dom.document.title,
      privateReads: calls.filter((u) => PRIVATE_READ.test(new URL(u, 'http://localhost').pathname + '?')),
    };
  };
  try {
    return await run({
      async load(route, ready) {
        calls.length = 0;
        await act(async () => { root.render(h(MemoryRouter, { initialEntries: [route], key: `${route}:${Math.random()}` }, h(App), h(Landed))); });
        await wait(() => at?.pathname === route && (ready ? ready(read()) : all('h1').length > 0));
        // Let every effect the page starts settle, so a read it makes is counted.
        for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
        return read();
      },
      async exit() {
        const button = all('[data-testid="button-portfolio-preview-exit"]')[0];
        if (!button) throw new Error('no exit');
        await act(async () => { props(button).onClick({ preventDefault() {}, stopPropagation() {} }); });
        await wait(() => at?.pathname !== '/portfolio');
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

const boardReady = (r) => r.board || r.canvas > 0;

test('1. every Portfolio page in Investor preview draws exactly one banner: who, read-only, the way back; the shell strip stands down only there', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    for (const route of BOARDS) {
      const r = await a.load(route, boardReady);
      assert.equal(r.board, true, `${route}: the preview board draws`);
      assert.equal(r.banners, 1, `${route}: exactly one preview banner, got ${r.banners}`);
      assert.equal(r.strip, 0, `${route}: the shell strip does not draw a second banner`);
      assert.ok(r.banner.includes(PREVIEW_BANNER), `${route}: names the Investor preview and what is withheld`);
      assert.match(r.banner, /Read-only/, `${route}: says it is read-only`);
      assert.match(r.banner, /Back to HQ/, `${route}: offers the way back`);
      assert.match(r.title, / · Investor preview · Axal VC$/, `${route}: the title says Investor preview, got ${r.title}`);
    }
    // Elsewhere in the same preview the shell's own strip is the one banner.
    const studio = await a.load('/studio', (r) => r.strip > 0);
    assert.equal(studio.strip, 1, 'the strip still draws off Portfolio');
    assert.equal(studio.banners, 0, 'and no Portfolio banner there');
  });
});

test('2. withheld records carry "Private in preview": every figure and section, never a 0 or an empty book, and nothing private is read', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    for (const route of BOARDS) {
      const r = await a.load(route, boardReady);
      assert.ok(r.sections.length > 0, `${route}: draws its sections`);
      for (const s of r.sections) assert.equal(s.chip, 1, `${route}: ${s.id} carries the chip`);
      for (const m of r.metrics) {
        assert.equal(m.chip, 1, `${route}: ${m.id} carries the chip`);
        assert.equal(m.value, PRIVATE_IN_PREVIEW, `${route}: ${m.id} reads only the chip, got ${m.value}`);
      }
      assert.ok(r.chips.length >= r.sections.length + r.metrics.length, `${route}: chips on every withheld record`);
      assert.ok(r.chips.every((c) => c === PRIVATE_IN_PREVIEW));
      assert.doesNotMatch(r.text, /\$0|\b0\.00×|No position is recorded/, `${route}: no zero and no empty book for a withheld record`);
      assert.deepEqual(r.privateReads, [], `${route}: no investor record is read`);
    }
    const overview = await a.load('/portfolio', boardReady);
    assert.deepEqual(overview.sections.map((s) => s.id), ['preview-section-attention', 'preview-section-reporting', 'preview-section-value-add', 'preview-section-companies']);
    assert.ok(overview.metrics.some((m) => m.id === 'preview-metric-tvpi'), 'the multiples are drawn, withheld');
  });
});

test('3. no write action is enabled in preview, and the reason sits beside the writes', async () => {
  await app(PLAIN, { viewMode: 'investor' }, async (a) => {
    for (const route of BOARDS) {
      const r = await a.load(route, boardReady);
      assert.deepEqual(r.enabled, ['button-portfolio-preview-exit'], `${route}: the only live button is the way back, got ${JSON.stringify(r.enabled)}`);
      assert.match(r.banner, /Back to HQ’s own accounts/, `${route}: a plain administrator goes back to their own shell`);
    }
    const reports = await a.load('/portfolio/updates', boardReady);
    assert.deepEqual(reports.writes.map((w) => w.label), ['Chase', 'Chase all overdue']);
    const valueAdd = await a.load('/portfolio/value-add', boardReady);
    assert.deepEqual(valueAdd.writes.map((w) => w.label), ['Log support', 'Deliver', 'Withdraw']);
    for (const w of [...reports.writes, ...valueAdd.writes]) {
      assert.equal(w.disabled, true, `${w.label} is off`);
      assert.equal(w.why, 'pf-preview-writes-why', `${w.label} names its reason`);
    }
    assert.match(valueAdd.why, /Writes are disabled in preview/);
  });
});

test('4. the way back works: the shell returns to the administrator\'s own and the banner goes', async () => {
  await app(SUPER, { viewMode: 'investor' }, async (a) => {
    const before = await a.load('/portfolio', boardReady);
    assert.equal(before.banners, 1);
    const after = await a.exit();
    assert.equal(after.viewMode, 'admin', 'the preview ends');
    assert.equal(after.path, '/hq', 'the holder lands on HQ');
    assert.equal(after.banners, 0, 'the banner goes');
    assert.equal(after.board, false, 'the preview board goes');
  });
});

test('5. a real investor, and an administrator in a support session, see their own Portfolio with no preview banner', async () => {
  await app(INVESTOR, {}, async (a) => {
    for (const route of ['/portfolio', '/portfolio/positions']) {
      const r = await a.load(route, (x) => x.canvas > 0 || route !== '/portfolio');
      assert.equal(r.banners, 0, `${route}: an investor gets no preview banner`);
      assert.equal(r.board, false, `${route}: an investor gets the real board`);
    }
  });
  await app(INVESTOR, { viewMode: 'investor', impersonating: true }, async (a) => {
    const r = await a.load('/portfolio', (x) => x.canvas > 0);
    assert.equal(r.banners, 0, 'View As is not a preview');
    assert.equal(r.canvas, 1, 'the support session sees the member\'s own Overview');
  });
});

test('6. the model: who previews, which board an address draws, the one banner, the way back, the title', () => {
  assert.equal(isInvestorPreview({ isAdmin: true, isImpersonating: false, viewMode: 'investor' }), true);
  assert.equal(isInvestorPreview({ isAdmin: true, isImpersonating: true, viewMode: 'investor' }), false, 'a support session is not a preview');
  assert.equal(isInvestorPreview({ isAdmin: false, isImpersonating: false, viewMode: 'investor' }), false, 'an investor is not previewing');
  assert.equal(isInvestorPreview({ isAdmin: true, isImpersonating: false, viewMode: 'founder' }), false);
  assert.equal(isInvestorPreview(null), false);
  assert.deepEqual(BOARDS.map(previewBoardOf), ['overview', 'overview', 'positions', 'updates', 'performance', 'value-add']);
  assert.equal(previewBoardOf('/portfolio/positions/'), 'positions');
  assert.equal(previewBoardOf('/portfolio/companies/acme'), null, 'the company workspace is not a preview board');
  assert.equal(previewBoardOf('/portfolio/waterfall'), null);
  assert.equal(pageOwnsPreviewBanner('/portfolio/updates', 'investor'), true);
  assert.equal(pageOwnsPreviewBanner('/portfolio/updates', 'founder'), false, 'a founder preview keeps the strip');
  assert.equal(pageOwnsPreviewBanner('/portfolio/companies/acme', 'investor'), false, 'a page with no banner keeps the strip');
  assert.equal(previewExitLabel(true), 'Back to HQ');
  assert.equal(previewExitLabel(false), 'Back to HQ’s own accounts');
  assert.equal(previewDocTitle('Positions · Portfolio · Axal VC'), 'Positions · Portfolio · Investor preview · Axal VC');
  assert.equal(previewDocTitle('Portfolio · Axal VC'), 'Portfolio · Investor preview · Axal VC');
  // App.jsx's imports are frozen (D5615), so the strip's copy of the rule lives there: it answers as the model does.
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const source = /const PREVIEW_BANNER_BOARDS = \/(.+)\/;\n/.exec(app);
  assert.ok(source, 'App.jsx holds the strip\'s board list');
  const strip = new RegExp(source[1]);
  for (const path of [...BOARDS, '/portfolio/updates/', '/portfolio/companies/acme', '/portfolio/companies/acme/reports', '/portfolio/waterfall', '/portfolio-x', '/studio', '/deals']) {
    assert.equal(strip.test(path), previewBoardOf(path) !== null, `${path}: the strip and the model agree`);
  }
});
