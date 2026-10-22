/** D886 B10: pure count-only projection contract while B1 builds its store.
 * No provider calls, real meetings or invented production schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as ops from '../src/services/meetingBotOperations.ts';
import type { BotOperationsRun } from '../src/services/meetingBotOperations.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const NOW = Date.parse('2026-10-22T18:00:00Z');
const DAY = 86_400_000;
const at = (delta: number) => new Date(NOW + delta).toISOString();
const row = (changes: Partial<BotOperationsRun> = {}): BotOperationsRun => ({
  platform: 'zoom', status: 'done', created_at: at(-60_000), ended_at: at(-1000), failure_code: null,
  minutes: 2, runtime_seconds: 180, provider_cost_microusd: 80, charged_microusd: 100, heartbeat_due_at: null, ...changes,
});
const report = (rows: BotOperationsRun[], api = ops) => {
  const out = api.meetingBotOperations({ state: 'ok', runs: rows }, NOW);
  assert.equal(out.state, 'ok');
  if (out.state !== 'ok') throw new Error('expected complete read');
  return out;
};

function windows(api = ops) {
  const out = report([
    row({ created_at: '2026-10-22 00:00:00', platform: 'teams', status: 'queued', ended_at: null, minutes: 0 }),
    row({ created_at: '2026-10-21T23:59:59Z', platform: 'google_meet' }),
    row({ created_at: at(-7 * DAY) }), row({ created_at: at(-7 * DAY - 1) }),
    row({ created_at: at(-30 * DAY) }), row({ created_at: at(-30 * DAY - 1) }),
  ], api);
  assert.deepEqual([out.today.runs, out.days7.runs, out.days30.runs], [1, 3, 5]);
  assert.equal(out.today.platforms.find(p => p.platform === 'teams')!.statuses.queued, 1);
  assert.equal(out.today.platforms.find(p => p.platform === 'zoom')!.runs, 0);
  assert.equal(out.days7.platforms.find(p => p.platform === 'google_meet')!.statuses.done, 1);
  assert.equal(out.today.from, '2026-10-22T00:00:00.000Z');
  assert.equal(out.days7.to, at(0));
}

function missing(api = ops) {
  const empty = report([], api);
  assert.equal(empty.today.runs, 0);
  assert.equal(empty.today.recorded_minutes, 0);
  assert.equal(empty.today.financials.realised_margin_bps, null);
  assert.deepEqual(empty.alerts, []);
  for (const state of ['not_recorded', 'unreadable'] as const) {
    const r = api.meetingBotOperations({ state }, NOW);
    assert.equal(r.state, state);
    assert.deepEqual(Object.keys(r).sort(), ['as_of', 'reason', 'state']);
  }
  for (const changes of [
    { platform: 'unknown' }, { status: 'unknown' }, { created_at: 'not-a-date' },
    { created_at: '2026-10-22T17:00:00' }, { created_at: at(1) },
    { ended_at: at(1) }, { ended_at: at(-120_000) },
  ]) assert.equal(api.meetingBotOperations({ state: 'ok', runs: [row(changes as any)] }, NOW).state, 'unreadable');
  const partial = report([row(), row({ minutes: null, charged_microusd: null })], api);
  assert.equal(partial.today.recorded_minutes, null);
  assert.equal(partial.today.measured_minutes_runs, 1);
  assert.equal(partial.today.financials.provider_cost_microusd, 160);
  assert.equal(partial.today.financials.charged_microusd, null);
  assert.equal(partial.today.financials.realised_margin_bps, null);
  assert.equal(partial.today.financials.measured_runs, 1);
  assert.deepEqual(partial.alerts, []);
}

function finance(api = ops) {
  const f = api.botFinancials([row()]);
  assert.equal(f.target_markup_bps, 2500);
  assert.equal(f.target_gross_margin_bps, 2000);
  assert.equal(f.realised_margin_bps, 2000);
  assert.equal(f.cost_per_bot_hour_microusd, 1600, '180 runtime seconds, not 2 recorded minutes');
  assert.equal(api.botFinancials([row({ runtime_seconds: null })]).cost_per_bot_hour_microusd, null);
  assert.equal(api.botFinancials([row({ runtime_seconds: 0 })]).cost_per_bot_hour_microusd, null);
  assert.equal(api.botFinancials([row({ charged_microusd: 0, provider_cost_microusd: 0 })]).realised_margin_bps, null);
  assert.equal(api.botFinancials([row({ status: 'recording', ended_at: null })]).terminal_runs, 0);
  const pendingCost = api.botFinancials([row({ provider_cost_microusd: null })]);
  assert.equal(pendingCost.charged_microusd, 100, 'known settled charges remain visible while supplier cost waits');
  assert.equal(pendingCost.provider_cost_microusd, null);
  assert.equal(pendingCost.realised_margin_bps, null);
  assert.deepEqual([pendingCost.measured_cost_runs, pendingCost.measured_charge_runs], [0, 1]);
  for (const value of [-1, NaN, Infinity, 1.5, '80', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(api.botFinancials([row({ provider_cost_microusd: value as any })]).provider_cost_microusd, null);
  }
  assert.equal(api.botFinancials([row({ provider_cost_microusd: Number.MAX_SAFE_INTEGER }), row()]).provider_cost_microusd, null);
}

function thresholds(api = ops) {
  const cohort = (failed: number, done: number) => [
    ...Array.from({ length: failed }, () => row({ status: 'failed', failure_code: 'join_timeout' })),
    ...Array.from({ length: done }, () => row()),
  ];
  assert.equal(api.evaluateBotAlerts(cohort(3, 7), NOW).some(a => a.kind === 'failure_rate'), false, 'exact 30% does not alert');
  const high = api.evaluateBotAlerts([...cohort(4, 6), ...Array.from({ length: 20 }, () => row({ status: 'stopped' })), row({ status: 'recording', ended_at: null })], NOW);
  assert.deepEqual(high.filter(a => a.kind === 'failure_rate'), [{ kind: 'failure_rate', platform: 'zoom', failed: 4, completed: 10, rate_bps: 4000 }]);
  assert.equal(api.evaluateBotAlerts([row({ status: 'failed', ended_at: at(-DAY - 1), created_at: at(-2 * DAY) })], NOW).some(a => a.kind === 'failure_rate'), false);
  assert.equal(api.evaluateBotAlerts([row({ status: 'failed', ended_at: at(-DAY), created_at: at(-2 * DAY) })], NOW).some(a => a.kind === 'failure_rate'), true);
  assert.deepEqual(api.evaluateBotAlerts([row({ provider_cost_microusd: 85 })], NOW), [], 'exact 15% does not alert');
  assert.equal(api.evaluateBotAlerts([row({ provider_cost_microusd: 86 })], NOW).some(a => a.kind === 'low_margin'), true);
  assert.equal(api.evaluateBotAlerts([row({ provider_cost_microusd: 1, charged_microusd: 0 })], NOW).some(a => a.kind === 'low_margin'), true, 'positive cost with zero charge needs an alert');
  assert.equal(api.evaluateBotAlerts([row({ provider_cost_microusd: 1, charged_microusd: 0 })], NOW).find(a => a.kind === 'low_margin')!.margin_bps, null, 'margin with zero revenue is undefined');
  assert.deepEqual(api.evaluateBotAlerts([row({ provider_cost_microusd: 0, charged_microusd: 0 })], NOW), []);
  assert.deepEqual(api.evaluateBotAlerts([row({ provider_cost_microusd: 99 }), row({ charged_microusd: null })], NOW), [], 'unknown bill cannot yield a partial margin');
  assert.deepEqual(api.evaluateBotAlerts([row({ provider_cost_microusd: 99, created_at: at(-8 * DAY), ended_at: at(-7 * DAY - 1) })], NOW), []);
}

function heartbeat(api = ops) {
  const input = [
    row({ status: 'recording', ended_at: null, heartbeat_due_at: at(-1) }),
    row({ status: 'joining', ended_at: null, heartbeat_due_at: at(0) }),
    row({ status: 'waiting_room', ended_at: null, heartbeat_due_at: at(1) }),
    row({ status: 'processing', ended_at: null, heartbeat_due_at: null }),
    row({ status: 'processing', ended_at: at(-1000), heartbeat_due_at: at(-DAY) }),
    row({ status: 'recording', ended_at: null, heartbeat_due_at: null }),
    row({ status: 'done', heartbeat_due_at: at(-DAY) }),
    row({ status: 'queued', ended_at: null, heartbeat_due_at: at(-DAY) }),
  ];
  const out = report(input, api);
  assert.deepEqual(out.alerts.filter(a => a.kind === 'missed_heartbeat'), [{ kind: 'missed_heartbeat', platform: 'zoom', runs: 1 }]);
  assert.equal(out.heartbeat_unknown_runs, 1);
}

function privacy(api = ops) {
  const marker = 'SYNTHETIC_PRIVATE_MARKER';
  const run = { ...row({ status: 'failed', failure_code: marker }), meeting_url: marker, participant_name: marker, transcript: marker, uid: marker };
  const out = report([run], api);
  assert.deepEqual(out.today.failures, [{ platform: 'zoom', code: 'unknown', runs: 1 }]);
  assert.equal(JSON.stringify(out).includes(marker), false);
  assert.deepEqual(report([row({ status: 'failed', failure_code: 'notice_failed' })], api).today.failures,
    [{ platform: 'zoom', code: 'notice_failed', runs: 1 }], 'B1 content-free failure codes remain useful');
  for (const alert of [
    ...out.alerts,
    { kind: 'missed_heartbeat' as const, platform: 'teams' as const, runs: 1, private: marker },
    { kind: 'low_margin' as const, charged_microusd: 100, provider_cost_microusd: 90, margin_bps: 1000, private: marker },
  ]) {
    const n = api.botAlertNotification(1, alert);
    assert.equal(n.userId, 1);
    assert.deepEqual(n.channels, ['in_app']);
    assert.equal(n.link, '/admin/platform/meeting-bots');
    assert.equal(JSON.stringify(n).includes(marker), false);
    assert.equal(n.type, 'meeting_bot_operations');
  }
}

for (const check of [windows, missing, finance, thresholds, heartbeat, privacy]) test('D886 B10: ' + check.name, () => check());

function controlPlaneAdapter(api = ops) {
  const control = { platform: 'teams' as const, status: 'done' as const, failure_code: null,
    created_at: NOW - 500_000, started_at: NOW - 400_000, ended_at: NOW - 100_000, heartbeat_at: NOW - 120_000,
    minutes: 5, rate_per_minute_microusd: 999, meeting_url_enc: 'SYNTHETIC_PRIVATE_MARKER' };
  const readings = { recorded_minutes: null, provider_cost_microusd: null,
    reservation: { status: 'settled', actual_included_microusd: 70, actual_topup_microusd: 30 } };
  const out = api.projectBotOperationsRun(control, readings, 120_000);
  assert.equal(out.created_at, at(-500_000));
  assert.equal(out.heartbeat_due_at, at(0));
  assert.equal(out.runtime_seconds, 300);
  assert.equal(out.minutes, null, 'billed runtime is not recorded audio');
  assert.equal(out.provider_cost_microusd, null, 'a quoted rate is not actual cost');
  assert.equal(out.charged_microusd, 100);
  assert.equal(JSON.stringify(out).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  for (const status of ['pending', 'review']) {
    assert.equal(api.projectBotOperationsRun(control, { ...readings, reservation: { ...readings.reservation, status } }, 120_000).charged_microusd, null);
  }
  const exact = api.projectBotOperationsRun(control, { ...readings, recorded_minutes: 4.5, provider_cost_microusd: 80 }, 120_000);
  assert.deepEqual([exact.minutes, exact.provider_cost_microusd], [4.5, 80]);
  assert.throws(() => api.projectBotOperationsRun({ ...control, created_at: NaN }, readings, 120_000), /timestamp_unreadable/);
  assert.throws(() => api.projectBotOperationsRun(control, readings, -1), /heartbeat_policy_unreadable/);
}
test('D886 B10: adapt B1 clocks and settled charges without inventing audio or supplier cost', () => controlPlaneAdapter());

async function recipients(api = ops) {
  const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  const { DB, db } = makeD1(['users', 'super_admins', 'user_settings'].map(t => tableFromBaseline(baseline, t)).join('\n'));
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const [id, role, active] of [[1, 'admin', 1], [2, 'admin', 1], [3, 'admin', 0], [4, 'founder', 1]]) {
      db.prepare('INSERT INTO users (id, name, email, role, is_active) VALUES (?, ?, ?, ?, ?)').run(id, 'Synthetic', `synthetic${id}@example.test`, role, active);
    }
    // Plain admin 2 lacks elevation; inactive 3 and non-admin 4 have stale rows.
    for (const id of [1, 3, 4]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
    const sent: any[] = [];
    const publish = async (_env: any, args: any) => { sent.push(args); return 42; };
    const env = { DB } as any;
    const alert = { kind: 'missed_heartbeat' as const, platform: 'teams' as const, runs: 1 };
    assert.deepEqual(await api.sendMeetingBotAlert(env, alert, publish), { recipients: 1, recorded: 1 });
    assert.deepEqual(sent.map(a => a.userId), [1]);
    sent.length = 0;
    assert.deepEqual(await api.sendMeetingBotAlert({ ...env, BRANCH_CODE: 'fr' }, alert, publish), { recipients: 0, recorded: 0 });
    assert.deepEqual(sent, []);
    assert.deepEqual(await api.sendMeetingBotAlert(env, alert, async () => null), { recipients: 1, recorded: 0 }, 'a failed or opted-out inbox is not confirmed delivery');
    const broken = { DB: { prepare() { throw new Error('synthetic_read_failure'); } } } as any;
    await assert.rejects(() => api.sendMeetingBotAlert(broken, alert, publish), /synthetic_read_failure/);
    const incomplete = { DB: { prepare: () => ({ all: async () => ({ success: false, results: [] }) }) } } as any;
    await assert.rejects(() => api.sendMeetingBotAlert(incomplete, alert, publish), /meeting_bot_recipients_unreadable/);
    db.prepare('INSERT INTO super_admins (user_id) VALUES (2)').run();
    const attempted: number[] = [];
    await assert.doesNotReject(async () => {
      const result = await api.sendMeetingBotAlert(env, alert, async (_env, args) => {
        attempted.push(args.userId);
        if (args.userId === 1) throw new Error('synthetic_delivery_failure');
        return 42;
      });
      assert.deepEqual(result, { recipients: 2, recorded: 1 });
    });
    assert.deepEqual(attempted.sort(), [1, 2]);
  } finally { db.close(); }
}
test('D886 B10: only active HQ Super Admins receive alerts; failed reads remain failed', () => recipients());

test('D886 B10: existing notification inbox receives the count-only alert', async (t) => {
  const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  const { DB, db } = makeD1(['users', 'super_admins', 'user_settings'].map(k => tableFromBaseline(baseline, k)).join('\n'));
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(readFileSync(new URL('../sql/migrations/302_push_subscriptions.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users (id, name, email, role, is_active) VALUES (1, 'Synthetic', 'synthetic@example.test', 'admin', 1)").run();
  db.prepare('INSERT INTO super_admins (user_id) VALUES (1)').run();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('provider_calls_forbidden'); });
  const PIPELINE_ROOM = { idFromName: (name: string) => name, get: () => ({ fetch: async () => new Response('ok') }) };
  const result = await ops.sendMeetingBotAlert({ DB, PIPELINE_ROOM } as any, { kind: 'missed_heartbeat', platform: 'zoom', runs: 2 });
  assert.deepEqual(result, { recipients: 1, recorded: 1 });
  const stored = db.prepare('SELECT user_id, type, title, body, payload FROM notifications_inbox').all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].user_id, 1);
  assert.equal(stored[0].type, 'meeting_bot_operations');
  assert.deepEqual(JSON.parse(stored[0].payload), { kind: 'missed_heartbeat', platform: 'zoom', runs: 2 });
});

let sequence = 0;
async function mutant(before: string, after: string): Promise<typeof ops> {
  const source = readFileSync(new URL('../src/services/meetingBotOperations.ts', import.meta.url), 'utf8');
  assert.ok(source.includes(before), 'mutation target must exist');
  let changed = stripTypeScriptTypes(source.replace(before, () => after), { mode: 'strip' });
  changed = changed.replace(/(from\s*['"])(\.[^'"]+)(['"])/g,
    (_m, prefix, spec, quote) => prefix + new URL(spec + '.ts', new URL('../src/services/meetingBotOperations.ts', import.meta.url)).href + quote);
  return import('data:text/javascript;base64,' + Buffer.from(changed + '\n// mutant ' + ++sequence).toString('base64'));
}
for (const [name, before, after, check] of [
  ['7-day window widened', 'now - 7 * DAY, now), days30:', 'now - 8 * DAY, now), days30:', windows],
  ['window boundary excluded', 'n >= from && n <= to', 'n > from && n <= to', windows],
  ['partial minutes become zero', 'minutes.length === cohort.length ? total(minutes.map(r => r.minutes!)) : null', 'total(minutes.map(r => r.minutes!))', missing],
  ['partial finance accepted', 'charges.length === ended.length', 'charges.length > 0', missing],
  ['markup mistaken for margin', 'target_gross_margin_bps: 2000,', 'target_gross_margin_bps: 2500,', finance],
  ['audio minutes price runtime', 'cost * 3600 / seconds', 'cost * 60 / ended.reduce((sum, r) => sum + (r.minutes ?? 0), 0)', finance],
  ['exact 30% alerts', 'failed * 10 > completed.length * 3', 'failed * 10 >= completed.length * 3', thresholds],
  ['stops dilute failure rate', "(r.status === 'done' || r.status === 'failed')", "TERMINAL.has(r.status)", thresholds],
  ['exact 15% alerts', '* 100n < BigInt(charged) * 15n', '* 100n <= BigInt(charged) * 15n', thresholds],
  ['zero charge ignored', '(charged === 0 && cost > 0)', '(false)', thresholds],
  ['heartbeat boundary early', 'stamp(r.heartbeat_due_at) < now', 'stamp(r.heartbeat_due_at) <= now', heartbeat],
  ['terminal heartbeat alerted', "HEARTBEAT.has(r.status) && stamp(r.heartbeat_due_at) < now", "stamp(r.heartbeat_due_at) < now", heartbeat],
  ['raw error code leaks', "BOT_FAILURE_CODES.includes(raw as BotFailureCode) ? raw as BotFailureCode : 'unknown'", "raw as BotFailureCode", privacy],
  ['processing gets runtime heartbeat alert', "new Set<BotStatus>(['joining', 'waiting_room', 'recording'])", "new Set<BotStatus>(['joining', 'waiting_room', 'recording', 'processing'])", heartbeat],
  ['adapter omits heartbeat grace', 'iso(run.heartbeat_at + heartbeatGraceMs)', 'iso(run.heartbeat_at)', controlPlaneAdapter],
  ['adapter bills pending hold', "(ledger.status === 'settled' || ledger.status === 'refunded')", 'true', controlPlaneAdapter],
  ['adapter substitutes runtime for audio', 'measured(measurements.recorded_minutes) ? measurements.recorded_minutes : null', 'run.ended_at !== null && run.started_at !== null ? (run.ended_at - run.started_at) / 60_000 : null', controlPlaneAdapter],
] as const) test('D886 B10 mutation: ' + name, async () => {
  check();
  const changed = await mutant(before, after);
  assert.throws(() => check(changed), { name: 'AssertionError' });
  check();
});
for (const [name, before, after] of [
  ['branch receives HQ alerts', 'if (branchOf(env)) return { recipients: 0, recorded: 0 };', ''],
  ['plain admin receives alert', 'JOIN users u ON u.id = s.user_id', 'JOIN users u ON 1 = 1'],
  ['inactive recipient allowed', "u.is_active = 1 AND u.role = 'admin'", "u.role = 'admin'"],
  ['non-admin recipient allowed', "u.is_active = 1 AND u.role = 'admin'", 'u.is_active = 1'],
  ['failed delivery counted', 'if (id !== null) recorded++;', 'recorded++;'],
  ['failed recipient read hidden', "success === false || !Array.isArray(result.results)", '!Array.isArray(result.results)'],
  ['delivery failure aborts fanout', 'catch { /* A failed recipient', 'catch (error) { throw error; /* A failed recipient'],
] as const) test('D886 B10 mutation: ' + name, async () => {
  await recipients();
  const changed = await mutant(before, after);
  await assert.rejects(() => recipients(changed), { name: 'AssertionError' });
  await recipients();
});
