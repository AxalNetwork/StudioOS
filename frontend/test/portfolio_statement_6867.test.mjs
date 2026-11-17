/**
 * D6867 (#6867, canvas D6217 PF-13): the investor's shareable statement — a
 * gross PDF of the book as of a chosen completed quarter-end, opened as a
 * sheet from Overview and Performance.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_statement_6867.test.mjs
 *
 * The model (`statementModel.js`), the renderer drawn against the recording
 * jsPDF stub (`portfolioStatementPdf.js`), and the real sheet mounted on
 * Performance against a stubbed `fetch`.
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `statementDatesOf` listing the quarter-ends oldest first → test 1;
 *   - `mismatchOf` returning null when the totals differ → test 2;
 *   - `fundedAfter` ignoring `vintage` → test 2;
 *   - `returnText` drawing an unavailable IRR as its raw value (null → 0%) → test 3;
 *   - `statementOf` producing a statement when two quarter-ends failed → test 4;
 *   - `statementOf` producing a statement over a failed positions read → test 4;
 *   - the renderer dropping "Gross of fees and carry" from a page head → test 5;
 *   - the watermark drawn on page 1 only → test 6;
 *   - the cover note printed without "the investor’s own words" → test 6;
 *   - the positions table not repeating its header on a continuation page → test 7;
 *   - Performance printing its own methodology list instead of `METHODOLOGY` → tests 8 and 11;
 *   - the sheet calling the exporter on a date with no book → test 9;
 *   - the sheet passing the cover note when the box is not ticked → test 10;
 *   - Performance ignoring `?as_of=` → test 11.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { createPdfStub } from './_pdf-stub.mjs';
import {
  METHODOLOGY, NET_RETURNS, STATEMENT_BASIS, fundedAfter, mismatchOf, noBookAt, previewOf, statementDatesOf,
  statementOf, summaryRowsOf,
} from '../src/pages/portfolio/statementModel.js';
import { pdfText, renderPortfolioStatement } from '../src/lib/portfolioStatementPdf.js';
import StatementSheet from '../src/pages/portfolio/StatementSheet.jsx';
import InvestorPortfolioPerformance from '../src/pages/investor/InvestorPortfolioPerformance.jsx';

const h = React.createElement;
const ok = (value) => ({ state: 'ok', value });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ------------------------------------------------------------- the book */

const COMPLIANCE = { cadence: 'quarterly', as_of: '2026-11-14', period_until: '2026-09-30', period_complete: true, companies: [] };

const POS = (over = {}) => ({
  items: [
    { project_id: 1, project: { name: 'Company A', sector: 'Robotics', stage: 'Series A' }, total_invested: 2000000, rounds: 2, latest_round: 'Series A', latest_ownership_pct: 8.5, vintage: 2025, latest_date: '2026-03-01', fmv: 5200000, multiple: 2.6, mark_as_of: '2026-09-30', mark_basis: 'round_price', unmarked: false, mark_unavailable_reason: null },
    { project_id: 2, project: { name: 'Company E', sector: 'Fintech', stage: 'Series A' }, total_invested: 1250000, rounds: 1, latest_round: 'Series A', latest_ownership_pct: 5, vintage: 2025, latest_date: '2025-06-01', fmv: 600000, multiple: 0.48, marked_down: true, mark_as_of: '2026-09-30', mark_basis: 'write_down', unmarked: false, mark_unavailable_reason: null },
    { project_id: 3, project: { name: 'Company F', sector: 'Data', stage: 'Seed' }, total_invested: 250000, rounds: 1, latest_round: 'Seed', vintage: 2026, latest_date: '2026-02-01', fmv: 250000, multiple: 1, unmarked: true, mark_unavailable_reason: 'no_mark', mark_unavailable: 'No valuation is recorded for this position as of this date; invested cost is not its value.' },
    { project_id: 4, project: { name: 'Company H', sector: 'Logistics', stage: 'Seed' }, total_invested: 250000, rounds: 1, latest_round: 'Seed', vintage: 2025, latest_date: '2025-08-01', fmv: 250000, multiple: 1, unmarked: true, mark_unavailable_reason: 'fund_marks_conflict', mark_unavailable: 'Two funds recorded different values for this company on the same date.' },
    // Funded after 30 Sep 2026: its one cheque is dated 12 Oct 2026.
    { project_id: 5, project: { name: 'Company I', sector: 'Health data', stage: 'Seed' }, total_invested: 400000, rounds: 1, latest_round: 'Seed', vintage: 2026, latest_date: '2026-10-12', fmv: 400000, multiple: 1, unmarked: true, mark_unavailable_reason: 'no_mark', mark_unavailable: 'No valuation is recorded for this position as of this date; invested cost is not its value.' },
  ],
  scope: { rule: 'confirmed_commitment', text: 'Companies where you hold a confirmed commitment.' },
  fund_scope: null,
  ...over,
});

const AT = (date, over = {}) => ({
  as_of: date, basis: 'gross', nav: 6700000, paid_in: 3750000, distributed: 900000,
  returns: { tvpi: { state: 'computed', value: 2.03 }, dpi: { state: 'computed', value: 0.24 }, rvpi: { state: 'computed', value: 1.79 }, irr: { state: 'computed', value: 0.213 } },
  position_count: 4, unmarked_position_count: 2, unusable_mark_count: 1, mark_coverage: 0.5,
  ...over,
});

const QUARTERS = (date, failed = []) => {
  const out = {};
  for (const d of ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']) {
    if (d > date) continue;
    if (failed.includes(d)) out[d] = { state: 'unreadable' };
    else if (d === '2025-03-31') out[d] = ok(AT(d, { nav: 0, paid_in: 0, distributed: 0, position_count: 0, unmarked_position_count: 0 }));
    else out[d] = ok(AT(d));
  }
  return out;
};

const input = (over = {}) => ({
  date: '2026-09-30', analytics: ok(AT('2026-09-30')), positions: ok(POS()), quarters: QUARTERS('2026-09-30'),
  compliance: ok(COMPLIANCE), investor: 'Investor A', firstYear: 2025, ...over,
});

/* ------------------------------------------------------------- the model */

test('1 · the chooser lists completed quarter-ends newest first, from the first cheque’s year to the reporting read', () => {
  const c = statementDatesOf(ok(POS()), ok(COMPLIANCE));
  assert.equal(c.state, 'ok');
  assert.deepEqual(c.dates.map((d) => d.date), ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31']);
  assert.equal(c.dates[0].latest, true);
  assert.equal(c.dates[1].latest, false);
  assert.equal(c.from, '2025-03-31');
  assert.equal(c.to, '2026-09-30');
  // An empty book and a failed read are not dates.
  assert.equal(statementDatesOf(ok(POS({ items: [] })), ok(COMPLIANCE)).state, 'not_recorded');
  assert.equal(statementDatesOf({ state: 'unreadable' }, ok(COMPLIANCE)).state, 'unreadable');
  // A date that answers with no position is No book; a measured book is not.
  assert.equal(noBookAt(ok(AT('2025-03-31', { position_count: 0 }))), true);
  assert.equal(noBookAt(ok(AT('2026-09-30'))), false);
});

test('2 · the mismatch note appears whenever the rows’ invested total differs from paid-in, and names the Funded after rows', () => {
  const m = mismatchOf('2026-09-30', AT('2026-09-30'), POS());
  assert.ok(m, 'the totals differ ($4,150,000 listed, $3,750,000 paid-in)');
  assert.equal(m.diff, 400000);
  assert.deepEqual(m.after.map((r) => r.name), ['Company I']);
  assert.match(m.detail, /\$4,150,000 invested; paid-in to 30 Sep 2026 on page 1 is \$3,750,000/);
  assert.match(m.detail, /“Funded after 30 Sep 2026” accounts for \$400,000/);
  assert.equal(mismatchOf('2026-09-30', AT('2026-09-30', { paid_in: 4150000 }), POS()), null, 'equal totals: no note');
  // A first cheque in a later year is Funded after even with several cheques.
  assert.equal(fundedAfter({ vintage: 2027, rounds: 3, latest_date: '2027-05-01' }, '2026-09-30'), true);
  assert.equal(fundedAfter({ vintage: 2026, rounds: 2, latest_date: '2026-10-01' }, '2026-09-30'), false, 'an earlier cheque exists: not caught, the note covers it');
  const preview = previewOf('2026-09-30', ok(AT('2026-09-30')), ok(POS()));
  assert.equal(preview.state, 'ok');
  assert.ok(preview.mismatch);
  assert.equal(previewOf('2025-03-31', ok(AT('2025-03-31', { position_count: 0 })), ok(POS())).state, 'no_book');
  assert.equal(previewOf('2026-09-30', { state: 'unreadable' }, ok(POS())).state, 'unreadable');
});

test('3 · page 1’s figures each name what they count and for which date; Unavailable and Total loss are never 0', () => {
  const rows = summaryRowsOf('2026-09-30', AT('2026-09-30', {
    returns: {
      tvpi: { state: 'unavailable', value: null, reason: 'no_paid_in' },
      dpi: { state: 'computed', value: 0 },
      rvpi: { state: 'computed', value: 1.79 },
      irr: { state: 'total_loss', value: -1 },
    },
  }));
  assert.equal(rows.length, 11);
  assert.equal(rows[0].label, 'NAV as of 30 Sep 2026');
  assert.equal(rows[1].label, 'Paid-in to 30 Sep 2026');
  const tvpi = rows.find((r) => r.label.startsWith('TVPI'));
  assert.equal(tvpi.value, 'Unavailable · No paid-in capital is recorded.');
  assert.equal(rows.find((r) => r.label.startsWith('DPI')).value, '0.00×', 'a measured zero stays zero');
  assert.match(rows.find((r) => r.label.startsWith('IRR')).value, /^-100% · Total loss/);
  assert.equal(rows.find((r) => r.label === 'Mark coverage').value, '2 of 4 marked');
  assert.equal(rows.find((r) => r.label === 'Positions at cost').note, '1 with no mark · 1 whose recorded mark cannot be used');
});

test('4 · a failed read produces no statement, except one failed quarter-end, drawn as a Not read gap', () => {
  const failedPositions = statementOf(input({ positions: { state: 'unreadable' } }));
  assert.equal(failedPositions.ok, false);
  assert.deepEqual(failedPositions.failed, ['Positions as of 30 Sep 2026']);
  assert.equal(statementOf(input({ analytics: { state: 'unreadable' } })).ok, false);
  const oneGap = statementOf(input({ quarters: QUARTERS('2026-09-30', ['2025-12-31']) }));
  assert.equal(oneGap.ok, true);
  assert.deepEqual(oneGap.quarters.notRead, ['31 Dec 2025']);
  assert.equal(oneGap.quarters.points.find((p) => p.date === '2025-12-31').gap, 'Not read');
  assert.equal(oneGap.quarters.points.find((p) => p.date === '2025-03-31').gap, 'No book');
  const twoGaps = statementOf(input({ quarters: QUARTERS('2026-09-30', ['2025-12-31', '2026-03-31']) }));
  assert.equal(twoGaps.ok, false);
  assert.deepEqual(twoGaps.failed, ['2 quarter-ends on page 3']);
  const noBook = statementOf(input({ date: '2025-03-31', analytics: ok(AT('2025-03-31', { position_count: 0 })), quarters: QUARTERS('2025-03-31') }));
  assert.equal(noBook.ok, false);
  assert.equal(noBook.noBook, true);
});

/* ------------------------------------------------------------ the PDF */

function draw(over = {}) {
  const doc = createPdfStub();
  const m = statementOf(input(over));
  assert.equal(m.ok, true);
  const r = renderPortfolioStatement(doc, m);
  const texts = (page) => doc.calls.filter((c) => c.op === 'text' && (page == null || c.page === page)).map((c) => c.text);
  return { doc, m, ...r, texts };
}

test('5 · five pages, each page head saying Gross of fees and carry, page 1 saying net returns are Not recorded, page 5 the definitions', () => {
  const { pages, texts, doc } = draw();
  assert.equal(pages, 5);
  for (let p = 1; p <= pages; p += 1) {
    assert.ok(texts(p).some((t) => t.includes(STATEMENT_BASIS)), `page ${p} says ${STATEMENT_BASIS}`);
    assert.ok(texts(p).some((t) => t.includes(`Page ${p} of ${pages}`)), `page ${p} carries its number`);
  }
  assert.ok(texts(1).some((t) => t.includes(NET_RETURNS)));
  assert.ok(texts(1).some((t) => t.includes('NAV as of 30 Sep 2026')));
  assert.ok(texts(2).some((t) => t.includes('Positions include cheques dated after 30 Sep 2026')), 'the mismatch note heads page 2');
  assert.ok(texts(2).some((t) => t === 'Funded after'), 'Company I carries its pill');
  assert.ok(texts(3).some((t) => t === 'No book'), '31 Mar 2025 is an empty slot labelled No book');
  for (const [term, text] of METHODOLOGY) {
    assert.ok(texts(5).includes(term), `page 5 lists ${term}`);
    assert.ok(texts(5).includes(pdfText(text)), `page 5 prints the ${term} definition`);
  }
  assert.ok(texts(5).some((t) => t.includes('not an audited statement')), 'the last footer');
  assert.ok(doc.maxX <= 612.01, `content reaches ${doc.maxX.toFixed(1)}pt of 612pt`);
  assert.ok(doc.maxY <= 792.01, `content reaches ${doc.maxY.toFixed(1)}pt of 792pt`);
});

test('6 · an admin preview is watermarked on every page; a cover note prints only when given, as the investor’s own words', () => {
  const plain = draw();
  assert.equal(plain.texts().filter((t) => t === 'Preview, not for distribution').length, 0);
  assert.ok(!plain.texts(1).some((t) => t.includes('own words')));
  const admin = draw({ preview: true, coverNote: 'Attached is my statement.' });
  for (let p = 1; p <= admin.pages; p += 1) {
    assert.ok(admin.texts(p).includes('Preview, not for distribution'), `page ${p} is watermarked`);
  }
  assert.ok(admin.texts(1).some((t) => t.includes('Note from Investor A · the investor’s own words, not Axal’s')));
  assert.ok(admin.texts(1).includes('Attached is my statement.'));
  assert.ok(admin.texts(1).includes('Every position the studio recorded.'), 'an admin preview’s scope');
});

test('7 · a long positions list runs onto a continuation page under the same header, and every footer counts the real total', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    project_id: 100 + i, project: { name: `Company ${i} with a registered name long enough to wrap onto a second line`, sector: 'Software', stage: 'Seed' },
    total_invested: 125000, rounds: 1, latest_round: 'Seed', vintage: 2025, latest_date: '2025-05-01', fmv: 125000, multiple: 1, unmarked: true,
    mark_unavailable_reason: 'no_mark', mark_unavailable: 'No valuation is recorded for this position as of this date; invested cost is not its value.',
  }));
  const { pages, texts, bottoms } = draw({ positions: ok(POS({ items })) });
  assert.ok(pages > 5, `the positions run over (${pages} pages)`);
  const heads = [];
  for (let p = 1; p <= pages; p += 1) if (texts(p).includes('COMPANY')) heads.push(p);
  assert.ok(heads.length >= 2, 'the header repeats on the continuation page');
  for (let p = 1; p <= pages; p += 1) assert.ok(texts(p).some((t) => t.includes(`Page ${p} of ${pages}`)));
  for (const b of bottoms) assert.ok(b <= 990, `body ends at ${b}px, above the footer`);
});

test('8 · Performance prints the one METHODOLOGY list the statement prints', () => {
  const src = readFileSync(new URL('../src/pages/investor/InvestorPortfolioPerformance.jsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ METHODOLOGY \} from '\.\.\/portfolio\/statementModel'/);
  assert.ok(!/const METHODOLOGY\s*=/.test(src), 'no second list on the page');
  assert.equal(METHODOLOGY.length, 10);
});

/* ------------------------------------------------------------- the sheet */

async function mountSheet({ answer, exporter, positions = ok(POS()), compliance = ok(COMPLIANCE) }) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://localhost');
    calls.push(`${url.pathname}${url.search}`);
    return answer({ path: url.pathname, query: url.searchParams, method: (init.method || 'GET').toUpperCase() }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const textOf = (n) => (n.nodeType === 3 ? n.textContent : (n.childNodes || []).map(textOf).join('') || n.textContent || '');
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  let closed = 0;
  await act(async () => root.render(h(MemoryRouter, null, h('div', { className: 'pf-shell' }, h(StatementSheet, {
    positions, compliance, investor: 'Investor A', from: 'Overview', onClose: () => { closed += 1; }, exporter,
  })))));
  await settle();
  return {
    calls,
    has: (id) => Boolean(byId(id)),
    text: (id) => (byId(id) ? textOf(byId(id)) : null),
    attr: (id, k) => props(byId(id) || {})[k],
    get closed() { return closed; },
    async click(id) { await act(async () => { props(byId(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async change(id, value) {
      const node = byId(id);
      await act(async () => { props(node).onChange({ target: { value, checked: value } }); });
      await settle();
    },
    async pick(date) {
      const label = byId(`statement-date-${date}`);
      const radio = label.childNodes.find((n) => n.tagName === 'INPUT');
      await act(async () => { props(radio).onChange({}); });
      await settle();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

const bookAnswer = (failAnalyticsAt = null) => ({ path, query }) => {
  const asOf = query.get('as_of');
  if (path === '/api/positions/analytics') {
    if (asOf === failAnalyticsAt) return json({ detail: 'down' }, 500);
    return json(asOf === '2025-03-31' ? AT(asOf, { position_count: 0, nav: 0, paid_in: 0 }) : AT(asOf));
  }
  if (path === '/api/positions') return json(POS());
  return null;
};

test('9 · the sheet previews the latest quarter-end; a date with no book cannot be downloaded; a failed read names itself', async () => {
  let made = 0;
  const s = await mountSheet({ answer: bookAnswer('2026-06-30'), exporter: async () => { made += 1; return { pages: 5 }; } });
  try {
    assert.ok(s.calls.includes('/api/positions/analytics?as_of=2026-09-30'), 'the latest quarter-end is read');
    assert.ok(s.calls.includes('/api/positions?as_of=2026-09-30'), 'its positions are read with marks cut at the date');
    assert.match(s.text('statement-preview'), /NAV as of 30 Sep 2026\$6,700,000/);
    assert.match(s.text('statement-mismatch'), /Company I is marked “Funded after 30 Sep 2026” on page 2/);
    assert.match(s.text('statement-own'), /Axal does not send it or keep a copy/);
    assert.equal(s.attr('button-statement-download', 'aria-disabled'), undefined, 'Download is the live primary action');

    await s.pick('2025-03-31');
    assert.match(s.text('statement-no-book'), /No book · before the first cheque/);
    assert.equal(s.attr('button-statement-download', 'aria-disabled'), 'true');
    await s.click('button-statement-download');
    assert.equal(made, 0, 'nothing is drawn for a date with no book');

    await s.pick('2026-06-30');
    assert.match(s.text('statement-unreadable'), /Performance as of 30 Jun 2026 could not be read/);
    assert.match(s.text('statement-unreadable'), /nothing was downloaded/);
    assert.equal(s.attr('button-statement-download', 'aria-disabled'), 'true');
    await s.click('button-statement-download');
    assert.equal(made, 0);
  } finally { await s.close(); }
});

test('10 · Download reads page 3’s quarter-ends, passes a cover note only when ticked, and confirms with Open Performance at the date', async () => {
  const seen = [];
  const s = await mountSheet({ answer: bookAnswer(), exporter: async (inp) => { seen.push(inp); return { pages: 5 }; } });
  try {
    await s.change('checkbox-statement-cover', true);
    await s.change('input-statement-cover', 'Attached is my statement.');
    await s.change('checkbox-statement-cover', false);
    await s.click('button-statement-download');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].coverNote, null, 'an unticked note stays out of the PDF');
    assert.equal(seen[0].date, '2026-09-30');
    assert.ok(seen[0].quarters['2025-06-30'], 'page 3 reads each earlier quarter-end');
    assert.equal(statementOf(seen[0]).ok, true, 'the reads the sheet passes make a statement');
    assert.match(s.text('statement-downloaded'), /Statement as of 30 Sep 2026 downloaded/);
    assert.match(s.text('statement-downloaded'), /Axal sent nothing and kept no copy/);
    assert.equal(s.attr('link-statement-performance', 'href'), '/portfolio/performance?as_of=2026-09-30');
  } finally { await s.close(); }
  const t = await mountSheet({ answer: bookAnswer(), exporter: async (inp) => { seen.push(inp); return { pages: 5 }; } });
  try {
    await t.change('checkbox-statement-cover', true);
    await t.change('input-statement-cover', 'Attached is my statement.');
    await t.click('button-statement-download');
    assert.equal(seen[1].coverNote, 'Attached is my statement.');
  } finally { await t.close(); }
});

test('11 · Performance opens the sheet, and ?as_of= reads its summary as of that quarter-end', async () => {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u) => {
    const url = new URL(String(u), 'http://localhost');
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/api/positions/analytics') return json(AT(url.searchParams.get('as_of')));
    if (url.pathname === '/api/positions') return json(POS());
    if (url.pathname === '/api/positions/kpi-compliance') return json(COMPLIANCE);
    return json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/performance?as_of=2026-06-30'] }, h(InvestorPortfolioPerformance))));
    await settle();
    assert.ok(byId('perf-as-of'), 'the page says it is the book as of the statement date');
    assert.ok(calls.filter((c) => c === '/api/positions/analytics?as_of=2026-06-30').length >= 1, 'the summary read is cut at the date');
    assert.ok(!calls.includes('/api/positions/analytics'), 'no undated summary read');
    const textOf = (n) => (n.nodeType === 3 ? n.textContent : (n.childNodes || []).map(textOf).join('') || n.textContent || '');
    const method = textOf(byId('perf-methodology'));
    for (const [term, text] of METHODOLOGY) assert.ok(method.includes(`${term}${text}`), `the Methodology card prints ${term} from METHODOLOGY`);
    await act(async () => { props(byId('button-open-statement')).onClick({}); });
    await settle();
    assert.ok(byId('statement-sheet'), 'Statement opens the sheet');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = realFetch;
    restore();
  }
});
