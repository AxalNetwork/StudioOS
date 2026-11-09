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
  if (row?.allowed === true) return { state: 'allowed', tier: row.tier || null };
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
