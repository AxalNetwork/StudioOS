// #4622: a reproducible before/after baseline for the founder Studio's reads, on SYNTHETIC delays.
// It makes no claim about production latency: it shows what the page waits for, under one fixed set of
// response times, and what it no longer waits for. Run it with:
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/baseline_studio_reads_4622.test.mjs
//
// It prints a table and asserts only the ORDER of events, which does not depend on the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFounderStudioReads } from '../src/pages/founder/founderStudioReads.js';

const DELAY = { projects: 30, lab: 30, advisor: 400, queue: 400, lifecycle: 30, scores: 30 };
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const clients = () => ({
  client: {
    listProjects: () => later(DELAY.projects, [{ id: 7, name: 'Synthetic' }]),
    getLifecycle: () => later(DELAY.lifecycle, { stage: 'x' }),
    getScores: () => later(DELAY.scores, []),
    advisor: { progress: () => later(DELAY.advisor, { total: 3 }), queue: () => later(DELAY.queue, { queue: [] }) },
  },
  lab: { state: () => later(DELAY.lab, { active: true }) },
});

// The pre-#4622 algorithm, as it stood in FounderStudioHome.jsx: every independent read settled together, the
// dependent reads started only after all four, and the page committed once, at the end.
async function legacy({ client, lab }, commit) {
  const settle = async (key, promise) => { try { return [key, await promise]; } catch { return [key, { failed: true }]; } };
  const [[, projects], ...rest] = await Promise.all([
    settle('projects', client.listProjects()), settle('lab', lab.state()), settle('advisor', client.advisor.progress()), settle('queue', client.advisor.queue()),
  ]);
  const reads = Object.fromEntries(rest);
  const project = projects[0];
  const [[, lifecycle], [, scores]] = await Promise.all([settle('lifecycle', client.getLifecycle(project.id)), settle('scores', client.getScores(project.id))]);
  commit({ ...reads, project, lifecycle, scores });
}

async function timeline(run) {
  const start = Date.now();
  const at = {};
  await run((key) => { at[key] ??= Date.now() - start; });
  return at;
}

test('baseline: when each zone can first draw, before and after (synthetic delays)', async () => {
  const before = await timeline((mark) => legacy(clients(), (all) => Object.keys(all).forEach(mark)));
  const after = await timeline((mark) => startFounderStudioReads({ requestedProjectId: null, ...clients(), onRead: (key) => mark(key) }));
  const rows = ['lab', 'project', 'lifecycle', 'scores', 'advisor', 'queue'];
  console.log(`\n#4622 baseline, synthetic delays (ms): ${JSON.stringify(DELAY)}`);
  console.log('zone        before   after');
  for (const k of rows) console.log(`${k.padEnd(11)} ${String(before[k]).padStart(6)} ${String(after[k]).padStart(7)}`);
  // Order, not milliseconds: the page used to commit everything when the slowest read ended; now the zones that
  // do not depend on the advisor draw long before it answers.
  for (const k of ['lab', 'project', 'lifecycle', 'scores']) {
    assert.ok(after[k] < DELAY.advisor / 2, `${k} is on the page long before the advisor answers (${after[k]} ms)`);
    assert.ok(before[k] >= DELAY.advisor, `${k} used to wait for the advisor (${before[k]} ms)`);
  }
  for (const k of ['advisor', 'queue']) assert.ok(after[k] >= DELAY.advisor - 20, `${k} still lands when it answers`);
});
