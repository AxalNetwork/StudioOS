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

test('the seam: every agent read is unavailable on this base, and the card says it is not "none"', async () => {
  for (const [name, fn] of Object.entries(adapter)) {
    if (typeof fn !== 'function' || ['through', 'unavailable'].includes(name)) continue;
    const out = await fn('company', 'nw1', {});
    assert.equal(out.available, false, `${name} claims something on a base with no route`);
    assert.equal(out.reason, 'AI agents aren’t switched on yet.');
  }
  const off = renderedText(render(h(AgentsCard, { block: await adapter.listAgents('company', 'nw1'), kind: 'company', companyName: 'x' })));
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
  const floor = await fail(422, 'rule_floor', { item: 'send_email' });
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
  assert.doesNotMatch(sources, /['"`]\/teams\//, 'the agent routes are #3840–#3844');
  assert.doesNotMatch(sources, /\/account\/settings-scope/, '#3697 part 2');
  assert.doesNotMatch(sources, /\/account\/people\/search/, '#3841');
  assert.doesNotMatch(sources, /\/projects\/[^'"`]*\/invitations\/[^'"`]*\/resend/, '#3841');
  assert.ok(!existsSync('frontend/src/lib/api/teamAgents.js') && !existsSync('frontend/src/lib/api/teams.js'));
  for (const f of readdirSync(TEAM).filter((x) => /\.jsx?$/.test(x))) {
    assert.doesNotMatch(read(`${TEAM}/${f}`), /request\(|fetch\(/, `${f} reaches the network itself`);
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
    assert.deepEqual(v.keys().filter((k) => k.startsWith('GET ')).sort(), ['GET /api/account/projects', 'GET /api/company/nw1', 'GET /api/company/nw1/invitations', 'GET /api/company/team-vocabulary']);
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

test('a standalone project: "Project" eyebrow, no Legal, Revoke wired, Resend off with its reason', async () => {
  const v = await mount('/projects/5/settings/team', '/projects/:id/settings/team', h(TeamAgentsPage, { form: 'project' }));
  try {
    assert.equal(v.attr('team-page', 'data-scope'), 'project');
    const text = v.text();
    assert.match(text, /^Project/m);
    assert.doesNotMatch(text, /Legal/);
    assert.match(text, /Co-founder/);
    assert.ok(!text.includes('kai@example.com'));
    assert.match(text, /m•••@example\.com · Co-founder · sent 29 Oct · expires 12 Nov/);
    assert.equal(v.prop('invitation-resend-pi-41', 'disabled'), true);
    assert.match(v.prop('invitation-resend-pi-41', 'title'), /not open yet/);
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
