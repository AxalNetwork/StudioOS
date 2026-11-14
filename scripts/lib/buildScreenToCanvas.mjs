/**
 * #6326: the build checklist for a landed canvas, for the `build-screen-to-canvas`
 * skill. Decides, from a `· Boards.dc.html` file's `renderVals` list alone,
 * which boards a build owes and at what size: every board's id, title and
 * caption, each frame's page-file key, label and width, whether that frame is
 * a desktop (over 900px), tablet or 390 phone frame, and whether the board
 * draws the dark theme. Also writes the PR's departures table. Reads the file
 * as text and never runs it: a canvas is data. Owned by
 * `../build-screen-to-canvas.mjs`; tested in `buildScreenToCanvas.test.mjs`.
 */

/** A frame's size class from its drawn width in px. */
export function sizeOf(width) {
  if (!Number.isFinite(width)) return 'unknown';
  if (width <= 480) return 'phone';
  if (width <= 900) return 'tablet';
  return 'desktop';
}

/** The index of the bracket or paren that closes the one at `open`, skipping quoted strings; -1 when unclosed. */
function closeOf(src, open) {
  const pair = { '[': ']', '(': ')' };
  const stack = [pair[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = endOfString(src, i); if (i < 0) return -1; continue; }
    if (c === '[' || c === '(') stack.push(pair[c]);
    else if (c === ']' || c === ')') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/** The index of the quote that ends the string opening at `i`; -1 when unterminated. */
function endOfString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j;
  }
  return -1;
}

/** Top-level comma-separated pieces of an argument list, trimmed. */
export function splitArgs(src) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { const e = endOfString(src, i); if (e < 0) break; i = e; continue; }
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(src.slice(start, i).trim()); start = i + 1; }
  }
  const last = src.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** A quoted literal's text, or null for anything else (`false`, a name, an expression). */
export function literal(arg) {
  const m = /^(['"])((?:\\.|(?!\1).)*)\1$/s.exec(String(arg ?? '').trim());
  return m ? m[2].replace(/\\(.)/g, '$1') : null;
}

/** A `const W = { ro02: 788, ph1: 390 }` width table as an object; null when `name` is not declared as one. */
function widthMapOf(text, name) {
  const m = new RegExp(`const\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*\\{([^}]*)\\}`).exec(text);
  if (!m) return null;
  const map = {};
  for (const [, k, v] of m[1].matchAll(/['"]?([\w$-]+)['"]?\s*:\s*(\d+)/g)) map[k] = Number(v);
  return Object.keys(map).length ? map : null;
}

/**
 * The helpers a boards file declares, each as its parameter names and where a
 * frame's width comes from: `{ value }`, `{ param, fallback }`, or null for a
 * helper that draws no frame (a board-row helper). In order:
 *   · a helper that calls another frame helper (`const P = (b, lab) => D(b, lab, 390, 844, 28)`)
 *     takes the width that call passes;
 *   · a parameter named `w` carries it, falling back to `(w || 1440)`'s number;
 *   · a lookup `W[k] || 1440` into a `const W = { ph1: 390, … }` table gives
 *     `{ map, fallback }`: the frame's key (or the key less `-d`) in the table, else the fallback;
 *   · a literal `width:390px` or `hs: '390px,…'` in the body fixes it.
 */
export function helpersOf(src) {
  const helpers = {};
  const text = String(src);
  for (const m of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>\s*/g)) {
    const params = m[2].split(',').map((p) => p.trim().split('=')[0].trim()).filter(Boolean);
    const start = m.index + m[0].length;
    const nl = text.indexOf('\n', start);
    const body = text.slice(start, nl < 0 ? undefined : nl);
    let width = null;
    const call = /^([A-Za-z_$][\w$]*)\(/.exec(body);
    if (call && helpers[call[1]]?.width) {
      const inner = helpers[call[1]];
      const close = closeOf(body, call[0].length - 1);
      const args = close < 0 ? [] : splitArgs(body.slice(call[0].length, close));
      if ('value' in inner.width || inner.width.map) width = inner.width;
      else {
        const raw = (args[inner.width.param] || '').trim();
        const own = params.indexOf(raw.split(/\s*\|\|\s*/)[0]);
        const fb = /\|\|\s*(\d+)/.exec(raw);
        width = /^\d+$/.test(raw) ? { value: Number(raw) }
          : own >= 0 ? { param: own, fallback: fb ? Number(fb[1]) : inner.width.fallback }
          : { value: inner.width.fallback };
      }
    } else if (params.includes('w')) {
      const fb = /\(\s*w\s*\|\|\s*(\d+)\s*\)/.exec(body);
      width = { param: params.indexOf('w'), fallback: fb ? Number(fb[1]) : NaN };
    } else {
      const look = /\b([A-Za-z_$][\w$]*)\[\s*[\w$]+\s*\]\s*\|\|\s*(\d+)/.exec(body);
      const map = look && widthMapOf(text, look[1]);
      const lit = /(?<![\w-])width:\s*(\d+)px|\bhs:\s*'(\d+)px/.exec(body);
      if (map) width = { map, fallback: Number(look[2]) };
      else if (lit) width = { value: Number(lit[1] || lit[2]) };
    }
    helpers[m[1]] = { params, width };
  }
  return helpers;
}

/** One frame call (`P('BU02', false)`) as `{ key, label, width, size }`; null when it is not a call to a frame helper. */
export function frameOf(call, helpers) {
  const body = String(call).trim();
  const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(body);
  if (!m || !helpers[m[1]]?.width) return null;
  const open = body.indexOf('(');
  const close = closeOf(body, open);
  if (close < 0) return null;
  const args = splitArgs(body.slice(open + 1, close));
  const h = helpers[m[1]];
  let width;
  const key = literal(args[0]) ?? args[0] ?? '';
  if ('value' in h.width) width = h.width.value;
  else if (h.width.map) width = h.width.map[key] ?? h.width.map[key.replace(/-d$/, '')] ?? h.width.fallback;
  else {
    const raw = (args[h.width.param] || '').trim();
    width = /^\d+$/.test(raw) ? Number(raw) : h.width.fallback;
  }
  return { key, label: literal(args[1]), width, size: sizeOf(width) };
}

/** The elements of one board row, whether it is an array (`['BD1', 'Title', 'Caption', [frames]]`) or a helper call (`G('AK1', 'Title', [frames], 'Note')`). */
function rowParts(row, helpers) {
  if (row.startsWith('[')) {
    const end = closeOf(row, 0);
    return end < 0 ? null : splitArgs(row.slice(1, end));
  }
  const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(row);
  if (!m || !helpers[m[1]] || helpers[m[1]].width) return null;
  const open = row.indexOf('(');
  const close = closeOf(row, open);
  return close < 0 ? null : splitArgs(row.slice(open + 1, close));
}

/**
 * Boards drawn as literal `<dc-import … board="X" hint-size="1440px,…">` tags,
 * one board per tag. A tag carries no title or caption, so each board keeps
 * the `<section id>` and first `<h2>` it sits under (`phone · Phone`), the only
 * place such a file says a board is a phone or dark one.
 */
function staticBoards(src) {
  const sections = [...src.matchAll(/<section\b([^>]*)>/g)].map((m) => {
    const id = /\bid="([^"]*)"/.exec(m[1])?.[1] ?? '';
    const after = src.slice(m.index);
    const next = after.indexOf('<section', 1);
    const h2 = /<h2\b[^>]*>([^<]*)<\/h2>/.exec(next > 0 ? after.slice(0, next) : after)?.[1]?.trim() ?? '';
    return { at: m.index, label: [id, h2].filter(Boolean).join(' · ') };
  });
  const out = [];
  for (const m of src.matchAll(/<dc-import\b([^>]*)>/g)) {
    const attrs = m[1];
    const key = /\b(?:board|v|b|screen)="([^"{}]+)"/.exec(attrs)?.[1];
    const w = /\bhint-size="(\d+)px/.exec(attrs)?.[1];
    if (!key) continue;
    const width = w ? Number(w) : NaN;
    const section = sections.filter((x) => x.at < m.index).pop()?.label ?? '';
    out.push({ id: key, title: '', caption: '', section, frames: [{ key, label: null, width, size: sizeOf(width) }] });
  }
  return out;
}

const DARK = /\bdark\b/i;
const PHONE = /\bphones?\b/i;

/** The board rows of a `renderVals` list opening at `open`; null when the list does not close. */
function listRows(src, start, open) {
  const close = closeOf(src, open);
  if (close < 0) return null;
  const helpers = helpersOf(src.slice(0, start));
  const rows = [];
  for (const row of splitArgs(src.slice(open + 1, close))) {
    const parts = rowParts(row, helpers);
    const id = parts && literal(parts[0]);
    if (!id) continue;
    const rest = parts.slice(2);
    const list = rest.find((p) => p.startsWith('['));
    const frames = list
      ? splitArgs(list.slice(1, closeOf(list, 0))).map((c) => frameOf(c, helpers)).filter(Boolean)
      : [];
    const caption = rest.map(literal).find((t) => t !== null) ?? '';
    rows.push({ id, title: literal(parts[1]) ?? '', caption, section: '', frames });
  }
  return rows;
}

/**
 * Every board in a boards file, in the file's order, and where the list came from:
 * `{ source, boards: [{ id, title, caption, section, frames: [{ key, label, width, size }], phone, tablet, desktop, dark }] }`.
 * `source` is `list` (a `const boards = [ … ]`, `boards: [ … ]` or
 * `groups: [ … ]` list in `renderVals`), `static` (literal `<dc-import>`
 * tags, read only when the file has no such list), `unread` (a list this
 * reader cannot follow, or nothing it knows: `boards` is then [] and the board
 * list is read by hand). Never a guess: a list it cannot follow is never
 * replaced by the template's placeholder tag.
 *
 * Phone is a frame of 480px or less, or a static board under a Phone section.
 * Dark is a board titled dark, a frame labelled dark or keyed `-d`, or a
 * static board under a dark section. A caption is never read for either: it
 * carries sample content.
 */
export function readBoards(html) {
  const src = String(html);
  const m = /const\s+boards\s*=\s*\[|\bboards\s*:\s*\[|\bgroups\s*:\s*\[/.exec(src);
  let rows;
  let source;
  if (m) {
    rows = listRows(src, m.index, m.index + m[0].length - 1) ?? [];
    source = rows.length ? 'list' : 'unread';
  } else {
    rows = staticBoards(src);
    source = rows.length ? 'static' : 'unread';
  }
  const boards = rows.map((b) => {
    const sizes = new Set(b.frames.map((f) => f.size));
    const dark = DARK.test(b.title) || DARK.test(b.section)
      || b.frames.some((f) => DARK.test(f.label || '') || /(^|[-_])d(ark)?$/i.test(f.key));
    const phone = sizes.has('phone') || PHONE.test(b.section);
    return { ...b, phone, tablet: sizes.has('tablet'), desktop: sizes.has('desktop'), dark };
  });
  return { source, boards };
}

/** The boards alone (see `readBoards`); [] for a shape this reader cannot follow. */
export function boardsDetail(html) {
  return readBoards(html).boards;
}

/**
 * What the canvas owes a build, in one object: the board ids by size and
 * theme, and what it does not draw. `missing` is said only when every board
 * was read from a `renderVals` list with a known width for every frame;
 * otherwise it is [] and `unsure` says why, and the Phone and Dark columns
 * are hints to confirm against the boards file.
 */
export function coverage(boards, source = 'list') {
  const ids = (pred) => boards.filter(pred).map((b) => b.id);
  const noFrames = ids((b) => !b.frames.length);
  const noWidth = ids((b) => b.frames.some((f) => !Number.isFinite(f.width)));
  const unsure = source === 'static' ? 'boards read from <dc-import> tags, whose phone and dark are only section headings'
    : source !== 'list' ? 'no board read'
    : noFrames.length ? `no frame read for ${noFrames.join(', ')}`
    : noWidth.length ? `no width read for a frame of ${noWidth.join(', ')}`
    : null;
  return {
    boards: boards.length,
    desktop: ids((b) => b.desktop),
    tablet: ids((b) => b.tablet),
    phone: ids((b) => b.phone),
    dark: ids((b) => b.dark),
    noFrames,
    unsure,
    missing: unsure ? [] : [
      ...(boards.some((b) => b.phone) ? [] : ['no 390 phone board: the build still ships a phone layout (AGENTS.md § Missing UI step 5) and lists it as a departure']),
      ...(boards.some((b) => b.dark) ? [] : ['no dark board: the build still passes check-dark-mode and lists the dark theme as a departure']),
    ],
  };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The checklist as a Markdown table: one row per board with its frames and sizes. */
export function checklistTable(boards) {
  const rows = ['| Board | Title | Frames (key · width) | Phone | Dark |', '| --- | --- | --- | --- | --- |'];
  for (const b of boards) {
    const frames = b.frames.map((f) => `${f.key} · ${f.width}${f.label ? ` (${cell(f.label)})` : ''}`).join('; ') || 'none';
    rows.push(`| ${cell(b.id)} | ${cell(b.title || (b.section ? `(section: ${b.section})` : ''))} | ${cell(frames)} | ${b.phone ? 'yes' : '—'} | ${b.dark ? 'yes' : '—'} |`);
  }
  return rows.join('\n');
}

/**
 * The PR body's departures table (AGENTS.md § Missing UI step 5): one row per
 * board, the build columns left for the author. A board left out of the build
 * keeps its row and says why.
 */
export function departuresTable(boards) {
  const rows = ['| Board | Built in | Departs from the canvas | Why |', '| --- | --- | --- | --- |'];
  for (const b of boards) rows.push(`| ${cell(b.id)} ${cell(b.title)} |  |  |  |`);
  return rows.join('\n');
}

/** The landed boards file for a canvas name, matched without case against a directory listing; null when absent. */
export function boardsFileFor(name, files) {
  const want = `${String(name).trim()} · Boards.dc.html`.toLowerCase();
  return files.find((f) => f.toLowerCase() === want) ?? null;
}

/** The page file beside a boards file (`X · Boards.dc.html` → `X Page.dc.html`), matched without case; null when absent. */
export function pageFileFor(boardsFile, files) {
  const base = String(boardsFile).replace(/ · Boards\.dc\.html$/i, '');
  const want = `${base} Page.dc.html`.toLowerCase();
  return files.find((f) => f.toLowerCase() === want) ?? null;
}

/**
 * Whether a route-map fragment's row is this canvas's: its first cell, less a
 * trailing `(…)` qualifier and a trailing ` Page` or ` · Boards`, equals the
 * canvas name without case (`| Skill library v2 (HQ and Team) |` is
 * `Skill Library v2`'s row, `| Zone Headers · Boards |` is `Zone Headers`'s),
 * or the row names the canvas's landed file. A row worded otherwise
 * (`Fund administration` for `Fund admin`) is not found: the skill greps for
 * the name before it adds a row.
 */
export function rowNamesCanvas(row, name, files = []) {
  const text = String(row);
  if (files.some((f) => f && text.includes(f))) return true;
  const first = /^\|\s*([^|]*?)\s*\|/.exec(text.trim())?.[1];
  if (!first) return false;
  const bare = first.replace(/`/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim()
    .replace(/\s+(?:Page|·\s*Boards)$/i, '').trim().toLowerCase();
  return bare === String(name).trim().toLowerCase();
}
