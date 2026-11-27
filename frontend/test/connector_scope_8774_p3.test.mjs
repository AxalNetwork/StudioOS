/**
 * D8774 part 3 (#8774) — Build › Connect a tool, what part 2 left:
 *
 *   1. BLS07: stopping or disconnecting is Scope → Review → Result. Review says what stops, what stays and who
 *      acts, and takes focus on its heading (never on the destructive button); Result is a polite status that
 *      names what stayed, with the time it was done;
 *   2. BLS04, BLS05, BLS10: the GitHub row names the last successful read of this venture (Stale with its age),
 *      and an unreadable history says so with Try again, never "none";
 *   3. BLS10: a Super Admin previewing the founder shell is told the tools are their own and that what they do
 *      here, linking included, is written as them; the link dialog names the actor.
 *
 * Every name, company and repository here is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_scope_8774_p3.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { buildCatalogue, disconnectResult, disconnectReview, rowLastRead } from '../src/pages/account/connectorsModel.js';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { ConnectToolView, LinkCompanyDialog } from '../src/pages/account/ConnectToolSheet.jsx';
import { ViewModeProvider } from '../src/contexts/ViewModeContext.js';

const h = React.createElement;
const COMPANIES = [{ id: 5, company_name: 'Sample Orchard Inc.' }, { id: 9, company_name: 'Sample Ventures LLC' }];
const PROVIDERS = [{ key: 'github', display_name: 'GitHub', status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true, category: 'Code', feeds: ['product_roadmap'] }];
const catalogue = (companyIds = [5, 9]) => buildCatalogue({
  providers: PROVIDERS,
  items: [{ uid: 'u-gh', provider_key: 'github', status: 'active', company_ids: companyIds, config: { project_id: 7, repositories: ['acme/app', 'acme/site'] }, last_synced_at: '2026-11-20T11:00:00Z' }],
  firstParty: {},
});
const gh = catalogue().find((p) => p.key === 'github');
const OWNER = { id: 1, role: 'founder', founder_id: 11, name: 'Maya Sample' };
const PROJECT = { id: 7, name: 'Sample Orchard', founder_id: 11, founder: { name: 'Maya Sample' }, company_id: 5 };
const ok = { state: 'ok', companyId: 5, name: 'Sample Orchard Inc.' };
const AT = new Date('2026-11-26T10:31:00Z');
const BINDING = (over = {}) => ({ state: 'healthy', effective: true, last_good_read: { at: '2026-11-26 09:42:00', source: 'GitHub sync', repositories: ['acme/app'], partial: false }, stale: null, ...over });
const TOOLS = (binding, owner = 'You') => ({ code: { systems: [{ provider: 'GitHub', owner, binding }] } });

async function mount(el) {
  const restore = installDocument('', { focus: true });
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, doc: document, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onChange?.({ target: n }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const view = ({ cat = catalogue(), project = PROJECT, user = OWNER, ventureRead = null, mode = null, reload = () => {} } = {}) => {
  const sheet = h(MemoryRouter, null, h(ConnectToolView, {
    data: { status: 'ready', catalogue: cat, companies: COMPANIES, reload }, project, projectId: 7, onClose() {}, user, ventureRead,
  }));
  return mode ? h(ViewModeProvider, { value: mode }, sheet) : sheet;
};

test('1. Review and Result say what stops, what stays and who, in the connection\'s own terms', () => {
  // Mutation checked: the Repositories row dropped → the GitHub review has no row naming acme/app; the companies
  // that keep the tool computed after the write (none) → the Result says "stays connected to your account." only.
  const stop = disconnectReview(gh, 'stop', { scope: ok, companies: COMPANIES, ventureName: 'Sample Orchard', actor: 'Maya Sample' });
  assert.equal(stop.title, 'Stop using GitHub for Sample Orchard Inc.?');
  assert.deepEqual(stop.rows, [
    ['Stops', 'New items from GitHub for Sample Orchard Inc.’s ventures, Sample Orchard among them.'],
    ['Stays', 'Items already in Build. GitHub on your account, and its use for Sample Ventures LLC.'],
    ['Repositories', 'acme/app and acme/site are let go for Sample Orchard.'],
    ['Who', 'You, Maya Sample.'],
  ]);
  assert.equal(stop.button, 'Stop using for Sample Orchard Inc.');
  const account = disconnectReview(gh, 'account', { companies: COMPANIES });
  assert.deepEqual(account.rows.map(([k, v]) => `${k}: ${v}`), [
    'Ends for: Sample Orchard Inc. and Sample Ventures LLC.',
    'Stops: Every sync of this connection, for every company it serves.',
    'Stays: Data already in StudioOS. Your GitHub account itself.',
    'Deleted: The stored credentials. Connecting again starts with signing in.',
    'Who: You.',
  ]);
  assert.equal(disconnectReview({ ...gh, connection: { ...gh.connection, company_ids: undefined } }, 'account').rows[0][1], 'Every company it serves.', 'an unknown set is never "none"');

  assert.deepEqual(disconnectResult(gh, 'stop', { scope: ok, companies: COMPANIES, ventureName: 'Sample Orchard', at: AT }), {
    title: 'GitHub no longer serves Sample Orchard Inc.',
    detail: 'Done at 10:31 UTC. GitHub stays connected to your account for Sample Ventures LLC. Sample Orchard keeps what it already has.',
  });
  assert.equal(disconnectResult(gh, 'account', { at: AT }).detail, 'Done at 10:31 UTC. Data already in StudioOS stays.');
  assert.equal(disconnectResult(gh, 'account', {}).detail, 'Done. Data already in StudioOS stays.', 'no time, none invented');
});

test('2. the GitHub row\'s last read: the viewer\'s own connection, Stale with its age, none said as none', () => {
  // Mutation checked: the owner check dropped → another member's system is read as the viewer's; stale hours
  // ignored → the age is missing.
  assert.deepEqual(rowLastRead(TOOLS(BINDING()), 'Sample Orchard'), { text: 'Last successful read of Sample Orchard: 2026-11-26 09:42:00 · GitHub sync', stale: null });
  assert.equal(rowLastRead(TOOLS(BINDING({ last_good_read: null }))).text, 'Last successful read of this venture: none yet');
  assert.equal(rowLastRead(TOOLS(BINDING({ stale: { since: '2026-11-24', hours: 72 } }))).stale, 'Stale · 72 h');
  assert.equal(rowLastRead(TOOLS(BINDING(), 'Noah Sample')), null, 'another member\'s connection is not the viewer\'s row');
  assert.equal(rowLastRead({ code: { systems: [] } }), null);
  assert.equal(rowLastRead(null), null);
});

test('3. Scope → Review → Result on the row; Review focuses its heading, not the destructive button', async () => {
  // Mutation checked: the steps collapsed (Disconnect sends at once) → setCompanies is called before Review; the
  // heading not focused → activeElement is not the review title; Result without role=status → no live region.
  const saved = connectorsApi.setCompanies;
  const calls = [];
  connectorsApi.setCompanies = async (uid, ids) => { calls.push([uid, ids]); return { ok: true }; };
  const m = await mount(view({ ventureRead: { tools: TOOLS(BINDING({ stale: { since: null, hours: 30 } })), retry() {} } }));
  try {
    assert.equal(m.text(m.by('tool-last-read-github')), 'Last successful read of Sample Orchard: 2026-11-26 09:42:00 · GitHub sync · ◷ Stale · 30 h');
    await m.click('tool-action-github');
    assert.match(m.text(m.by('tool-scope-step-github')), /^What do you want to stop\? Stop using GitHub for Sample Orchard Inc\. .* Disconnect GitHub from your account /);
    assert.equal(m.pr(m.by('tool-choose-stop-github')).checked, true, 'the scoped stop is the first choice (Q1 A)');
    assert.equal(m.by('tool-confirm-stop-github'), undefined, 'nothing destructive on Scope');
    await m.click('tool-review-github');
    assert.equal(m.text(m.by('tool-review-title-github')), 'Stop using GitHub for Sample Orchard Inc.?');
    assert.equal(m.doc.activeElement, m.by('tool-review-title-github'), 'focus is on the heading');
    assert.match(m.text(m.by('tool-review-rows-github')), /Who You, Maya Sample\./);
    assert.deepEqual(calls, [], 'Review sends nothing');
    await m.click('tool-review-back-github');
    await m.change('tool-choose-account-github');
    await m.click('tool-review-github');
    assert.equal(m.text(m.by('tool-review-title-github')), 'Disconnect GitHub from your account?');
    await m.click('tool-review-back-github');
    await m.change('tool-choose-stop-github');
    await m.click('tool-review-github');
    await m.click('tool-confirm-stop-github');
    assert.deepEqual(calls, [['u-gh', [9]]]);
    const result = m.by('tool-result-github');
    assert.equal(m.pr(result).role, 'status');
    assert.match(m.text(result), /^✓ GitHub no longer serves Sample Orchard Inc\. Done at \d\d:\d\d UTC\. GitHub stays connected to your account for Sample Ventures LLC\. Sample Orchard keeps what it already has\.$/);
    await m.click('tool-result-done-github');
    assert.equal(m.by('tool-confirm-github'), undefined, 'Back to Connect a tool closes the steps');
  } finally { connectorsApi.setCompanies = saved; await m.unmount(); }
});

test('4. an unreadable sync history is said, with Try again; while it is read nothing is claimed', async () => {
  // Mutation checked: an unreadable read drawn as "none yet" → the line claims no read happened.
  let retried = 0;
  const failed = await mount(view({ ventureRead: { tools: null, retry: () => { retried += 1; } } }));
  try {
    assert.match(failed.text(failed.by('tool-last-read-github')), /^Last successful read: Unreadable\./);
    assert.doesNotMatch(failed.text(failed.by('tool-last-read-github')), /none yet/);
    await failed.click('tool-last-read-retry');
    assert.equal(retried, 1);
  } finally { await failed.unmount(); }
  const loading = await mount(view({ ventureRead: { tools: undefined, retry() {} } }));
  try { assert.equal(loading.text(loading.by('tool-last-read-github')), 'Reading the last successful read…'); } finally { await loading.unmount(); }
  const none = await mount(view());
  try { assert.equal(none.by('tool-last-read-github'), undefined, 'no venture read, no line'); } finally { await none.unmount(); }
});

test('5. Super Admin preview: the tools are the viewer\'s own and the link is written as them', async () => {
  // Mutation checked: isFounderPreview ignored → no banner; the actor not passed → the dialog does not name who moves it.
  const admin = { id: 3, role: 'admin', name: 'Iris Sample' };
  const mode = { superAdmin: true, isImpersonating: false, viewMode: 'founder', isAdmin: true };
  const m = await mount(view({ user: admin, mode, project: { ...PROJECT, company_id: null }, cat: catalogue() }));
  try {
    assert.equal(m.text(m.by('connect-tool-preview')),
      '⚠ Super Admin preview of Maya Sample’s view. The tools listed are your own connections, and anything you do here, linking included, is written as you, Iris Sample.');
    await m.click('connect-tool-link-company');
    assert.match(m.text(m.by('link-company-dialog-says')), /Axal admins may move a venture\. This link is written as you, Iris Sample, not as the founder\./);
  } finally { await m.unmount(); }
  const own = await mount(view({ mode: { superAdmin: false, isImpersonating: false, viewMode: 'founder' } }));
  try { assert.equal(own.by('connect-tool-preview'), undefined, 'a founder\'s own view has no preview banner'); } finally { await own.unmount(); }
  const support = await mount(view({ user: admin, mode: { ...mode, isImpersonating: true } }));
  try { assert.equal(support.by('connect-tool-preview'), undefined, 'a support session is not founder preview'); } finally { await support.unmount(); }
  const dialog = await mount(h(LinkCompanyDialog, { projectId: 7, ventureName: 'Sample Orchard', companies: COMPANIES, onClose() {}, onDone() {} }));
  try { assert.doesNotMatch(dialog.text(dialog.by('link-company-dialog-says')), /Axal admins/, 'outside preview the dialog names no actor'); } finally { await dialog.unmount(); }
});
