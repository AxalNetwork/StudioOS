/** D5532: profile a prepared release bundle locally before any production mutation. */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerDir = fileURLToPath(new URL('../cloudflare-worker/', import.meta.url));
const requireWorker = createRequire(new URL('../cloudflare-worker/package.json', import.meta.url));
const runs = 3;
export const maxActiveMs = 800;

async function parseBundle(bytes) {
  const firstNewline = bytes.indexOf(10);
  const boundary = bytes.subarray(2, firstNewline).toString().trim();
  if (firstNewline < 3 || bytes.subarray(0, 2).toString() !== '--' || !/^[\w-]{1,70}$/.test(boundary)) {
    throw new Error('Expected a Wrangler --outfile multipart bundle.');
  }
  const form = await new Response(bytes, { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }).formData();
  return { form, metadata: JSON.parse(form.get('metadata')) };
}

export async function bundleIdentity(bytes, candidate) {
  const { form, metadata } = await parseBundle(bytes);
  const version = metadata.bindings?.find(binding => binding.name === 'WORKER_DEPLOY_VERSION');
  if (!/^[a-f0-9]{40}$/.test(candidate ?? '') || version?.type !== 'plain_text' || version.text !== candidate ||
      typeof metadata.main_module !== 'string' || !(form.get(metadata.main_module) instanceof Blob)) {
    throw new Error('Bundle must name this candidate in its WORKER_DEPLOY_VERSION binding.');
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    entry: metadata.main_module,
    compatibilityDate: metadata.compatibility_date,
    compatibilityFlags: metadata.compatibility_flags,
  };
}

export function measureProfile(profile) {
  const { nodes, samples, timeDeltas } = profile;
  if (!Array.isArray(nodes) || !Array.isArray(samples) || !Array.isArray(timeDeltas) ||
      samples.length === 0 || samples.length !== timeDeltas.length) throw new Error('Startup profile contains no valid samples.');
  const frames = new Map(nodes.map(node => [node.id, node.callFrame]));
  const cost = new Map();
  let activeUs = 0;
  for (const [i, elapsed] of timeDeltas.entries()) {
    const frame = frames.get(samples[i]);
    if (!frame || !Number.isFinite(elapsed) || elapsed < 0) throw new Error('Startup profile contains an invalid sample.');
    if (frame.functionName === '(idle)') continue;
    activeUs += elapsed;
    const location = frame.url ? ` (${frame.url}:${frame.lineNumber + 1})` : '';
    const name = (frame.functionName || '(anonymous)') + location;
    cost.set(name, (cost.get(name) ?? 0) + elapsed);
  }
  if (activeUs === 0) throw new Error('Startup profile did not measure any active CPU time.');
  return { activeMs: activeUs / 1000,
    topFrames: [...cost].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([frame, us]) => ({ frame, ms: us / 1000 })) };
}

export function classifyStartup(measurements) {
  if (measurements.length !== runs || measurements.some(({ activeMs }) => !Number.isFinite(activeMs) || activeMs <= 0)) {
    return 'inconclusive';
  }
  return measurements.some(({ activeMs }) => activeMs > maxActiveMs) ? 'over_budget' : 'verified';
}

const moduleTypes = {
  'application/javascript+module': 'ESModule',
  'application/javascript': 'CommonJS',
  'text/plain': 'Text',
  'application/octet-stream': 'Data',
  'application/wasm': 'CompiledWasm',
};

async function profileOnce(bundle, output) {
  const { Miniflare, convertV4MiniflareOptions } = requireWorker('miniflare');
  const { form, metadata } = await parseBundle(readFileSync(bundle));
  const modules = [{ path: '__s32_probe.mjs', type: 'ESModule', contents: `export default {
    async fetch(request, env, ctx) {
      const { default: worker } = await import(${JSON.stringify('./' + metadata.main_module)});
      return worker.fetch(request, env, ctx);
    }
  };` }];
  for (const [path, file] of form) {
    if (!(file instanceof Blob) || file.type === 'application/source-map') continue;
    const type = moduleTypes[file.type];
    if (!type) throw new Error(`Unsupported module type ${file.type} in the startup bundle.`);
    modules.push({ path, type, contents: new Uint8Array(await file.arrayBuffer()) });
  }
  const bindings = Object.fromEntries(metadata.bindings.filter(b => b.type === 'plain_text').map(b => [b.name, b.text]));
  // Satisfy the request-level production checks with disposable values.
  bindings.JWT_SECRET = randomBytes(32).toString('hex');
  bindings.SCORING_HMAC_SECRET = randomBytes(32).toString('hex');
  const worker = new Miniflare(convertV4MiniflareOptions({
    name: 'startup-probe', modulesRoot: '/', modules, bindings, inspectorPort: 0, cf: false,
    compatibilityDate: metadata.compatibility_date, compatibilityFlags: metadata.compatibility_flags,
    outboundService: () => new Response('Local startup probe disables outbound requests', { status: 503 }),
  }));
  let socket;
  try {
    await worker.ready;
    socket = new WebSocket(new URL('/core:user:startup-probe', await worker.getInspectorURL()));
    await new Promise((ok, fail) => {
      socket.addEventListener('open', ok, { once: true });
      socket.addEventListener('error', fail, { once: true });
    });
    let id = 0;
    const inspect = method => new Promise((ok, fail) => {
      const requestId = ++id;
      const listener = ({ data }) => {
        const response = JSON.parse(data);
        if (response.id !== requestId) return;
        socket.removeEventListener('message', listener);
        if (response.error) fail(new Error(`Inspector ${method} failed.`));
        else ok(response.result);
      };
      socket.addEventListener('message', listener);
      socket.send(JSON.stringify({ id: requestId, method }));
    });
    async function health() {
      const start = performance.now();
      const response = await worker.dispatchFetch('https://example.test/api/health');
      const body = await response.json();
      if (response.status !== 200 || body.status !== 'ok') throw new Error(`Local health check failed (${response.status}).`);
      return performance.now() - start;
    }
    await inspect('Profiler.enable');
    await inspect('Profiler.start');
    const coldMs = await health();
    const { profile } = await inspect('Profiler.stop');
    writeFileSync(output, JSON.stringify(profile));
    const warmMs = await health();
    writeFileSync(output + '.health.json', JSON.stringify({ coldMs, warmMs }));
  } finally {
    socket?.close();
    await worker.dispose();
  }
}

async function main(candidate, bundle, output) {
  if (!bundle || !output) throw new Error('Usage: node scripts/check-worker-startup.mjs <candidate SHA> <worker.bundle> <new diagnostics directory>');
  const dir = resolve(output);
  mkdirSync(dir);
  const report = {
    candidate: /^[a-f0-9]{40}$/.test(candidate ?? '') ? candidate : null,
    platform: `${platform()}-${arch()}`, cpu: cpus()[0]?.model, node: process.version,
    thresholdMs: maxActiveMs, measurements: [], status: 'inconclusive',
  };
  try {
    const artifact = resolve(bundle);
    report.bundle = await bundleIdentity(readFileSync(artifact), candidate);
    report.wrangler = JSON.parse(readFileSync(join(workerDir, 'node_modules/wrangler/package.json'), 'utf8')).version;
    // The probe uses the pinned local workerd and a loopback inspector.
    const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, NO_COLOR: '1' };
    for (let i = 1; i <= runs; i += 1) {
      const file = `startup-${i}.cpuprofile`;
      const profilePath = join(dir, file);
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--profile', artifact, profilePath],
        { cwd: workerDir, env, encoding: 'utf8', timeout: 45_000 });
      writeFileSync(join(dir, `startup-${i}.log`), (child.stdout ?? '') + (child.stderr ?? ''));
      if (child.error || child.status !== 0) {
        const reason = child.error?.code ?? child.signal ?? `exit ${child.status}`;
        throw new Error(`Local startup profile ${i} failed (${reason}). See startup-${i}.log.`);
      }
      report.measurements.push({ file, ...measureProfile(JSON.parse(readFileSync(profilePath, 'utf8'))),
        ...JSON.parse(readFileSync(profilePath + '.health.json', 'utf8')) });
    }
    const finalDigest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
    if (finalDigest !== report.bundle.sha256) throw new Error('Bundle changed during startup profiling.');
    report.status = classifyStartup(report.measurements);
    if (report.status === 'over_budget') report.reason = 'At least one cold profile exceeded the local CPU budget.';
  } catch (error) {
    report.reason = error.message;
  }
  writeFileSync(join(dir, 'startup.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ candidate: report.candidate, status: report.status,
    activeMs: report.measurements.map(run => run.activeMs), thresholdMs: report.thresholdMs, reason: report.reason }));
  if (report.status !== 'verified') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--profile') await profileOnce(...args);
  else await main(command, ...args);
}
