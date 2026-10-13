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
const tag = (out, id) => new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(out)?.[0] ?? '';

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

test('the meeting link is drawn for Zoom, Meet and Teams only, and says why it is disabled until the Worker stores it', () => {
  const zoom = render({ initialMode: 'video', channels: CHANNELS });
  assert.match(tag(zoom, 'record-link'), /disabled=""/);
  assert.ok(renderedText(zoom).includes('Not saved yet: the Worker does not store this field.'));
  assert.match(zoom, /data-testid="record-link-note"/);
  assert.doesNotMatch(render({ initialMode: 'phone' }), /data-testid="record-link"/);
  const on = render({ initialMode: 'video', channels: CHANNELS, fields: { ...SETUP_FIELDS, meeting_url: true } });
  assert.ok(tag(on, 'record-link'));
  assert.doesNotMatch(tag(on, 'record-link'), / disabled=""/);
  assert.doesNotMatch(on, /record-link-note/);
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

test('Transcript: live and final models priced by the Worker, a language that waits, and the estimate', () => {
  const out = render();
  const text = renderedText(out);
  assert.ok(text.includes('Nova-3 live · $0.0092/min'));
  assert.ok(text.includes('Flux · $0.0077/min'));
  assert.ok(text.includes('Whisper Large v3 Turbo · $0.0005/min'));
  assert.match(out, /role="radiogroup" aria-label="Live captions"/);
  assert.match(tag(out, 'record-language'), /disabled=""/);
  assert.match(out, />Detect<\/option>/);
  assert.match(out, /data-testid="record-language-note"/);
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
    by, pr, text: () => text(container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); },
    async type(id, value) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const spies = (over = {}) => {
  const calls = { createInterview: [], deleteInterview: [], create: [], started: [] };
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
    assert.equal(s.calls.createInterview.length + s.calls.create.length, 0);
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true);
  } finally { await m.unmount(); }
});

test('a new person is logged, then the session opens; the body is the Worker\'s today and carries no choice it would drop', async () => {
  const s = spies();
  const m = await mount(s.props);
  try {
    await m.type('record-name', '  Dana Ruiz ');
    await m.type('record-company', 'Acme');
    await m.click('record-consents-verbal');
    await m.click('record-start');
    assert.deepEqual(s.calls.createInterview, [[3, { interviewee_name: 'Dana Ruiz', interviewee_company: 'Acme' }]]);
    assert.deepEqual(s.calls.create, [[41, { channel: 'in_person', consent: { status: 'given', method: 'verbal' }, live_model: 'nova', final_model: 'whisper', points: [2, 1] }]]);
    assert.equal(s.calls.started.length, 1);
    assert.equal(s.calls.started[0][0].id, 501);
    assert.equal(s.calls.started[0][1].id, 41, 'the caller gets the interview too, for the session page');
  } finally { await m.unmount(); }
});

test('an interview it was opened on is not logged again', async () => {
  const s = spies();
  const m = await mount({ ...s.props, interview: { id: 7, interviewee_name: 'Dana Ruiz' } });
  try {
    await m.click('record-mode-video');
    await m.click('record-consents-in_app');
    await m.click('record-start');
    assert.equal(s.calls.createInterview.length, 0);
    assert.deepEqual(s.calls.create, [[7, { channel: 'video', consent: { status: 'given', method: 'in_app' }, live_model: 'nova', final_model: 'whisper', points: [2, 1] }]]);
  } finally { await m.unmount(); }
});

test('one send per Start: a second press while the first is in flight does nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = spies();
  s.props.sessions.create = async (id, body) => { s.calls.create.push([id, body]); await gate; return { session: { id: 501 } }; };
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await act(async () => { m.pr(m.by('record-start')).onClick(); m.pr(m.by('record-start')).onClick(); });
    assert.equal(s.calls.createInterview.length, 1, 'one interview');
    assert.equal(s.calls.create.length, 1, 'one session');
    assert.match(m.text(), /Starting…/);
    await act(async () => { release(); await gate; });
  } finally { await m.unmount(); }
});

test('a refused Start prints the Worker\'s words and leaves nothing behind: the interview made for it is deleted', async () => {
  const words = 'Record the interviewee’s consent to be recorded before you start.';
  const s = spies();
  s.props.sessions.create = async () => { throw new Error(words); };
  const m = await mount(s.props);
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-written');
    await m.click('record-start');
    assert.equal(s.calls.createInterview.length, 1);
    assert.deepEqual(s.calls.deleteInterview, [41]);
    assert.equal(s.calls.started.length, 0);
    assert.ok(m.text().includes(words));
    assert.equal(m.pr(m.by('record-error')).role, 'alert');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], undefined, 'and Start can be pressed again');
  } finally { await m.unmount(); }
  const s2 = spies();
  s2.props.sessions.create = async () => { throw new Error('refused'); };
  const m2 = await mount({ ...s2.props, interview: { id: 7, interviewee_name: 'Dana' } });
  try {
    await m2.click('record-consents-verbal');
    await m2.click('record-start');
    assert.deepEqual(s2.calls.deleteInterview, [], 'an interview that was already there is never deleted');
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
    assert.deepEqual(s.calls.create[0][1], { channel: 'text', messages: [{ author: 'Dana', text: 'It takes a day' }, { author: 'Me', text: 'we log it' }], points: [2, 1] });
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
    assert.deepEqual(s.calls.create[0][1].points, [2, 5]);
  } finally { await m.unmount(); }
});

test('an invalid meeting link blocks Start once the Worker stores it', async () => {
  const s = spies();
  const m = await mount({ ...s.props, initialMode: 'video', channels: CHANNELS, fields: { ...SETUP_FIELDS, meeting_url: true } });
  try {
    await m.type('record-name', 'Dana');
    await m.click('record-consents-verbal');
    await m.type('record-link', 'https://evil.test/j/1');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], true);
    assert.ok(m.text().includes('A Zoom link is on zoom.us.'));
    await m.type('record-link', 'https://acme.zoom.us/j/12345678');
    assert.equal(m.pr(m.by('record-start'))['aria-disabled'], undefined);
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
    assert.equal(s.calls.createInterview.length + s.calls.create.length + s.calls.deleteInterview.length, 0);
  } finally { await m.unmount(); }
});
