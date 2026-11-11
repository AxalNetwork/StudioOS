/**
 * D1451 (#5297): the Teams switch. The link-parser parity table is
 * frontend/test/meeting_bot_teams_hosts_d1451.test.mjs, the one runner that
 * imports the Worker, the frontend and the bot's parsers together.
 * All links are synthetic; no provider is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDER } from './_call_audio_fixture.ts';
import { world, post } from './_meeting_bot_fixture.ts';
import { botAvailability, botConfigured } from '../src/services/meetingBots.ts';

const TEAMS_LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_synthetic%40thread.v2/0';

test('D1451 switch: Teams is off unless MEETING_BOT_TEAMS is exactly "on"; Meet is unaffected', async () => {
  const w = world();
  delete w.env.MEETING_BOT_TEAMS;
  const user = w.db.prepare('SELECT * FROM users WHERE id = ?').get(FOUNDER) as any;
  let out = await botAvailability(w.env, user);
  assert.equal(out.platforms.teams, false);
  assert.equal(out.platforms.google_meet, true);
  assert.equal(out.available, true);
  for (const value of ['off', 'ON', 'true', '1', ' on']) {
    w.env.MEETING_BOT_TEAMS = value;
    assert.equal(botConfigured(w.env, 'teams'), false, value);
    assert.equal((await botAvailability(w.env, user)).platforms.teams, false, value);
  }
  w.env.MEETING_BOT_TEAMS = 'on';
  out = await botAvailability(w.env, user);
  assert.equal(out.platforms.teams, true);
  assert.equal(out.platforms.google_meet, true);
  // The switch never turns the bot on by itself.
  w.env.MEETING_BOT = 'off';
  assert.equal((await botAvailability(w.env, user)).platforms.teams, false);
});

test('D1451 switch: a Teams send with the switch off is refused before any run or hold', async () => {
  const w = world();
  delete w.env.MEETING_BOT_TEAMS;
  const r = await post(w, { meeting_url: TEAMS_LINK });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'bot_unavailable');
  assert.equal(JSON.stringify(r.body).includes(TEAMS_LINK), false);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bots').get().n, 0);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 0);
  assert.equal(w.starts.length, 0);
  assert.equal(w.db.prepare("SELECT submitted_via FROM interview_sessions WHERE id = ?").get(w.session).submitted_via === 'meeting_bot', false);
  // Meet on the same session still goes.
  const meet = await post(w, { meeting_url: 'https://meet.google.com/abc-defg-hij' });
  assert.equal(meet.status, 202);
  assert.equal(meet.body.bot.platform, 'google_meet');
});

test('D1451 switch: with it on, the same Teams send is queued', async () => {
  const w = world();
  w.env.MEETING_BOT_TEAMS = 'on';
  const r = await post(w, { meeting_url: TEAMS_LINK });
  assert.equal(r.status, 202);
  assert.equal(r.body.bot.platform, 'teams');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bots').get().n, 1);
});
