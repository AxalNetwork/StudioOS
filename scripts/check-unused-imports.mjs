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
import { readFileSync, readdirSync } from 'node:fs';
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
    // Imports go first, then only the comments that cannot be mistaken for
    // code.
    //
    // Blanket regex comment-removal on JSX is unsound: an INLINE `/*` inside a
    // string or a className opens a comment that runs to the next `*/` far
    // below. The first version of this script did that, ate half of
    // SpinoutLabScoringPage.jsx, and reported `useState` — used nineteen times
    // in that file — as unused.
    //
    // But leaving ALL comments in was too loose in the other direction, and it
    // bit immediately: this file's own doc header mentioned `statSync`, which
    // made the unused `statSync` import here read as used. CodeQL found it
    // (alert 5943) on the very guard written to prevent that class of alert.
    //
    // So: strip only the two unambiguous shapes. A block comment that STARTS a
    // line at column 0 and a line that is nothing but a `//` comment are both
    // things a string literal cannot produce. Inline comment markers — where
    // the hazard actually lives — are left alone, so a name mentioned in a
    // trailing comment still reads as used and is missed. That residual gap is
    // the safe direction: a false negative costs a CodeQL alert, a false
    // positive blocks correct work and teaches everyone to ignore the guard.
    const body = src
      .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?$/gm, '')
      .replace(/^\/\*[\s\S]*?\*\//gm, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
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
