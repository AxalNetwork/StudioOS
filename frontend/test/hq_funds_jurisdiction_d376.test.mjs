/**
 * D376 — HQ · Funds reads a fund's jurisdiction from its linked vehicle entity
 * and counts the jurisdictions of the linked GP entities (migration 314).
 *
 * The Worker half is cloudflare-worker/test/fabric_entities_d376.test.ts. This
 * pins the page: a linked jurisdiction is drawn; an unlinked fund is Not
 * recorded with the Worker's reason; a failed entities read is Unreadable; a
 * branch on an earlier build is Not reported; and the GP entities stat counts
 * jurisdictions only from linked GP entities, falling back to Not recorded.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_funds_jurisdiction_d376.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FundsTable, OversightStats, jurisdictionCell, oversightStats } from '../src/pages/hq/HqFundsPage.jsx';

const ENTITY = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const text = (h) => h.replace(/<[^>]+>/g, ' ')
  .replace(/&(?:#x27|quot|amp|lt|gt);/g, (e) => ENTITY[e]).replace(/\s+/g, ' ').trim();

const REASON = 'NR-JUR: link a vehicle entity.';
const READS = { complete: true, periods_available: true, calls_available: true, distributions_available: true, entities_available: true };
const fund = (over) => ({
  id: 1, name: 'Harbor Fund I', status: 'investing', gp_entity: 'Harbor GP LLC', vintage_year: 2024,
  committed_minor: 100_00, committed_source: 'fund_size_cents', last_issued: null,
  called_minor: 0, called_ratio: 0, distributed_minor: 0, dpi: null,
  jurisdiction: 'KY', gp_entity_jurisdiction: 'US-DE',
  flags: { no_gp_of_record: false, custodian_recorded: true, gp_fields_unset: [], lpa_on_file: true, draft_not_issued: null },
  ...over,
});
const payload = (hqFunds, extra = {}) => ({
  hq: { code: 'hq', status: 'ok', data: { ...READS, funds: hqFunds, ...extra } },
  branches: [], branches_coverage: { total: 0, answered: 0 },
  not_recorded: { jurisdiction: REASON, platform_aum: 'a', hq_economics: 'b', tvpi: 'c', obligations: 'd', report_cadence: 'e' },
});

test('D376: the Jurisdiction cell draws a linked jurisdiction, and each absence as its own state', () => {
  assert.deepEqual(jurisdictionCell(fund(), READS, REASON), { kind: 'value', text: 'KY' });
  assert.deepEqual(jurisdictionCell(fund({ jurisdiction: null }), READS, REASON), { kind: 'unrecorded', reason: REASON });
  assert.deepEqual(jurisdictionCell(fund(), { ...READS, entities_available: false, entities_reason: 'GONE' }, REASON),
    { kind: 'unreadable', reason: 'GONE' });
  assert.equal(jurisdictionCell(fund({ jurisdiction: undefined }), READS, REASON).kind, 'not_reported');
});

test('D376: the table prints the linked jurisdiction in its column, and the Worker\'s reason for an unlinked fund', () => {
  const linked = text(renderToStaticMarkup(createElement(FundsTable, { payload: payload([fund()]) })));
  assert.match(linked, /HQ Harbor Fund I investing · Harbor GP LLC Last issued: None issued KY 2024 /);
  const unlinked = renderToStaticMarkup(createElement(FundsTable, { payload: payload([fund({ jurisdiction: null })]) }));
  assert.match(text(unlinked), /Last issued: None issued Not recorded 2024 /);
  assert.ok(unlinked.includes(REASON), 'the Worker\'s reason is not the one on the cell');
});

test('D376: GP entities counts jurisdictions from linked GP entities only, distinct', () => {
  const funds = [
    fund(),
    fund({ id: 2, name: 'Harbor Fund II', gp_entity_jurisdiction: 'US-DE' }),
    fund({ id: 3, name: 'Ridge Fund I', gp_entity: 'Ridge GP SAS', gp_entity_jurisdiction: 'FR' }),
    fund({ id: 4, name: 'Unlinked Fund', gp_entity: 'Loose GP Ltd', gp_entity_jurisdiction: null }),
  ];
  const s = oversightStats(payload(funds));
  assert.equal(s.gpEntities, 3);
  assert.equal(s.jurisdictions, 2, 'a jurisdiction was counted twice, or an unlinked GP was counted');
  assert.match(text(renderToStaticMarkup(createElement(OversightStats, { payload: payload(funds) }))),
    /GP entities 3 across 2 jurisdictions, from linked GP entities/);
});

test('D376: with no GP entity linked, the count is Not recorded with the Worker\'s reason — never "0 jurisdictions"', () => {
  const html = renderToStaticMarkup(createElement(OversightStats, {
    payload: payload([fund({ gp_entity_jurisdiction: null, jurisdiction: null })]),
  }));
  assert.match(text(html), /GP entities 1 jurisdictions: Not recorded/);
  assert.doesNotMatch(text(html), /\b0 jurisdictions?\b/);
  assert.ok(html.includes(REASON));
});
