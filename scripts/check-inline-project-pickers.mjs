#!/usr/bin/env node
/**
 * NO PAGE CARRIES ITS OWN STARTUP PICKER. The sidebar decides scope; a body does
 * not get a second opinion.
 *
 * THE QUESTION THIS USED TO BE BLOCKED ON IS ANSWERED (#181). It was: a startup
 * is not a company. The sidebar switcher selects a COMPANY — sent as
 * `X-Company-Id`, verified against `user_company_links`, and the worker narrows a
 * founder's projects by `company_id` (migrations 189, 193-198) — while each of
 * these pickers selected a PROJECT behind `projects.length > 1`, i.e. *more than
 * one startup inside the already-selected company*. That made it a second axis
 * rather than a duplicate, and deleting it would have removed the only way such
 * a founder could move between their startups.
 *
 * The answer is **one company, one startup**, measured rather than assumed:
 * production D1 holds 5 projects across 5 founders, one project each. Every
 * picker sat behind `projects.length > 1`, so not one of them rendered for any
 * live account — the deletion removed no capability anybody had. `company_id`
 * handling stays exactly as it was: it is written on creation
 * (`routes/projects.ts`, `imports.ts`) and read with a deliberate
 * `OR p.company_id IS NULL` for the five legacy rows. The schema still permits
 * more than one project per company; the UI simply no longer offers to switch.
 *
 * WHY THE LEDGER IS NOW EMPTY RATHER THAN DELETED. Task #84 removed these once,
 * per route, and they came back, because there is no single component to delete
 * and nothing counted them. So the file stays and the list goes to zero: a new
 * picker fails this gate and has to argue for itself in a diff.
 *
 * TWO SWEEPS, BECAUSE ONE OF THEM WAS BLIND. This script used to look only for
 * `data-testid="select-<something>-project"`. That found 21 — and corrected the
 * task, which had named eleven. It was still wrong: FOUR MORE pickers carried no
 * testid at all (`FounderRaiseLiquidity`, `MarketIntelPage`, `RaisePipelinePage`,
 * `raise/DataRoomPage`), so a ledger that reported "21, all on record" was
 * reporting a number it had no way to complete. The real count was 25.
 *
 * The second sweep therefore keys on the thing every one of the 25 actually
 * shared — the render guard `projects.length > 1` — which is the property that
 * defines the control: a scope switcher that appears only when a second startup
 * exists. A picker cannot be written without something of that shape, and it
 * cannot be hidden from this sweep by leaving a test attribute off.
 *
 * A `<select>` over projects that is NOT behind that guard is a different thing
 * and is deliberately not swept: on `/cap-table`, `/discovery`, `/build/brand`
 * and twenty other legacy tool pages the picker is the tool's own input, shown
 * whether you have one startup or ten. Those say "which startup is this tool
 * about"; these said "which startup is this page about", over a page the sidebar
 * had already scoped.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const TREE = 'frontend/src';
const BASELINE = 'scripts/inline-project-pickers-baseline.json';

/** Sweep A — the shape they mostly used. Kept: a picker may still carry one. */
const PICKER_TESTID = /data-testid="(select-[a-z0-9-]*project)"/g;
/** Sweep B — the render guard all 25 shared, `&&` or ternary. */
const PICKER_GUARD = /\bprojects\s*\.\s*length\s*>\s*1\s*(?:&&|\?)/g;

/**
 * Prose removed, so an explanation of why a picker is gone cannot read as one.
 * Three comment shapes: a block comment starting a line, a whole-line `//`, and
 * a comment wrapped in braces — `{/* … *\/}` inside markup, and the
 * `catch { /* … *\/ }` shape — with whitespace permitted on either side. Kept
 * in step with `frontend/test/_codeOnly.mjs`, which now carries the same three.
 */
function codeOnly(src) {
  return String(src)
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, '{}')
    .replace(/^\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*\*[^\n]*$/gm, '');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const found = new Map(); // `path#key` → human-readable location
for (const file of walk(resolve(ROOT, TREE))) {
  const raw = readFileSync(file, 'utf8');
  const code = codeOnly(raw);
  const rel = relative(ROOT, file);
  for (const m of code.matchAll(PICKER_TESTID)) {
    found.set(`${rel}#${m[1]}`, `${rel} — data-testid="${m[1]}"`);
  }
  for (const m of code.matchAll(PICKER_GUARD)) {
    const line = code.slice(0, m.index).split('\n').length;
    found.set(`${rel}#projects-length-guard:${line}`, `${rel}:${line} — ${m[0].trim()}`);
  }
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(resolve(ROOT, BASELINE), 'utf8'));
} catch (e) {
  console.error(`✖ check-inline-project-pickers: cannot read ${BASELINE} — ${e.message}`);
  process.exit(1);
}
const known = new Set(baseline.pickers || []);

const added = [...found.keys()].filter((k) => !known.has(k)).sort();
const gone = [...known].filter((k) => !found.has(k)).sort();

if (added.length) {
  console.error('✖ check-inline-project-pickers: in-body startup picker:\n');
  for (const k of added) console.error(`  ${found.get(k)}`);
  console.error(`\nAll 25 of these were removed in #181, on a measured decision: one company,
one startup. Every one sat behind \`projects.length > 1\`, so none of them rendered
for any live account. The sidebar's CompanySwitcher is the single writer of scope
and \`WorkspaceShell\` shows the active company in the header.

If a company may now hold two startups and this page genuinely has to choose
between them, that is a product change and belongs in review with a decision
recorded — then add the entry to ${BASELINE}. Do not re-add a picker silently;
task #84 removed these once already and nothing counted them coming back.`);
  process.exit(1);
}

if (gone.length) {
  console.error('✖ check-inline-project-pickers: baseline entries that no longer exist:\n');
  for (const k of gone) console.error(`  ${k}`);
  console.error(`\nDelete them from ${BASELINE}. A ledger is only worth reading if every line
in it is still there — ${found.size} of ${known.size} remain.`);
  process.exit(1);
}

console.log(
  known.size === 0
    ? '✓ check-inline-project-pickers: no in-body startup picker anywhere in '
      + `${TREE} — neither a select-*-project testid nor a \`projects.length > 1\` `
      + 'render guard (task #181, all 25 removed).'
    : `✓ check-inline-project-pickers: ${found.size} in-body startup pickers, all on record.`,
);
