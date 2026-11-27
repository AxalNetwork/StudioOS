/**
 * D1451 (#5297): one set of Teams hosts in every link parser — the Worker's
 * dispatch, session setup and Graph meeting parsers, the frontend's Send and
 * link checks, and the bot's own join rule. All links are synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { botPlatform } from '../../cloudflare-worker/src/services/meetingBots.ts';
import { callRefusal } from '../../cloudflare-worker/src/services/sessionSetup.ts';
import { teamsJoinUrl as graphJoinUrl } from '../../cloudflare-worker/src/services/channels/teamsMeet.ts';
import { botPlatform as frontendBotPlatform } from '../src/pages/founder/meetingBotSession.js';
import { meetingLinkProblem, meetingHref } from '../src/pages/founder/recordSetup.js';
import { teamsJoinUrl as botJoinUrl } from '../../meeting-bot/src/adapters/teamsSelectors.ts';

const TEAMS_LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_synthetic%40thread.v2/0';

/**
 * One table of links, every parser. Each parser keeps its own path rule; the
 * table uses only links whose path every parser accepts, so a disagreement is
 * a host (or scheme) disagreement.
 */
const LINKS = [
  [TEAMS_LINK, true],
  ['https://teams.microsoft.com/meet/1234567890123?p=SyntheticPass', true],
  ['https://teams.cloud.microsoft/l/meetup-join/19%3ameeting_synthetic%40thread.v2/0', true],
  ['https://teams.cloud.microsoft/meet/1234567890123?p=SyntheticPass', true],
  ['https://teams.live.com/meet/9876543210987?p=SyntheticPass', true],
  ['https://TEAMS.Cloud.Microsoft/meet/1234567890123', true],
  ['http://teams.microsoft.com/meet/1234567890123', false],
  ['http://teams.cloud.microsoft/meet/1234567890123', false],
  ['https://evilteams.microsoft.com/meet/1234567890123', false],
  ['https://teams.microsoft.com.attacker.invalid/meet/1234567890123', false],
  ['https://teams.cloud.microsoft.attacker.invalid/meet/1234567890123', false],
  ['https://evil-teams.cloud.microsoft/meet/1234567890123', false],
  ['https://teams.live.com.attacker.invalid/meet/1234567890123', false],
  ['https://user@teams.microsoft.com/meet/1234567890123', false],
  ['https://user:pw@teams.microsoft.com/meet/1234567890123', false],
  ['https://:pw@teams.microsoft.com/meet/1234567890123', false],
  ['https://teams.microsoft.com@attacker.invalid/meet/1234567890123', false],
  ['https://attacker.invalid/teams.microsoft.com/meet/1234567890123', false],
  ['https://gov.teams.microsoft.us/meet/1234567890123', false],
  ['https://meet.google.com/abc-defg-hij', false],
  ['https://unit.zoom.us/j/111111111', false],
];

const PARSERS = {
  'worker botPlatform': (link) => { try { return botPlatform(link).platform === 'teams'; } catch { return false; } },
  'worker sessionSetup callRefusal': (link) => callRefusal('video', 'teams', link) === null,
  'worker teamsMeet teamsJoinUrl': (link) => graphJoinUrl(link) !== null,
  'frontend meetingBotSession botPlatform': (link) => frontendBotPlatform(link) === 'teams',
  'frontend recordSetup meetingLinkProblem': (link) => meetingLinkProblem('teams', link) === null,
  'frontend recordSetup meetingHref': (link) => meetingHref('teams', link) !== null,
  'bot teamsJoinUrl': (link) => botJoinUrl(link) !== null,
};

test('D1451 parity: every Teams link parser accepts the same three hosts and nothing else', () => {
  assert.ok(LINKS.length >= 12);
  const failures = [];
  for (const [link, teams] of LINKS) {
    for (const [name, accepts] of Object.entries(PARSERS)) {
      if (accepts(link) !== teams) failures.push(`${name} ${teams ? 'refused' : 'accepted'} ${link}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('D1451 parity: each of the three hosts is accepted by every parser (a host dropped anywhere fails)', () => {
  for (const host of ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']) {
    const link = `https://${host}/meet/1234567890123`;
    for (const [name, accepts] of Object.entries(PARSERS)) assert.equal(accepts(link), true, `${name}: ${host}`);
  }
  // The bot opens the cloud host as a work link.
  assert.equal(botJoinUrl('https://teams.cloud.microsoft/meet/1234567890123')?.kind, 'work');
  assert.equal(botJoinUrl('https://teams.live.com/meet/1234567890123')?.kind, 'free');
});
