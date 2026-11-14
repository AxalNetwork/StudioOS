import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCsv } from '../src/lib/csvExport.js';
import { pipelineCsv, commitmentsCsv } from '../src/pages/raise/caprel/capRelExports.js';

test('pipeline CSV preserves the column order, zero, and spreadsheet-safe text', () => {
  const { header, rows } = pipelineCsv([
    { name: '=1+1', firm: '+Firm', email: '@name', stage: 'committed', fit: 0, next_step: '  -Follow up',
      next_step_due: '2026-11-20', last_contact: '2026-11-14', commit_status: 'signed', amount_cents: 0, currency: 'JPY' },
    { name: 'Surname, "Name"' },
  ]);
  assert.equal(toCsv(header, rows),
    'Name,Firm,Email,Stage,Fit,Next step,Due,Last contact,Status,Amount,Currency\r\n' +
    "'=1+1,'+Firm,'@name,Committed,0,'  -Follow up,2026-11-20,2026-11-14,Signed,0,JPY\r\n" +
    '"Surname, ""Name""",,,,,,,,,,');
});

test('commitments CSV retains separate lines and leaves unrecorded amounts, statuses and closes empty', () => {
  const { header, rows } = commitmentsCsv({ investors: [{ name: 'Investor', lines: [
    { cents: 0, currency: 'USD', status: 'signed', status_label: 'Signed', source_label: 'Typed', close_name: 'First close' },
    { cents: null, currency: 'KWD', status: 'not_recorded', status_label: 'Not recorded', source_label: 'Recorded', via: 'Not a close' },
    { cents: 1234, currency: 'KWD', status: 'soft', status_label: 'Soft', source_label: 'Typed' },
  ] }] });
  assert.equal(toCsv(header, rows), 'Investor,Amount,Status,Source,Close\r\n' +
    'Investor,0.00,Signed,Typed,First close\r\nInvestor,,,Recorded,\r\nInvestor,1.234,Soft,Typed,');
});
