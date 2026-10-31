// D1385 (#3731, #2409 part 1) — "Your PostHog projects" on PostHog's connector
// page: one row per venture with its project, the teammate whose PostHog
// serves it, or Choose project; choose, change and unlink behind in-page
// dialogs; a failed read and a failed project list each saying why. No test
// reaches the network: the API is injected. Every value is invented.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/posthog_projects_d1385.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import PosthogProjectsSection from '../src/pages/account/PosthogProjectsSection.jsx';
import { CHOOSE_LINE, NO_VENTURES, UNLINK_LINE, projectsRead, refusalOf, regionWords, rowOf } from '../src/pages/account/posthogProjectsModel.js';

const h = React.createElement;
const READ = {
  ok: true,
  ventures: [
    { project_id: 1, name: 'Lumen Labs', company_id: 77, link: { posthog_project_id: '4242', name: 'Lumen web app', region: 'EU' }, served_by: null },
    { project_id: 2, name: 'Side Co', company_id: 77, link: null, served_by: null },
    { project_id: 3, name: 'Orbit Ltd', company_id: 77, link: null, served_by: { name: 'Fixture cofounder' } },
  ],
  choices: [{ id: '4242', name: 'Lumen web app', region: 'EU' }, { id: '5151', name: 'Side mobile', region: 'US' }],
  choices_error: null,
};

function fakeApi({ read = async () => READ, set = async () => ({ ok: true }) } = {}) {
  const calls = [];
  return {
    calls,
    projects: async (uid) => { calls.push(['projects', uid]); return read(); },
    setProject: async (uid, project, posthog) => { calls.push(['set', uid, project, posthog]); return set(); },
  };
}

async function mounted({ api = fakeApi(), p = { key: 'posthog', connection: { uid: 'u-posthog' } } } = {}) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let changed = 0;
  await act(async () => root.render(h(PosthogProjectsSection, { p, api, onChanged: () => { changed += 1; } })));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    api, by, all, pr, say: (n) => text(typeof n === 'string' ? by(n) : n), text: () => text(document.body), changed: () => changed,
    async click(n) { const x = typeof n === 'string' ? by(n) : n; assert.ok(x, `no ${n}`); assert.ok(!pr(x).disabled, `${n} is enabled`); await act(async () => pr(x).onClick?.({ preventDefault() {} })); await flush(); },
    async pick(n) { await act(async () => pr(n).onChange?.({ target: { value: pr(n).value } })); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the model: a row\'s state and words, a read made safe to draw, and a refusal in the Worker\'s words', () => {
  assert.deepEqual(rowOf(READ.ventures[0]), { state: 'linked', line: 'Lumen web app · EU Cloud', action: 'change' });
  assert.deepEqual(rowOf(READ.ventures[1]), { state: 'unlinked', line: 'Choose a project', action: 'choose' });
  assert.deepEqual(rowOf(READ.ventures[2]), { state: 'served', line: 'Served by Fixture cofounder’s PostHog', action: null }, 'a teammate is named, never given a button');
  assert.equal(rowOf({ served_by: { name: null } }).line, 'Served by a teammate’s PostHog');
  assert.equal(regionWords('US'), 'US Cloud');
  assert.equal(regionWords(null), 'Region not recorded');
  assert.equal(projectsRead({ ventures: [], choices: null }).choicesError, 'Your PostHog projects could not be read. Try again.', 'never an empty list for a list that did not load');
  assert.equal(projectsRead({ ventures: [], choices: null, choices_error: { detail: 'PostHog asked us to wait. Try again in a minute.' } }).choicesError, 'PostHog asked us to wait. Try again in a minute.');
  assert.equal(projectsRead({ ventures: [], choices: [] }).choicesError, null);
  assert.equal(refusalOf({ data: { detail: 'A teammate’s PostHog already serves this venture. They can unlink it.' } }), 'A teammate’s PostHog already serves this venture. They can unlink it.');
});

test('the rows: linked with Change and Unlink, unlinked with Choose project, served by a teammate with no button', async () => {
  const ui = await mounted();
  try {
    const rows = ui.all('posthog-project-row');
    assert.deepEqual(rows.map((r) => ui.pr(r)['data-state']), ['linked', 'unlinked', 'served']);
    assert.deepEqual(ui.all('posthog-project-line').map((n) => ui.say(n)), ['Lumen web app · EU Cloud', 'Choose a project', 'Served by Fixture cofounder’s PostHog']);
    assert.equal(ui.all('posthog-project-choose').length, 1);
    assert.equal(ui.all('posthog-project-change').length, 1);
    assert.equal(ui.all('posthog-project-unlink').length, 1);
    assert.deepEqual(ui.api.calls, [['projects', 'u-posthog']]);
  } finally { await ui.close(); }
});

test('Choose project: an in-page dialog that says what it does; nothing is sent before Use this project', async () => {
  const ui = await mounted();
  try {
    await ui.click('posthog-project-choose');
    const dialog = ui.by('posthog-choose-dialog');
    assert.ok(dialog, 'an in-page dialog, never a browser pop-up');
    assert.ok(ui.text().includes(CHOOSE_LINE));
    assert.ok(ui.pr(ui.by('posthog-choose-save')).disabled, 'nothing chosen yet');
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'set'), [], 'nothing sent before the button');
    const [, second] = ui.all('posthog-choose-option');
    await ui.pick(second);
    await ui.click('posthog-choose-save');
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'set'), [['set', 'u-posthog', 2, '5151']]);
    assert.equal(ui.by('posthog-choose-dialog'), undefined, 'closed on success');
    assert.equal(ui.changed(), 1);
    assert.equal(ui.api.calls.filter((c) => c[0] === 'projects').length, 2, 'the list is read again');
  } finally { await ui.close(); }
});

test('a refusal stays in the dialog; Unlink says what it does and sends null', async () => {
  const refused = Object.assign(new Error('x'), { data: { detail: 'A teammate’s PostHog already serves this venture. They can unlink it.' } });
  let ui = await mounted({ api: fakeApi({ set: async () => { throw refused; } }) });
  try {
    await ui.click('posthog-project-change');
    assert.equal(ui.pr(ui.all('posthog-choose-option')[0]).checked, true, 'Change starts on the linked project');
    await ui.click('posthog-choose-save');
    assert.equal(ui.say('posthog-choose-error'), 'A teammate’s PostHog already serves this venture. They can unlink it.');
    assert.ok(ui.by('posthog-choose-dialog'), 'the dialog stays open');
  } finally { await ui.close(); }
  ui = await mounted();
  try {
    await ui.click('posthog-project-unlink');
    assert.ok(ui.text().includes(UNLINK_LINE));
    await ui.click('posthog-unlink-save');
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'set'), [['set', 'u-posthog', 1, null]]);
  } finally { await ui.close(); }
});

test('the states: a failed read says so with Try again; a failed project list blanks only the choices; no venture says why', async () => {
  let ui = await mounted({ api: fakeApi({ read: async () => { throw Object.assign(new Error('x'), { data: { detail: 'PostHog could not be read. Try again.' } }); } }) });
  try {
    assert.ok(ui.text().includes('PostHog could not be read. Try again.'));
    assert.equal(ui.all('posthog-project-row').length, 0, 'no row is drawn for an unread list');
  } finally { await ui.close(); }
  ui = await mounted({ api: fakeApi({ read: async () => ({ ...READ, choices: null, choices_error: { code: 'rate_limited', detail: 'PostHog asked us to wait. Try again in a minute.' } }) }) });
  try {
    assert.equal(ui.all('posthog-project-row').length, 3, 'the ventures still draw');
    await ui.click('posthog-project-choose');
    assert.ok(ui.text().includes('PostHog asked us to wait. Try again in a minute.'));
    assert.equal(ui.all('posthog-choose-option').length, 0);
  } finally { await ui.close(); }
  ui = await mounted({ api: fakeApi({ read: async () => ({ ...READ, ventures: [] }) }) });
  try {
    assert.equal(ui.say('posthog-projects-empty'), NO_VENTURES);
  } finally { await ui.close(); }
});

test('wiring: the page draws the section for PostHog only; the client is one line in api.js and hits the Worker route', () => {
  const page = readFileSync(new URL('../src/pages/account/ConnectorPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /\{p\.key === 'posthog' && <PosthogProjectsSection p=\{p\} onChanged=\{onChanged\} \/>\}/);
  const api = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  assert.match(api, /^export \* from '\.\/api\/posthog\.js';$/m);
  const client = readFileSync(new URL('../src/lib/api/posthog.js', import.meta.url), 'utf8');
  assert.match(client, /\/connectors\/\$\{enc\(uid\)\}\/posthog-projects/);
  assert.doesNotMatch(client, /method: 'POST'|method: 'DELETE'/, 'the client links and unlinks only');
});
