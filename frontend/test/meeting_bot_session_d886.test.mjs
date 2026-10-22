import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as model from '../src/pages/founder/meetingBotSession.js';

const at = Date.UTC(2026, 0, 1);
// Synthetic links only. Assertions never print link payloads.
const link = 'https://meet.google.com/aaa-bbbb-ccc';
const options = { meetingUrl: link, consentGiven: true };
const answer = (status, extra = {}) => ({ bot: { status, ...extra } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const scenarios = {
  'supported links offer bot first and device second; other links keep device capture'(m) {
    for (const [url, platform] of [
      ['https://zoom.us/j/00000000000', 'zoom'],
      ['https://example.zoom.us/j/00000000000', 'zoom'],
      [link, 'google_meet'],
      ['https://teams.microsoft.com/l/meetup-join/fixture', 'teams'],
      ['https://teams.live.com/meet/fixture', 'teams'],
    ]) {
      assert.equal(m.botPlatform(url), platform);
      assert.deepEqual(m.botActions(url), { primary: 'Send Eadwyn AI', secondary: 'Record this device' });
    }
    for (const url of [null, '', {}, 'not a link', 'http://meet.google.com/aaa',
      'https://meet.google.com/', 'https://zoom.us.attacker.invalid/j/0',
      'https://attacker.invalid/meet.google.com', 'https://user@meet.google.com/aaa',
      'https://user:password@meet.google.com/aaa', 'https://:password@meet.google.com/aaa', 'https://meet.google.com:444/aaa']) {
      assert.equal(m.botPlatform(url), null);
      assert.deepEqual(m.botActions(url), { primary: 'Record this device', secondary: null });
    }
  },
  'all eight run states preserve stop, polling and terminal semantics'(m) {
    const states = [
      ['queued', 'Queued', true, true], ['joining', 'Joining the call', true, true],
      ['waiting_room', 'Waiting to be admitted', true, true], ['recording', 'Recording', true, true],
      ['processing', 'Processing the recording', false, true], ['done', 'Done', false, false],
      ['failed', 'Failed', false, false], ['stopped', 'Stopped', false, false],
    ];
    for (const [status, label, canStop, poll] of states) {
      const view = m.botView(answer(status));
      assert.deepEqual([view.state, view.label, view.canStop, view.poll], [status, label, canStop, poll]);
      assert.equal(view.timer, null);
      assert.equal(view.participantCount, null);
      assert.equal(typeof view.failure, status === 'failed' ? 'string' : 'object');
    }
  },
  'loading, missing, unknown and unreadable are distinct; counts are never guessed'(m) {
    assert.equal(m.botView(undefined).state, 'loading');
    assert.equal(m.botView({ bot: null }).state, 'missing');
    for (const read of [null, {}, answer('new_status'), answer('__proto__'), answer('constructor')]) {
      assert.equal(m.botView(read).state, 'unreadable');
      assert.equal(m.botView(read).canStop, false);
    }
    assert.equal(m.botView(answer('recording'), { unreadable: true }).state, 'unreadable');
    for (const count of [null, undefined, -1, 0.5, '2', Infinity]) {
      assert.equal(m.botView(answer('recording', { participant_count: count })).participantCount, null);
    }
    assert.equal(m.botView(answer('recording', { participant_count: 0 })).participantCount, 0);
    assert.equal(m.botView(answer('recording', { participant_count: 3 })).participantCount, 3);
  },
  'recording timer uses server epoch milliseconds and never invents missing time'(m) {
    assert.equal(m.botView(answer('recording', { started_at: at }), { now: at + 61000 }).timer, '01:01');
    assert.equal(m.botView(answer('recording', { started_at: 0 }), { now: 0 }).timer, '00:00');
    assert.equal(m.botView(answer('recording', { started_at: at }), { now: at + 7200000 }).timer, '120:00');
    for (const start of [null, undefined, '0', -1, at + 1]) {
      assert.equal(m.botView(answer('recording', { started_at: start }), { now: at }).timer, null);
    }
    assert.equal(m.botView(answer('done', { started_at: at }), { now: at + 1000 }).timer, null);
  },
  'known failures and refusals have sentences; raw provider content is never echoed'(m) {
    const expected = {
      not_admitted: 'Eadwyn AI was not admitted. Ask the host to check the waiting room.',
      meeting_ended: 'The meeting ended before Eadwyn AI could finish recording.',
      link_invalid: 'Eadwyn AI could not use this meeting link. Check it and try again.',
      platform_blocked: 'The meeting platform did not allow Eadwyn AI to join.',
      obf_unavailable: 'Zoom authorization is required. Reconnect Zoom and join the meeting before sending Eadwyn AI.',
    };
    for (const [code, text] of Object.entries(expected)) assert.equal(m.botView(answer('failed', { failure_code: code })).failure, text);
    for (const code of [null, link, 'constructor', '__proto__']) {
      assert.equal(m.botView(answer('failed', { failure_code: code })).failure, 'Eadwyn AI could not record this call. Check the meeting before trying again.');
      assert.equal(m.botRefusal({ code, message: link }), 'Eadwyn AI could not complete that request. Check the status before trying again.');
    }
    assert.equal(m.botRefusal({ code: 'consent_required' }), 'Record the interviewee’s agreement before sending Eadwyn AI.');
    assert.equal(m.botRefusal({ code: 'unsupported_link' }), 'Use a Zoom, Google Meet or Microsoft Teams meeting link.');
    assert.equal(m.botRefusal({ code: 'bot_already_running' }), 'Eadwyn AI is already assigned to this session. Check its status before trying again.');
    assert.match(m.botRefusal({ status: 402, message: link }), /not enough AI tokens/);
  },
  'dispatch requires saved consent; scheduling defaults on, explicit opt-out sends nothing'(m) {
    for (const consentGiven of [false, undefined, 'true', 1]) {
      const plan = m.botDispatchPlan({ ...options, consentGiven }, at);
      assert.equal(plan.body, null);
      assert.equal(plan.error, m.botRefusal({ code: 'consent_required' }));
    }
    const immediate = m.botDispatchPlan({ ...options, meetingUrl: ` ${link} ` }, at);
    assert.equal(immediate.error, null);
    assert.equal(immediate.body.meeting_url === link, true);
    assert.equal(Object.hasOwn(immediate.body, 'scheduled_at'), false);
    const scheduledAt = new Date(at + 60000).toISOString();
    const plan = m.botDispatchPlan({ ...options, scheduledAt }, at);
    assert.equal(plan.error, null);
    assert.equal(plan.body.scheduled_at, scheduledAt);
    assert.deepEqual(m.botDispatchPlan({ ...options, scheduledAt, autoSend: false }, at), { body: null, error: null });
    assert.notEqual(m.botDispatchPlan({ ...options, autoSend: false }, at).body, null, 'opt-out is per scheduled call');
    assert.equal(m.botDispatchPlan({ ...options, meetingUrl: 'bad' }, at).body, null);
    for (const time of ['', 0, new Date(at).toISOString(), new Date(at - 1).toISOString(),
      new Date(at + 7 * 86400000 + 1).toISOString(), '2026-01-01T00:01:00', 'January 1 2026 00:01:00Z']) {
      const refused = m.botDispatchPlan({ ...options, scheduledAt: time }, at);
      assert.equal(refused.body, null);
      assert.equal(refused.error, 'Choose a call time in the next seven days.');
    }
    assert.notEqual(m.botDispatchPlan({ ...options, scheduledAt: new Date(at + 7 * 86400000).toISOString() }, at).body, null);
  },
  async 'send and Stop use only their bound adapters and share duplicate writes'(m) {
    const calls = [];
    const gate = deferred();
    const session = m.createBotSession({
      getBot: async () => answer('recording'),
      sendBot: async (body) => { calls.push('send'); assert.equal(body.meeting_url === link, true); return answer('joining'); },
      stopBot: () => { calls.push('stop'); return calls.includes('send') ? gate.promise : Promise.resolve(answer('stopped')); }, now: () => at,
    });
    assert.equal(await session.stop(), false);
    assert.equal(await session.send({ ...options, consentGiven: false }), false);
    assert.equal(calls.length, 0);
    assert.equal(await session.send(options), true);
    assert.equal(session.getSnapshot().read.bot.status, 'joining');
    const first = session.stop();
    assert.equal(session.stop(), first);
    assert.equal(session.getSnapshot().busy, 'stop');
    assert.equal(await session.refresh(), false);
    await Promise.resolve();
    assert.deepEqual(calls, ['send', 'stop']);
    gate.resolve(answer('stopped'));
    assert.equal(await first, true);
    assert.equal(session.getSnapshot().read.bot.status, 'stopped');
    assert.equal(session.getSnapshot().busy, null);
    assert.equal(await session.stop(), false);
    assert.deepEqual(calls, ['send', 'stop']);
  },
  async 'refusals do not retry or start a device recorder; read errors disable Stop'(m) {
    let writes = 0;
    const session = m.createBotSession({ getBot: async () => { throw Error('private'); },
      sendBot: () => { writes++; throw { code: 'consent_required', message: link }; }, stopBot: () => { writes++; } });
    assert.equal(await session.send(options), false);
    assert.equal(writes, 1);
    assert.equal(session.getSnapshot().error, m.botRefusal({ code: 'consent_required' }));
    assert.equal(session.getSnapshot().busy, null);
    assert.equal(await session.refresh(), false);
    assert.equal(session.getSnapshot().unreadable, true);
    assert.equal(await session.stop(), false);
    assert.equal(writes, 1);
  },
  async 'old reads cannot overwrite an action result or a newer read'(m) {
    const gates = [deferred(), deferred(), deferred()];
    let count = 0;
    const session = m.createBotSession({ getBot: () => gates[count++].promise,
      sendBot: async () => answer('joining'), stopBot: async () => answer('stopped'), now: () => at });
    const stale = session.refresh();
    assert.equal(await session.send(options), true);
    gates[0].resolve(answer('done'));
    assert.equal(await stale, false);
    assert.equal(session.getSnapshot().read.bot.status, 'joining');
    const older = session.refresh();
    const newer = session.refresh();
    gates[2].resolve(answer('recording'));
    assert.equal(await newer, true);
    gates[1].reject(Error('private'));
    assert.equal(await older, false);
    assert.equal(session.getSnapshot().unreadable, false);
    assert.equal(session.getSnapshot().read.bot.status, 'recording');
  },
  async 'malformed answers are unreadable and a later valid read recovers'(m) {
    let value;
    const session = m.createBotSession({ getBot: async () => value, sendBot: async () => value, now: () => at });
    for (value of [undefined, {}, answer('new_status')]) {
      assert.equal(await session.refresh(), false);
      assert.equal(session.getSnapshot().unreadable, true);
    }
    value = { bot: null };
    assert.equal(await session.refresh(), true);
    assert.equal(session.getSnapshot().unreadable, false);
    assert.equal(await session.send(options), false, 'a dispatch cannot succeed with no bot');
    assert.equal(session.getSnapshot().unreadable, true);
    value = answer('done');
    assert.equal(await session.refresh(), true);
    assert.equal(session.getSnapshot().unreadable, false);
  },
  async 'scheduled opt-out and disposal never dispatch; late answers cannot notify'(m) {
    const gate = deferred();
    let writes = 0, notifications = 0;
    const session = m.createBotSession({ getBot: () => gate.promise,
      sendBot: () => { writes++; return answer('joining'); }, changed: () => { notifications++; }, now: () => at });
    assert.equal(await session.send({ ...options, scheduledAt: new Date(at + 60000).toISOString(), autoSend: false }), false);
    assert.equal(writes, 0);
    const reading = session.refresh();
    session.dispose();
    gate.resolve(answer('recording'));
    assert.equal(await reading, false);
    assert.equal(notifications, 0);
    assert.equal(await session.send(options), false);
    assert.equal(await session.refresh(), false);
    assert.equal(await session.stop(), false);
    assert.equal(writes, 0);
    const other = m.createBotSession({ sendBot: () => { writes++; return answer('joining'); } });
    const sending = other.send(options);
    other.dispose();
    assert.equal(await sending, false);
    assert.equal(writes, 0);
  },
};

for (const [name, scenario] of Object.entries(scenarios)) test(name, () => scenario(model));

// Each isolated mutation runs the same behavioral scenarios; no source-copy
// assertion can substitute for a broken gate actually failing its contract.
const mutations = [
  ["url.protocol !== 'https:'", 'false'],
  ['url.username ||', 'false ||'], ['url.password ||', 'false ||'], ['url.port ||', 'false ||'],
  ["url.pathname === '/'", 'false'], ["host.endsWith('.zoom.us')", "host.includes('zoom.us')"],
  ["return 'google_meet'", "return 'teams'"], ["return 'teams'", 'return null'],
  ["secondary: 'Record this device'", 'secondary: null'],
  ["const STOPPABLE = new Set(['queued', 'joining', 'waiting_room', 'recording'])", "const STOPPABLE = new Set(['processing'])"],
  ["bot.status === 'processing'", "bot.status === 'stopped'"],
  ['if (unreadable)', 'if (false)'], ["if (read?.bot === null)", 'if (false)'],
  ["Object.hasOwn(object, key)", 'key in object'],
  ['bot.participant_count >= 0', 'true'], ['Number.isSafeInteger(bot.participant_count)', 'Number.isFinite(bot.participant_count)'],
  ["bot.status === 'recording' &&", "bot.status === 'done' &&"], ['now >= bot.started_at', 'true'],
  ['Math.floor((now - bot.started_at) / 1000)', 'Math.ceil((now - bot.started_at) / 1000) + 1'],
  ['error?.status === 402', 'error?.status === 403'],
  ['consentGiven !== true', 'consentGiven === true'],
  ['scheduledAt !== null && autoSend === false', 'autoSend === false'],
  ['if (!botPlatform(meetingUrl))', 'if (false)'], ['at <= now', 'at < now'],
  ['at - now > 7 * 86400000', 'at - now >= 7 * 86400000'],
  ['if (disposed || pending) return false', 'if (disposed) return false'],
  ['ticket !== revision', 'false'],
  ['if (pending) return pending', 'if (false) return pending'],
  ['if (!read?.bot ||', 'if (false ||'],
  ['disposed ? undefined : invoke()', 'invoke()'],
  ['stopBot()', 'getBot()'],
  ["if (!botView(snapshot.read, { unreadable: snapshot.unreadable }).canStop)", 'if (false)'],
];
const source = await readFile(new URL('../src/pages/founder/meetingBotSession.js', import.meta.url), 'utf8');
for (const [index, [before, after]] of mutations.entries()) {
  test(`isolated mutation ${index + 1} is caught`, async () => {
    assert.equal(source.includes(before), true, 'mutation target exists');
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(source.replaceAll(before, after)).toString('base64')}#${index}`);
    let caught = false;
    for (const scenario of Object.values(scenarios)) {
      try { await scenario(mutant); } catch { caught = true; break; }
    }
    assert.equal(caught, true, 'broken behavior must fail a scenario');
  });
}
