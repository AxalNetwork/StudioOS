// D886 B9 (#2587): synthetic venture labels only, no meeting or participant data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as notice from '../../meeting-bot/notice.mjs';
import * as noticePage from '../src/pages/InterviewNoticePage.jsx';
import MeetingBotConsentNotice from '../src/pages/founder/MeetingBotConsentNotice.jsx';
import { mutationCheck, sourceModule } from './_record_d696.mjs';

const h = React.createElement;
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const renderPage = (Page, props = {}, url = '/privacy/interviews') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(Page, props)));
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function checkNotice(api) {
  assert.deepEqual([api.MEETING_BOT_NAME, api.MEETING_BOT_NOTICE_VERSION, api.MEETING_BOT_NOTICE_PATH], ['Eadwyn AI', 2, '/privacy/interviews']);
  assert.equal(api.MEETING_BOT_NOTICE_PUBLISHED, false);
  assert.throws(() => api.meetingBotNotice({ get ventureName() { throw new Error('synthetic private data'); } }), /privacy notice is not published/);
  const message = api.draftMeetingBotNotice({ ventureName: 'Example venture' });
  assert.equal(message, 'I’m Eadwyn AI, Axal’s meeting bot, here for the venture "Example venture". '
    + 'This call is being recorded and transcribed for customer research, including participant display names and who spoke when. '
    + 'Tell the founder if you want recording to stop or ask them to delete the recording and transcript. '
    + 'How it works: https://axal.vc/privacy/interviews?n=2');
  assert.equal(api.draftMeetingBotNotice(), api.draftMeetingBotNotice({ ventureName: null }));
  assert.match(api.draftMeetingBotNotice({ ventureName: {} }), /here for the venture that invited me\./);
  assert.match(api.draftMeetingBotNotice({ ventureName: '  Example\n   venture\u202e  ' }), /here for the venture "Example venture"\./);
  assert.match(api.draftMeetingBotNotice({ ventureName: 'x'.repeat(200) }), /here for the venture "x{80}"\./);
  assert.match(api.draftMeetingBotNotice({ ventureName: 'x'.repeat(79) + '😀Y' }), /x{79}😀"\./);
  assert.ok(api.draftMeetingBotNotice({ ventureName: '\ud800' }).includes('\ufffd'));
  assert.match(api.draftMeetingBotNotice({ ventureName: 'Example\u061c\u200b\u200f\ufeff venture' }), /the venture "Example venture"\./);
  assert.ok(api.draftMeetingBotNotice({ ventureName: 'Example "venture"' }).includes('the venture "Example \\"venture\\"".'));
  assert.equal(api.MEETING_BOT_DISPATCH_DISCLOSURE, 'Eadwyn AI will join as a visible participant in the call.');
}

function checkPage(api) {
  const props = { notices: { ...api.INTERVIEW_NOTICES, 2: api.MEETING_BOT_INTERVIEW_NOTICE }, current: 2 };
  const body = plain(renderPage(api.default, props));
  for (const wording of [
    "Eadwyn AI, Axal's meeting bot", 'Zoom, Google Meet or Microsoft Teams',
    'visible participant', "founder's venture", 'announces recording in the meeting chat',
    'interviewee agreed before sending it', 'audio, participant display names, and who spoke when',
    'Display names are labels, not proof of identity', 'Call audio', '30 days by default',
    'choose a different period or keep it until they delete it',
    'Deleting audio does not delete the transcript',
    'participant display names and who spoke when stay with the session',
    'tell the founder to stop recording', 'ask the meeting host to remove it',
    'audio only to be deleted', 'whole session and its transcript to be deleted',
    'Findings the founder already accepted into their research may remain',
    'not yet published',
  ]) assert.ok(body.includes(wording), wording);
  assert.doesNotMatch(renderPage(api.default, props), /mailto:|<script|onerror=/);
  assert.ok(body.includes('retention rules above unless the founder deletes it sooner'));
  assert.ok(!body.includes('What was already recorded stays until the founder deletes it'));
}

function checkDisclosure(api) {
  const html = renderToStaticMarkup(h(api.default));
  assert.match(html, /data-testid="meeting-bot-consent-notice"/);
  assert.ok(html.includes(notice.MEETING_BOT_DISPATCH_DISCLOSURE));
  assert.doesNotMatch(html, /<input|checked|onChange/);
}

function checkLivePage(api) {
  for (const url of ['/privacy/interviews', '/privacy/interviews?n=1', '/privacy/interviews?n=2']) {
    const body = plain(renderPage(api.default, {}, url));
    assert.match(body, /Notice version 1/);
    assert.doesNotMatch(body, /Eadwyn AI|meeting bot/);
  }
}

function checkConfig(config) {
  for (const [section, mode] of [['vars', 'canary'], ['env.production.vars', 'canary'], ['env.preview.vars', 'off']]) {
    const body = config.split(`[${section}]`)[1]?.split(/\n\[/)[0];
    assert.match(body, new RegExp(`^MEETING_BOT = "${mode}"$`, 'm'));
  }
}

test('the shared runtime announcement and dispatch disclosure are pinned, with a bounded venture label', () => checkNotice(notice));
test('the candidate page explains visible recording, retention, stopping and deletion', () => checkPage(noticePage));
test('the live page preserves version 1; a query cannot publish the bot candidate', () => checkLivePage(noticePage));
test('the consent disclosure renders beside the existing control without selecting agreement', () => checkDisclosure({ default: MeetingBotConsentNotice }));
test('the documented audio default matches D877; the bot switch is explicit in each environment', () => {
  const retention = read('cloudflare-worker/src/services/callAudioRetention.ts');
  assert.match(retention, /DEFAULT_CALL_AUDIO_RETENTION_DAYS = 30;/);
  checkConfig(read('wrangler.toml'));
});

test('notice assertions reject wording, attribution and normalization regressions in isolation', async () => {
  await mutationCheck(read('meeting-bot/notice.mjs'), '../../meeting-bot/notice.mjs', checkNotice, [
    ["MEETING_BOT_NAME = 'Eadwyn AI'", "MEETING_BOT_NAME = 'Other bot'"],
    ['MEETING_BOT_NOTICE_VERSION = 2', 'MEETING_BOT_NOTICE_VERSION = 3'],
    ['MEETING_BOT_NOTICE_APPROVED_AT = null', "MEETING_BOT_NOTICE_APPROVED_AT = '2000-01-01'"],
    ["if (!MEETING_BOT_NOTICE_PUBLISHED) throw new Error('The meeting bot privacy notice is not published.');", ''],
    ["MEETING_BOT_NOTICE_PATH = '/privacy/interviews'", "MEETING_BOT_NOTICE_PATH = '/privacy'"],
    ['here for ${venture}', 'here for the founder'],
    ['recorded and transcribed', 'recorded'],
    ['participant display names and who spoke when', 'participants'],
    ['delete the recording and transcript', 'delete the recording'],
    ["'the venture that invited me'", "'another account'"],
    ["if (typeof value !== 'string') return '';", "if (typeof value !== 'string') return 'object';"],
    [".replace(/\\s+/g, ' ')", ".replace(/never-match/g, ' ')"],
    ["clean.replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]/g, ' ')", 'clean'],
    ["Array.from(value, (char) => /^[\\ud800-\\udfff]$/.test(char) ? '\\ufffd' : char).join('')", 'value'],
    ['`the venture ${JSON.stringify(label)}`', '`the venture ${label}`'],
    ["Array.from(line).slice(0, 80).join('')", 'line.slice(0, 80)'],
    ['.slice(0, 80)', '.slice(0, 200)'],
    ['will join as a visible participant', 'might work in the background'],
  ]);
});

test('explicit publication enables the runtime notice; dropping the handoff is caught', async () => {
  const published = read('meeting-bot/notice.mjs').replace('MEETING_BOT_NOTICE_APPROVED_AT = null', "MEETING_BOT_NOTICE_APPROVED_AT = '2000-01-01'");
  await mutationCheck(published, '../../meeting-bot/notice.mjs', (api) => {
    assert.equal(api.MEETING_BOT_NOTICE_PUBLISHED, true);
    assert.equal(api.meetingBotNotice({ ventureName: 'Example venture' }), api.draftMeetingBotNotice({ ventureName: 'Example venture' }));
  }, [['return draftMeetingBotNotice(input);', 'return undefined;']]);
});

test('missing, malformed and invalid-calendar approval dates cannot publish', async () => {
  const source = read('meeting-bot/notice.mjs');
  const unpublished = (api) => {
    assert.equal(api.MEETING_BOT_NOTICE_PUBLISHED, false);
    assert.throws(() => api.meetingBotNotice(), /privacy notice is not published/);
  };
  for (const value of [null, '', 'not-a-date', '2000-02-30', 42]) {
    await unpublished(await sourceModule(source.replace('MEETING_BOT_NOTICE_APPROVED_AT = null', `MEETING_BOT_NOTICE_APPROVED_AT = ${JSON.stringify(value)}`), '../../meeting-bot/notice.mjs'));
  }
  const impossibleDate = source.replace('MEETING_BOT_NOTICE_APPROVED_AT = null', "MEETING_BOT_NOTICE_APPROVED_AT = '2000-02-30'");
  await mutationCheck(impossibleDate, '../../meeting-bot/notice.mjs', unpublished, [
    ['new Date(approvalMs).toISOString().slice(0, 10) === MEETING_BOT_NOTICE_APPROVED_AT', 'true'],
  ]);
});

test('page assertions reject missing notice, retention and deletion disclosures', async () => {
  await mutationCheck(read('frontend/src/pages/InterviewNoticePage.jsx'), 'pages/InterviewNoticePage.jsx', checkPage, [
    ['Eadwyn AI, Axal', 'Other software, Axal'],
    ['participant display names, and who spoke when', 'participant counts'],
    ['30 days by default', '90 days by default'],
    ['Deleting audio does not delete the transcript', 'Deleting audio deletes everything'],
    ['tell the founder to stop recording', 'wait for the meeting to end'],
    ['whole session and its transcript to be deleted', 'audio alone to be deleted'],
    ['Findings the founder already accepted into their research may remain', 'All findings always disappear'],
    ['What was already recorded is kept under the retention rules above unless the founder deletes it sooner.', 'What was already recorded stays until the founder deletes it.'],
  ], true);
});

test('the publication guard rejects silently replacing the live notice with the bot candidate', async () => {
  await mutationCheck(read('frontend/src/pages/InterviewNoticePage.jsx'), 'pages/InterviewNoticePage.jsx', checkLivePage, [
    ['notices = PUBLISHED_INTERVIEW_NOTICES, current = CURRENT_INTERVIEW_NOTICE_VERSION', 'notices = { 2: MEETING_BOT_INTERVIEW_NOTICE }, current = 2'],
  ], true);
});

test('publishing makes version 2 current, preserves old links and keeps the legacy map immutable', async () => {
  const published = read('frontend/src/pages/InterviewNoticePage.jsx').replace(
    "import { MEETING_BOT_NOTICE_APPROVED_AT, MEETING_BOT_NOTICE_PUBLISHED, MEETING_BOT_NOTICE_VERSION } from '../../../meeting-bot/notice.mjs';",
    "const MEETING_BOT_NOTICE_APPROVED_AT = '2000-01-01'; const MEETING_BOT_NOTICE_PUBLISHED = true; const MEETING_BOT_NOTICE_VERSION = 2;",
  );
  await mutationCheck(published, 'pages/InterviewNoticePage.jsx', (api) => {
    assert.equal(api.CURRENT_INTERVIEW_NOTICE_VERSION, 2);
    assert.ok(api.PUBLISHED_INTERVIEW_NOTICES[2]);
    assert.deepEqual(Object.keys(api.INTERVIEW_NOTICES), ['1']);
    for (const url of ['/privacy/interviews', '/privacy/interviews?n=2']) {
      const html = plain(renderPage(api.default, {}, url));
      assert.match(html, /Notice version 2/);
      assert.match(html, /Eadwyn AI/);
      assert.doesNotMatch(html, /The current one is|not yet published/);
      assert.match(html, /Last updated 2000-01-01/);
    }
    const legacy = plain(renderPage(api.default, {}, '/privacy/interviews?n=1'));
    assert.match(legacy, /Notice version 1/);
    assert.match(legacy, /The current one is version 2/);
  }, [
    ['CURRENT_INTERVIEW_NOTICE_VERSION = MEETING_BOT_NOTICE_PUBLISHED ? MEETING_BOT_NOTICE_VERSION : INTERVIEW_NOTICE_VERSION', 'CURRENT_INTERVIEW_NOTICE_VERSION = INTERVIEW_NOTICE_VERSION'],
    ['? { ...INTERVIEW_NOTICES, [MEETING_BOT_NOTICE_VERSION]: MEETING_BOT_INTERVIEW_NOTICE } : INTERVIEW_NOTICES', '? INTERVIEW_NOTICES : INTERVIEW_NOTICES'],
    ['? { ...INTERVIEW_NOTICES, [MEETING_BOT_NOTICE_VERSION]: MEETING_BOT_INTERVIEW_NOTICE } : INTERVIEW_NOTICES', '? Object.assign(INTERVIEW_NOTICES, { [MEETING_BOT_NOTICE_VERSION]: MEETING_BOT_INTERVIEW_NOTICE }) : INTERVIEW_NOTICES'],
    ["updated: MEETING_BOT_NOTICE_APPROVED_AT || 'not yet published'", "updated: 'not yet published'"],
  ], true);
});

test('disclosure assertions reject a missing sentence or an extra agreement control', async () => {
  await mutationCheck(read('frontend/src/pages/founder/MeetingBotConsentNotice.jsx'), 'pages/founder/MeetingBotConsentNotice.jsx', checkDisclosure, [
    ['data-testid="meeting-bot-consent-notice"', 'data-testid="missing"'],
    ['{MEETING_BOT_DISPATCH_DISCLOSURE}', 'Other text'],
    ['{MEETING_BOT_DISPATCH_DISCLOSURE}', '<input type="checkbox" defaultChecked />{MEETING_BOT_DISPATCH_DISCLOSURE}'],
  ], true);
});

test('rollout assertions reject each environment being enabled prematurely', () => {
  const config = read('wrangler.toml');
  for (const section of ['vars', 'env.production.vars', 'env.preview.vars']) {
    const [before, rest] = config.split(`[${section}]`);
    const mutated = before + `[${section}]` + rest.replace(/MEETING_BOT = "(canary|off)"/, 'MEETING_BOT = "on"');
    assert.throws(() => checkConfig(mutated), { name: 'AssertionError' });
  }
  checkConfig(config);
});
