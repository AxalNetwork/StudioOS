/**
 * #6204 (D6204) — the Reports inbox, the Positions Reporting column and the Overview's Reporting card read
 * each obligation's due day and lateness from the Worker (`due_date`, `days_overdue`, `overdue` on the
 * kpi-compliance rows): never worked out here. Every company is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/reporting_due_6204.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ObligationStatus } from '../src/pages/portfolio/PortfolioParts.jsx';
import { NO_DUE_DATE, dueOf, obligationRowsOf, reportingFor, reportingSummaryOf } from '../src/pages/portfolio/portfolioModel.js';

const row = (o) => ({ project_id: 1, name: 'Example Co', reported: false, last_reported_at: null, days_since_report: null, ...o });
const DUE = { due_date: '2026-10-30', due_days: 30, due_basis: 'firm_default', due_reason: null };
const ok = (companies, extra = {}) => ({ state: 'ok', value: { cadence: 'quarterly', period: '2026-Q3', period_until: '2026-09-30', period_in_progress: false,
  population: { period: '2026-Q3' }, kpi_set: [], companies, reported_count: companies.filter((c) => c.reported).length, total_count: companies.length,
  overdue_count: companies.filter((c) => c.overdue).length, due_default_days: 30, due_read: 'ok', ...extra } });
const none = { state: 'ok', value: { items: [] } };

// Mutation checked: lateness computed from days_since_report (fails); a reported company overdue (fails); 1 day as "1 days"
// (fails); the Worker's reason dropped for the fallback (fails); a missing due date shown as a date (fails).
test('dueOf: the Worker\'s due day, Overdue by N days, or Not recorded with the Worker\'s reason', () => {
  assert.deepEqual(dueOf(row({ ...DUE, days_overdue: 11, overdue: true, days_since_report: 135 })),
    { state: 'overdue', text: 'Overdue by 11 days', date: '30 Oct 2026', days: 11, basis: '30 days after the period ends, the firm default' });
  assert.equal(dueOf(row({ ...DUE, days_overdue: 1, overdue: true })).text, 'Overdue by 1 day');
  assert.deepEqual(dueOf(row({ ...DUE, due_date: '2026-11-14', due_days: 45, due_basis: 'reporting_duty', days_overdue: null, overdue: false })),
    { state: 'due', text: 'Due 14 Nov 2026', date: '14 Nov 2026', basis: '45 days after the period ends, from the reporting duty' });
  assert.equal(dueOf(row({ ...DUE, reported: true, days_overdue: 3, overdue: true })).state, 'reported', 'a company that reported is not overdue');
  assert.equal(dueOf(row({ ...DUE, days_since_report: 200 })).state, 'due', 'lateness is the Worker\'s, not days since the last report');
  assert.deepEqual(dueOf(row({ due_date: null, due_reason: 'The reporting duties could not be read, so no due date is claimed.' })),
    { state: 'none', text: 'Not recorded', reason: 'The reporting duties could not be read, so no due date is claimed.' });
  assert.equal(dueOf(row({})).reason, NO_DUE_DATE, 'an older read with no due fields says so');
});

// Mutation checked: the Overdue filter set as every unreported company (fails); overdueCount from rows not the Worker
// (fails); dueRead ignored (fails).
test('obligationRowsOf: each row carries its due, and the overdue set is the Worker\'s', () => {
  const inbox = obligationRowsOf({ compliance: ok([
    row({ project_id: 1, name: 'A', ...DUE, days_overdue: 11, overdue: true }),
    row({ project_id: 2, name: 'B', ...DUE, due_date: '2026-11-14', days_overdue: null, overdue: false }),
    row({ project_id: 3, name: 'C', reported: true, ...DUE, days_overdue: null, overdue: false }),
  ]), updates: none, positions: none, chases: none });
  assert.deepEqual(inbox.rows.map((r) => [r.projectId, r.overdue, r.due.text]), [[1, true, 'Overdue by 11 days'], [2, false, 'Due 14 Nov 2026'], [3, false, 'Due 30 Oct 2026']]);
  assert.equal(inbox.overdueCount, 1);
  assert.equal(inbox.dueRead, 'ok');
  assert.equal(inbox.dueDefaultDays, 30);
  const unread = obligationRowsOf({ compliance: ok([row({ due_reason: 'x' })], { due_read: 'unreadable', overdue_count: 0 }), updates: none, positions: none, chases: none });
  assert.equal(unread.dueRead, 'unreadable');
});

// Mutation checked: Positions' chip losing the days (fails); Overdue drawn without an icon (fails); the Overview's overdue
// count 0 for a read with no due data (fails); the summary counting overdue itself (fails).
test('Positions and the Overview: the chip says Overdue by N days; the card counts the Worker\'s overdue set or says Not recorded', () => {
  const c = ok([row({ project_id: 1, ...DUE, days_overdue: 11, overdue: true }), row({ project_id: 2, ...DUE, days_overdue: null, overdue: false })]);
  const r = reportingFor({ project_id: 1 }, c);
  assert.equal(r.state, 'Overdue');
  assert.equal(r.overdueDays, 11);
  const chip = renderToStaticMarkup(React.createElement(ObligationStatus, { reporting: r, compact: true }));
  assert.match(chip, /class="pf-chip is-late"[^>]*data-state="Overdue"/, 'drawn as late, not as Not recorded');
  assert.match(chip, /<svg[\s\S]*Overdue by 11 days/);
  assert.match(renderToStaticMarkup(React.createElement(ObligationStatus, { reporting: r })), /2026-Q3 overdue by 11 days/);
  assert.equal(reportingFor({ project_id: 2 }, c).state, 'Not received', 'unreported and not yet due');
  assert.equal(reportingSummaryOf(c, none).overdue, 1);
  const older = { state: 'ok', value: { ...c.value, overdue_count: undefined, due_read: undefined } };
  assert.equal(reportingSummaryOf(older, none).overdue, null, 'a read with no due data is Not recorded, never 0');
});
