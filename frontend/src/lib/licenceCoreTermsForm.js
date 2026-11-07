// D4694 (#4694) — Step 4's core terms form (fee, term, shares, dates), as pure
// functions so the rules can be tested without a page.
//
// THE RULE THIS FILE HOLDS: a save carries only what its user changed, and the
// revision the form was read at. An editor that sent every field would carry a
// stale untouched field over a newer value (renew the licence while Terms is
// open, then edit only the fee, and the renewal date would go back to what the
// form first showed).
//
//   coreFormFrom(licence)            the form's text values, from a licence row
//   dirtyKeys(form, base)            the fields the user changed since `base`
//   reconcileCoreForm(state, licence) a refreshed licence arrives: untouched fields
//                                    take the server's value, edited ones keep the
//                                    user's text, and the form moves to the new revision
//   buildCoreSave({ form, base, revision, reason })  the PATCH body, or the errors
//
// The Worker is the authority on ranges (`validateCoreTermsBody`); this file
// refuses only what cannot be sent at all (not a number, no reason).

export const CORE_FIELDS = ['term_years', 'annual_fee', 'currency', 'revenue_share_bps', 'token_split_bps', 'starts_on', 'renews_on'];

/** The wire key of each form field. The fee is typed in whole currency units and sent in cents. */
const WIRE = { annual_fee: 'annual_fee_cents' };
const wireKey = (k) => WIRE[k] || k;

/** A licence row as the form's text values. A term that is not recorded reads as the empty string, never 0. */
export function coreFormFrom(licence) {
  const l = licence || {};
  const text = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    term_years: text(l.term_years),
    annual_fee: l.annual_fee_cents === null || l.annual_fee_cents === undefined ? '' : String(Math.round(Number(l.annual_fee_cents)) / 100),
    currency: l.currency || 'EUR',
    revenue_share_bps: text(l.revenue_share_bps),
    token_split_bps: text(l.token_split_bps),
    starts_on: text(l.starts_on),
    renews_on: text(l.renews_on),
  };
}

/** The revision of a licence row, 0 when the column is absent. */
export const coreRevision = (licence) => {
  const n = Number(licence?.terms_revision ?? 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

/** Fields whose text differs from the base the form was last synced to. */
export function dirtyKeys(form, base) {
  return CORE_FIELDS.filter((k) => String(form?.[k] ?? '') !== String(base?.[k] ?? ''));
}

/**
 * A refreshed licence arrives while the form is open. Untouched fields take the
 * server's value; edited fields keep the user's text. `moved` names the edited
 * fields whose server value changed under them, so the screen can say so
 * instead of letting the save overwrite a newer value unseen.
 */
export function reconcileCoreForm({ form, base }, licence) {
  const next = coreFormFrom(licence);
  const dirty = new Set(dirtyKeys(form, base));
  const merged = {};
  const moved = [];
  for (const k of CORE_FIELDS) {
    if (dirty.has(k)) {
      merged[k] = form[k];
      if (String(next[k]) !== String(base?.[k] ?? '') && String(next[k]) !== String(form[k])) moved.push(k);
    } else merged[k] = next[k];
  }
  return { form: merged, base: next, revision: coreRevision(licence), moved };
}

const parseNumber = (text) => {
  const t = String(text).trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: 'must be a number' };
};

/**
 * The PATCH body for what changed. `reason` is required (the licence's history
 * keeps it) and so is at least one changed field. Nothing is clamped here; the
 * Worker refuses out-of-range values and the screen shows its sentence.
 */
export function buildCoreSave({ form, base, revision, reason }) {
  const errors = {};
  const body = {};
  for (const k of dirtyKeys(form, base)) {
    const key = wireKey(k);
    if (k === 'currency') { body[key] = String(form[k]).trim().toUpperCase(); continue; }
    if (k === 'starts_on' || k === 'renews_on') { body[key] = String(form[k]).trim() || null; continue; }
    const n = parseNumber(form[k]);
    if (!n.ok) { errors[k] = n.message; continue; }
    // The fee is typed in currency units and travels in whole cents.
    body[key] = k === 'annual_fee' && n.value !== null ? Math.round(n.value * 100) : n.value;
  }
  const why = String(reason ?? '').trim();
  if (!why) errors.reason = 'Say why these terms are changing. It is kept in the licence\'s history.';
  if (!Object.keys(errors).length && !Object.keys(body).length) errors.form = 'Nothing has changed.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, body: { ...body, reason: why, expected_revision: revision } };
}
