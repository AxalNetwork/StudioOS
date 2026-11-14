/** #6094: frozen report provenance, audience privacy and literal print content. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reportPrintData, renderReportPrint } from '../src/pages/cycles/reporting/printing/reportPrint.js';
import ReportPrintButton from '../src/pages/cycles/reporting/printing/ReportPrintButton.jsx';
import { installDocument, mountContracts } from './_contracts_dom.mjs';
import { reportingApi } from '../src/lib/api/reporting.js';
import { ReportReader } from '../src/pages/investor/CompanyReports.jsx';

const figure = (extra) => ({ key: 'mrr', label: 'MRR', value: 48200, unit: 'usd', included: true,
  source: { word: 'Connector', provider: 'stripe' }, as_of: '2026-09-30', ...extra });
const report = (extra = {}) => ({ status: 'sent', view: 'team', title: 'Frozen September report',
  period: { label: 'Sep 2026', start: '2026-09-01', end: '2026-09-30' }, revision: 1,
  sent_at: '2026-10-02T10:00:00Z', body: 'The narrative exactly as sent.',
  recipients: [{ name: 'Private recipient' }],
  figures: [figure({}), figure({ key: 'customers', label: 'Customers', value: 0, unit: 'count', typed: true }),
    figure({ key: 'margin', label: 'Margin', value: null, unit: 'pct', reason: 'Unreadable: source unavailable' }),
    figure({ key: 'cash', label: 'Confidential cash', value: 987654321, team_only: true, shared: false })],
  highlights: [{ text: 'Launched the pilot', source: { label: 'Project milestone', as_of: '2026-09-22' } }],
  lowlights: [{ text: 'A delayed delivery', source: { label: 'Delivery log' } }], ...extra });

test('the investor ReportReader offers printing only after a sent report loads, and keeps unreadable reads retryable', async () => {
  const original = reportingApi.report;
  try {
    for (const unreadable of [false, true]) {
      let resolve, reject;
      reportingApi.report = () => new Promise((yes, no) => { resolve = yes; reject = no; });
      const view = await mountContracts(React.createElement(ReportReader, { uid: 'report-6094', company: 'Synthetic Company', onClose() {} }));
      const hasPrint = () => view.nodes().some((n) => view.props(n)?.['data-testid'] === 'report-print');
      try {
        assert.equal(hasPrint(), false, 'loading report cannot print');
        await act(async () => { if (unreadable) reject(new Error('synthetic read failure')); else resolve(report({ view: 'reader' })); });
        assert.equal(hasPrint(), !unreadable);
        if (unreadable) assert.match(view.text(), /could not be read/);
        else assert.match(view.text(), /Print or save as PDF/);
      } finally { await view.unmount(); }
    }
  } finally { reportingApi.report = original; }
});

test('a reader prints the frozen figures and provenance, including zero, without private team data or recipients', () => {
  const result = reportPrintData(report(), { reader: true, company: 'Synthetic Studio' });
  assert.deepEqual(result.figures.map((f) => f.label), ['MRR', 'Customers', 'Margin']);
  assert.equal(result.figures[0].value, '$48,200');
  assert.match(result.figures[0].source, /Connector · Stripe/);
  assert.equal(result.figures[0].asOf, '2026-09-30');
  assert.equal(result.figures[1].value, '0');
  assert.match(result.figures[1].source, /Typed · entered by Synthetic Studio/);
  assert.equal(result.figures[2].value, 'Unreadable: source unavailable');
  assert.deepEqual([result.period, result.revision, result.sent], ['Sep 2026', '1', '2026-10-02T10:00:00Z']);
  assert.equal(result.body, 'The narrative exactly as sent.');
  assert.deepEqual(result.lines.map((l) => [l.kind, l.text]), [['Highlight', 'Launched the pilot'], ['Lowlight', 'A delayed delivery']]);
  assert.match(result.lines[0].source, /Project milestone/);
  assert.doesNotMatch(JSON.stringify(result), /987654321|Confidential cash|Private recipient|recipients/);
});

test('only explicitly shared Mercury figures print for a reader; excluded figures never print their stored value', () => {
  const r = report({ figures: [figure({ team_only: true, shared: true, shared_from_mercury: true }),
    figure({ key: 'left', label: 'Left out', value: 999999, included: false, left_out: true, left_out_reason: 'Shared at the board meeting' })] });
  const data = reportPrintData(r, { reader: true });
  assert.equal(data.figures[0].value, '$48,200');
  assert.match(data.figures[0].source, /shared by the founder/);
  assert.deepEqual([data.figures[1].value, data.figures[1].source], ['Not included', 'Shared at the board meeting']);
  assert.doesNotMatch(JSON.stringify(data), /999999|999,999/);
  for (const left_out of [undefined, false]) {
    const onlyIncludedFlag = reportPrintData(report({ figures: [figure({ included: false, left_out, value: 999999 })] }), { reader: true });
    assert.equal(onlyIncludedFlag.figures[0].value, 'Not included');
    assert.doesNotMatch(JSON.stringify(onlyIncludedFlag), /999999|999,999/);
  }
  assert.equal(reportPrintData(report()).figures.find((f) => f.label === 'Confidential cash').value, '$987,654,321');
});

test('unknown metadata remains not recorded and drafts never offer printing', () => {
  const r = report({ period: null, revision: null });
  assert.deepEqual([reportPrintData(r).period, reportPrintData(r).revision], ['Not recorded', 'Not recorded']);
  for (const invalid of [null, report({ status: 'draft' }), report({ sent_at: null })]) {
    assert.throws(() => reportPrintData(invalid), /Only a sent report/);
    assert.equal(renderToStaticMarkup(React.createElement(ReportPrintButton, { report: invalid })), '');
  }
  assert.match(renderToStaticMarkup(React.createElement(ReportPrintButton, { report: report() })), /Print or save as PDF/);
});

test('the isolated print document contains literal narrative, revision and sources, without shell or recipient content', () => {
  const restore = installDocument();
  try {
    const data = reportPrintData(report({ body: '<script>window.compromised = true</script>\nSecond line',
      correction_reason: 'Corrected the source', corrected_by: { revision: 2, corrected_on: '2026-10-03' } }), { reader: true });
    renderReportPrint(document, data);
    const nodes = (n) => [n, ...n.childNodes.flatMap(nodes)];
    const all = nodes(document.body);
    const content = all.map((n) => n.textContent).join('\n');
    assert.match(content, /<script>window.compromised = true<\/script>/);
    assert.equal(all.some((n) => n.tagName === 'SCRIPT'), false);
    assert.match(content, /Revision 1 · Sent 2026-10-02/);
    assert.match(content, /Corrected by revision 2 · 2026-10-03/);
    assert.match(content, /Corrected the source/);
    assert.match(content, /Connector · Stripe/);
    assert.match(content, /Highlights and lowlights/);
    assert.doesNotMatch(content, /Private recipient|Confidential cash/);
    assert.deepEqual(all.filter((n) => n.tagName === 'TH').map((n) => n.textContent), ['Figure', 'Value', 'Source', 'As of']);
  } finally { restore(); }
});
