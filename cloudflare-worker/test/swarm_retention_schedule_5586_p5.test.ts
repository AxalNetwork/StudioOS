/**
 * D5586 part 5 — the daily swarm admission retention run, 03:17 UTC (owner answer C1, 2026-11-28).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/swarm_retention_schedule_5586_p5.test.ts
 *
 * The coordinator is a synthetic namespace: what reaches it, and what the cron handler logs for each answer.
 * The wiring (the gate in `index.ts`, the three cron tables, `CRON_TRIGGERS`) is read from the source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SWARM_RETENTION_CRON, SWARM_RETENTION_HOUR_UTC, SWARM_RETENTION_MINUTE_UTC, isSwarmRetentionMinute, scheduledSwarmRetention,
} from '../src/services/agents/swarmRetentionSchedule.ts';
import { CRON_TRIGGERS } from '../src/util/cronHistory.ts';
import { WORKSPACE_ADMISSION_OBJECT } from '../src/services/agents/workspaceAdmissionClient.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const at = (iso: string) => new Date(iso);

/** A namespace whose one object answers `answer`, recording every request. */
function coordinator(answer: () => Response | Promise<Response>) {
  const calls: Array<{ name: string; url: string; method: string }> = [];
  const ns: any = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: async (url: string, init: RequestInit = {}) => { calls.push({ name: id.name, url, method: init.method || 'GET' }); return answer(); },
    }),
  };
  return { env: { WORKSPACE_ADMISSION: ns } as any, calls };
}
const pass = (v: Partial<{ tickets: number; slots: number; audit: number; evicted: number; more: boolean; batches: number }>) =>
  Response.json({ ok: true, value: { tickets: 0, slots: 0, audit: 0, evicted: 0, more: false, batches: 1, now: 1, cutoff: 0, ...v } });

test('the run is due at 03:17 UTC and at no other minute', () => {
  assert.equal(SWARM_RETENTION_CRON, `${SWARM_RETENTION_MINUTE_UTC} ${SWARM_RETENTION_HOUR_UTC} * * *`);
  assert.equal(isSwarmRetentionMinute(at('2026-11-28T03:17:00Z')), true);
  assert.equal(isSwarmRetentionMinute(at('2026-11-28T03:17:59Z')), true);
  for (const iso of ['2026-11-28T03:16:59Z', '2026-11-28T03:18:00Z', '2026-11-28T04:17:00Z', '2026-11-28T15:17:00Z']) {
    assert.equal(isSwarmRetentionMinute(at(iso)), false, iso);
  }
});

test('one POST to the coordinator\'s /retire; what it retired is logged, nothing to retire is quiet', async () => {
  const some = coordinator(() => pass({ tickets: 3, slots: 2, audit: 4, evicted: 1, batches: 2 }));
  assert.deepEqual(await scheduledSwarmRetention(some.env), {
    level: 'info', line: '[cron] swarm retention tickets=3 slots=2 audit=4 evicted=1 batches=2',
  });
  assert.deepEqual(some.calls, [{ name: WORKSPACE_ADMISSION_OBJECT, url: 'https://workspace-admission/retire', method: 'POST' }]);

  const none = coordinator(() => pass({}));
  assert.deepEqual(await scheduledSwarmRetention(none.env), { level: 'quiet', line: '' });
  assert.equal(none.calls.length, 1);

  // A pass that stopped at its batch bound says so, even when this call retired nothing new.
  const more = coordinator(() => pass({ more: true, batches: 5 }));
  assert.deepEqual(await scheduledSwarmRetention(more.env), {
    level: 'info', line: '[cron] swarm retention tickets=0 slots=0 audit=0 evicted=0 batches=5 more',
  });
});

test('a refusal is a warning naming its code, an unbound deployment is quiet, and nothing throws', async () => {
  assert.deepEqual(await scheduledSwarmRetention({} as any), { level: 'quiet', line: '' });
  const down = coordinator(() => new Response('no', { status: 500 }));
  assert.deepEqual(await scheduledSwarmRetention(down.env), { level: 'warn', line: '[cron] swarm retention did not run: admission_unavailable' });
  const clock = coordinator(() => Response.json({ ok: false, status: 503, code: 'clock_regressed', message: 'Swarm retention did not run.', reasons: ['clock_regressed'] }));
  assert.deepEqual(await scheduledSwarmRetention(clock.env), { level: 'warn', line: '[cron] swarm retention did not run: clock_regressed' });
  const thrown = coordinator(() => { throw new Error('network'); });
  assert.deepEqual(await scheduledSwarmRetention(thrown.env), { level: 'warn', line: '[cron] swarm retention did not run: admission_unavailable' });
});

test('the cron handler calls it at 03:17 UTC on every deployment, and every cron table declares it', () => {
  const src = read('cloudflare-worker/src/index.ts');
  const gate = `if (now.getUTCHours() === ${SWARM_RETENTION_HOUR_UTC} && now.getUTCMinutes() === ${SWARM_RETENTION_MINUTE_UTC}) {`;
  const start = src.indexOf(gate);
  assert.ok(start >= 0, 'the 03:17 gate is missing from the cron handler, or is gated on hqCadences');
  const block = src.slice(start, src.indexOf('\n        }\n', start));
  assert.match(block, /await import\('\.\/services\/agents\/swarmRetentionSchedule'\)/);
  assert.match(block, /await scheduledSwarmRetention\(env\)/);
  assert.match(block, /taskFailed\('swarm retention', e\)/);

  assert.ok(CRON_TRIGGERS.some((t) => t.expr === SWARM_RETENTION_CRON), 'CRON_TRIGGERS does not list the retention cron');
  const toml = read('wrangler.toml');
  for (const header of ['[triggers]', '[env.production.triggers]', '[env.preview.triggers]']) {
    const from = toml.indexOf(`\n${header}\n`);
    assert.ok(from >= 0, header);
    const table = toml.slice(from, toml.indexOf(']', toml.indexOf('crons', from)) + 1);
    assert.ok(table.includes(`"${SWARM_RETENTION_CRON}"`), `${header} does not declare ${SWARM_RETENTION_CRON}`);
  }
});
