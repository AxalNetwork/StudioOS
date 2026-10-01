/**
 * D375 — HQ · Funds against the Funds · Fabric canvas's F6 (oversight, all
 * funds, read-only) and F10 (honesty states).
 *
 * The canvas is a proposal. This pins what the page takes from it and what it
 * refuses to draw:
 *
 *   1. each artboard and its data model, sliced at both ends, so a heading or
 *      a label moving out of the artboard fails here rather than matching
 *      something elsewhere in the file;
 *   2. F6's eight table headings and five stats, and F10's five GP-of-record
 *      labels and its block title, each mapped to what the page draws;
 *   3. every F6 element with no store — AUM, jurisdiction, HQ economics,
 *      TVPI, a filing deadline, a report's lateness — printed with the
 *      Worker's own reason, never a figure;
 *   4. the flags from the database, "Not reported" (never "clear") for a
 *      branch on an earlier build, and Unreadable (never 0%) for a failed read;
 *   5. none of the canvas's sample data, and no /admin/fabric alias.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_funds_fabric_d375_contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  FUND_COLUMNS, GP_FIELD_LABELS, FundsTable, OversightStats, FlagFeed, HonestyStates,
  calledCell, dpiCell, fundFlags, flagFeed, oversightStats,
} from '../src/pages/hq/HqFundsPage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = read('design/canvases/backlog/Funds · Fabric.dc.html');
const PAGE_SRC = read('frontend/src/pages/hq/HqFundsPage.jsx');
const PAGE = codeOnly(PAGE_SRC);
const APP = codeOnly(read('frontend/src/App.jsx'));

function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}
const F6 = between(CANVAS, '<section class="ab" id="f6">', '<!-- ══════════ F7 · LAUNCH A FUND');
const F6_DATA = between(CANVAS, '// ── F6 ──', '// ── F7 ──');
const F10 = between(CANVAS, '<section class="ab" id="f10">', '</section>');
const F10_DATA = between(CANVAS, '// ── F10 ──', 'issueNote:');

const ENTITY = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const text = (h) => h.replace(/<[^>]+>/g, ' ')
  .replace(/&(?:#x27|quot|amp|lt|gt);/g, (e) => ENTITY[e]).replace(/\s+/g, ' ').trim();

/* A payload with every state: HQ on the current build, one branch whose call
 * lines failed, one on an earlier build, one unreadable. The Worker's reasons
 * are sentinels, so the test can see each is the one printed. */
const NR = {
  platform_aum: 'NR-AUM: no fund records a currency.',
  jurisdiction: 'NR-JUR: nothing records a jurisdiction.',
  hq_economics: 'NR-ECON: revenue per subsidiary stays not recorded.',
  tvpi: 'NR-TVPI: no fund-level valuation.',
  obligations: 'NR-OBL: no obligation store.',
  report_cadence: 'NR-CAD: no cadence is stored.',
};
const flags = (over) => ({
  no_gp_of_record: false, custodian_recorded: true, gp_fields_unset: [], lpa_on_file: true, draft_not_issued: null, ...over,
});
const fund = (over) => ({
  id: 1, name: 'Harbor Fund I', status: 'investing', gp_entity: 'Harbor GP LLC', vintage_year: 2024,
  jurisdiction: null, gp_entity_jurisdiction: null,
  committed_minor: 1_000_000_000, committed_source: 'fund_size_cents',
  last_issued: { period: '2026-Q2', period_end: '2026-06-30', issued_at: '2026-07-14T10:00:00Z' },
  called_minor: 300_000_000, called_ratio: 0.3, distributed_minor: 60_000_000, dpi: 0.2, flags: flags(), ...over,
});
const READS = { complete: true, periods_available: true, calls_available: true, distributions_available: true, entities_available: true };
const PAYLOAD = {
  read_at: '2026-09-28T10:00:00Z',
  hq: { code: 'hq', status: 'ok', data: { ...READS, funds: [
    // A warn flag on the FIRST fund, so worst-first is a sort and not the fixture's order.
    fund({ flags: flags({ custodian_recorded: false }) }),
    fund({ id: 2, name: 'Ridge Fund II', status: 'fundraising', gp_entity: null, vintage_year: null,
      committed_minor: null, committed_source: null, called_minor: 0, called_ratio: null, distributed_minor: 0, dpi: null,
      last_issued: null,
      flags: flags({ no_gp_of_record: true, custodian_recorded: false, lpa_on_file: false,
        gp_fields_unset: ['gp_name', 'gp_title', 'gp_entity', 'fund_admin', 'auditor'],
        draft_not_issued: { period: '2026-Q3', period_end: '2026-09-30' } }) }),
  ] } },
  branches: [
    { code: 'uk', status: 'ok', label: 'Branch UK', data: { ...READS, calls_available: false, calls_reason: 'CALLS-GONE',
      funds: [fund({ id: 1, name: 'Moor Fund I', gp_entity: 'Harbor GP LLC', called_minor: undefined, called_ratio: undefined,
        dpi: undefined, flags: flags({ gp_fields_unset: ['auditor'] }) })] } },
    // A branch on a build from before D375: the registry's D245 fields only.
    { code: 'de', status: 'ok', label: 'Branch DE', data: { complete: true, periods_available: true,
      funds: [{ id: 1, name: 'Linde Fund I', status: 'investing', gp_entity: 'Linde GP GmbH', committed_minor: 500_000_000,
        committed_source: 'fund_size_cents', last_issued: null }] } },
    { code: 'es', status: 'unreadable', label: 'Branch ES', reason: 'timed out' },
  ],
  branches_coverage: { total: 3, answered: 2, complete: false, unreadable: ['es'] },
  committed_unit: { recorded: false, reason: 'currency not recorded' },
  total: { shown: false, reason: 'no total' },
  open_in_branch: { built: false, reason: 'not built' },
  not_recorded: NR,
};
const render = (C) => renderToStaticMarkup(createElement(C, { payload: PAYLOAD }));
const ALL = renderToStaticMarkup(createElement(Fragment, null,
  createElement(OversightStats, { payload: PAYLOAD }), createElement(FundsTable, { payload: PAYLOAD }),
  createElement(FlagFeed, { payload: PAYLOAD }), createElement(HonestyStates, { payload: PAYLOAD })));

/* ------------------------------------------------------------------ */

test('D375: F6\'s eight headings, each mapped to the page\'s column in the same place', () => {
  const table = between(F6, 'Every fund on the platform', '{{ ovNote }}');
  const heads = [...table.matchAll(/<span class="th">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Tenant', 'Fund', 'Jur', 'Vintage', 'Size', 'Called', 'DPI / TVPI', 'Flags']);
  // Tenant is a branch here; Jur is spelled out; Size is the committed figure.
  const AS = { Tenant: 'Branch', Jur: 'Jurisdiction', Size: 'Committed' };
  assert.deepEqual(heads.map((h) => AS[h] || h), FUND_COLUMNS);
});

test('D375: F6\'s five stats, in the canvas\'s order', () => {
  const ks = [...F6_DATA.slice(F6_DATA.indexOf('ovStats:'), F6_DATA.indexOf('].map')).matchAll(/\{ k:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ks, ['Platform AUM', 'Funds', 'GP entities', 'HQ accrued', 'Open flags']);
  const html = render(OversightStats);
  const drawn = [...html.matchAll(/data-testid="hq-funds-stat"><div[^>]*>([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(drawn, ks);
});

test('D375: F10\'s GP-of-record labels and its block title are the page\'s', () => {
  const labels = [...F10_DATA.slice(F10_DATA.indexOf('emptyGP:'), F10_DATA.indexOf('blockTitle:')).matchAll(/k:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.values(GP_FIELD_LABELS), labels);
  assert.deepEqual(Object.keys(GP_FIELD_LABELS), ['gp_name', 'gp_title', 'gp_entity', 'fund_admin', 'auditor'],
    'the page\'s field keys are not the registry\'s GP_RECORD_FIELDS');
  assert.ok(F10.includes('{{ blockTitle }}') && F10_DATA.includes("blockTitle: 'LPA issue is blocked'"));
  assert.match(text(render(HonestyStates)), /Fund with no GP of record Ridge Fund II · HQ · fundraising GP name Not recorded Title Not recorded GP entity Not recorded Fund administrator Not recorded Auditor Not recorded LPA issue is blocked/);
});

test('D375: every F6 element with no store prints the Worker\'s reason, never a figure', () => {
  for (const [k, reason] of Object.entries(NR)) assert.ok(ALL.includes(reason), `the page does not print not_recorded.${k}`);
  const stats = text(render(OversightStats));
  assert.match(stats, /^Platform AUM Not recorded NR-AUM/);
  assert.match(stats, /HQ accrued Not recorded brand-licence share/);
  // The canvas's jurisdiction count is not invented.
  assert.match(stats, /GP entities 2 jurisdictions: Not recorded/);
  assert.match(text(render(FlagFeed)), /Filing deadlines: Not recorded \. NR-OBL/);
});

test('D375: the flags are the database\'s, worst first, and each canvas flag the store can raise is raised', () => {
  const feed = flagFeed(PAYLOAD);
  assert.deepEqual(feed.map((f) => `${f.tone}:${f.what}`), [
    'bad:No GP of record',
    'warn:Custodian not recorded',
    'warn:2026-Q3 report drafted, not issued',
    'warn:Custodian not recorded',
    'warn:GP of record facts not recorded',
    'warn:GP of record facts not recorded',
  ]);
  assert.equal(feed[0].detail, 'blocks LPA issue');
  assert.equal(feed[1].who, 'Harbor Fund I · HQ');
  assert.equal(feed[5].who, 'Moor Fund I · Branch UK');
  assert.equal(feed[5].detail, 'Auditor');
  // The canvas's four flags: three are raised from stores; the fourth (a
  // filing deadline) has no store and is the Not recorded line above.
  const canvasFlags = [...F6_DATA.matchAll(/\{ what:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(canvasFlags, ['No GP of record', 'Franchise tax due in 9 days', 'Q3 report drafted, not issued', 'Custodian not recorded']);
  const html = text(render(FlagFeed));
  assert.ok(html.includes('No GP of record') && html.includes('report drafted, not issued') && html.includes('Custodian not recorded'));
  assert.doesNotMatch(html, /Franchise tax due|days past cadence/, 'a deadline or a lateness nobody records was drawn');
});

test('D375: a branch on an earlier build is "Not reported", never "clear" and never counted as clean', () => {
  const de = PAYLOAD.branches[1].data.funds[0];
  assert.equal(fundFlags(de), null);
  const row = text(renderToStaticMarkup(createElement(FundsTable, { payload: { ...PAYLOAD, hq: { code: 'hq', status: 'ok', data: { ...READS, funds: [] } }, branches: [PAYLOAD.branches[1]] } })));
  assert.match(row, /Branch DE Linde Fund I .* Not reported Not reported 5,000,000\.00 Not reported Not reported \/ Not recorded Not reported$/);
  assert.doesNotMatch(row, /\bclear\b/);
  assert.equal(oversightStats(PAYLOAD).unreported, 1);
  assert.match(text(render(OversightStats)), /Open flags 6 1 not reported/);
});

test('D375: a failed call read is Unreadable, never 0% — and no committed figure is Not recorded, not 0%', () => {
  const uk = PAYLOAD.branches[0].data;
  assert.deepEqual(calledCell(uk.funds[0], uk), { kind: 'unreadable', reason: 'CALLS-GONE' });
  assert.equal(dpiCell(uk.funds[0], uk).kind, 'unreadable');
  const hq = PAYLOAD.hq.data;
  assert.deepEqual(calledCell(hq.funds[0], hq), { kind: 'value', text: '30%' });
  assert.equal(calledCell(hq.funds[1], hq).kind, 'unrecorded');
  assert.deepEqual(dpiCell(hq.funds[0], hq), { kind: 'value', text: '0.20×' });
  assert.equal(dpiCell(hq.funds[1], hq).kind, 'unrecorded', 'a DPI over nothing called was drawn');
  assert.equal(dpiCell(hq.funds[0], { ...hq, distributions_available: false, distributions_reason: 'D' }).kind, 'unreadable');
  assert.deepEqual(calledCell(fund({ called_ratio: 0.125 }), hq), { kind: 'value', text: '12.5%' });
  const table = text(render(FundsTable));
  assert.match(table, /Branch UK Moor Fund I .* Unreadable Unreadable \/ Not recorded/);
  assert.doesNotMatch(table, /\b0%/, 'a percentage of zero was drawn for a read that failed or a figure nobody recorded');
});

test('D375: the stats count only what answered — distinct GP entities, funds with a committed figure', () => {
  const s = oversightStats(PAYLOAD);
  assert.equal(s.funds, 4, 'the unreadable branch was counted');
  assert.equal(s.withCommitted, 3);
  // Harbor GP LLC runs a fund at HQ and one in the UK: one entity.
  assert.equal(s.gpEntities, 2, 'a fund with no GP entity was counted, or one was counted twice');
  assert.equal(s.openFlags, 6);
  assert.equal(s.coverage, 'of 3 branches, 2 answered');
});

test('D375: none of the canvas\'s sample data, and none of the words the programme forbids', () => {
  for (const sample of ['Axal France', 'Nordics', 'EUR', '16.2', '25 Feb 2026', 'Franchise tax due in 9 days', 'as of 25 Feb']) {
    assert.ok(!PAGE.includes(sample), `the page source carries the canvas sample ${sample}`);
    assert.ok(!ALL.includes(sample), `the page draws the canvas sample ${sample}`);
  }
  assert.doesNotMatch(PAGE_SRC + ALL, /\bForge\b|fiduciar|\badvice\b|\badvisor\b|recommendation/i);
  assert.doesNotMatch(PAGE, /\|\|\s*0\b|\?\?\s*0\b/, 'a figure falls back to zero');
});

test('D375: one WorkerRail, and no /admin/fabric alias — the redirect set stays pinned', () => {
  assert.equal(PAGE.match(/<WorkerRail\b/g).length, 1);
  assert.ok(!APP.includes('/admin/fabric'), 'an /admin/fabric route appeared');
  assert.match(read('frontend/test/admin_route_reachability.test.mjs'), /assert\.deepEqual\(REDIRECTS, \['\/admin\/news'\],/);
});
