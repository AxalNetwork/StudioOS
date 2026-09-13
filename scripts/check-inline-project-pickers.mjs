#!/usr/bin/env node
/**
 * Freeze the in-body startup pickers, so a twenty-second one cannot appear.
 *
 * WHY A LEDGER AND NOT A BAN. Task #181 asks for these to go, and the request is
 * reasonable: a page should not carry its own scope control when the sidebar
 * already has one. But there is a design question in front of the deletion that
 * nobody has answered yet, and it is not rhetorical.
 *
 * A STARTUP IS NOT A COMPANY. The sidebar switcher selects a COMPANY — sent as
 * `X-Company-Id`, verified against `user_company_links`, and the worker narrows a
 * founder's projects by `company_id` (migrations 189, 193-198). Every picker here
 * selects a PROJECT, and each is guarded by `projects.length > 1`, which is why
 * they seem to come and go. So `projects.length > 1` means *more than one startup
 * inside the already-selected company*: the in-body picker is a SECOND AXIS, not
 * a duplicate of the sidebar. Deleting it outright removes the only way a founder
 * with two startups in one company can move between them, and every one of these
 * pages is project-scoped (`?project_id=`).
 *
 * That is a product decision — one company = one startup, or both axes in the
 * sidebar, or one shared picker in a fixed place — and it is not this script's to
 * make. What IS this script's job is the thing the task asks for in its own
 * words: *"Whatever is done must end with a guard test or this will be reported a
 * third time."* Task #84 already removed these once, per-route, and they came
 * back, because there is no single component to delete and nothing counted them.
 *
 * So: the set is pinned. A new picker fails this gate and has to argue for itself
 * in a diff. A removed one fails it too, which is what makes the eventual
 * deletion self-documenting — whoever answers the design question deletes both the
 * picker and its line here, and the count in the failure message tells the next
 * reader how far the sweep got.
 *
 * THE TASK'S OWN LIST WAS INCOMPLETE, which is the argument for counting rather
 * than listing by hand. It named eleven files; the `data-testid` sweep it
 * suggested finds TWENTY-ONE. Ten pickers were invisible to a hand-maintained
 * list within days of that list being written.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const TREE = 'frontend/src';
const BASELINE = 'scripts/inline-project-pickers-baseline.json';

/** `data-testid="select-<something>-project"` is the shape every one of them uses. */
const PICKER = /data-testid="(select-[a-z0-9-]*project)"/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx$/.test(p)) out.push(p);
  }
  return out;
}

const found = new Map(); // `path#testid` → testid
for (const file of walk(resolve(ROOT, TREE))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(PICKER)) {
    found.set(`${relative(ROOT, file)}#${m[1]}`, m[1]);
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
  console.error('✖ check-inline-project-pickers: NEW in-body startup picker:\n');
  for (const k of added) console.error(`  ${k}`);
  console.error(`\nThere are already ${known.size} of these and task #181 asks for them to go.
A page should not carry its own scope control: the sidebar's CompanySwitcher is
the single writer of scope, and \`WorkspaceShell\` shows the active company in the
header. If this page genuinely needs to choose between two startups inside one
company, say so in review and add it to ${BASELINE} — the count is the point.`);
  process.exit(1);
}

if (gone.length) {
  console.error('✖ check-inline-project-pickers: baseline entries that no longer exist:\n');
  for (const k of gone) console.error(`  ${k}`);
  console.error(`\nDelete them from ${BASELINE}. A ledger of things still to remove is only
worth reading if every line in it is still there — ${found.size} of ${known.size} remain.`);
  process.exit(1);
}

console.log(
  `✓ check-inline-project-pickers: ${found.size} in-body startup pickers, all on record `
  + `(task #181 — blocked on whether a company may hold more than one startup).`,
);
