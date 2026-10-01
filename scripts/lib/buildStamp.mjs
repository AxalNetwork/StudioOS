/**
 * What `docs/.build-source` says, and whether it is saying anything at all.
 *
 * THIS EXISTS BECAUSE "ABSENT" AND "UNREADABLE" ARE DIFFERENT FACTS and
 * `check-docs-fresh.mjs` used to collapse them into one `null`:
 *
 *     const v = readFileSync(STAMP, 'utf8').trim();
 *     return /^[0-9a-f]{64}$/.test(v) ? v : null;
 *
 * Both a missing file and a corrupt one produced `null`, and `null` fell
 * through to the commit-timestamp proxy — the very proxy D103 was written to
 * replace, and which passes whenever `docs/` was committed after
 * `frontend/src`. So a stamp that could not be parsed silently downgraded the
 * gate to the thing it exists instead of.
 *
 * Absent is now a strict failure (D218): the build records its source hash
 * under D103, so absent means someone deleted it or ran a bare `vite build`.
 * Present-but-unparseable is a failure too — the build writes exactly 64 hex
 * characters and a newline, so anything else means the file was edited,
 * truncated, or merged. Under `--strict` that is a refusal.
 *
 * THE MERGED CASE IS THE ONE THIS WAS BUILT FOR. `.gitattributes` marks this
 * path `merge=union`, so two branches that both rebuilt produce a two-line file
 * instead of a conflict (D113). That file is meaningless and the following
 * `npm run build` overwrites it — but if nobody rebuilds, this classifier is
 * what refuses to let the two-line stamp pass as "no stamp".
 */

/** The shape every build writes: 64 lowercase hex characters. */
export const STAMP_RE = /^[0-9a-f]{64}$/;

/**
 * Classify the raw contents of `docs/.build-source`.
 *
 * @param {string|null|undefined} raw  File contents, or null/undefined if the
 *   file could not be read at all. An empty string is a PRESENT file that says
 *   nothing, which is not the same as an absent one.
 * @returns {{present: boolean, valid: boolean, value: string|null, why: string|null}}
 */
export function classifyStamp(raw) {
  if (raw === null || raw === undefined) {
    return { present: false, valid: false, value: null, why: null };
  }
  const v = String(raw).trim();
  if (v === '') {
    return { present: true, valid: false, value: null, why: 'it is empty' };
  }
  if (STAMP_RE.test(v)) {
    return { present: true, valid: true, value: v, why: null };
  }
  // The two shapes worth naming, because each points at a different cause and
  // therefore a different fix.
  const why = v.includes('\n')
    ? `it holds ${v.split('\n').length} lines and a stamp is one`
    : `it is not 64 hex characters (${v.length} chars)`;
  return { present: true, valid: false, value: null, why };
}
