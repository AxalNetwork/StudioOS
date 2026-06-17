#!/usr/bin/env node
/**
 * Task #17 — One-shot codemod that pairs unpaired light-mode utilities
 * with their dark-mode counterparts inside every className string in
 * `frontend/src/{pages,components}`. Safe to re-run (idempotent).
 *
 *   bg-white       → adds dark:bg-gray-900
 *   text-gray-900  → adds dark:text-gray-100
 *   text-gray-800  → adds dark:text-gray-200
 *   text-gray-700  → adds dark:text-gray-300
 *   border-gray-200→ adds dark:border-gray-800
 *   border-gray-300→ adds dark:border-gray-700
 *
 * Allowlisted files (public marketing, login/register, PDF/print
 * templates that intentionally use a light palette) are skipped.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SCAN_DIRS = [
  join(REPO_ROOT, 'frontend', 'src', 'pages'),
  join(REPO_ROOT, 'frontend', 'src', 'components'),
];

export const ALLOWLIST = new Set([
  'frontend/src/components/PublicNav.jsx',
  'frontend/src/components/PublicFooter.jsx',
  'frontend/src/pages/SpinoutLabMarketingPage.jsx',
  'frontend/src/pages/PricingPage.jsx',
  'frontend/src/pages/LoginPage.jsx',
  'frontend/src/pages/RegisterPage.jsx',
  'frontend/src/pages/PublicTeamPage.jsx',
  'frontend/src/pages/ContactPage.jsx',
  'frontend/src/pages/TermsPage.jsx',
  'frontend/src/pages/PrivacyPage.jsx',
  'frontend/src/pages/HomePage.jsx',
  // PDF/print surfaces — intentionally light, render off-screen for export.
  'frontend/src/pages/PitchDeckPrintPage.jsx',
  'frontend/src/pages/PitchDeckPage.jsx',
  // Public marketing home templates — each calls useForcedLightTheme() so it
  // renders a fixed light palette regardless of the app theme. Exempt like the
  // other public surfaces above.
  'frontend/src/pages/templates/CustomerDiscoveryHomePage.jsx',
  'frontend/src/pages/templates/FounderHomePage.jsx',
  'frontend/src/pages/templates/InvestorDealflowHomePage.jsx',
  'frontend/src/pages/templates/PartnerPartnershipHomePage.jsx',
  'frontend/src/pages/templates/SpinoutDemoDayPage.jsx',
]);

// Pairings — light utility → dark counterpart token.
export const PAIRINGS = [
  { light: 'bg-white',        dark: 'dark:bg-gray-900',     darkPrefix: 'dark:bg-' },
  { light: 'text-gray-900',   dark: 'dark:text-gray-100',   darkPrefix: 'dark:text-' },
  { light: 'text-gray-800',   dark: 'dark:text-gray-200',   darkPrefix: 'dark:text-' },
  { light: 'text-gray-700',   dark: 'dark:text-gray-300',   darkPrefix: 'dark:text-' },
  { light: 'border-gray-200', dark: 'dark:border-gray-800', darkPrefix: 'dark:border-' },
  { light: 'border-gray-300', dark: 'dark:border-gray-700', darkPrefix: 'dark:border-' },
];

// Tokens are word-like; we split on whitespace inside a className string.
// `pair` returns the patched class string, or null if no change needed.
export function pairClassNames(classStr) {
  const tokens = classStr.split(/(\s+)/); // keep whitespace
  const present = new Set(tokens.filter(t => t.trim()));
  const toAppend = [];
  for (const tok of tokens) {
    const trimmed = tok.trim();
    if (!trimmed) continue;
    for (const p of PAIRINGS) {
      // Match bare token AND responsive-prefixed variants (md:bg-white etc).
      // Only the bare form gets a dark pair — variant-prefixed tokens are
      // left alone because pairing them correctly requires the same prefix
      // (md:dark:bg-gray-900) which is a separate, lower-volume concern.
      if (trimmed === p.light) {
        // Skip if any dark: variant of this property family is already present.
        const already = [...present].some(t =>
          t === p.dark || t.startsWith(p.darkPrefix)
        );
        if (!already && !toAppend.includes(p.dark)) toAppend.push(p.dark);
      }
    }
  }
  if (!toAppend.length) return null;
  // Append at the END so source-order is preserved + diff is minimal.
  const trailing = classStr.endsWith(' ') ? '' : ' ';
  return classStr + trailing + toAppend.join(' ');
}

// Match every className value in JSX. Handles:
//   className="..."                 (double-quote literal)
//   className='...'                 (single-quote literal)
//   className={"..."}               (JSX expression with string)
//   className={`...`}               (template literal — only the constant
//                                    leading run, before any ${} is hit)
const CLASSNAME_RE = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`$]*)`\s*\})/g;

export function transform(src) {
  let mutated = false;
  const out = src.replace(CLASSNAME_RE, (whole, dq, sq, eqDq, eqSq, tl) => {
    const value = dq ?? sq ?? eqDq ?? eqSq ?? tl ?? '';
    const patched = pairClassNames(value);
    if (patched == null) return whole;
    mutated = true;
    if (dq != null)   return `className="${patched}"`;
    if (sq != null)   return `className='${patched}'`;
    if (eqDq != null) return `className={"${patched}"}`;
    if (eqSq != null) return `className={'${patched}'}`;
    return `className={\`${patched}\`}`;
  });
  return mutated ? out : null;
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full, out); continue; }
    if (/\.(jsx|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function main() {
  let touched = 0;
  for (const dir of SCAN_DIRS) {
    for (const full of walk(dir)) {
      const rel = relative(REPO_ROOT, full).replaceAll('\\', '/');
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(full, 'utf8');
      const out = transform(src);
      if (out && out !== src) {
        writeFileSync(full, out);
        touched += 1;
        console.log(`patched: ${rel}`);
      }
    }
  }
  console.log(`\nTouched ${touched} file(s).`);
}

// Only execute when invoked directly — keep importable for tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
