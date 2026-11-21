/**
 * D6008 (#6008): the interview guide's rules and its states, mounted with a
 * stubbed client (no network): defaults labelled, Eadwyn's hold shown before
 * the press and her questions marked until edited, nothing saved until Accept
 * or Save, AI off still writable, a reader with no tools, and the recording's copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import InterviewGuide from '../src/pages/cycles/InterviewGuide.jsx';
import RecordingGuide from '../src/pages/founder/RecordingGuide.jsx';
import {
  DEFAULTS_LABEL, add, askedLine, authorLine, edit, forSave, groupsOf, holdLine, move,
} from '../src/pages/cycles/interviewGuideModel.js';

const MATERIAL = {
  hypotheses: [{ id: 1, ref: 'h:1', code: 'H1', claim: 'Ops teams match invoices by hand', status: 'untested' }],
  themes: [{ ref: 't:g:1', title: 'Disputes over surcharges', mentions: 2 }],
  segments: [{ id: 1, name: 'Mid-size ops' }],
};
const read = (over = {}) => ({ material: MATERIAL, guide: { questions: [], version: 0 }, defaults: [], ai: { assist: 'on' }, can_write: true, ...over });

function stub(r, extra = {}) {
  const calls = [];
  const log = (name) => (...args) => { calls.push([name, ...args]); return extra[name] ? extra[name](...args) : Promise.resolve({}); };
  return {
    calls,
    read: async () => { calls.push(['read']); return typeof r === 'function' ? r() : r; },
    quoteDraft: log('quoteDraft'), draft: log('draft'), acceptDraft: log('acceptDraft'), save: log('save'),
    takeCopy: log('takeCopy'), markAsked: log('markAsked'),
  };
}

test('model: groups follow the open hypotheses then the unjudged themes; defaults only while nothing is written', () => {
  const g = groupsOf(read(), [{ id: 'a', text: 'Q?', group: { kind: 'theme', ref: 't:g:1' }, by: 'me' }]);
  assert.deepEqual(g.map((x) => [x.tag, x.label]), [['H1', 'Ops teams match invoices by hand'], ['Theme', 'Not judged yet · Disputes over surcharges']]);
  assert.equal(g[1].questions.length, 1);
  const d = groupsOf(read({ material: { hypotheses: [], themes: [], segments: [] }, defaults: ['One?', 'Two?'] }), []);
  assert.equal(d.length, 1);
  assert.equal(d[0].label, DEFAULTS_LABEL);
  assert.deepEqual(d[0].questions.map((q) => [q.text, q.by, !!q.unsaved]), [['One?', 'default', true], ['Two?', 'default', true]]);
  // Once the founder has a question, the defaults are no longer drawn.
  const kept = groupsOf(read({ material: { hypotheses: [], themes: [], segments: [] }, defaults: ['One?'] }), [{ id: 'k', text: 'Mine?', group: { kind: 'other' }, by: 'me' }]);
  assert.deepEqual(kept.map((x) => x.tag), ['Other']);
  // A question whose claim is gone reads under Other, never dropped.
  const o = groupsOf(read(), [{ id: 'z', text: 'Old?', group: { kind: 'hypothesis', ref: 'h:9' }, by: 'me' }]);
  assert.equal(o.at(-1).tag, 'Other');
});

test('model: hold, author, edits and the save body', () => {
  assert.equal(holdLine(40000), 'Holds about $0.04 of AI credit before it runs · unused credit is released');
  assert.equal(holdLine(null), 'The hold could not be worked out.');
  assert.equal(authorLine({ by: 'eadwyn' }), 'Eadwyn’s · until you edit it');
  assert.equal(authorLine({ by: 'me' }), null);
  const list = [{ id: 'a', text: 'A?', by: 'eadwyn', group: { kind: 'other' } }, { id: 'b', text: 'B?', by: 'me', group: { kind: 'other' } }];
  assert.equal(edit(list, 'a', 'A?')[0].by, 'eadwyn', 'unchanged text stays Eadwyn’s');
  assert.equal(edit(list, 'a', 'A2?')[0].by, 'me', 'an edit makes it the founder’s');
  assert.deepEqual(move(list, 'b', -1).map((q) => q.id), ['b', 'a']);
  assert.deepEqual(move(list, 'a', -1).map((q) => q.id), ['a', 'b']);
  assert.equal(add(list, null).length, 3);
  assert.deepEqual(Object.keys(forSave(list)[0]).sort(), ['group', 'id', 'text'], 'a save never sends who wrote it');
  assert.equal(askedLine({ questions: [{ id: 'a' }, { id: 'b' }], asked: ['a', 'gone'] }), '1 of 2 asked');
});

test('the guide shows the hold before the press, draws Eadwyn’s questions as hers, and saves nothing until Accept', async () => {
  const api = stub(read(), {
    quoteDraft: async () => ({ estimate: { hold_microusd: 40000, model: 'm' } }),
    draft: async () => ({ draft: { questions: [{ id: 'p1', group: 'h:1', text: 'What happens when an invoice does not match?' }] }, receipt: { payload: 'x', signature: 'y' } }),
    acceptDraft: async () => ({ guide: { questions: [{ id: 'p1', group: { kind: 'hypothesis', ref: 'h:1' }, text: 'What happens when an invoice does not match?', by: 'eadwyn' }], version: 1 } }),
  });
  const m = await mountContracts(React.createElement(InterviewGuide, { projectId: 1, api }), '/validate/customer-research');
  try {
    await m.flush(); await m.flush();
    assert.match(m.text(), /Holds about \$0\.04 of AI credit before it runs/);
    assert.equal(api.calls.filter((c) => c[0] === 'draft').length, 0, 'nothing runs before the press');
    await m.click('Draft questions'); await m.flush();
    assert.deepEqual(api.calls.find((c) => c[0] === 'draft').slice(1), [1, null, { hold_microusd: 40000, model: 'm' }], 'the run carries the hold shown');
    assert.match(m.text(), /What happens when an invoice does not match\?/);
    assert.match(m.text(), /Eadwyn’s · until you edit it/);
    assert.equal(api.calls.filter((c) => c[0] === 'acceptDraft' || c[0] === 'save').length, 0, 'a draft saves nothing');
    await m.click('Accept'); await m.flush();
    const acc = api.calls.find((c) => c[0] === 'acceptDraft');
    assert.deepEqual(acc.slice(1), [1, { payload: 'x', signature: 'y' }, ['p1'], {}, 0]);
    assert.match(m.text(), /Eadwyn’s · until you edit it/, 'an accepted question stays hers until edited');
  } finally { await m.unmount(); }
});

test('no open hypothesis: the defaults are labelled; AI off: the switch’s note, no draft, still writable', async () => {
  const api = stub(read({ material: { hypotheses: [], themes: [], segments: [] }, defaults: ['Tell me about the last time this came up at work.'], ai: { assist: 'off' } }));
  const m = await mountContracts(React.createElement(InterviewGuide, { projectId: 1, api }), '/validate/customer-research');
  try {
    await m.flush();
    const t = m.text();
    assert.match(t, /Discovery questions · no open hypothesis yet/);
    assert.match(t, /Default question/);
    assert.match(t, /AI assistance is off for this venture\./);
    assert.match(t, /The guide stays writable by hand\./);
    assert.doesNotMatch(t, /Draft questions/);
    assert.equal(api.calls.filter((c) => c[0] === 'quoteDraft').length, 0, 'AI off quotes nothing');
    await m.click('Keep these questions');
    await m.click('Save the guide'); await m.flush();
    const save = api.calls.find((c) => c[0] === 'save');
    assert.equal(save[2][0].text, 'Tell me about the last time this came up at work.');
    assert.equal(save[3], 0, 'the save names the version read');
  } finally { await m.unmount(); }
});

test('a reader with no write gate sees the questions and no tools; a failed read says Unavailable', async () => {
  const q = { id: 'a1', text: 'Who else is involved?', group: { kind: 'hypothesis', ref: 'h:1' }, by: 'me' };
  const ro = await mountContracts(React.createElement(InterviewGuide, { projectId: 1, api: stub(read({ can_write: false, guide: { questions: [q], version: 3 } })) }));
  try {
    await ro.flush();
    assert.match(ro.text(), /Who else is involved\?/);
    for (const tool of ['Edit', 'Draft questions', '+ Add a question', 'Save the guide']) {
      assert.ok(!ro.nodes().some((n) => n.tagName === 'BUTTON' && ro.props(n)?.children === tool), `no ${tool}`);
    }
  } finally { await ro.unmount(); }
  const bad = { read: async () => { throw Object.assign(new Error('x'), { status: 503 }); } };
  const u = await mountContracts(React.createElement(InterviewGuide, { projectId: 1, api: bad }));
  try { await u.flush(); assert.match(u.text(), /The guide couldn’t be read\. Recording still works\./); }
  finally { await u.unmount(); }
});

test('while recording: the copy is taken for this interview, one question per card, Mark asked changes the copy', async () => {
  const copy = { interview_id: 7, questions: [{ id: 'a', text: 'First?' }, { id: 'b', text: 'Second?' }], asked: [], copied_at: '2026-11-15 14:00:00' };
  const api = stub(null, {
    takeCopy: async () => ({ copy }),
    markAsked: async (_p, _i, id, on) => ({ copy: { ...copy, asked: on ? [id] : [] } }),
  });
  const m = await mountContracts(React.createElement(RecordingGuide, { projectId: 1, interviewId: 7, onClose() {}, api }));
  try {
    await m.flush();
    assert.deepEqual(api.calls.find((c) => c[0] === 'takeCopy').slice(1), [1, 7]);
    assert.match(m.text(), /Question 1 of 2 · 0 of 2 asked/);
    assert.match(m.text(), /First\?/);
    await m.click('Mark asked'); await m.flush();
    assert.deepEqual(api.calls.find((c) => c[0] === 'markAsked').slice(1), [1, 7, 'a', true]);
    assert.match(m.text(), /Second\?/, 'moves to the next question');
    assert.match(m.text(), /1 of 2 asked/);
  } finally { await m.unmount(); }
});

test('wiring: the lightbox, the recording view and Customer research mount the guide', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  assert.match(read('pages/founder/RecordLightbox.jsx'), /<InterviewGuide projectId=\{projectId\} \/>/);
  assert.match(read('pages/founder/RecordingView.jsx'), /<RecordingGuide projectId=\{s\.project_id\} interviewId=\{st\?\.interview\?\.id\}/);
  assert.match(read('pages/cycles/defs/validate.jsx'), /<PrepareQuestions projectId=\{ctx\.projectId\} \/>/);
});
