// D6078: spreadsheet-safe CSV from the venture rows already loaded by each tab.
import { toMajorString } from '../../../lib/money.js';
import { STAGE_LABEL, STATUS_OPTIONS } from './capRelModel.js';

const safeCell = (value) => typeof value === 'string' && /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
const safeRows = (rows) => rows.map((row) => row.map(safeCell));

export function pipelineCsv(items) {
  return {
    header: ['Name', 'Firm', 'Email', 'Stage', 'Fit', 'Next step', 'Due', 'Last contact', 'Status', 'Amount', 'Currency'],
    rows: safeRows(items.map((p) => [
      p.name, p.firm, p.email, Object.hasOwn(STAGE_LABEL, p.stage) ? STAGE_LABEL[p.stage] : p.stage, p.fit, p.next_step,
      p.next_step_due, p.last_contact, STATUS_OPTIONS.find(({ value }) => value === p.commit_status)?.label,
      p.amount_cents == null ? p.amount : toMajorString(p.amount_cents, p.currency), p.currency,
    ])),
  };
}

export function commitmentsCsv(read) {
  return {
    header: ['Investor', 'Amount', 'Status', 'Source', 'Close'],
    rows: safeRows((read?.investors ?? []).flatMap((investor) => (investor.lines ?? []).map((line) => [
      investor.name, toMajorString(line.cents, line.currency),
      line.status === 'not_recorded' ? null : line.status_label, line.source_label, line.close_name,
    ]))),
  };
}
