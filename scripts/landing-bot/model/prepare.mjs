#!/usr/bin/env node
// #6473: the runner's first job: validate and clamp the task from $TASK, or check a branch name, before anything else runs.
/**
 *   TASK='{...}' node prepare.mjs --out <dir>   writes <dir>/task.json (caps clamped) and the `rounds` output
 *   node prepare.mjs --ref <branch>             exits 1 unless the name is a plain branch name
 *
 * Errors name what is wrong with the task, never echo it: task text can carry
 * a log or a PR title.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTask, safeRef } from './task.mjs';

export function prepare(argv, env = process.env) {
  const [flag, value, ...rest] = argv;
  if (rest.length || !value) return { ok: false, errors: ['usage: prepare.mjs --out <dir> | --ref <branch>'] };
  if (flag === '--ref') return safeRef(value) ? { ok: true } : { ok: false, errors: ['the ref is not a plain branch name of this repository'] };
  if (flag !== '--out') return { ok: false, errors: [`unknown option ${String(flag).slice(0, 20)}`] };
  const { task, errors } = parseTask(String(env.TASK ?? ''));
  if (!task) return { ok: false, errors };
  mkdirSync(value, { recursive: true });
  writeFileSync(join(value, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
  return { ok: true, rounds: task.max_rounds, merge: task.merge_sha ? 'true' : 'false' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = prepare(process.argv.slice(2));
  if (!r.ok) {
    for (const e of r.errors) console.error(`::error::landing-bot model: ${e}`);
    process.exitCode = 1;
  } else if (r.rounds && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `rounds=${r.rounds}\nmerge=${r.merge}\n`);
}
