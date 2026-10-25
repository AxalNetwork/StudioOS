// D1031 / #2872: My events part 1, the fixes. The editor's one publish action
// (mounted, with Worker-shaped replies), its dialog, and the audience roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import { publishAction } from '../src/pages/events/eventOrganiserModel.js';

const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const editorPath = 'pages/events/EventEditorPage.jsx';
const modelPath = 'pages/events/eventOrganiserModel.js';
const editor = read(editorPath);
const model = read(modelPath);
const key = '__myEventsFixesD1031';

const event = {
  id: 42, slug: 'fixture-talk', title: 'Fixture talk', type: 'workshop', summary: '', description: '',
  starts_at: '2099-01-01T12:00:00Z', ends_at: null, timezone: 'UTC', location_kind: 'virtual',
  location_text: '', location_url: '', cover_url: '', capacity: null, waitlist_enabled: true,
  approval_required: false, visibility: 'unlisted', status: 'draft', audience_rules: {},
};

function prepare({ visibility = 'unlisted', status = 'draft', refuse = null } = {}) {
  const fixture = { calls: [], toasts: [] };
  fixture.toast = { toast: null, showToast: (t) => fixture.toasts.push(t) };
  fixture.api = {
    get: async () => ({ event: { ...event, visibility, status }, agenda: [] }),
    update: async (id, payload) => { fixture.calls.push(['update', id, payload.visibility]); return { event: { ...event, visibility, status } }; },
    submitReview: async (id) => {
      fixture.calls.push(['submitReview', id]);
      if (refuse) throw new Error(refuse);
      // The Worker's reply: a public event queues, any other publishes.
      return { event: { ...event, visibility, status: visibility === 'public' ? 'pending_review' : 'published' } };
    },
  };
  globalThis[key] = fixture;
  return fixture;
}
const stub = (source, modelSource) => source
  .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
  .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
  .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;')
  .replace(/import \{ publishAction \} from [^;]+;/, `const { publishAction } = globalThis.${key}.model;`)
  .replace(/import\.meta\.env/g, '({})');

async function mount(source, modelSource) {
  globalThis[key].model = await sourceModule(modelSource, modelPath);
  const Page = (await sourceModule(stub(source, modelSource), editorPath)).default;
  return mountForm(h(Routes, { location: '/events/42/edit' }, h(Route, { path: '/events/:id/edit', element: h(Page) })), { modal: true });
}

test('D1031 the model offers Publish for unlisted and private, Send for review for public, and nothing once submitted', () => {
  for (const visibility of ['unlisted', 'private']) for (const status of ['draft', 'rejected']) {
    const a = publishAction(visibility, status);
    assert.equal(a.kind, 'publish');
    assert.equal(a.label, 'Publish');
    assert.match(a.body, /live now, with no admin review/);
    assert.match(a.body, /Nobody is told/);
  }
  assert.match(publishAction('unlisted', 'draft').body, /Anyone with its link/);
  assert.match(publishAction('private', 'draft').body, /Only people you invite/);
  const review = publishAction('public', 'draft');
  assert.equal(review.kind, 'review');
  assert.equal(review.label, 'Send for review');
  assert.match(review.body, /admin review queue/);
  assert.equal(publishAction('public', 'rejected').label, 'Send for review');
  for (const status of ['pending_review', 'published', 'cancelled']) for (const visibility of ['public', 'unlisted', 'private']) {
    assert.equal(publishAction(visibility, status), null, `${visibility} ${status}`);
  }
  assert.equal(publishAction('secret', 'draft'), null);
});

async function publishScenario(source = editor, modelSource = model) {
  for (const [visibility, label, done, next] of [
    ['unlisted', 'Publish', 'Event published.', 'published'],
    ['private', 'Publish', 'Event published.', 'published'],
    ['public', 'Send for review', 'Sent for admin review.', 'pending_review'],
  ]) {
    const fixture = prepare({ visibility });
    const ui = await mount(source, modelSource);
    try {
      await ui.flush();
      assert.equal(Boolean(ui.by('event-publish')), true, `${visibility}: the action is offered`);
      assert.equal(ui.text().includes(visibility === 'public' ? 'Publish' : 'Send for review'), false, `${visibility}: only its own action`);
      await ui.click(label);
      assert.equal(Boolean(ui.by('event-publish-dialog')), true, `${visibility}: the action opens a dialog`);
      assert.equal(fixture.calls.length, 0, `${visibility}: nothing is saved before the confirm`);
      assert.ok(ui.text().includes(publishAction(visibility, 'draft').body), `${visibility}: the dialog says what happens and who is told`);
      await ui.click('Cancel');
      assert.equal(Boolean(ui.by('event-publish-dialog')), false, 'Cancel closes it');
      assert.equal(fixture.calls.length, 0, 'Cancel saves nothing');
      await ui.click(label);
      await act(async () => ui.props(ui.by('event-publish-confirm')).onClick());
      await ui.flush();
      assert.deepEqual(fixture.calls, [['update', '42', visibility], ['submitReview', '42']], `${visibility}: save, then submit`);
      assert.equal(Boolean(ui.by('event-publish-dialog')), false, `${visibility}: the dialog closes`);
      assert.deepEqual(fixture.toasts.at(-1), { kind: 'success', msg: done });
      assert.equal(Boolean(ui.by('event-publish')), false, `${visibility}: the reply's ${next} status leaves nothing to submit`);
      if (next === 'pending_review') assert.match(ui.text(), /Pending admin review/);
    } finally { await ui.unmount(); }
  }
}

async function refusalScenario(source = editor, modelSource = model) {
  const fixture = prepare({ visibility: 'private', refuse: 'Fixture refusal.' });
  const ui = await mount(source, modelSource);
  try {
    await ui.flush();
    await ui.click('Publish');
    await act(async () => ui.props(ui.by('event-publish-confirm')).onClick());
    await ui.flush();
    assert.equal(Boolean(ui.by('event-publish-dialog')), true, 'a refusal stays in the dialog');
    assert.match(ui.text(), /Fixture refusal\./);
    assert.equal(fixture.toasts.length, 0, 'no success toast');
    assert.equal(Boolean(ui.by('event-publish')), true, 'the action is still offered');
  } finally { await ui.unmount(); }
}

async function submittedScenario(source = editor, modelSource = model) {
  for (const [visibility, status] of [['public', 'published'], ['public', 'pending_review'], ['unlisted', 'published'], ['private', 'cancelled']]) {
    prepare({ visibility, status });
    const ui = await mount(source, modelSource);
    try {
      await ui.flush();
      assert.equal(Boolean(ui.by('event-publish')), false, `${visibility} ${status}`);
    } finally { await ui.unmount(); }
  }
}

test('D1031 the editor publishes unlisted and private, sends public for review, each through a dialog', () => publishScenario());
test('D1031 a refused publish keeps the dialog open with the reason', () => refusalScenario());
test('D1031 a submitted, live or cancelled event offers no action', () => submittedScenario());

test('D1031 the manage page offers the Worker\'s audience roles, advisor included', () => {
  const manage = read('pages/events/EventManagePage.jsx');
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/eventOrganiser.ts', import.meta.url), 'utf8');
  const page = JSON.parse(manage.match(/^const roles = (\[[^\]]+\]);/m)[1].replace(/'/g, '"'));
  const roles = JSON.parse(worker.match(/^export const EVENT_ROLES = (\[[^\]]+\]) as const;/m)[1].replace(/'/g, '"'));
  assert.deepEqual(page, roles);
  assert.ok(page.includes('advisor'));
});

test('D1031 the mounted checks catch each regression and accept the restored code', async () => {
  const groups = [
    [publishScenario, 'editor', [
      ['setPublishing(action); };', 'setPublishing(null); confirmPublish(); };'],
      ['setStatus(next);', ''],
      ['<p>{publishing.body}</p>', '<p />'],
      ['onClick={confirmPublish}', 'onClick={closePublish}'],
    ]],
    [publishScenario, 'model', [
      ["if (visibility === 'unlisted') {", "if (visibility === 'never') {"],
      ["if (visibility === 'private') {", "if (visibility === 'never') {"],
      ["kind: 'review', label: 'Send for review'", "kind: 'review', label: 'Submit for review'"],
    ]],
    [refusalScenario, 'editor', [['setPublishError(e?.message', 'setPublishing(null); setPublishError(e?.message']]],
    [submittedScenario, 'model', [["if (status !== 'draft' && status !== 'rejected') return null;", '']]],
  ];
  for (const [verify, which, mutants] of groups) {
    for (const [before, after] of mutants) {
      const original = which === 'editor' ? editor : model;
      assert.ok(original.includes(before), before);
      const mutated = original.replace(before, after);
      await assert.rejects(() => (which === 'editor' ? verify(mutated, model) : verify(editor, mutated)), { name: 'AssertionError' }, before);
    }
    await verify(editor, model);
  }
});
