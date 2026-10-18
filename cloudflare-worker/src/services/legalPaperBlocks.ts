// D711 (#1776) — a legal body as typed blocks of plain text.
//
// `paperBlocks(body, { merge, title })` reads an authored template body
// (Markdown or plain text) into one block list, and every renderer draws that
// list: the HTML paper (legalPaper.ts), the pdf-lib fallback (pdf.ts) and the
// Word export (legalDocx.ts). Blocks hold plain text, never HTML; each
// renderer escapes for its own output. Where `normalizeLegalBody` strips
// headings, bullets and bold, this keeps them as structure (decision 1).
//
// The rules (step 4):
//   - `#`, `##`, `###`: title, article, section; a `#` equal to the document
//     title is dropped. A `Recitals` heading and its `WHEREAS` paragraphs are
//     recitals. A heading starting "Schedule" or "Exhibit" is a schedule
//     title, and an "As of …" paragraph right under it is its dateline.
//   - A leading `1.`, `1.1` or `(a)` is a number with a hanging indent, one
//     step deeper for `(a)`. A `###` over a paragraph is its run-in heading.
//   - `**x**` bold, `*x*` oblique; a quoted term in parentheses is bold (its
//     definition is its first use). Cross-references stay plain text.
//   - A table keeps each column's alignment; a column with none whose cells
//     are all figures is right-aligned in mono; a last row starting "Total" is
//     the totals row.
//   - A blockquote is a legend; one opening "Warning" or "Important" a warning.
//   - `- [ ]` / `- [x]` are checkbox rows; three or more underscores a fill-in.
//   - `brackets` turns every well-formed merge token into a tinted `[LABEL]`
//     run, known to the schema or not, so no preview prints `{{` (#1865).
//   - A paragraph is the run of lines up to a blank line: a wrapped line joins
//     the line above it (#1865, `joins`), so bold that wraps is still bold.
//   - A body with no `#` heading line reads plain capitals as headings:
//     "ARTICLE I — …", "SECTION 1 — …" and "1. ELIGIBILITY" are articles, any
//     other short line with no lowercase letter a section (#1865).
//   - `paperText` runs on every string: ↔ is an en dash, → and ← are > and <
//     (no arrow characters on paper), ☐ ☑ ✓ ✔ drawn boxes, and emoji are
//     dropped.
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import { bracketLabel } from './legalMergeSchema';

export type MergeMode = 'brackets' | 'raw' | 'filled';

export type Run =
  | { k: 'text'; text: string }
  | { k: 'bold'; text: string }
  | { k: 'em'; text: string }
  | { k: 'term'; text: string }
  | { k: 'merge'; text: string }
  | { k: 'fill' }
  | { k: 'box'; checked: boolean };

export type Align = 'left' | 'right' | 'center';

export type Block =
  | { t: 'title'; runs: Run[] }
  | { t: 'article'; runs: Run[]; id: string; text: string }
  | { t: 'section'; runs: Run[] }
  | { t: 'recitals'; runs: Run[] }
  | { t: 'recital'; runs: Run[] }
  | { t: 'schedule'; runs: Run[]; dateline: Run[] | null }
  | { t: 'para'; runs: Run[]; num: string | null; depth: 0 | 1 | 2; runIn: Run[] | null }
  | { t: 'bullets'; items: Run[][] }
  | { t: 'table'; align: Align[]; mono: boolean[]; head: Run[][]; rows: Run[][][]; total: boolean }
  | { t: 'legend'; warning: boolean; paras: Run[][] }
  | { t: 'check'; checked: boolean; runs: Run[] }
  | { t: 'rule' };

export interface PaperBlockOptions {
  merge?: MergeMode;
  /** The document title: a `#` heading equal to it is dropped. */
  title?: string | null;
}

// --- strings -------------------------------------------------------------------

const CHECK_CHARS: Record<string, boolean> = { '☐': false, '☑': true, '✓': true, '✔': true };

/**
 * Normalise one string for the paper: ↔ becomes an en dash, → and ← become
 * > and <, and emoji are dropped. Checkbox glyphs are left for `inlineRuns`
 * to draw.
 */
export function paperText(s: string): string {
  return String(s ?? '')
    .replace(/\u2194/g, '\u2013')
    .replace(/\u2192/g, '>')
    .replace(/\u2190/g, '<')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{260F}\u{2612}-\u{27BF}\uFE0F\u200D]/gu, (ch) => (ch in CHECK_CHARS ? ch : ''))
    .replace(/\p{Emoji_Presentation}/gu, '');
}

/** The plain text of a run list (for ids, comparisons and the contents). */
export function runsText(runs: Run[]): string {
  return runs.map((r) => (r.k === 'fill' ? '____' : r.k === 'box' ? (r.checked ? '[X]' : '[ ]') : r.text)).join('');
}

// --- inline runs ---------------------------------------------------------------

function pushText(out: Run[], k: 'text' | 'bold' | 'em' | 'term' | 'merge', text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.k === k && k !== 'merge') (last as { text: string }).text += text;
  else out.push({ k, text } as Run);
}

/** Merge tokens, fill-in lines and drawn boxes inside one emphasis span. */
function leafRuns(out: Run[], k: 'text' | 'bold' | 'em', s: string, merge: MergeMode) {
  const re = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}|_{3,}|[☐☑✓✔]/gu;
  let at = 0;
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0;
    pushText(out, k, s.slice(at, i));
    at = i + m[0].length;
    if (m[1] !== undefined) {
      if (merge === 'brackets') out.push({ k: 'merge', text: bracketLabel(m[1]) });
      else pushText(out, k, m[0]);
    } else if (m[0].startsWith('_')) {
      out.push({ k: 'fill' });
    } else {
      out.push({ k: 'box', checked: CHECK_CHARS[m[0]] });
    }
  }
  pushText(out, k, s.slice(at));
}

/** Split plain text into runs, marking `(the "Term")` defined terms bold. */
function termRuns(out: Run[], k: 'text' | 'bold' | 'em', s: string, merge: MergeMode) {
  if (k !== 'text') { leafRuns(out, k, s, merge); return; }
  const re = /\((?:the |an? )?(["“])([^"“”\n]{1,80})(["”])\)/g;
  let at = 0;
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0;
    const open = m[0].indexOf(m[1]);
    leafRuns(out, 'text', s.slice(at, i + open), merge);
    out.push({ k: 'term', text: m[1] + m[2] + m[3] });
    pushText(out, 'text', ')');
    at = i + m[0].length;
  }
  leafRuns(out, 'text', s.slice(at), merge);
}

export function inlineRuns(raw: string, merge: MergeMode = 'raw'): Run[] {
  const s = paperText(raw)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/~~([^~\n]+?)~~/g, '$1')
    .replace(/`([^`\n]+?)`/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~])/g, '$1');
  const out: Run[] = [];
  const re = /\*\*([^*\n]+?)\*\*|(^|[^\w*])\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*(?![\w*])/g;
  let at = 0;
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0;
    if (m[1] !== undefined) {
      termRuns(out, 'text', s.slice(at, i), merge);
      leafRuns(out, 'bold', m[1], merge);
    } else {
      termRuns(out, 'text', s.slice(at, i) + m[2], merge);
      leafRuns(out, 'em', m[3], merge);
    }
    at = i + m[0].length;
  }
  termRuns(out, 'text', s.slice(at), merge);
  return out;
}

// --- tables --------------------------------------------------------------------

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const DELIM_CELL = /^:?-{1,}:?$/;
// A figure, read with its whitespace removed: `$1,000`, `(250.00)`, `-5%`, `2.5x`.
const FIGURE = /^\(?[-−–]?[$€£¥]?[-−–]?\d[\d,]*(?:\.\d+)?(?:%|x)?\)?$/;

function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIM_CELL.test(c));
}

function tableBlock(lines: string[], merge: MergeMode): Block {
  const head = splitRow(lines[0]);
  const delims = splitRow(lines[1]);
  const body = lines.slice(2).map(splitRow);
  const n = head.length;
  const align: Align[] = [];
  const mono: boolean[] = [];
  for (let c = 0; c < n; c++) {
    const d = delims[c] || '';
    const explicit: Align | null = d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : null;
    const cells = body.map((r) => r[c] ?? '').filter((x) => x !== '');
    const figures = cells.length > 0 && cells.every((x) => FIGURE.test(x.replace(/\*\*/g, '').replace(/\s+/g, '')));
    align.push(explicit ?? (figures ? 'right' : 'left'));
    mono.push(explicit === null && figures);
  }
  const last = body[body.length - 1];
  const total = !!last && /^(\*\*)?total\b/i.test(last[0] || '');
  return {
    t: 'table', align, mono,
    head: head.map((c) => inlineRuns(c, merge)),
    rows: body.map((r) => Array.from({ length: n }, (_, c) => inlineRuns(r[c] ?? '', merge))),
    total,
  };
}

// --- blocks --------------------------------------------------------------------

// `1.`, `1.1`, `1.1.`, `1.2.3`: dot-ended segments, then optional digits, so no
// two paths match the same text (no backtracking blow-up).
const NUM_DOTTED = /^(\d+\.(?:\d+\.)*\d*)\s+(.*)$/;
const NUM_PAREN = /^\(([a-z]{1,2}|[ivxl]{1,5}|\d{1,2})\)\s+(.*)$/i;
const TASK = /^[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BOX_LINE = /^(?:\[([ xX])\]|([☐☑✓✔]))\s+(.*)$/u;
const BULLET = /^[-*+•]\s+(.*)$/;
const HR = /^([-*_])(?:\s*\1){2,}$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// #1865 — plain-capitals headings, read only in a body with no `#` heading line.
const PLAIN_ARTICLE = /^(ARTICLE|SECTION|PART)\s+(\d{1,3}|[IVXLC]{1,7})\s*[—–-]\s*\S/;
const NUM_CAPS = /^\d{1,2}\.\s+(?=[^a-z]*[A-Z])[^a-z]+$/;
const FILL_IN = /_{3,}/;

/** A plain-capitals section heading: 2 to 90 characters, no lowercase, no closing `.`, `:` or `;`. */
function plainSection(line: string): boolean {
  return line.length >= 2 && line.length <= 90 && /[A-Z]/.test(line) && !/[a-z]/.test(line)
    && !/[.:;]$/.test(line) && !FILL_IN.test(line);
}

function sameTitle(a: string, b: string | null | undefined): boolean {
  const n = (s: string) => paperText(s).replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return !!b && n(a) === n(b);
}

function slugId(k: number): string {
  return `art-${k}`;
}

export function paperBlocks(body: string, opts: PaperBlockOptions = {}): Block[] {
  const merge = opts.merge || 'raw';
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const out: Block[] = [];
  let inRecitals = false;
  let pendingRunIn: Run[] | null = null;
  let lastSchedule: Extract<Block, { t: 'schedule' }> | null = null;
  let articles = 0;
  let i = 0;
  const plain = !lines.some((l) => HEADING.test(l.trim()));

  const flushRunIn = () => {
    if (pendingRunIn) { out.push({ t: 'section', runs: pendingRunIn }); pendingRunIn = null; }
  };

  /** Whether a line starts a block of its own, so it never joins the line above. */
  const startsBlock = (l: string) => HEADING.test(l) || l.startsWith('|') || l.startsWith('>') || HR.test(l)
    || TASK.test(l) || BOX_LINE.test(l) || (BULLET.test(l) && !/^[-*+]\s*$/.test(l))
    || NUM_DOTTED.test(l) || NUM_PAREN.test(l) || /^whereas\b/i.test(l)
    || (plain && (PLAIN_ARTICLE.test(l) || NUM_CAPS.test(l) || plainSection(l)));
  /**
   * #1865 — the lines after `i` that continue its paragraph, joined with one
   * space; `i` moves past them. A line joins when there is no blank line
   * between, it starts no block of its own, neither line holds a fill-in, and
   * the line above ends without `.`, `:`, `;`, `?` or `!` or this one starts
   * lowercase.
   */
  const joins = (first: string): string => {
    let text = first;
    let prev = first;
    while (i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (!next || startsBlock(next) || FILL_IN.test(prev) || FILL_IN.test(next)) break;
      if (/[.:;?!]$/.test(prev) && !/^[a-z]/.test(next)) break;
      text += ' ' + next;
      prev = next;
      i++;
    }
    return text;
  };

  for (i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const scheduleBefore = lastSchedule;
    lastSchedule = null;

    // Tables: a header row, a delimiter row, then body rows.
    if (line.startsWith('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      flushRunIn();
      const rows = [line, lines[i + 1].trim()];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith('|')) rows.push(lines[j++].trim());
      out.push(tableBlock(rows, merge));
      i = j - 1;
      continue;
    }

    // Blockquotes: a legend, or a warning.
    if (line.startsWith('>')) {
      flushRunIn();
      const paras: string[][] = [[]];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('>')) {
        const inner = lines[j].trim().replace(/^(?:>\s?)+/, '').trim();
        if (inner === '') { if (paras[paras.length - 1].length) paras.push([]); }
        else paras[paras.length - 1].push(inner);
        j++;
      }
      const texts = paras.filter((p) => p.length).map((p) => p.join(' '));
      const warning = /^(\*\*)?\s*(warning|important)\b/i.test(texts[0] || '');
      out.push({ t: 'legend', warning, paras: texts.map((p) => inlineRuns(p, merge)) });
      i = j - 1;
      continue;
    }

    if (HR.test(line)) { flushRunIn(); out.push({ t: 'rule' }); continue; }

    const h = line.match(HEADING);
    if (h) {
      flushRunIn();
      const level = h[1].length;
      const text = h[2];
      if (level === 1) {
        if (sameTitle(text, opts.title)) continue;
        out.push({ t: 'title', runs: inlineRuns(text, merge) });
        continue;
      }
      if (level === 2) {
        if (/^recitals\b/i.test(text.replace(/\*/g, ''))) {
          inRecitals = true;
          out.push({ t: 'recitals', runs: inlineRuns(text, merge) });
          continue;
        }
        inRecitals = false;
        if (/^(schedule|exhibit)\b/i.test(text.replace(/\*/g, ''))) {
          const s: Extract<Block, { t: 'schedule' }> = { t: 'schedule', runs: inlineRuns(text, merge), dateline: null };
          out.push(s);
          lastSchedule = s;
          continue;
        }
        articles++;
        const runs = inlineRuns(text, merge);
        out.push({ t: 'article', runs, id: slugId(articles), text: runsText(runs) });
        continue;
      }
      // ### and deeper: a run-in heading for the paragraph below, else a section.
      pendingRunIn = inlineRuns(text, merge);
      continue;
    }

    // A schedule's "As of …" dateline.
    if (scheduleBefore && /^as of\b/i.test(line.replace(/\*/g, ''))) {
      scheduleBefore.dateline = inlineRuns(line, merge);
      continue;
    }

    const task = line.match(TASK) || null;
    const boxLine = task ? null : line.match(BOX_LINE);
    if (task || boxLine) {
      flushRunIn();
      const checked = task ? task[1].trim() !== '' : boxLine![1] !== undefined ? boxLine![1].trim() !== '' : CHECK_CHARS[boxLine![2]];
      out.push({ t: 'check', checked, runs: inlineRuns(joins(task ? task[2] : boxLine![3]), merge) });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet && !/^[-*+]\s*$/.test(line)) {
      flushRunIn();
      const prev = out[out.length - 1];
      const item = inlineRuns(joins(bullet[1]), merge);
      if (prev && prev.t === 'bullets') prev.items.push(item);
      else out.push({ t: 'bullets', items: [item] });
      continue;
    }

    // #1865 — plain capitals, in a body with no `#` heading line.
    if (plain && (PLAIN_ARTICLE.test(line) || NUM_CAPS.test(line))) {
      flushRunIn();
      inRecitals = false;
      articles++;
      const runs = inlineRuns(line, merge);
      out.push({ t: 'article', runs, id: slugId(articles), text: runsText(runs) });
      continue;
    }
    if (plain && plainSection(line)) {
      flushRunIn();
      if (!sameTitle(line, opts.title)) out.push({ t: 'section', runs: inlineRuns(line, merge) });
      continue;
    }

    if (inRecitals || /^whereas\b/i.test(line)) {
      flushRunIn();
      out.push({ t: 'recital', runs: inlineRuns(line, merge) });
      continue;
    }

    const dotted = line.match(NUM_DOTTED);
    const paren = dotted ? null : line.match(NUM_PAREN);
    const runIn = pendingRunIn;
    pendingRunIn = null;
    if (dotted) {
      out.push({ t: 'para', runs: inlineRuns(joins(dotted[2]), merge), num: dotted[1], depth: 1, runIn });
    } else if (paren) {
      out.push({ t: 'para', runs: inlineRuns(joins(paren[2]), merge), num: `(${paren[1]})`, depth: 2, runIn });
    } else {
      out.push({ t: 'para', runs: inlineRuns(joins(line), merge), num: null, depth: 0, runIn });
    }
  }
  flushRunIn();
  return out;
}
