#!/usr/bin/env node
/**
 * check-folder-docs — every folder that matters explains itself, and the
 * explanation is checked against reality.
 *
 * The point is orientation. Someone (or something) dropped into this repo
 * should be able to open the folder they landed in and learn what it holds and
 * what the rule is for adding to it, without reading 150 files or asking.
 *
 * A README nobody verifies rots into a confident lie, which is worse than no
 * README at all — the first run of this guard caught exactly that:
 * `cloudflare-worker/src/routes/README.md` documented a mount for
 * `market-intel.ts`, a file that exists nowhere in the repository (the real
 * ones are `market_intel.ts` and `market_intel_public.ts`). A reader following
 * the map would have gone looking for a file that has never existed.
 *
 * So three rules, in increasing order of how much they earn their keep:
 *
 *   1. COVERAGE   — a folder holding real weight must carry a README.
 *   2. NAVIGATION — that README must name every immediate subfolder, because
 *                   the subfolder is how you get to the next thing.
 *   3. TRUTH      — anything the README names must exist. A `foo.ts` in
 *                   backticks that resolves to nothing in the repo fails the
 *                   build.
 *
 * Rule 3 deliberately checks the WHOLE repo, not just the folder: a README may
 * legitimately point at `index.ts` one level up, or at a sibling module. What
 * it may not do is name something that is not there at all.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const ROOT = resolve(process.cwd());

// Folders that must explain themselves, and the one-line reason each is worth
// a newcomer's attention. Adding a folder here is the cheap part; the README
// it then demands is the point.
const DOCUMENTED = new Map([
  ['frontend/src',                    'the SPA root — what each subtree is for'],
  ['frontend/src/pages',              'one file per route; the biggest folder in the repo'],
  ['frontend/src/components',         'shared presentational pieces'],
  ['frontend/src/ui',                 'the design-system primitives everything else composes'],
  ['frontend/src/lib',                'API client, formatting, and browser-side helpers'],
  ['frontend/src/hooks',              'shared React state'],
  ['frontend/src/data',               'static reference data — NOT a place for fixtures'],
  ['frontend/test',                   'what the frontend guarantees'],
  ['cloudflare-worker/src',           'the production worker'],
  ['cloudflare-worker/src/routes',    'the production API surface'],
  ['cloudflare-worker/src/services',  'logic the routes call; no HTTP in here'],
  ['cloudflare-worker/sql',           'the canonical D1 schema and its migrations'],
  ['cloudflare-worker/test',          'what the worker guarantees'],
  ['scripts',                         'build, deploy and the CI guards'],
  ['documentation',                   'every hand-written document'],
  ['design',                          'design sources, tokens, and the intake queue'],
  ['design/incoming',                 'Claude Design exports waiting to be integrated'],
  ['design/canvases',                 'the 107 canvases, sorted by whether a route exists'],
  ['documentation/architecture',      'the maintained architecture set'],
  ['documentation/audits',            'dated snapshots — true on their date only'],
  // Nested folders heavy enough to be opaque from their parent alone.
  ['frontend/src/components/brand/templates', 'the landing-page template previews'],
  ['frontend/src/components/cofounder',       'the co-founder agreement builder'],
  ['frontend/src/components/scoring',         'the scoring engine UI'],
  ['frontend/src/decks/templates',            'the pitch-deck slide templates'],
  ['frontend/src/pages/admin',                'the admin console'],
  ['frontend/src/pages/admin/assessment',     'the assessment game editor'],
  ['frontend/src/templates/components',       'landing-page section blocks'],
  ['cloudflare-worker/src/middleware',        'the gates every request passes'],
  ['cloudflare-worker/src/util',              'small shared helpers'],
  ['cloudflare-worker/src/integrations/providers', 'third-party provider clients'],
  ['cloudflare-worker/src/services/advisor',  'the advisor state machine'],
  ['cloudflare-worker/src/services/advisor/banks', 'its question banks'],
  ['cloudflare-worker/src/services/decks',    'deck assembly and export'],
  ['cloudflare-worker/src/services/market_intel', 'market-intelligence ingestion'],
  ['cloudflare-worker/src/services/market_intel/extractors', 'what is pulled out of a source'],
  ['cloudflare-worker/src/services/market_intel/sources',    'where signals come from'],
  ['cloudflare-worker/src/templates/legal',   'the legal document templates'],
]);

// Trees inside which a heavy folder is expected to document itself.
const COVERED_ROOTS = ['frontend/src', 'frontend/test', 'cloudflare-worker/src',
  'cloudflare-worker/sql', 'cloudflare-worker/test', 'scripts', 'documentation',
  'design'];
// Below this a folder is small enough to read at a glance.
const HEAVY_FILES = 8;

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'sections', 'migrations']);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|py|json|md|css)$/;

const errors = [];
const notes = [];

/** Every filename anywhere in the repo, for the TRUTH rule. */
function allFilenames() {
  const names = new Set();
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // docs/ is build output: thousands of hashed assets, nothing a README
        // should ever be pointing at.
        if (relative(ROOT, p) === 'docs') continue;
        walk(p);
      } else {
        names.add(e.name);
      }
    }
  };
  walk(ROOT);
  // Migrations are skipped above for speed but are legitimately citable.
  const mig = join(ROOT, 'cloudflare-worker/sql/migrations');
  if (existsSync(mig)) for (const f of readdirSync(mig)) names.add(f);
  return names;
}

const REPO_FILES = allFilenames();

function immediateSubdirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => e.name);
}

function fileCount(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SOURCE_EXT.test(e.name) && e.name !== 'README.md').length;
}

// ── 1. COVERAGE ────────────────────────────────────────────────────────────
for (const [dir, why] of DOCUMENTED) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) { errors.push(`${dir}/ is listed as documented but does not exist`); continue; }
  if (!existsSync(join(abs, 'README.md'))) {
    errors.push(`${dir}/README.md is missing — ${why}`);
  }
}

// A heavy folder nobody listed is the failure this rule exists to catch: the
// next 150-file directory should not be able to appear undocumented.
for (const root of COVERED_ROOTS) {
  const absRoot = join(ROOT, root);
  if (!existsSync(absRoot)) continue;
  const walk = (dir) => {
    const rel = relative(ROOT, dir);
    if (fileCount(dir) >= HEAVY_FILES && !DOCUMENTED.has(rel)) {
      errors.push(
        `${rel}/ holds ${fileCount(dir)} source files and is not in DOCUMENTED — `
        + 'add it there and write its README, or explain why it is exempt',
      );
    }
    for (const sub of immediateSubdirs(dir)) walk(join(dir, sub));
  };
  walk(absRoot);
}

// ── 2. NAVIGATION + 3. TRUTH ───────────────────────────────────────────────
for (const [dir] of DOCUMENTED) {
  const abs = join(ROOT, dir);
  const readmePath = join(abs, 'README.md');
  if (!existsSync(readmePath)) continue;
  const src = readFileSync(readmePath, 'utf8');

  if (!/^#\s+\S/m.test(src)) errors.push(`${dir}/README.md has no heading`);

  // NAVIGATION — every immediate subfolder is reachable from the text.
  for (const sub of immediateSubdirs(abs)) {
    if (!src.includes(`${sub}/`) && !src.includes(`\`${sub}\``)) {
      errors.push(`${dir}/README.md never mentions its subfolder \`${sub}/\``);
    }
  }

  // TRUTH — nothing named in backticks may be missing from the repo. Only
  // bare filenames are checked; a path is a different kind of claim and is
  // resolved directly.
  // Grab the whole backticked token, then decide in JS whether it names a file.
  // Matching the extension inside the pattern needs a repeated class that
  // itself contains `.` followed by a required `\.`, which is ambiguous and
  // backtracks polynomially — the shape CodeQL flags as a ReDoS. Splitting it
  // in two removes the ambiguity entirely and reads better besides.
  const CITED_EXT = /\.(?:ts|tsx|js|jsx|mjs|sql|py|md|css|json)$/;
  const cited = new Set();
  for (const m of src.matchAll(/`([^`\s]+)`/g)) {
    if (CITED_EXT.test(m[1])) cited.add(m[1]);
  }
  for (const name of cited) {
    // A naming pattern is not a claim. `NNN_short_name.sql` and
    // `<Surface>.dc.html` describe how to name a new file; they are not
    // assertions that one exists.
    if (/NNN|<|\*/.test(name)) continue;
    if (name.includes('/')) {
      // A path is checked against the repo root first, then relative to this
      // folder — READMEs here use both forms and both are legitimate.
      if (existsSync(join(ROOT, name)) || existsSync(join(abs, name))) continue;
      errors.push(`${dir}/README.md points at \`${name}\`, which does not exist`);
    } else if (!REPO_FILES.has(name)) {
      errors.push(`${dir}/README.md names \`${name}\`, which exists nowhere in the repo`);
    }
  }

  const words = src.split(/\s+/).length;
  if (words < 40) notes.push(`${dir}/README.md is very short (${words} words)`);
}

if (errors.length) {
  console.error('✖ check-folder-docs:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
for (const n of notes) console.log(`  note: ${n}`);
console.log(`✓ check-folder-docs: ${DOCUMENTED.size} folders documented; every name they cite resolves.`);
