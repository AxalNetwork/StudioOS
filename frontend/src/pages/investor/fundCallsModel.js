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
  withdrawn: 'Withdrawn',
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
  if (line.state === 'withdrawn') return 'Call withdrawn';
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

/** D6238: an LP with a platform account whose KYC is not approved. No account is not this. */
export function kycFlagged(line) {
  return line?.has_account !== false && String(line?.kyc_status || '').toLowerCase() !== 'approved';
}

/**
 * D6238: the New call preview's KYC flag. An LP with a platform account whose
 * KYC is not approved is called out before issue; an LP with no account has
 * no KYC record, which is said apart and never counted as pending. Null when
 * every billed LP is approved.
 */
export function kycFlag(previewLines) {
  const lines = Array.isArray(previewLines) ? previewLines : [];
  const name = (l) => l.name || l.email || `LP #${l.lp_id}`;
  const notApproved = lines.filter(kycFlagged);
  const noAccount = lines.filter((l) => l.has_account === false);
  if (!notApproved.length && !noAccount.length) return null;
  const parts = [];
  if (notApproved.length) {
    parts.push(`${notApproved.length === 1 ? '1 LP has' : `${notApproved.length} LPs have`} KYC that is not approved: ${notApproved.map(name).join(', ')}.`);
  }
  if (noAccount.length) {
    parts.push(`${noAccount.length === 1 ? '1 LP has' : `${noAccount.length} LPs have`} no platform account, so no KYC record: ${noAccount.map(name).join(', ')}.`);
  }
  parts.push('Their lines are issued like the rest; the KYC column shows it on every line.');
  return { notApproved: notApproved.length, noAccount: noAccount.length, sentence: parts.join(' ') };
}

/** D6238: a call's lines that still owe part or all of their share. */
export function linesBehind(call) {
  const lines = Array.isArray(call?.lines) ? call.lines : [];
  return lines.filter((l) => l.state !== 'withdrawn' && l.state !== 'paid' && Number(l.outstanding_cents) > 0);
}

/** The newest numbered call that is not withdrawn, or null. */
export function latestCall(ledger) {
  const calls = Array.isArray(ledger?.calls) ? ledger.calls : [];
  return calls.find((c) => !c.withdrawn) || null;
}

/**
 * D6238: the 'All calls' list — one row per numbered call, newest first, with
 * the figures the Worker summed from its lines. Collected is what the
 * receipts recorded; nothing here is typed or defaulted.
 */
export function callRows(ledger) {
  const calls = Array.isArray(ledger?.calls) ? ledger.calls : [];
  return calls.map((c) => ({
    id: c.id,
    call_number: c.call_number,
    issued_on: c.created_at ? String(c.created_at).slice(0, 10) : null,
    due_date: c.due_date ?? null,
    amount_cents: c.amount_cents,
    collected_cents: c.withdrawn ? null : c.received_cents,
    outstanding_cents: c.withdrawn ? null : c.outstanding_cents,
    lines_behind: c.withdrawn ? null : linesBehind(c).length,
    line_count: Array.isArray(c.lines) ? c.lines.length : c.line_count,
    withdrawn: Boolean(c.withdrawn),
    corrected: Array.isArray(c.amendments) && c.amendments.some((a) => a.kind !== 'withdrawn'),
  }));
}

/**
 * D6238: whether a call can be withdrawn, and the sentence that says why not.
 * The Worker holds the same rule and one more the page cannot see (a linked
 * management-fee line); it refuses with its own sentence when that applies.
 */
export function withdrawRule(call) {
  if (!call) return { allowed: false, reason: 'The call was not read.' };
  if (call.withdrawn) {
    const w = call.withdrawal;
    return { allowed: false, reason: w ? `Withdrawn ${String(w.at).slice(0, 10)}${w.by_name ? ` by ${w.by_name}` : ''}.` : 'This call is withdrawn.' };
  }
  const lines = Array.isArray(call.lines) ? call.lines : [];
  const received = lines.filter((l) => Number(l.receipt_count) > 0 || Number(l.received_cents) > 0 || l.state === 'paid');
  if (received.length) {
    return {
      allowed: false,
      reason: `${received.length === 1 ? '1 line has' : `${received.length} lines have`} a receipt recorded, so this call cannot be withdrawn. Correct its due date or purpose instead.`,
    };
  }
  return { allowed: true, reason: 'No receipt is recorded on any line, so this call can be withdrawn.' };
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
  const latest = latestCall(ledger);
  return latest ? latest.lines.map((l) => ({ ...l, call_number: latest.call_number })) : [];
}

/** The receipt entries of a ledger read, as the wire trail and its export show them. */
export function wireRows(ledgerRead) {
  const entries = Array.isArray(ledgerRead?.entries) ? ledgerRead.entries : [];
  return entries.filter((e) => e.kind === 'receipt');
}
