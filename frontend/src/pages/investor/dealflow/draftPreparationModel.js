/**
 * D5456 part 2 (#5456, ADP-02) — the Draft Deal dialog's private-draft rules, pure. The dialog saves a private
 * deal preparation through `adminDealPreparationsApi` (`POST /api/admin/deals`, then `PATCH /api/admin/deals/:uid`
 * with the revision it last saved), and keeps the existing "Live deal now" path (`api.draftDeal`) until ADP-04's
 * release (#5458) can put a private draft live; both retire together then.
 *
 * Nothing here reads `e.message`: every refusal is worded from its code (and the conflict's own fields).
 */

/** The dialog's fields that a private draft stores, each with its D5456 content key and its kind. */
export const PRIVATE_FIELDS = [
  ['description', 'text'], ['website', 'text'], ['instrument', 'text'], ['target_raise', 'number'],
  ['minimum_check', 'number'], ['valuation_cap', 'number'], ['spv_jurisdiction', 'text'], ['carry_pct', 'number'],
  ['management_fee_pct', 'number'], ['closing_deadline', 'text'],
];

const LABELS = {
  description: 'Description', website: 'Website', instrument: 'Instrument', target_raise: 'Target raise',
  minimum_check: 'Minimum check', valuation_cap: 'Valuation cap', spv_jurisdiction: 'SPV jurisdiction',
  carry_pct: 'Carry', management_fee_pct: 'Management fee', closing_deadline: 'Closing deadline',
};
export const fieldLabel = (key) => LABELS[key] || key.replace(/_/g, ' ');

/** The plain sentence the dialog shows beside the private-draft choice, so a live deal still goes the old way. */
export const RELEASE_GAP_NOTE = 'A private draft is for admins only. It cannot go live, reach investors or appear '
  + 'on the board yet: the reviewed release that publishes a draft is not built. If you need a live deal today, '
  + 'choose Live deal now.';

/** One form value as stored: blank is null (never 0), a number field is a number, text is trimmed. */
function stored(kind, raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (t === '') return null;
  if (kind === 'number') {
    const n = Number(t);
    return Number.isFinite(n) ? n : t; // the server refuses a non-number by field; nothing is guessed here
  }
  return t;
}

/** The content a first save sends: only the fields the admin filled in. */
export function initialContent(form) {
  const out = {};
  for (const [k, kind] of PRIVATE_FIELDS) {
    const v = stored(kind, form[k]);
    if (v != null) out[k] = v;
  }
  return out;
}

/** The changes a later save sends: every field whose stored value differs from the last saved content. */
export function changesSince(form, saved) {
  const out = {};
  for (const [k, kind] of PRIVATE_FIELDS) {
    const v = stored(kind, form[k]);
    const was = saved && Object.hasOwn(saved, k) ? saved[k] : null;
    if (v !== was) out[k] = v;
  }
  return out;
}

/** The form's private fields from a saved revision's content (a reload after a conflict). */
export function formFromContent(content) {
  const out = {};
  for (const [k] of PRIVATE_FIELDS) {
    const v = content ? content[k] : null;
    out[k] = v == null ? '' : String(v);
  }
  return out;
}

/** A fresh operation key: 8–128 of `A-Za-z0-9._:-`. */
export function newOperationKey(rand = () => Math.random().toString(36).slice(2, 10)) {
  return `draft-${Date.now().toString(36)}-${rand()}${rand()}`;
}

/**
 * The key to send: the pending one when the payload is the one it was minted for (a retry after "outcome unknown"
 * must reuse it to learn what happened), otherwise a new one. `pending` is `{ key, payload }` or null.
 */
export function operationKeyFor(pending, payload, mint = newOperationKey) {
  return pending && pending.payload === payload ? pending.key : mint();
}

/** Whether a failed save must keep its key for the retry (the server could not say whether it committed). */
export const keepsKey = (e) => !e || !e.status || e.code === 'create_outcome_unknown' || e.code === 'save_outcome_unknown';

const SENTENCES = {
  preparation_mutations_disabled: 'Private drafts are not switched on here yet. Nothing was saved; use Live deal now.',
  not_permitted: 'Only a platform admin can save a private deal draft. Nothing was saved.',
  preparation_create_not_permitted: 'You cannot create a private deal draft. Nothing was saved.',
  preparation_edit_not_permitted: 'You cannot edit this private deal draft. Nothing was saved.',
  invalid_pair: 'Choose a project linked to its company. Nothing was saved.',
  project_not_found: 'That project does not exist or was deleted. Nothing was saved.',
  project_has_no_company: 'Link the project’s company before drafting it privately. Nothing was saved.',
  company_mismatch: 'That project now belongs to a different company. Nothing was saved; reopen the dialog.',
  company_not_found: 'The project’s company does not exist. Nothing was saved.',
  company_archived: 'The project’s company is archived. Nothing was saved.',
  open_preparation_exists: 'This project already has a private draft. Nothing was saved; continue that draft instead.',
  operation_key_reused: 'That save was already used for different values. Nothing was saved; save again.',
  create_outcome_unknown: 'We could not confirm the draft was created. Save again to find out; it will not be created twice.',
  save_outcome_unknown: 'We could not confirm your change was saved. Save again to find out; it will not be saved twice.',
  preparation_not_editable: 'This draft is in review and cannot be edited here. Nothing was saved.',
  issuer_reconciliation_required: 'The project is no longer linked to this draft’s company. Nothing was saved.',
  preparation_not_found: 'That private draft no longer exists on this deployment. Nothing was saved.',
};

/**
 * The sentence for a refused save, worded from the code. A conflict names the revision that won and which of the
 * admin's fields it changed; invalid fields are named by label. Never the thrown text.
 */
export function refusalSentence(e) {
  const code = e && e.code;
  const data = (e && e.data) || {};
  if (code === 'revision_conflict') {
    const rev = data.current && Number.isFinite(Number(data.current.revision_no)) ? ` (now revision ${Number(data.current.revision_no)})` : '';
    const keys = Array.isArray(data.fields) ? data.fields.map((f) => fieldLabel(String(f.key))) : [];
    const which = keys.length ? ` It differs from yours in: ${keys.join(', ')}.` : '';
    return `Someone else saved this draft after you opened it${rev}. Nothing was saved.${which} Load the latest version and reapply your changes.`;
  }
  if (code === 'invalid_fields') {
    const keys = data.fields && typeof data.fields === 'object' ? Object.keys(data.fields).map(fieldLabel) : [];
    return keys.length ? `Check ${keys.join(', ')}. Nothing was saved.` : 'Some fields are not valid. Nothing was saved.';
  }
  if (code && SENTENCES[code]) return SENTENCES[code];
  if (e && !e.status) return 'The draft could not be saved: the connection failed. Save again; it will not be saved twice.';
  return 'The draft could not be saved. Nothing was changed; try again.';
}

/** The line shown after a save: which revision is held for the next save. */
export function savedLine(revisionNo, unchanged = false) {
  if (unchanged) return `Nothing changed since revision ${revisionNo}.`;
  return `Saved privately as revision ${revisionNo}. It is not live; nobody outside the admins can see it.`;
}
