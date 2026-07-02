/**
 * Pure merge-field resolver shared by the legal-template renderer
 * and any other production caller that needs to expand
 * `{{dotted.path}}` placeholders. Lives in its own module (no
 * template imports, no Wrangler `?raw` deps) so it can be exercised
 * by `node --test` smoke tests without dragging in the markdown
 * template bundle.
 */
export function applyMergeFields(
  body: string,
  merge: Record<string, unknown>,
): string {
  // Task #1 (DB) — accept dotted-path tokens like
  // `{{counterparty.founder_id}}`. The lookup walks nested objects;
  // a flat key like `{{recipient_name}}` continues to work because
  // the path of length 1 falls through to the top-level `merge[k]`.
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const v = resolveDotted(merge, path);
    return v == null ? `{{${path}}}` : String(v);
  });
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
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (orig, path: string) => {
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
