/**
 * D4812 part 2 (#4812, boards FA-03 B–E and FA-08) — the money-action flow's
 * words and checks, pure: Prepare → Review → Confirm → Authenticate → Receipt.
 *
 * Every material act shows its exact effect before it runs, and its button
 * names the act and the amount ("Issue $450,000.00 capital call"), never a
 * bare "Confirm". A Super Admin act asks for the authenticator code in the
 * flow (the Worker's step-up); an Admin act's Authenticate step is "not
 * required" and says so. While the act table is unread the flow stops before
 * Confirm: permissions that cannot be verified never get a money button.
 *
 * Each effect is a figure the screen read, or `Not recorded` with its reason:
 * a missing figure is never drawn as $0.
 */
import { actRow, money } from './fundAdminModel.js';

export const STEPS = Object.freeze(['Prepare', 'Review', 'Confirm', 'Authenticate', 'Receipt']);

/** The step index (0–4) for a flow state, and which steps an act skips. */
export function stepsFor(tier) {
  return STEPS.map((label, i) => ({ i, label, skipped: label === 'Authenticate' && tier !== 'super_admin' }));
}

export const UNVERIFIED = Object.freeze({
  title: 'Permissions could not be verified.',
  line: 'Financial actions are temporarily unavailable.',
});

/**
 * Whether this viewer may take `act`: `allowed`, `refused` (with the act
 * table's sentence) or `unverified` (the table did not read). The Worker still
 * decides; this only says which control to draw.
 */
export function actGate(access, act) {
  if (!access) return { state: 'unverified' };
  const row = actRow(access, act);
  // As FundActControl: an act the table does not list is not refused here; the Worker decides (and asks its step-up).
  if (!row) return { state: 'allowed', tier: null };
  // A row without `tier` is a Super Admin's when it carries a refusal sentence: in FUND_ACTS only those do.
  if (row?.allowed === true) return { state: 'allowed', tier: row.tier || (row.sentence ? 'super_admin' : 'admin') };
  return { state: 'refused', sentence: row?.sentence || 'This act is not open to you.' };
}

/** "Issue $450,000.00 capital call": the act and the amount, for the one button that runs it. */
export function actButton(verb, cents, noun) {
  const m = money(cents);
  return m ? `${verb} ${m} ${noun}` : `${verb} ${noun}`;
}

/** The authenticator code: six digits, or the sentence that says what is wrong. */
export function checkCode(raw) {
  const code = String(raw ?? '').replace(/\s+/g, '');
  if (!code) return { error: 'Enter the 6-digit code from your authenticator app.' };
  if (!/^\d{6}$/.test(code)) return { error: 'The code is six digits.' };
  return { code };
}

const nr = (reason) => ({ notRecorded: true, reason });
const cents = (v) => (v == null || !Number.isSafeInteger(Number(v)) ? null : Number(v));

/**
 * FA-03 B: a capital call's exact effect. `summary` is the call ledger's own
 * (`GET /api/funds/:id/capital-calls`); without it, Current and After are
 * Not recorded, never 0.
 */
export function callEffects({ fund, terms, preview, rows, summary }) {
  const now = cents(summary?.outstanding_cents);
  const add = cents(preview?.amount_cents);
  return [
    ['Fund', fund?.name || 'Not recorded'],
    ['Amount', money(add) ?? nr('No amount was previewed.')],
    ['LPs affected', String(rows.length)],
    ['Due date', terms?.due || nr('No due date was chosen.')],
    ['Current outstanding', now != null ? money(now) : nr('The call ledger did not read.')],
    ['Outstanding after issue', now != null && add != null ? money(now + add) : nr('Needs the current outstanding.')],
    ['Documents', 'Call notices are issued separately, from Call notices, once the call exists.'],
  ];
}

/** FA-03 C: what issuing does, said before the code is asked for. */
export function callConsequences({ fund, terms, preview, rows }) {
  return [
    `Writes ${preview?.next_call_number != null ? `call ${preview.next_call_number}` : 'a call'} on ${fund?.name || 'this fund'}: one line per LP, ${rows.length} in all.`,
    `Each line is due ${terms?.due || 'on the date chosen'}.`,
    'No notice is sent by issuing. Notices are issued from Call notices.',
  ];
}

/** A receipt's exact effect on its line. */
export function receiptEffects({ line, call, body }) {
  const before = cents(line?.outstanding_cents);
  const amount = cents(body?.amount_cents);
  return [
    ['LP', line?.lp_name || 'Name not recorded'],
    ['Call', call?.call_number != null ? `Call ${call.call_number}` : 'Issued before calls were numbered'],
    ['Amount received', money(amount) ?? nr('No amount.')],
    ['Received on', body?.received_on || nr('No date.')],
    ['Outstanding on this line', before != null && amount != null ? `${money(before)} → ${money(Math.max(0, before - amount))}` : nr('The line did not read.')],
    ['Reference', body?.reference || 'None given'],
  ];
}

/** A distribution's exact effect, from the job's own preview. */
export function distributionEffects({ fund, split }) {
  const lines = Array.isArray(split?.lines) ? split.lines : [];
  const toLps = lines.reduce((n, l) => n + (cents(l.amount_cents) ?? 0), 0);
  return [
    ['Fund', fund?.name || 'Not recorded'],
    ['Proceeds', money(split?.proceeds_cents) ?? nr('No proceeds were previewed.')],
    ['Carry withheld', cents(split?.carry_withheld_cents) != null ? money(split.carry_withheld_cents) : nr('The preview gives no carry figure.')],
    ['To LPs', money(toLps)],
    ['LP lines', String(lines.length)],
    ['Payment', 'Nothing is sent from here: each line is marked paid when the money has gone.'],
  ];
}

/** The receipt's time: when the server's answer reached this page, in UTC. */
export function confirmedAt(date = new Date()) {
  return `${date.toISOString().slice(11, 19)} UTC`;
}

// ─────────────────────────────────────────────────────────── part 5: the remaining acts

const pct = (bps) => (Number.isFinite(Number(bps)) && bps != null ? `${(Number(bps) / 100).toFixed(2)}%` : null);
const rate = (r) => (r == null || r === '' || !Number.isFinite(Number(r)) ? null : `${(Number(r) * 100).toFixed(2)}%`);

/** Confirm fee terms: the rate, from when, on which LPA clause, and that it becomes the fund's terms. */
export function feeTermsEffects(fund, t) {
  return [
    ['Fund', fund?.name || 'Not recorded'],
    ['Annual rate', pct(t?.annual_bps) ?? nr('No rate is recorded on these terms.')],
    ['Effective from', t?.effective_from || nr('No start date is recorded.')],
    ['LPA reference', t?.lpa_reference || nr('No LPA reference is recorded.')],
    ['Status', 'Draft → Confirmed'],
  ];
}

/** Issue a fee period: the previewed figures, and that nothing moves money. */
export function feePeriodEffects(fund, p) {
  const t = p?.totals || {};
  const m = (v, why) => (cents(v) != null ? money(v) : nr(why));
  return [
    ['Fund', fund?.name || 'Not recorded'],
    ['Quarter', p?.quarter || nr('No quarter.')],
    ['Gross fee', m(t.gross_cents, 'The preview gives no gross fee.')],
    ['Catch-up', m(t.catch_up_cents, 'The preview gives no catch-up.')],
    ['Offset applied', m(t.applied_cents, 'The preview gives no offset.')],
    ['Net fee', m(t.net_cents, 'The preview gives no net fee.')],
    ['Payment', 'Issuing records the amounts and reference codes. Nothing moves money.'],
  ];
}

/** Issue a report pack: what, for which period, frozen by its digest. */
export function reportIssueEffects(d, sha) {
  return [
    ['Pack', `${String(d?.kind || 'report').replace(/_/g, ' ')}`],
    ['Period', d?.period_label || nr('No period label is recorded.')],
    ['Figures', sha ? `${String(sha).slice(0, 12)}… (frozen on issue)` : nr('The pack was not opened.')],
    ['After issue', 'Locked; a correction is a new issue.'],
  ];
}

/** Confirm a bank match: the transaction, what it pays, and that it records. */
export function matchEffects(m, target) {
  return [
    ['Bank transaction', `${m?.counterparty_name || 'No counterparty recorded'} · ${m?.posted_on || 'not posted'}`],
    ['Amount', cents(m?.amount_cents) != null ? money(m.amount_cents) : nr('No amount is recorded.')],
    ['Pays', target],
    ['Effect', 'Records the match; it moves no money.'],
  ];
}

/** Change the economics: each rate before → after, and the reason kept. */
export function economicsEffects(fund, body) {
  const pair = (from, to) => `${rate(from) ?? 'Not recorded'} → ${rate(to) ?? 'Not recorded'}`;
  return [
    ['Fund', fund?.name || 'Not recorded'],
    ['Carry', 'carried_interest' in (body || {}) ? pair(fund?.carried_interest, body.carried_interest) : `${rate(fund?.carried_interest) ?? 'Not recorded'} (unchanged)`],
    ['Management fee', 'management_fee' in (body || {}) ? pair(fund?.management_fee, body.management_fee) : `${rate(fund?.management_fee) ?? 'Not recorded'} (unchanged)`],
    ['Reason', body?.reason || nr('No reason given.')],
    ['Effect', 'The distribution job withholds carry at the new rate from its next run.'],
  ];
}

/** Record a valuation mark: the position, value, date and source; the previous mark beside it. */
export function markEffects(position, body) {
  const prev = position?.marked ? cents(position.value_cents) : null;
  return [
    ['Position', position?.company_name || position?.round_name || `Position ${position?.id ?? ''}`],
    ['Value', cents(body?.value_cents) != null ? money(body.value_cents) : nr('No value.')],
    ['Valuation date', body?.valuation_date || nr('No date.')],
    ['Previous mark', prev != null ? money(prev) : nr('No earlier mark is recorded.')],
    ['Source', body?.source || nr('No source.')],
  ];
}
