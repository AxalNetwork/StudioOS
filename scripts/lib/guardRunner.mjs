/** D5505 (#5505): ordered guard execution and bounded, stable result records. */
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export function validateGuards(guards) {
  const seen = new Set();
  for (const guard of guards) {
    if (!/^[a-z][a-z0-9-]*$/.test(guard.id) || seen.has(guard.id)) throw new Error('invalid or duplicate guard id');
    if (!Array.isArray(guard.command) || !guard.command.length || guard.command.some(arg => typeof arg !== 'string' || !arg || arg.length > 1024)) throw new Error(`invalid command: ${guard.id}`);
    if ((guard.requires || []).some(id => !seen.has(id))) throw new Error(`prerequisite must precede ${guard.id}`);
    seen.add(guard.id);
  }
}

/** No shell: flags, glob arguments and loaders retain their literal meaning. */
export function executeGuard(command, { cwd, signal }) {
  return new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { cwd, stdio: 'inherit' });
    let escalation;
    const abort = () => {
      child.kill(signal.reason || 'SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 1000);
      escalation.unref();
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const cleanup = () => { clearTimeout(escalation); signal.removeEventListener('abort', abort); };
    child.once('error', error => { cleanup(); resolve({ exitCode: 1, signal: null, errorCode: error.code || 'SPAWN_ERROR' }); });
    child.once('close', (exitCode, childSignal) => { cleanup(); resolve({ exitCode, signal: childSignal }); });
  });
}

/** Results contain trusted identities/statuses only, never captured child output. */
export async function runGuards(guards, { cwd = process.cwd(), execute = executeGuard, controller = new AbortController(), report = () => {} } = {}) {
  validateGuards(guards);
  const results = [];
  for (const guard of guards) {
    const row = { id: guard.id, kind: 'guard', command: guard.command, file: guard.command.find(arg => arg.startsWith('scripts/') && arg.endsWith('.mjs')) || null,
      status: 'not_run', exitCode: null, signal: null, blockedBy: [], durationMs: 0 };
    const dependencies = (guard.requires || []).filter(id => results.find(r => r.id === id)?.status !== 'passed');
    if (controller.signal.aborted) row.signal = controller.signal.reason;
    else if (dependencies.length) { row.status = 'blocked'; row.blockedBy = dependencies; }
    else {
      const start = performance.now();
      let result;
      try { result = await execute(guard.command, { cwd, signal: controller.signal }); }
      catch { result = { exitCode: 1, errorCode: 'EXECUTION_ERROR' }; }
      row.durationMs = Math.round(performance.now() - start);
      row.exitCode = result.exitCode ?? null;
      row.signal = result.signal || (controller.signal.aborted ? controller.signal.reason : null);
      if (result.errorCode) row.errorCode = /^[A-Z_]+$/.test(result.errorCode) ? result.errorCode : 'EXECUTION_ERROR';
      row.status = row.signal ? 'interrupted' : row.exitCode === 0 ? 'passed' : 'failed';
      if (row.signal && !controller.signal.aborted) controller.abort(row.signal);
    }
    results.push(row);
    report(row);
  }
  const signal = controller.signal.aborted ? controller.signal.reason : null;
  const exitCode = signal ? (signal === 'SIGINT' ? 130 : 143) : results.every(row => row.status === 'passed') ? 0 : 1;
  return { version: 1, scope: 'guards', results, exitCode, interrupted: Boolean(signal) };
}
