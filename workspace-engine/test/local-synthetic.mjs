/** D5566: actual local Docker execution, synthetic Git bundles and broker-side signatures; no hosted/provider claim. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const image = process.env.WORKSPACE_TEST_IMAGE || 'studioos-workspace-s39:local';
const dir = mkdtempSync(join(tmpdir(), 'workspace-5566-'));
const evidence = process.env.WORKSPACE_EVIDENCE_DIR || '/tmp/s39-workspace-5566-evidence';
mkdirSync(evidence, { recursive: true });
const dockerEnv = { ...process.env, BUILDX_CONFIG: '/tmp/s39-docker-buildx' };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key];
const docker = args => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env: dockerEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
const git = (repo, args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Synthetic workspace fixture', '-c', 'user.email=synthetic@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repoFixture(name, { symlink = false, bomb = false } = {}) {
  const path = join(dir, name); mkdirSync(join(path, 'src'), { recursive: true }); mkdirSync(join(path, 'test'));
  writeFileSync(join(path, 'src/value.cjs'), 'module.exports = 1;\n');
  writeFileSync(join(path, 'outside.txt'), 'unchanged\n');
  writeFileSync(join(path, 'test/value.test.cjs'), "const {test}=require('node:test');const assert=require('node:assert/strict');test('synthetic value',()=>assert.equal(require('../src/value.cjs'),2));\n");
  git(path, ['init', '-q']);
  if (symlink) {
    // Git constructs the synthetic symlink object, without reading any target.
    const blob = execFileSync('git', ['-C', path, 'hash-object', '-w', '--stdin'], { input: '/etc/passwd', encoding: 'utf8' }).trim();
    git(path, ['update-index', '--add', '--cacheinfo', `120000,${blob},src/leak`]);
  }
  if (bomb) writeFileSync(join(path, 'src/large.txt'), Buffer.alloc(96 * 1024 * 1024, 97));
  git(path, ['add', 'src/value.cjs', 'outside.txt', 'test/value.test.cjs']);
  if (bomb) git(path, ['add', 'src/large.txt']);
  git(path, ['commit', '-qm', 'Synthetic exact-SHA input']);
  const sha = git(path, ['rev-parse', 'HEAD']), bundle = join(dir, `${name}.bundle`);
  git(path, ['bundle', 'create', bundle, 'HEAD']);
  return { sha, bundle: readFileSync(bundle).toString('base64') };
}
let count = 0;
const tag = `s39-${process.pid}`;
const names = new Set();
async function runCase(label, fixture, commands, changes = {}, cancel = false) {
  const name = `${tag}-${++count}`; names.add(name);
  const job = { version: 1, run_id: `synthetic-${label}`, execution_generation: 1, base_sha: fixture.sha,
    scope_paths: ['src/value.cjs'], max_duration_s: 15, bundle_b64: fixture.bundle, commands, ...changes };
  const args = ['--host=unix:///var/run/docker.sock', 'run', '-i', '--rm', '--init', '--name', name, '--label', `studioos.fixture=${tag}`,
    '--network', 'none', '--read-only', '--pids-limit', '64', '--cpus', '0.5', '--memory', '256m', '--memory-swap', '256m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/workspace:rw,nosuid,nodev,size=32m,uid=1000,gid=1000,mode=700',
    ...['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'].flatMap(key => ['--env', `${key}=`]),
    '--entrypoint', '/usr/bin/setpriv', image, '--no-new-privs', 'node', '/app/run-job.mjs'];
  let output = '', errors = '';
  const child = spawn('docker', args, { env: dockerEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { errors += bytes; });
  const finished = new Promise((done, reject) => { child.on('error', reject); child.on('close', code => done(code)); });
  child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(job));
  const hardStop = setTimeout(() => { try { docker(['rm', '-f', name]); } catch {} }, 30000);
  try {
    if (cancel) {
      // A bounded readiness poll, never a production or cloud endpoint.
      for (let attempt = 0; attempt < 40; attempt++) {
        try { if (docker(['inspect', name, '--format', '{{.State.Running}}']).trim() === 'true') break; } catch {}
        await new Promise(done => setTimeout(done, 50));
      }
      docker(['rm', '-f', name]);
    }
    const exit = await finished;
    if (cancel) { assert.notEqual(exit, 0); return { cancelled: true }; }
    let result;
    try { result = JSON.parse(output); } catch { throw Error(`No bounded job result for ${label}; exit=${exit}; ${errors.slice(-500)}`); }
    return { exit, ...result };
  } finally {
    clearTimeout(hardStop); try { docker(['rm', '-f', name]); } catch {} names.delete(name);
  }
}

try {
  const configuration = JSON.parse(docker(['image', 'inspect', image]))[0];
  assert.equal(configuration.Config.User, 'node');
  assert.ok(!configuration.Config.Env.some(value => /(?:CLOUDFLARE|AWS_|AZURE_|GITHUB_TOKEN|API_KEY|SECRET)/i.test(value)));
  const fixture = repoFixture('normal');
  const code = "require('node:fs').writeFileSync('src/value.cjs','module.exports = 2;\\n')";
  const result = await runCase('tenant-a', fixture, [['node', '-e', code], ['node', '--test', 'test/value.test.cjs']]);
  assert.equal(result.exit, 0, JSON.stringify(result)); assert.equal(result.base_sha, fixture.sha);
  assert.deepEqual(result.changed.map(file => file.path), ['src/value.cjs']);
  for (const file of result.changed) assert.equal(createHash('sha256').update(Buffer.from(file.bytes, 'base64')).digest('hex'), file.sha256);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const manifest = { version: 1, workload_class: 'coding_trusted', tenant_id: 101, run_id: result.run_id, execution_generation: result.execution_generation,
    base_sha: result.base_sha, image_id: configuration.Id, files: result.changed.map(({ path, sha256 }) => ({ path, sha256 })) };
  const signature = sign(null, Buffer.from(JSON.stringify(manifest)), privateKey);
  assert.equal(verify(null, Buffer.from(JSON.stringify(manifest)), publicKey, signature), true);
  assert.equal(verify(null, Buffer.from(JSON.stringify({ ...manifest, tenant_id: 202 })), publicKey, signature), false);
  writeFileSync(join(evidence, 'signed-synthetic-manifest.json'), JSON.stringify({ manifest, signature: signature.toString('base64'), public_key: publicKey.export({ type: 'spki', format: 'pem' }) }, null, 2));
  console.log('PASS exact SHA, scoped edit, actual tests, broker-side Ed25519 manifest; no GitHub push');

  const confinement = "const a=require('node:assert/strict'),f=require('node:fs');a.equal(process.getuid(),1000);a.match(f.readFileSync('/proc/self/status','utf8'),/NoNewPrivs:\\s+1/);a.match(f.readFileSync('/proc/self/status','utf8'),/CapEff:\\s+0+/);a.equal(Object.keys(process.env).some(k=>/CLOUDFLARE|AWS_|GITHUB_TOKEN|API_KEY|SECRET|PROXY/.test(k)),false);a.equal(f.readFileSync('src/value.cjs','utf8'),'module.exports = 1;\\n');a.throws(()=>f.readFileSync('src/private.txt'));";
  const isolated = await runCase('tenant-b', fixture, [['node', '-e', confinement]]);
  assert.equal(isolated.exit, 0, JSON.stringify(isolated)); assert.deepEqual(isolated.changed, []);
  console.log('PASS second tenant fresh checkout/scratch, no cloud credential and no privilege gain');
  const outside = await runCase('outside-scope', fixture, [['node', '-e', "require('node:fs').writeFileSync('outside.txt','not accepted')"]]);
  assert.equal(outside.code, 'scope_violation'); assert.notEqual(outside.exit, 0);

  const network = "const a=require('node:assert/strict'),n=require('node:net');let left=2;for(const host of ['127.0.0.1','169.254.169.254']){const s=n.connect({host,port:80});s.on('connect',()=>{throw Error('network escaped')});s.on('error',e=>{a.ok(['EACCES','EPERM','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED'].includes(e.code),e.code);if(!--left)process.exit(0)})}";
  assert.equal((await runCase('network-denied', fixture, [['node', '-e', network]])).exit, 0);
  console.log('PASS no reachable localhost/metadata endpoint under Docker network-none; hosted enforcement remains unverified');

  const traversal = await runCase('traversal', fixture, [['node', '-e', '0']], { scope_paths: ['../other'] });
  assert.equal(traversal.code, 'invalid_materialization'); assert.notEqual(traversal.exit, 0);
  const malformed = await runCase('malformed-archive', fixture, [['node', '-e', '0']], { bundle_b64: Buffer.from('not a Git bundle').toString('base64') });
  assert.notEqual(malformed.exit, 0);
  const symlink = await runCase('symlink', repoFixture('symlink', { symlink: true }), [['node', '-e', '0']]);
  assert.equal(symlink.code, 'unsafe_tree');
  const bomb = await runCase('disk-bomb', repoFixture('bomb', { bomb: true }), [['node', '-e', '0']]);
  assert.notEqual(bomb.exit, 0);
  console.log('PASS traversal, malformed bundle, symlink tree and compressed disk bomb refuse without artifacts');

  const timedOut = await runCase('timeout', fixture, [['node', '-e', 'while(true){}']], { max_duration_s: 2 });
  assert.equal(timedOut.code, 'timeout'); assert.notEqual(timedOut.exit, 0);
  assert.equal((await runCase('cancelled', fixture, [['node', '-e', 'while(true){}']], {}, true)).cancelled, true);
  assert.equal(docker(['ps', '-aq', '--filter', `label=studioos.fixture=${tag}`]).trim(), '');
  console.log('PASS forced stop, wall timeout and zero orphaned fixture containers');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ evidence: 'LOCAL_DOCKER_TRUSTED_SYNTHETIC_NOT_HOSTED', image_id: configuration.Id, base_sha: fixture.sha,
    cases: count, orphaned: 0, signed_manifest_verified: true }, null, 2));
} finally {
  for (const name of names) { try { docker(['rm', '-f', name]); } catch {} }
  rmSync(dir, { recursive: true, force: true });
}
