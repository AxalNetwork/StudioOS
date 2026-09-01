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

/**
 * The body of ONE `export const <name> = { … };` block.
 *
 * `METHOD` above is applied to the whole file, which is fine for "is this
 * name defined anywhere?" but wrong for anything that counts. api.js exports
 * twenty-three separate objects — `api`, `news`, `adminTeam`, `events`, … —
 * and each one's properties sit at the same two spaces of indent, so a
 * whole-file scan sees `news.list`, `events.list` and `jobs.list` as three
 * declarations of `list`. They are three different objects.
 *
 * Each block opens at column 0 and closes with `};` at column 0, so slicing
 * between those is exact without parsing.
 */
function exportedObjectBody(src, name) {
  const text = String(src);
  const open = text.indexOf(`\nexport const ${name} = {`);
  if (open === -1) return null;
  const close = text.indexOf('\n};', open);
  return close === -1 ? text.slice(open) : text.slice(open, close);
}

/**
 * Names declared more than once inside one exported object, in source order.
 *
 * `apiMethodNames` returns a Set, which is right for "is this defined?" and
 * exactly wrong for "is this defined once?". `getCapTableByProject` was
 * declared twice inside `api` for months and the Set discarded the evidence:
 * the later copy won, so the `encodeURIComponent` on the earlier one was dead
 * and the id went into the URL path raw.
 */
export function duplicateApiMethods(src, name = 'api') {
  const body = exportedObjectBody(src, name);
  if (body === null) return [];
  const seen = new Set();
  const dupes = new Set();
  for (const [, method] of body.matchAll(METHOD)) {
    if (seen.has(method)) dupes.add(method);
    seen.add(method);
  }
  return [...dupes];
}

/** Every `api.<name>(` a page calls. */
const CALL = /\bapi\.([A-Za-z0-9_$]+)\(/g;

export function apiCallsIn(src) {
  return new Set([...String(src).matchAll(CALL)].map((m) => m[1]));
}
