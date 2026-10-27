/**
 * D1099 (#2964, Vercel part 4) — Company creation's "From Vercel" part (VC4b,
 * VC4d): where production runs, and the Hobby-plan proposal with its Accept
 * dialog. Mounted against the Worker's own shape (`companyFromVercel`,
 * services/vercel/company.ts) with a stubbed fetch; Vercel is never reached.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/vercel_company_d1099.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import CompanyFromVercel, { stepSentence, vercelCompanyView } from '../src/pages/cycles/CompanyFromVercel.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const TITLE = 'Move the production project to the company’s Vercel team on a paid plan';
const PART = () => ({
  state: 'ok', members_only: false, projects_total: 1,
  projects: [{ vercel_project_id: 'prj_fixture', project: 'acme-web', account_kind: 'personal', account: 'Personal Vercel account', plan: 'hobby', plan_word: 'Hobby', plan_note: null }],
  proposals: [{ id: 7, project: 'acme-web', title: TITLE, reason: 'Vercel’s Hobby plan is for personal, non-commercial use.' }],
});

test('the view: none draws nothing, unreadable says why, a non-member reads a count, a plan not given is not guessed', () => {
  assert.equal(vercelCompanyView(undefined).empty, true);
  assert.equal(vercelCompanyView({ state: 'ok', projects: [], proposals: [] }).empty, true);
  assert.deepEqual(vercelCompanyView({ state: 'unreadable', reason: 'What Vercel brought could not be read.' }).state, 'unreadable');
  assert.deepEqual([vercelCompanyView({ state: 'ok', members_only: true, projects_total: 2 }).state, vercelCompanyView({ state: 'ok', members_only: true, projects_total: 2 }).total], ['members_only', 2]);
  // Mutation checked: keep a proposal with no id → it renders an Accept… that posts to `undefined`.
  assert.equal(vercelCompanyView({ ...PART(), proposals: [{ title: TITLE }] }).proposals.length, 0);
  assert.equal(stepSentence(`${TITLE}.`, 'Acme Health'), `“${TITLE}” becomes a step in Company creation, for Acme Health.`);
  assert.equal(stepSentence(TITLE, ''), `“${TITLE}” becomes a step in Company creation, for this venture.`);
});

const response = (body, status = 200) => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

async function mounted(part, answer = () => response({ ok: true })) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const requests = [];
  let reloads = 0;
  globalThis.fetch = async (u, o = {}) => {
    if (String(u).includes('/client-error')) return response({});
    requests.push([o.method || 'GET', String(u)]);
    return answer(String(u));
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(CompanyFromVercel, { part, projectId: 101, ventureName: 'Acme Health', reload: () => { reloads += 1; } })));
  const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, reloads: () => reloads, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), all: () => text(document.body),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('mounted VC4b: the facts, and the proposal with Vercel\'s reason', async () => {
  const r = await mounted(PART());
  try {
    assert.equal(r.textOf('company-vercel-account-prj_fixture'), 'Personal Vercel account');
    assert.equal(r.textOf('company-vercel-plan-prj_fixture'), 'Hobby');
    assert.match(r.textOf('company-vercel-facts-prj_fixture'), /Projectacme-web/);
    assert.match(r.textOf('company-vercel-proposal-7'), /^Proposal · from your Vercel facts/);
    assert.match(r.textOf('company-vercel-proposal-7'), /Vercel’s Hobby plan is for personal, non-commercial use\./);
    assert.deepEqual(r.requests, [], 'nothing is read or written by drawing');
  } finally { await r.close(); }
});

test('mounted VC4d: Accept… opens the dialog; Cancel writes nothing; Add the step posts once and reloads', async () => {
  const r = await mounted(PART());
  try {
    await r.click('company-vercel-accept-7');
    // Mutation checked: Accept… posting straight away → a request before the dialog.
    assert.deepEqual(r.requests, []);
    assert.ok(r.has('company-vercel-dialog'));
    assert.equal(r.textOf('company-vercel-dialog-sentence'), `“${TITLE}” becomes a step in Company creation, for Acme Health.`);
    assert.match(r.all(), /Adds a formation step\. Nothing changes on Vercel\./);
    await r.click('company-vercel-cancel');
    assert.ok(!r.has('company-vercel-dialog'));
    assert.deepEqual(r.requests, []);
    await r.click('company-vercel-accept-7');
    await r.click('company-vercel-add');
    assert.deepEqual(r.requests, [['POST', '/api/cycles/build/company-creation/vercel-proposals/7/accept?project=101']]);
    assert.equal(r.reloads(), 1);
    assert.ok(!r.has('company-vercel-dialog'));
  } finally { await r.close(); }
});

test('mounted: a refused Accept says so in the dialog and keeps it open; Dismiss posts without a dialog', async () => {
  const r = await mounted(PART(), (u) => (u.includes('/accept') ? response({ detail: 'That proposal was already accepted or dismissed.' }, 409) : response({ ok: true })));
  try {
    await r.click('company-vercel-accept-7');
    await r.click('company-vercel-add');
    assert.ok(r.has('company-vercel-dialog'));
    assert.match(r.textOf('company-vercel-dialog-error'), /already accepted or dismissed/);
    assert.equal(r.reloads(), 0);
    await r.click('company-vercel-cancel');
    await r.click('company-vercel-dismiss-7');
    assert.deepEqual(r.requests.at(-1), ['POST', '/api/cycles/build/company-creation/vercel-proposals/7/dismiss?project=101']);
    assert.equal(r.reloads(), 1);
  } finally { await r.close(); }
});

test('mounted: unreadable, a non-member\'s count, a plan not recorded, and nothing when Vercel brought nothing', async () => {
  const u = await mounted({ state: 'unreadable', reason: 'What Vercel brought could not be read.' });
  try { assert.equal(u.textOf('company-vercel-unreadable'), 'Unreadable: What Vercel brought could not be read.'); } finally { await u.close(); }
  const m = await mounted({ state: 'ok', members_only: true, projects_total: 1, projects: [], proposals: [] });
  try {
    assert.equal(m.textOf('company-vercel-members-only'), '1 project arrived from Vercel. Only the project’s members see which.');
    assert.doesNotMatch(m.all(), /acme-web/);
  } finally { await m.close(); }
  const n = await mounted({ ...PART(), proposals: [], projects: [{ ...PART().projects[0], account: 'Vercel team', plan: null, plan_word: null, plan_note: 'Not recorded: Vercel did not give this team’s plan.' }] });
  try {
    // Mutation checked: a missing plan drawn as Hobby → 'Hobby'.
    assert.equal(n.textOf('company-vercel-plan-prj_fixture'), 'Not recorded: Vercel did not give this team’s plan.');
  } finally { await n.close(); }
  const e = await mounted(undefined);
  try { assert.ok(!e.has('cycle-part-company-vercel')); } finally { await e.close(); }
});

test('the source: an in-page dialog, never a browser pop-up; dark classes; the client paths', () => {
  const src = read('frontend/src/pages/cycles/CompanyFromVercel.jsx');
  assert.ok(!/(?<![.\w])(alert|confirm|prompt)\(|window\.open/.test(src));
  for (const c of ['dark:bg-gray-900', 'dark:border-gray-800', 'dark:text-gray-100']) assert.ok(src.includes(c), c);
  assert.ok(src.includes('id="from-vercel"'));
  const client = read('frontend/src/lib/api/cycleWrites.js');
  assert.ok(client.includes('/cycles/build/company-creation/vercel-proposals/${seg(id)}/accept'));
  assert.match(read('documentation/architecture/decisions/D1099.md'), /UNVERIFIED/);
});
