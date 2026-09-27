/**
 * The revenue ledger's page-side rules (D363). Pure, so node --test runs them.
 *
 * Amounts are the Worker's integer cents and every sum here stays in cents; the
 * one conversion to a decimal is `fmtLedgerCents`. Verification comes from the
 * Worker (`verified` | `supported` | `manual`) and is only ever read here.
 */

export const LEDGER_TYPES = [
  { k: 'recurring', label: 'Recurring' },
  { k: 'pilot', label: 'Pilot' },
  { k: 'one_time', label: 'One-time' },
  { k: 'deposit', label: 'Deposit' },
];

export const LEDGER_STATUS = {
  verified: { label: 'Verified', note: 'Synced from a Stripe charge' },
  supported: { label: 'Supported', note: 'Proof document attached' },
  manual: { label: 'Manual', note: 'No evidence attached' },
};

/** The canvas's five filters, in its order. */
export const LEDGER_FILTERS = [
  { k: 'all', label: 'All', test: () => true },
  { k: 'recurring', label: 'Recurring', test: (e) => e.revenue_type === 'recurring' },
  { k: 'pilot', label: 'Pilots & deposits', test: (e) => e.revenue_type === 'pilot' || e.revenue_type === 'deposit' },
  { k: 'verified', label: 'Verified', test: (e) => e.verification === 'verified' },
  { k: 'unverified', label: 'Unverified', test: (e) => e.verification === 'manual' },
];

/** Integer cents → "$1,200.50"; null for anything that is not an integer. */
export function fmtLedgerCents(cents) {
  if (!Number.isInteger(cents)) return null;
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0,
  });
}

/**
 * The ledger's totals, all in integer cents, from the rows the Worker returned.
 * `verifiedShare` is null while no entry could be verified (no Stripe charge
 * sync exists): 0% would claim entries were checked and failed.
 */
export function summarizeLedger(entries) {
  const rows = Array.isArray(entries) ? entries.filter((e) => Number.isInteger(e?.amount_cents)) : [];
  const sum = (pred) => rows.filter(pred).reduce((a, e) => a + e.amount_cents, 0);
  const totalCents = sum(() => true);
  const byVerification = {
    verified: sum((e) => e.verification === 'verified'),
    supported: sum((e) => e.verification === 'supported'),
    manual: sum((e) => e.verification === 'manual'),
  };
  const byType = Object.fromEntries(LEDGER_TYPES.map((t) => [t.k, sum((e) => e.revenue_type === t.k)]));
  const anyVerifiable = rows.some((e) => e.source === 'stripe');
  return {
    count: rows.length,
    totalCents,
    byVerification,
    byType,
    customers: new Set(rows.map((e) => String(e.customer).trim().toLowerCase())).size,
    proofBacked: rows.filter((e) => e.proof_document_id != null).length,
    verifiedShare: anyVerifiable && totalCents > 0 ? byVerification.verified / totalCents : null,
  };
}

/**
 * Parse CSV text into rows of cells. Handles quoted cells, doubled quotes and
 * commas or newlines inside quotes; a trailing blank line is dropped.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** The four ledger fields a CSV column can map to. */
export const IMPORT_FIELDS = [
  { k: 'customer', label: 'Customer', hints: ['customer', 'company', 'client', 'name'] },
  { k: 'amount', label: 'Amount', hints: ['amount', 'total', 'value', 'paid', 'revenue'] },
  { k: 'received_on', label: 'Date received', hints: ['date', 'received', 'paid on', 'created'] },
  { k: 'revenue_type', label: 'Type', hints: ['type', 'kind', 'category'] },
];

/** A first guess at which header feeds which field; the founder confirms it. */
export function guessMapping(headers) {
  const lower = (headers || []).map((h) => String(h).trim().toLowerCase());
  const mapping = {};
  for (const f of IMPORT_FIELDS) {
    const idx = lower.findIndex((h) => f.hints.some((hint) => h.includes(hint)));
    mapping[f.k] = idx >= 0 ? idx : null;
  }
  return mapping;
}

/**
 * A date cell → YYYY-MM-DD, or the cell unchanged (the Worker then refuses it
 * with its own reason). Accepts ISO and US month/day/year; never guesses a
 * day-first date, which is ambiguous.
 */
export function normalizeCsvDate(raw) {
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  // Month first only when it can be a month: "18/07/2026" is day-first, and
  // that stays as typed for the Worker to refuse rather than be reshaped.
  if (us && Number(us[1]) >= 1 && Number(us[1]) <= 12) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return s;
}

/**
 * Mapped rows for the import request. `defaultType` fills the type only when
 * no column is mapped to it; an amount stays the cell's TEXT, so the Worker
 * parses it exactly. Rows missing a mapped customer or amount are still sent,
 * and come back refused with their reason rather than silently dropped.
 */
export function mapImportRows(rows, mapping, defaultType) {
  const cell = (r, k) => (mapping[k] == null ? '' : String(r[mapping[k]] ?? '').trim());
  return (rows || []).map((r) => ({
    customer: cell(r, 'customer'),
    amount: cell(r, 'amount'),
    received_on: normalizeCsvDate(cell(r, 'received_on')),
    revenue_type: mapping.revenue_type == null ? defaultType : cell(r, 'revenue_type'),
  }));
}
