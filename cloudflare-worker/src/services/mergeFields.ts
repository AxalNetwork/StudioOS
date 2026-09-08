/**
 * Pure merge-field resolver shared by the legal-template renderer
 * and any other production caller that needs to expand
 * `{{dotted.path}}` placeholders. Lives in its own module (no
 * template imports, no Wrangler `?raw` deps) so it can be exercised
 * by `node --test` smoke tests without dragging in the markdown
 * template bundle.
 */
/**
 * The one token grammar. `{{ dotted.path }}`, whitespace tolerated inside the
 * braces, path drawn from `[A-Za-z0-9_.]`.
 *
 * A CONSTANT BECAUSE THE THIRD COPY WAS WRONG. `applyMergeFields` and
 * `resolveWithBrackets` below carried the same literal twice and agreed;
 * `routes/esign.ts` carried a third form that compiled ONE REGEX PER KEY from
 * the key itself, through an escape whose character class was mis-nested
 * (`/[.*+?^${}()|[\\]\\\\]/` — the class closes at the fifteenth character, so
 * the pattern is "one metacharacter, two backslashes, a bracket" and matches
 * essentially nothing). It escaped nothing it was given: `company.name` came
 * out as `company.name`. Nothing exploited it, because the request validator
 * restricts keys to `[A-Za-z0-9_\-.]` before they ever arrive — but a broken
 * escaper whose only defence is a validator in one caller is a trap, and it
 * was also the repo's last open `detect-non-literal-regexp` finding.
 *
 * ONE SHARED `g` OBJECT IS SAFE HERE, and only because of the two ways it is
 * used. `String.prototype.replace` with a global regex resets `lastIndex` to 0
 * both before and after, and `matchAll` clones the regex rather than advancing
 * it. Neither leaves state behind, so the usual "a module-level /g/ remembers
 * where it stopped" hazard does not apply. Anything that reaches for `.test()`
 * or `.exec()` on this object would reintroduce it and must not.
 */
const MERGE_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function applyMergeFields(
  body: string,
  merge: Record<string, unknown>,
): string {
  // Task #1 (DB) — accept dotted-path tokens like
  // `{{counterparty.founder_id}}`. The lookup walks nested objects;
  // a flat key like `{{recipient_name}}` continues to work because
  // the path of length 1 falls through to the top-level `merge[k]`.
  return body.replace(MERGE_TOKEN, (_, path: string) => {
    const v = resolveDotted(merge, path);
    return v == null ? `{{${path}}}` : String(v);
  });
}

/**
 * The token paths this body actually carries.
 *
 * WHY IT EXISTS: `merge_keys_applied` in the e-sign audit record. That field
 * used to be `Object.keys(mergeFields)` on one branch — every key the caller
 * SENT, whether or not the document had a slot for it — and the output of a
 * per-key regex loop on the other. One of those two is a claim about the
 * document and the other is a claim about the request, and an audit row that
 * says a field was applied when the body never mentioned it is worse than no
 * row. Both branches now ask this.
 *
 * Reading the BODY rather than testing each KEY is also what removes the
 * dynamic regex: one pass over one literal pattern, instead of one compiled
 * pattern per submitted key.
 */
export function mergeTokensIn(body: string): Set<string> {
  const found = new Set<string>();
  for (const m of body.matchAll(MERGE_TOKEN)) found.add(m[1]);
  return found;
}

/**
 * Task #29 — Turn `{{dotted.path}}` tokens into bracketed labels (e.g.
 * `{{company.legal_name}}` -> `[COMPANY LEGAL NAME]`) for a "blank
 * form" rendering of a legal template where no live merge context is
 * available. Only tokens defined in the canonical merge schema are
 * bracketed; unknown tokens pass through unchanged so reviewers still
 * spot anything not yet modelled. Uses the same token regex as
 * `applyMergeFields`.
 */
import { isKnownMergeToken, bracketLabel } from './legalMergeSchema';

export function resolveWithBrackets(body: string): string {
  return body.replace(MERGE_TOKEN, (orig, path: string) => {
    return isKnownMergeToken(path) ? bracketLabel(path) : orig;
  });
}

function resolveDotted(scope: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined;
    cur = (cur as Record<string, unknown>)[p]; // codeql[js/prototype-polluting-function] -- read-only walk; __proto__/constructor/prototype rejected above, result is stringified and never assigned
  }
  return cur;
}
