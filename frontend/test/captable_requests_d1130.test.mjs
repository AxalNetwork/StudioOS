// D1130 (#3010): Ask for access is stored, and the founder answers it.
//   * the client reaches the Worker's three new routes;
//   * the Access tab lists the pending asks and answers each in a dialog;
//   * the CT22b refusal page carries the same ask as CT15n, and a person the
//     Worker says cannot ask is told why rather than shown an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASK_LEVELS, REQUESTS_NONE, requestRows } from '../src/pages/raise/captable/capTableAccess.js';
import { ASK_NOT_YOURS, askOutcome } from '../src/pages/raise/captable/investorPanelModel.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');

test('request rows: who, role and the asked level; never an email; a missing name says Not recorded', () => {
  const rows = requestRows({ requests: [
    { uid: 'q1', name: 'Harbor Seed Fund', role: 'investor', requested_level: 'summary', note: ' Q4 review ', asked_at: '2026-11-03 17:40:00', email: 'x@example.invalid' },
    { uid: 'q2', name: '', role: null, requested_level: 'everything', note: null, asked_at: null, email: 'nameless@example.invalid' },
  ] });
  assert.deepEqual(rows.map((r) => [r.uid, r.who, r.role, r.level, r.levelLabel, r.note]), [
    ['q1', 'Harbor Seed Fund', 'Investor', 'summary', 'Summary', 'Q4 review'],
    ['q2', 'Not recorded', 'Not recorded', 'investor', 'Not recorded', null],
  ]);
  assert.ok(!JSON.stringify(rows).includes('@'), 'no email reaches the rows');
  assert.deepEqual(requestRows(null), []);
  assert.deepEqual(ASK_LEVELS, ['own_position', 'summary', 'investor', 'full'], 'None is not a level anyone asks for');
});

test('the client reaches the stored ask, the queue, approve and decline', () => {
  const api = read('lib/api/capTableAccess.js');
  assert.match(api, /requests: \(projectId\) => request\(`\$\{base\(projectId\)\}\/requests`\)/);
  assert.match(api, /approveRequest: \(projectId, uid, level\) => request\(`\$\{base\(projectId\)\}\/requests\/\$\{encodeURIComponent\(uid\)\}\/approve`, json\('POST', level \? \{ level \} : \{\}\)\)/);
  assert.match(api, /declineRequest: \(projectId, uid\) => request\(`\$\{base\(projectId\)\}\/requests\/\$\{encodeURIComponent\(uid\)\}\/decline`, json\('POST'\)\)/);
  const worker = readFileSync(fileURLToPath(new URL('../../cloudflare-worker/src/routes/captable_access.ts', import.meta.url)), 'utf8');
  for (const route of ["r.get('/:projectId/requests'", "r.post('/:projectId/requests/:uid/approve'", "r.post('/:projectId/requests/:uid/decline'"]) assert.ok(worker.includes(route), route);
});

test('Access lists the asks above Who sees what; the owner approves at a level or declines, each in a dialog', () => {
  const tab = read('pages/raise/captable/AccessTab.jsx');
  assert.ok(tab.indexOf('<AccessRequests ') > -1 && tab.indexOf('<AccessRequests ') < tab.indexOf('title="Who sees what"'), 'the queue comes first');
  assert.match(tab, /capTableAccessApi\.requests\(id\)/);
  assert.match(tab, /\{canChange \? \(\s*<span className="flex flex-wrap gap-2">\s*<button.*data-testid="captable-request-approve"/, 'only the owner answers');
  assert.match(tab, /capTableAccessApi\.approveRequest\(projectId, row\.uid, level\)/);
  assert.match(tab, /useState\(row\.level\)/, 'the asked level is preselected');
  assert.match(tab, /capTableAccessApi\.declineRequest\(projectId, dialog\.row\.uid\)/);
  assert.match(tab, /claim="This is not a claim that nobody asked\."/, 'an unreadable queue never reads as empty');
  assert.ok(tab.includes('{REQUESTS_NONE}'));
  assert.equal(REQUESTS_NONE, 'Nobody is waiting for an answer.');
  assert.ok(!/\balert\(|\bconfirm\(|window\.prompt/.test(tab), 'no browser pop-up');
});

test('CT22b: the other company\'s page asks for access; someone who cannot ask is told why', () => {
  const page = read('pages/raise/captable/CapTableOverview.jsx');
  assert.match(page, /<Link className=\{GHOST\} to=\{HOME_PATH\}>Switch company<\/Link>\s*<AskForAccess projectId=\{projectId\} testId="captable-other-company" \/>/);
  const panel = read('pages/raise/captable/InvestorCapTablePanel.jsx');
  assert.match(panel, /export function AskForAccess\(/);
  assert.match(panel, /<AskForAccess projectId=\{projectId\} venture=\{venture\} testId=\{testId\} \/>/, 'CT15n uses the same ask');
  for (const code of ['investors_only', 'not_a_venture']) {
    assert.deepEqual(askOutcome({ data: { code } }), { asked: false, line: ASK_NOT_YOURS, final: true }, code);
  }
  assert.equal(askOutcome({ data: { code: 'already_asked' } }).asked, true, 'D1027 unchanged');
  assert.equal(askOutcome({ message: 'Network down' }).final, undefined, 'any other refusal stays in the dialog');
});
