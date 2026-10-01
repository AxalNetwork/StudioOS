/**
 * The Calls page's arithmetic and labels, kept apart from the page so a Node
 * test can hold them (D371).
 *
 * Money arrives from the worker as integer cents and leaves as integer cents;
 * nothing here turns a cent figure into a float to do sums on it. A figure the
 * worker did not send is `null` and prints as absent, never as $0.00.
 */

/** `12345` → `$123.45`; null stays null so the caller decides what absence reads as. */
export function formatCents(cents) {
  if (cents == null || !Number.isSafeInteger(Number(cents))) return null;
  const n = Number(cents);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A typed dollar amount to whole cents, without passing through a float:
 * `1234.5` → 123450. Null for anything that is not a positive amount with at
 * most two decimals, so a GP typing `12.345` is told, not rounded.
 */
export function parseDollarsToCents(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** A share of a whole, as a percentage with one decimal, or null when there is no whole. */
export function percent(part, whole) {
  if (part == null || whole == null || Number(whole) <= 0) return null;
  return `${((Number(part) / Number(whole)) * 100).toFixed(1)}%`;
}

const STATE_LABEL = {
  paid: 'Paid',
  part_received: 'Part received',
  overdue: 'Overdue',
  pending: 'Pending',
};

/** The line's state as the pill reads it. A line paid before receipts existed says so. */
export function lineStateLabel(line) {
  if (line?.state === 'paid' && line.receipt_recorded === false) return 'Paid · no receipt recorded';
  return STATE_LABEL[line?.state] || 'Pending';
}

/** The Age column: days overdue, the date paid, or the due date — never a guess. */
export function lineAge(line) {
  if (!line) return '';
  if (line.state === 'paid') return line.paid_date ? `Paid ${String(line.paid_date).slice(0, 10)}` : 'Paid, date not recorded';
  if (line.state === 'overdue' && Number.isInteger(line.days_overdue)) {
    return `${line.days_overdue} day${line.days_overdue === 1 ? '' : 's'} overdue`;
  }
  return line.due_date ? `Due ${String(line.due_date).slice(0, 10)}` : 'No due date recorded';
}

/** What the KYC note under an LP's name says. No account is not "pending". */
export function kycLabel(line) {
  if (line?.has_account === false) return 'No platform account · no KYC record';
  const s = String(line?.kyc_status || '').toLowerCase();
  if (!s) return 'KYC not recorded';
  return `KYC ${s.replace(/_/g, ' ')}`;
}

/**
 * The lines a filter shows. `latest`: the newest numbered call's lines.
 * `all`: every numbered call. `outstanding`: every line, numbered or not,
 * that still owes something.
 */
export function linesFor(filter, ledger) {
  const calls = Array.isArray(ledger?.calls) ? ledger.calls : [];
  const legacy = Array.isArray(ledger?.unnumbered) ? ledger.unnumbered : [];
  if (filter === 'outstanding') {
    const withCall = calls.flatMap((c) => c.lines.map((l) => ({ ...l, call_number: c.call_number })));
    return [...withCall, ...legacy.map((l) => ({ ...l, call_number: null }))]
      .filter((l) => l.state !== 'paid' && Number(l.outstanding_cents) > 0);
  }
  if (filter === 'all') return calls.flatMap((c) => c.lines.map((l) => ({ ...l, call_number: c.call_number })));
  return calls[0] ? calls[0].lines.map((l) => ({ ...l, call_number: calls[0].call_number })) : [];
}

/** The receipt entries of a ledger read, as the wire trail and its export show them. */
export function wireRows(ledgerRead) {
  const entries = Array.isArray(ledgerRead?.entries) ? ledgerRead.entries : [];
  return entries.filter((e) => e.kind === 'receipt');
}
