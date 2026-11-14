#!/usr/bin/env node
/**
 * #6326: the build checklist for a landed canvas, for the `build-screen-to-canvas` skill.
 *
 *   node scripts/build-screen-to-canvas.mjs --canvas "Build v2"
 *   node scripts/build-screen-to-canvas.mjs --file "design/incoming/Build v2 · Boards.dc.html"
 *   node scripts/build-screen-to-canvas.mjs --canvas "Build v2" --departures
 *   node scripts/build-screen-to-canvas.mjs --canvas "Build v2" --json
 *
 * Reads `design/incoming/<Name> · Boards.dc.html` as text (never runs it) and
 * prints one row per board: its frames, each frame's width, whether the board
 * has a 390 phone frame and whether it draws the dark theme. Then the files
 * that already name the canvas: its route-map fragment, its decision files,
 * and the frontend files that cite those decisions. `--departures` prints the
 * PR body's departures table instead. A boards file it cannot read gives exit
 * 1 and says so; it never prints an empty table. Local files only; no
 * network, no writes.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname, relative } from 'node:path';
import { readBoards, coverage, checklistTable, departuresTable, boardsFileFor, pageFileFor, rowNamesCanvas } from './lib/buildScreenToCanvas.mjs';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (name) => process.argv.includes(`--${name}`);
const INCOMING = 'design/incoming';
const ROUTE_MAP = 'documentation/architecture/route-map/canvases';
const DECISIONS = 'documentation/architecture/decisions';

/** Every file under `dir` whose name passes `keep`, as repo-relative paths. */
function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, keep, out); }
    else if (keep(e.name)) out.push(p);
  }
  return out;
}

const mentions = (files, needles) => files.filter((f) => {
  const text = readFileSync(f, 'utf8');
  return needles.some((n) => text.includes(n));
});

function main() {
  if (!existsSync(INCOMING)) throw new Error('run from the repository root');
  let boardsPath = arg('file');
  if (!boardsPath) {
    const name = arg('canvas');
    if (!name) throw new Error('need --canvas "<Name>" or --file <boards file>');
    const found = boardsFileFor(name, readdirSync(INCOMING));
    if (!found) throw new Error(`no "${name} · Boards.dc.html" in ${INCOMING}; check the name in design/incoming/README.md`);
    boardsPath = join(INCOMING, found);
  }
  if (!existsSync(boardsPath) || !statSync(boardsPath).isFile()) throw new Error(`no such file: ${boardsPath}`);

  const { boards, source } = readBoards(readFileSync(boardsPath, 'utf8'));
  const unread = boards.length ? null
    : `${boardsPath} is not in a shape this script reads. List its boards by hand (renderVals in the boards file).`;
  if (flag('departures')) {
    if (unread) throw new Error(`${unread} No departures table was written.`);
    if (source !== 'list') console.error(`build-screen-to-canvas: boards read from <dc-import> tags; check the list against ${boardsPath}.`);
    console.log(departuresTable(boards));
    return;
  }

  const boardsFile = basename(boardsPath);
  const pageFile = pageFileFor(boardsFile, readdirSync(dirname(boardsPath)));
  const canvasName = boardsFile.replace(/ · Boards\.dc\.html$/i, '');
  const named = [boardsFile, pageFile].filter(Boolean);
  const routeRows = walk(ROUTE_MAP, (n) => n.endsWith('.md') && n !== 'README.md')
    .filter((f) => rowNamesCanvas(readFileSync(f, 'utf8'), canvasName, named));
  const decisionFiles = mentions(walk(DECISIONS, (n) => /^D\d+(-p\d+)?\.md$/.test(n)), named);
  const ids = [...new Set(decisionFiles.map((f) => /^D(\d+)/.exec(basename(f))[1]))];
  const citing = ids.length
    ? walk('frontend/src', (n) => /\.(jsx?|tsx?|css)$/.test(n))
      .filter((f) => ids.some((id) => new RegExp(`\\bD${id}\\b`).test(readFileSync(f, 'utf8'))))
    : [];
  const cov = coverage(boards, source);

  if (flag('json')) {
    console.log(JSON.stringify({ boardsFile: boardsPath, pageFile, source, unread, boards, coverage: cov, routeRows, decisionFiles, citing }, null, 2));
    if (unread) { console.error(`build-screen-to-canvas: ${unread}`); process.exitCode = 1; }
    return;
  }
  console.log(`Boards file: ${boardsPath}`);
  console.log(`Page file:   ${pageFile ? join(dirname(boardsPath), pageFile) : 'not found beside it'}`);
  if (unread) {
    console.log(`\n${unread}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${checklistTable(boards)}\n`);
    console.log(`${cov.boards} board(s). Phone (390): ${cov.phone.join(', ') || 'none'}. Tablet: ${cov.tablet.join(', ') || 'none'}. Dark: ${cov.dark.join(', ') || 'none'}.`);
    if (cov.noFrames.length) console.log(`No frame read for: ${cov.noFrames.join(', ')}. Read those boards by hand.`);
    if (cov.unsure) console.log(`Phone and Dark are hints here (${cov.unsure}): confirm them against the boards file before you list a phone or dark departure.`);
    for (const m of cov.missing) console.log(`Canvas has ${m}.`);
  }
  const rel = (list) => list.map((f) => `  ${relative('.', f)}`).join('\n') || '  none';
  console.log(`\nRoute-map rows naming it:\n${rel(routeRows)}`);
  if (!routeRows.length) console.log(`  (matched by first cell only: grep -rli "${canvasName}" ${ROUTE_MAP} before adding a row)`);
  console.log(`Decision files naming it:\n${rel(decisionFiles)}`);
  console.log(`Frontend files citing ${ids.map((i) => `D${i}`).join(', ') || 'those decisions'}:\n${rel(citing)}`);
}

try { main(); } catch (e) { console.error(`build-screen-to-canvas: ${e.message}`); process.exit(1); }
