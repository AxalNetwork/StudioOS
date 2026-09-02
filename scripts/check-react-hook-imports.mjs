#!/usr/bin/env node
/**
 * check-react-hook-imports — a hook that is called must be imported.
 *
 * WHY THIS EXISTS, and it is not hypothetical. `PublicNav.jsx` gained a mobile
 * menu with `useState` and kept `import React from 'react'`. Every check in the
 * repository passed: an undefined variable is a RUNTIME error, not a build one,
 * so Vite emitted a clean bundle; no test renders that component; and
 * `check-unused-imports` looks for the exact opposite problem — a name imported
 * and never used. The result shipped to the apex and took the public site down
 * with "Can't find variable: useState" on first paint.
 *
 * `check-unused-imports` and this file are the two halves of one rule: the set
 * of names a module imports and the set it uses must agree. That one guarded
 * only the first direction was the gap.
 *
 * SCOPE IS DELIBERATELY NARROW. This checks React hooks and nothing else. A
 * general undefined-identifier check is a linter's job and would need real
 * scope analysis to avoid false positives; hooks are worth special-casing
 * because they are the names most often added to a component body long after
 * its import line was written, and because getting one wrong is always a crash
 * rather than a subtle bug.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const ROOTS = ['frontend/src'];

const HOOKS = [
  'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext',
  'useReducer', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue',
  'useDeferredValue', 'useTransition', 'useId', 'useSyncExternalStore',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(p)) out.push(p);
  }
  return out;
}

/** What this module pulls out of `react`, however the import is written. */
function reactImports(src) {
  const names = new Set();
  let namespace = false;
  // Both quote styles, and specifier lists that wrap across lines.
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]react['"]/g)) {
    const clause = m[1];
    if (/\*\s+as\s+\w+/.test(clause)) namespace = true;
    for (const block of clause.matchAll(/\{([\s\S]*?)\}/g)) {
      for (const raw of block[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.add(name);
      }
    }
  }
  return { names, namespace };
}

const problems = [];
let scanned = 0;

for (const rootDir of ROOTS) {
  for (const file of walk(resolve(ROOT, rootDir))) {
    const src = readFileSync(file, 'utf8');
    if (!/['"]react['"]/.test(src) && !HOOKS.some((h) => src.includes(h))) continue;
    scanned += 1;
    const { names, namespace } = reactImports(src);
    if (namespace) continue; // `React.useState` style — resolvable at runtime.
    for (const hook of HOOKS) {
      // A bare call: not `.useState(`, not part of a longer identifier, and
      // not the declaration of a custom hook of the same name.
      const called = new RegExp(`(?<![.\\w])${hook}\\s*\\(`).test(src);
      if (!called) continue;
      if (names.has(hook)) continue;
      if (src.includes(`React.${hook}`)) continue;
      // A local definition or a non-react import of the same name is fine.
      if (new RegExp(`(function|const|let)\\s+${hook}\\b`).test(src)) continue;
      if (new RegExp(`\\{[^}]*\\b${hook}\\b[^}]*\\}\\s*=\\s*require|import[^;]*\\b${hook}\\b[^;]*from\\s+['"](?!react['"])`).test(src)) continue;
      problems.push(`${relative(ROOT, file)} — \`${hook}\` is called but never imported`);
    }
  }
}

if (problems.length) {
  console.error('\n✖ check-react-hook-imports:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nThis is a crash, not a warning: the bundle builds fine and the page'
    + '\nthrows "Can\'t find variable: <hook>" on first render. Add the name to'
    + "\nthe module's `react` import.\n",
  );
  process.exit(1);
}

console.log(`✓ check-react-hook-imports: every React hook called across ${scanned} module(s) is imported.`);
