#!/usr/bin/env node
// D6935-p2: parse one JavaScript or TypeScript file (JSX allowed) without running it. The model fallback's verify step.
/**
 *   node scripts/scan-remediation/syntax.mjs <file>   exit 0 when the file parses, 1 with the line when it does not
 *
 * TypeScript is stripped with Node's own `stripTypeScriptTypes` (which keeps offsets), then acorn parses the result
 * as a module, the way scripts/check-test-clock.mjs reads test files. Nothing in the file is executed.
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

import { CHECKABLE } from './model.mjs';

const parser = Parser.extend(jsx());

/** Problems parsing `source` as the file `path`: [] when it parses. */
export function syntaxProblems(source, path) {
  if (!CHECKABLE.test(path)) return [`${path}: not a JavaScript or TypeScript file`];
  let code = source;
  try {
    if (/\.(?:[cm]?ts)$/.test(path)) code = stripTypeScriptTypes(source, { mode: 'strip' });
    // .tsx: strip mode does not accept JSX, so it is parsed as JSX after a best-effort strip.
    else if (path.endsWith('.tsx')) code = stripTypeScriptTypes(source, { mode: 'strip' });
  } catch (error) {
    return [`${path}: ${String(error?.message ?? error).split('\n')[0]}`];
  }
  try {
    parser.parse(code, { ecmaVersion: 'latest', sourceType: path.endsWith('.cjs') ? 'script' : 'module', locations: true, allowHashBang: true });
    return [];
  } catch (error) {
    return [`${path}:${error.loc?.line ?? '?'}: ${String(error.message).replace(/\s*\(\d+:\d+\)$/, '')}`];
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? '';
  const problems = syntaxProblems(readFileSync(file, 'utf8'), file);
  for (const p of problems) console.error(p);
  process.exitCode = problems.length ? 1 : 0;
}
