/** Private survey presentation and supported mapping rules from D5828/D5829 (#5830). */
const TYPES = { multiple_choice: 'choice', dropdown: 'choice', picture_choice: 'choice', yes_no: 'boolean', legal: 'boolean', opinion_scale: 'number', rating: 'number', nps: 'number', number: 'number', short_text: 'text', long_text: 'text' };
export const mappingShape = type => Object.hasOwn(TYPES, type) ? TYPES[type] : null;
export const typeformCount = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Not recorded';
export function mappingInput(field, draft) {
  const shape = mappingShape(field?.type);
  if (!shape || !draft.kind) return null;
  const out = { field_id: field.id, kind: draft.kind, keep_text: shape === 'text' && draft.keep_text === true };
  if (shape === 'choice') { out.choices = [...new Set((draft.choices || '').split(',').map(s => s.trim()).filter(Boolean))]; if (!out.choices.length) return null; }
  if (shape === 'boolean') { if (!['true', 'false'].includes(draft.equals)) return null; out.equals = draft.equals === 'true'; }
  if (shape === 'number') { if (!String(draft.min ?? '').trim() || !Number.isFinite(Number(draft.min))) return null; out.min = Number(draft.min); }
  return out;
}
export function typeformFailure(e) {
  const code = e?.data?.error;
  if (code === 'mapping_target_pending') return 'The question rule was saved, but its hypothesis link was not confirmed. A changed rule may already have retracted affected evidence. Retry hypothesis link below without saving the rule again.';
  if (code === 'typeform_unavailable') return 'Typeform is unavailable until its app is approved.';
  if (['sign_in_again', 'not_connected', 'binding_lost'].includes(code)) return 'Reconnect Typeform and check the form’s access before importing.';
  if (code === 'not_your_binding') return 'Only the member whose Typeform serves this venture can import or review it.';
  if (code === 'not_bound') return 'Choose a Typeform form for this venture first.';
  if (code === 'company_not_enabled') return 'Enable this connection for the venture’s company on the connector page.';
  return 'Unreadable or refused: the operation could not be confirmed. Read again before retrying.';
}
/**
 * D5830 part 2: the sentence for one deletion-reconcile run (`POST /api/typeform/sync/reconcile`,
 * D5828 part 4). `ok` finished the pass; `partly` reached the run's bound and must be called again;
 * anything else concluded nothing past the last whole lookup. Counts come from the run, never guessed.
 */
export function reconcileNotice(reply) {
  const r = reply?.result || {};
  const n = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;
  const counts = `Checked ${n(r.checked)} imported responses with Typeform; ${n(r.provider_deleted)} confirmed deleted (their answers and evidence were withdrawn); ${n(r.missing_once)} missing for the first time, deleted only if still missing an hour from now; ${n(r.reappeared)} back again.`;
  if (reply?.outcome === 'ok') return `Deleted-response check finished. ${counts}`;
  if (reply?.outcome === 'partly') return `Deleted-response check is part way. ${counts} Choose Continue deleted-response check to check the rest.`;
  if (reply?.outcome === 'busy') return 'Deleted-response check did not run: an import or check is already running for this form. Try again in a moment.';
  return 'Deleted-response check stopped before it finished. Nothing unread was marked deleted; read the import status before trying again.';
}
