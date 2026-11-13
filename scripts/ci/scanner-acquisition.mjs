// D5531: acquire pinned scanner archives, verifying every cache/download before execution.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const ATTEMPTS = 5;
export function archiveName(tool) {
  if (!/^[a-z]+$/.test(tool.name) || !/^\d+\.\d+\.\d+$/.test(tool.version) || !/^[a-f0-9]{64}$/.test(tool.sha256)) throw Error('Invalid scanner pin');
  return `${tool.name}-${tool.version}-${tool.sha256}.tar.gz`;
}
export async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function verified(path, expected) {
  try { return (await lstat(path)).isFile() && await digest(path) === expected; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function fetchArchive(url, destination) {
  await execute('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '10', '--max-time', '120', '--output', destination, url], { maxBuffer: 1024 * 1024 });
}

// The caller supplies reviewed pins, never fields from a PR, job payload or cache.
// A cache contains compressed bytes only. Copy and rehash before any extraction,
// so swapping a cache file between its first check and copy cannot run new bytes.
export async function acquireArchive({ tool, cacheDir, workDir, download = fetchArchive, copyArchive = copyFile, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), platform = process.platform, arch = process.arch, log = () => {} }) {
  const name = archiveName(tool);
  if (platform !== 'linux' || arch !== 'x64') throw Error(`${tool.name} ${tool.version}: acquisition unsupported on ${platform}/${arch}`);
  if (!tool.url.startsWith('https://github.com/') || !tool.url.endsWith('.tar.gz')) throw Error('Scanner release must use pinned GitHub HTTPS URL');
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(workDir, `${tool.name}-`));
  const archive = join(directory, name);
  const cached = join(cacheDir, name);
  try {
    if (await verified(cached, tool.sha256)) {
      await copyArchive(cached, archive);
      if (await verified(archive, tool.sha256)) return { archive, directory, source: 'verified-cache' };
      await rm(archive, { force: true });
    }
    let received = false;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await rm(archive, { force: true });
      try { await download(tool.url, archive); received = true; }
      catch {
        log(`${tool.name} ${tool.version}: acquisition attempt ${attempt}/${ATTEMPTS} failed`);
        if (attempt < ATTEMPTS) await sleep(attempt * 5000);
        continue;
      }
      // A successful transfer with the wrong bytes is an integrity refusal,
      // never a reason to execute a version-matched but unverified binary.
      if (!await verified(archive, tool.sha256)) throw Error(`${tool.name} ${tool.version}: acquisition integrity check failed`);
      break;
    }
    if (!received) throw Error(`${tool.name} ${tool.version}: acquisition exhausted after ${ATTEMPTS} attempts; scan did not start`);
    const pending = join(directory, 'cache-ready.tar.gz');
    await copyFile(archive, pending);
    await chmod(pending, 0o400);
    await rename(pending, cached);
    return { archive, directory, source: 'verified-download' };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function installScanner(options) {
  const result = await acquireArchive(options);
  if (options.tool.name === 'codeql') return result;
  if (options.tool.name !== 'gitleaks') throw Error('Unsupported scanner');
  try {
    // Extract only the pinned archive's executable, into this job's new directory.
    await execute('tar', ['-xzf', result.archive, '-C', result.directory, '--', 'gitleaks']);
    const binary = join(result.directory, 'gitleaks');
    const version = (await execute(binary, ['version'])).stdout.trim();
    if (version !== options.tool.version) throw Error(`gitleaks ${options.tool.version}: acquisition version check failed`);
    return { ...result, binary };
  } catch (error) {
    await rm(result.directory, { recursive: true, force: true });
    throw error;
  }
}
