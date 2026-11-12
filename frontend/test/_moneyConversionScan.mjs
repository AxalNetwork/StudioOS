/**
 * D5373 — the scan behind `money_manual_conversion_5373.test.mjs`: which lines of `frontend/src` and
 * `cloudflare-worker/src` multiply or divide a money value by 100 by hand.
 *
 * A line is flagged when, with comments removed, it (1) divides, multiplies or takes a remainder by a bare `100`, (2)
 * names money (a cents/amount/price/fee/... word), builds two fixed decimals (`padEnd(2`, `+ '00'`, `.toFixed(2)`) or
 * formats the quotient as a locale number (`toLocaleString(`, `Intl.NumberFormat`, `FractionDigits`: D5373 part 2, the shape
 * of `(value / 100).toLocaleString(...)` beside a currency code that no money word flagged) and (3) does not read as a
 * percentage, ratio or score. A conversion split over lines with no money word is not seen, nor is a bare
 * `Math.round(a * 100)` on a value that no word on the line says is money. That is a
 * heuristic on purpose: it errs towards flagging, and a flagged file is either migrated onto `lib/money.js` or listed,
 * with its reason, in the test's allow-list. The conversions that ARE the money layer live in `lib/money.js`, which is
 * the one file the scan skips.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The roots the guard covers: the whole financial UI and every Worker route and service. */
export const SCAN_ROOTS = ['frontend/src', 'cloudflare-worker/src'];
/** The money layer itself: its `* 100` for Stripe's ISK and UGX is the rule, written once. */
export const LAYER_FILES = new Set(['frontend/src/lib/money.js']);

const MONEYISH = /cents?\b|_cents|amount|price|dollar|usd|money|\bfee|budget|spend|salary|invest|commit|unit_amount|minor|_off\b|cost|revenue|payout|earning|\bcap\b|\bsize\b|wire|cheque|\bpay|refund|\bmrr\b|\bcash\b|credit|charge|fund|raise|value_|valuation|ticket|rate\b|bonus|face|invoice|settle|tax|vat/i;
const NOT_AMOUNT = /pct|percent|bps|%|\bscore|opacity|progress|confidence|coverage|share\b|ratio|weight|\bwidth|\bheight|Math\.min\(100|Math\.max\(0, *Math\.min\(100/i;
// A line that builds or prints two fixed decimals is converting an amount even when no money word is on it.
const FIXED_TWO = /padEnd\(2|\+ '00'|\.toFixed\(2\)/;
// ...or formats the result of the division as a number for people to read (the shape D5373 part 1's scan missed).
const FORMATS_NUMBER = /toLocaleString\(|Intl\.NumberFormat|FractionDigits/;
const BY_100 = /(?:[/*]|%)\s*100\b(?![.\d])|(?<![\w-])100\s*[/*]\s*[\w(]/;

/** Source text without block comments, line comments and the `//` inside strings left alone. */
export function codeOnly(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** The `[lineNumber, text]` of every flagged line of one file's source. */
export function scanFile(text) {
  const out = [];
  codeOnly(text).split('\n').forEach((line, i) => {
    if (BY_100.test(line) && (MONEYISH.test(line) || FIXED_TWO.test(line) || FORMATS_NUMBER.test(line)) && !NOT_AMOUNT.test(line)) out.push([i + 1, line.trim()]);
  });
  return out;
}

export function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** `{ 'relative/path': count }` for every file under the roots with at least one flagged line. */
export function scanTree(root) {
  const hits = {};
  for (const r of SCAN_ROOTS) {
    for (const f of walk(path.join(root, r))) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (LAYER_FILES.has(rel)) continue;
      const n = scanFile(fs.readFileSync(f, 'utf8')).length;
      if (n) hits[rel] = n;
    }
  }
  return hits;
}
