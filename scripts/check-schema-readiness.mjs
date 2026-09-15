#!/usr/bin/env node
/**
 * Fails the build when a lazy schema bootstrap remembers "already done" in
 * module state instead of per D1 binding.
 *
 *     let _ready = false;                          // <- what this bans
 *     export async function ensureXSchema(env) {
 *       if (_ready) return;
 *       …DDL…
 *       _ready = true;
 *     }
 *
 * WHY THIS IS A BUILD FAILURE AND NOT A STYLE NOTE. A module is instantiated
 * once per ISOLATE, not once per DATABASE. The flag above therefore says "some
 * database this isolate has served is bootstrapped" while every `if (_ready)
 * return` reads it as "THIS database is bootstrapped". The moment one isolate
 * serves two bindings — a test running two fixtures, a preview Worker beside
 * production, a scheduled handler against a second DB — the second binding is
 * told the work is done and the DDL never runs against it. What follows is not
 * an error: it is a SELECT against a table that does not exist, or worse, a
 * read that succeeds against an older shape. #203 was that bug with a column;
 * #204 found 115 more flags standing ready to be it again.
 *
 * The repo settled on a `WeakMap` keyed on `env.DB` — per binding, and the
 * entry is collected with the binding — so that is what this requires.
 *
 * THREE THINGS ARE CHECKED, and the third is the one that stops the fix from
 * being cosmetic:
 *
 *   1. No module-level `let <readiness-word> = false`.
 *   2. No module-level `let <bootstrap-word>: Promise<…> | null = null`. An
 *      in-flight latch shared between two bindings is worse than the boolean:
 *      it hands database B the PROMISE of work done against database A, so B is
 *      told a users-table rebuild it never saw has already happened.
 *   3. Every `new WeakMap<object, …>` in the worker must sit in a file that
 *      names the binding — `bindingKey(env)` or the `env.DB as unknown as
 *      object` cast it wraps. A cache keyed on a userId or a projectId is not
 *      this pattern, and keying readiness on anything but the binding is the
 *      same silent-wrong-answer with a different shape.
 *
 * WHAT IT DOES NOT CHECK, deliberately: whether the flag is set before or after
 * the work, and whether a failure latches. Those differ legitimately per
 * bootstrap — `ensureExploringSchema` latches only if the role-CHECK rebuild
 * succeeded, `ensureXSchema` latches inside its try — and a check that forced
 * one shape would push authors into the wrong one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'cloudflare-worker/src');

/** Words that mean "this schema work has been done". */
const READINESS = /(ready|ensured|migrated|bootstrapped|initialized)/i;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * A module-level declaration is one at column zero. Anything indented is inside
 * a function or a class and is per-call state, which is not this bug — an
 * `let secretAlreadyPersisted = false` inside a handler is a local, and failing
 * it would teach the next author that the check is noise.
 */
const BOOLEAN_LATCH = /^let\s+([A-Za-z_$][\w$]*)\s*(?::\s*boolean\s*)?=\s*false\s*;\s*$/;
const PROMISE_LATCH = /^let\s+([A-Za-z_$][\w$]*)\s*:\s*Promise<[^>]*>\s*\|\s*null\s*=\s*null\s*;\s*$/;
const WEAKMAP_DECL = /\bnew WeakMap<\s*object\s*,/;

const failures = [];
let weakMaps = 0;
let files = 0;

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  files += 1;
  let declaresWeakMap = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const b = BOOLEAN_LATCH.exec(line);
    if (b && READINESS.test(b[1])) {
      failures.push(
        `${rel}:${i + 1}  \`let ${b[1]} = false\` caches schema readiness per ISOLATE, not per database.\n`
        + '    Use `const READY = new WeakMap<object, boolean>()` and key it on `bindingKey(env)`.',
      );
    }
    const p = PROMISE_LATCH.exec(line);
    // Only the ones that latch a SCHEMA bootstrap. A module-level
    // `let cachedFetch: Promise<X> | null` for something else is a different
    // decision, and failing it here would make this check read as noise.
    if (p && /bootstrap|flight|pending|schema|migrat|ensur|ready/i.test(p[1])) {
      failures.push(
        `${rel}:${i + 1}  \`let ${p[1]}: Promise<…> | null\` shares one in-flight bootstrap across databases.\n`
        + '    Use `const IN_FLIGHT = new WeakMap<object, Promise<void>>()` keyed on `bindingKey(env)`.',
      );
    }
    if (WEAKMAP_DECL.test(line)) { declaresWeakMap = true; weakMaps += 1; }
  }

  if (declaresWeakMap) {
    const src = lines.join('\n');
    if (!src.includes('bindingKey(env)') && !src.includes('env.DB as unknown as object')) {
      failures.push(
        `${rel}  declares a \`WeakMap<object, …>\` but never keys it on the D1 binding.\n`
        + '    Readiness caches must use `bindingKey(env)` (util/schemaBootstrap.ts).',
      );
    }
  }
}

if (failures.length) {
  console.error(`\ncheck-schema-readiness: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  console.error('See documentation/architecture/GOTCHAS.md § "Schema readiness is per binding".\n');
  process.exit(1);
}

console.log(`check-schema-readiness: ${files} worker files, ${weakMaps} per-binding caches, no module-level latches.`);
