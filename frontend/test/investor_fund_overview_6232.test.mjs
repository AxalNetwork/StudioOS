/**
 * #6232 — the Fund overview (`/funds`) says what is true:
 *
 *   · Called and Collected are separate lines; no "Contributed" showing called;
 *   · an LP with no recorded commitment reads Not recorded, never $0;
 *   · the LP column is headed for what it shows (LPA);
 *   · the two dead-end sentences say what is true for a GP today;
 *   · every zone link carries `?fund=<id>`, and `?fund=` chooses the fund on load;
 *   · Comms log on the LPs zone scrolls to the log card.
 *
 * Every fund and LP is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_fund_overview_6232.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorFundLanding from '../src/pages/investor/InvestorFundLanding.jsx';
import { collectedLine, fundZoneHref, lpCommitmentText, DISTRIBUTIONS_TODAY, NO_FUND_TODAY } from '../src/pages/investor/investorFundLandingModel.js';
import { zoneSearch } from '../src/workspaces/ZoneNav.jsx';
import { investorZoneActions } from '../src/workspaces/investorZoneActions.js';

const h = React.createElement;
const FUNDS = [
  { id: 3, name: 'Example Fund I', status: 'active', committed_cents: 500000000, called_cents: 120000000, collected_cents: 90000000, capital_reason: null, deployed_cents: 0, distributed_cents: 0, lp_count: 2 },
  { id: 8, name: 'Example Fund II', status: 'active', committed_cents: 100000000, called_cents: 30000000, collected_cents: null, capital_reason: 'No dated capital-call receipts are recorded.', deployed_cents: 0, distributed_cents: 0, lp_count: 1 },
];
const LPS = { 3: [{ id: 1, name: 'Example LP A', commitment_amount: 250000, lpa_signed: 1 }, { id: 2, name: 'Example LP B', commitment_amount: 0, lpa_signed: 0 }], 8: [{ id: 5, name: 'Example LP C', commitment_amount: null, lpa_signed: 0 }] };

async function mount(path, funds = FUNDS) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (/\/api\/funds\/analytics/.test(url)) return json({ items: funds, totals: null, unavailable: {} });
    const lp = /\/api\/funds\/(\d+)\/lps/.exec(url);
    if (lp) return json({ items: LPS[lp[1]] || [] });
    if (/\/api\/capital\/calls/.test(url)) return json([]);
    if (/\/report-periods/.test(url)) return json({ items: [] });
    return json({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(InvestorFundLanding, { fundUnlocked: true }))));
  await act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    href: (id) => props(byId(id)).href ?? byId(id)?.getAttribute?.('href') ?? null,
    select: () => props(byId('select-active-fund')).value,
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, prev); restore(); },
  };
}

// Mutation checked: collectedLine reading called_cents (fails); a null collected read as $0 (fails); the reason dropped (fails).
test('#6232: Collected is its own fact, Not recorded with its reason when no receipt is recorded', () => {
  assert.deepEqual(collectedLine(FUNDS[0]), { value: '$900K', reason: null });
  assert.deepEqual(collectedLine(FUNDS[1]), { value: null, reason: 'No dated capital-call receipts are recorded.' });
  assert.equal(collectedLine({ collected_cents: null }).reason, 'No dated capital-call receipts are recorded.', 'a reason even when the rollup sends none');
  assert.equal(collectedLine({ collected_cents: 0 }).value, '$0', 'a recorded zero is a figure');
});

// Mutation checked: 0 read as a commitment (fails); null read as $0 (fails).
test('#6232: an LP with no recorded commitment reads Not recorded, never $0', () => {
  assert.equal(lpCommitmentText({ commitment_amount: 250000 }), '$250K');
  for (const v of [0, null, undefined, '']) assert.equal(lpCommitmentText({ commitment_amount: v }), null, String(v));
});

// Mutation checked: fundZoneHref dropping the fund (fails); zoneSearch dropping the venture (fails); dropping carry (fails).
test('#6232: a zone link carries the fund, and the zone row keeps the venture beside it', () => {
  assert.equal(fundZoneHref('/funds/lps', 3), '/funds/lps?fund=3');
  assert.equal(fundZoneHref('/funds/lps', ''), '/funds/lps');
  assert.equal(zoneSearch('?project_id=19', null), '?project_id=19', 'without carry, as before');
  assert.equal(zoneSearch('', { fund: 3 }), '?fund=3');
  assert.equal(zoneSearch('?project_id=19&fund=8', { fund: 3 }), '?project_id=19&fund=3');
  assert.equal(zoneSearch('?fund=8', null), '', 'the row carries the fund only when the page says so');
});

// Mutation checked: the landing ignoring ?fund= (fails); a card link without the fund (fails);
// the column still headed KYC / LPA (fails); the old dead-end sentences restored (fails).
test('#6232 mounted: ?fund= picks the fund; every zone link opens on it; the labels say what they show', async () => {
  const v = await mount('/funds?fund=8');
  try {
    assert.equal(String(v.select()), '8', '?fund= chooses the fund on load');
    for (const [id, path] of [['link-fund-lps', '/funds/lps'], ['link-fund-calls', '/funds/calls'], ['link-review-call-ledger', '/funds/calls'], ['link-fund-ledger', '/funds/ledger'], ['link-fund-reporting', '/funds/reporting']]) {
      assert.equal(v.href(id), `${path}?fund=8`, id);
    }
    for (const slug of ['lps', 'calls', 'ledger', 'reporting']) assert.match(String(v.href(`link-zone-${slug}`)), /[?&]fund=8(&|$)/, `zone row: ${slug}`);
    assert.equal(v.textOf('text-fund-collected'), 'Not recorded');
    assert.equal(v.textOf('text-collected-reason'), 'Collected: Not recorded. No dated capital-call receipts are recorded.');
    const t = v.text();
    assert.doesNotMatch(t, /Contributed/);
    assert.doesNotMatch(t, /KYC \/ LPA/);
    assert.match(t, /LPA/);
    assert.match(t, /Example LP C\s*Not recorded/, 'no commitment recorded is Not recorded');
    assert.doesNotMatch(t, /Distribution execution remains/);
    assert.equal(v.textOf('text-distributions-today'), DISTRIBUTIONS_TODAY);
  } finally { await v.close(); }
  const first = await mount('/funds');
  try {
    assert.equal(String(first.select()), '3', 'no ?fund= opens the first fund');
    assert.equal(first.textOf('text-fund-collected'), '$900K');
    assert.equal(first.href('link-fund-lps'), '/funds/lps?fund=3');
    assert.match(first.text(), /Example LP B\s*Not recorded/, 'a 0 commitment is not recorded');
  } finally { await first.close(); }
  const none = await mount('/funds', []);
  try {
    assert.equal(none.textOf('text-no-fund-today'), NO_FUND_TODAY);
    assert.doesNotMatch(none.text(), /Create a fund record in fund administration/);
  } finally { await none.close(); }
});

// Mutation checked: Comms log left unbuilt (fails); the card's anchor removed (fails).
test('#6232: Comms log on the LPs zone takes the reader to the log card', () => {
  let scrolled = 0;
  const actions = investorZoneActions('funds/lps', { handlers: { addLp: () => {}, commsLog: () => { scrolled += 1; } } });
  const comms = actions.find((a) => a?.label === 'Comms log');
  assert.ok(comms && !comms.disabled, 'Comms log is a live op');
  comms.onClick();
  assert.equal(scrolled, 1);
  const lps = readFileSync(new URL('../src/pages/investor/InvestorFundLPs.jsx', import.meta.url), 'utf8');
  assert.match(lps, /handlers: \{ addLp, commsLog \}/);
  assert.match(lps, /getElementById\('comms-log'\)/);
  assert.match(lps, /id="comms-log" data-testid="card-comms-log"/);
});
