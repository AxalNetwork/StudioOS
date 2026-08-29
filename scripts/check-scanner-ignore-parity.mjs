#!/usr/bin/env node
/**
 * Fails the build when a generated top-level tree is missing from a scanner's
 * ignore list, or is ignored by one scanner and not the other.
 *
 * WHY THIS EXISTS. Two files list the trees that static analysis should not
 * read — `.github/codeql/codeql-config.yml` (`paths-ignore`) and
 * `.semgrepignore`. They were correct, and then `design/canvases/` landed:
 * 49M of Claude Design canvases, 110 `.dc.html` pages and a generated
 * `support.js`, ~83k lines, referenced by no build config and served by
 * nothing. Neither list mentioned it. The result was roughly sixty security
 * alerts and 1,345 of 1,384 code-quality findings — all of them in a tree
 * that does not run — burying the handful of findings in real source.
 *
 * Nobody made a mistake there. Both files carry a careful comment explaining
 * the rule, and the rule was simply not applied to a directory added months
 * later. A comment cannot fail a build. This file can.
 *
 * WHAT COUNTS AS GENERATED, and why the test is a header rather than a name.
 * The canvases and the already-ignored `spin-out-lab-pipeline/` are the same
 * dc-runtime export, and each ships a bundle whose first line says so
 * verbatim:
 *
 *     // GENERATED from dc-runtime/src/*.ts — do not edit. Rebuild with ...
 *
 * That sentence is the repo's own statement that a tree is build output, made
 * by the tool that produced it. Matching on it means a future canvas import
 * is caught by the same evidence rather than by someone remembering to
 * update a list of directory names here. Trees ignored for other good reasons
 * — `docs/` (Vite output), `attached_assets/` (pasted text) — are not
 * discovered this way and are not required to be; they are already listed,
 * and PARITY below still holds them to being listed in both places.
 *
 * WHAT IS DELIBERATELY NOT CHECKED. This guard does not verify that an
 * ignored tree is genuinely unreferenced by the build — that is
 * `check-docs-fresh.mjs`/`check-api-drift.mjs` territory and would need a
 * bundler graph. It checks only that the two lists agree with each other and
 * cover every generated tree present on disk. Suppressing analysis of code
 * that ships would be a real problem; nothing here can tell you that you did
 * it, so do not read a pass as permission to add a tree to these lists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODEQL = path.join(ROOT, '.github/codeql/codeql-config.yml');
const SEMGREP = path.join(ROOT, '.semgrepignore');

/** The generator's own marker, as written into the first line of its bundle. */
const GENERATED_MARKER = 'GENERATED from dc-runtime/src/';

/** Never walked: no generated tree hides in here, and they are enormous. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.wrangler']);

/**
 * `paths-ignore` entries, read without a YAML dependency — the repo has none,
 * and this file must run under a bare `node`. The block is a flat list of
 * scalars, so a line-scanner is exact rather than approximate: anything that
 * is not `- <scalar>` at that indent ends the block.
 */
export function codeqlIgnores(src) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    if (/^paths-ignore:\s*$/.test(raw)) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (/^\s*#/.test(raw) || /^\s*$/.test(raw)) continue;
    const item = /^\s+-\s+(.*?)\s*$/.exec(raw);
    if (!item) break;                                  // block ended
    out.push(item[1].replace(/^["'](.*)["']$/, '$1')); // unquote
  }
  return out;
}

/**
 * `.semgrepignore` patterns, normalised to bare top-level names so the two
 * lists are comparable. The file documents that its patterns are
 * root-anchored (`/docs/`, not `docs`) precisely so they cannot match a
 * nested `frontend/src/lib/docs`; that anchoring is checked here rather than
 * stripped and forgotten, because an unanchored entry silently widens the
 * exclusion to real source.
 */
export function semgrepIgnores(src) {
  const out = [];
  const unanchored = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('/')) { unanchored.push(line); continue; }
    out.push(line.replace(/^\//, '').replace(/\/$/, ''));
  }
  return { entries: out, unanchored };
}

/**
 * Directories whose subtree holds a dc-runtime bundle, as a repo-relative path.
 *
 * This used to return the top-level directory NAME, which was fine while the
 * canvases sat at `design/canvases/`. They now live at `design/canvases/`, and
 * `design/` also holds hand-written token and pattern censuses — ignoring the
 * whole of `design/` to cover the canvases would take those with it. So the
 * tree is reported at the depth it is actually found, and `isCovered()` below
 * accepts an ancestor: ignoring `design/canvases` covers
 * `design/canvases/shared`, which is where the bundle physically is.
 */
export function generatedTrees() {
  const found = new Set();
  // Descend, and report the directory the bundle is ACTUALLY in. Using the
  // recursive hasMarker() here would report the outermost ancestor instead —
  // `design` rather than `design/canvases/shared` — which is exactly the
  // over-broad answer the path-level reporting is meant to avoid.
  const scan = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (hasMarkerHere(abs)) found.add(path.relative(ROOT, abs));
      else if (depth < 2) scan(abs, depth + 1);
    }
  };
  scan(ROOT, 0);
  return [...found].sort();
}

/**
 * An ignore entry covers a tree if it IS that tree or an ancestor of it.
 * `design/canvases` covers `design/canvases/shared`; `design` would too, which
 * is allowed — over-ignoring is a judgement call, under-ignoring is the bug
 * this guard exists to catch.
 */
function isCovered(tree, listed) {
  for (const entry of listed) {
    if (tree === entry || tree.startsWith(`${entry}/`)) return true;
  }
  return false;
}

/**
 * Depth-limited: the dc-runtime bundle sits at the tree root or up to two
 * levels in — `spin-out-lab-pipeline/project/support.js`, and since the canvas
 * archive moved under `design/`, `design/canvases/shared/support.js`. Walking
 * 49M of canvases to the leaves on every CI run buys nothing, but stopping at
 * depth 1 would now silently find nothing at all.
 */
/** The marker in THIS directory's own .js files — no descent. */
function hasMarkerHere(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.js')) continue;
    try {
      const head = fs.readFileSync(path.join(dir, e.name), 'utf8').slice(0, 400);
      if (head.includes(GENERATED_MARKER)) return true;
    } catch { /* unreadable — not a marker */ }
  }
  return false;
}

function hasMarker(dir, depth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.js')) continue;
    let head;
    try {
      const fd = fs.openSync(path.join(dir, e.name), 'r');
      const buf = Buffer.alloc(200);
      const n = fs.readSync(fd, buf, 0, 200, 0);
      fs.closeSync(fd);
      head = buf.subarray(0, n).toString('utf8');
    } catch { continue; }
    if (head.includes(GENERATED_MARKER)) return true;
  }
  if (depth >= 2) return false;
  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && hasMarker(path.join(dir, e.name), depth + 1)) {
      return true;
    }
  }
  return false;
}

/** Every disagreement between the two lists and the trees on disk. */
export function gaps() {
  const cq = new Set(codeqlIgnores(fs.readFileSync(CODEQL, 'utf8')));
  const sg = semgrepIgnores(fs.readFileSync(SEMGREP, 'utf8'));
  const sgSet = new Set(sg.entries);
  const out = [];

  for (const t of generatedTrees()) {
    const where = [];
    if (!isCovered(t, cq)) where.push('.github/codeql/codeql-config.yml (paths-ignore)');
    if (!isCovered(t, sgSet)) where.push('.semgrepignore');
    if (where.length) out.push({ kind: 'generated-tree-not-ignored', tree: t, where });
  }

  // PARITY: a tree one scanner skips and the other reads is the half-fix that
  // looks done. Applies to every listed tree, generated or not.
  for (const t of cq) {
    if (!sgSet.has(t)) out.push({ kind: 'parity', tree: t, where: ['.semgrepignore'] });
  }
  for (const t of sgSet) {
    if (!cq.has(t)) {
      out.push({ kind: 'parity', tree: t, where: ['.github/codeql/codeql-config.yml (paths-ignore)'] });
    }
  }

  for (const p of sg.unanchored) {
    out.push({ kind: 'unanchored', tree: p, where: ['.semgrepignore'] });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = gaps();
  if (found.length) {
    console.error('check-scanner-ignore-parity: scanner ignore lists disagree.\n');
    for (const g of found) {
      if (g.kind === 'unanchored') {
        console.error(`  ${g.tree}  — not root-anchored in .semgrepignore`);
        console.error('      Write it as `/name/`. A bare name matches nested directories too,');
        console.error('      which would stop scanning real source such as frontend/src/lib/docs.\n');
        continue;
      }
      const why = g.kind === 'generated-tree-not-ignored'
        ? 'generated tree (dc-runtime bundle on disk), analysed by'
        : 'ignored by one scanner but read by';
      console.error(`  ${g.tree}  — ${why}:`);
      for (const w of g.where) console.error(`      ${w}`);
      console.error('');
    }
    console.error('Both scanners must agree. A generated tree read by either one floods');
    console.error('code scanning with alerts about code that is never built or served, and');
    console.error('buries the findings in real source. Add it to both files, with a comment');
    console.error('saying what generated it — or, if it does ship, take it out of both.');
    process.exit(1);
  }

  const trees = generatedTrees();
  const cq = codeqlIgnores(fs.readFileSync(CODEQL, 'utf8'));
  console.log(
    `✓ check-scanner-ignore-parity: ${cq.length} ignored trees match across CodeQL and `
    + `Semgrep; all ${trees.length} generated tree(s) on disk are in both `
    + `(${trees.join(', ')}).`,
  );
}
