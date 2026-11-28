#!/usr/bin/env node
/**
 * D9167 (#9167): every LIKE search pattern in the Worker comes from
 * `cloudflare-worker/src/util/likeSearch.ts`.
 *
 * D1 refuses a LIKE pattern over 50 bytes ("LIKE or GLOB pattern too
 * complex"), and only once a row is compared, so a long search answered 500 on
 * a live table and 200 on an empty test one. `likeNeedle` and its siblings
 * escape `\`, `%` and `_` and trim the term at a whole character so the
 * pattern fits. A pattern built anywhere else skips both, so this fails on:
 *
 *   raw-bind      a template that wraps a value in wildcards, `%${q}%` or
 *                 `%"${tag}"%`
 *   concat-bind   a leading wildcard concatenated on, `'%' + q`
 *   sql-wrap      the wildcards added in SQL, `LIKE '%' || ? || '%'`
 *   local-escaper a copy of the escaper, `.replace(/[\\%_]/g, …)`, the shape
 *                 the nine local copies (`likePattern`, `likeTerm`,
 *                 `likeLiteral`, …) all had
 *
 * Comment lines are skipped. A fixed internal prefix (`raise:${id}:%`) is not a
 * search and is not flagged; one that can outgrow 50 bytes compares
 * `substr(col, 1, length(?)) = ?` instead (see `services/flows.ts`).
 *
 * Usage: node scripts/check-like-patterns.mjs
 */
import { readFileSync, globSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HELPER = 'cloudflare-worker/src/util/likeSearch.ts';

const RULES = [
  ['raw-bind', /`%[^`$\n]{0,3}\$\{[^`\n]*?\}[^`$\n]{0,3}%`/],
  ['concat-bind', /(['"])%\1\s*\+/],
  ['sql-wrap', /LIKE\s+\(?\s*'%'\s*\|\|/i],
];
const ESCAPER = /\.replace\(\s*\/\[((?:\\\\|[%_!])+)\]\/g?\s*,/;

/** The findings in one file's text: `{ line, rule, text }`. */
export function scanSource(source) {
  const out = [];
  source.split('\n').forEach((text, i) => {
    const t = text.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const [rule, re] of RULES) if (re.test(text)) out.push({ line: i + 1, rule, text: t });
    const m = ESCAPER.exec(text);
    if (m && m[1].includes('%') && m[1].includes('_')) out.push({ line: i + 1, rule: 'local-escaper', text: t });
  });
  return out;
}

/** Every finding under the Worker's source, the helper itself excepted. */
export function scanTree(root = ROOT) {
  const files = globSync('cloudflare-worker/src/**/*.ts', { cwd: root }).map((f) => f.split('\\').join('/')).sort();
  const out = [];
  for (const file of files) {
    if (file === HELPER) continue;
    for (const f of scanSource(readFileSync(resolve(root, file), 'utf8'))) out.push({ file, ...f });
  }
  return out;
}

export function main(root = ROOT) {
  const found = scanTree(root);
  if (!found.length) {
    console.log('check-like-patterns: every LIKE search pattern comes from util/likeSearch.ts.');
    return 0;
  }
  for (const f of found) console.error(`${f.file}:${f.line}: ${f.rule}: ${f.text}`);
  console.error(`\ncheck-like-patterns: ${found.length} LIKE pattern(s) built outside ${relative(root, resolve(root, HELPER))}.`
    + '\nUse likeNeedle / likeNeedleLower / likePrefix with `LIKE ? ESCAPE \'\\\'` (D9167): they escape and cap at D1\'s 50 bytes.');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
