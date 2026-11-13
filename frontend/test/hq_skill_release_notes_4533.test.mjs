// D4533 (#4533, B1 of the owner's decisions, 2026-11-09): release notes on a From Axal skill's versions.
// The lifecycle publishes the draft with an optional note through the single publish, and lists each
// version's note, "Not recorded" when none was written (never blank, never a made-up note). A refused
// publish shows the sentence kept for its code; the release decision (`freshness`) says before the press
// whether the Worker would refuse.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_skill_release_notes_4533.test.mjs
//
// No request leaves the test: every client method is stubbed. Nothing is published anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { adminHqSkillsApi as skillsApi } from '../src/lib/api/adminHqSkills.js';
import { teamAgentsApi } from '../src/lib/api/teamAgents.js';
import { Editor } from '../src/pages/hq/aiAgents/HqAiAgentsPage.jsx';
import { SKILL_REFUSALS, skillRefusal } from '../src/pages/hq/aiAgents/refusals.js';
import { RELEASE_NOTE_MAX, publishState, releaseNotePayload, releaseNoteText } from '../src/pages/hq/aiAgents/skillLifecycleModel.js';

const h = React.createElement;
const settle = async (ui) => { await ui.flush(); await ui.flush(); };
const find = (ui, id) => ui.nodes().filter((n) => ui.props(n)?.['data-testid'] === id);
const txt = (n) => n.textContent || (n.childNodes ?? []).map(txt).join('');
const type = async (ui, id, value) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); await act(async () => ui.props(n).onChange({ target: { value } })); };
const press = async (ui, id) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); assert.ok(!ui.props(n).disabled, `${id} is disabled`); await act(async () => ui.props(n).onClick({ stopPropagation() {} })); await settle(ui); };
const refused = (status, error, extra = {}) => Object.assign(new Error('RAW socket hang up'), { status, data: { error, ...extra } });
function stub(obj, fns) {
  const old = {}; for (const k of Object.keys(fns)) { old[k] = obj[k]; obj[k] = fns[k]; }
  return () => { for (const k of Object.keys(old)) obj[k] = old[k]; };
}

const READY = { ready: true, blocking: [], evaluation: { pass: 2, total: 2, not_evaluated: 0, meets_bar: true } };
const detail = ({ skill: skillOver, ...over } = {}) => ({
  skill: { uid: 'sk1', name: 'Investor update', purpose: 'Draft the update', steps: ['Read'], tools: [], output_kind: 'draft', status: 'draft', version: 2, agents: 2, radar: { axes: [] }, area: null, level: null, ...skillOver },
  reviewers: [],
  review: { open: null, approved: true, history: [] },
  cases: [],
  evals: { cases: [], models: [], pass: 2, total: 2, meets_bar: true, last_run: null, pass_bar: { pass: 9, of: 10 } },
  freshness: READY,
  versions: [
    { version: 2, published_at: '2026-11-09 10:00:00', by: { uid: 'u-sue', name: 'Sue Super' }, release_note: 'Adds the asks.\nNo forecasts.' },
    { version: 1, published_at: '2026-10-01 09:00:00', by: null, release_note: null },
  ],
  retired: null,
  ...over,
});
async function editor(data, publish, reads = []) {
  const restores = [stub(skillsApi, { get: async (uid) => { reads.push(uid); return data; } }), stub(teamAgentsApi, { publishSkill: publish ?? (async () => ({})) })];
  const ui = await mountContracts(h(Editor, { view: { skill: 'sk1' }, viewerUid: 'u-sue' }), '/hq/ai-agents/skills/sk1/edit');
  await settle(ui);
  return { ui, restore: () => restores.forEach((r) => r()) };
}

test('the model: a blank note is none, an over-long one is told before sending, a missing one reads "Not recorded"', () => {
  assert.deepEqual(releaseNotePayload('   '), { ok: true, note: null });
  assert.deepEqual(releaseNotePayload(' Adds the asks.\r\n '), { ok: true, note: 'Adds the asks.' });
  assert.equal(releaseNotePayload('x'.repeat(RELEASE_NOTE_MAX + 1)).ok, false);
  assert.equal(releaseNotePayload('x'.repeat(RELEASE_NOTE_MAX)).ok, true);
  assert.equal(releaseNoteText({ release_note: null }), 'Not recorded');
  assert.equal(releaseNoteText({ release_note: '  ' }), 'Not recorded');
  assert.equal(releaseNoteText({}), 'Not recorded');
  assert.equal(releaseNoteText({ release_note: 'Adds the asks.' }), 'Adds the asks.');
  assert.deepEqual(publishState(null), { known: false, ready: false, why: null }, 'no decision read is unknown, never ready');
  assert.deepEqual(publishState(READY), { known: true, ready: true, why: null });
  assert.equal(publishState({ ready: false, blocking: ['needs_approval'] }).why, SKILL_REFUSALS.needs_approval);
  assert.match(publishState({ ready: false, blocking: ['evaluation_incomplete'], evaluation: { not_evaluated: 3, total: 4 } }).why, /3 of 4/);
  assert.equal(skillRefusal(refused(400, 'release_note_too_long')), SKILL_REFUSALS.release_note_too_long);
  assert.equal(skillRefusal(refused(400, 'release_note_invalid')), SKILL_REFUSALS.release_note_invalid);
});

test('each version shows its note, and a version without one reads "Not recorded"', async () => {
  const { ui, restore } = await editor(detail());
  try {
    const rows = find(ui, 'skill-release-note-row').map(txt);
    assert.equal(rows.length, 2);
    assert.match(rows[0], /v2 · 2026-11-09 10:00:00 · Sue Super/);
    assert.match(rows[0], /Adds the asks\.\nNo forecasts\./);
    assert.match(rows[1], /v1 · 2026-10-01 09:00:00 · Not recorded/);
    assert.match(rows[1], /Not recorded$/);
  } finally { await ui.unmount(); restore(); }
  const none = await editor(detail({ versions: [], skill: { version: null } }));
  try {
    assert.match(txt(find(none.ui, 'skill-release-notes')[0]), /No version has been published yet\./);
    assert.match(txt(find(none.ui, 'skill-publish-go')[0]), /Publish v1/);
  } finally { await none.ui.unmount(); none.restore(); }
});

test('Publish sends the trimmed note, or none when blank, and reads the skill again', async () => {
  const calls = [];
  const publish = async (...a) => { calls.push(a); return { skill: { version: 3 } }; };
  const reads = [];
  const { ui, restore } = await editor(detail(), publish, reads);
  try {
    assert.match(txt(find(ui, 'skill-publish-state')[0]), /can be published as v3/);
    await type(ui, 'skill-release-note', '  Tightens step two.  ');
    await press(ui, 'skill-publish-go');
    await settle(ui);
    assert.deepEqual(reads, ['sk1', 'sk1'], 'the skill is read again after a publish');
    assert.equal(ui.props(find(ui, 'skill-release-note')[0]).value, '', 'the note is cleared after a publish');
    await press(ui, 'skill-publish-go');
    assert.deepEqual(calls, [['sk1', { releaseNote: 'Tightens step two.' }], ['sk1', { releaseNote: null }]]);
  } finally { await ui.unmount(); restore(); }
});

test('an over-long note is told before sending; a refusal shows its sentence, never the error text', async () => {
  const calls = [];
  const { ui, restore } = await editor(detail(), async (...a) => { calls.push(a); throw refused(409, 'publish_conflict'); });
  try {
    await type(ui, 'skill-release-note', 'x'.repeat(RELEASE_NOTE_MAX + 1));
    await press(ui, 'skill-publish-go');
    assert.equal(calls.length, 0);
    assert.match(txt(find(ui, 'skill-release-note-problem')[0]), /2000 characters/);
    await type(ui, 'skill-release-note', 'Fine.');
    await press(ui, 'skill-publish-go');
    assert.equal(calls.length, 1);
    assert.match(ui.text(), new RegExp(SKILL_REFUSALS.publish_conflict.slice(0, 40)));
    assert.doesNotMatch(ui.text(), /RAW/);
  } finally { await ui.unmount(); restore(); }
});

test('the release decision says why before the press; a published or retired skill offers no Publish', async () => {
  const blocked = await editor(detail({ freshness: { ready: false, blocking: ['needs_approval'], evaluation: READY.evaluation } }));
  try {
    assert.match(txt(find(blocked.ui, 'skill-publish-state')[0]), new RegExp(SKILL_REFUSALS.needs_approval.slice(0, 40)));
    assert.equal(blocked.ui.props(find(blocked.ui, 'skill-publish-go')[0]).disabled, true);
  } finally { await blocked.ui.unmount(); blocked.restore(); }
  const unknown = await editor(detail({ freshness: undefined }));
  try {
    assert.match(txt(find(unknown.ui, 'skill-publish-state')[0]), /server decides/);
    assert.equal(unknown.ui.props(find(unknown.ui, 'skill-publish-go')[0]).disabled, false, 'no decision read: the Worker decides');
  } finally { await unknown.ui.unmount(); unknown.restore(); }
  for (const status of ['published', 'retired']) {
    const r = await editor(detail({ skill: { status } }));
    try {
      assert.equal(find(r.ui, 'skill-publish-go').length, 0, status);
      assert.equal(find(r.ui, 'skill-release-note-row').length, 2, `${status}: the notes are still shown`);
    } finally { await r.ui.unmount(); r.restore(); }
  }
});

test('the client sends release_note only when there is one', async () => {
  const previous = globalThis.fetch;
  const storage = globalThis.localStorage;
  if (!storage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sent = [];
  globalThis.fetch = async (url, options = {}) => { sent.push([String(url), options.body]); return { ok: true, status: 200, statusText: '200', headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' }; };
  try {
    await teamAgentsApi.publishSkill('sk1', { releaseNote: 'Adds the asks.' });
    await teamAgentsApi.publishSkill('sk1', { releaseNote: null });
    await teamAgentsApi.publishSkill('sk1');
  } finally { globalThis.fetch = previous; if (!storage) globalThis.localStorage = storage; }
  assert.deepEqual(sent.map(([u, b]) => [/\/teams\/skills\/sk1\/publish$/.test(u), b]), [[true, '{"release_note":"Adds the asks."}'], [true, '{}'], [true, '{}']]);
});

// Mutation checked: 11 of 11 caught. Each was applied by a script, this file run, and the source restored.
//   - SkillLifecycle.jsx: Publish sends `{}` instead of the note → test 3.
//   - SkillLifecycle.jsx: Publish not disabled when the decision blocks → test 5.
//   - SkillLifecycle.jsx: no reload after a publish → test 3.
//   - SkillLifecycle.jsx: the Publish panel on every status → test 5.
//   - SkillLifecycle.jsx: the release notes hidden unless Publish is offered → test 5.
//   - skillLifecycleModel.js: the note not trimmed → tests 1 and 3.
//   - skillLifecycleModel.js: the length check removed → tests 1 and 4.
//   - skillLifecycleModel.js: a missing note shown blank instead of "Not recorded" → test 1.
//   - skillLifecycleModel.js: no decision read as ready → tests 1 and 5.
//   - teamAgents.js: `release_note` always sent (null when none) → test 6.
//   - refusals.js: `release_note_too_long` without its sentence → test 1.
// A twelfth, clearing the note by hand after a publish, survived and was removed from the source: the
// reload draws the panel afresh, which is what test 3 checks.
