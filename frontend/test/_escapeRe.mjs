/**
 * `escapeRe(v)` — a value made safe to interpolate into a `RegExp`.
 *
 * Guards in this directory routinely build a pattern around a string they read
 * out of something: a canvas file, a filter table, a zone key, a route slug.
 * Interpolated raw, a metacharacter in any of those either changes what the
 * pattern means — silently, so the assertion still passes and now checks
 * something else — or, with the wrong nesting, builds one that backtracks.
 *
 * Semgrep's `javascript.lang.security.audit.detect-non-literal-regexp` flags
 * every one of those sites, and it is right to: the ReDoS framing is the
 * strongest case, but the everyday cost is a test that quietly stops testing
 * what it says. Most of these inputs are already constrained — `\w+` captures,
 * hardcoded bucket names — so this is belt-and-braces at each individual site.
 * It lives in one file so the answer is the same at all of them rather than
 * being re-argued per finding.
 *
 * `-` IS DELIBERATELY NOT ESCAPED. It is only a metacharacter inside a
 * character class, and none of these sites interpolate into one — while `\-`
 * outside a class is a SyntaxError under the `u` flag, so escaping it would
 * plant a fault for whoever adds that flag next.
 */
export const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
