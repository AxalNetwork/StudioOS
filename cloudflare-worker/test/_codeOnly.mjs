/**
 * `codeOnly(src)` — source with the explanatory prose removed.
 *
 * A port of `frontend/test/_codeOnly.mjs`, for the same reason and with the
 * same two shapes removed. A guard here bans a SHAPE rather than a word — an
 * `await fetch(` with no signal, an awaited KV call with no deadline — and the
 * file under test invariably explains that shape in the comment saying why it
 * is now bounded. `deadline.ts` alone names `AbortSignal.timeout` three times
 * in prose. Scanning the comments would fail the very files that did the work.
 *
 * Only the two comment shapes a string literal cannot produce are removed: a
 * block comment that STARTS a line at column 0, and a line that is nothing but
 * a `//` comment. A trailing comment is deliberately left alone — a naive
 * stripper that chases inline `/*` markers eats string literals, and a mangled
 * file is a false accusation where a missed ban is merely a weaker test.
 */
export function codeOnly(src) {
  return String(src)
    .replace(/^\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*\*[^\n]*$/gm, '');
}

/**
 * The balanced text of a call that starts at `open` (the index of its `(`).
 * A regex cannot do this: every options object here contains braces, nested
 * calls and template literals, and `[^)]*` stops at the first `)` inside them —
 * which for `fetch(url, { headers: { ... } })` is the wrong one, and would
 * report a signal-carrying call as bare.
 */
export function callArgs(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}
