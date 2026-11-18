/**
 * #6235 — Create a fund record (FV1b) and Edit terms on the fund page, for the
 * general partner of record: what the two forms check and send, with no React.
 *
 * THE WORKER'S RULES, CHECKED BEFORE BUILDING (#6235 "confirm first"):
 *   · `POST /api/funds` runs `requireFundCreator` (the Institutional tier; an
 *     admin passes) and `assertAdminAct(..., 'fund.create')`, which refuses a
 *     support session and asks nothing else of a non-admin. No step-up.
 *   · `PATCH /api/funds/:id` runs `requireFundGp`. A change to the fee or the
 *     carry is the `fund.economics` act: for an admin that is a Super Admin act
 *     with step-up; for a non-admin GP of record only the support-session
 *     refusal and the recovery cool-off apply. The `reason` is optional there,
 *     10 to 500 characters when sent, and kept on the audit row.
 *   · `FUND_PATCHABLE` takes name, vintage_year, fund_size_cents, status,
 *     carried_interest and management_fee among others; this form sends only
 *     those six.
 *
 * NEVER A RATE THE GP DID NOT TYPE. The canvas's line "Left blank, the
 * platform uses 2% and 20%" is not built: a blank rate stored as 20% would
 * then read as a recorded carry everywhere. Both rates are asked for, as the
 * admin console's New fund asks (`checkNewFund`).
 *
 * NOTHING IS ASSUMED SAVED. A Worker refusal is shown as its own sentence with
 * "Nothing was saved."; a request that got no answer says so and asks for a
 * refresh before trying again, because the write may have landed.
 */
import {
  FUND_REASON_MAX, FUND_REASON_MIN, FUND_STATUSES, checkFacts, checkNewFund, factsForm, percentToFraction, rateInput,
} from '../admin/fundAdmin/fundsModel.js';
import { refusalText } from '../admin/fundAdmin/fundAdminModel.js';

export { FUND_REASON_MAX, FUND_REASON_MIN, FUND_STATUSES };

export const NO_FUND_KICKER = 'No fund record';
export const NO_FUND_TITLE = 'No fund to operate yet.';
export const NO_FUND_LINE = 'You hold the Institutional tier, but no fund names you as its general partner of record. Create one to open the LP register, calls, the ledger and reporting.';
export const CREATING_DOES = 'You become the general partner of record of the new fund. An LPA draft is queued for it; nothing is sent to anyone and no LP is invited.';
export const RATES_LINE = 'Both rates are required. A blank is never filled in as 2% or 20%.';
export const MY_COMMITMENT_LINE = 'Your own commitments are in My commitment.';
export const EDIT_TERMS_LINE = 'Name, vintage, size, status, management fee and carry, as recorded on this fund. A change to the fee or the carry asks a reason, kept on the fund’s audit record.';
export const NOTHING_SAVED = 'Nothing was saved.';
export const NO_ANSWER_CREATE = 'No answer came back, so it is not known whether the fund was created. Refresh before trying again.';
export const NO_ANSWER_SAVE = 'No answer came back, so it is not known whether the terms were saved. Reopen the fund before trying again.';
export const NOTHING_CHANGED = 'Nothing changed.';
export const ECONOMICS_REASON = `A change to the fee or the carry needs a reason of ${FUND_REASON_MIN} to ${FUND_REASON_MAX} characters. It is kept on the fund’s audit record.`;
export const REASON_LENGTH = `A reason is ${FUND_REASON_MIN} to ${FUND_REASON_MAX} characters.`;

/** The create form, empty. Status starts at Fundraising, as the Worker's own default. */
export const blankFund = () => ({ name: '', vintage: '', size: '', fee: '', carry: '', status: 'fundraising' });

/** The create form as the `POST /api/funds` body, or `{ error }`. */
export const createFundBody = (form) => checkNewFund(form);

/** A recorded fund (`GET /api/funds/:id`) as the Edit terms form shows it. */
export function termsForm(fund) {
  return { ...factsForm(fund), fee: rateInput(fund?.management_fee), carry: rateInput(fund?.carried_interest), reason: '' };
}

const recordedRate = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** One rate field against what is stored: `{ skip }`, `{ value }` or `{ error }`. A blank is allowed only where nothing is recorded. */
function rateField(text, stored, label) {
  if (!String(text ?? '').trim()) return recordedRate(stored) ? { error: `Enter the ${label} as a percent from 0 to 100.` } : { skip: true };
  const value = percentToFraction(text);
  if (value === null) return { error: `Enter the ${label} as a percent from 0 to 100.` };
  return recordedRate(stored) && Math.abs(Number(stored) - value) < 1e-9 ? { skip: true } : { value };
}

/**
 * Edit terms as one `PATCH /api/funds/:id` body of what changed, or `{ error }`.
 * A changed fee or carry needs a reason; a reason given with any other change
 * is checked and sent too.
 */
export function termsPatch(form, fund) {
  const facts = checkFacts(form, fund);
  if (facts.error && facts.error !== NOTHING_CHANGED) return { error: facts.error };
  const body = { ...(facts.body || {}) };
  const fee = rateField(form?.fee, fund?.management_fee, 'management fee');
  if (fee.error) return { error: fee.error };
  const carry = rateField(form?.carry, fund?.carried_interest, 'carry');
  if (carry.error) return { error: carry.error };
  if (!fee.skip) body.management_fee = fee.value;
  if (!carry.skip) body.carried_interest = carry.value;
  if (!Object.keys(body).length) return { error: NOTHING_CHANGED };
  const economics = !fee.skip || !carry.skip;
  const reason = String(form?.reason ?? '').trim();
  if (economics || reason) {
    if (reason.length < FUND_REASON_MIN || reason.length > FUND_REASON_MAX) return { error: economics ? ECONOMICS_REASON : REASON_LENGTH };
    body.reason = reason;
  }
  return { body };
}

/** A Worker refusal as its own sentence, then that nothing was saved. */
export function refusalLine(e, fallback) {
  const said = refusalText(e, fallback);
  const sentence = /[.!?]$/.test(said) ? said : `${said}.`;
  return /nothing was (saved|changed|written)/i.test(sentence) ? sentence : `${sentence} ${NOTHING_SAVED}`;
}

/** Did the Worker answer? A thrown error with an HTTP status did; a network failure did not. */
const answered = (e) => Number.isInteger(e?.status) && e.status > 0;

/** Create a fund through `client.create`; `{ fund, lpaStatus }` or `{ error }`. */
export async function createFund(client, form) {
  const out = createFundBody(form);
  if (out.error) return { error: out.error };
  try {
    const r = await client.create(out.body);
    if (!Number.isSafeInteger(r?.fund?.id) || r.fund.id <= 0) return { error: NO_ANSWER_CREATE };
    return { fund: r.fund, lpaStatus: r.lpa_status ?? null };
  } catch (e) {
    return { error: answered(e) ? refusalLine(e, 'The fund could not be created') : NO_ANSWER_CREATE };
  }
}

/** Save Edit terms through `client.update`; `{ fund }` or `{ error }`. */
export async function saveTerms(client, fundId, form, fund) {
  const out = termsPatch(form, fund);
  if (out.error) return { error: out.error };
  try {
    const r = await client.update(fundId, out.body);
    if (!r?.fund || Number(r.fund.id) !== Number(fundId)) return { error: NO_ANSWER_SAVE };
    return { fund: r.fund };
  } catch (e) {
    return { error: answered(e) ? refusalLine(e, 'The terms could not be saved') : NO_ANSWER_SAVE };
  }
}
