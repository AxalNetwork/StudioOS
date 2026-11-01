// D1613 (#3723): the Calendar's AI agent sessions (the addendum's AG8 to
// AG11), the plain source names on the rail, and the seam to #3957.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_agents_d1613.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import * as seam from '../src/pages/calendarAgentsAdapter.js';
import {
  AGENT_FAMILY, AGENT_KIND, HOLD_LINE, INSTRUCTION_MAX, NOT_RECORDED, PROPOSALS_LINE,
  agentGroups, agentMeta, capLine, estimateLine, money, offLine, readOnlyLine, repeatLine, runNowLine, runRow,
  sessionActions, sessionBody, sessionRefusal, skillHint, skipReason, sponsorLine, stateChip, teamPath, waitingBanner,
} from '../src/pages/calendarAgentModel.js';
import { AgentPicker, AgentSessionFooter, AgentSessionView, StateChip } from '../src/pages/CalendarAgentSessions.jsx';
import { newMenu } from '../src/pages/calendarItemModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));
const SCOPE = { kind: 'company', uid: 'cmp_1' };

const SESSION = {
  id: 7, state: 'waiting', proposals_waiting: 3, last_run_day: 'Monday', cadence: 'weekly', title: 'Draft the monthly investor update',
  agent: { name: 'Finch', role_name: 'Investor relations' },
  skill: { name: 'Draft the monthly investor update', version: 3 },
  target: { title: 'Investor update · October', href: '/raise/updates/4', kind_words: 'Update' },
  instruction: 'Lead with the pilot results.',
  schedule: { cadence: 'weekly', weekday: 'Monday', time: '08:00', zone: 'Europe/Lisbon' },
  sponsor: { name: 'Avery Stone' },
  scope: SCOPE,
  last_runs: [
    { id: 1, date: 'Mon 9 Nov', state: 'done', proposals: 3, cost_cents: 38 },
    { id: 2, date: 'Mon 2 Nov', state: 'skipped', proposals: 0 },
  ],
  can: { run_now: true, reschedule: true, pause: true, cancel: true },
  run_hold_cents: 45,
};

test('the seam: every #3957 method is off, in Team’s words, and no client path exists for a route that is not on main', async () => {
  const names = Object.keys(seam).filter((k) => typeof seam[k] === 'function' && !['through'].includes(k));
  assert.deepEqual(names.sort(), ['agentSkills', 'cancel', 'estimate', 'pause', 'reschedule', 'runNow', 'schedulable', 'schedule', 'session']);
  for (const n of names) assert.deepEqual(await seam[n](1, {}), { available: false, reason: 'AI agents aren’t switched on yet.' }, n);
  const src = codeOnly(read('frontend/src/pages/calendarAgentsAdapter.js'));
  assert.doesNotMatch(src, /lib\/api|fetch\(|request\(/, 'no client call until #3957 adds its routes');
  const client = [read('frontend/src/lib/api.js'), ...readdirSync('frontend/src/lib/api').filter((f) => f.endsWith('.js')).map((f) => read(`frontend/src/lib/api/${f}`))].join('\n');
  assert.doesNotMatch(client, /\/duties\b/, 'a client path for agent duties before #3957 puts the route on main');
});

test('the kind and the family stay out of KINDS and FAMILIES until #3957 adds the kind to the calendar read', () => {
  assert.equal(AGENT_KIND, 'agent_session');
  assert.deepEqual(AGENT_FAMILY, { key: 'agents', label: 'AI agents' });
  assert.doesNotMatch(read('frontend/src/pages/CalendarPage.jsx'), /id: 'agent_session'/);
  assert.doesNotMatch(read('frontend/src/pages/calendarViews.js'), /agent_session/);
});

test('state chips: words for every state, a count only when the read counted one, never colour alone', () => {
  assert.equal(stateChip({ state: 'scheduled' }).words, 'Scheduled');
  assert.deepEqual(stateChip({ state: 'running' }), { key: 'running', words: 'Running', pulse: true });
  assert.equal(stateChip({ state: 'waiting', proposals_waiting: 3 }).words, '3 proposals waiting');
  assert.equal(stateChip({ state: 'waiting', proposals_waiting: 1 }).words, '1 proposal waiting');
  assert.equal(stateChip({ state: 'waiting' }).words, 'Proposals waiting', 'an unread count is not a number');
  assert.equal(stateChip({ state: 'waiting', proposals_waiting: 0 }).words, 'Proposals waiting', 'never "0 proposals waiting"');
  assert.equal(stateChip({ state: 'skipped' }).words, 'Skipped');
  assert.equal(stateChip({ state: 'done' }).words, 'Done');
  assert.equal(stateChip({}).words, NOT_RECORDED);
  const chip = html(h(StateChip, { session: { state: 'waiting', proposals_waiting: 3 } }));
  assert.match(chip, /data-state="waiting"/);
  assert.match(renderedText(chip), /3 proposals waiting/);
});

test('CAL11: each skip reason says why, that nothing was charged, and where to fix it', () => {
  const paused = skipReason({ ...SESSION, state: 'skipped', agent: { name: 'Quill' }, skip: { reason: 'agent_paused', by: 'Avery Stone' } });
  assert.equal(paused.title, 'Agent paused');
  assert.equal(paused.line, 'Quill is paused by Avery Stone, so its sessions are skipped and not charged. The schedule stays.');
  assert.deepEqual(paused.actions, [{ label: 'Resume the agent in Team › Agents ›', to: '/account/companies/cmp_1/settings/team?tab=people' }]);

  const out = skipReason({ ...SESSION, state: 'skipped', skip: { reason: 'out_of_tokens', hold_cents: 45 } });
  assert.equal(out.line, 'Skipped. Avery Stone’s AI tokens cannot cover the hold of $0.45. Nothing was charged. The next session runs if the balance allows.');
  assert.deepEqual(out.actions.map((a) => [a.label, a.to]), [['Add tokens', '/pricing?for=models#add-tokens'], ['Open Usage ›', '/account/usage/ai-tokens']]);

  const tool = skipReason({ ...SESSION, state: 'skipped', skip: { reason: 'tool_disconnected', tool: 'Finance MCP · get_balance', connector: 'Finance MCP', ended_on: '8 Nov' } });
  assert.equal(tool.line, 'Skipped. This skill reads Finance MCP · get_balance, and the connection ended on 8 Nov. Nothing ran and nothing was charged.');
  assert.equal(tool.actions[0].label, 'Reconnect Finance MCP in Connectors ›');

  const retired = skipReason({ ...SESSION, state: 'skipped', skill: { name: 'Draft the monthly investor update', version: 2 }, skip: { reason: 'skill_retired', retired_on: '10 Nov', replacement_version: 3 } });
  assert.match(retired.line, /^Skipped\. Axal retired Draft the monthly investor update v2 on 10 Nov\. Pick its replacement, or another of Finch’s skills, to resume the schedule\.$/);
  assert.deepEqual(retired.actions.map((a) => a.label), ['Pick a skill', 'Update to v3 ›']);

  assert.match(skipReason({ state: 'skipped' }).line, /reason was not recorded/);
  assert.equal(skipReason({ state: 'done' }), null);
  for (const r of [paused, out, tool]) assert.match(r.line, /not charged|Nothing was charged|nothing was charged/);
});

test('the words: schedule, estimate, cap, hold, sponsor and runs, with Not recorded for any missing number', () => {
  assert.equal(repeatLine({ cadence: 'weekly', weekday: 'Monday', time: '08:00', zone: 'Europe/Lisbon' }), 'Weekly on Monday · 08:00 Lisbon time');
  assert.equal(repeatLine({ cadence: 'daily', time: '09:30' }), 'Daily · 09:30');
  assert.equal(repeatLine({ cadence: 'monthly', day_of_month: 1, time: '08:00' }), 'Monthly on day 1 · 08:00');
  assert.match(repeatLine({ cadence: 'once', run_at: '2026-11-12T08:00:00Z', zone: 'Europe/Lisbon' }), /^Once · Thu 12 Nov 2026, 08:00 Lisbon time$/);
  assert.equal(repeatLine({ cadence: 'once' }), NOT_RECORDED);
  assert.equal(repeatLine(null), NOT_RECORDED);

  assert.equal(estimateLine({ per_session_cents: 40, month_cents: 160 }), 'About $0.40 per session · $1.60 this month');
  assert.equal(estimateLine({ per_session_cents: 40 }), 'About $0.40 per session');
  assert.equal(estimateLine({}), NOT_RECORDED);
  assert.equal(estimateLine(null), NOT_RECORDED);
  assert.equal(capLine({ cap_used_cents: 320, cap_cents: 2000 }), '$3.20 of $20.00 used this month');
  assert.equal(capLine({ cap_cents: 2000 }), null);
  assert.equal(money(1.5), null, 'cents are integers');
  assert.equal(runNowLine(45), 'Run now holds up to $0.45 · you pay what it uses');
  assert.match(runNowLine(null), /shows its hold before it starts/);
  assert.equal(sponsorLine({ name: 'Avery Stone' }), 'Avery Stone · runs are paid from their AI tokens');
  assert.equal(sponsorLine({ email: 'a@example.test' }), NOT_RECORDED, 'people by name, never by email');

  assert.deepEqual(runRow({ date: 'Mon 9 Nov', state: 'done', proposals: 3, cost_cents: 38 }).cost, '$0.38');
  assert.equal(runRow({ state: 'skipped' }).cost, 'Not charged');
  assert.equal(runRow({ state: 'done' }).cost, NOT_RECORDED);
  assert.equal(runRow({ state: 'done', proposals: 0 }).note, 'No proposals');
  assert.equal(runRow({ state: 'done' }).note, null);

  assert.deepEqual(waitingBanner(SESSION), { line: '3 proposals from Monday’s run are waiting.', action: 'Review 3 proposals ›' });
  assert.equal(waitingBanner({ proposals_waiting: 0 }), null);
  assert.equal(offLine('Northwind Labs'), 'AI agents aren’t switched on for Northwind Labs. An editor turns them on in Team › Agents. No session can be scheduled until then.');
  assert.equal(readOnlyLine('Northwind Labs'), 'Only Northwind Labs’s editors schedule agents.');
  assert.equal(teamPath({ kind: 'project', id: 9 }), '/projects/9/settings/team');
  assert.equal(teamPath({ kind: 'company_project', uid: 'c', id: 2 }), '/account/companies/c/settings/projects/2/team');
  assert.equal(teamPath(null), null);
  assert.match(PROPOSALS_LINE, /Nothing is applied until someone accepts it\./);
  assert.match(HOLD_LINE, /monthly cap/);
});

test('CAL8 Save: the body #3957 takes, or the first problem in words', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(sessionBody({}, now).problem, 'Pick an agent.');
  assert.equal(sessionBody({ agent_uid: 'a' }, now).problem, 'Pick a skill.');
  assert.match(sessionBody({ agent_uid: 'a', skill_id: 's', cadence: 'once', instruction: 'x'.repeat(INSTRUCTION_MAX + 1) }, now).problem, /under 1,000 characters/);
  assert.equal(sessionBody({ agent_uid: 'a', skill_id: 's', cadence: 'once', run_at: '2026-10-31T08:00' }, now).problem, 'Choose a time in the future.');
  assert.equal(sessionBody({ agent_uid: 'a', skill_id: 's', cadence: 'weekly', time: '08:00' }, now).problem, 'Choose a day.');
  assert.equal(sessionBody({ agent_uid: 'a', skill_id: 's', cadence: 'monthly', time: '08:00', day_of_month: 31 }, now).problem, 'Choose a day from 1 to 28.');
  assert.equal(sessionBody({ agent_uid: 'a', skill_id: 's', cadence: 'hourly' }, now).problem, 'Choose once or a repeat.');
  const once = sessionBody({ agent_uid: 'a', skill_id: 's', skill_version: 3, cadence: 'once', run_at: '2026-11-12T08:00:00Z', instruction: '  Brief me.  ', target: { kind: 'meeting', id: 12, title: 'Acme' }, zone: 'Europe/Lisbon' }, now);
  assert.deepEqual(once.body, { skill_id: 's', skill_version: 3, cadence: 'once', zone: 'Europe/Lisbon', target_kind: 'meeting', target_id: '12', instruction: 'Brief me.', run_at: '2026-11-12T08:00:00.000Z' });
  const weekly = sessionBody({ agent_uid: 'a', skill_id: 's', cadence: 'weekly', weekday: 'Monday', time: '08:00' }, now);
  assert.deepEqual(weekly.body, { skill_id: 's', cadence: 'weekly', zone: null, time: '08:00', weekday: 'Monday' });
  assert.equal('agent_uid' in weekly.body, false, 'the agent is in the path, not the body');

  assert.equal(sessionRefusal({ code: 'skill_not_in_role' }), 'That skill is not one of this agent’s role skills.');
  assert.equal(sessionRefusal({ data: { code: 'over_cap' } }), 'This would go over the agent’s monthly cap. Lower the repeat or raise the cap in Team › Agents.');
  assert.equal(sessionRefusal({ message: 'Failed to fetch' }), 'That did not save. Nothing was scheduled.');
});

test('CAL8 picker: company first, then each project; a paused agent is drawn and cannot be picked', () => {
  const agents = [
    { uid: 'p1', name: 'Scout', role_name: 'Recruiting', company_name: 'Northwind Labs', project_name: 'Atlas Pilot', model: 'Model B', skills: 2 },
    { uid: 'c1', name: 'Finch', role_name: 'Investor relations', company_name: 'Northwind Labs', model: 'Model A', tools: 2, skills: 4 },
    { uid: 'c2', name: 'Quill', role_name: 'General counsel (assistant)', company_name: 'Northwind Labs', status: 'paused', model: 'Model C', skills: 1 },
  ];
  const g = agentGroups(agents);
  assert.deepEqual(g.map((x) => x.label), ['Northwind Labs', 'Northwind Labs › Atlas Pilot']);
  assert.deepEqual(g[0].agents.map((a) => [a.uid, a.pickable]), [['c1', true], ['c2', false]]);
  assert.equal(agentMeta(agents[1]), 'Platform model · Model A + 2 read tools · 4 skills');
  assert.equal(agentMeta({}), NOT_RECORDED);
  assert.equal(skillHint([1, 2, 3, 4], 'Investor relations'), '4 skills for Investor relations');
  assert.equal(skillHint(null), null);
  const out = html(h(AgentPicker, { agents, picked: 'c1', onPick: () => {} }));
  assert.match(out, /data-testid="cal-agent-c2"[^>]*disabled=""|disabled=""[^>]*data-testid="cal-agent-c2"/);
  assert.match(renderedText(out), /Paused/);
  assert.match(text(h(AgentPicker, { agents: [], onPick: () => {} })), /No agents on your teams yet/);
});

test('CAL10: the session sheet draws the canvas’s rows, the waiting banner and the actions the read allows', () => {
  const body = text(h(AgentSessionView, { session: SESSION }));
  for (const s of ['3 proposals from Monday’s run are waiting.', 'Review 3 proposals ›', 'Draft the monthly investor update · v3', 'Investor update · October ›', 'Lead with the pilot results.', 'Weekly on Monday · 08:00 Lisbon time', 'Avery Stone · runs are paid from their AI tokens', 'Mon 9 Nov', '$0.38', 'Not charged']) {
    assert.ok(body.includes(s), `missing: ${s}`);
  }
  assert.match(html(h(AgentSessionView, { session: SESSION })), /href="\/account\/companies\/cmp_1\/settings\/team\?tab=approvals"/);
  const foot = text(h(AgentSessionFooter, { session: SESSION, onAct: () => {} }));
  assert.match(foot, /Run now.*Reschedule.*Pause this schedule.*Cancel/s);
  assert.match(foot, /Run now holds up to \$0\.45 · you pay what it uses/);
  assert.deepEqual(sessionActions({ ...SESSION, state: 'cancelled' }), []);
  assert.deepEqual(sessionActions({ ...SESSION, cadence: 'once', can: { pause: true } }).map((a) => a.label), ['Pause']);
});

test('CAL11: a read-only member sees the session and no actions, and is told why', () => {
  const ro = { ...SESSION, can: {}, can_manage: false, company: 'Northwind Labs' };
  const foot = text(h(AgentSessionFooter, { session: ro, onAct: () => {} }));
  assert.equal(foot, 'Only Northwind Labs’s editors schedule agents.');
  assert.doesNotMatch(foot, /Run now|Reschedule|Cancel/);
  const first = text(h(AgentSessionView, { session: { ...ro, last_runs: [], schedule: { cadence: 'once', run_at: '2026-11-12T08:00:00Z' } } }));
  assert.match(first, /Not run yet\./);
});

test('the New menu: Schedule an AI agent, last, for every role', () => {
  for (const role of ['investor', 'founder', 'advisor', 'admin']) {
    assert.deepEqual(newMenu(role).at(-1), { key: 'agent', label: 'Schedule an AI agent', sub: 'Its work waits in Approvals' }, role);
  }
});

test('the page: the session route opens its own sheet; the grids draw the agent mark and the state; Ask sits beside New', () => {
  const page = codeOnly(read('frontend/src/pages/CalendarPage.jsx'));
  assert.match(page, /opened\?\.kind === AGENT_KIND && <AgentSessionSheet/);
  assert.match(page, /opened && opened\.kind !== AGENT_KIND && \(/, 'the item drawer never reads a session (its route would answer not found)');
  assert.match(page, /k === 'agent' \? setShowAgent\(true\)/);
  assert.match(page, /<AskButton \/>/);
  const grids = codeOnly(read('frontend/src/pages/CalendarGrids.jsx'));
  assert.match(grids, /ev\.kind === AGENT_KIND \? <AgentMark \/>/);
  assert.match(grids, /stateChip\(ev\)\.words/);
});

test('the rail names modules, never tables', () => {
  const page = codeOnly(read('frontend/src/pages/CalendarPage.jsx'));
  const block = page.match(/const KINDS = \[([\s\S]*?)\n\];/)?.[1] || '';
  const froms = [...block.matchAll(/from: '([^']+)'/g)].map((m) => m[1]);
  // D1484 (#3977) added interview calls, cohort dates, deal closings and "Your event".
  assert.equal(froms.length, 14);
  for (const f of froms) assert.doesNotMatch(f, /_|^[a-z]+s$/, `${f} reads like a table`);
  assert.doesNotMatch(block, /src: '/);
});

test('the canvases: the addendum is in design/incoming, with the named logo edit', () => {
  const pageCanvas = read('design/incoming/Calendar Page.dc.html');
  const boards = read('design/incoming/Calendar · Boards.dc.html');
  for (const b of ['AG8', 'AG9', 'AG10', 'AG11', 'CAL1b']) assert.ok(pageCanvas.includes(`&quot;${b}&quot;`), `board ${b}`);
  assert.ok(pageCanvas.includes('Schedule an AI agent'));
  assert.ok(pageCanvas.includes('Its work comes back as proposals in Approvals. Nothing is applied until someone accepts it.'));
  assert.ok(!pageCanvas.includes('uploads/axal-logo-200x200.png'));
  assert.ok(boards.includes('Calendar Page'));
  assert.ok(read('documentation/architecture/decisions/D1613.md').includes('#3957'));
});

test('copy rules: Ask never Fill on the new surfaces; no email shown; nothing claims to apply', () => {
  for (const f of ['frontend/src/pages/CalendarAgentSessions.jsx', 'frontend/src/pages/calendarAgentModel.js']) {
    const src = codeOnly(read(f));
    assert.doesNotMatch(src, /\bFill\b/, f);
    assert.doesNotMatch(src, /\.email\b/, f);
    assert.doesNotMatch(src, /applies automatically|auto-?appl/i, f);
  }
});
