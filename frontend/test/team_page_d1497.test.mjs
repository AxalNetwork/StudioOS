// D1497 (#3727) — Team: people and AI agents. The intake, the agent marker,
// "Not recorded", unavailable is not "none", emails, Ask, refusals in words,
// no client method for a missing route, and the page mounted on a stubbed
// fetch: people and invitations wired, agents behind the seam, every scope.
// The names and figures are the canvas's own samples, used as fixtures only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/team_page_d1497.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { readDecision } from './_decisions.mjs';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { AgentIdentity, PersonAvatar } from '../src/pages/team/AgentMark.jsx';
import { AskButtonView } from '../src/ui/AskButton.jsx';
import { AskButtonView as TeamAskButtonView } from '../src/pages/team/AskButton.jsx';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import PeopleCard from '../src/pages/team/PeopleCard.jsx';
import TeamAgentsPage from '../src/pages/team/TeamAgentsPage.jsx';
import ProjectSettingsPage from '../src/pages/team/ProjectSettingsPage.jsx';
import { AgentProfile } from '../src/pages/team/AgentProfileSheet.jsx';
import { RulebookView } from '../src/pages/team/RulebooksTab.jsx';
import * as adapter from '../src/pages/team/agentsAdapter.js';
import {
  agentRow, companyInvitationLine, countBadge, freshMemberKey, heldLabel, invitationState, maskEmail, moveOutCopy, pauseWords, peopleFromCompany, peopleFromProject,
  refusalWords, spendLine, whoMayAddAgents,
} from '../src/pages/team/teamModel.js';
import AddAgentSheet from '../src/pages/team/AddAgentSheet.jsx';
import { ApprovalsBoard, decidedLine } from '../src/pages/team/ApprovalsTab.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const TEAM = 'frontend/src/pages/team';
const NOW = new Date('2026-10-31T12:00:00Z');

// ---------------------------------------------------------------- fixtures (the canvas's samples)

const VOCAB = { authority_levels: [
  { key: 'VIEW', meaning: 'Sees the work. Does not act on it.' }, { key: 'WORK', meaning: 'Does the work and drafts it.' },
  { key: 'FLAG', meaning: 'Raises a concern for review.' }, { key: 'SPONSOR', meaning: 'Champions a proposal and answers for it.' },
  { key: 'VOTE', meaning: 'Decides. The only level that does.' },
], ladder: [{ title: 'Principal', defaultAuthority: 'SPONSOR' }, { title: 'Analyst', defaultAuthority: 'WORK' }], functions: [{ name: 'Finance' }] };
const COMPANY = { uid: 'nw1', company_name: '[Northwind Labs]', members: [
  { user_id: 1, name: '[Avery Stone]', email: 'you@example.com', role_in_company: 'Owner', is_primary_admin: true, title: 'Principal', authority: 'SPONSOR', joined_at: '2026-09-01' },
  { user_id: 2, name: '[Jordan Reyes]', email: 'jordan@example.com', role_in_company: 'Admin', is_primary_admin: false, title: 'Partner / GP', authority: 'VOTE', joined_at: '2026-09-02' },
  { user_id: 3, name: '[Sam Okafor]', email: 'sam@example.com', role_in_company: 'Founder', is_primary_admin: false, title: null, authority: 'WORK', joined_at: '2026-09-03' },
] };
const INVITES = { invitations: [
  { uid: 'i1', email: 'avery.new@example.com', role_in_company: 'Member', status: 'pending', email_sent: true, created_at: '2026-10-28 10:00:00', expires_at: '2026-11-11 10:00:00' },
  { uid: 'i2', email: 'dana@example.com', role_in_company: 'Member', status: 'pending', email_sent: true, created_at: '2026-10-14 10:00:00', expires_at: '2026-10-28 10:00:00' },
  { uid: 'i3', email: 'pat@example.com', role_in_company: 'Member', status: 'revoked', email_sent: true, created_at: '2026-10-20 10:00:00', updated_at: '2026-10-29 10:00:00', expires_at: '2026-11-03 10:00:00' },
] };
const PROJECT = { id: 5, name: '[Lantern]', company_id: null, stage: 'validation', sector: 'Climate', created_at: '2026-09-12 10:00:00' };
const MEMBERS = {
  members: [
    { user_id: 1, name: '[Avery Stone]', email: 'you@example.com', role: 'owner', source: 'owner', accepted_at: '2026-09-12' },
    { user_id: 4, name: '[Kai Moreno]', email: 'kai@example.com', role: 'cofounder', source: 'email', accepted_at: '2026-10-01' },
  ],
  invitations: [
    { id: 41, role: 'cofounder', status: 'pending', source: 'email', invitee_email: 'mara@example.com', created_at: '2026-10-29 10:00:00', expires_at: '2026-11-12 10:00:00' },
    { id: 42, role: 'advisor', status: 'pending', source: 'link', invitee_email: null, created_at: '2026-10-30 10:00:00', expires_at: '2026-11-13 10:00:00' },
  ],
  can_manage: true, can_edit: true, my_role: 'owner', locked: false, gate_reason: null,
};
/** #3840's Agent DTO, as the canvas draws TM1a's rows. */
const AGENTS = [
  { uid: 'a1', role_key: 'cfo', role_name: 'CFO', first_name: '[Nora]', last_name: '[Vale]', model_id: 'm-a', model_label: '[Model A]', tools: [{ tool: 'get_balance', server_name: '[Finance MCP]' }, { tool: 'list_transactions', server_name: '[Finance MCP]' }], sponsor: { uid: 'u1', name: '[Avery Stone]' }, status: 'active', paused_reason: null, monthly_cap_microusd: 25_000_000, month_spend: { available: true, value_microusd: 3_840_000 }, last_activity_at: '2026-10-31T10:00:00Z', project: null },
  { uid: 'a2', role_key: 'cmo', role_name: 'CMO / Growth', first_name: '[Iris]', last_name: '[Cole]', model_id: 'm-a', model_label: '[Model A]', tools: [], sponsor: { uid: 'u1', name: '[Avery Stone]' }, status: 'paused', paused_reason: 'cap', monthly_cap_microusd: 10_000_000, month_spend: { available: true, value_microusd: 10_000_000 }, last_activity_at: '2026-10-28T12:00:00Z', project: null },
  { uid: 'a3', role_key: 'research', role_name: 'Research analyst', first_name: '[Milo]', last_name: '[Hart]', model_id: 'm-c', model_label: '[Model C]', tools: [], sponsor: { uid: 'u3', name: '[Sam Okafor]' }, status: 'active', paused_reason: null, monthly_cap_microusd: 10_000_000, month_spend: { available: false }, last_activity_at: null, project: null },
  { uid: 'a4', role_key: 'cto', role_name: 'CTO', first_name: '[Ada]', last_name: '[Quinn]', model_id: 'm-a', model_label: '[Model A]', tools: [], sponsor: { uid: 'u1', name: '[Avery Stone]' }, status: 'active', paused_reason: null, monthly_cap_microusd: 20_000_000, month_spend: { available: true, value_microusd: 2_100_000 }, last_activity_at: '2026-10-31T08:00:00Z', project: { id: 7, name: '[Atlas Pilot]' } },
];
const render = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// ---------------------------------------------------------------- the intake

test('the intake: both canvases landed, the grid imports the page by name, and D1497 records it', () => {
  const page = read('design/incoming/Team Page.dc.html');
  const grid = read('design/incoming/Team · Boards.dc.html');
  assert.ok(page.includes('src="./support.js"') && grid.includes('src="./support.js"'));
  assert.match(grid, /dc-import name="Team Page"/);
  assert.ok(grid.includes('TM9f'), 'the grid ends at TM9f');
  const d = readDecision(1497);
  assert.match(d, /^## D1497 — /);
  for (const issue of ['#3840', '#3841', '#3842', '#3843', '#3844', '#3697']) assert.ok(d.includes(issue), `D1497 names what waits for ${issue}`);
  assert.ok(existsSync('frontend/src/routes/team.jsx'));
});

// ---------------------------------------------------------------- the marker

test('an agent is a rounded square with the spark and the "AI agent" pill; a person is a circle', () => {
  const agent = render(h(AgentIdentity, { name: '[Nora Vale]', role: 'CFO' }));
  assert.match(agent, /data-testid="agent-tile" data-shape="square"/);
  assert.match(agent, /data-testid="agent-pill"[^>]*>.*AI agent/);
  assert.doesNotMatch(agent, /data-shape="circle"/);
  const person = render(h(PersonAvatar, { initials: 'AS' }));
  assert.match(person, /class="[^"]*rounded-full[^"]*"[^>]*data-shape="circle"/);
  assert.doesNotMatch(person, /agent-tile|AI agent/);
});

test('no people row draws the agent marker, and every agent row draws it with no circle', () => {
  const people = render(h(PeopleCard, { kind: 'company', people: peopleFromCompany(COMPANY, 1, VOCAB), canEdit: true }));
  assert.doesNotMatch(people, /agent-tile|agent-pill/);
  assert.equal((people.match(/data-shape="circle"/g) || []).length, 3);
  const card = render(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents: AGENTS.slice(0, 3) } }, kind: 'project', companyName: '[Lantern]', now: NOW }));
  for (const uid of ['a1', 'a2', 'a3']) {
    const row = card.slice(card.indexOf(`data-testid="agent-${uid}"`)).split('role="row"')[0];
    assert.match(row, /data-shape="square"/, uid);
    assert.match(row, /AI agent/, uid);
    assert.doesNotMatch(row, /data-shape="circle"/, uid);
  }
});

// ---------------------------------------------------------------- Not recorded

test('"Not recorded" is muted and never a zero: spend, last activity, title, counts', () => {
  const milo = agentRow(AGENTS[2], NOW);
  assert.equal(milo.spend, null);
  assert.equal(milo.last, null);
  assert.equal(spendLine(AGENTS[0]), '$3.84 of $25 cap');
  const card = renderedText(render(h(AgentsCard, { block: { available: true, value: { agents: [AGENTS[2]] } }, kind: 'project', companyName: 'x', now: NOW })));
  assert.equal((card.match(/Not recorded/g) || []).length, 3, 'this month (the phone line and its column) and last activity');
  assert.doesNotMatch(card, /\$0(\.00)?\b/);
  const html = render(h(AgentsCard, { block: { available: true, value: { agents: [AGENTS[2]] } }, kind: 'project', companyName: 'x', now: NOW }));
  assert.match(html, /<span class="italic text-gray-500 dark:text-gray-400">Not recorded<\/span>/, 'muted, not red');
  const sam = peopleFromCompany(COMPANY, 1, VOCAB).find((p) => p.userId === 3);
  assert.equal(sam.title, null);
  assert.match(renderedText(render(h(PeopleCard, { kind: 'company', people: [sam], canEdit: false }))), /\[Sam Okafor\][^]*FounderNot recordedWork/);
  assert.equal(countBadge(null), null);
  assert.equal(countBadge({ available: false }), null);
  assert.equal(countBadge({ available: true, value: 0 }), null, 'never "0 waiting"');
  assert.equal(countBadge({ available: true, value: 4 }), '4');
  const profile = renderedText(render(h(AgentProfile, { data: { agent: AGENTS[2], matrix: [], month_spend: { available: false }, proposals: { proposed: 4, accepted: null, withdrawn: 0 }, events: [] } })));
  assert.match(profile, /Proposed4/);
  assert.match(profile, /AcceptedNot recorded/, 'an unread count is not 0');
  assert.match(profile, /Withdrawn0/, 'a recorded zero stays 0');
});

// ---------------------------------------------------------------- unavailable is not none

/** #3842 (runQuote, runAgent), #3843 (queue, queueItem, decide) and #3844 (toolChoices): no route yet. */
const UNBUILT = ['runQuote', 'runAgent', 'queue', 'queueItem', 'decide', 'toolChoices'];
/** #3840's eight, wired to `teamAgentsApi`. */
const WIRED = ['roles', 'listAgents', 'addAgent', 'agent', 'updateAgent', 'removeAgent', 'rulebook', 'saveRulebook'];

test('the seam: #3842–#3844 still answer unavailable without a request, and the card says it is not "none"', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(String(u)); return response({ ok: true }); };
  try {
    for (const name of UNBUILT) {
      const out = await adapter[name]('company', 'nw1', {});
      assert.deepEqual(out, { available: false, reason: 'AI agents aren’t switched on yet.' }, `${name} claims something with no route`);
    }
    assert.deepEqual(seen, [], 'an unbuilt function reaches no route');
  } finally { globalThis.fetch = previous; restore(); }
  const exported = Object.entries(adapter).filter(([, fn]) => typeof fn === 'function').map(([n]) => n);
  for (const name of [...UNBUILT, ...WIRED]) assert.ok(exported.includes(name), name);
  const off = renderedText(render(h(AgentsCard, { block: adapter.unavailable(), kind: 'company', companyName: 'x' })));
  assert.match(off, /AI agents aren’t switched on yet\. That is not the same as having none\./);
  assert.doesNotMatch(off, /No agent works here yet/);
  const empty = renderedText(render(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents: [] } }, kind: 'company', companyName: 'x', canAdd: true })));
  assert.match(empty, /No agent works here yet\./);
  assert.match(empty, /Add an AI agent/);
  assert.doesNotMatch(render(h(AgentsCard, { block: { available: true, value: { agents: [] } }, kind: 'company', companyName: 'x' })), /team-agents-count/, 'no "[0]"');
});

test('through() maps the Worker\'s answers to what the page draws, in words', async () => {
  const fail = (status, code, data) => adapter.through(() => Promise.reject(Object.assign(new Error('x'), { status, code, data })));
  assert.deepEqual(await adapter.through(async () => ({ agents: [] })), { available: true, value: { agents: [] } });
  assert.deepEqual(await fail(404, 'team_agents_off'), { available: false, reason: 'AI agents aren’t switched on yet.' });
  assert.deepEqual(await fail(403, 'plan_required'), { available: false, locked: 'plan', reason: 'AI agents come with a paid Founder plan.' });
  // #3840's 422 names the section; the item outlined is the one the rules sent dropped.
  const sent = { rules: { always_asks_human: ['payment', 'sign', 'file', 'cap_table_write', 'send_post', 'invite_person'] } };
  const floor = await adapter.through(() => Promise.reject(Object.assign(new Error('x'), { status: 422, code: 'rule_floor', data: { error: 'rule_floor', section: 'always_asks_human' } })), sent);
  assert.equal(floor.highlight, 'send_email');
  assert.equal(floor.reason, 'This change can’t be saved. Sending an email always needs a person.');
  const taken = await fail(409, 'not_open', { decided_by: { name: '[Jordan Reyes]' } });
  assert.equal(taken.reason, 'Already decided by [Jordan Reyes].');
  assert.deepEqual(await fail(500, 'boom'), { available: false, unreadable: true, reason: 'could not be read' });
  assert.equal(refusalWords('module_not_allowed', 'Grow › Campaigns'), 'Not in its modules: Grow › Campaigns');
  for (const code of ['module_not_allowed', 'plan_required', 'role_taken', 'rule_floor', 'not_open', 'agent_cap_reached']) {
    assert.ok(!refusalWords(code).includes(code), `${code} reaches the page as words`);
  }
  const plan = renderedText(render(h(AgentsCard, { block: await fail(403, 'plan_required'), kind: 'company', companyName: 'x' })));
  assert.match(plan, /AI agents come with a paid Founder plan\.pending ownerSee plans/);
  const unread = renderedText(render(h(AgentsCard, { block: await fail(500), kind: 'company', companyName: 'x', onRetry() {} })));
  assert.match(unread, /AI agents could not be read\. That is not the same as having none\.Try again/);
});

test('a paused agent is amber with its reason and one fix, never red', () => {
  const html = render(h(AgentsCard, { block: { available: true, value: { agents: [AGENTS[1]] } }, kind: 'project', companyName: 'x', now: NOW }));
  assert.match(html, /bg-axal-amber[^"]*text-axal-amber-deep[^"]*" data-testid="agent-paused">Paused/);
  assert.doesNotMatch(html, /agent-paused[^>]*red|red[^"]*" data-testid="agent-paused"/);
  assert.match(renderedText(html), /Reached its monthly capRaise the cap/);
  assert.match(renderedText(html), /A paused agent keeps its history and its open proposals\./);
});

test('TM1e: a company editor\'s read groups each project\'s agents under its name, with the scope filter', () => {
  const html = render(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents: AGENTS } }, kind: 'company', companyName: '[Northwind Labs]', now: NOW }));
  assert.match(html, /role="group" aria-label="Scope"/);
  const text = renderedText(html);
  assert.match(text, /This company\[Atlas Pilot\]/);
  assert.match(text, /\[Northwind Labs\] · 3 agents/);
  assert.match(text, /Project · 1 agent/);
  // The company's reach over its projects is not live (#3697 part 2): the footer does not claim it.
  assert.doesNotMatch(text, /Company editors manage the agents of every project/);
  assert.match(text, /Agents propose; a named person accepts\. Nothing is written without Accept\./);
});

test('TM9d1: below md an agent row keeps its role, this month and its status on one line', () => {
  const html = render(h(AgentsCard, { block: { available: true, value: { agents: [AGENTS[0], AGENTS[1], AGENTS[2]] } }, kind: 'project', companyName: 'x', now: NOW }));
  const lines = html.split('data-testid="agent-phone-line"').slice(1).map((x) => renderedText(`<span ${x.split('role="cell"')[0]}`));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /CFO · \$3\.84 of \$25 capActive/);
  assert.match(lines[1], /CMO \/ Growth · \$10\.00 of \$10 capPaused/, 'a paused agent shows Paused on a phone');
  assert.match(lines[2], /Research analyst · this month Not recordedActive/, 'never $0');
  assert.match(html, /class="hidden md:block truncate[^"]*">CFO</, 'the role under the name is the desktop form only');
});

// ---------------------------------------------------------------- emails

test('another member\'s email is never drawn; your own row may show yours', () => {
  const people = peopleFromCompany(COMPANY, 1, VOCAB);
  assert.deepEqual(people.map((p) => p.email), ['you@example.com', null, null]);
  const html = render(h(PeopleCard, { kind: 'company', people, canEdit: true }));
  assert.ok(html.includes('you@example.com'));
  assert.ok(!html.includes('jordan@example.com') && !html.includes('sam@example.com'));
  assert.deepEqual(peopleFromProject(MEMBERS, 1).map((p) => p.email), ['you@example.com', null]);
  assert.equal(maskEmail('avery.new@example.com'), 'a•••@example.com');
  assert.equal(people[0].authorityTip, 'Sponsor: Champions a proposal and answers for it.', 'the vocabulary\'s words');
});

// ---------------------------------------------------------------- Ask, never Fill

test('the Eadwyn button is "Ask", its accessible name "Ask Eadwyn", and no Team file says Fill', () => {
  // D1604 lifted the button to ui/AskButton.jsx; Team re-exports the same component.
  assert.equal(TeamAskButtonView, AskButtonView);
  const ask = render(h(AskButtonView, {}));
  assert.match(ask, /aria-label="Ask Eadwyn"/);
  assert.equal(renderedText(ask).trim(), 'Ask');
  for (const f of readdirSync(TEAM).filter((x) => /\.jsx?$/.test(x))) {
    assert.doesNotMatch(codeOnly(read(`${TEAM}/${f}`)), /\bFill\b|Fill with Eadwyn/, `${f} says Fill`);
  }
  // The AIRail is untouched by this work.
  assert.doesNotMatch(read('frontend/src/ui/WorkerRail.jsx'), /pages\/team/);
});

// ---------------------------------------------------------------- no client method for a missing route

test('no client method exists for a route that does not exist', () => {
  const sources = [read('frontend/src/lib/api.js'), ...readdirSync('frontend/src/lib/api').filter((f) => f.endsWith('.js')).map((f) => read(`frontend/src/lib/api/${f}`))].join('\n');
  // #3842's run paths, #3843's queue and #3844's tools read have no route yet, so no client string names them.
  assert.doesNotMatch(sources, /\/teams\/agents\/[^'"`\n]*\/run\b/, '#3842: GET /api/teams/agents/:uid/run/quote and POST …/run');
  assert.doesNotMatch(sources, /\/teams\/[^'"`\n]*queue/, '#3843: /api/teams/:scope/:id/queue and /api/teams/queue/:proposalUid[/decide]');
  assert.doesNotMatch(sources, /\/teams\/tools/, '#3844: GET /api/teams/tools');
  // teamAgents.js builds its paths from parts, so its own strings are read whole.
  assert.doesNotMatch(codeOnly(read('frontend/src/lib/api/teamAgents.js')), /\/run\b|\/queue\b|\/tools\b/, 'no #3842–#3844 path in the agents client');
  const client = read('frontend/src/lib/api/teamAgents.js');
  for (const m of ['runQuote', 'runAgent', 'queue', 'queueItem', 'decide', 'toolChoices']) assert.doesNotMatch(client, new RegExp(`\\b${m}\\s*:`), `teamAgentsApi.${m} lands with its route`);
  // The adapter's #3840 bodies call #3840's client and nothing else; the unbuilt ones call nothing.
  const seam = codeOnly(read(`${TEAM}/agentsAdapter.js`));
  for (const m of ['roles', 'listAgents', 'addAgent', 'agent', 'updateAgent', 'removeAgent', 'rulebook', 'saveRulebook']) {
    assert.match(seam, new RegExp(`export const ${m} = [^\\n]*through\\(\\(\\) => teamAgentsApi\\.${m}\\(`), `${m} is wired to teamAgentsApi.${m}`);
  }
  for (const m of ['runQuote', 'runAgent', 'queue', 'queueItem', 'decide', 'toolChoices']) {
    assert.doesNotMatch(seam, new RegExp(`export const ${m} = [^\\n]*teamAgentsApi`), `${m} waits for its route`);
  }
  for (const f of readdirSync(TEAM).filter((x) => /\.jsx?$/.test(x))) {
    assert.doesNotMatch(read(`${TEAM}/${f}`), /request\(|fetch\(/, `${f} reaches the network itself`);
    // #3841 moved the people clients to teamsApi; the old `api.` names are gone from api.js.
    assert.doesNotMatch(read(`${TEAM}/${f}`), /\bapi\.(getCompany|updateCompanyMember|removeCompanyMember|teamVocabulary|inviteCompanyMember|listCompanyInvitations|resendCompanyInvitation|revokeCompanyInvitation|listProjectMembers|addProjectMember|createProjectInvitation|resendProjectInvitation|revokeProjectInvitation|removeProjectMember|searchPeople)\(/, `${f} calls a people client off teamsApi`);
  }
});

// ---------------------------------------------------------------- the model

test('invitation states (TM2c) and the move copy promise only what the Worker does', () => {
  assert.deepEqual([invitationState(INVITES.invitations[0], NOW).label, invitationState(INVITES.invitations[1], NOW).key, invitationState(INVITES.invitations[2], NOW).key], ['Pending', 'expired', 'revoked']);
  assert.deepEqual([invitationState(INVITES.invitations[1], NOW).resend, invitationState(INVITES.invitations[1], NOW).revoke], [true, false]);
  // Resent is read from the invitation: resend restarts the 14 days, so the live link is newer than the first.
  const resent = { ...INVITES.invitations[0], created_at: '2026-10-14 10:00:00', expires_at: '2026-11-13 09:00:00' };
  assert.equal(invitationState(resent, NOW).note, 'A new link was sent; the old one no longer works.');
  assert.equal(companyInvitationLine(resent), 'a•••@example.com · resent 30 Oct · expires 13 Nov · email sent', 'the day of the live link, not the first');
  assert.equal(invitationState({ ...resent, email_sent: false }, NOW).key, 'pending', 'no mail: never "Resent"');
  assert.equal(invitationState(INVITES.invitations[0], NOW).key, 'pending');
  const out = moveOutCopy('[Atlas Pilot]', '[Northwind Labs]');
  assert.equal(out.title, 'Move [Atlas Pilot] out of [Northwind Labs]?');
  assert.ok(!out.body.join(' ').includes('lose access'), 'not live until #3697 part 2');
  assert.ok(moveOutCopy('a', 'b', true).body.includes('b\'s editors lose access now.'));
  assert.match(whoMayAddAgents('company'), /primary admin, and Axal VC admins\.$/);
  assert.doesNotMatch(whoMayAddAgents('company'), /every project under/, 'not live until #3697 part 2');
  assert.match(whoMayAddAgents('company', null, true), /They also manage the agents of every project under the company\./);
  assert.doesNotMatch(whoMayAddAgents('company_project', '[Northwind Labs]'), /editors/);
  assert.match(whoMayAddAgents('company_project', '[Northwind Labs]', true), /^\[Northwind Labs\]’s editors and the project’s Owner\./);
  assert.equal(whoMayAddAgents('project'), 'Its Owner. A standalone project governs itself.');
});

test('a rule book keeps the seven-item floor locked and nothing automatic', () => {
  const book = { role_key: 'cfo', version: 3, effective: { mission: 'Drafts the runway note.', may_propose: ['Use of funds rows'], kpis: [], tone: null }, diff: [], versions: [] };
  const text = renderedText(render(h(RulebookView, { book, role: { name: 'CFO' }, onBack() {}, onEdit() {}, onRestore() {}, canManage: true })));
  for (const item of ['Payments', 'Signing', 'Filing', 'Cap table writes', 'Sending an email', 'Publishing a post', 'Inviting a person']) assert.ok(text.includes(item), item);
  assert.match(text, /Nothing is automatic in v1\.pending owner/);
  assert.match(text, /KPIsNot recorded/);
  assert.match(text, /ToneNot recorded/);
});

// ---------------------------------------------------------------- mounted on a stubbed fetch

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

function worker(over = {}) {
  return (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'http://x').pathname;
    if (over[`${method} ${path}`]) return over[`${method} ${path}`](init);
    if (path === '/api/company/nw1') return response(COMPANY);
    if (path === '/api/company/nw1/invitations' && method === 'GET') return response(INVITES);
    if (path === '/api/company/team-vocabulary') return response(VOCAB);
    if (path === '/api/projects/5') return response(PROJECT);
    if (path === '/api/projects/5/members') return response(MEMBERS);
    if (path === '/api/account/projects') return response({ projects: [] });
    // #3840's routes, as the Worker answers them while TEAM_AGENTS_ENABLED is off (both wrangler blocks).
    if (path.startsWith('/api/teams/')) return response({ error: 'team_agents_off' }, 404);
    return response({ ok: true });
  };
}

function Landed() {
  const { pathname, search } = useLocation();
  return h('p', { 'data-testid': 'landed', 'data-path': pathname, 'data-search': search }, 'landed');
}

async function mount(url, routePath, element, { handle = worker(), user = { id: 1, role: 'founder', name: '[Avery Stone]' }, companies = [] } = {}) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify(user));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => { seen.push({ key: `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`, body: init.body ? JSON.parse(init.body) : null }); return handle(String(u), init); };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const ctx = { company: null, setCompany() {}, companies, setCompanies() {} };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(ActiveCompanyContext.Provider, { value: ctx },
    h(Routes, null, h(Route, { path: routePath, element }), h(Route, { path: '*', element: h(Landed) }))))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    seen, keys: () => seen.map((s) => s.key), text: () => textOf(document.body), values: () => walk(document.body).map((n) => props(n)?.value).filter((x) => typeof x === 'string').join(' '), has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k],
    attr: (id, k) => byId(id)?.attributes?.[k] ?? props(byId(id))?.[k],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v } }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const COMPANY_ROUTE = '/account/companies/:uid/settings/team';

test('company Team: people and invitations on the routes that exist; agents unavailable; Resend and Revoke wired', async () => {
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }));
  try {
    assert.deepEqual(v.keys().filter((k) => k.startsWith('GET ')).sort(), ['GET /api/account/projects', 'GET /api/company/nw1', 'GET /api/company/nw1/invitations', 'GET /api/company/team-vocabulary', 'GET /api/teams/company/nw1/agents', 'GET /api/teams/roles']);
    const text = v.text();
    assert.match(text, /Company settings/);
    assert.match(text, /The people and AI agents working on \[Northwind Labs\]\. Agents propose; people decide\./);
    assert.match(text, /\[Avery Stone\] · you/);
    assert.ok(text.includes('you@example.com') && !text.includes('jordan@example.com'), 'no other member\'s address');
    assert.ok(text.includes('a•••@example.com') && !text.includes('avery.new@example.com'), 'invitation addresses masked');
    assert.match(text, /AI agents aren’t switched on yet\. That is not the same as having none\./);
    assert.doesNotMatch(text, /No agent works here yet|\bFill\b/);
    // The shared button's own test id is 'ask-eadwyn' (D1604 lifted it); Team's was 'team-ask'. Neither may draw.
    assert.ok(!v.has('team-ask') && !v.has('ask-eadwyn'), 'no panel serves this page, so no Ask button (and no rail)');
    await v.click('invitation-resend-i1');
    await v.click('invitation-revoke-i1');
    assert.deepEqual(v.keys().filter((k) => !k.startsWith('GET ')), ['POST /api/company/nw1/invitations/i1/resend', 'DELETE /api/company/nw1/invitations/i1']);
    await v.click('team-add');
    assert.equal(v.prop('team-add-agent', 'disabled'), true, 'AI agent is off with its reason');
    assert.match(v.text(), /AI agents aren’t switched on yet\./);
    await v.click('team-add-person');
    await v.change('invite-email', 'new.member@example.com');
    await v.change('invite-title', 'Principal');
    assert.match(v.text(), /Suggested for Principal: Sponsor\. You can choose another\./);
    await v.change('invite-role', 'Founder');
    await v.click('invite-send');
    const post = v.seen.find((s) => s.key === 'POST /api/company/nw1/invitations');
    assert.deepEqual(post.body, { email: 'new.member@example.com', role_in_company: 'Founder', title: 'Principal', authority: null });
    assert.match(v.text(), /The invitation is saved and sent\./);
  } finally { await v.close(); }
});

test('company Team for a member without editor rights: read-only, no invitations read, no Add to team (TM9a3)', async () => {
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { user: { id: 3, role: 'founder' }, handle: worker({ 'GET /api/company/nw1': () => response({ ...COMPANY, members: COMPANY.members.map((m) => (m.user_id === 3 ? { ...m, role_in_company: 'Member' } : m)) }) }) });
  try {
    assert.ok(!v.keys().includes('GET /api/company/nw1/invitations'));
    assert.match(v.text(), /You can see the team\. Only its editors invite or change people: an Owner, Admin or Founder, the primary admin, or an Axal VC admin\./);
    assert.equal(v.has('team-add'), false);
    assert.equal(v.has('person-actions-2'), false);
  } finally { await v.close(); }
});

test('an unread invitation list is "could not be read", never "No invitation is waiting."; a non-member is told so', async () => {
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: worker({ 'GET /api/company/nw1/invitations': () => response({ detail: 'boom' }, 500) }) });
  try {
    assert.match(v.text(), /The invitations could not be read\. That is not the same as none waiting\./);
    assert.doesNotMatch(v.text(), /No invitation is waiting/);
  } finally { await v.close(); }
  const w = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: worker({ 'GET /api/company/nw1': () => response({ detail: 'Company not found' }, 404) }) });
  try {
    assert.match(w.text(), /Ask one of its editors to invite you\.Back to my companies/);
  } finally { await w.close(); }
});

test('a standalone project: "Project" eyebrow, no Legal, Revoke and Resend wired', async () => {
  const v = await mount('/projects/5/settings/team', '/projects/:id/settings/team', h(TeamAgentsPage, { form: 'project' }));
  try {
    assert.equal(v.attr('team-page', 'data-scope'), 'project');
    const text = v.text();
    assert.match(text, /^Project/m);
    assert.doesNotMatch(text, /Legal/);
    assert.match(text, /Co-founder/);
    assert.ok(!text.includes('kai@example.com'));
    assert.match(text, /m•••@example\.com · Co-founder · sent 29 Oct · expires 12 Nov/);
    assert.equal(v.prop('invitation-resend-pi-41', 'disabled'), false, '#3841: Resend is on');
    assert.equal(v.has('invitation-resend-pi-42'), false, 'a link invitation offers Copy link, not Resend');
    assert.equal(v.prop('invitation-copy-pi-42', 'disabled'), true);
    await v.click('invitation-revoke-pi-41');
    assert.ok(v.keys().includes('POST /api/projects/5/invitations/41/revoke'));
    assert.match(text, /AI agents aren’t switched on yet\./);
  } finally { await v.close(); }
});

test('a project under a company is forwarded to Company settings › Projects, and the page says what is true', async () => {
  const handle = worker({ 'GET /api/projects/5': () => response({ ...PROJECT, name: '[Atlas Pilot]', company_id: 9 }) , 'GET /api/account/projects': () => response({ projects: [{ id: 5, company_uid: 'nw1', company_name: '[Northwind Labs]' }] }) });
  const v = await mount('/projects/5/settings/team', '/projects/:id/settings/team', h(TeamAgentsPage, { form: 'project' }), { handle });
  try {
    assert.equal(v.has('landed'), true, 'the standalone address does not draw a company project');
    assert.equal(v.prop('landed', 'data-path'), '/account/companies/nw1/settings/projects/5/team', 'forwarded to its own company\'s form');
  } finally { await v.close(); }
  const w = await mount('/account/companies/nw1/settings/projects/5/team', '/account/companies/:uid/settings/projects/:id/team', h(TeamAgentsPage, { form: 'company_project' }), { handle });
  try {
    assert.equal(w.attr('team-page', 'data-scope'), 'company_project');
    assert.match(w.text(), /Project · in \[Northwind Labs\]/);
    assert.match(w.text(), /This project sits under \[Northwind Labs\]\. Its own Owner manages this team today\./);
    assert.equal(w.has('company-editors'), false, 'not drawn until a read supplies them');
  } finally { await w.close(); }
});

test('Project settings › General: standalone offers Move under a company, only to companies you edit; no Legal', async () => {
  const companies = [
    { id: 9, uid: 'nw1', company_name: '[Northwind Labs]', my_role: 'Owner', is_primary_admin: true },
    { id: 10, uid: 'hr1', company_name: '[Harbor Robotics]', my_role: 'Member', is_primary_admin: false },
  ];
  const v = await mount('/projects/5/settings', '/projects/:id/settings', h(ProjectSettingsPage), { companies });
  try {
    assert.match(v.text(), /\[Lantern\] is a standalone project\. It is not a legal entity, and it governs itself\./);
    assert.doesNotMatch(v.text(), /Legal\b/);
    await v.click('move-under-open');
    assert.match(v.text(), /You are its Owner/);
    assert.match(v.text(), /You are a Member there\. Only its editors can take in a project\./);
    assert.equal(v.attr('move-under-hr1', 'aria-disabled'), true);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- review fixes

test('Resend with no mail hands the new link over and never says "Resent"; with mail it says so', async () => {
  const handle = worker({ 'POST /api/company/nw1/invitations/i1/resend': () => response({ ok: true, email_sent: false, accept_path: '/company/invitations/accept?token=t2', invitations: INVITES.invitations }) });
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle });
  try {
    await v.click('invitation-resend-i1');
    assert.match(v.text(), /The email did not send: copy this link and send it yourself\./);
    assert.match(v.values(), /accept\?token=t2/, 'the new link, in the toast');
    assert.doesNotMatch(v.text(), /A new link was sent/);
  } finally { await v.close(); }
  const w = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: worker({ 'POST /api/company/nw1/invitations/i1/resend': () => response({ ok: true, email_sent: true, accept_path: '/x', invitations: [] }) }) });
  try {
    await w.click('invitation-resend-i1');
    assert.match(w.text(), /The invitation was resent\. The old link no longer works\./);
  } finally { await w.close(); }
});

test('a failed people read still reads the agents and draws their own state, never "Reading…" forever', async () => {
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: worker({ 'GET /api/company/nw1': () => response({ detail: 'boom' }, 500) }) });
  try {
    assert.match(v.text(), /AI agents aren’t switched on yet\. That is not the same as having none\./);
  } finally { await v.close(); }
});

test('Add to team looks off while the team is read (aria-disabled dims like disabled)', () => {
  assert.match(read(`${TEAM}/teamUi.jsx`), /BTN_PRIMARY = '[^']*aria-disabled:cursor-not-allowed aria-disabled:opacity-45/);
});

test('a project under a company is never called standalone while it is read', async () => {
  const pending = () => new Promise(() => {});
  const v = await mount('/projects/5/settings', '/projects/:id/settings', h(ProjectSettingsPage), { handle: worker({ 'GET /api/projects/5': pending }) });
  try {
    assert.equal(v.attr('project-settings', 'data-scope'), 'loading');
    assert.equal(v.has('project-settings-company-reading'), true);
    assert.doesNotMatch(v.text(), /standalone/);
  } finally { await v.close(); }
  const w = await mount('/projects/5/settings/team', '/projects/:id/settings/team', h(TeamAgentsPage, { form: 'project' }), { handle: worker({ 'GET /api/projects/5': pending }) });
  try {
    assert.match(w.text(), /^Reading…/, 'the eyebrow names no scope before the read');
    assert.equal(w.has('team-managed-note'), false);
  } finally { await w.close(); }
});

test('Remove is not offered where the Worker refuses it, and Change role cannot demote in one click', async () => {
  const project = render(h(PeopleCard, { kind: 'project', people: peopleFromProject(MEMBERS, 4), canEdit: true }));
  assert.doesNotMatch(project, /person-actions-1"/, 'the project Owner has no Remove, so no menu');
  const solo = { ...COMPANY, members: [{ ...COMPANY.members[0], role_in_company: null }, COMPANY.members[1]] };
  const people = peopleFromCompany(solo, 2, VOCAB);
  assert.equal(people[0].removable, false, 'the only primary admin');
  assert.equal(people[1].removable, true);
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { user: { id: 2, role: 'founder' }, handle: worker({ 'GET /api/company/nw1': () => response(solo) }) });
  try {
    await v.click('person-actions-1');
    assert.equal(v.has('person-remove-1'), false);
    await v.click('person-change-role-1');
    assert.equal(v.prop('team-change-role-select', 'value'), '', 'opens on the current (empty) role, not Member');
    assert.match(v.text(), /Primary admin, no role \(current\)/);
    assert.equal(v.prop('team-change-role-confirm', 'disabled'), true, 'Save is off until another role is chosen');
    await v.change('team-change-role-select', 'Admin');
    assert.equal(v.prop('team-change-role-confirm', 'disabled'), false);
  } finally { await v.close(); }
});

test('TM2c: the member who joined through an invitation accepted this week is highlighted with Joined', () => {
  const invitations = [{ uid: 'i9', email: 'SAM@example.com', status: 'accepted', accepted_at: '2026-10-30 10:00:00' }];
  const key = freshMemberKey(COMPANY, invitations, NOW);
  assert.equal(key, 'u-3');
  assert.equal(freshMemberKey(COMPANY, [{ ...invitations[0], accepted_at: '2026-09-01 10:00:00' }], NOW), null, 'not this week');
  const html = render(h(PeopleCard, { kind: 'company', people: peopleFromCompany(COMPANY, 1, VOCAB), canEdit: true, highlightKey: key }));
  assert.match(renderedText(html), /\[Sam Okafor\]Joined 3 Sep/);
  assert.equal((html.match(/data-testid="person-joined"/g) || []).length, 1);
  assert.ok(!html.includes('sam@example.com'), 'the address is matched, never drawn');
});

test('TM3a–TM3c: held roles read "A CMO", tools are granted from #3844\'s servers, the rule book opens row by row', () => {
  assert.equal(heldLabel({ key: 'cmo', name: 'CMO / Growth' }), 'A CMO');
  assert.equal(heldLabel({ key: 'research', name: 'Research analyst' }), 'A research analyst');
  const src = read(`${TEAM}/AddAgentSheet.jsx`);
  assert.doesNotMatch(src, /tool_grants: \[\]/, 'the ticked tools are sent');
  assert.match(src, /tool_grants: grants/);
  assert.match(src, /role="switch"/);
  assert.match(src, /Before each run it shows the hold/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /Edit for this company/);
  const roles = [{ key: 'cto', name: 'CTO', mission: 'Watches build health.' }, { key: 'cmo', name: 'CMO / Growth', mission: 'Drafts campaigns.' }];
  const html = render(h(AddAgentSheet, { scope: { kind: 'company', company: { uid: 'nw1' } }, roles, held: ['cmo'], onClose() {} }));
  assert.match(renderedText(html), /A CMO already works here\. One agent per role\./);
});

test('TM7a, TM7b2, TM9b1: four filters, Accept decides from the row, and the decision and pause words in full', () => {
  const value = { items: [{ uid: 'p1', title: 'Weekly runway note draft', module_label: 'Raise › Runway', status: 'proposed', agent: AGENTS[0], cost: { available: true, value_microusd: 40_000 }, sponsor: { name: '[Avery Stone]' } }], decided: [] };
  const html = render(h(ApprovalsBoard, { value, onOpen() {}, onAccept() {} }));
  for (const l of ['Role', 'Module', 'Status', 'Cost']) assert.match(html, new RegExp(`aria-label="${l}"`), l);
  assert.match(html, /data-testid="approval-accept-p1"/);
  assert.equal(decidedLine({ decision: 'accept', by: '[Jordan Reyes]', at: '2026-10-31 09:40:00' }), 'Accepted 31 Oct 09:40 by [Jordan Reyes].');
  assert.equal(pauseWords({ status: 'paused', paused_reason: 'cap', resumes_at: '2026-11-01' }).reason, 'Reached its monthly cap. Resumes 1 Nov.');
  assert.equal(pauseWords({ status: 'paused', paused_reason: 'tool_disconnected', paused_server: { name: '[Finance MCP]' } }).reason, 'A connected tool was disconnected: [Finance MCP] is disconnected');
});

test('TM4b2 and TM4c: the counsel banner, the Edit sheet\'s own floor line, and dates as days', () => {
  const book = { role_key: 'general_counsel', version: 3, effective: {}, diff: [], versions: [{ version: 3, by: { name: '[Avery Stone]' }, at: '2026-10-30T10:00:00Z' }] };
  const text = renderedText(render(h(RulebookView, { book, role: { key: 'general_counsel', name: 'General counsel (assistant)' }, onBack() {}, onEdit() {}, onRestore() {}, canManage: false })));
  assert.match(text, /Not legal advice\. Always escalates\.pending owner: wording from counsel/);
  assert.match(text, /v3 by \[Avery Stone\] · 30 Oct/);
  assert.match(read(`${TEAM}/RulebooksTab.jsx`), /note=\{FLOOR_EDIT_NOTE\}/);
  const profile = renderedText(render(h(AgentProfile, { data: { agent: AGENTS[0], matrix: [], month_spend: { available: true, value_microusd: 3_840_000 }, resets_at: '2026-11-01', events: [{ text: 'Ran', at: '2026-10-31T09:12:00Z' }] } })));
  assert.match(profile, /Resets 1 Nov/);
  assert.match(profile, /Ran31 Oct 09:12/);
  const nocap = renderedText(render(h(AgentProfile, { data: { agent: { ...AGENTS[0], monthly_cap_microusd: null }, matrix: [], month_spend: { available: true, value_microusd: 3_840_000 }, events: [] } })));
  assert.match(nocap, /\$3\.84 this month · cap Not recorded/);
  assert.doesNotMatch(nocap, /null|undefined/);
});

// ---------------------------------------------------------------- #3841: project Resend, linking an account

test('project Resend (#3841): the new link\'s fate in words, and 403 not_manager and 409 not_pending in words', async () => {
  const sent = (body) => () => response(body);
  const cases = [
    [sent({ invitation: { id: 41, status: 'pending', source: 'email', expires_at: '2026-11-14 10:00:00', email_sent: true } }), /The invitation was resent\. The old link no longer works\./],
    [sent({ invitation: { id: 41, status: 'pending', source: 'email', expires_at: '2026-11-14 10:00:00', email_sent: false } }), /the email did not send\. Resend again, or revoke it and invite again\./],
    [() => response({ code: 'not_manager', message: 'Only the project owner can manage the team.' }, 403), /Only this team’s editors can do this\./],
    [() => response({ code: 'not_pending', message: 'x' }, 409), /This invitation was already answered or revoked\./],
  ];
  for (const [answer, words] of cases) {
    const v = await mount('/projects/5/settings/team', '/projects/:id/settings/team', h(TeamAgentsPage, { form: 'project' }), { handle: worker({ 'POST /api/projects/5/invitations/41/resend': answer }) });
    try {
      await v.click('invitation-resend-pi-41');
      assert.deepEqual(v.keys().filter((k) => !k.startsWith('GET ') && k !== 'POST /api/client-error'), ['POST /api/projects/5/invitations/41/resend']);
      assert.match(v.text(), words);
      assert.doesNotMatch(v.text(), /not_manager|not_pending/, 'never the code');
    } finally { await v.close(); }
  }
});

const PEOPLE = { people: [
  { uid: 'u-jr', name: '[Jordan Reyes]', avatar_url: null, shared: [{ kind: 'company', name: '[Northwind Labs]' }] },
  { uid: 'u-mo', name: '[Mara Ortiz]', avatar_url: null, shared: [{ kind: 'connection', name: 'Co-founder match' }] },
] };
const rest = () => act(async () => { await new Promise((r) => setTimeout(r, 300)); });

async function openAccount(handle) {
  const v = await mount('/projects/5/settings/team', '/projects/:id/settings/team', h(TeamAgentsPage, { form: 'project' }), { handle });
  await v.click('team-add');
  await v.click('team-add-person');
  await v.click('invite-method-account');
  return v;
}

test('Link an existing Axal account (#3841): a debounced name search, two letters at least, never an email or a numeric id', async () => {
  let searches = 0;
  const handle = worker({ 'GET /api/account/people/search': () => { searches += 1; return response({ people: PEOPLE.people.map((p) => ({ ...p, email: 'leak@example.com', id: 77 })) }); } });
  const v = await openAccount(handle);
  try {
    assert.equal(v.prop('invite-method-account', 'disabled'), undefined, 'no longer off');
    assert.equal(v.prop('invite-send', 'disabled'), true, 'nothing to send before a pick');
    await v.change('invite-account-q', 'J');
    await rest();
    assert.equal(searches, 0, 'one letter is not sent');
    assert.match(v.text(), /Type at least 2 letters of a name\./);
    await v.change('invite-account-q', 'Jo');
    await v.change('invite-account-q', 'Jor');
    assert.equal(searches, 0, 'nothing is sent while typing');
    await rest(); await rest();
    assert.equal(searches, 1, 'one search once typing rests');
    const q = v.seen.find((s) => s.key === 'GET /api/account/people/search');
    assert.ok(q);
    const text = v.text();
    assert.match(text, /\[Jordan Reyes\]Shares \[Northwind Labs\]/);
    assert.match(text, /\[Mara Ortiz\]Co-founder match/);
    assert.ok(!text.includes('leak@example.com') && !v.values().includes('leak@example.com'), 'no email, even when the answer carries one');
    assert.doesNotMatch(text, /\b77\b/, 'no numeric id');
  } finally { await v.close(); }
  const w = await openAccount(worker({ 'GET /api/account/people/search': () => response({ code: 'query_too_short', message: 'x' }, 400) }));
  try {
    await w.change('invite-account-q', 'ab');
    await rest(); await rest();
    assert.match(w.text(), /Type at least 2 letters of a name\./, '400 query_too_short is the same hint');
    assert.doesNotMatch(w.text(), /could not be read/);
  } finally { await w.close(); }
  const x = await openAccount(worker({ 'GET /api/account/people/search': () => response({ detail: 'boom' }, 500) }));
  try {
    await x.change('invite-account-q', 'ab');
    await rest(); await rest();
    assert.match(x.text(), /The search could not be read\. That is not the same as nobody matching\./);
  } finally { await x.close(); }
});

test('Choosing an account sends { mode: \'account\', user_uid, role }; its refusals are words about the person', async () => {
  const v = await openAccount(worker({ 'GET /api/account/people/search': () => response(PEOPLE), 'POST /api/projects/5/invitations': () => response({ invitation: { id: 50, status: 'pending', source: 'account' }, email_sent: null }) }));
  try {
    await v.change('invite-account-q', 'Jor');
    await rest(); await rest();
    await v.change('invite-account-u-jr', 'on');
    await v.change('invite-seat-advisor', 'on');
    assert.equal(v.prop('invite-send', 'disabled'), false);
    await v.click('invite-send');
    const post = v.seen.find((s) => s.key === 'POST /api/projects/5/invitations');
    assert.deepEqual(post.body, { mode: 'account', user_uid: 'u-jr', role: 'advisor' });
    assert.match(v.text(), /The invitation is waiting in their Account › Invitations\./);
  } finally { await v.close(); }
  const refusals = [
    [404, 'account_not_found', /That account no longer exists\. Search again\./],
    [403, 'not_reachable', /You can invite only people you share a company or a co-founder match with\./],
    [409, 'already_member', /They are already on this team\./],
    [409, 'already_pending', /An invitation to them is already waiting\. Nothing was sent\./],
  ];
  for (const [status, code, words] of refusals) {
    const w = await openAccount(worker({ 'GET /api/account/people/search': () => response(PEOPLE), 'POST /api/projects/5/invitations': () => response({ code, message: 'x' }, status) }));
    try {
      await w.change('invite-account-q', 'Jor');
      await rest(); await rest();
      await w.change('invite-account-u-jr', 'on');
      await w.click('invite-send');
      assert.match(w.text(), words, code);
      assert.ok(!w.text().includes(code), `${code} reaches the page as words`);
    } finally { await w.close(); }
  }
});

// ---------------------------------------------------------------- #3840 (part 1): wired

/** #3840's answers, as `routes/team_agents.ts` builds them: no model label, a person is { uid, name }. */
const DTO = (a) => { const { model_label, ...rest } = a; return { ...rest, scope_kind: a.project ? 'project' : 'company' }; };
const FLOOR_KEYS = ['payment', 'sign', 'file', 'cap_table_write', 'send_email', 'send_post', 'invite_person'];
const DEFAULT_RULES = { mission: 'Drafts the runway note.', works_in: ['studio'], reads: [], may_propose: [], may_do_automatically: [], always_asks_human: FLOOR_KEYS, escalates_when: ['Runway under six months'], kpis: [], tone: 'Plain.' };
const ROLES = { roles: [{ key: 'cfo', name: 'CFO', mission: 'Keeps the money honest.', works_in: [{ key: 'studio', label: 'Studio' }], default_rules: DEFAULT_RULES }] };
const LIST = { can_manage: true, plan_ok: true, agents: [DTO(AGENTS[0]), DTO(AGENTS[2])] };
const PROFILE = {
  agent: DTO(AGENTS[0]), can_manage: true, rulebook: { effective: DEFAULT_RULES, version: 0 },
  matrix: [{ module: 'studio', label: 'Studio', read: true, propose: false, auto: false }],
  cap_microusd: 25_000_000, month_spend: { available: true, value_microusd: 3_840_000 },
  proposals: { proposed: 2, accepted: 0, edited: 0, discarded: 0, withdrawn: 0 },
  events: [
    { kind: 'cap_changed', actor: { uid: 'u9', name: '' }, at: '2026-10-30 09:00:00', detail: { from_microusd: 10_000_000, to_microusd: 25_000_000 } },
    { kind: 'added', actor: { uid: 'u1', name: '[Avery Stone]' }, at: '2026-10-29 09:00:00', detail: null },
  ],
};
const BOOK = { role_key: 'cfo', default: DEFAULT_RULES, effective: DEFAULT_RULES, version: 0, versions: [], diff: [], floor: FLOOR_KEYS };
/** A Worker refusal body (`util/refusal.ts`): `error` is the code, `message` and `detail` our sentence. */
const refusal = (status, code, extra = {}) => response({ ...extra, error: code, message: 'A sentence.', detail: 'A sentence.' }, status);

/** The adapter alone, on a stubbed fetch: what each call sent, and what it answered. */
async function onWorker(handle, run) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder' }));
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    seen.push({ key: `${(init.method || 'GET').toUpperCase()} ${url.pathname}${url.search}`, body: init.body ? JSON.parse(init.body) : null });
    return handle(String(u), init);
  };
  try { return await run(seen); } finally { globalThis.fetch = previous; restore(); }
}

test('#3840 wired: list, add, profile, update, remove and rule books call teamAgentsApi and answer available', async () => {
  const answers = {
    'GET /api/teams/roles': () => response(ROLES),
    'GET /api/teams/company/nw1/agents': () => response(LIST),
    'POST /api/teams/company/nw1/agents': () => response({ agent: DTO(AGENTS[0]) }, 201),
    'GET /api/teams/agents/a1': () => response(PROFILE),
    'PATCH /api/teams/agents/a1': () => response({ agent: { ...DTO(AGENTS[0]), status: 'paused', paused_reason: 'manual' } }),
    'DELETE /api/teams/agents/a1': () => response({ ok: true }),
    'GET /api/teams/project/5/rulebooks/cfo': () => response(BOOK),
    'PUT /api/teams/project/5/rulebooks/cfo': () => response({ effective: DEFAULT_RULES, version: 1 }),
  };
  await onWorker((u, init) => answers[`${(init.method || 'GET').toUpperCase()} ${new URL(u, 'http://x').pathname}`](), async (seen) => {
    assert.deepEqual(await adapter.roles(), { available: true, value: ROLES });
    assert.deepEqual(await adapter.listAgents('company', 'nw1', { include: 'projects' }), { available: true, value: LIST });
    const body = { role_key: 'cfo', first_name: '[Nora]', last_name: null, model_id: 'm-a', tool_grants: [], monthly_cap_microusd: 25_000_000 };
    assert.equal((await adapter.addAgent('company', 'nw1', body)).value.agent.uid, 'a1');
    assert.deepEqual((await adapter.agent('a1')).value.proposals, PROFILE.proposals);
    assert.equal((await adapter.updateAgent('a1', { status: 'paused' })).value.agent.status, 'paused');
    assert.deepEqual(await adapter.removeAgent('a1'), { available: true, value: { ok: true } });
    assert.equal((await adapter.rulebook('project', 5, 'cfo')).value.version, 0);
    assert.deepEqual((await adapter.saveRulebook('project', 5, 'cfo', DEFAULT_RULES)).value, { effective: DEFAULT_RULES, version: 1 });
    assert.deepEqual(seen.map((s) => s.key), [
      'GET /api/teams/roles', 'GET /api/teams/company/nw1/agents?include=projects', 'POST /api/teams/company/nw1/agents', 'GET /api/teams/agents/a1',
      'PATCH /api/teams/agents/a1', 'DELETE /api/teams/agents/a1', 'GET /api/teams/project/5/rulebooks/cfo', 'PUT /api/teams/project/5/rulebooks/cfo',
    ]);
    assert.deepEqual(seen[2].body, body);
    assert.deepEqual(seen[4].body, { status: 'paused' });
    assert.deepEqual(seen[7].body, { rules: DEFAULT_RULES });
  });
});

test('#3840\'s refusals reach the page as what it draws, in words, never as their codes', async () => {
  const cases = [
    ['listAgents', [], 404, 'team_agents_off', {}, { available: false, reason: 'AI agents aren’t switched on yet.' }],
    ['addAgent', [{}], 403, 'plan_required', {}, { available: false, locked: 'plan', reason: 'AI agents come with a paid Founder plan.' }],
    ['addAgent', [{}], 403, 'not_manager', {}, { refused: true, reason: 'Only this team’s editors can do this.' }],
    ['addAgent', [{}], 409, 'role_taken', {}, { refused: true, reason: 'An agent already holds this role here. One agent per role.' }],
    ['addAgent', [{}], 422, 'model_not_offered', {}, { refused: true, reason: 'That model is not offered on your plan.' }],
    ['addAgent', [{}], 422, 'tool_not_approved', {}, { refused: true, reason: 'That tool is not one you approved for read-only use.' }],
    ['addAgent', [{}], 400, 'invalid_cap', {}, { refused: true, reason: 'The monthly cap must be more than $0.' }],
    ['updateAgent', [{ first_name: 'x' }], 400, 'invalid_name', {}, { refused: true, reason: 'A name is at most 40 characters.' }],
    ['updateAgent', [{ status: 'paused' }], 409, 'removed', {}, { refused: true, reason: 'This agent was removed.' }],
    ['saveRulebook', [{ ...DEFAULT_RULES, always_asks_human: FLOOR_KEYS.filter((k) => k !== 'sign') }], 422, 'rule_floor', { section: 'always_asks_human' }, { refused: true, highlight: 'sign', reason: 'This change can’t be saved. Signing always needs a person.' }],
    ['saveRulebook', [{ ...DEFAULT_RULES, may_do_automatically: ['x'] }], 422, 'rule_floor', { section: 'may_do_automatically' }, { refused: true, highlight: null, reason: 'This change can’t be saved. Nothing is automatic in v1.' }],
    ['saveRulebook', [DEFAULT_RULES], 422, 'invalid_rules', { section: 'tone' }, { refused: true, reason: 'This change can’t be saved. Check Tone.' }],
    ['saveRulebook', [DEFAULT_RULES], 409, 'rulebook_changed', {}, { refused: true, reason: 'Someone saved this rule book a moment ago. Reload it and try again.' }],
    ['agent', [], 500, 'boom', {}, { available: false, unreadable: true, reason: 'could not be read' }],
  ];
  for (const [fn, rest, status, code, extra, want] of cases) {
    await onWorker(() => refusal(status, code, extra), async () => {
      const args = fn === 'agent' ? ['a1'] : ['updateAgent'].includes(fn) ? ['a1', ...rest] : fn === 'saveRulebook' ? ['company', 'nw1', 'cfo', ...rest] : ['company', 'nw1', ...rest];
      const out = await adapter[fn](...args);
      assert.equal(out.available, false, `${fn} ${code}`);
      for (const [k, v] of Object.entries(want)) assert.deepEqual(out[k], v, `${fn} ${code}: ${k}`);
      assert.ok(out.reason !== code && !(code.includes('_') && String(out.reason).includes(code)), `${code} reaches the page as words`);
    });
  }
});

/** The company page with #3840 switched on. */
const agentsOn = (over = {}) => worker({
  'GET /api/teams/roles': () => response(ROLES),
  'GET /api/teams/company/nw1/agents': () => response(LIST),
  'GET /api/teams/agents/a1': () => response(PROFILE),
  'GET /api/teams/company/nw1/rulebooks/cfo': () => response(BOOK),
  ...over,
});

test('#3840 switched on: the agents card draws the list with the AI agent pill, Not recorded for unread spend, and no Add without the plan', async () => {
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: agentsOn() });
  try {
    assert.ok(v.keys().includes('GET /api/teams/company/nw1/agents'));
    const text = v.text();
    assert.match(text, /\[Nora\] \[Vale\]AI agent/);
    assert.match(text, /\[Milo\] \[Hart\]AI agent/);
    assert.match(text, /Platform model · m-a/, 'the model the Worker names, with no invented label');
    assert.match(text, /Research analyst · this month Not recorded/, 'unread spend is Not recorded');
    assert.doesNotMatch(text, /\$0\.00|aren’t switched on/);
    await v.click('team-add');
    assert.equal(v.prop('team-add-agent', 'disabled'), false, 'an editor on a paid plan may add');
  } finally { await v.close(); }
  const w = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: agentsOn({ 'GET /api/teams/company/nw1/agents': () => response({ ...LIST, plan_ok: false }) }) });
  try {
    assert.ok(w.has('team-agents-plan'), 'the plan line under the list (TM9c4)');
    await w.click('team-add');
    assert.equal(w.prop('team-add-agent', 'disabled'), true, 'plan_ok false turns AI agent off');
    assert.match(w.text(), /AI agents come with a paid Founder plan\./);
    assert.ok(!w.text().includes('plan_required'));
  } finally { await w.close(); }
  const e = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: agentsOn({ 'GET /api/teams/company/nw1/agents': () => response({ ...LIST, plan_ok: false, agents: [] }) }) });
  try {
    assert.match(e.text(), /No agent works here yet\./, 'an empty list the Worker answered');
    assert.equal(e.has('team-agents-add'), false, 'no Add button without the plan');
    assert.ok(e.has('team-agents-plan'));
  } finally { await e.close(); }
});

test('#3840 profile: events in words with a Not recorded actor, Pause and Remove write only after their confirm', async () => {
  const v = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: agentsOn() });
  try {
    await v.click('agent-a1');
    assert.ok(v.keys().includes('GET /api/teams/agents/a1'));
    const text = v.text();
    assert.match(text, /Cap changed from \$10 to \$25 by Not recorded/);
    assert.match(text, /Added by \[Avery Stone\]/);
    assert.doesNotMatch(text, /cap_changed/);
    assert.match(text, /Proposed2/);
    await v.click('agent-pause');
    assert.ok(!v.keys().includes('PATCH /api/teams/agents/a1'), 'nothing is written before the confirm');
    await v.click('agent-pause-confirm-yes');
    assert.deepEqual(v.seen.find((s) => s.key === 'PATCH /api/teams/agents/a1').body, { status: 'paused' });
  } finally { await v.close(); }
  const w = await mount('/account/companies/nw1/settings/team', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), { handle: agentsOn({ 'DELETE /api/teams/agents/a1': () => refusal(403, 'not_manager') }) });
  try {
    await w.click('agent-a1');
    await w.click('agent-remove');
    assert.ok(!w.keys().includes('DELETE /api/teams/agents/a1'));
    await w.click('agent-remove-confirm-yes');
    assert.ok(w.keys().includes('DELETE /api/teams/agents/a1'));
    assert.match(w.text(), /Only this team’s editors can do this\./, 'a refusal in words, the dialog kept open');
    assert.ok(w.has('agent-remove-confirm'));
  } finally { await w.close(); }
});

test('#3840 rule books: the default reads "Default", a floor refusal outlines the dropped item, a save is re-read', async () => {
  const broken = { ...BOOK, effective: { ...DEFAULT_RULES, always_asks_human: FLOOR_KEYS.filter((k) => k !== 'send_email') } };
  const v = await mount('/account/companies/nw1/settings/team?tab=roles&role=cfo', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), {
    handle: agentsOn({ 'GET /api/teams/company/nw1/rulebooks/cfo': () => response(broken), 'PUT /api/teams/company/nw1/rulebooks/cfo': () => refusal(422, 'rule_floor', { section: 'always_asks_human' }) }),
  });
  try {
    assert.match(v.text(), /CFO · Rule book · Default/);
    await v.click('rulebook-edit');
    await v.click('rulebook-save');
    assert.match(v.text(), /This change can’t be saved\. Sending an email always needs a person\./);
    assert.ok(!v.text().includes('rule_floor'));
    assert.equal(v.prop('rulebook-save', 'disabled'), true, 'Save waits for the outlined item');
  } finally { await v.close(); }
  let reads = 0;
  const w = await mount('/account/companies/nw1/settings/team?tab=roles&role=cfo', COMPANY_ROUTE, h(TeamAgentsPage, { form: 'company' }), {
    handle: agentsOn({
      'GET /api/teams/company/nw1/rulebooks/cfo': () => { reads += 1; return response(reads > 1 ? { ...BOOK, version: 1, versions: [{ version: 1, by: { uid: 'u1', name: '[Avery Stone]' }, at: '2026-10-31 10:00:00' }] } : BOOK); },
      'PUT /api/teams/company/nw1/rulebooks/cfo': () => response({ effective: DEFAULT_RULES, version: 1 }),
    }),
  });
  try {
    await w.click('rulebook-edit');
    await w.click('rulebook-save');
    assert.deepEqual(Object.keys(w.seen.find((s) => s.key === 'PUT /api/teams/company/nw1/rulebooks/cfo').body), ['rules']);
    assert.equal(reads, 2, 'the history is read again after a save');
    assert.match(w.text(), /CFO · Rule book · v1v1 by \[Avery Stone\] · 31 Oct/);
  } finally { await w.close(); }
});

test('#3840 Add agent: the sheet posts the role, names, model and cap, and a refusal comes back in words', async () => {
  const models = [{ id: 'm-a', label: '[Model A]' }];
  const sheet = h(AddAgentSheet, { scope: { kind: 'company', company: { uid: 'nw1' } }, roles: ROLES.roles, models, held: [], me: { name: '[Avery Stone]' }, onClose() {} });
  const v = await mount('/x', '/x', sheet, { handle: worker({ 'POST /api/teams/company/nw1/agents': () => refusal(409, 'role_taken') }) });
  try {
    await v.click('add-agent-role-cfo');
    await v.click('add-agent-next');
    const radio = walkRadio();
    assert.ok(radio, 'the model radio');
    await act(async () => { radio.onChange(); });
    await v.click('add-agent-next');
    await v.change('add-agent-first', '[Nora]');
    await v.change('add-agent-cap', '25');
    await v.click('add-agent-next');
    assert.deepEqual(v.seen.find((s) => s.key === 'POST /api/teams/company/nw1/agents').body, { role_key: 'cfo', first_name: '[Nora]', last_name: null, model_id: 'm-a', tool_grants: [], monthly_cap_microusd: 25_000_000 });
    assert.match(v.text(), /An agent already holds this role here\. One agent per role\./);
    assert.ok(!v.text().includes('role_taken'));
  } finally { await v.close(); }
});

/** The first model radio's React props in the mounted Add sheet. */
function walkRadio() {
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  return walk(document.body).map(props).find((p) => p?.type === 'radio' && p?.name === 'model');
}
