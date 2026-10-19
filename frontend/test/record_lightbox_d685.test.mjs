/**
 * D685 (#1587) — the Record a session lightbox (`RecordLightbox.jsx`): its
 * sections per mode, consent gating Start, the chip statuses, both import
 * paths, one send per Start, and what a refused Start leaves behind.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_lightbox_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import { SETUP_FIELDS } from '../src/pages/founder/recordSetup.js';

const h = React.createElement;
const MODELS = {
  live: [{ model: 'nova', label: 'Nova-3 live', price_usd_per_minute: 0.0092, choosable: true }, { model: 'flux', label: 'Flux', price_usd_per_minute: 0.0077, choosable: true }],
  final: [{ model: 'whisper', label: 'Whisper Large v3 Turbo', price_usd_per_minute: 0.0005, choosable: true }],
  defaults: { live: 'nova', final: 'whisper' },
  languages: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'French' }],
};
const BOARD = { hypotheses: [
  { id: 2, code: 'H2', claim: 'They would pay', sort_order: 1, retired_at: null, lane: 'testing', sprint: 4 },
  { id: 1, code: 'H1', claim: 'Ops leads lose a day', sort_order: 2, retired_at: null, lane: 'none' },
  { id: 5, code: 'H5', claim: 'Unclear', sort_order: 5, retired_at: null, lane: 'unknown' },
] };
const CHANNELS = {
  providers: [{ provider: 'telegram', available: true }, { provider: 'whatsapp', available: true }, { provider: 'zoom', available: true }, { provider: 'google_meet', available: true }],
  connections: [{ provider: 'zoom', connected: true }, { provider: 'whatsapp', connected: false }],
};
const render = (props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(RecordLightbox, { projectId: 3, initialModels: MODELS, initialBoard: BOARD, onClose() {}, onStarted() {}, ...props })));
const startTag = (out) => /<button[^>]*data-testid="record-start"[^>]*>/.exec(out)[0];
/** The opening tag that carries a test id, so attributes are checked whatever order React wrote them in. */
const tag = (out, id) => {
  const at = out.indexOf(`data-testid="${id}"`);
  return at < 0 ? '' : out.slice(out.lastIndexOf('<', at), out.indexOf('>', at) + 1);
};

test('the dialog: named, modal, 560px, and the five sections in the canvas\'s order', () => {
  const out = render();
  assert.match(out, /role="dialog"[^>]*aria-modal="true"[^>]*aria-label="Record a session"/);
  assert.match(out, /max-width:560px/);
  const text = renderedText(out);
  assert.match(text, /Validate · Customer research/);
  assert.match(text, /It lands in Interviews when you stop\./);
  const at = ['Who', 'How', 'Talking points', 'Transcript', 'Consent'].map((t) => out.indexOf(`>${t}</h3>`));
  assert.ok(at.every((i) => i > 0), 'every section is drawn');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in order');
  assert.match(text, /Runs on Cloudflare Workers AI/);
  assert.match(out, /data-testid="record-cancel"/);
});

test('each mode: its note, its Start label, and Transcript only where there is audio', () => {
  const cases = [['in_person', 'Put the phone on the table between you', 'Start recording', true], ['video', 'Paste the meeting link', 'Start the call', true],
    ['phone', 'Put the call on speaker', 'Start recording', true], ['text', 'No audio. Import the conversation', 'Import the chat', false]];
  for (const [initialMode, note, start, transcript] of cases) {
    const out = render({ initialMode });
    assert.ok(renderedText(out).includes(note), `${initialMode}: note`);
    assert.ok(renderedText(/<button[^>]*data-testid="record-start"[^>]*>[\s\S]*?<\/button>/.exec(out)[0]).includes(start), `${initialMode}: ${start}`);
    assert.equal(out.includes('>Transcript</h3>'), transcript, `${initialMode}: transcript section`);
    assert.equal(out.includes('data-testid="record-estimate"'), transcript, `${initialMode}: estimate`);
  }
});

test('the four modes are a radiogroup: one tab stop, and the chosen one is checked', () => {
  const out = render({ initialMode: 'phone' });
  assert.match(out, /role="radiogroup" aria-label="How"/);
  assert.match(tag(out, 'record-mode-phone'), /aria-checked="true"/);
  assert.match(tag(out, 'record-mode-phone'), /tabindex="0"/);
  assert.match(tag(out, 'record-mode-in_person'), /aria-checked="false"/);
  assert.match(tag(out, 'record-mode-in_person'), /tabindex="-1"/);
  assert.match(out, /role="radiogroup" aria-label="Consent"/);
  assert.equal((out.match(/data-testid="record-consents-[a-z_]+"/g) || []).length, 4);
  assert.equal(['verbal', 'written', 'in_app', 'pre_agreed'].some((k) => /aria-checked="true"/.test(tag(out, `record-consents-${k}`))), false, 'none preselected');
});

test('consent gates Start: aria-disabled, described by the amber note; recorded, it opens', () => {
  const none = render();
  assert.match(startTag(none), /aria-disabled="true"/);
  assert.match(startTag(none), /aria-describedby="record-consent-note"/);
  assert.match(none, /id="record-consent-note"[^>]*>Audio starts only once consent is recorded\./);
  assert.match(none, /text-amber-800[^"]*dark:text-amber-300/);
  const given = render({ initialConsent: 'written', interview: { id: 7, interviewee_name: 'Dana' } });
  assert.doesNotMatch(startTag(given), /aria-disabled/);
  assert.match(given, />Consent recorded\. Audio starts when you press Start\.</);
  const nameless = render({ interview: null, initialConsent: 'written' });
  assert.match(startTag(nameless), /aria-disabled="true"/, 'no name, no Start');
  assert.match(nameless, /data-testid="record-start-reason">Add who you are talking to\./);
});

test('Who: name and company inputs, or the interview it was opened on', () => {
  const blank = render();
  assert.match(blank, /data-testid="record-name"/);
  assert.match(blank, /data-testid="record-company"/);
  const picked = render({ interview: { id: 9, interviewee_name: 'Dana Ruiz', interviewee_company: 'Acme' } });
  assert.match(picked, /data-testid="record-who-picked">Dana Ruiz · Acme</);
  assert.doesNotMatch(picked, /data-testid="record-name"/);
});

test('provider chips show their status; Connect links to Connectors; importing from an app that is not set up is disabled', () => {
  const video = render({ initialMode: 'video', channels: CHANNELS });
  const text = renderedText(video);
  for (const t of ['Zoom · Connected', 'Google Meet · Connect', 'Microsoft Teams · Ready', 'WhatsApp video · Ready', 'Telegram video · Ready']) assert.ok(text.includes(t), t);
  const wa = render({ initialMode: 'text', channels: CHANNELS });
  assert.ok(renderedText(tag(wa, 'record-provider-whatsapp') + 'x').length > 0);
  assert.ok(renderedText(wa).includes('WhatsApp · Connect'));
  assert.match(tag(wa, 'record-connect-link'), /href="\/account\/connectors"/);
  assert.ok(renderedText(wa).includes('Connect WhatsApp in Connectors'));
  const none = render({ initialMode: 'text', channels: null });
  assert.match(tag(none, 'record-provider-telegram'), /disabled=""/, 'not available yet is disabled');
  assert.match(tag(none, 'record-provider-slack'), /disabled=""/);
  assert.match(tag(none, 'record-provider-paste'), /aria-checked="true"/, 'and the default is the one that works');
  assert.doesNotMatch(tag(none, 'record-provider-paste'), / disabled=""/);
  assert.match(none, /data-testid="record-conversation"/, 'so the paste box is there');
  assert.doesNotMatch(render({ initialMode: 'in_person' }), /record-provider/, 'in person has no provider chips');
});

test('the meeting link is drawn for Zoom, Meet and Teams only, and taken since POST /sessions stores it', () => {
  const on = render({ initialMode: 'video', channels: CHANNELS });
  assert.ok(tag(on, 'record-link'));
  assert.doesNotMatch(tag(on, 'record-link'), / disabled=""/);
  assert.doesNotMatch(on, /record-link-note/);
  assert.doesNotMatch(render({ initialMode: 'phone' }), /data-testid="record-link"/);
  // A field turned off is drawn disabled, with the reason.
  const off = render({ initialMode: 'video', channels: CHANNELS, fields: { ...SETUP_FIELDS, meeting_url: false } });
  assert.match(tag(off, 'record-link'), /disabled=""/);
  assert.ok(renderedText(off).includes('Not saved yet: the Worker does not store this field.'));
});

test('talking points: the first two on, "No hypothesis yet" when there are none, and stored since #1591', () => {
  const out = render();
  assert.match(tag(out, 'record-point-2'), /aria-pressed="true"/);
  assert.match(tag(out, 'record-point-1'), /aria-pressed="true"/);
  assert.match(tag(out, 'record-point-5'), /aria-pressed="false"/);
  assert.doesNotMatch(tag(out, 'record-point-2'), / disabled=""/, 'the Worker stores them');
  assert.match(renderedText(out), /The hypotheses you pick appear in the Talking points drawer while you record\./);
  const unstored = render({ fields: { ...SETUP_FIELDS, points: false } });
  assert.match(tag(unstored, 'record-point-2'), / disabled=""/, 'a field the Worker does not store is disabled');
  assert.match(renderedText(unstored), /Not saved yet: the Worker does not store this field\./);
  const none = render({ initialBoard: { hypotheses: [] } });
  assert.ok(renderedText(none).includes('No hypothesis yet.'));
  assert.match(none, /data-testid="record-points-none"/);
  assert.match(none, /href="\/validate\/experiments"/);
  assert.ok(renderedText(render({ initialBoard: null })).includes('Unreadable: your hypotheses could not be read.'));
});

test('Transcript: live and final models priced by the Worker, the Worker’s languages, and the estimate', () => {
  const out = render();
  const text = renderedText(out);
  assert.ok(text.includes('Nova-3 live · $0.0092/min'));
  assert.ok(text.includes('Flux · $0.0077/min'));
  assert.ok(text.includes('Whisper Large v3 Turbo · $0.0005/min'));
  assert.match(out, /role="radiogroup" aria-label="Live captions"/);
  assert.doesNotMatch(tag(out, 'record-language'), / disabled=""/);
  assert.match(out, />Detect<\/option><option value="en">English<\/option><option value="fr">French<\/option>/);
  assert.doesNotMatch(out, /data-testid="record-language-note"/);
  assert.match(tag(render({ fields: { ...SETUP_FIELDS, language: false } }), 'record-language'), /disabled=""/);
  assert.ok(text.includes('30 min ≈ $0.29 · live captions while you talk'), text);
  assert.ok(renderedText(render({ initialModels: { ...MODELS, defaults: { live: null, final: 'whisper' } } })).includes('30 min ≈ $0.02 · the transcript appears when you stop'));
  assert.ok(renderedText(render({ initialModels: null })).includes('Unreadable: the model list could not be read.'));
});

test('the AI assistant entry is a link that opens it on request, closed by default', () => {
  const out = render();
  assert.match(tag(out, 'record-assistant-link'), /aria-expanded="false"/);
  assert.match(tag(out, 'record-assistant-link'), /aria-controls="record-assistant"/);
  assert.doesNotMatch(out, /assistant-entry/);
  assert.ok(renderedText(out).includes('Send it from your AI assistant'));
});

test('dark mode: the dialog, the chips and the tiles carry their dark pair', () => {
  const out = render({ initialConsent: 'verbal' });
  assert.match(out, /dark:bg-gray-950/);
  assert.match(out, /dark:border-violet-400 dark:bg-violet-900\/40 dark:text-violet-200/, 'a chosen tile');
  assert.match(out, /dark:border-gray-700 dark:bg-gray-900/, 'an unchosen one');
  assert.match(out, /dark:text-gray-100/);
  assert.match(out, /dark:divide-gray-800/);
  // The provider and talking-point chips (not the tiles) have their own pair, chosen and not.
  assert.match(tag(out, 'record-point-2'), /dark:border-violet-400 dark:bg-violet-900\/40 dark:text-violet-200/, 'a chosen chip');
  assert.match(tag(out, 'record-point-5'), /dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200/, 'an unchosen chip');
  assert.match(tag(render({ initialMode: 'video', channels: CHANNELS }), 'record-provider-zoom'), /dark:bg-violet-900\/40/);
});

// ── Behaviour, through the stub DOM ─────────────────────────────────────────

async function mount(props) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(RecordLightbox, props))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, pr, text: (n) => text(n === undefined ? container : n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); },
    async type(id, value) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const spies = (over = {}) => {
  const calls = { createInterview: [], deleteInterview: [], create: [], open: [], started: [], assign: [], stage: [] };
  return {
    calls,
    props: {
      projectId: 3, initialModels: MODELS, initialBoard: BOARD, onClose() {}, onStarted: (...a) => calls.started.push(a),
      api: {
        createInterview: async (pid, body) => { calls.createInterview.push([pid, body]); return { id: 41, ...body }; },
        deleteInterview: async (id) => { calls.deleteInterview.push(id); },
        getValidationBoard: async () => BOARD,
      },
      sessions: {
        models: async () => MODELS,
        create: async (id, body) => { calls.create.push([id, body]); return { session: { id: 501, interview_id: id } }; },
        open: async (body) => {
          calls.open.push(body);
          const id = body.interview_id ?? 41;
          return { session: { id: 501, interview_id: id }, interview: { id, interviewee_name: body.interviewee?.name ?? 'Picked', interviewee_company: body.interviewee?.company ?? null, project_id: 3, stage: 'booked' } };
        },
      },
      // #1586: the chips' read. Unreadable unless a test says otherwise.
      channelsSource: {
        overview: async () => { calls.overview = (calls.overview || 0) + 1; throw new Error('unread'); },
        threads: async () => ({ items: [] }),
        assign: async (uid, target) => { calls.assign.push([uid, target]); return { ok: true, interview_id: target.interview_id ?? 77, session_id: 909, moved: 3 }; },
      },
      cycle: {
        module: async () => ({ records: { rows: [] } }),
        setInterviewStage: async (pid, id, stage) => { calls.stage.push([pid, id, stage]); return {}; },
      },
      ...over,
    },
  };
};

test('Start without consent sends nothing', async () => {
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana Ruiz');
    await m.click('record-start');
    assert.equal(s.calls.createInterview.length + s.calls.create.length + s.calls.open.length, 0);
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true);
  } finally { await m.unmount(); }
});

test('one setup call: a new person and the session go to POST /sessions together, under one client_key', async () => {
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.type('record-name', '  Dana Ruiz ');
    await m.type('record-company', 'Acme');
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.equal(s.calls.createInterview.length + s.calls.create.length, 0, 'no interim two-call Start');
    assert.equal(s.calls.open.length, 1);
    const { client_key: key, ...body } = s.calls.open[0];
    assert.deepEqual(body, { project_id: 3, interviewee: { name: 'Dana Ruiz', company: 'Acme' }, channel: 'in_person', consent: { status: 'given', method: 'verbal' }, live_model: 'nova', final_model: 'whisper', points: [2, 1] });
    assert.match(key, /^record-./);
    assert.equal(s.calls.started.length, 1);
    assert.equal(s.calls.started[0][0].id, 501);
    assert.deepEqual(s.calls.started[0][1], { id: 41, interviewee_name: 'Dana Ruiz', interviewee_company: 'Acme' }, 'the interview the Worker made, for the session page');
  } finally { await m.unmount(); }
});

test('an interview it was opened on (maybe already held) opens on its own route, with the same fields and client_key', async () => {
  const s = spies();
  const m = await mount({ ...s.props, interview: { id: 7, interviewee_name: 'Dana Ruiz' } });
  try {
    await m.click('record-mode-video');
    await m.click('record-consents-in_app');
    await m.click('record-start');
    assert.equal(s.calls.createInterview.length + s.calls.open.length, 0, 'the setup call would refuse a held interview');
    const [[id, { client_key: key, ...body }]] = s.calls.create;
    assert.equal(id, 7);
    assert.match(key, /^record-./);
    assert.deepEqual(body, { channel: 'video', consent: { status: 'given', method: 'in_app' }, live_model: 'nova', final_model: 'whisper', call_provider: 'zoom', points: [2, 1] });
    assert.deepEqual(s.calls.started[0][1], { id: 7, interviewee_name: 'Dana Ruiz', interviewee_company: null });
  } finally { await m.unmount(); }
});

test('one send per Start: a second press while the first is in flight does nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = spies();
  s.props.sessions.open = async (body) => { s.calls.open.push(body); await gate; return { session: { id: 501 } }; };
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await act(async () => { m.pr(m.by('record-start')).onClick(); m.pr(m.by('record-start')).onClick(); });
    assert.equal(s.calls.open.length, 1, 'one setup call');
    assert.match(m.text(), /Starting…/);
    await act(async () => { release(); await gate; });
  } finally { await m.unmount(); }
});

test('a refused Start prints the Worker\'s words, deletes nothing, and keeps its client_key for the retry', async () => {
  const words = 'Record the interviewee’s consent to be recorded before you start.';
  const s = spies();
  let refuse = true;
  const open = s.props.sessions.open;
  s.props.sessions.open = async (body) => { if (refuse) { s.calls.open.push(body); throw Object.assign(new Error(words), { status: 400, code: 'consent_method_required' }); } return open(body); };
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-written');
    await m.click('record-start');
    assert.equal(s.calls.deleteInterview.length + s.calls.createInterview.length, 0, 'the Worker made nothing, so nothing is undone');
    assert.equal(s.calls.started.length, 0);
    assert.ok(m.text().includes(words));
    assert.equal(m.pr(m.by('record-error')).role, 'alert');
    assert.equal(m.by('record-error-live'), undefined, 'no recording to return to');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], undefined, 'and Start can be pressed again');
    refuse = false;
    await m.click('record-start');
    assert.equal(s.calls.open[1].client_key, s.calls.open[0].client_key, 'the same Start, so a lost answer is not a second interview');
    assert.equal(s.calls.started.length, 1);
  } finally { await m.unmount(); }
});

test('409 session_active: the Worker\'s sentence, and a link back to the recording already live', async () => {
  const s = spies();
  const released = [];
  const recorder = { prepare() {}, release: () => released.push(1), begin() { throw new Error('never'); } };
  s.props.sessions.open = async () => { throw Object.assign(new Error('You are already recording another session. Stop it, or return to it, first.'), { status: 409, code: 'session_active', data: { error: 'session_active', session_id: 88 } }); };
  const m = await mount({ ...s.props, recorder });
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.match(m.text(), /You are already recording another session\. Stop it, or return to it, first\./);
    assert.equal(m.pr(m.by('record-error-live')).href, '/validate/record/live?session=88');
    assert.equal(released.length, 1, 'the microphone opened for this Start is let go');
    assert.equal(s.calls.started.length, 0);
  } finally { await m.unmount(); }
});

test('#1588 while this tab still records, Start is refused before the microphone opens or a session is made, and offers that recording', async () => {
  const s = spies();
  const log = [];
  const recorder = {
    prepare() { log.push('prepare'); }, release() { log.push('release'); }, begin() { log.push('begin'); return 'recording'; },
    isCapturing: () => true, getSnapshot: () => ({ session: { id: 88 }, phase: 'recording' }),
  };
  const m = await mount({ ...s.props, recorder });
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.match(m.text(), /You are already recording another session\. Stop it, or return to it, first\./);
    assert.equal(m.pr(m.by('record-error-live')).href, '/validate/record/live?session=88');
    assert.deepEqual(log, [], 'no microphone asked for, nothing handed over');
    assert.deepEqual([s.calls.open.length, s.calls.create.length, s.calls.started.length], [0, 0, 0], 'no session made');
  } finally { await m.unmount(); }
  // A text chat records nothing: it is not refused.
  const t = spies();
  const m2 = await mount({ ...t.props, recorder });
  try {
    await m2.type('record-name', 'Dana');
    await m2.click('record-mode-text');
    await m2.type('record-conversation', 'Dana: Hi');
    await m2.click('record-start');
    assert.equal(t.calls.open.length, 1);
  } finally { await m2.unmount(); }
});

test('a text chat is pasted: the conversation becomes messages, with no consent asked for', async () => {
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-mode-text');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true, 'nothing pasted yet');
    await m.type('record-conversation', 'Dana: It takes a day\nwe log it');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], undefined);
    await m.click('record-start');
    const { client_key: _k, ...body } = s.calls.open[0];
    assert.deepEqual(body, { project_id: 3, interviewee: { name: 'Dana', company: null }, channel: 'text', messages: [{ author: 'Dana', text: 'It takes a day' }, { author: 'Me', text: 'we log it' }], call_provider: 'paste', points: [2, 1] });
    assert.equal(s.calls.started[0][0].id, 501, 'the session page, with no recorder');
  } finally { await m.unmount(); }
});

test('importing a chat from an app waits for the channel routes: it says so and offers the paste', async () => {
  const m = await mount(spies().props);
  try {
    await m.click('record-mode-text');
    await m.click('record-provider-telegram').catch(() => {});
    assert.ok(m.by('record-conversation'), 'paste stays the default');
    assert.equal(m.pr(m.by('record-provider-telegram')).disabled, true);
  } finally { await m.unmount(); }
});

test('a talking point toggles, and is sent', async () => {
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.click('record-point-1');
    assert.equal(m.pr(m.by('record-point-1'))['aria-pressed'], false);
    await m.click('record-point-5');
    await m.click('record-start');
    assert.deepEqual(s.calls.open[0].points, [2, 5]);
  } finally { await m.unmount(); }
});

test('an invalid meeting link blocks Start; a valid one is sent with its provider', async () => {
  const s = spies();
  const m = await mount({ ...s.props, initialMode: 'video', channels: CHANNELS });
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.type('record-link', 'https://evil.test/j/1');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true);
    assert.ok(m.text().includes('A Zoom link is on zoom.us.'));
    await m.type('record-link', 'https://acme.zoom.us/j/12345678');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], undefined);
    await m.click('record-start');
    assert.equal(s.calls.open[0].call_provider, 'zoom');
    assert.equal(s.calls.open[0].meeting_url, 'https://acme.zoom.us/j/12345678');
  } finally { await m.unmount(); }
});

test('Cancel and × close and call nothing', async () => {
  const s = spies();
  const closed = [];
  const m = await mount({ ...s.props, onClose: () => closed.push(1) });
  try {
    await m.click('record-cancel');
    await m.click('record-lightbox-close');
    assert.equal(closed.length, 2);
    assert.equal(s.calls.createInterview.length + s.calls.create.length + s.calls.deleteInterview.length + s.calls.open.length, 0);
  } finally { await m.unmount(); }
});

test('#1586 the lightbox reads GET /api/channels itself, and the Text chips show it', async () => {
  const read = {
    providers: [{ provider: 'telegram', available: true }, { provider: 'whatsapp', available: true }],
    connections: { whatsapp: { status: 'active', external_account_name: 'Ledger Co' }, telegram: { status: 'active', business_connected: false } },
  };
  let asked = 0;
  const s = spies();
  const m = await mount({ ...s.props, initialMode: 'text', channelsSource: { ...s.props.channelsSource, overview: async () => { asked += 1; return read; } } });
  try {
    assert.equal(asked, 1, 'read once');
    const t = m.text();
    assert.match(t, /WhatsApp · Connected/);
    assert.match(t, /Telegram · Connect\b/, 'Telegram Business not linked yet');
    assert.match(t, /Signal · Not available yet/);
  } finally { await m.unmount(); }

  // Unreadable: the chips say so rather than guessing.
  const s2 = spies();
  const m2 = await mount({ ...s2.props, initialMode: 'text' });
  try { assert.match(m2.text(), /WhatsApp · Not available yet/); } finally { await m2.unmount(); }

  // A read passed in is used as is: nothing is fetched.
  let fetched = 0;
  const s3 = spies();
  const m3 = await mount({ ...s3.props, initialMode: 'text', channels: read, channelsSource: { ...s3.props.channelsSource, overview: async () => { fetched += 1; return null; } } });
  try {
    assert.equal(fetched, 0);
    assert.match(m3.text(), /WhatsApp · Connected/);
  } finally { await m3.unmount(); }
});

// ------------------------------------------------- #1587: the lightbox on the Worker's setup routes

const PIPELINE = { records: { rows: [
  { id: 12, interviewee: 'Bo Booked', company: 'Acme', stage: 'booked' },
  { id: 13, interviewee: 'Li Lead', company: null, stage: 'lead' },
] } };

test('Who: "or pick from Recruiting pipeline ▾" lists the pipeline, booked first, and Start names the pick by id', async () => {
  const s = spies();
  const asked = [];
  s.props.cycle.module = async (...a) => { asked.push(a); return PIPELINE; };
  const m = await mount(s.props);
  try {
    assert.equal(m.by('record-pipeline'), undefined, 'closed until asked for');
    await m.click('record-pipeline-link');
    assert.deepEqual(asked, [[3, 'customer-research', { filter: 'stage:pipeline', sort: 'booked' }]], 'the Worker\'s pipeline filter, booked first');
    assert.equal(m.pr(m.by('record-pipeline-link'))['aria-expanded'], true);
    assert.match(m.text(), /Bo Booked · Acme Booked/);
    assert.match(m.text(), /Li Lead Lead/);
    await m.click('record-pipeline-13');
    assert.equal(m.by('record-name'), undefined, 'the pick replaces the name fields');
    assert.match(m.text(m.by('record-who-picked')), /Li Lead/);
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.equal(s.calls.open[0].interview_id, 13);
    assert.equal('interviewee' in s.calls.open[0], false);
  } finally { await m.unmount(); }
  // "Someone else" goes back to the name fields; an unreadable pipeline says so, never "empty".
  const s2 = spies();
  s2.props.cycle.module = async () => { throw new Error('down'); };
  const m2 = await mount(s2.props);
  try {
    await m2.click('record-pipeline-link');
    assert.ok(m2.by('record-pipeline-unreadable'));
    assert.match(m2.text(), /This is not a claim that it is empty\./);
  } finally { await m2.unmount(); }
  const s3 = spies();
  s3.props.cycle.module = async () => PIPELINE;
  const m3 = await mount(s3.props);
  try {
    await m3.click('record-pipeline-link');
    await m3.click('record-pipeline-12');
    await m3.click('record-who-clear');
    assert.ok(m3.by('record-name'));
    const none = spies();
    await m3.unmount();
    const m4 = await mount(none.props);
    await m4.click('record-pipeline-link');
    assert.ok(m4.by('record-pipeline-none'), 'an empty pipeline, read');
    await m4.unmount();
  } catch (e) { await m3.unmount().catch(() => {}); throw e; }
});

test('the language is the Worker\'s list and is sent; Flux takes English only', async () => {
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.type('record-language', 'fr');
    await m.click('record-start');
    assert.equal(s.calls.open[0].language, 'fr');
  } finally { await m.unmount(); }
  const s2 = spies();
  const m2 = await mount({ ...s2.props, initialModels: { ...MODELS, live: [...MODELS.live.slice(0, 1), { ...MODELS.live[1], model: '@cf/deepgram/flux' }] } });
  try {
    await m2.type('record-name', 'Dana');
    await m2.click('record-consents-verbal');
    await m2.type('record-language', 'fr');
    await m2.click('record-live-@cf/deepgram/flux');
    const opts = m2.by('record-language').childNodes.map((o) => o.textContent);
    assert.deepEqual(opts, ['Detect', 'English'], 'Flux transcribes English only');
    await m2.click('record-start');
    assert.equal('language' in s2.calls.open[0], false, 'French was taken back to Detect, never sent with Flux');
  } finally { await m2.unmount(); }
});

test('a text chat\'s consent pick is shown and sent: it is quote consent', async () => {
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-mode-text');
    assert.match(m.text(), /Optional for a text chat: needed only to quote it\./);
    await m.type('record-conversation', 'Dana: hi');
    await m.click('record-consents-in_app');
    await m.click('record-start');
    assert.deepEqual(s.calls.open[0].consent, { method: 'in_app' });
  } finally { await m.unmount(); }
});

const CONNECTED = { providers: [{ provider: 'whatsapp', available: true }, { provider: 'telegram', available: true }], connections: { whatsapp: { status: 'active' } } };
const THREADS = { items: [
  { uid: 'th-1', provider: 'whatsapp', contact_name: 'Dana Ruiz', message_count: 4, last_message_at: null, status: 'pending' },
  { uid: 'th-2', provider: 'telegram', contact_name: 'Tele Tom', message_count: 1, last_message_at: null, status: 'pending' },
] };

test('Text chat imports a waiting WhatsApp chat in place: chosen, assigned from Who, and its session opens', async () => {
  const s = spies();
  const asked = [];
  s.props.channelsSource.threads = async (st) => { asked.push(st); return THREADS; };
  const m = await mount({ ...s.props, channels: CONNECTED });
  try {
    await m.type('record-name', ' Dana ');
    await m.type('record-company', 'Acme');
    await m.click('record-mode-text');
    assert.equal(m.pr(m.by('record-provider-whatsapp'))['aria-checked'], true, 'the connected app');
    assert.deepEqual(asked, ['pending']);
    assert.ok(m.by('record-thread-th-1'));
    assert.equal(m.by('record-thread-th-2'), undefined, 'that app\'s chats only');
    assert.equal(m.by('record-conversation'), undefined, 'no paste box while importing');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true);
    assert.equal(m.text(m.by('record-start-reason')), 'Choose a chat to import.');
    await m.click('record-thread-th-1');
    await m.click('record-consents-written');
    await m.click('record-start');
    assert.deepEqual(s.calls.assign, [['th-1', { create: { interviewee_name: 'Dana', interviewee_company: 'Acme', project_id: 3 }, quote_consent: true }]]);
    assert.equal(s.calls.open.length, 0, 'an import is not a setup call');
    assert.deepEqual(s.calls.started[0], [{ id: 909 }, { id: 77, interviewee_name: 'Dana', interviewee_company: 'Acme' }]);
  } finally { await m.unmount(); }
  // On an interview: assigned to it. No session in the answer: the sentence, and nobody is moved.
  const s2 = spies();
  s2.props.channelsSource.threads = async () => THREADS;
  s2.props.channelsSource.assign = async (uid, target) => { s2.calls.assign.push([uid, target]); return { ok: true, interview_id: 7, session_id: null, moved: 2 }; };
  const m2 = await mount({ ...s2.props, channels: CONNECTED, interview: { id: 7, interviewee_name: 'Ana' } });
  try {
    await m2.click('record-mode-text');
    await m2.click('record-thread-th-1');
    await m2.click('record-start');
    assert.deepEqual(s2.calls.assign[0], ['th-1', { interview_id: 7 }]);
    assert.equal(s2.calls.started.length, 0);
    assert.equal(m2.text(m2.by('record-assigned')), 'Moved 2 messages into the interview with Ana. New messages in this chat go there too.');
  } finally { await m2.unmount(); }
  // Nothing waiting, or an unreadable list: said so, never guessed.
  const s3 = spies();
  const m3 = await mount({ ...s3.props, channels: CONNECTED });
  try {
    await m3.click('record-mode-text');
    assert.match(m3.text(m3.by('record-threads-none')), /^No WhatsApp chat is waiting\./);
  } finally { await m3.unmount(); }
  const s4 = spies();
  s4.props.channelsSource.threads = async () => { throw new Error('down'); };
  const m4 = await mount({ ...s4.props, channels: CONNECTED });
  try {
    await m4.click('record-mode-text');
    assert.ok(m4.by('record-threads-unreadable'));
  } finally { await m4.unmount(); }
});

// D754 (#1980): a WhatsApp chat that waits for consent starts only once it is asked for, or the member gives their word.
const CONSENT_THREADS = (windowOpen) => ({ items: [
  { uid: 'wa-1', provider: 'whatsapp', contact_name: 'Dana Ruiz', message_count: 2, last_message_at: null, status: 'pending', consent_status: 'not_asked', reply_window_open: windowOpen },
  { uid: 'tg-1', provider: 'telegram', contact_name: 'Tele Tom', message_count: 1, last_message_at: null, status: 'pending', consent_status: null, reply_window_open: true },
] });

test('a WhatsApp chat that waits for consent: Start waits for Ask or the member\'s word, and the assign carries it', async () => {
  const s = spies();
  s.props.channelsSource.threads = async () => CONSENT_THREADS(true);
  const m = await mount({ ...s.props, channels: CONNECTED });
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-mode-text');
    await m.click('record-thread-wa-1');
    assert.ok(m.by('record-chat-consent'));
    assert.equal(m.text(m.by('record-chat-consents-ask')), 'Ask Dana in WhatsApp');
    assert.equal(m.text(m.by('record-chat-consents-written')), 'Dana already agreed: In writing');
    assert.equal(m.by('record-chat-consents-in_app'), undefined, '"In the app" is not the member\'s word');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true, 'Start waits');
    assert.equal(m.text(m.by('record-start-reason')), 'Ask Dana in WhatsApp, or say they already agreed.');
    await m.click('record-chat-consents-ask');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], undefined, 'asked: Start may go');
    await m.click('record-start');
    assert.deepEqual(s.calls.assign, [['wa-1', { create: { interviewee_name: 'Dana', interviewee_company: null, project_id: 3 }, consent: { ask: true } }]]);
  } finally { await m.unmount(); }

  const s2 = spies();
  s2.props.channelsSource.threads = async () => CONSENT_THREADS(true);
  const m2 = await mount({ ...s2.props, channels: CONNECTED, interview: { id: 7, interviewee_name: 'Ana' } });
  try {
    await m2.click('record-mode-text');
    await m2.click('record-thread-wa-1');
    await m2.click('record-chat-consents-pre_agreed');
    await m2.click('record-start');
    assert.deepEqual(s2.calls.assign, [['wa-1', { interview_id: 7, consent: { method: 'pre_agreed' } }]], 'the member\'s word');
  } finally { await m2.unmount(); }
});

test('the window closed: Ask is disabled and says D754\'s sentence; a Telegram chat (required false) is unchanged', async () => {
  const s = spies();
  s.props.channelsSource.threads = async () => CONSENT_THREADS(false);
  const m = await mount({ ...s.props, channels: CONNECTED, interview: { id: 7, interviewee_name: 'Ana' } });
  try {
    await m.click('record-mode-text');
    await m.click('record-thread-wa-1');
    assert.equal(m.pr(m.by('record-chat-consents-ask')).disabled, true);
    assert.equal(m.text(m.by('record-chat-window')), 'Ana last wrote more than 24 hours ago, and WhatsApp only lets Axal write within 24 hours of their last message. Ask Ana to send you a message from your WhatsApp Business app, then ask again.');
    await m.click('record-chat-consents-ask');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true, 'a disabled Ask cannot be chosen');
    assert.equal(s.calls.assign.length, 0);
  } finally { await m.unmount(); }

  const s2 = spies();
  s2.props.channelsSource.threads = async () => CONSENT_THREADS(true);
  const m2 = await mount({ ...s2.props, channels: { ...CONNECTED, connections: { telegram: { status: 'active' } } }, interview: { id: 7, interviewee_name: 'Ana' } });
  try {
    await m2.click('record-mode-text');
    await m2.click('record-provider-telegram');
    await m2.click('record-thread-tg-1');
    assert.equal(m2.by('record-chat-consent'), undefined, 'no consent block for Telegram');
    await m2.click('record-start');
    assert.deepEqual(s2.calls.assign, [['tg-1', { interview_id: 7 }]], 'no consent in the body');
  } finally { await m2.unmount(); }
});

// D756 (#1981): a Telegram chat's consent is the interviewee's own YES, asked before the import.
const TG = (over = {}) => ({ items: [
  { uid: 'tg-9', provider: 'telegram', contact_name: 'Tele Tom', message_count: 1, last_message_at: null, status: 'pending', consent_status: 'not_asked', reply_window_open: true, can_reply: true, ...over },
] });
const TG_CHANNELS = { ...CONNECTED, connections: { telegram: { status: 'active' } } };
const tgView = (over = {}) => ({ required: true, status: 'requested', source: null, method: null, requested_at: '2026-10-18T14:05:00.000Z', delivered_at: null, answered_at: null, withdrawn_at: null, window_open: true, can_request: false, notice_text: null, ...over });

test('Telegram: Start waits for a YES; "Ask for consent in Telegram" asks once; no "already agreed"', async () => {
  const s = spies();
  const asked = [];
  s.props.channelsSource.threads = async () => TG();
  s.props.channelsSource.requestConsent = async (uid) => { asked.push(uid); return { ok: true, consent: tgView() }; };
  const m = await mount({ ...s.props, channels: TG_CHANNELS, interview: { id: 7, interviewee_name: 'Tom' } });
  try {
    await m.click('record-mode-text');
    await m.click('record-provider-telegram');
    await m.click('record-thread-tg-9');
    assert.equal(m.text(m.by('record-telegram-consent-state')), 'Not asked yet');
    assert.equal(m.by('record-chat-consents'), undefined, 'no "already agreed" for Telegram');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true);
    assert.equal(m.text(m.by('record-start-reason')), 'Ask Tom for consent in Telegram first.');
    await m.click('record-telegram-ask');
    assert.deepEqual(asked, ['tg-9']);
    assert.match(m.text(m.by('record-telegram-consent-state')), /^Asked at /);
    assert.equal(m.text(m.by('record-start-reason')), "Start waits for Tom's YES in Telegram.");
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true, 'asked is not agreed');
  } finally { await m.unmount(); }

  const s2 = spies();
  s2.props.channelsSource.threads = async () => TG({ consent_status: 'given' });
  const m2 = await mount({ ...s2.props, channels: TG_CHANNELS, interview: { id: 7, interviewee_name: 'Tom' } });
  try {
    await m2.click('record-mode-text');
    await m2.click('record-provider-telegram');
    await m2.click('record-thread-tg-9');
    assert.equal(m2.by('record-telegram-consent'), undefined, 'given: nothing to ask');
    await m2.click('record-start');
    assert.deepEqual(s2.calls.assign, [['tg-9', { interview_id: 7 }]], 'the assign carries no consent for Telegram');
  } finally { await m2.unmount(); }
});

test('Telegram: without the reply right, or outside 24 hours, the reason and "Copy the notice" (the Worker\'s text)', async () => {
  for (const [over, reason] of [[{ can_reply: false }, "The bot isn't allowed to reply in this chat"], [{ reply_window_open: false }, 'The person last wrote more than 24 hours ago']]) {
    const s = spies();
    s.props.channelsSource.threads = async () => TG(over);
    const m = await mount({ ...s.props, channels: TG_CHANNELS, interview: { id: 7, interviewee_name: 'Tom' } });
    try {
      await m.click('record-mode-text');
      await m.click('record-provider-telegram');
      await m.click('record-thread-tg-9');
      assert.equal(m.by('record-telegram-ask'), undefined, 'Axal cannot send it');
      assert.equal(m.text(m.by('record-telegram-copy-reason')), `${reason}, so Axal cannot send the notice. Paste it into the chat yourself.`);
      assert.equal(m.by('record-telegram-copy-button'), undefined, 'no notice text from the Worker: nothing to copy, nothing written here');
    } finally { await m.unmount(); }
  }
});

test('"Schedule the call for later" for a new person adds them to the pipeline, booked, then opens the scheduler', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.click('record-schedule-link');
    assert.equal(m.text(m.by('record-schedule-error')), 'Add who you are talking to first.');
    assert.equal(s.calls.createInterview.length, 0);
    await m.type('record-name', 'Dana');
    await m.type('record-company', 'Acme');
    await m.click('record-schedule-link');
    assert.deepEqual(s.calls.createInterview, [[3, { interviewee_name: 'Dana', interviewee_company: 'Acme' }]]);
    assert.deepEqual(s.calls.stage, [[3, 41, 'booked']], 'booked: a call to come is not a held interview');
    assert.ok(m.by('interview-schedule'));
    assert.match(m.text(m.by('record-who-picked')), /Dana · Acme/, 'and Who is that interview now, so Start does not make a second one');
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.equal(s.calls.open[0].interview_id, 41);
  } finally { await m.unmount(); }
  // The stage refused: the interview just made is deleted, and the Worker's words shown.
  const s2 = spies();
  s2.props.cycle.setInterviewStage = async () => { throw new Error('The stage could not be set.'); };
  const m2 = await mount(s2.props);
  try {
    await m2.type('record-name', 'Dana');
    await m2.click('record-schedule-link');
    assert.deepEqual(s2.calls.deleteInterview, [41]);
    assert.equal(m2.text(m2.by('record-schedule-error')), 'The stage could not be set.');
    assert.equal(m2.by('interview-schedule'), undefined);
  } finally { await m2.unmount(); globalThis.fetch = prevFetch; }
});

test('#1588 Video on a phone says it records the microphone only; Start hands the Worker\'s meeting link to the recorder', async () => {
  const phone = render({ initialMode: 'video', channels: CHANNELS, recorder: { canShareTab: false } });
  assert.ok(renderedText(phone).includes('Paste the meeting link. It records the call’s audio. On a phone it records this device’s microphone only.'));
  assert.doesNotMatch(renderedText(render({ initialMode: 'video', channels: CHANNELS, recorder: { canShareTab: true } })), /On a phone/);
  assert.doesNotMatch(renderedText(render({ initialMode: 'in_person', recorder: { canShareTab: false } })), /On a phone/, 'Video only');
  const begun = [];
  const s = spies();
  s.props.sessions.open = async (body) => { s.calls.open.push(body); return { session: { id: 501, channel: 'video' }, interview: { id: 41 }, meeting_url: 'https://acme.zoom.us/j/1', call_label: 'Video call · Zoom' }; };
  const recorder = { canShareTab: true, prepare() {}, release() {}, begin: (a) => { begun.push(a); return Promise.resolve('share'); } };
  const m = await mount({ ...s.props, recorder, initialMode: 'video', channels: CHANNELS });
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.equal(begun[0].meetingUrl, 'https://acme.zoom.us/j/1');
    assert.equal(begun[0].callLabel, 'Video call · Zoom');
  } finally { await m.unmount(); }
});

test('#1588 attach by link: a video Start on a connected Zoom also attaches the call; the outcome goes to the share step in the Worker\'s words', async () => {
  const run = async ({ attachMeeting, channels = CHANNELS, provider = null, link = 'https://acme.zoom.us/j/12345678' }) => {
    const s = spies();
    const begun = [];
    const attached = [];
    const recorder = { prepare() {}, release() {}, begin(arg) { begun.push(arg); return 'share'; }, isCapturing: () => false, getSnapshot: () => ({ session: null, phase: 'idle' }) };
    s.props.channelsSource = { ...s.props.channelsSource, attachMeeting: async (...a) => { attached.push(a); return attachMeeting(...a); } };
    const m = await mount({ ...s.props, recorder, initialMode: 'video', channels });
    try {
      await m.type('record-name', 'Dana');
      await m.click('record-consents-verbal');
      if (provider) await m.type('record-provider', provider);
      await m.type('record-link', link);
      await m.click('record-start');
    } finally { await m.unmount(); }
    return { begun, attached, s };
  };
  const ok = await run({ attachMeeting: async () => ({ notice: { code: 'hosted_transcript_only', message: 'Axal will import a transcript only if this connected account hosts the call.' } }) });
  assert.deepEqual(ok.attached, [[41, { session_id: 501, join_url: 'https://acme.zoom.us/j/12345678', provider: 'zoom' }]], 'on the session just made, before the hand-over');
  assert.deepEqual(ok.begun[0].attach, { tone: 'attached', text: 'Axal will import a transcript only if this connected account hosts the call.' });
  assert.equal(ok.begun[0].video, true);
  const no = await run({ attachMeeting: async () => { throw Object.assign(new Error('Axal can import only a call hosted by the account you connected. Record this call in-app instead.'), { status: 409, code: 'meeting_not_hosted' }); } });
  assert.deepEqual(no.begun[0].attach, { tone: 'refused', text: 'Axal can import only a call hosted by the account you connected. Record this call in-app instead.' }, 'its words');
  assert.equal(no.begun.length, 1, 'a refused attach never stops the recording');
  // Not connected, or no link: nothing is attached.
  const off = await run({ attachMeeting: async () => ({}), channels: { ...CHANNELS, connections: [{ provider: 'zoom', connected: false }] } });
  assert.deepEqual([off.attached.length, off.begun[0].attach], [0, null]);
  const noLink = await run({ attachMeeting: async () => ({}), link: '' });
  assert.deepEqual([noLink.attached.length, noLink.begun[0].attach], [0, null]);
});

test('#1588 r2 a Start that becomes busy while its session is being made is refused at the hand-over, in words, and its mic let go', async () => {
  const s = spies();
  const log = [];
  let calls = 0;
  const recorder = {
    prepare() { log.push('prepare'); }, release() { log.push('release'); }, begin() { log.push('begin'); return 'recording'; },
    // Free when Start is pressed; another Start's mic is opening by the hand-over.
    isCapturing: () => { calls += 1; return calls > 1; }, getSnapshot: () => ({ session: { id: 88 }, phase: 'idle' }),
  };
  const m = await mount({ ...s.props, recorder });
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.deepEqual(log, ['prepare', 'release'], 'begin is never called');
    assert.match(m.text(), /You are already recording another session\./);
    assert.equal(m.pr(m.by('record-error-live')).href, '/validate/record/live?session=88');
    assert.equal(s.calls.started.length, 0, 'nothing opens');
  } finally { await m.unmount(); }
});
