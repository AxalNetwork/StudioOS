/** D7905 fixture: the real supervisor receives SIGTERM mid-test; it must remove the container exactly and exit 130. */
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobContainer } from '../../../scripts/ci/runners/job-container.mjs';
import { recoveryStore } from '../../../scripts/ci/runners/recovery-store.mjs';
import { runInContainer, withCancellation } from '../../../scripts/ci/runner-execution.mjs';
const CID = 'b'.repeat(64), root = mkdtempSync(join(tmpdir(), 'cancel-7905-'));
const source = join(root, 'source'), plan = join(root, 'plan.json'), storeRoot = join(root, 'containers');
mkdirSync(source); writeFileSync(plan, '{}');
const identity = { version: 1, repository: 'AxalNetwork/StudioOS', profile: 'linux-x64', requestId: '00000000-0000-4000-8000-000000000001', logicalShard: 'worker-1-of-6', childRunId: 202, childAttempt: 1, generation: 1, executionDeadline: Date.now() + 600000, event: 'push', sourceSha: 'e'.repeat(40) };
const admitted = { allowed: true, identity, sourceSha: identity.sourceSha, originalRunId: 101, originalAttempt: 1, originalEvent: 'push', sourceRef: 'refs/heads/main' };
const calls = []; let removed = false;
const engine = args => {
  calls.push(args[0]);
  if (args[0] === 'create') return CID + '\n';
  if (args[0] === 'inspect') { if (removed) throw Object.assign(new Error('x'), { stderr: 'No such object' }); return JSON.stringify([{ Id: CID, Config: { Labels: { 'vc.axal.studioos.job': '202-1-1' } } }]); }
  if (args[0] === 'rm') { removed = true; return ''; }
  return '';
};
const job = new JobContainer({ version: 1, image: 'sha256:' + 'a'.repeat(64), nodeVersion: '22.23.3', pythonVersion: '3.11.18' }, {
  engine, stage: () => {}, namespace: () => true,
  spawnEngine: args => { const install = args.at(-1).includes('npm ci'); if (!install) process.stdout.write('started\n'); return spawn('/bin/sh', ['-c', install ? 'exit 0' : 'sleep 30'], { stdio: 'ignore' }); },
});
job.verifyIsolation = () => true;
const logs = [];
const code = await withCancellation(signal => runInContainer({ job, executionIsolation: async () => true, admit: async () => admitted, current: { profile: { id: 'linux-x64' }, identity }, paths: { source }, planPath: plan, signal, store: recoveryStore({ root: storeRoot, create: true }), log: l => logs.push(l) }));
const outcome = JSON.parse(logs.find(l => l.includes('container_outcome')));
process.stdout.write(JSON.stringify({ code, result: outcome.result, test: outcome.test.status, cleanup: outcome.cleanup.state, removed: calls.includes('rm'), records: readdirSync(storeRoot) }) + '\n');
