// D886 B9 (#2587): synthetic venture labels only, no meeting or participant data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as notice from '../../meeting-bot/notice.mjs';
import InterviewNoticePage from '../src/pages/InterviewNoticePage.jsx';
import MeetingBotConsentNotice from '../src/pages/founder/MeetingBotConsentNotice.jsx';
import { mutationCheck } from './_record_d696.mjs';

const h = React.createElement;
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const renderPage = (Page) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/privacy/interviews'] }, h(Page)));
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function checkNotice(api) {
  assert.deepEqual([api.MEETING_BOT_NAME, api.MEETING_BOT_NOTICE_VERSION, api.MEETING_BOT_NOTICE_PATH], ['Eadwyn AI', 1, '/privacy/interviews']);
  const message = api.meetingBotNotice({ ventureName: 'Example venture' });
  assert.equal(message, 'I’m Eadwyn AI, Axal’s meeting bot, here for Example venture. '
    + 'This call is being recorded and transcribed for customer research, including participant display names and who spoke when. '
    + 'Tell the founder if you want recording to stop or ask them to delete the recording and transcript. '
    + 'How it works: https://axal.vc/privacy/interviews');
  assert.equal(api.meetingBotNotice(), api.meetingBotNotice({ ventureName: null }));
  assert.match(api.meetingBotNotice({ ventureName: {} }), /here for the venture that invited me\./);
  assert.match(api.meetingBotNotice({ ventureName: '  Example\n   venture\u202e  ' }), /here for Example venture\./);
  assert.match(api.meetingBotNotice({ ventureName: 'x'.repeat(200) }), /here for x{80}\./);
  assert.equal(api.MEETING_BOT_DISPATCH_DISCLOSURE, 'Eadwyn AI will join as a visible participant in the call.');
}

function checkPage(api) {
  const body = plain(renderPage(api.default));
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
  assert.doesNotMatch(renderPage(api.default), /mailto:|<script|onerror=/);
}

function checkDisclosure(api) {
  const html = renderToStaticMarkup(h(api.default));
  assert.match(html, /data-testid="meeting-bot-consent-notice"/);
  assert.ok(html.includes(notice.MEETING_BOT_DISPATCH_DISCLOSURE));
  assert.doesNotMatch(html, /<input|checked|onChange/);
}

function checkConfig(config) {
  for (const [section, mode] of [['vars', 'canary'], ['env.production.vars', 'canary'], ['env.preview.vars', 'off']]) {
    const body = config.split(`[${section}]`)[1]?.split(/\n\[/)[0];
    assert.match(body, new RegExp(`^MEETING_BOT = "${mode}"$`, 'm'));
  }
}

test('the shared runtime announcement and dispatch disclosure are pinned, with a bounded venture label', () => checkNotice(notice));
test('the public page explains visible recording, retention, stopping and deletion', () => checkPage({ default: InterviewNoticePage }));
test('the consent disclosure renders beside the existing control without selecting agreement', () => checkDisclosure({ default: MeetingBotConsentNotice }));
test('the documented audio default matches D877; the bot switch is explicit in each environment', () => {
  const retention = read('cloudflare-worker/src/services/callAudioRetention.ts');
  assert.match(retention, /DEFAULT_CALL_AUDIO_RETENTION_DAYS = 30;/);
  checkConfig(read('wrangler.toml'));
});

test('notice assertions reject wording, attribution and normalization regressions in isolation', async () => {
  await mutationCheck(read('meeting-bot/notice.mjs'), '../../meeting-bot/notice.mjs', checkNotice, [
    ["MEETING_BOT_NAME = 'Eadwyn AI'", "MEETING_BOT_NAME = 'Other bot'"],
    ['MEETING_BOT_NOTICE_VERSION = 1', 'MEETING_BOT_NOTICE_VERSION = 2'],
    ["MEETING_BOT_NOTICE_PATH = '/privacy/interviews'", "MEETING_BOT_NOTICE_PATH = '/privacy'"],
    ['here for ${venture}', 'here for the founder'],
    ['recorded and transcribed', 'recorded'],
    ['participant display names and who spoke when', 'participants'],
    ['delete the recording and transcript', 'delete the recording'],
    ["'the venture that invited me'", "'another account'"],
    ["if (typeof value !== 'string') return '';", "if (typeof value !== 'string') return 'object';"],
    [".replace(/\\s+/g, ' ')", ".replace(/never-match/g, ' ')"],
    ["value.replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]/g, ' ')", 'value'],
    ['.slice(0, 80)', '.slice(0, 200)'],
    ['will join as a visible participant', 'might work in the background'],
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
