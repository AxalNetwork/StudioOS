// D4533 (#4533): the owner's A3 and the company side of B1 (2026-11-09).
//
//   1. A3: when the release decision (`freshness.evaluation.reused`) says its results are the ones a published
//      version was released on, the HQ Publish card says "Results reused from vK", with how many of the
//      required runs. No decision, or nothing reused, draws no line: never a guess.
//   2. B1, company side: Team › Skills' New skill sheet publishes with an optional release note, sent as
//      `release_note` (trimmed; blank is none), and the skill page's Version history shows each version's
//      note from the Worker's `release_note`, "Not recorded" when none was written.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_reuse_company_note_4533.test.mjs
//
// No request leaves the test: every client is stubbed at fetch or by method. Nothing is published anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { adminHqSkillsApi as skillsApi } from '../src/lib/api/adminHqSkills.js';
import { Editor } from '../src/pages/hq/aiAgents/HqAiAgentsPage.jsx';
import { reusedLine } from '../src/pages/hq/aiAgents/skillLifecycleModel.js';
import { NewSkillSheet } from '../src/pages/team/SkillSheets.jsx';
import { SkillPage } from '../src/pages/team/SkillsTab.jsx';
import { RELEASE_NOTE_MAX, fromWorkerSkillPage, releaseNoteBody, skillRefusalWords } from '../src/pages/team/skillsModel.js';

const h = React.createElement;
const settle = async (ui) => { await ui.flush(); await ui.flush(); };
const find = (ui, id) => ui.nodes().filter((n) => ui.props(n)?.['data-testid'] === id);
const txt = (n) => n.textContent || (n.childNodes ?? []).map(txt).join('');
const change = async (ui, id, value) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); await act(async () => ui.props(n).onChange({ target: { value } })); };
const press = async (ui, id) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); assert.ok(!ui.props(n).disabled, `${id} is disabled`); await act(async () => ui.props(n).onClick({ stopPropagation() {} })); await settle(ui); };
function stub(obj, fns) {
  const old = {}; for (const k of Object.keys(fns)) { old[k] = obj[k]; obj[k] = fns[k]; }
  return () => { for (const k of Object.keys(old)) obj[k] = old[k]; };
}

// ── A3: "results reused from vK" ───────────────────────────────────────────

const decision = (reused, over = {}) => ({ ready: false, blocking: ['needs_approval'], evaluation: { pass: 4, total: 4, not_evaluated: 0, meets_bar: true, reused }, ...over });

test('A3, the model: the line names the version and the runs; nothing reused, or no decision, is no line', () => {
  // Mutation checked: the version or the counts left out of the sentence → these fail.
  assert.equal(reusedLine(decision({ version: 1, results: 4 })), 'Results reused from v1: 4 of 4 required runs were recorded for v1’s release and were not run again.');
  assert.match(reusedLine(decision({ version: 3, results: 2 })), /^Results reused from v3: 2 of 4 required runs/);
  assert.match(reusedLine({ evaluation: { reused: { version: 2, results: 1 } } }), /^Results reused from v2: 1 required runs/, 'no total read: the count alone');
  // Mutation checked: the guard dropped → a decision with nothing reused draws a line and these fail.
  for (const f of [null, undefined, {}, decision(null), decision(undefined), decision({ version: 1, results: 0 }), decision({ version: '1', results: 4 }), decision({ version: 1 })]) {
    assert.equal(reusedLine(f), null, JSON.stringify(f));
  }
});

const detail = (freshness) => ({
  skill: { uid: 'sk1', name: 'Investor update', purpose: 'Draft the update', steps: ['Read'], tools: [], output_kind: 'draft', status: 'draft', version: 2, agents: 1, radar: { axes: [] }, area: null, level: null },
  reviewers: [],
  review: { open: null, approved: false, history: [] },
  cases: [],
  evals: { cases: [], models: [], pass: 4, total: 4, meets_bar: true, last_run: null, pass_bar: { pass: 9, of: 10 } },
  freshness,
  versions: [{ version: 2, published_at: '2026-11-09 10:00:00', by: null, release_note: null }, { version: 1, published_at: '2026-10-01 09:00:00', by: null, release_note: null }],
  retired: null,
});
async function editor(data) {
  const restore = stub(skillsApi, { get: async () => data });
  const ui = await mountContracts(h(Editor, { view: { skill: 'sk1' }, viewerUid: 'u-sue' }), '/hq/ai-agents/skills/sk1/edit');
  await settle(ui);
  return { ui, restore };
}

test('A3: the HQ Publish card tells the reviewer the results are reused from vK; with none reused it says nothing of it', async () => {
  const a = await editor(detail(decision({ version: 1, results: 4 })));
  try {
    // Mutation checked: the line not drawn in the Publish card → this fails.
    assert.deepEqual(find(a.ui, 'skill-publish-reused').map(txt), ['Results reused from v1: 4 of 4 required runs were recorded for v1’s release and were not run again.']);
  } finally { await a.ui.unmount(); a.restore(); }
  const b = await editor(detail(decision(null)));
  try {
    assert.ok(find(b.ui, 'skill-publish').length, 'the Publish card is drawn');
    assert.equal(find(b.ui, 'skill-publish-reused').length, 0);
  } finally { await b.ui.unmount(); b.restore(); }
});

// ── B1, company side: Team › Skills ────────────────────────────────────────

test('B1, the model: the note body, its refusals in words, and each version\'s note from `release_note`', () => {
  assert.deepEqual(releaseNoteBody('   '), { ok: true, note: null });
  assert.deepEqual(releaseNoteBody(undefined), { ok: true, note: null });
  assert.deepEqual(releaseNoteBody(' First release.\r\nNo forecasts. '), { ok: true, note: 'First release.\nNo forecasts.' });
  assert.equal(releaseNoteBody('x'.repeat(RELEASE_NOTE_MAX)).ok, true);
  // Mutation checked: the length check dropped → this fails.
  assert.deepEqual(releaseNoteBody('x'.repeat(RELEASE_NOTE_MAX + 1)), { ok: false, problem: 'Keep the release note to 2000 characters.' });
  assert.equal(skillRefusalWords('release_note_too_long'), 'Keep the release note to 2000 characters.');
  assert.equal(skillRefusalWords('release_note_invalid'), 'The release note must be text.');
  const page = fromWorkerSkillPage({
    skill: { uid: 'sk1', name: 'Board pack', scope: 'company', status: 'published', version: 2, steps: ['Read'] },
    versions: [{ version: 2, published_at: '2026-11-12', by: null, release_note: 'Adds the asks.' }, { version: 1, published_at: '2026-11-01', by: null, release_note: null }],
  });
  // Mutation checked: `release_note` not read (only `note`) → v2 reads null and this fails.
  assert.deepEqual(page.skill.versions.map((v) => [v.version, v.note]), [[2, 'Adds the asks.'], [1, null]]);
});

test('B1: the skill page\'s Version history shows each note, and "Not recorded" for a version without one', () => {
  const block = { available: true, value: { can_edit: true, skill: { uid: 'sk1', name: 'Board pack', scope: 'company', status: 'published', version: 2, steps: ['Read'], versions: [{ version: 2, published_at: '2026-11-12', note: 'Adds the asks.' }, { version: 1, published_at: '2026-11-01', note: null }] } } };
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(SkillPage, { block, agentsBlock: { available: true, value: { agents: [] } }, onBack() {}, onAssign() {} })));
  const notes = [...out.matchAll(/data-testid="skill-version-note"[^>]*>(.*?)<\/span>(?=<span)/g)].map((m) => renderedText(m[1]));
  // Mutation checked: '—' back for a missing note → the second reads "—" and this fails.
  assert.deepEqual(notes, ['Adds the asks.', 'Not recorded']);
});

/** The New skill sheet over a stubbed fetch (the taxonomy, the tool choices, create and publish), filled in to publish. */
async function sheet({ publishStatus = 200, publishBody = { skill: { uid: 'sk9', status: 'published' } } } = {}) {
  const seen = [];
  const saved = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const path = new URL(String(u), 'http://x').pathname;
    const method = (init.method || 'GET').toUpperCase();
    seen.push({ method, path, sent: init.body ? JSON.parse(init.body) : null });
    const [status, body] = path === '/api/skills/taxonomy' ? [200, { categories: [{ slug: 'finance', label: 'Finance', skills: [{ slug: 'fp_and_a', label: 'FP&A' }] }] }]
      : method === 'POST' && path === '/api/teams/skills' ? [201, { skill: { uid: 'sk9', status: 'draft' } }]
        : method === 'POST' && path === '/api/teams/skills/sk9/publish' ? [publishStatus, publishBody]
          : [200, {}];
    return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const ui = await mountContracts(h(NewSkillSheet, { scope: { kind: 'company', company: { uid: 'nw1' } }, onClose() {}, onSaved: (s) => saved.push(s) }), '/team');
  await settle(ui);
  await change(ui, 'new-skill-name', 'Board pack');
  await change(ui, 'new-skill-description', 'Reads the quarter.');
  await change(ui, 'skill-step-0', 'Read the quarter');
  await change(ui, 'skill-tax-skill', 'fp_and_a');
  await press(ui, 'skill-tax-add');
  const writes = () => seen.filter((x) => x.method !== 'GET');
  return { ui, writes, saved, done: async () => { await ui.unmount(); globalThis.fetch = previous; } };
}

test('B1: New skill › Publish sends the trimmed release note with the publish', async () => {
  const s = await sheet();
  try {
    await change(s.ui, 'new-skill-release-note', '  First release: reads the quarter.\r\nNo forecasts.  ');
    await press(s.ui, 'new-skill-publish');
    assert.deepEqual(s.writes().map((x) => `${x.method} ${x.path}`), ['POST /api/teams/skills', 'POST /api/teams/skills/sk9/publish']);
    // Mutation checked: the sheet publishing with `{}` as before → no note is sent and this fails.
    assert.deepEqual(s.writes()[1].sent, { release_note: 'First release: reads the quarter.\nNo forecasts.' });
    assert.equal(s.writes()[0].sent.release_note, undefined, 'the note is the version\'s, never the draft\'s');
    assert.deepEqual(s.saved.map((x) => x?.uid), ['sk9']);
  } finally { await s.done(); }
});

test('B1: a blank note publishes with none; Save draft never sends one', async () => {
  const s = await sheet();
  try {
    await change(s.ui, 'new-skill-release-note', '   ');
    await press(s.ui, 'new-skill-publish');
    // Mutation checked: the sheet sending the note untrimmed → '   ' is sent and this fails.
    assert.deepEqual(s.writes()[1].sent, {});
  } finally { await s.done(); }
  const d = await sheet();
  try {
    await change(d.ui, 'new-skill-release-note', 'Not for a draft.');
    await press(d.ui, 'new-skill-draft');
    assert.deepEqual(d.writes().map((x) => `${x.method} ${x.path}`), ['POST /api/teams/skills']);
  } finally { await d.done(); }
});

test('B1: an over-long note is told before anything is saved; a refused publish says why in the sheet\'s words', async () => {
  const s = await sheet();
  try {
    await change(s.ui, 'new-skill-release-note', 'x'.repeat(RELEASE_NOTE_MAX + 1));
    await press(s.ui, 'new-skill-publish');
    // Mutation checked: the sheet's own length check dropped → a draft is written first and this fails.
    assert.deepEqual(s.writes(), []);
    assert.match(s.ui.text(), /Keep the release note to 2000 characters\./);
  } finally { await s.done(); }
  const r = await sheet({ publishStatus: 400, publishBody: { error: 'release_note_too_long', message: 'Worker text: LEAK' } });
  try {
    await change(r.ui, 'new-skill-release-note', 'A note the Worker refuses.');
    await press(r.ui, 'new-skill-publish');
    assert.match(r.ui.text(), /Saved as a draft\. It could not be published: Keep the release note to 2000 characters\./);
    assert.doesNotMatch(r.ui.text(), /LEAK/);
    assert.deepEqual(r.saved, []);
  } finally { await r.done(); }
});
