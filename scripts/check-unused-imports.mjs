#!/usr/bin/env node
/**
 * check-unused-imports — a named import nothing uses.
 *
 * Small, and it earns its place empirically: CodeQL raised this on this
 * repository three separate times in one working session (alerts 5939, 5941,
 * 5942) — two unused React/lucide imports and an unused `statSync`. Each was a
 * thirty-second fix that cost a full CI round trip to discover, because the
 * only thing checking was a scanner that runs after the push.
 *
 * It is deliberately narrow. Only `import { a, b } from '…'` is examined:
 * default and namespace imports are frequently side-effecting or re-exported,
 * and flagging them would produce noise rather than findings.
 *
 * Type-only names are unwrapped (`import { type Foo }`) and then checked like
 * any other, because an unused type import is still dead text — but the
 * `type ` prefix has to come off first, or every one of them reads as unused.
 * The first draft of this script got that wrong and reported eight
 * false positives in `captable.ts` alone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';

const ROOT = resolve(process.cwd());
const TREES = ['frontend/src', 'cloudflare-worker/src', 'scripts'];
const EXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const SKIP = new Set(['node_modules', 'dist', '__pycache__']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(extname(e.name))) out.push(p);
  }
  return out;
}

/** Every named binding an import statement introduces, with the `type ` prefix off. */
function namedImports(src) {
  const out = [];
  for (const m of src.matchAll(/^import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm)) {
    for (const raw of m.group?.(1) ?? m[1].split(',')) {
      const piece = typeof raw === 'string' ? raw : String(raw);
      const name = piece.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push({ name, index: m.index ?? 0 });
    }
  }
  return out;
}

const findings = [];
for (const tree of TREES) {
  for (const file of walk(join(ROOT, tree))) {
    const src = readFileSync(file, 'utf8');
    // ONLY the import statements are removed — deliberately no comment
    // stripping. Regex comment-removal on JSX is unsound: a `/*` inside a
    // string or a className opens a comment that runs to the next `*/` far
    // below, and the first version of this script ate HALF of
    // SpinoutLabScoringPage.jsx that way and reported `useState` — used
    // nineteen times — as unused.
    //
    // Leaving comments in means a name mentioned only in prose reads as used,
    // so this MISSES some. That is the correct direction for a guard that
    // fails the build: a false negative costs a CodeQL alert, a false positive
    // blocks a correct commit and teaches everyone to distrust the check.
    const body = src.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?$/gm, '');
    for (const { name } of namedImports(src)) {
      if (!new RegExp(`\\b${name}\\b`).test(body)) {
        findings.push(`${relative(ROOT, file)} — \`${name}\` is imported and never used`);
      }
    }
  }
}

if (findings.length) {
  console.error('✖ check-unused-imports:\n' + findings.map((f) => `  - ${f}`).join('\n'));
  console.error('\nRemove the name from its import. CodeQL reports these as alerts,\nso the choice is here or in a CI round trip.');
  process.exit(1);
}
console.log(`✓ check-unused-imports: every named import across ${TREES.join(', ')} is used.`);
