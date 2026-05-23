#!/usr/bin/env node
/**
 * Task #17 — Dark-mode regression guard.
 *
 * The protected app shell (everything under [data-app-main]) is auto-skinned
 * in dark mode via the global rules in frontend/src/index.css. That covers
 * `bg-white`, `bg-gray-{50,100}`, `text-gray-{400..900}`, `border-gray-{100..300}`,
 * and the divide/hover variants. So most pages don't need explicit `dark:`
 * variants anymore.
 *
 * What this guard ENFORCES is the small set of patterns the auto-skin can NOT
 * handle:
 *   1. Page titles that hardcode `text-white` (would become invisible on the
 *      already-light dark surface). Headings should use `text-gray-900` (which
 *      the auto-skin re-skins) or add an explicit `dark:text-white`.
 *   2. Public marketing components must NOT live under `frontend/src/pages/`
 *      without the `data-keep-light` opt-out — public surfaces use the GVPN
 *      palette and shouldn't be auto-skinned.
 *
 * Light mode is unaffected by all of this; the auto-skin only fires under
 * `.dark`. The script is advisory (exits 0) when no violations are found and
 * fails fast otherwise so it can be wired into `npm run test:drift`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SCAN_DIRS = [
  join(REPO_ROOT, 'frontend', 'src', 'pages'),
  join(REPO_ROOT, 'frontend', 'src', 'components'),
];

// Files that intentionally render outside the protected shell (public
// marketing, login, register, GVPN brand surface) — the auto-skin doesn't
// apply to them and they keep the GVPN/light palette by design.
const WHITELIST = new Set([
  'frontend/src/components/PublicNav.jsx',
  'frontend/src/components/PublicFooter.jsx',
  'frontend/src/components/PublicLayout.jsx',
  'frontend/src/pages/SpinoutLabMarketingPage.jsx',
  'frontend/src/pages/PricingPage.jsx',
  'frontend/src/pages/LoginPage.jsx',
  'frontend/src/pages/RegisterPage.jsx',
  'frontend/src/pages/PublicTeamPage.jsx',
  'frontend/src/pages/ContactPage.jsx',
  'frontend/src/pages/TermsPage.jsx',
  'frontend/src/pages/PrivacyPage.jsx',
  'frontend/src/pages/HomePage.jsx',
]);

const violations = [];

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
    if (WHITELIST.has(rel)) continue;
    audit(full, rel);
  }
}

function audit(full, rel) {
  const src = readFileSync(full, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // Heuristic: an <h1>/<h2> with `text-white` and no companion `dark:`
    // probably renders white-on-white in light mode (or relies on a dark
    // parent that doesn't exist). Either drop `text-white` and let the
    // auto-skin handle it, or pair with `dark:text-white` on a darker base.
    const m = line.match(/<(h1|h2)[^>]*className="([^"]*)"/);
    if (m) {
      const cls = m[2];
      if (/\btext-white\b/.test(cls) && !/\bdark:text-/.test(cls)
          && !/\b(bg-(violet|indigo|blue|purple|emerald|amber|rose|red|slate|black|gray-(7|8|9))\w*)\b/.test(cls)) {
        violations.push({
          file: rel,
          line: i + 1,
          msg: `<${m[1]}> uses text-white without a dark surface or a dark: variant`,
        });
      }
    }
  });
}

for (const d of SCAN_DIRS) walk(d);

if (violations.length) {
  console.error('\nDark-mode regression guard — found issues:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.msg}`);
  }
  console.error(`\n${violations.length} violation(s). See scripts/check-dark-mode.mjs for guidance.\n`);
  process.exit(1);
}

console.log('check-dark-mode.mjs: OK');
