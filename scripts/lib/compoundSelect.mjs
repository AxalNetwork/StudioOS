/**
 * #9170: D1 rejects a compound SELECT with more than five terms ("too many
 * terms in compound SELECT"; stock SQLite allows 500, so node:sqlite tests
 * pass). This reads the string and template literals in Worker source and
 * counts the terms of each compound at its own parenthesis depth: a compound
 * nested in a CTE or a subquery is counted separately, as D1 counts it.
 */

export const D1_MAX_COMPOUND_TERMS = 5;

/** Every string and template literal in `source` as `{ text, line }`; `${…}` becomes `?`. */
export function stringLiterals(source) {
  const out = [];
  let i = 0, line = 1;
  const n = source.length;
  const advance = (to) => { for (; i < to; i += 1) if (source[i] === '\n') line += 1; };
  // A template literal starting at i (the backtick); returns its text with interpolations replaced.
  const template = () => {
    let text = '';
    i += 1;
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') { text += source.slice(i, i + 2); advance(i + 2); continue; }
      if (source[i] === '$' && source[i + 1] === '{') {
        advance(i + 2);
        let depth = 1;
        while (i < n && depth > 0) {
          const ch = source[i];
          if (ch === '`') { const startLine = line; const inner = template(); out.push({ text: inner, line: startLine }); continue; }
          if (ch === "'" || ch === '"') { quoted(ch); continue; }
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
          advance(i + 1);
        }
        text += '?';
        continue;
      }
      if (source[i] === '\n') line += 1;
      text += source[i];
      i += 1;
    }
    i += 1;
    return text;
  };
  const quoted = (q) => {
    const startLine = line;
    let text = '';
    i += 1;
    while (i < n && source[i] !== q && source[i] !== '\n') {
      if (source[i] === '\\') { text += source.slice(i, i + 2); i += 2; continue; }
      text += source[i];
      i += 1;
    }
    i += 1;
    out.push({ text, line: startLine });
  };
  while (i < n) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { const end = source.indexOf('\n', i); advance(end < 0 ? n : end); continue; }
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); advance(end < 0 ? n : end + 2); continue; }
    if (ch === '`') { const startLine = line; const text = template(); out.push({ text, line: startLine }); continue; }
    if (ch === "'" || ch === '"') { quoted(ch); continue; }
    advance(i + 1);
  }
  return out;
}

/** The term count of each compound SELECT in one SQL text, deepest first is not promised. */
export function compoundTermCounts(sql) {
  const clean = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const counts = [];
  const stack = [0];
  const re = /\(|\)|;|\b(?:UNION(?:\s+ALL)?|INTERSECT|EXCEPT)\b/gi;
  const close = () => { const ops = stack.pop(); if (ops > 0) counts.push(ops + 1); };
  for (const m of clean.matchAll(re)) {
    const t = m[0];
    if (t === '(') stack.push(0);
    else if (t === ')') { if (stack.length > 1) close(); }
    else if (t === ';') { close(); stack.push(0); }
    else stack[stack.length - 1] += 1;
  }
  while (stack.length) close();
  return counts;
}

/** Each literal in `source` holding a compound SELECT over D1's limit, as `{ line, terms }`. */
export function overLimit(source, max = D1_MAX_COMPOUND_TERMS) {
  const found = [];
  for (const { text, line } of stringLiterals(source)) {
    if (!/\bSELECT\b/i.test(text)) continue;
    const worst = Math.max(0, ...compoundTermCounts(text));
    if (worst > max) found.push({ line, terms: worst });
  }
  return found;
}
