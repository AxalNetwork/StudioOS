/**
 * D204 — HQ · Support, canvas H22: the three queues, the tenant × queue matrix
 * and the mirror strip, RENDERED rather than matched as source text.
 *
 * Every piece below is pure over its props, so each state is drawn here: a
 * guard that reads the source cannot see a component that stopped drawing — a
 * branch can keep its text and stop running, and only the output notices.
 *
 * The page as a whole loads in an effect, which `renderToStaticMarkup` never
 * runs, so what is pinned about the page itself is read from its source: the
 * one call it makes, what it no longer claims, and the rail's row shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  QUEUE_TITLES, OUTSIDE_BUCKETS, WHY_WORD, SUPPORT_UNAVAILABLE,
  fmtAge, supportBandText, QueueCard, escalationCardProps, ticketCardProps,
  FootingLine, TenantMatrix, SyncStrip, supportCoverage,
} from '../src/pages/hq/HqSupportPage.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = read('frontend/src/pages/hq/HqSupportPage.jsx');
const CODE = codeOnly(PAGE);
const CANVAS = read('design/canvases/integrated/Admin · Super.dc.html');

const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
// Rendered text with the markup removed, for sentence assertions. A scan, not
// a regex replace: see _renderedText.mjs for why (CodeQL alert 6146).
const text = renderedText;

const LAG = 'Not recorded: the mirror runs inside the request that files a ticket, and a ticket keeps only its latest attempt, so no delay between a change and its mirror is stored to average.';

/** The route's payload, in its own shape (routes/admin_hq_support.ts). */
function payload(over = {}) {
  return {
    read_at: '2026-09-23T10:15:00.000Z',
    list_limit: 25,
    total: { value: 10, oldest: { age_hours: 96.2, queue: 'escalations' } },
    escalations: {
      available: true, complete: true, count: 4,
      bands: { ok: 2, due_soon: 1, past: 1 }, oldest_age_hours: 96.2,
      items: [
        { uid: 'e1', branch_code: 'fr', kind: 'other', subject: 'appeal on suspension', sla: 'past', age_hours: 96.2, raised_by_name: 'M. Dupont' },
        { uid: 'e2', branch_code: 'fr', kind: 'seat_increase', subject: 'seat increase', sla: 'due_soon', age_hours: 31.4 },
        { uid: 'e3', branch_code: 'fr', kind: 'moderation', subject: 'flagged profile', sla: 'ok', age_hours: 2.1 },
        { uid: 'e4', branch_code: 'xx', kind: 'other', subject: 'orphan', sla: 'ok', age_hours: 0.4 },
      ],
    },
    tickets: {
      available: true, complete: true, open: 10,
      buckets: {
        hq_held: { count: 2, oldest_age_hours: 18, items: [
          { id: 1, title: 'Data export request', status: 'open', age_hours: 18, requester: 'D. Raghunathan', licence: null },
          { id: 2, title: 'Cannot reach billing', status: 'in_progress', age_hours: 3, requester: 'Investor B', licence: null },
        ] },
        admin_product: { count: 4, oldest_age_hours: 44, items: [
          { id: 4, title: 'Approvals filter loses state', status: 'open', age_hours: 44, requester: 'K. Weber', licence: { uid: 'lic_fr', licence_ref: 'AXL-001', brand_name: 'Axal VC France' } },
        ] },
        hq_staff: { count: 1, oldest_age_hours: 1, items: [{ id: 7, title: 'Staff test ticket', status: 'open', age_hours: 1, requester: 'HQ Staff', licence: null }] },
        account_closed: { count: 1, oldest_age_hours: 70, items: [{ id: 8, title: 'Closed admin asking', status: 'open', age_hours: 70, requester: 'Closed Admin', licence: null }] },
        not_on_record: { count: 2, oldest_age_hours: 2, items: [{ id: 9, title: 'Anonymous report', status: 'open', age_hours: 2, requester: null, licence: null }] },
      },
    },
    matrix: {
      available: true, omitted_terminated: 1,
      rows: [
        { key: 'hq', kind: 'hq', label: 'HQ', licence_ref: null, status: null, branch_code: null,
          escalations: { value: null, why: 'does_not_apply', reason: 'HQ raises no escalation to itself.' },
          hq_held: { value: 2, oldest_age_hours: 18 },
          about_admin: { value: null, why: 'does_not_apply', reason: 'The About-Admin queue is subsidiary administrators.' } },
        { key: 'lic_fr', kind: 'licence', label: 'Axal VC France', licence_ref: 'AXL-001', status: 'active', branch_code: 'fr',
          escalations: { value: 3, oldest_age_hours: 96.2 },
          hq_held: { value: null, why: 'does_not_apply', reason: 'An HQ-held account belongs to no branch, so no licence has one.' },
          about_admin: { value: null, why: 'branch_database', reason: 'Its administrators file on fr.axal.vc, into that branch’s own database, and no branch call returns tickets. 1 filed on axal.vc is in the queue above.' } },
        { key: 'lic_draft', kind: 'licence', label: 'Axal VC Nordics', licence_ref: 'AXL-004', status: 'draft', branch_code: null,
          escalations: { value: null, why: 'does_not_apply', reason: 'No branch is deployed for this licence, so nothing can be raised from it.' },
          hq_held: { value: null, why: 'does_not_apply', reason: 'An HQ-held account belongs to no branch, so no licence has one.' },
          about_admin: { value: 0, oldest_age_hours: null } },
      ],
    },
    sync: { available: true, window_hours: 24, synced: 5, failed: 2, not_configured: 1, lag: { value: null, reason: LAG } },
    ...over,
  };
}

// ─────────────────────────────────────────────── the canvas's own words ──

test('the three queues carry H22’s own names, in H22’s order', () => {
  const at = CANVAS.indexOf('y1Queues: [');
  assert.ok(at > 0, 'the canvas no longer draws y1Queues');
  const block = CANVAS.slice(at, CANVAS.indexOf('y1Matrix:', at));
  const names = [...block.matchAll(/\{ name:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names, Object.values(QUEUE_TITLES));
  assert.deepEqual(Object.keys(QUEUE_TITLES), ['escalations', 'hq_held', 'admin_product']);
});

test('the matrix has H22’s four columns, in order, and HQ is the first row', () => {
  const at = CANVAS.indexOf('<span class="zt">Tenant × queue</span>');
  assert.ok(at > 0);
  const canvasCols = [...CANVAS.slice(at, at + 900).matchAll(/<span class="th">([^<]+)<\/span>/g)].map((m) => m[1]);
  const html = render(TenantMatrix, { matrix: payload().matrix });
  const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  const pageCols = [...head.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(pageCols, canvasCols);
  const firstRow = html.slice(html.indexOf('<tbody>'));
  assert.match(firstRow, /^<tbody><tr[^>]*data-kind="hq"/, 'HQ is not the first row — the table would total more than its rows');
});

test('the band has no switcher caret, because there is no switcher', () => {
  const at = CODE.indexOf('bg-[#881337]');
  assert.ok(at > 0, 'the band is gone');
  const band = CODE.slice(at, CODE.indexOf('</div>', at));
  assert.match(band, />All subsidiaries</);
  assert.doesNotMatch(band, /▾/);
});

// ──────────────────────────────────────────────────────────── the band ──

test('the band says four things and never a total it was not sent', () => {
  assert.equal(supportBandText(null, false), '…');
  assert.equal(supportBandText(null, true), 'unreadable');
  const withheld = payload({ total: { value: null, reason: 'A queue holds more items than one read counts, so a total would be a cut count.' } });
  assert.equal(supportBandText(withheld, false), 'total not recorded');
  assert.equal(supportBandText(payload({ total: { value: 0, oldest: null } }), false), 'Nothing is waiting');
  assert.equal(supportBandText(payload(), false), '10 open · oldest 96h · escalation from fr');
  const ticketOldest = payload({ total: { value: 3, oldest: { age_hours: 44, queue: 'admin_product' } } });
  assert.equal(supportBandText(ticketOldest, false), '3 open · oldest 44h · admin about the Admin product');
  assert.equal(fmtAge(0.3), '<1h');
  assert.equal(fmtAge(null), null);
});

// ────────────────────────────────────────────────────────── the queues ──

test('an escalation keeps its band: due within 24h is not folded into open', () => {
  const props = escalationCardProps(payload(), false);
  assert.deepEqual(props.items.map((x) => x.band), ['past', 'due_soon', 'ok', 'ok']);
  const html = render(QueueCard, props);
  assert.match(text(html), /2 on time · 1 due within 24h · 1 past SLA/);
  assert.match(html, /title="past SLA"[^>]*>96h</);
  assert.match(html, /title="due within 24h"[^>]*>31h</);
  assert.match(html, /bg-red-50[^"]*"[^>]*title="past SLA"/);
  assert.match(html, /bg-amber-100[^"]*"[^>]*title="due within 24h"/);
});

test('a ticket has no SLA, so its age renders without a band, and it opens the ticket', () => {
  const props = ticketCardProps(payload(), false, 'admin_product');
  const html = render(QueueCard, props);
  assert.match(html, /href="\/help\/tickets\/4"/);
  assert.match(html, /title="Tickets carry no due date, so their age has no band\."/);
  assert.doesNotMatch(html, /bg-(?:red|amber|emerald)-/, 'a ticket age borrowed a band nobody set');
  assert.match(text(html), /K\. Weber · AXL-001 · open/);
});

test('a queue has four states, and none of them is a zero it did not count', () => {
  const loading = text(render(QueueCard, escalationCardProps(null, false)));
  assert.match(loading, /Reading the queue…/);

  const failed = text(render(QueueCard, ticketCardProps(null, true, 'hq_held')));
  assert.match(failed, /could not be read/);
  assert.doesNotMatch(failed, /\b0\b/);

  const unread = payload({ tickets: { available: false, reason: 'The ticket queue could not be read on this database, so how many tickets are waiting is unknown — not none.' } });
  const t = text(render(QueueCard, ticketCardProps(unread, false, 'hq_held')));
  assert.match(t, /HQ-held users could not be read\. The ticket queue could not be read/);
  assert.doesNotMatch(t, /Nothing is waiting/, 'an unreadable queue said nothing is waiting');

  const empty = payload();
  empty.tickets.buckets.hq_held = { count: 0, oldest_age_hours: null, items: [] };
  assert.match(text(render(QueueCard, ticketCardProps(empty, false, 'hq_held'))), /Nothing is waiting\./);
});

test('a cut list says it is cut, and a capped count is never shown as the total', () => {
  const html = render(QueueCard, ticketCardProps(payload(), false, 'admin_product'));
  assert.match(text(html), /The 1 oldest of 4 are listed\./);

  const capped = payload();
  capped.escalations = { ...capped.escalations, complete: false, count: null, bands: null };
  const c = text(render(QueueCard, escalationCardProps(capped, false)));
  assert.match(c, /Not counted/);
  assert.match(c, /The 4 oldest are listed; the rest are more than one read counts\./);
  assert.doesNotMatch(c, /on time ·/, 'bands were drawn from a cut read');
  assert.doesNotMatch(c, /Escalations from subsidiaries4/, 'the length of the cut list was shown as the count');
});

test('the queues foot to HQ Home’s backlog, and say so', () => {
  const t = text(render(FootingLine, { tickets: payload().tickets }));
  assert.match(t, /2 HQ-held \+ 4 about the Admin product \+ 1 from HQ staff \+ 1 from closed accounts \+ 2 with no account on record = 10 open tickets/);
  assert.deepEqual(OUTSIDE_BUCKETS.map(([k]) => k), ['hq_staff', 'account_closed', 'not_on_record']);
  const cut = payload().tickets;
  cut.complete = false; cut.open = null;
  assert.match(text(render(FootingLine, { tickets: cut })), /not totalled here/);
  assert.equal(render(FootingLine, { tickets: { available: false, reason: 'x' } }), '');
});

// ────────────────────────────────────────────────────────── the matrix ──

test('a blank cell says why in words, numbered, and never as a dash', () => {
  const html = render(TenantMatrix, { matrix: payload().matrix });
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const cells = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => text(m[1]).trim());
  assert.ok(cells.every((c) => !/^[—–-]$/.test(c)), 'a matrix cell rendered a bare dash');
  assert.ok(cells.includes('3 · 96h'), 'a counted cell lost its oldest age');
  assert.ok(cells.includes('0'), 'a measured zero was not drawn');
  assert.ok(cells.some((c) => c.startsWith(WHY_WORD.branch_database)), 'the deployed licence’s About-Admin cell is not “On the branch”');
  const notes = text(html.slice(html.indexOf('data-testid="hq-support-matrix-notes"')));
  assert.match(notes, /fr\.axal\.vc, into that branch’s own database/);
  assert.match(notes, /HQ raises no escalation to itself\./);
  assert.match(text(html), /1 terminated licence has nothing open and is not listed\./);
});

test('an unreadable ledger is unreadable, not an empty table', () => {
  const t = text(render(TenantMatrix, { matrix: { available: false, reason: 'The licence ledger could not be read on this database.' } }));
  assert.match(t, /The licence ledger could not be read\./);
  assert.doesNotMatch(t, /Branch.*Escalations/);
});

// ─────────────────────────────────────────────────────── the sync strip ──

test('the mirror strip shows two counts and a lag it says it does not have', () => {
  const html = render(SyncStrip, { sync: payload().sync });
  const t = text(html);
  assert.match(t, /Synced · 24h5/);
  assert.match(t, /Failed · 24h2/);
  assert.match(t, /Average lagNot recorded/);
  assert.ok(t.includes(LAG), 'the lag’s reason is not shown on the page');
  assert.match(t, /1 attempt found no GitHub token configured\./);
  assert.match(html, /href="\/admin\?tab=github"/);
  assert.match(t, /P2 console is not built/);
  const missing = text(render(SyncStrip, { sync: { available: false, reason: 'The mirror status could not be read on this database. Its columns arrive with migration 273.' } }));
  assert.match(missing, /migration 273/);
  assert.doesNotMatch(missing, /Synced/);
});

// ──────────────────────────────────────────────────────────── the rail ──

test('the rail’s coverage is one line per read that answered, and none for one that failed', () => {
  assert.deepEqual(supportCoverage(null), []);
  const all = supportCoverage(payload());
  assert.equal(all.length, 4);
  assert.match(all[0], /^4 open escalations/);
  assert.match(all[1], /^10 open tickets/);
  const partial = supportCoverage(payload({ escalations: { available: false, reason: 'x' }, sync: { available: false, reason: 'y' } }));
  assert.equal(partial.length, 2);
  assert.ok(partial.every((l) => !/escalation|Mirror/.test(l)), 'a failed read still wrote a coverage line');
});

test('every rail row is a [title, detail] pair, and the retired refusal is gone', () => {
  for (const r of SUPPORT_UNAVAILABLE) {
    assert.ok(Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'string' && x.length > 10),
      'a rail row is not a [title, detail] pair');
  }
  assert.doesNotMatch(CODE, /No ticket persona separates/);
  assert.doesNotMatch(CODE, /not a separate store yet/);
  assert.ok(SUPPORT_UNAVAILABLE.some(([t]) => /overlay/.test(t)), 'the view-as overlay’s scope is not stated');
});

// ──────────────────────────────────────────────────────────── the page ──

test('the page makes one read, the Support route, and never falls back to a zero', () => {
  assert.equal((CODE.match(/api\.\w+\(/g) || []).join(','), 'api.hqSupport(');
  assert.doesNotMatch(CODE, /\|\|\s*0\b/, 'a count falls back to zero');
  assert.doesNotMatch(CODE, /from '\.\.\/\.\.\/pages\//, 'the page imports a routed page');
  const api = read('frontend/src/lib/api.js');
  assert.equal((api.match(/hqSupport: \(\) => request\('\/admin\/hq-support'\)/g) || []).length, 1);
});

test('HQ Home’s Queue backlog points at the desk that splits it', () => {
  const home = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
  const at = home.indexOf('label="Queue backlog"');
  assert.ok(at > 0);
  const tile = home.slice(at, home.indexOf('/>', home.indexOf('tone=', at)));
  assert.match(tile, /<Link to="\/admin\/hq-support"/);
});
