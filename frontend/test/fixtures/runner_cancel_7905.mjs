/** D7905 fixture: a supervisor in the container path receives SIGTERM mid-run; it must clean up and exit 130. */
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withCancellation, runInContainer } from '../../../scripts/ci/runner-execution.mjs';
const temp = mkdtempSync(join(tmpdir(), 'cancel-7905-'));
const paths = { temp, source: join(temp, 'source') };
const identity = { profile: 'linux-x64' };
const events = [];
const job = {
  owned: null, onOwned: null,
  create() { this.owned = { id: 'x' }; this.onOwned({ version: 1, id: 'c'.repeat(64), owner: '1-1-1' }); events.push('create'); },
  runCandidateInterruptible({ signal }) {
    events.push('run'); process.stdout.write('started\n');
    // Stands in for the engine client process, which keeps the real supervisor's event loop alive.
    const busy = setInterval(() => {}, 1000);
    return new Promise((_, reject) => signal.addEventListener('abort', () => { clearInterval(busy); reject(new Error('execution_cancelled')); }, { once: true }));
  },
  cleanup() { events.push('cleanup'); this.owned = null; },
};
const code = await withCancellation(signal => runInContainer({ job, executionIsolation: async () => true, admit: async () => ({ allowed: true, identity }), current: { profile: { id: 'linux-x64' }, identity }, paths, planPath: join(temp, 'plan'), signal, log: () => {} }));
process.stdout.write(JSON.stringify({ code, events, recordLeft: existsSync(join(temp, 'container-owner.json')) }) + '\n');
