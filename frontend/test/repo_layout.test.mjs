/**
 * Repo layout: the root stays legible.
 *
 * The root of this repository had accumulated **38 markdown files** — four
 * generations of beta-readiness audit, five UX audits, three security
 * documents, and the four architecture files that actually matter, all in one
 * alphabetical wall. Finding CODEBASE_MAP.md meant scrolling past
 * BETA_READINESS_ISSUES_2026-05-20.md.
 *
 * They now live under `documentation/`, and this file is what stops the root
 * from refilling. It is not a style rule: the cost of the old state was that
 * the four documents a newcomer needs were indistinguishable from a year of
 * dated snapshots nobody maintains.
 *
 * Six files stay at the root, each because a tool or a platform convention
 * looks for it there and nowhere else. Adding a seventh fails this test — if
 * that seventh genuinely belongs at the root, add it to ROOT_MD with the
 * reason, which is the point: the exception has to be argued once, in writing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.cwd());

// Each entry names the tool or convention that requires the root location.
const ROOT_MD = new Map([
  ['CLAUDE.md', 'read by Claude Code from the repo root'],
  ['replit.md', 'read by Replit from the repo root'],
  ['README.md', 'GitHub renders it as the repo front page'],
  ['CONTRIBUTING.md', 'GitHub community-health file'],
  ['SECURITY.md', 'GitHub community-health file'],
  ['CHANGELOG.md', 'conventional root location'],
]);

test('only the six tool-required markdown files sit at the repo root', () => {
  const found = readdirSync(root).filter((f) => f.toLowerCase().endsWith('.md'));
  const unexpected = found.filter((f) => !ROOT_MD.has(f));
  assert.deepEqual(
    unexpected, [],
    `move these under documentation/, or add them to ROOT_MD with the tool that requires the root: ${unexpected.join(', ')}`,
  );
  // And the six must still be there — a "cleanup" that swept README.md into a
  // folder would break the repo's front page.
  for (const [f, why] of ROOT_MD) {
    assert.ok(existsSync(join(root, f)), `${f} must stay at the root — ${why}`);
  }
});

test('documentation/ is organised, not just a second heap', () => {
  const base = join(root, 'documentation');
  assert.ok(existsSync(base), 'documentation/ must exist');
  const entries = readdirSync(base, { withFileTypes: true });
  const loose = entries.filter((e) => e.isFile() && e.name !== 'README.md').map((e) => e.name);
  assert.deepEqual(loose, [],
    `documentation/ takes an index and folders, not loose files: ${loose.join(', ')}`);
  for (const dir of ['architecture', 'audits', 'operations', 'product']) {
    assert.ok(entries.some((e) => e.isDirectory() && e.name === dir), `documentation/${dir}/ must exist`);
  }
});

test('the index says what documentation/ is and what docs/ is', () => {
  // The two names are one character apart and one of them is build output.
  // Someone WILL hand-edit docs/ if nothing says not to.
  // Unwrap the blockquote and collapse whitespace first: the warning is a
  // wrapped `>` block, so a phrase can straddle a line AND a quote marker.
  // Three earlier versions of this assertion failed on correct prose for
  // exactly that reason.
  const s = readFileSync(join(root, 'documentation/README.md'), 'utf8')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ');
  assert.match(s, /`documentation\/` is not `docs\/`/);
  assert.match(s, /built frontend bundle/i);
  assert.match(s, /never be hand-edited/i);
});

// Two hand-maintained markdown files live inside the build directory. They are
// NOT generated, and they are not swept: `scripts/build-frontend.mjs` writes
// named outputs and prunes hashed assets on a retention window rather than
// emptying the tree, so both survive every build. They are reachable as raw
// markdown at the apex because GitHub Pages serves `docs/` directly.
//
// They are allowlisted rather than moved: a raw URL that has been live cannot
// be relocated on a tidying pass without knowing who links to it. This is
// recorded as an oddity to resolve deliberately, not as approval of the
// pattern.
//
// NB: a bare `vite build` (rather than `npm run build`) DOES empty the
// directory — emptyOutDir is on — which would delete both. That is one more
// reason the project builds through the script.
const DOCS_MD_ALLOWED = new Set(['CHANGELOG.md', 'CHANGELOG-user.md']);

test('no NEW hand-written markdown appears in the build output', () => {
  const d = join(root, 'docs');
  if (!existsSync(d)) return;
  const stray = readdirSync(d)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .filter((f) => !DOCS_MD_ALLOWED.has(f));
  assert.deepEqual(stray, [],
    `docs/ is build output — put documents under documentation/ instead: ${stray.join(', ')}`);
});

test('the two allowlisted changelogs are still actually there', () => {
  // If they vanish, something started emptying the build directory, and the
  // allowlist above has become a lie rather than a record.
  const d = join(root, 'docs');
  if (!existsSync(d)) return;
  for (const f of DOCS_MD_ALLOWED) {
    assert.ok(existsSync(join(d, f)),
      `${f} is gone from docs/ — the build now empties the tree, or it was moved without updating this allowlist`);
  }
});

test('every moved document is reachable from the index', () => {
  // A folder nobody links to is the heap again, one level down.
  const idx = readFileSync(join(root, 'documentation/README.md'), 'utf8');
  for (const dir of ['architecture', 'audits', 'operations', 'product']) {
    assert.ok(idx.includes(`${dir}/`), `the index must describe documentation/${dir}/`);
  }
  // The four load-bearing documents are linked by name, not just implied.
  for (const f of ['CODEBASE_MAP.md', 'ROUTE_MAP.md', 'DECISIONS.md', 'GOTCHAS.md']) {
    assert.ok(idx.includes(f), `the index must point at ${f}`);
    assert.ok(existsSync(join(root, 'documentation/architecture', f)), `${f} must be where the index says`);
  }
});
