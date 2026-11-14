// D5070 (#5070) — what a founder is told when a Raise read or write fails.
//
// A Raise surface never renders `error.message` itself. It calls
// `userFacingRaiseError(error, { fallback })` and shows what comes back. The
// raw error goes to the client log (`reportWarn`), never to the page.
//
// ORDER
//   1. A code in the taxonomy below → its approved sentence.
//   2. A Worker refusal: HTTP 4xx AND a machine code (`request()` puts the
//      code on `e.code`) AND a sentence on the body. The Worker's refusal
//      bodies are written as sentences (`util/refusal.ts`, `PlanError`), so
//      this is the one allowlisted contract for Worker-authored copy. An
//      Error thrown in the browser (a failed fetch, a TypeError, a JSON
//      parse) has no status and no code, so it is never shown. A sentence
//      that looks like an internal (SQL, a stack, a provider's text) is
//      treated as not a sentence.
//   3. A status class → the taxonomy's sentence for it.
//   4. Anything else (a 5xx, no response, an unknown shape) → the caller's
//      `fallback`, or the generic `unavailable` sentence.
//
// A code NOT in the table (`invalid_plan`, `project_has_cap_table`, …) is the Worker's own refusal, and keeps
// its sentence under rule 2: those sentences say which field or what to do, which a generic line cannot.
//
// TAXONOMY. invalid_input, forbidden, changed, not_found, unavailable,
// rate_limited, pricing_unavailable, conflict, plan_required, signed_out.
import { reportWarn } from './log.js';

export const RAISE_ERROR_COPY = Object.freeze({
  invalid_input: 'Check what you entered. Nothing was saved.',
  forbidden: 'You do not have access to do that on this venture.',
  // Package 1's conflict: the record moved after it was opened. Recovery is Review latest.
  changed: 'This was changed somewhere else after you opened it. Nothing of yours was saved. Review the latest, then make your change again.',
  not_found: 'That could not be found. It may have been removed.',
  unavailable: 'That did not go through just now. Try again in a moment.',
  rate_limited: 'Too many requests just now. Wait a moment, then try again.',
  pricing_unavailable: 'Pricing could not be read just now. Nothing was charged.',
  conflict: 'That conflicts with what is already recorded. Review it, then try again.',
  plan_required: 'This needs a plan that includes it.',
  signed_out: 'Your session ended. Sign in again, then retry.',
});

/** Codes the Worker sends, by the taxonomy entry they mean. */
const CODE_TO_KIND = Object.freeze({
  invalid_input: 'invalid_input',
  forbidden: 'forbidden', admin_frozen: 'forbidden', support_read_only: 'forbidden', scoped_cap_table_required: 'forbidden',
  changed_since_open: 'changed', scenario_changed: 'changed', hire_changed: 'changed', base_changed: 'changed', legacy_plan_changed: 'changed',
  not_found: 'not_found',
  unavailable: 'unavailable', unreadable: 'unavailable', unreadable_store: 'unavailable',
  rate_limited: 'rate_limited', too_many_requests: 'rate_limited',
  pricing_unavailable: 'pricing_unavailable',
  conflict: 'conflict',
  tier_required: 'plan_required', plan_required: 'plan_required',
  unauthorized: 'signed_out',
});

const STATUS_TO_KIND = Object.freeze({ 400: 'invalid_input', 401: 'signed_out', 402: 'plan_required', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 410: 'not_found', 422: 'invalid_input', 429: 'rate_limited' });

const CODE_SHAPE = /^[a-z][a-z0-9_]*$/;
// Text that is an internal, not a sentence for a founder.
const INTERNAL = /(sqlite|d1_|sql\b|constraint failed|syntax error|typeerror|referenceerror|undefined|\bnull\b|\[object|stack|:\d+:\d+|\.(ts|js|mjs)\b|exception|econn|etimedout|failed to fetch|networkerror|unexpected token|json|<html|internal server)/i;

/** A Worker-authored sentence: short, plain, not a code, not an internal. */
export function isSentence(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 3 || t.length > 300) return false;
  if (CODE_SHAPE.test(t)) return false;
  // A bare status or number ("409") is not a sentence: the publish panel showed "Publish 409" (#5376).
  if (!/[a-z]{2}/i.test(t)) return false;
  return !INTERNAL.test(t);
}

/**
 * An Error that carries a sentence the PAGE wrote (already safe), for a page that rethrows what it
 * composed (`throw safeRaiseError(\`${holder}: ${sentence}\`)`). `userFacingRaiseError` shows it as is.
 */
export function safeRaiseError(sentence) {
  const e = new Error(String(sentence));
  e.safe = true;
  return e;
}

export const raiseErrorKind = (error) => {
  const code = typeof error?.code === 'string' ? error.code : typeof error?.data?.code === 'string' ? error.data.code : typeof error?.data?.error === 'string' ? error.data.error : null;
  if (code && CODE_TO_KIND[code]) return CODE_TO_KIND[code];
  return STATUS_TO_KIND[error?.status] || 'unavailable';
};

/**
 * The sentence to show for a failed Raise call.
 *
 * `context.fallback` is the page's own sentence for "this did not work", used
 * when nothing safer is known. `context.sentences` maps a code to the page's
 * own approved sentence for it, and wins over the taxonomy. `context.scope`
 * names the surface in the client log.
 */
export function userFacingRaiseError(error, context = {}) {
  const { fallback, sentences, scope = 'raise' } = context;
  if (error?.safe === true && typeof error.message === 'string' && error.message) return error.message;
  const code = typeof error?.code === 'string' ? error.code : typeof error?.data?.code === 'string' ? error.data.code : typeof error?.data?.error === 'string' ? error.data.error : null;
  if (code && sentences && typeof sentences[code] === 'string') return sentences[code];
  const kind = raiseErrorKind(error);
  const status = Number(error?.status);
  const worker = status >= 400 && status < 500 && !!code && !CODE_TO_KIND[code]
    ? [error?.message, error?.detail, error?.data?.message, error?.data?.detail].find(isSentence) ?? null
    : null;
  // A taxonomy code says what it means in the taxonomy's words, whatever text came with it. A Worker
  // refusal with a code of its own keeps its sentence (the one allowlisted contract above).
  if (code && CODE_TO_KIND[code]) return RAISE_ERROR_COPY[kind];
  if (isSentence(worker)) return worker.trim();
  try { reportWarn(`${scope}:error`, { status: error?.status ?? null, code }); } catch { /* the log never blocks the page */ }
  if (status >= 400 && status < 500 && STATUS_TO_KIND[status]) return RAISE_ERROR_COPY[kind];
  return fallback || RAISE_ERROR_COPY.unavailable;
}

/**
 * D5079 (#5079) — what a failed authoritative read is, in one place.
 *
 * `refused` and `unreadable` are not the same answer and must never be drawn
 * as each other, or as a measured zero. A refusal is authoritative: the
 * platform decided not to show this, and it knows nothing about whether
 * anything is recorded. An unreadable read is a failure: the store may hold
 * plenty. Six Raise tools each carried their own copy of
 * `[403, 404].includes(error?.status)`, and one of them (Capital
 * relationships) had no refused state at all, so a refusal there claimed the
 * read had failed.
 *
 * 403 and 404 are both refusals on these surfaces: a venture outside the
 * caller's scope answers 404 so that its existence is not confirmed, which
 * is a decision about access and not a missing store.
 */
export const RAISE_REFUSED_STATUSES = Object.freeze([403, 404]);
export function raiseReadState(error, failed = 'unreadable') {
  return RAISE_REFUSED_STATUSES.includes(Number(error?.status)) ? 'refused' : failed;
}
/**
 * What the page says where the tool's figures, records and summaries would
 * have been. The tool has already given its own refusal above; this says why
 * nothing follows it, and says plainly that it is not a claim about what is
 * recorded. `what` names the tool as it reads mid-sentence, e.g. "this cap table".
 */
export const refusedNoData = (what) =>
  `Nothing of ${what} is drawn here, because the read was refused. That is not a claim that nothing is recorded.`;

/**
 * The refusal a Raise tool hands up to the page around it, so that page can
 * stop drawing authoritative data for the tool. `null` means the tool's
 * authoritative read was not refused.
 */
export const raiseToolRefusal = (refused, what) => (refused ? { refused: true, message: refusedNoData(what) } : null);

/** Validation sentences a 400 carries (`errors: [..]`), kept only when each is a sentence. */
export function raiseValidationErrors(error) {
  const list = error?.data?.errors || error?.data?.detail?.errors;
  if (!Array.isArray(list) || error?.status !== 400) return [];
  return list.filter(isSentence).map((x) => String(x).trim());
}
