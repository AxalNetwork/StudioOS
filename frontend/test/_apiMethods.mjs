/**
 * `apiMethodNames(src)` — every method `frontend/src/lib/api.js` defines.
 *
 * Four test files needed "is this method defined?" and each grew its own
 * answer. Two built a regex per method — `new RegExp(\`^\\s{2}${m}:\`, 'm')` —
 * which Semgrep flagged as non-literal-regexp / possible ReDoS (alerts 5944,
 * 5945). That specific finding is not reachable: `m` is captured by
 * `/\bapi\.([A-Za-z0-9_]+)\(/`, so it holds an identifier and cannot carry a
 * metacharacter, and the pattern it builds has no nesting to backtrack
 * through.
 *
 * It is still worth removing rather than annotating, because the loop was the
 * weaker design regardless: N regex constructions where one pass will do, and
 * the other two files had drifted to a bare `includes(\`${m}:\`)` that matches
 * the substring anywhere — inside a comment, inside a URL, at any nesting
 * depth. Parsing once, exactly, makes all four agree and makes the assertion
 * mean what it says.
 *
 * The shape being matched is a top-level property of the exported object:
 * exactly two spaces of indent, a name, then a colon. Anything more deeply
 * indented is a nested helper, not a callable `api.<name>`.
 */
const METHOD = /^ {2}([A-Za-z0-9_$]+):/gm;

export function apiMethodNames(src) {
  return new Set([...String(src).matchAll(METHOD)].map((m) => m[1]));
}

/** Every `api.<name>(` a page calls. */
const CALL = /\bapi\.([A-Za-z0-9_$]+)\(/g;

export function apiCallsIn(src) {
  return new Set([...String(src).matchAll(CALL)].map((m) => m[1]));
}
