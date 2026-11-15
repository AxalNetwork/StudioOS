// D6249 (#6249): readablePeriod accepts an issued period's figures, issuer
// name and correcting period, and refuses them when malformed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readablePeriod } from '../src/hooks/useFundReport.js';

const draft = { id: 7, period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', status: 'draft',
  narrative: { letter: ['Letter.'], developments: [], outlook: [], subsequent: [] }, corrects_period_id: null };
const issued = { ...draft, status: 'issued', issued_by: 2, issued_by_name: 'Grace Partner', issued_by_name_reason: null, corrected_by_period_id: 9,
  figures: { source: 'issue_snapshot', currency: 'USD', totals: { committed_cents: 1, committed_reason: null, invested_cents: null, invested_reason: 'Not recorded.' } }, figures_reason: null };

test('a draft without the D6249 fields and an issued period with them are both readable', () => {
  assert.ok(readablePeriod(draft));
  assert.ok(readablePeriod(issued));
  assert.ok(readablePeriod({ ...issued, figures: { source: 'report_pack', schema: 'lp_quarterly_report/1' } }));
  assert.ok(readablePeriod({ ...issued, figures: null, figures_reason: 'Not recorded: no figures were frozen when this period was issued.', issued_by_name: null, corrected_by_period_id: null }));
});

test('malformed D6249 fields make the period unreadable', () => {
  for (const value of [
    { ...issued, figures: { source: 'live' } },
    { ...issued, figures: [] },
    { ...issued, figures: null, figures_reason: null },
    { ...issued, issued_by_name: 2 },
    { ...issued, corrected_by_period_id: '9' },
    { ...issued, corrected_by_period_id: 0 },
  ]) assert.ok(!readablePeriod(value), JSON.stringify(value));
});
