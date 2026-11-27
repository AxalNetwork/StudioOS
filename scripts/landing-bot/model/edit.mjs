#!/usr/bin/env node
// #6473: the `edit` job's entry point: one round of the model on the checkout, writing a patch and manifest or nothing.
/**
 *   node edit.mjs --task task.json --work <checkout> --out <dir> --round <n> --base <sha> --controller <sha>
 *                 [--feedback verify.json]
 *                 [--stage stage.json]   (merge mode, #6475: the report stage.mjs wrote)
 *
 * Runs in the `repair` environment with the model credentials and no GitHub
 * write token. It runs no repository code: the checkout is read as data and
 * this folder's own code comes from the controller commit (#8506). It writes `<out>/result.json`
 * always, and `<out>/patch.json` with `<out>/manifest.json` only when the
 * edits pass every check, with `<out>/record.json` (#8506, `record.mjs`): the
 * run, attempt, task, target head and controller revision the patch was made
 * by, which `verify` and the caller's publish step check against their own
 * inputs. It never prints a credential.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTask, stageProblems } from './task.mjs';
import { createWorkspace } from './workspace.mjs';
import { providerOrder, runRound } from './loop.mjs';
import { checkChanges, manifestFor, patchFor } from './patch.mjs';
import { makeProviders, NAMES } from './providers.mjs';
import { identityFrom, identityProblems, recordFor } from './record.mjs';

const SHA = /^[0-9a-f]{40}$/;

export function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!/^--[a-z]+$/.test(k) || argv[i + 1] === undefined) throw new Error(`bad argument ${String(k).slice(0, 40)}`);
    out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

/** The whole round; returns the result object it wrote. Exposed for tests with stub providers. */
export async function editMain({ task: taskPath, work, out, round, base, controller, feedback, stage }, { env = process.env, providers, identity = identityFrom(env) } = {}) {
  mkdirSync(out, { recursive: true });
  const write = (name, v) => writeFileSync(join(out, name), `${JSON.stringify(v, null, 2)}\n`);
  const finish = (result) => { write('result.json', result); return result; };
  const n = Number(round);
  if (!SHA.test(String(base)) || !Number.isSafeInteger(n) || n < 1) return finish({ outcome: 'no_patch', reason: 'bad base or round' });
  // #8506: no model call unless the patch's record can be written.
  const unknown = identityProblems({ identity, controller, head: base });
  if (unknown.length) return finish({ outcome: 'no_patch', reason: 'the run cannot be recorded', problems: unknown });

  const { task, errors } = parseTask(readFileSync(taskPath, 'utf8'));
  if (!task) return finish({ outcome: 'no_patch', reason: 'the task is invalid', errors });
  if (n > task.max_rounds) return finish({ outcome: 'no_patch', reason: `round ${n} is past the cap of ${task.max_rounds}` });

  // #6475: merge mode. The tree the model reads is main merged into the head, conflicts left in.
  const resolving = !!task.merge_sha;
  if (resolving) {
    // The merge was staged by stage.mjs in the step before, in its own process; this module starts none.
    let report = null;
    try { report = stage ? JSON.parse(readFileSync(stage, 'utf8')) : null; } catch { /* null: refused below */ }
    const problems = stageProblems(task, report);
    if (problems.length) return finish({ outcome: 'no_patch', reason: problems[0], problems, round: n });
  }

  let failure = null;
  if (feedback) {
    const v = JSON.parse(readFileSync(feedback, 'utf8'));
    failure = typeof v?.failure_text === 'string' ? v.failure_text : 'verification failed (no output)';
  }
  const data = { ...task.data, ...(failure ? { 'verify-failure.txt': failure } : {}) };
  const workspace = createWorkspace(work, { allowed: task.allowed_files, data });
  const result = await runRound({
    task, workspace, feedback: failure,
    providers: providers ?? makeProviders(env),
    order: providerOrder(env[NAMES.order]),
  });
  if (result.outcome !== 'patched') return finish({ ...result, round: n });

  const changes = workspace.changes();
  const problems = checkChanges(changes, task.allowed_files, { resolving });
  if (problems.length) return finish({ ...result, round: n, outcome: 'no_patch', reason: 'the edits failed a check', problems });
  const patchText = `${JSON.stringify(patchFor({ baseSha: base, changes }), null, 2)}\n`;
  writeFileSync(join(out, 'patch.json'), patchText);
  write('manifest.json', manifestFor({ baseSha: base, round: n, result, changes }));
  write('record.json', recordFor({ identity, task, controller, head: base, round: n, patchText }));
  return finish({ ...result, round: n, files: changes.map((c) => c.path) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  editMain(args(process.argv.slice(2))).then((r) => {
    console.log(`landing-bot model: round ${r.round ?? '?'} ${r.outcome} (${r.reason}); provider ${r.provider ?? 'none'}, ${r.turns ?? 0} turns`);
  }, (e) => {
    console.error(`landing-bot model: edit failed (${String(e?.message || e).slice(0, 200)})`);
    process.exitCode = 1;
  });
}
