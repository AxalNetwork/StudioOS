/** D5566: one bounded, pre-authorized materialization; exact local Git bundle SHA, scoped commands and unsigned output. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = '/workspace/repo', SCRATCH = '/workspace/tmp';
const LIMIT = 8 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pathOk = value => typeof value === 'string' && value.length <= 512 && value.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git' && /^[A-Za-z0-9_.()-]+$/.test(part));
const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: SCRATCH, TMPDIR: SCRATCH, XDG_CACHE_HOME: SCRATCH,
  npm_config_cache: join(SCRATCH, 'npm'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LANG: 'C.UTF-8' };
function run(argv, cwd, deadline) {
  return new Promise((done, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderrBytes = 0, killed = false;
    const stop = code => { killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} reject(Object.assign(Error(code), { code })); };
    const timer = setTimeout(() => stop('timeout'), Math.max(1, deadline - Date.now()));
    child.stdout.on('data', bytes => { if (Buffer.byteLength(stdout) + bytes.length > 65536) stop('output_limit'); else stdout += bytes; });
    child.stderr.on('data', bytes => { stderrBytes += bytes.length; if (stderrBytes > 65536) stop('output_limit'); });
    child.on('error', () => { clearTimeout(timer); reject(Object.assign(Error('command_start_failed'), { code: 'command_start_failed' })); });
    child.on('close', code => {
      clearTimeout(timer); try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      if (!killed) code === 0 ? done(stdout) : reject(Object.assign(Error('command_failed'), { code: code === 78 ? 'containment_unavailable' : 'command_failed' }));
    });
  });
}
function inventory(dir = ROOT, prefix = '', found = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!prefix && entry.name === '.git') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!pathOk(relative) || entry.isSymbolicLink()) throw Object.assign(Error('unsafe_tree'), { code: 'unsafe_tree' });
    const file = join(dir, entry.name), st = lstatSync(file);
    if (st.isDirectory()) inventory(file, relative, found);
    else if (st.isFile()) {
      if (st.size > LIMIT || found.size >= 2000) throw Object.assign(Error('tree_limit'), { code: 'tree_limit' });
      const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { found.set(relative, { sha256: digest(readFileSync(fd)), size: st.size }); } finally { closeSync(fd); }
    } else throw Object.assign(Error('unsafe_tree'), { code: 'unsafe_tree' });
  }
  return found;
}
function validate(job) {
  const keys = ['version', 'run_id', 'execution_generation', 'base_sha', 'scope_paths', 'max_duration_s', 'bundle_b64', 'commands'];
  if (!job || Object.keys(job).some(key => !keys.includes(key)) || keys.some(key => !(key in job)) || job.version !== 1
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(job.run_id) || !Number.isSafeInteger(job.execution_generation) || job.execution_generation < 1
    || !/^[a-f0-9]{40}$/.test(job.base_sha) || !Array.isArray(job.scope_paths) || !job.scope_paths.length || job.scope_paths.length > 64 || !job.scope_paths.every(pathOk)
    || !Number.isSafeInteger(job.max_duration_s) || job.max_duration_s < 1 || job.max_duration_s > 600
    || typeof job.bundle_b64 !== 'string' || job.bundle_b64.length > LIMIT || !/^[A-Za-z0-9+/]*={0,2}$/.test(job.bundle_b64)
    || !Array.isArray(job.commands) || !job.commands.length || job.commands.length > 10
    || !job.commands.every(command => Array.isArray(command) && command.length > 0 && command.length <= 32 && ['node', 'git', 'npm'].includes(command[0])
      && command.every(arg => typeof arg === 'string' && arg.length <= 2000 && !arg.includes('\0')))) throw Object.assign(Error('invalid_materialization'), { code: 'invalid_materialization' });
}
async function main() {
  let input = '';
  for await (const bytes of process.stdin) { input += bytes; if (Buffer.byteLength(input) > LIMIT) throw Object.assign(Error('input_limit'), { code: 'input_limit' }); }
  const job = JSON.parse(input); validate(job);
  mkdirSync(SCRATCH, { recursive: true });
  const bundle = '/workspace/input.bundle';
  if (existsSync(ROOT) || existsSync(bundle)) throw Object.assign(Error('workspace_not_empty'), { code: 'workspace_not_empty' });
  writeFileSync(bundle, Buffer.from(job.bundle_b64, 'base64'), { flag: 'wx', mode: 0o400 });
  const deadline = Date.now() + job.max_duration_s * 1000;
  await run(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--no-local', '--no-checkout', bundle, ROOT], '/workspace', deadline);
  await run(['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', job.base_sha], ROOT, deadline);
  const head = (await run(['git', 'rev-parse', 'HEAD'], ROOT, deadline)).trim();
  if (head !== job.base_sha) throw Object.assign(Error('sha_mismatch'), { code: 'sha_mismatch' });
  const before = inventory();
  const scopes = job.scope_paths.map(path => resolve(ROOT, path));
  // Materialization must prepare every exact file/directory scope before execution.
  if (scopes.some(path => !existsSync(path))) throw Object.assign(Error('scope_missing'), { code: 'scope_missing' });
  // Commands own this disposable scratch tree. The Worker independently checks every returned
  // patch path/hash against the authorized scope before any artifact/publisher acceptance.
  for (const command of job.commands) await run(command, ROOT, deadline);
  const after = inventory(), changed = [];
  let outputBytes = 0;
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path)?.sha256 === after.get(path)?.sha256) continue;
    if (!job.scope_paths.some(scope => path === scope || path.startsWith(scope + '/'))) throw Object.assign(Error('scope_violation'), { code: 'scope_violation' });
    const file = after.get(path);
    if (file) {
      outputBytes += file.size; if (outputBytes > 2 * 1024 * 1024) throw Object.assign(Error('artifact_limit'), { code: 'artifact_limit' });
      const fd = openSync(join(ROOT, path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { changed.push({ path, sha256: file.sha256, bytes: readFileSync(fd).toString('base64') }); } finally { closeSync(fd); }
    } else changed.push({ path, deleted: true });
  }
  // Signing/verification happens in the Worker broker. This process has no signing/cloud credential.
  process.stdout.write(JSON.stringify({ version: 1, run_id: job.run_id, execution_generation: job.execution_generation, base_sha: head, changed }));
}
main().catch(error => { process.stdout.write(JSON.stringify({ ok: false, code: /^[a-z_]+$/.test(error.code || '') ? error.code : 'job_failed' })); process.exitCode = 1; });
