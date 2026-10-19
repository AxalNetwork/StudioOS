/**
 * D782 (#2115) — Founding team's and Company creation's "From GitHub" parts:
 * who builds (each founder a login is matched to, "Builds: N commits in the
 * last 90 days", and the founder's own control to match a login), and where
 * the code sits (owner, licence as a fact, the proposed IP step with Accept
 * and Dismiss, and the evidence). The words are `teamFromCode.js`'s; this
 * holds them, the two parts and the four calls.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/github_team_company_d782.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import FoundingTeamFromCode from '../src/pages/cycles/FoundingTeamFromCode.jsx';
import CompanyFromCode from '../src/pages/cycles/CompanyFromCode.jsx';
import { buildsText, companyView, licenceText, ownerText, teamView } from '../src/pages/cycles/teamFromCode.js';
import { cyclesWrite } from '../src/lib/api/cycles.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const h = React.createElement;
const drawTeam = (part) => renderToStaticMarkup(h(FoundingTeamFromCode, { part, projectId: 101, reload() {} }));
const drawCompany = (part) => renderToStaticMarkup(h(CompanyFromCode, { part, projectId: 101, reload() {} }));

const TEAM = {
  state: 'ok', members_only: false, logins: 2,
  builds: [{ record_id: 'h-5', repositories: [{ repository: 'acme/app', commits_90d: 12, login: 'fay-codes' }] }],
  unmatched: [{ login: 'sam-dev', repositories: [{ repository: 'acme/app', commits_90d: 3 }] }],
  founders: [{ record_id: 'h-5', holder_id: 5, name: 'Fay Founder' }, { record_id: 'h-6', holder_id: 6, name: 'Sam Second' }],
};
const COMPANY = {
  state: 'ok', members_only: false, repositories_total: 2,
  repositories: [
    { repository: 'fay/app', owner_kind: 'personal', owner: 'fay', licence: null, licence_note: 'No licence file' },
    { repository: 'acme/site', owner_kind: 'organisation', owner: 'acme', licence: 'MIT', licence_note: null },
  ],
  proposals: [{ id: 9, repository: 'fay/app', title: 'Move the code into the company’s GitHub organisation', reason: 'The code is the company’s IP.' }],
  evidence: [{ record_id: 'step-4', step: 'Assign IP to the company', repository: 'acme/site' }],
};

test('the words: Builds per repository, the owner and the licence as facts, and nothing drawn when GitHub brought no one', () => {
  // Mutation checked: "commit" for every count → the plural line fails; licence advice → the fact line fails.
  assert.equal(buildsText(12), 'Builds: 12 commits in the last 90 days');
  assert.equal(buildsText(1), 'Builds: 1 commit in the last 90 days');
  assert.equal(buildsText('x'), 'Builds: 0 commits in the last 90 days');
  assert.equal(ownerText(COMPANY.repositories[0]), 'A personal account (fay) owns it');
  assert.equal(ownerText(COMPANY.repositories[1]), 'The acme organisation owns it');
  assert.equal(licenceText(COMPANY.repositories[0]), 'No licence file');
  assert.equal(licenceText(COMPANY.repositories[1]), 'Licence: MIT');
  assert.equal(teamView(null).empty, true);
  assert.equal(teamView({ state: 'ok', logins: 0, builds: [], unmatched: [], founders: [] }).empty, true);
  assert.equal(teamView({ state: 'unreadable' }).empty, false, 'an unreadable part still says so');
  assert.deepEqual(teamView({ ...TEAM, builds: [{ record_id: 'h-99', repositories: [] }] }).builds, [], 'a build for a founder not on the cap table is not drawn');
  assert.equal(companyView({ state: 'ok', repositories_total: 0, repositories: [], proposals: [], evidence: [] }).empty, true);
  assert.equal(drawTeam({ state: 'ok', logins: 0, builds: [], unmatched: [], founders: [] }), '', 'the page claims only what is built');
  assert.equal(drawCompany(null), '');
});

test('Founding team draws each matched founder\'s card line and each login not yet matched with its control', () => {
  // Mutation checked: drop the builds list → no card line; drop the select → no control; draw the login for a non-member → the count test fails.
  const out = drawTeam(TEAM);
  assert.match(out, /id="from-github"/);
  assert.match(out, /data-testid="team-builds-h-5"/);
  assert.match(out, /Fay Founder/);
  assert.match(out, /Builds: 12 commits in the last 90 days/);
  assert.match(out, /data-testid="team-unmatch-fay-codes"/);
  assert.match(out, /Not yet matched/);
  assert.match(out, /data-testid="team-unmatched-sam-dev"/);
  assert.match(out, /data-testid="team-founder-sam-dev"/);
  assert.match(out, /<option value="6">Sam Second<\/option>/);
  assert.match(out, /data-testid="team-match-sam-dev"/);
  assert.doesNotMatch(drawTeam({ ...TEAM, unmatched: [{ login: '<img src=x onerror=1>', repositories: [] }] }), /<img\b/i, 'a login is drawn as text');
  const outsider = drawTeam({ state: 'ok', members_only: true, logins: 2, builds: [], unmatched: [], founders: [] });
  assert.match(outsider, /data-testid="team-github-members-only"[^>]*>2 contributors arrived from GitHub\. Only the project’s members see which\./);
  assert.doesNotMatch(outsider, /sam-dev|fay-codes|Builds:/, 'a non-member reads how many, never who');
  assert.match(drawTeam({ state: 'unreadable', reason: 'What GitHub brought could not be read.' }), /data-testid="team-github-unreadable"/);
  assert.match(drawTeam({ ...TEAM, founders: [], builds: [] }), /Add a founder to the cap table to match this login\./);
});

test('Company creation draws where the code sits, the proposal with Accept and Dismiss, and the evidence', () => {
  // Mutation checked: drop the proposals block → no Accept; drop the evidence block → no evidence line.
  const out = drawCompany(COMPANY);
  assert.match(out, /data-testid="company-repo-fay\/app"/);
  assert.match(out, /A personal account \(fay\) owns it · No licence file/);
  assert.match(out, /The acme organisation owns it · Licence: MIT/);
  assert.match(out, /data-testid="company-proposal-9"/);
  assert.match(out, /Move the code into the company’s GitHub organisation/);
  assert.match(out, /The code is the company’s IP\./);
  assert.match(out, /data-testid="company-accept-9"/);
  assert.match(out, /data-testid="company-dismiss-9"/);
  assert.match(out, /data-testid="company-evidence-acme\/site"[^>]*>Assign IP to the company: acme\/site sits in an organisation/);
  const outsider = drawCompany({ state: 'ok', members_only: true, repositories_total: 2, repositories: [], proposals: [], evidence: [] });
  assert.match(outsider, /2 repositories arrived from GitHub/);
  assert.doesNotMatch(outsider, /fay/, 'a non-member never reads an owner\'s login');
  assert.doesNotMatch(drawCompany({ ...COMPANY, proposals: [] }), /company-accept-/);
});

async function mount(Component, part, reload) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(Component, { part, projectId: 101, reload })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const click = (id) => act(async () => { props(by(id)).onClick(); await new Promise((r) => setTimeout(r, 0)); });
  const choose = (id, value) => act(async () => { props(by(id)).onChange({ target: { value } }); });
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, click, choose, text, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('the mapping control matches a login only to the founder chosen, and Unmatch takes it back', async () => {
  // Mutation checked: match without a choice → the "Choose a founder first." assert fails; send the first founder → the holder id assert fails.
  const saved = { ...cyclesWrite.build };
  const calls = [];
  let reloads = 0;
  cyclesWrite.build.matchGithubLogin = async (project, body) => { calls.push(['match', project, body]); return { ok: true }; };
  cyclesWrite.build.unmatchGithubLogin = async (project, login) => { calls.push(['unmatch', project, login]); return { ok: true }; };
  const m = await mount(FoundingTeamFromCode, TEAM, () => { reloads += 1; });
  try {
    await m.click('team-match-sam-dev');
    assert.deepEqual(calls, [], 'no founder chosen, nothing is matched');
    assert.equal(m.text(m.by('team-github-error')), 'Choose a founder first.');
    await m.choose('team-founder-sam-dev', '6');
    await m.click('team-match-sam-dev');
    assert.deepEqual(calls, [['match', 101, { login: 'sam-dev', holder_id: 6 }]]);
    assert.equal(reloads, 1);
    await m.click('team-unmatch-fay-codes');
    assert.deepEqual(calls[1], ['unmatch', 101, 'fay-codes']);
    assert.equal(reloads, 2);
  } finally { await m.unmount(); Object.assign(cyclesWrite.build, saved); }
});

test('Accept and Dismiss each call their route once for that proposal, then reload; a refusal is said', async () => {
  // Mutation checked: Dismiss calls accept → the dismiss call never comes; drop reload → the reload count fails.
  const saved = { ...cyclesWrite.build };
  const calls = [];
  let reloads = 0;
  cyclesWrite.build.acceptCompanyProposal = async (project, id) => { calls.push(['accept', project, id]); return { ok: true }; };
  cyclesWrite.build.dismissCompanyProposal = async (project, id) => { calls.push(['dismiss', project, id]); throw new Error('That proposal was already accepted or dismissed.'); };
  const m = await mount(CompanyFromCode, COMPANY, () => { reloads += 1; });
  try {
    await m.click('company-accept-9');
    assert.deepEqual(calls, [['accept', 101, 9]]);
    assert.equal(reloads, 1);
    await m.click('company-dismiss-9');
    assert.deepEqual(calls[1], ['dismiss', 101, 9]);
    assert.equal(reloads, 1, 'a refused Dismiss does not reload');
    assert.equal(m.text(m.by('company-github-error')), 'That proposal was already accepted or dismissed.');
  } finally { await m.unmount(); Object.assign(cyclesWrite.build, saved); }
});

test('the four calls go to the Worker\'s routes, and both modules mount their part', async () => {
  const sent = [];
  const w = makeCycleWrites(async (path, init) => { sent.push([path, init?.method, init?.body ?? null]); return {}; });
  await w.build.matchGithubLogin(101, { login: 'sam-dev', holder_id: 6 });
  await w.build.unmatchGithubLogin(101, 'sam/dev');
  await w.build.acceptCompanyProposal(101, 9);
  await w.build.dismissCompanyProposal(101, 10);
  assert.deepEqual(sent, [
    ['/cycles/build/founding-team/github-logins?project=101', 'POST', JSON.stringify({ login: 'sam-dev', holder_id: 6 })],
    ['/cycles/build/founding-team/github-logins/sam%2Fdev?project=101', 'DELETE', null],
    ['/cycles/build/company-creation/proposals/9/accept?project=101', 'POST', null],
    ['/cycles/build/company-creation/proposals/10/dismiss?project=101', 'POST', null],
  ]);
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /'founding-team': \(data, ctx\) => <FoundingTeamFromCode part=\{data\?\.parts\?\.github\} projectId=\{ctx\.projectId\} reload=\{ctx\.reload\} \/>/);
  assert.match(route, /'company-creation': \(data, ctx\) => <CompanyFromCode part=\{data\?\.parts\?\.github\} projectId=\{ctx\.projectId\} reload=\{ctx\.reload\} \/>/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_build.ts', import.meta.url), 'utf8');
  assert.ok(worker.includes("app.post('/founding-team/github-logins'"));
  assert.ok(worker.includes("app.delete('/founding-team/github-logins/:login'"));
  for (const how of ['accept', 'dismiss']) assert.ok(worker.includes(`app.post('/company-creation/proposals/:id/${how}'`), how);
});
