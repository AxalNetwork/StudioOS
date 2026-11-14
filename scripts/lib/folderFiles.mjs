/**
 * #4104 — the generated file list of a folder README: the pure half.
 *
 * A README that opts in holds one block between `FILES_BEGIN` and `FILES_END`.
 * The block lists the folder's own source files, one row each, described by
 * the first line of the file's header comment. Nobody writes the list by hand,
 * and it is not committed: `scripts/check-folder-docs.mjs --write` fills it in
 * the working tree for reading, and the check fails a commit whose block holds
 * anything. So adding a file never edits a README, and two pull requests that
 * each add a file never meet in one.
 *
 * What the check does demand: every file in an opted-in folder has a header
 * comment (`headerLine` returns null otherwise), so the list it generates is
 * never a row of blanks.
 */

export const FILES_BEGIN = '<!-- files:begin -->';
export const FILES_END = '<!-- files:end -->';

/** The files a generated list names: source files, not READMEs or declarations. */
export const LISTED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql)$/;
export const listedFile = (name) => LISTED_EXT.test(name) && !/\.d\.ts$/.test(name);

const MAX = 160;
/** Lines a header opens with that say nothing about the file. */
const NOT_A_DESCRIPTION = /^(eslint|@ts-|global |jshint|prettier|istanbul|@(?!\s))/;

/**
 * The header's first sentence: its first paragraph (lines up to a blank one,
 * pragma and tag lines skipped), up to the first full stop that ends a
 * sentence, clipped to MAX.
 */
function firstLine(lines) {
  const para = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) { if (para.length) break; continue; }
    if (NOT_A_DESCRIPTION.test(line)) { if (para.length) break; continue; }
    para.push(line);
  }
  if (!para.length) return null;
  const text = para.join(' ');
  const stop = /[.!?](?=\s+[A-Z(`*]|$)/.exec(text);
  const sentence = stop ? text.slice(0, stop.index + 1) : text;
  return sentence.length > MAX ? `${sentence.slice(0, MAX - 1).trimEnd()}…` : sentence;
}

/**
 * The first sentence of a file's header comment, or null when it has none: a
 * leading `//` (or SQL `--`) block, the same right after the imports, a leading
 * block comment, or else the file's first JSDoc block (a component's doc after
 * its imports). Tooling pragmas are skipped.
 */
export function headerLine(text) {
  const s = String(text ?? '').replace(/^#![^\n]*\n/, '');
  // A `//` header may follow the imports (`import { request } from '../api.js';` then the comment).
  const afterImports = s.replace(/^(?:\s*import\b[^;]*;[^\S\n]*\n)+/, '');
  const lead = /^\s*((?:\/\/[^\n]*(?:\n|$))+|(?:--[^\n]*(?:\n|$))+)/.exec(s) || /^\s*((?:\/\/[^\n]*(?:\n|$))+)/.exec(afterImports);
  if (lead) {
    const line = firstLine(lead[1].split('\n').map((l) => l.replace(/^\s*(?:\/\/|--)\s?/, '')));
    if (line) return line;
  }
  const fromBlock = (body) => firstLine(body.replace(/^\*/, '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '')));
  // A leading block comment, unless it is only a pragma; then the file's first JSDoc block.
  const lead2 = /^\s*\/\*([\s\S]*?)\*\//.exec(s);
  const fromLead = lead2 ? fromBlock(lead2[1]) : null;
  if (fromLead) return fromLead;
  for (const m of s.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    const line = fromBlock(m[1]);
    if (line) return line;
  }
  return null;
}

const cell = (s) => String(s).replace(/\|/g, '\\|');

/** The block's text for these files, sorted by name: `{ name, text }` each, `text` the file's contents. */
export function renderList(files) {
  const rows = [...files].sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => `| \`${f.name}\` | ${cell(headerLine(f.text) ?? '')} |`);
  return ['', '| File | What it is |', '| --- | --- |', ...rows, ''].join('\n');
}

/** Where the block sits in a README, or null when the README has none (or a broken one). */
export function findBlock(readme) {
  const src = String(readme ?? '');
  const start = src.indexOf(FILES_BEGIN);
  if (start < 0) return null;
  const end = src.indexOf(FILES_END, start + FILES_BEGIN.length);
  if (end < 0 || src.indexOf(FILES_BEGIN, start + FILES_BEGIN.length) >= 0) return { broken: true };
  return { broken: false, content: src.slice(start + FILES_BEGIN.length, end) };
}

/** The README with its block's content replaced by `content` ('' empties it). */
export function withBlock(readme, content) {
  const src = String(readme);
  const start = src.indexOf(FILES_BEGIN) + FILES_BEGIN.length;
  const end = src.indexOf(FILES_END, start);
  return `${src.slice(0, start)}${content ? `${content}` : '\n'}${src.slice(end)}`;
}

/** Whether a block holds a list: anything but blank lines. */
export const blockHoldsList = (content) => String(content ?? '').trim() !== '';
