#!/usr/bin/env node
/**
 * Task #17 — Dark-mode regression guard.
 *
 * Fails when a JSX/TSX file under `frontend/src/{pages,components}`
 * contains a `className` string that uses one of the following light-mode
 * utilities without a matching `dark:` variant in the same string:
 *
 *   bg-white       → must pair with some dark:bg-…
 *   text-gray-700  → must pair with some dark:text-…
 *   text-gray-800  → must pair with some dark:text-…
 *   text-gray-900  → must pair with some dark:text-…
 *   border-gray-200→ must pair with some dark:border-…
 *   border-gray-300→ must pair with some dark:border-…
 *
 * Allowlisted files (public marketing, login/register, PDF/print
 * templates) intentionally render with a fixed light palette and are
 * exempt.
 *
 * Runs as part of `npm run test:drift`. To auto-fix offenders, run:
 *   node scripts/codemod-dark-mode.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, PAIRINGS } from './codemod-dark-mode.mjs';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SCAN_DIRS = [
  join(REPO_ROOT, 'frontend', 'src', 'pages'),
  join(REPO_ROOT, 'frontend', 'src', 'components'),
];

const CLASSNAME_RE = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`$]*)`\s*\})/g;

const violations = [];

/**
 * Line-level opt-out: `dark-mode-exempt` in a comment on the offending line or
 * within the four lines above it.
 *
 * Some surfaces are light ON PURPOSE and the "fix" would break them: the brand
 * landing-page artboards mock a public page rather than app chrome, the
 * certificate is a print artifact, and the share modal's `bg-white` is the
 * quiet zone behind a QR code — paint that dark and the code stops scanning.
 * A whole-file ALLOWLIST entry would also silence the genuine violations
 * elsewhere in those same files, so the exemption is per-site and has to be
 * written next to the reason.
 */
const EXEMPT_RE = /dark-mode-exempt/;
function isExempt(lines, line1) {
  for (let i = Math.max(0, line1 - 5); i < line1; i++) {
    if (EXEMPT_RE.test(lines[i] || '')) return true;
  }
  return false;
}

function audit(rel, src) {
  const lines = src.split('\n');
  // Compute byte→line offsets so we can report a line number for each match.
  const lineStart = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStart.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lineStart[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  let m;
  CLASSNAME_RE.lastIndex = 0;
  while ((m = CLASSNAME_RE.exec(src)) !== null) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    const tokens = value.split(/\s+/).filter(Boolean);
    const tokSet = new Set(tokens);
    for (const p of PAIRINGS) {
      if (!tokSet.has(p.light)) continue;
      const paired = [...tokSet].some(t => t === p.dark || t.startsWith(p.darkPrefix));
      if (!paired && isExempt(lines, lineOf(m.index))) continue;
      if (!paired) {
        violations.push({
          file: rel,
          line: lineOf(m.index),
          token: p.light,
          suggest: p.dark,
        });
      }
    }
  }
}

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (!/\.(jsx|tsx)$/.test(name)) continue;
    const rel = relative(REPO_ROOT, full).replaceAll('\\', '/');
    if (ALLOWLIST.has(rel)) continue;
    audit(rel, readFileSync(full, 'utf8'));
  }
}

for (const d of SCAN_DIRS) walk(d);

if (violations.length) {
  console.error('\nDark-mode regression guard — found unpaired light-mode utilities:\n');
  // De-dupe by file+line+token, cap output so the failure stays scannable.
  const seen = new Set();
  let shown = 0;
  for (const v of violations) {
    const key = `${v.file}:${v.line}:${v.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (shown < 60) {
      console.error(`  ${v.file}:${v.line}  ${v.token}  →  add ${v.suggest} (or any dark: variant of that property family)`);
      shown += 1;
    }
  }
  if (seen.size > shown) console.error(`  …and ${seen.size - shown} more`);
  console.error(`\n${seen.size} violation(s). Auto-fix with: node scripts/codemod-dark-mode.mjs\n`);
  process.exit(1);
}

console.log('check-dark-mode.mjs: OK');
