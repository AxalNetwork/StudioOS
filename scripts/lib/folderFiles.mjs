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
 *
 * #6465 — a README may also declare, in itself, that it takes no hand-written
 * per-file rows: `INDEX_GENERATED` (the list comes from the files: source
 * headers, and a Markdown file's first heading, as in `decisions/README.md`)
 * or `INDEX_NONE` (the README describes the folder and its rule, no rows).
 * `perFileRows` finds the rows such a README must not carry. `folderListing`
 * is the one helper here that reads the disk: the files a block lists.
 *
 * #6470 — `scripts/` and `scripts/lib/` hold shell and Python files beside the
 * modules, so a `.sh` or `.py` file is listed too, described by its leading `#`
 * comment (after the shebang) or else a Python module docstring
 * (`hashHeaderLine`). A data file (`.json`, `.txt`) takes no comment and is not
 * listed: the script that reads or writes it describes it in its own header.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FILES_BEGIN = '<!-- files:begin -->';
export const FILES_END = '<!-- files:end -->';

/** The files a generated list names: source files (#6470: shell and Python too), not READMEs or declarations. */
export const LISTED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|sh|py)$/;
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

/** A line of a `#` header that says nothing about the file: a rule (`# ----`), a shellcheck or coding pragma, the file's bare path. */
const HASH_NOISE = /^(?:[-=#*_~]{3,}|shellcheck\b.*|-\*-.*-\*-|(?:vim?|pylint|noqa|type):.*|[\w./-]+\.(?:sh|py))$/;

/**
 * #6470: the first sentence of a shell or Python file's header, or null when it
 * has none: the leading `#` comment block after the shebang (rules and pragmas
 * skipped), else a Python module docstring.
 */
export function hashHeaderLine(text) {
  const s = String(text ?? '').replace(/^#![^\n]*\n/, '');
  const lead = /^(?:[^\S\n]*(?:#[^\n]*)?(?:\n|$))+/.exec(s)?.[0] ?? '';
  const lines = lead.split('\n').map((l) => l.replace(/^\s*#\s?/, '').trim()).map((l) => (HASH_NOISE.test(l) ? '' : l));
  const fromHash = firstLine(lines);
  if (fromHash) return fromHash;
  const doc = /^\s*[rRuU]?("\"\"|''')([\s\S]*?)\1/.exec(s.slice(lead.length));
  return doc ? firstLine(doc[2].split('\n')) : null;
}

/**
 * #6470: a file's whole header comment as text, comment markers stripped, or ''
 * when it has none: for a shell or Python file the leading `#` block after the
 * shebang and then a module docstring; for any other the consecutive leading
 * comments (`/* … *\/`, `//`, SQL `--`), else its first JSDoc block. What a
 * README row used to say about a file now lives here, so a test that once read
 * the row reads this.
 */
export function headerComment(name, text) {
  let s = String(text ?? '').replace(/^#![^\n]*\n/, '');
  const parts = [];
  if (/\.(sh|py)$/.test(name)) {
    const hash = /^(?:[^\S\n]*(?:#[^\n]*)?(?:\n|$))*/.exec(s)[0];
    parts.push(hash.split('\n').map((l) => l.replace(/^\s*#\s?/, '')).join('\n'));
    const doc = /^\s*[rRuU]?("""|\'\'\')([\s\S]*?)\1/.exec(s.slice(hash.length));
    if (doc) parts.push(doc[2]);
    return tidy(parts);
  }
  for (;;) {
    const rest = s.replace(/^\s+/, '');
    const block = /^\/\*([\s\S]*?)\*\//.exec(rest);
    const lines = /^(?:(?:\/\/|--)[^\n]*(?:\n|$)[^\S\n]*)+/.exec(rest);
    if (block) parts.push(block[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join('\n'));
    else if (lines) parts.push(lines[0].split('\n').map((l) => l.replace(/^\s*(?:\/\/|--)\s?/, '')).join('\n'));
    else break;
    s = rest.slice((block ?? lines)[0].length);
  }
  if (!parts.length) {
    const jsdoc = /\/\*\*([\s\S]*?)\*\//.exec(String(text ?? ''));
    if (jsdoc) parts.push(jsdoc[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join('\n'));
  }
  return tidy(parts);
}

/** Header parts as one text: trailing spaces dropped from each line, blank lines at either end trimmed. */
const tidy = (parts) => parts.join('\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();

/** A Markdown file's first line when it is a heading (`## D6465 — title (#6465)`), its `#`s dropped; else null. */
export function headingLine(text) {
  const first = String(text ?? '').split('\n').find((l) => l.trim() !== '');
  const m = first ? /^#{1,6}\s+(\S.*)$/.exec(first.trim()) : null;
  if (!m) return null;
  const line = m[1].trim();
  return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
}

/** What a list row says about a file: a Markdown file's heading, a shell or Python file's `#` header, any other file's header comment. */
export const describe = (name, text) => (/\.md$/.test(name) ? headingLine(text) : /\.(sh|py)$/.test(name) ? hashHeaderLine(text) : headerLine(text));

const cell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/** The block's text for these files, sorted by name (D999 before D1000): `{ name, text }` each, `text` the file's contents. */
export function renderList(files) {
  const rows = [...files].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .map((f) => `| \`${f.name}\` | ${cell(describe(f.name, f.text) ?? '')} |`);
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

// ── #6465: a README that declares it takes no per-file rows ──────────────────
export const INDEX_GENERATED = '<!-- index: generated -->';
export const INDEX_NONE = '<!-- index: none -->';

/**
 * The README's own declaration: 'generated', 'none', null when it has neither
 * (it behaves as before #6465), or 'both' when it has the two (an error).
 */
export function indexMode(readme) {
  const src = String(readme ?? '');
  const gen = src.includes(INDEX_GENERATED);
  const none = src.includes(INDEX_NONE);
  return gen && none ? 'both' : gen ? 'generated' : none ? 'none' : null;
}

/**
 * The files a generated list names. An unmarked README with a block lists
 * source files (`listedFile`); one marked `index: generated` also lists the
 * folder's Markdown files but its README, described by their first heading.
 */
export function folderListing(abs, mode = null) {
  const keep = (n) => listedFile(n) || (mode === 'generated' && /\.md$/.test(n) && n !== 'README.md');
  return readdirSync(abs, { withFileTypes: true }).filter((e) => e.isFile() && keep(e.name))
    .map((e) => ({ name: e.name, text: readFileSync(join(abs, e.name), 'utf8') }));
}

/**
 * The hand-written per-file rows in a README, outside its generated block: a
 * table row whose first cell is one backticked name of a file in `names` (the
 * folder's own files). `{ line, name }` each, `line` 1-based. A row naming a
 * subfolder, or anything that is not one of the folder's files, is not one.
 */
export function perFileRows(readme, names) {
  const files = new Set(names);
  const src = String(readme ?? '');
  const block = findBlock(src);
  const outside = block && !block.broken ? withBlock(src, '') : src;
  const out = [];
  outside.split('\n').forEach((raw, i) => {
    const m = /^\s*\|\s*`([^`]+)`\s*\|/.exec(raw);
    if (m && files.has(m[1])) out.push({ line: i + 1, name: m[1] });
  });
  return out;
}
