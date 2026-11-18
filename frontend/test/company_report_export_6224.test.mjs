// D6224 (#6224) — Company page: the investor takes the reported figures away
// as a CSV built in the browser from the reports already on the page (the
// same `seriesOf` rows the tables draw), and prints a received report through
// the reader's existing Print (#6094). A gap is "Not recorded" with its
// reason, never 0 and never blank; fields are escaped (RFC 4180) and text a
// spreadsheet would run as a formula is neutralised. No new read: the
// download makes no request. A failed download says so and changes nothing
// else. With no report received there is no control.
//
// Mutation checked, each both ways (fails with the mutation, passes without):
// the formula prefix dropped, quotes not doubled, a comma left unquoted,
// numbers neutralised too, CRLF → LF (the file test); a gap written as 0, a
// gap's reason blank, Corrected always No, raw unit codes (the model test); no
// BOM, the press re-reading the figures (the download test); a failure
// swallowed (the failed test); the control drawn with no report (the none
// test); the reader printing in team mode (the print test).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_report_export_6224.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { installDocument } from './_contracts_dom.mjs';
import { reportPrintData } from '../src/pages/cycles/reporting/printing/reportPrint.js';
import { FiguresTab } from '../src/pages/investor/CompanyReports.jsx';
import { FIGURES_CSV_HEADER, csvCell, figuresCsv, figuresCsvName, figuresCsvRows } from '../src/pages/investor/portfolioReportsModel.js';

const h = React.createElement;
const fig = (key, label, unit, value, extra = {}) => ({ key, label, unit, value, source: { word: 'Connector', provider: 'stripe', computed: false }, ...extra });
const REPORTS = [
  { uid: 'r2', period: { label: '2026-Q2', start: '2026-04-01' }, corrected: true,
    figures: [fig('mrr', 'MRR', 'usd', 31200), fig('customers', 'Customers', 'count', null, { left_out: true, left_out_reason: 'Moving billing systems, "phase 2"' }),
      fig('net_burn', 'Net burn', 'usd', -1500, { source: { provider: '=HYPERLINK("x")', computed: false } })] },
  { uid: 'r1', period: { label: '2026-Q1', start: '2026-01-01' }, corrected: false,
    figures: [fig('mrr', 'MRR', 'usd', 0), fig('customers', 'Customers', 'count', 120)] },
];

test('the model: one row per figure per report, oldest first, with units, sources, the correction and each gap’s reason', () => {
  const rows = figuresCsvRows(REPORTS);
  assert.deepEqual(rows[0], [...FIGURES_CSV_HEADER]);
  const of = (figure) => rows.filter((r) => r[1] === figure);
  assert.deepEqual(of('MRR'), [
    ['Q1 2026', 'MRR', 0, 'USD', 'Connector · Stripe', 'No', ''],
    ['Q2 2026', 'MRR', 31200, 'USD', 'Connector · Stripe', 'Yes', ''],
  ], 'a recorded zero stays 0; the corrected report says Yes');
  assert.deepEqual(of('Customers'), [
    ['Q1 2026', 'Customers', 120, 'count', 'Connector · Stripe', 'No', ''],
    ['Q2 2026', 'Customers', 'Not recorded', 'count', 'Connector · Stripe', 'Yes', 'Moving billing systems, "phase 2"'],
  ], 'a left-out figure is Not recorded with the founders’ reason');
  assert.deepEqual(of('Net burn')[0], ['Q1 2026', 'Net burn', 'Not recorded', 'USD', 'Not recorded', 'No', 'Not in this report'], 'a figure absent from a report says so; its unit is the series’');
  assert.deepEqual(of('Runway'), [
    ['Q1 2026', 'Runway', 'Not recorded', 'Not recorded', 'Not recorded', 'No', 'Not in this report'],
    ['Q2 2026', 'Runway', 'Not recorded', 'Not recorded', 'Not recorded', 'Yes', 'Not in this report'],
  ]);
  for (const r of rows.slice(1)) {
    assert.notEqual(r[2], '', 'a value is never blank');
    if (r[2] === 'Not recorded') assert.ok(r[6], 'a gap always carries its reason');
  }
  assert.deepEqual(rows.slice(1).map((r) => r[1]).filter((v, i, a) => a.indexOf(v) === i), ['MRR', 'Customers', 'Net burn', 'Runway', 'Headcount'], 'the canvas’s figure order');
});

test('the file: RFC 4180 quoting, formula text neutralised, numbers (negative too) left as numbers, CRLF line ends', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  for (const lead of ['=', '+', '-', '@', '\t']) assert.equal(csvCell(`${lead}SUM(A1)`), `'${lead}SUM(A1)`, JSON.stringify(lead));
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'neutralised, then quoted');
  assert.equal(csvCell(-1500), '-1500');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(null), '');
  const csv = figuresCsv(REPORTS);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Period,Figure,Value,Unit,Source,Corrected,Why not recorded');
  assert.equal(lines.at(-1), '', 'ends with a line break');
  assert.ok(lines.includes('Q2 2026,Customers,Not recorded,count,Connector · Stripe,Yes,"Moving billing systems, ""phase 2"""'));
  assert.ok(lines.includes('Q2 2026,Net burn,-1500,USD,"\'=HYPERLINK(""x"")",Yes,'), 'a formula in a source is neutralised; the negative value is not');
  assert.equal(figuresCsvName(new Date('2026-11-18T12:00:00Z')), 'reported-figures-2026-11-18.csv');
});

test('print: the reader’s Print (#6094) carries company, period, sent date, revision, figures with sources, left-out reasons and documents', () => {
  const data = reportPrintData({
    status: 'sent', view: 'reader', title: 'Q2 2026 report', period: { label: 'Q2 2026' }, revision: 2, sent_at: '2026-08-01T09:00:00Z',
    figures: [fig('mrr', 'MRR', 'usd', 31200, { as_of: '2026-06-30' }), fig('customers', 'Customers', 'count', null, { left_out: true, left_out_reason: 'Moving billing systems' })],
    documents: [{ uid: 'd1', label: 'Q2 statements.pdf' }],
  }, { reader: true, company: 'Acme Robotics' });
  assert.deepEqual([data.company, data.period, data.sent, data.revision], ['Acme Robotics', 'Q2 2026', '2026-08-01T09:00:00Z', '2']);
  assert.deepEqual(data.figures.map((f) => [f.label, f.value, f.source]), [['MRR', '$31,200', 'Connector · Stripe · 30 Jun'], ['Customers', 'Not included', 'Moving billing systems']]);
  assert.deepEqual(data.documents, ['Q2 statements.pdf']);
  const src = readFileSync('frontend/src/pages/investor/CompanyReports.jsx', 'utf8');
  assert.match(src, /<ReportPrintButton report=\{r\} company=\{company\} reader /, 'the reader prints in reader mode');
});

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mount(figures, { failBlob = false } = {}) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL, Blob: globalThis.Blob };
  const asked = [];
  const saved = [];
  const blobs = [];
  URL.createObjectURL = (b) => { if (failBlob) throw new Error('blocked'); blobs.push(b); return 'blob:figures'; };
  URL.revokeObjectURL = () => {};
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    if (String(tag).toLowerCase() === 'a') Object.assign(n, { click() { saved.push(n.download); }, remove() {} });
    return n;
  };
  globalThis.fetch = async (u) => {
    asked.push(String(u).replace(/^.*\/api/, ''));
    return figures instanceof Error ? response({ detail: figures.message }, Number(figures.status) || 500) : response(figures);
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(FiguresTab, { uid: 'p-abc', periods: [] })));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, saved, blobs, has: (id) => !!by(id),
    text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    page: () => txt(el).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = prev.fetch; URL.createObjectURL = prev.create; URL.revokeObjectURL = prev.revoke;
      localStorage.removeItem('user'); restore();
    },
  };
}

test('no report received: the Figures say so and there is no Download control', async () => {
  for (const figures of [{ reports: [] }, Object.assign(new Error('No reports'), { status: 404 })]) {
    const v = await mount(figures);
    try {
      assert.ok(v.has('company-figures-none'));
      assert.ok(!v.has('button-download-figures'), 'absent when nothing was received');
    } finally { await v.close(); }
  }
});

test('a failed read keeps Unavailable and offers no download', async () => {
  const v = await mount(Object.assign(new Error('boom'), { status: 500 }));
  try { assert.ok(!v.has('button-download-figures')); } finally { await v.close(); }
});

test('download: the reports on the page become one CSV file; nothing is requested', async () => {
  const v = await mount({ reports: REPORTS });
  try {
    assert.match(v.text('button-download-figures'), /^Download figures \(CSV\)$/);
    assert.deepEqual(v.asked, ['/reporting/companies/p-abc/figures']);
    await v.click('button-download-figures');
    assert.deepEqual(v.asked, ['/reporting/companies/p-abc/figures'], 'no new /api call');
    assert.equal(v.saved.length, 1);
    assert.match(v.saved[0], /^reported-figures-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.equal(v.blobs.length, 1);
    assert.match(v.blobs[0].type, /^text\/csv/);
    const bytes = new Uint8Array(await v.blobs[0].arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a byte-order mark, so a spreadsheet reads it as UTF-8');
    assert.equal(new TextDecoder().decode(bytes.slice(3)), figuresCsv(REPORTS));
    assert.ok(!v.has('company-figures-download-failed'));
  } finally { await v.close(); }
});

test('download failed: it says so, saves nothing, and the rest of the page is as it was', async () => {
  const v = await mount({ reports: REPORTS }, { failBlob: true });
  try {
    const before = v.page();
    await v.click('button-download-figures');
    assert.deepEqual(v.saved, []);
    assert.match(v.text('company-figures-download-failed'), /could not be downloaded/);
    assert.equal(v.page().replace(v.text('company-figures-download-failed'), '').replace(/\s+/g, ' ').trim(), before, 'only the message was added');
    assert.ok(v.has('button-download-figures'), 'the press stays to try again');
    assert.ok(v.has('company-figure-grid'));
  } finally { await v.close(); }
});
