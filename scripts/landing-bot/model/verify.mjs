#!/usr/bin/env node
// #6473: the `verify` job's entry point: re-check the patch with main's code, apply it, run the verify commands.
/**
 *   node verify.mjs --task task.json --work <checkout> --patch <dir> --out <dir>
 *
 * Runs with no environment, no secret and no write token. Repository code
 * (the PR's tests) runs here, so each command also gets a scrubbed
 * environment: PATH, HOME and a few runner basics, never a token or a key.
 * Writes `<out>/verify.json`: { passed, problems?, failure_text? }.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTask, HARD, stageProblems } from './task.mjs';
import { checkPatch } from './patch.mjs';
import { args } from './edit.mjs';

const FAILURE_MAX = 20_000;
const PASS_ENV = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'RUNNER_TEMP', 'TZ'];

/** The environment a verify command sees: an allowlist, so nothing secret-shaped can pass through. */
export function scrubbedEnv(env = process.env) {
  const out = { CI: 'true', NODE_ENV: 'test', npm_config_audit: 'false', npm_config_fund: 'false' };
  for (const k of PASS_ENV) if (typeof env[k] === 'string') out[k] = env[k];
  return out;
}

/** Output text with anything credential-shaped removed, kept to its tail. */
export function redact(text) {
  return String(text)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/AIza[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .slice(-FAILURE_MAX);
}

export function verifyMain({ task: taskPath, work, patch: patchDir, out, stage }, { env = process.env, spawn = spawnSync, now = Date.now } = {}) {
  mkdirSync(out, { recursive: true });
  const finish = (v) => { writeFileSync(join(out, 'verify.json'), `${JSON.stringify(v, null, 2)}\n`); return v; };
  const { task, errors } = parseTask(readFileSync(taskPath, 'utf8'));
  if (!task) return finish({ passed: false, problems: errors });
  const patch = JSON.parse(readFileSync(join(patchDir, 'patch.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(patchDir, 'manifest.json'), 'utf8'));
  // #6475: merge mode. Verify the same conflicted tree the edit was made on, with the patch applied over it.
  const resolving = !!task.merge_sha;
  if (resolving) {
    let report = null;
    try { report = stage ? JSON.parse(readFileSync(stage, 'utf8')) : null; } catch { /* null: refused below */ }
    const staged = stageProblems(task, report);
    if (staged.length) return finish({ passed: false, problems: staged });
  }
  const linked = [];
  // One open per file, not a check then a read: a link is refused by the open itself (O_NOFOLLOW), so it cannot be
  // swapped in between.
  const readBefore = (p) => {
    let fd;
    try { fd = openSync(join(work, p), constants.O_RDONLY | constants.O_NOFOLLOW); } catch (e) {
      if (e.code === 'ENOENT') return null;
      if (e.code === 'ELOOP') { linked.push(p); return null; }
      throw e;
    }
    try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
  };
  const problems = checkPatch(patch, manifest, task.allowed_files, readBefore, { resolving });
  for (const p of linked) problems.push(`${p} is a symbolic link`);
  if (problems.length) return finish({ passed: false, problems });
  for (const f of patch.files) {
    mkdirSync(join(work, f.path, '..'), { recursive: true });
    writeFileSync(join(work, f.path), f.content);
  }

  const deadline = now() + HARD.verifyMinutes * 60_000;
  const log = [];
  for (const argv of task.verify) {
    const left = deadline - now();
    if (left <= 0) return finish({ passed: false, failure_text: redact(`${log.join('\n')}\nverify stopped: the ${HARD.verifyMinutes}-minute cap was reached`) });
    const r = spawn(argv[0], argv.slice(1), { cwd: work, env: scrubbedEnv(env), encoding: 'utf8', timeout: left, maxBuffer: 64 * 1024 * 1024, shell: false });
    log.push(`$ ${argv.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `could not run: ${r.error.code || r.error.message}\n` : ''}`);
    if (r.status !== 0) return finish({ passed: false, failed_command: argv.join(' '), failure_text: redact(log.join('\n')) });
  }
  return finish({ passed: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const v = verifyMain(args(process.argv.slice(2)));
    console.log(`landing-bot model: verify ${v.passed ? 'passed' : 'failed'}${v.problems ? ` (${v.problems.length} problems)` : ''}`);
  } catch (e) {
    console.error(`landing-bot model: verify could not run (${String(e?.message || e).slice(0, 200)})`);
    process.exitCode = 1;
  }
}
