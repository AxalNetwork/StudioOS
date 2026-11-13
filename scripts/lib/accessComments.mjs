/**
 * Which comments in the Worker may say "Cloudflare Access", and which may not.
 *
 * THE BUG IT CATCHES. Task #33 took the Cloudflare Access middleware off
 * /api/admin/*, /api/monitoring/* and /api/infra/*, because the Access app
 * covered only the apex while the SPA calls the API relatively — so a fetch
 * from app.axal.vc carried no assertion header and every admin got a
 * fail-closed 403. index.ts records the removal. Seventeen comments in twelve
 * files (nineteen mentions — the filing counted thirteen) went on saying the
 * perimeter was there: "sits inside the existing
 * `app.use('/api/admin/*', requireCfAccess())` perimeter", "(in prod) pass the
 * /api/admin/* Cloudflare Access perimeter". A reader who trusts them believes
 * the admin API has an identity layer in front of it that it does not have,
 * and reasons about every handler gate as if it were the second line of
 * defence rather than the only one. The only mounts left are the two KYC
 * document routes in index.ts.
 *
 * THE RULE. Every comment under cloudflare-worker/src that mentions Access must
 * be quoted, in part, by an entry in `access-comment-allowlist.json`. An entry
 * is a file, a phrase copied from the comment, and one line saying why the
 * sentence is true. Never a line number: a line number goes stale with the next
 * edit above it, and a phrase goes stale only when the sentence itself changes
 * — which is exactly when somebody should look at it again.
 *
 *   - A mention no entry quotes fails ("unlisted").
 *   - An entry whose phrase is in no comment of its file fails ("stale"), so the
 *     ledger cannot outlive the sentences it vouches for.
 *   - An entry whose phrase contains no Access mention fails ("vacuous"): it
 *     would vouch for nothing, and a phrase like "the" would vouch for anything.
 *   - A run that scans no file fails, so the check cannot pass over nothing.
 *
 * WHY A LEXER. The mention has to be in a COMMENT. `requireCfAccess()` on a code
 * line is the middleware being used; `'[cfAccess] verify failed:'` is a log
 * string. A regex over lines cannot tell a `//` in a URL string from a comment
 * opener, or a `/*` inside a regex literal from a block comment, and TypeScript
 * 7's native compiler has no JS API to ask. So this walks the source the way
 * `sqlStrings` in check-sqlite-dialect.mjs does — strings, template literals
 * (with `${}` nesting), regex literals by the previous significant character —
 * and keeps what is left over when all of those are skipped.
 *
 * WHY BLOCKS, NOT LINES. Comments wrap. "the CF\n * Access perimeter" is one
 * sentence on two lines, and a per-line regex sees half of it on each. So
 * consecutive comment lines are joined into one block, whitespace collapsed,
 * and the mention and the allowlist phrase are both matched against the block.
 */

/** What counts as a mention. Kept identical to the sweep that found the seventeen. */
export const ACCESS_MENTION = /cf[- ]?access|requireCfAccess|access perimeter|cloudflare access/gi;

/** Can the character before a `/` end an expression? If not, the `/` opens a regex. */
function endsExpression(ch) {
  return ch !== undefined && /[\w$)\]]/.test(ch);
}

/**
 * Every comment in `src`, one entry per physical line it occupies:
 * `{ line, text, kind: 'line' | 'block', trailing }`. `text` has the comment
 * markers removed — `//`, `/*`, `*\/`, and a leading `*` on a doc-comment line.
 * `trailing` is true for a `//` comment with code before it on the same line.
 */
export function commentLines(src) {
  const out = [];
  let line = 1;
  let lineHasCode = false;
  let prev;                      // last significant character, for regex detection
  // A stack of contexts. 'code' means ordinary code; a number means we are in
  // the expression part of a template literal, holding the brace depth at which
  // the matching `}` returns to the template body.
  const braces = [];             // for each open `${`, the brace depth it opened at
  let depth = 0;
  let i = 0;
  const n = src.length;

  const advance = (to) => {
    for (let k = i; k < to; k += 1) {
      if (src[k] === '\n') { line += 1; lineHasCode = false; }
    }
    i = to;
  };

  // Walk a template body from just after its opening backtick (or just after
  // the `}` that closed an expression). Returns when it reaches the closing
  // backtick (consumed) or a `${` (consumed, and a brace frame pushed).
  const templateBody = () => {
    while (i < n) {
      const c = src[i];
      if (c === '\\') { advance(i + 2); continue; }
      if (c === '`') { advance(i + 1); prev = '`'; return; }
      if (c === '$' && src[i + 1] === '{') {
        advance(i + 2);
        braces.push(depth);
        depth += 1;
        prev = '{';
        return;
      }
      advance(i + 1);
    }
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { advance(i + 1); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }

    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      out.push({ line, text: src.slice(i + 2, stop), kind: 'line', trailing: lineHasCode });
      i = stop;                  // the newline itself is handled next iteration
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close < 0 ? n : close;
      const body = src.slice(i + 2, stop);
      const parts = body.split('\n');
      parts.forEach((part, k) => {
        out.push({ line: line + k, text: part, kind: 'block', trailing: k === 0 && lineHasCode });
      });
      advance(close < 0 ? n : close + 2);
      continue;
    }
    if (c === '/' && !endsExpression(prev)) {
      // A regex literal: skip to its closing slash, honouring escapes and classes.
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;   // unterminated — it was division after all
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;
        else if (d === '/') break;
        j += 1;
      }
      lineHasCode = true;
      if (src[j] === '/') { advance(j + 1); prev = '/'; continue; }
      i += 1;
      prev = '/';
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      lineHasCode = true;
      advance(Math.min(j + 1, n));
      prev = c;
      continue;
    }
    if (c === '`') {
      lineHasCode = true;
      advance(i + 1);
      templateBody();
      continue;
    }
    if (c === '{') { depth += 1; }
    if (c === '}') {
      depth -= 1;
      if (braces.length && braces[braces.length - 1] === depth) {
        // This `}` closes a template expression: back into the template body.
        braces.pop();
        lineHasCode = true;
        advance(i + 1);
        templateBody();
        continue;
      }
    }
    lineHasCode = true;
    prev = c;
    i += 1;
  }
  return out;
}

/** The comment text with its doc-comment decoration removed and whitespace collapsed. */
function clean(text) {
  return text.replace(/^\s*\*+(?!\/)/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Consecutive comment lines grouped into blocks: a `/* … *\/` is one block, and
 * `//` comments on consecutive lines are one block. Each block carries the
 * joined text and, for each character offset in it, the line it came from.
 */
export function commentBlocks(src) {
  const blocks = [];
  let cur = null;
  let lastLine = -2;
  let lastKind = null;
  let blockId = 0;
  const lines = commentLines(src);
  // Block comments are recognised as one block by their shared origin; we tag
  // each block-comment line with the index of the comment it came from.
  let prevBlockStart = null;
  for (const entry of lines) {
    const isBlockCont = entry.kind === 'block' && lastKind === 'block' && entry.line === lastLine + 1 && !entry.trailing && prevBlockStart !== null && entry.line !== prevBlockStart;
    const isLineCont = entry.kind === 'line' && lastKind === 'line' && entry.line === lastLine + 1;
    if (!cur || !(isBlockCont || isLineCont)) {
      cur = { id: blockId += 1, text: '', lineAt: [], lines: [] };
      blocks.push(cur);
      prevBlockStart = entry.line;
    }
    const piece = clean(entry.text);
    if (piece) {
      if (cur.text) { cur.text += ' '; cur.lineAt.push(entry.line); }
      for (let k = 0; k < piece.length; k += 1) cur.lineAt.push(entry.line);
      cur.text += piece;
    }
    cur.lines.push(entry.line);
    lastLine = entry.line;
    lastKind = entry.kind;
  }
  return blocks.filter((b) => b.text);
}

/** Collapse whitespace so an allowlist phrase matches however the comment wraps. */
export function normalisePhrase(phrase) {
  return String(phrase ?? '').replace(/\s+/g, ' ').trim();
}

function mentionsIn(text) {
  const found = [];
  ACCESS_MENTION.lastIndex = 0;
  let m;
  while ((m = ACCESS_MENTION.exec(text)) !== null) {
    found.push({ start: m.index, end: m.index + m[0].length, match: m[0] });
    if (m[0].length === 0) ACCESS_MENTION.lastIndex += 1;
  }
  return found;
}

function occurrences(haystack, needle) {
  const spans = [];
  if (!needle) return spans;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    spans.push({ start: at, end: at + needle.length });
    at = haystack.indexOf(needle, at + 1);
  }
  return spans;
}

/**
 * Audit a set of files against the allowlist.
 *
 * @param {Array<{ path: string, src: string }>} files  paths relative to the scan root
 * @param {Array<{ file: string, phrase: string, reason: string }>} entries
 * @returns {{ scanned: number, mentions: number, findings: Array<object> }}
 */
export function auditAccessComments(files, entries) {
  const findings = [];
  const list = Array.isArray(entries) ? entries : [];

  if (!Array.isArray(files) || files.length === 0) {
    findings.push({ kind: 'nothing-scanned', detail: 'no source file was scanned, so this check proved nothing' });
    return { scanned: 0, mentions: 0, findings };
  }

  // Validate the entries themselves first.
  const seen = new Set();
  const valid = [];
  for (const e of list) {
    const file = typeof e?.file === 'string' ? e.file : '';
    const phrase = normalisePhrase(e?.phrase);
    const reason = typeof e?.reason === 'string' ? e.reason.trim() : '';
    if (!file || !phrase || reason.length < 20) {
      findings.push({ kind: 'invalid-entry', file, phrase, detail: 'an entry needs a file, a phrase and a reason of at least 20 characters' });
      continue;
    }
    if (mentionsIn(phrase).length === 0) {
      findings.push({ kind: 'vacuous', file, phrase, detail: 'the phrase contains no Access mention, so it vouches for nothing' });
      continue;
    }
    const key = `${file}\u0000${phrase}`;
    if (seen.has(key)) {
      findings.push({ kind: 'duplicate', file, phrase, detail: 'the same entry appears twice' });
      continue;
    }
    seen.add(key);
    valid.push({ file, phrase, used: false });
  }

  const byFile = new Map();
  for (const v of valid) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }

  let mentions = 0;
  const scannedPaths = new Set();
  for (const { path, src } of files) {
    scannedPaths.add(path);
    const mine = byFile.get(path) || [];
    for (const block of commentBlocks(src)) {
      const covers = [];
      for (const v of mine) {
        const spans = occurrences(block.text, v.phrase);
        if (spans.length) v.used = true;
        covers.push(...spans);
      }
      for (const m of mentionsIn(block.text)) {
        mentions += 1;
        const ok = covers.some((s) => s.start <= m.start && m.end <= s.end);
        if (!ok) {
          const line = block.lineAt[m.start] ?? block.lines[0];
          const from = Math.max(0, m.start - 60);
          findings.push({
            kind: 'unlisted',
            file: path,
            line,
            match: m.match,
            text: block.text.slice(from, Math.min(block.text.length, m.end + 60)),
          });
        }
      }
    }
  }

  for (const v of valid) {
    if (!scannedPaths.has(v.file)) {
      findings.push({ kind: 'stale', file: v.file, phrase: v.phrase, detail: 'the file was not scanned (moved or deleted?)' });
    } else if (!v.used) {
      findings.push({ kind: 'stale', file: v.file, phrase: v.phrase, detail: 'no comment in the file contains this phrase any more' });
    }
  }

  return { scanned: files.length, mentions, findings };
}
