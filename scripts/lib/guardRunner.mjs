/** D5505 (#5505): ordered independent guard execution with explicit prerequisites and interruption results. */
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { constants } from 'node:os';
const safeSignal = value => Object.hasOwn(constants.signals, value) ? value : 'SIGTERM';
export function validateGuards(guards) {
  if (!Array.isArray(guards) || !guards.length) throw new Error('guard catalog must not be empty');
  const seen = new Set();
  for (const guard of guards) {
    if (!/^[a-z][a-z0-9-]*$/.test(guard.id) || seen.has(guard.id)) throw new Error('invalid or duplicate guard id');
    if (!Array.isArray(guard.command) || !guard.command.length || guard.command.some(arg => typeof arg !== 'string' || !arg || arg.length > 1024 || /[\x00\r\n]/.test(arg))) throw new Error(`invalid command: ${guard.id}`);
    if (guard.full !== undefined && typeof guard.full !== 'boolean' || guard.preflight !== undefined && typeof guard.preflight !== 'boolean') throw new Error('invalid guard selection metadata');
    if (guard.requires !== undefined && !Array.isArray(guard.requires) || (guard.requires || []).some(id => !seen.has(id))) throw new Error(`prerequisite must precede ${guard.id}`);
    seen.add(guard.id);
  }
}
export function selectGuards(guards, { preflight = false, id = null } = {}) {
  validateGuards(guards);
  const chosen = new Set(guards.filter(g => id ? g.id === id : preflight ? g.preflight : g.full !== false).map(g => g.id));
  if (id && !chosen.size) throw new Error('unknown guard id');
  for (const g of [...guards].reverse()) if (chosen.has(g.id)) for (const dep of g.requires || []) chosen.add(dep);
  return guards.filter(g => chosen.has(g.id));
}
/** No shell; interrupt the child's process group so npm descendants cannot outlive cancellation. */
export function executeGuard(command, { cwd, signal, spawnProcess = spawn, killProcess = (pid, name) => process.kill(pid, name) }) {
  if (signal.aborted) return Promise.resolve({ exitCode: null, signal: safeSignal(signal.reason) });
  return new Promise(resolve => {
    const grouped = process.platform !== 'win32';
    const child = spawnProcess(command[0], command.slice(1), { cwd, stdio: 'inherit', detached: grouped });
    let escalation, closed, settled = false, escalated = false;
    const kill = name => { try { if (grouped && child.pid) killProcess(-child.pid, name); else child.kill(name); } catch { /* already exited */ } };
    const groupAlive = () => { try { if (!grouped || !child.pid) return false; killProcess(-child.pid, 0); return true; } catch { return false; } };
    const finish = () => { if (settled || !closed) return; settled = true; clearTimeout(escalation); signal.removeEventListener('abort', abort); resolve(closed); };
    const abort = () => {
      kill(safeSignal(signal.reason));
      if (settled) return;
      // Keep the grace timer alive even if the parent exits before an npm descendant.
      escalation = setTimeout(() => { escalated = true; kill('SIGKILL'); finish(); }, 1000);
    };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const close = result => {
      closed = result;
      if (escalated || !signal.aborted || !groupAlive()) finish();
    };
    child.once('error', error => close({ exitCode: 1, signal: null, errorCode: error.code || 'SPAWN_ERROR' }));
    child.once('close', (exitCode, childSignal) => close({ exitCode, signal: childSignal }));
  });
}

export async function runGuards(guards, { cwd = process.cwd(), execute = executeGuard, controller = new AbortController(), report = () => {} } = {}) {
  validateGuards(guards);
  const results = [];
  for (const guard of guards) {
    const row = { id: guard.id, kind: 'guard', command: guard.command, file: guard.command.find(arg => arg.startsWith('scripts/') && arg.endsWith('.mjs')) || guard.command.find(arg => arg.startsWith('node_modules/') && arg.endsWith('.js')) || null,
      status: 'not_run', exitCode: null, signal: null, blockedBy: [], durationMs: 0 };
    const dependencies = (guard.requires || []).filter(id => results.find(r => r.id === id)?.status !== 'passed');
    if (controller.signal.aborted) row.signal = safeSignal(controller.signal.reason);
    else if (dependencies.length) { row.status = 'blocked'; row.blockedBy = dependencies; }
    else {
      const start = performance.now(); let result;
      try { result = await execute(guard.command, { cwd, signal: controller.signal }); }
      catch { result = { exitCode: 1, errorCode: 'EXECUTION_ERROR' }; }
      result ||= { exitCode: 1, errorCode: 'EXECUTION_ERROR' };
      row.durationMs = Math.round(performance.now() - start);
      row.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
      row.signal = result.signal ? safeSignal(result.signal) : controller.signal.aborted ? safeSignal(controller.signal.reason) : null;
      if (result.errorCode) row.errorCode = /^[A-Z_]+$/.test(result.errorCode) ? result.errorCode : 'EXECUTION_ERROR';
      row.status = row.signal ? 'interrupted' : row.exitCode === 0 ? 'passed' : 'failed';
      if (row.signal && !controller.signal.aborted) controller.abort(row.signal);
    }
    results.push(row); report(row);
  }
  const signal = controller.signal.aborted ? safeSignal(controller.signal.reason) : null;
  const exitCode = signal ? 128 + constants.signals[signal] : results.every(row => row.status === 'passed') ? 0 : 1;
  return { version: 1, scope: 'guards', complete: true, results, exitCode, interrupted: Boolean(signal) };
}
