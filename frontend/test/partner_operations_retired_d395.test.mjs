/**
 * D395 — `/partner/operations/*` retires, and every job it did has a
 * canvas-built home first.
 *
 *   overview      → /company-settings (the firm profile card, now mounted)
 *   capabilities  → /offers/catalog
 *   portfolio     → /delivery/health (founder reviews, D390)
 *   engagements   → /pipeline/proposals (withdraw); the lifecycle and the
 *                   invoice ledger move to /delivery/board
 *   performance   → /pipeline/analytics
 *
 * The redirects are read out of App.jsx, the destinations are proven to be
 * mounted routes a partner may open, and the two new controls (the board's
 * lifecycle, the proposals zone's withdraw) are driven through their own
 * helpers and rendered.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_operations_retired_d395.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { srcFilesWith } from './_srcFilesWith.mjs';
import EngagementLifecycle, {
  lifecycleStepsFor, ledgerLine, runStep,
} from '../src/pages/partner/delivery/EngagementLifecycle.jsx';
import { canWithdraw } from '../src/pages/partner/pipeline/ProposalsZone.jsx';
import { FirmProfileMount } from '../src/pages/CompanySettingsPage.jsx';
import * as partnerKit from '../src/pages/partner/kit.jsx';
import { legacyRedirects } from '../src/workspaces/shellConfig.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = codeOnly(raw('frontend/src/App.jsx'));

/** The one `<Route path="…">` line for a path, or null. */
const routeLine = (path) => APP.split('\n').find(
  (l) => l.includes('<Route') && l.includes(`path="${path}"`),
) || null;

const SUCCESSOR = {
  '/partner/operations': '/company-settings',
  '/partner/operations/overview': '/company-settings',
  '/partner/operations/capabilities': '/offers/catalog',
  '/partner/operations/portfolio': '/delivery/health',
  '/partner/operations/engagements': '/pipeline/proposals',
  '/partner/operations/performance': '/pipeline/analytics',
};

// ── The redirects ───────────────────────────────────────────────────────────

test('D395: every retired address is a replace-redirect to its successor, never a page', () => {
  for (const [from, to] of Object.entries(SUCCESSOR)) {
    const line = routeLine(from);
    assert.ok(line, `${from} has no route — a retired address must redirect, never 404`);
    const m = line.match(/element=\{<Navigate to="([^"]+)" replace \/>\}/);
    assert.ok(m, `${from} is not a replace-redirect: ${line.trim()}`);
    assert.equal(m[1], to, `${from} lands on ${m[1]}, not ${to}`);
  }
  assert.doesNotMatch(APP, /PartnerOperationsWorkspace/, 'the operations workspace is still referenced');
});

test('D395: each destination is a mounted route a partner may open', () => {
  for (const to of new Set(Object.values(SUCCESSOR))) {
    const line = routeLine(to);
    assert.ok(line, `${to} is not a mounted route, so the redirect would land on nothing`);
    assert.doesNotMatch(line, /<Navigate/, `${to} is itself a redirect`);
    assert.match(line, /guard\(\[[^\]]*'partner'[^\]]*\]/, `${to} does not admit a partner`);
  }
});

test('D395: the pages and their kit are deleted, and nothing imports them', () => {
  assert.ok(!existsSync(resolve(process.cwd(), 'frontend/src/pages/partner/operations')),
    'pages/partner/operations is back');
  // An import, static or lazy, of anything under an `operations/` folder.
  assert.deepEqual(srcFilesWith(/(?:from\s+|import\()['"][^'"]*\/operations\//), [],
    'a file still imports from an operations path');
  // The two helpers the zones use live in the partner kit itself now.
  assert.equal(typeof partnerKit.formatDay, 'function');
  assert.equal(typeof partnerKit.moneyDollars, 'function');
  assert.equal(partnerKit.moneyDollars(4800), '$4.8K', 'moneyDollars must still take DOLLARS');
  assert.equal(partnerKit.formatDay(null), '—');
});

test('D395: no link in the product still points at a retired address, except the sidebar match lists', () => {
  // sidebarConfig.js is Session 5's: its `match` entries and full-bleed list
  // name the old paths, keep working through the redirects, and are reported
  // to Session 5 rather than edited here. Every other file must link the
  // successor directly.
  //
  // shellConfig.js's partner zones carry a `legacy:` field naming the address
  // each zone's content came from, and `legacyRedirects()` turns those into
  // from→to pairs. It is called by nothing, but the pairs it would produce
  // for the retired prefix must be App.jsx's own, not a second opinion.
  const linking = srcFilesWith('/partner/operations')
    .filter((f) => !f.endsWith('sidebarConfig.js') && !f.endsWith('shellConfig.js'));
  assert.deepEqual(linking, ['frontend/src/App.jsx'], 'only the redirect lines may name a retired address');
  const pairs = legacyRedirects('partner').filter((r) => r.from.startsWith('/partner/operations'));
  assert.ok(pairs.length > 0, 'no partner zone records where its content came from');
  for (const { from, to } of pairs) {
    assert.equal(to, SUCCESSOR[from], `shellConfig says ${from} → ${to}; App.jsx says ${SUCCESSOR[from]}`);
  }
  const home = codeOnly(raw('frontend/src/pages/partner/PartnerStudioHome.jsx'));
  assert.match(home, /to="\/delivery\/board" testid="module-assigned-tasks"/);
  assert.match(home, /to="\/delivery\/health" testid="module-relationship-health"/);
  assert.match(home, /to="\/delivery\/board" testid="module-delivery-book"/);
  const tabs = codeOnly(raw('frontend/src/pages/partner/PartnerWorkspaceTabs.jsx'));
  assert.match(tabs, /\{ to: '\/pipeline\/retainers', label: 'Retainers'/);
  assert.match(tabs, /\{ to: '\/offers\/proof', label: 'Proof'/);
});

// ── Overview → Firm Settings: the card is mounted ───────────────────────────

test('D395: Company Settings mounts the firm profile card for a partner, above the no-company gate', () => {
  const partner = renderToStaticMarkup(React.createElement(FirmProfileMount, { role: 'partner' }));
  assert.match(partner, /data-testid="firm-profile-mount"/);
  assert.match(partner, /data-testid="partner-firm-profile-card"/, 'the mount is not the card');
  for (const role of ['founder', 'investor', 'advisor', 'admin', undefined]) {
    assert.equal(renderToStaticMarkup(React.createElement(FirmProfileMount, { role })), '',
      `a ${role} sign-in is shown the partner profile`);
  }
  const page = codeOnly(raw('frontend/src/pages/CompanySettingsPage.jsx'));
  const gate = page.slice(page.indexOf('if (!activeCompany) {'), page.indexOf('<CompanyOnRamp'));
  assert.match(gate, /<FirmProfileMount role=\{user\?\.role\} \/>/,
    'a partner with no company never reaches the card');
  const main = page.slice(page.indexOf('<CompanyOnRamp'), page.indexOf('<CompanyHeader'));
  assert.match(main, /<FirmProfileMount role=\{user\?\.role\} \/>/,
    'a partner with a company never reaches the card');
});

// ── Engagements → Board: the lifecycle ──────────────────────────────────────

test('D395: the board offers exactly the transitions the Worker accepts', () => {
  assert.deepEqual(lifecycleStepsFor('accepted'), ['start', 'deliver', 'cancel']);
  assert.deepEqual(lifecycleStepsFor('in_progress'), ['deliver', 'cancel']);
  assert.deepEqual(lifecycleStepsFor('delivered'), ['invoice', 'cancel']);
  assert.deepEqual(lifecycleStepsFor('reviewed'), ['invoice']);
  assert.deepEqual(lifecycleStepsFor('invoiced'), []);
  assert.deepEqual(lifecycleStepsFor('cancelled'), []);
  assert.deepEqual(lifecycleStepsFor(undefined), []);
  // The mirror is of these four guards; if the Worker's move, this must.
  const worker = raw('cloudflare-worker/src/routes/needs.ts');
  const eng = worker.slice(worker.indexOf('async function engTransition'), worker.indexOf("engagementsRouter.post('/:id/start'"));
  assert.match(eng, /if \(e\.status !== 'accepted'\) return c\.json\(\{ detail: `Cannot start/);
  assert.match(eng, /if \(!\['accepted', 'in_progress'\]\.includes\(e\.status\)\) return c\.json\(\{ detail: `Cannot deliver/);
  assert.match(eng, /if \(\['reviewed', 'invoiced', 'cancelled'\]\.includes\(e\.status\)\) return c\.json\(\{ detail: `Cannot cancel/);
  assert.match(eng, /if \(!\['delivered', 'reviewed'\]\.includes\(e\.status\)\) return c\.json\(\{ detail: `Cannot invoice/);
});

test('D395: each step calls its own method, and a blank note is sent as absent', async () => {
  const calls = [];
  const client = new Proxy({}, { get: (_, m) => (...args) => { calls.push([m, ...args]); return Promise.resolve({}); } });
  await runStep(client, 'start', 7);
  await runStep(client, 'deliver', 7, '  handed over  ');
  await runStep(client, 'deliver', 7, '   ');
  await runStep(client, 'invoice', 7);
  await runStep(client, 'cancel', 7, 'scope moved');
  assert.deepEqual(calls, [
    ['startEngagement', 7],
    ['deliverEngagement', 7, { delivery_notes: 'handed over' }],
    ['deliverEngagement', 7, { delivery_notes: undefined }],
    ['invoiceEngagement', 7],
    ['cancelEngagement', 7, { reason: 'scope moved' }],
  ]);
  assert.throws(() => runStep(client, 'pay', 7), /Unknown step/);
});

test('D395: the ledger says issued or awaiting, and never paid', () => {
  assert.equal(ledgerLine({ status: 'invoiced', invoice_id: 'INV-0042', invoiced_at: '2026-09-20T10:00:00Z' }),
    'Invoice INV-0042 · issued Sep 20, 2026');
  assert.equal(ledgerLine({ status: 'invoiced', invoice_id: null, invoiced_at: null }),
    'Invoice issued, no number recorded');
  assert.equal(ledgerLine({ status: 'delivered', delivered_at: '2026-09-18T10:00:00Z' }),
    'Delivered Sep 18, 2026 · awaiting invoice');
  assert.equal(ledgerLine({ status: 'reviewed', delivered_at: null }), 'Delivered · awaiting invoice');
  assert.equal(ledgerLine({ status: 'accepted' }), null);
  assert.equal(ledgerLine({ status: 'in_progress' }), null);
});

test('D395: the section draws each row with only its own steps, and nothing for an empty board', () => {
  const rows = [
    { engagement_id: 1, client: 'Verwood', scope: 'Payments', status: 'accepted' },
    { engagement_id: 2, client: 'Thornfield', status: 'delivered', delivered_at: '2026-09-18T10:00:00Z' },
    { engagement_id: 3, client: null, status: 'invoiced', invoice_id: 'INV-7', invoiced_at: '2026-09-20T10:00:00Z' },
  ];
  const html = renderToStaticMarkup(React.createElement(EngagementLifecycle, { rows, client: {} }));
  const text = renderedText(html);
  assert.match(text, /1 invoiced · 1 awaiting an invoice/);
  assert.match(text, /nothing on this page records that it was paid/);
  const rowsHtml = html.split('data-testid="lifecycle-row"').slice(1);
  assert.equal(rowsHtml.length, 3);
  const buttons = (h) => [...h.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  assert.deepEqual(buttons(rowsHtml[0]), ['Start work', 'Mark delivered', 'Cancel']);
  assert.deepEqual(buttons(rowsHtml[1]), ['Issue invoice', 'Cancel']);
  assert.deepEqual(buttons(rowsHtml[2]), []);
  assert.match(renderedText(rowsHtml[2]), /Client not recorded/);
  assert.match(renderedText(rowsHtml[2]), /Invoice INV-7 · issued/);
  assert.equal(renderToStaticMarkup(React.createElement(EngagementLifecycle, { rows: [] })), '');
  const board = codeOnly(raw('frontend/src/pages/partner/delivery/BoardZone.jsx'));
  assert.match(board, /<EngagementLifecycle rows=\{items\} onChanged=\{load\} \/>/,
    'the board does not mount the lifecycle over its own rows');
});

// ── Engagements → Proposals: withdraw ───────────────────────────────────────

test('D395: a proposal can be withdrawn while it is submitted, and only then', () => {
  assert.equal(canWithdraw({ status: 'submitted' }), true);
  for (const status of ['accepted', 'rejected', 'withdrawn', undefined]) {
    assert.equal(canWithdraw({ status }), false, `${status} offers Withdraw`);
  }
  const zone = codeOnly(raw('frontend/src/pages/partner/pipeline/ProposalsZone.jsx'));
  assert.match(zone, /node: canWithdraw\(r\) \? \(/, 'the Withdraw control is not gated on canWithdraw');
  assert.match(zone, /api\.withdrawQuote\(r\.quote_id\)/, 'Withdraw does not reach the quote route');
  const worker = raw('cloudflare-worker/src/routes/needs.ts');
  assert.match(worker, /if \(q\.status !== 'submitted'\) return c\.json\(\{ detail: 'Only submitted quotes may be withdrawn' \}, 409\);/,
    'the Worker rule this mirrors moved');
});
