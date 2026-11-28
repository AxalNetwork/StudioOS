/**
 * D5813 (#5813, D1451 part 3): the member-safe Teams refusal on the
 * authenticated bot read. Only the three allowlisted Teams stages (D5812)
 * become `blocked`; every other value stays null and the raw detail never
 * reaches another member. All links, sessions and values are synthetic; no
 * provider is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, FOUNDER, OTHER } from './_call_audio_fixture.ts';
import { world, post, event, syntheticLink } from './_meeting_bot_fixture.ts';
import { botBlocked, botRow, TEAMS_BLOCKED } from '../src/services/meetingBots.ts';

const REFUSALS = [
  ['platform_blocked@teams_anonymous_blocked', 'guests_off'],
  ['platform_blocked@teams_bot_blocked', 'bot_blocked'],
  ['platform_blocked@teams_captcha', 'captcha'],
] as const;

const read = (w: any, user = FOUNDER) => call(w.env, user, 'GET', `/sessions/${w.session}/bot`);
const pending = (w: any) => Number(w.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'pending'").get().n);

/** A Teams run that reached the lobby, then failed with this detail, as the bot's callback reports a refusal. */
async function refused(detail: string, { platform = 'teams', code = 'runtime_failed' } = {}) {
  const w = world();
  const r = await post(w, { meeting_url: syntheticLink(platform) });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const uid = r.body.bot.uid;
  assert.equal(r.body.bot.blocked, null, 'a run that has not failed is never blocked');
  assert.equal((await event(w, uid, { seq: 1, type: 'status', status: 'waiting_room' })).status, 200);
  assert.equal((await event(w, uid, { seq: 2, type: 'status', status: 'failed', failure_code: code, failure_detail: detail })).status, 200);
  return { w, uid };
}

test('D5813: each recognised Teams refusal is its own member-safe reason on the creator’s read', async () => {
  for (const [detail, reason] of REFUSALS) {
    const { w, uid } = await refused(detail);
    const r = await read(w);
    assert.equal(r.status, 200);
    assert.equal(r.body.bot.status, 'failed');
    assert.equal(r.body.bot.failure_code, 'runtime_failed');
    assert.equal(r.body.bot.blocked, reason, detail);
    assert.equal(r.body.bot.failure_category, null, 'the runtime reported: a provider refusal, not the service');
    // No link, no provider page and no encrypted column in the reply.
    const text = JSON.stringify(r.body);
    assert.equal(text.includes(syntheticLink('teams')), false);
    assert.equal(text.includes('meeting_url'), false);
    // Token settlement is the existing one: the hold is settled, nothing stays pending.
    const run = (await botRow(w.env, uid))!;
    assert.ok(run.reservation_uid, 'the run took its hold');
    assert.equal(w.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid = ?').get(run.reservation_uid).status, 'settled');
    assert.notEqual(run.settled_at, null);
    assert.equal(pending(w), 0);
    assert.ok(w.stops.includes(uid), 'the runtime is stopped');
  }
});

test('D5813: every other detail stays generic — unknown Teams stages, a lobby timeout, other platforms, other codes', async () => {
  const cases: Array<[string, { platform?: string; code?: string }]> = [
    ['platform_blocked@teams_unknown', {}],
    ['platform_blocked@teams_prejoin', {}],
    ['platform_blocked@teams_captcha:retry', {}],
    ['platform_blocked@teams_guests_off', {}],
    ['platform_blocked', {}],
    ['link_invalid@teams_not_found', {}],
    // The lobby timeout: a Teams stage, but not a refusal, and stored under its own code.
    ['not_admitted@teams_lobby', { code: 'admission_refused' }],
    // The right stage on another platform, or under another code, is not a Teams refusal.
    ['platform_blocked@teams_captcha', { platform: 'google_meet' }],
    ['platform_blocked@teams_captcha', { code: 'admission_refused' }],
  ];
  for (const [detail, opts] of cases) {
    const { w } = await refused(detail, opts);
    const r = await read(w);
    assert.equal(r.status, 200);
    assert.equal(r.body.bot.status, 'failed');
    assert.equal(r.body.bot.blocked, null, `${detail} ${JSON.stringify(opts)}`);
  }
  // A sentence a provider page might carry is not stored, so it can never become a reason.
  const { w } = await refused('Your organization does not allow anonymous users https://example.invalid');
  assert.equal(w.db.prepare('SELECT failure_detail FROM meeting_bots').get().failure_detail, null);
  assert.equal((await read(w)).body.bot.blocked, null);
});

test('D5813: another member’s read of the session is 404, with no reason, code or detail', async () => {
  const { w } = await refused('platform_blocked@teams_captcha');
  w.db.prepare("UPDATE users SET role='admin',founder_id=100 WHERE id=?").run(OTHER);
  const r = await read(w, OTHER);
  assert.equal(r.status, 404);
  const text = JSON.stringify(r.body);
  for (const word of ['captcha', 'teams_', 'blocked', 'runtime_failed', 'failure_detail']) assert.equal(text.includes(word), false, word);
  // Nor can the other member stop or re-send the bot to that session.
  assert.equal((await call(w.env, OTHER, 'POST', `/sessions/${w.session}/bot/stop`, {})).status, 404);
  assert.equal((await call(w.env, OTHER, 'POST', `/sessions/${w.session}/bot`, { meeting_url: syntheticLink('teams') })).status, 404);
});

test('D5813: a retried or late callback leaves one terminal state and the first reason', async () => {
  const { w, uid } = await refused('platform_blocked@teams_bot_blocked');
  // The same event again is a duplicate; a new failure after the end is refused.
  const again = await event(w, uid, { seq: 2, type: 'status', status: 'failed', failure_code: 'runtime_failed', failure_detail: 'platform_blocked@teams_bot_blocked' });
  assert.equal(again.body.duplicate, true);
  const late = await event(w, uid, { seq: 3, type: 'status', status: 'failed', failure_code: 'runtime_failed', failure_detail: 'platform_blocked@teams_captcha' });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'bot_finished');
  for (let i = 0; i < 2; i += 1) {
    const r = await read(w);
    assert.equal(r.body.bot.status, 'failed');
    assert.equal(r.body.bot.blocked, 'bot_blocked');
  }
  assert.equal(Number(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bots WHERE session_id = ?').get(w.session).n), 1);
  assert.equal(pending(w), 0);

  // The member stopped the run while it waited; the bot's late refusal does not turn a stop into a refusal.
  const s = world();
  const sent = await post(s, { meeting_url: syntheticLink('teams') });
  await event(s, sent.body.bot.uid, { seq: 1, type: 'status', status: 'waiting_room' });
  assert.equal((await call(s.env, FOUNDER, 'POST', `/sessions/${s.session}/bot/stop`, {})).status, 200);
  await event(s, sent.body.bot.uid, { seq: 2, type: 'status', status: 'stopped' });
  const after = await event(s, sent.body.bot.uid, { seq: 3, type: 'status', status: 'failed', failure_code: 'runtime_failed', failure_detail: 'platform_blocked@teams_captcha' });
  assert.equal(after.status, 409);
  const stopped = await read(s);
  assert.equal(stopped.body.bot.status, 'stopped');
  assert.equal(stopped.body.bot.blocked, null);
  assert.equal(pending(s), 0);
});

test('D5813: after a refusal the member still reaches their original interview and its sessions', async () => {
  const { w } = await refused('platform_blocked@teams_anonymous_blocked');
  const interview = Number(w.db.prepare('SELECT interview_id FROM interview_sessions WHERE id = ?').get(w.session).interview_id);
  const list = await call(w.env, FOUNDER, 'GET', `/interviews/${interview}/sessions`);
  assert.equal(list.status, 200);
  assert.ok(JSON.stringify(list.body).includes(`"id":${w.session}`), 'the refused session is still listed on its interview');
  assert.equal((await call(w.env, FOUNDER, 'GET', `/sessions/${w.session}`)).status, 200);
});

test('D5813: sending again after a refusal shows only the newest run, and its own terminal state', async () => {
  const { w, uid } = await refused('platform_blocked@teams_captcha');
  // The first run ended a moment ago (the read orders by creation time).
  w.db.prepare('UPDATE meeting_bots SET created_at = created_at - 1000 WHERE uid = ?').run(uid);
  const again = await post(w, { meeting_url: syntheticLink('teams') });
  assert.equal(again.status, 202, 'nothing was recorded, so the draft session takes another send');
  assert.notEqual(again.body.bot.uid, uid);
  let r = await read(w);
  assert.equal(r.body.bot.uid, again.body.bot.uid);
  assert.equal(r.body.bot.status, 'joining');
  assert.equal(r.body.bot.blocked, null, 'the earlier refusal is not carried onto the new run');
  await event(w, again.body.bot.uid, { seq: 1, type: 'status', status: 'waiting_room' });
  await event(w, again.body.bot.uid, { seq: 2, type: 'status', status: 'failed', failure_code: 'runtime_failed', failure_detail: 'platform_blocked@teams_anonymous_blocked' });
  r = await read(w);
  assert.equal(r.body.bot.uid, again.body.bot.uid);
  assert.equal(r.body.bot.blocked, 'guests_off');
  assert.equal(pending(w), 0, 'both runs settled their holds');
  assert.equal(Number(w.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'settled'").get().n), 2);
});

test('D5813: botBlocked reads only exact allowlisted details on a failed Teams runtime failure', () => {
  for (const [detail, reason] of REFUSALS) {
    assert.equal(TEAMS_BLOCKED[detail], reason);
    assert.equal(botBlocked({ platform: 'teams', status: 'failed', failure_code: 'runtime_failed', failure_detail: detail }), reason);
    for (const status of ['joining', 'waiting_room', 'recording', 'processing', 'done', 'stopped'] as const) {
      assert.equal(botBlocked({ platform: 'teams', status, failure_code: 'runtime_failed', failure_detail: detail }), null, status);
    }
    assert.equal(botBlocked({ platform: 'zoom', status: 'failed', failure_code: 'runtime_failed', failure_detail: detail }), null);
    assert.equal(botBlocked({ platform: 'teams', status: 'failed', failure_code: 'runtime_unavailable', failure_detail: detail }), null);
    assert.equal(botBlocked({ platform: 'teams', status: 'failed', failure_code: 'runtime_failed', failure_detail: detail.toUpperCase() }), null);
    assert.equal(botBlocked({ platform: 'teams', status: 'failed', failure_code: 'runtime_failed', failure_detail: ` ${detail}` }), null);
  }
  for (const detail of [undefined, null, '', 'toString', '__proto__', 'constructor', 42]) {
    assert.equal(botBlocked({ platform: 'teams', status: 'failed', failure_code: 'runtime_failed', failure_detail: detail }), null, String(detail));
  }
});
