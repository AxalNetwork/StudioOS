/**
 * D1614 CO2–CO5 (#3976) — the page's side of a company's compliance tasks.
 *
 *   1. The client sends each request to its Worker route, with only the body
 *      its route reads.
 *   2. The seam's compliance methods go through that client; "Create work"
 *      answers the Work off block while the engine is off.
 *   3. The list: filters narrow it, Done is its own view, the Month view
 *      places a task on its day and never one without a date, and the
 *      Compliance card shows the next five or "Not recorded".
 *   4. A refusal is the Worker's sentence, never a code; the timeline names an
 *      agent's cost, or says it was not recorded.
 *   5. Readers see no checkbox, no Mark done and no New; a standalone project
 *      has no Compliance in the sidebar; the Legal tab and the Calendar sheet
 *      wire the card and the company routes.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_compliance_d1614.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mutate, sourceModule } from './_record_d696.mjs';
import {
  NO_TASKS_RECORDED, agenda, complianceCan, filterOptions, filterTasks, firstMonth, monthGrid, nextTasks, refusalLine, taskFlags, timelineLine,
} from '../src/pages/work/workModel.js';
import { Agenda } from '../src/pages/work/CompliancePage.jsx';
import { scopeFor } from '../src/lib/settingsScope.js';

const read = (p) => readFileSync(p, 'utf8');
const CLIENT = read('frontend/src/lib/api/companyCompliance.js');
const NOW = new Date('2026-11-12T12:00:00Z');
const TASKS = [
  { uid: 'a', title: 'Registered agent', due: '2026-10-15', type: 'Renewal', jurisdiction: 'Delaware', owner: { kind: 'person', uid: 'u1', name: 'Ada' }, status: 'due' },
  { uid: 'b', title: '83(b) election', due: '2026-11-20', type: 'Filing', jurisdiction: 'US', owner: { kind: 'agent', uid: 'g1', name: 'Lex' }, status: 'due', review_state: 'ready_for_review' },
  { uid: 'c', title: 'Q4 tax', due: '2026-12-15', type: 'Payment', status: 'due', needs_reassignment: true, owner: { kind: 'person', uid: 'u2', name: 'Mo' } },
  { uid: 'd', title: 'Filed in spring', due: '2026-03-01', type: 'Filing', status: 'done', done_at: '2026-03-01T10:00:00Z' },
  { uid: 'e', title: 'No date yet', type: 'Report', status: 'due' },
  { uid: 'f', title: 'Franchise tax', due: '2027-03-01', type: 'Payment', status: 'due' },
  { uid: 'g', title: 'Board consent', due: '2027-04-01', type: 'Signature', status: 'due' },
];

test('1: each client method calls its route with only the body that route reads', async () => {
  const sent = [];
  const mod = await sourceModule(mutate(CLIENT, "import { request } from '../api.js';",
    'const request = (...a) => { globalThis.__ccSent.push(a); return Promise.resolve({ ok: true }); };'), 'lib/api/companyCompliance.js');
  globalThis.__ccSent = sent;
  try {
    const api = mod.companyComplianceApi;
    await api.list('co a', { status: 'done', owner: 'u1', jurisdiction: '', type: undefined });
    await api.list('co-a');
    await api.task('co-a', 't/1');
    await api.assignable('co-a');
    await api.create('co-a', { title: 'X', due: '2027-01-01' });
    await api.update('co-a', 't1', { title: 'Y' });
    await api.assign('co-a', 't1', null);
    await api.assign('co-a', 't1', { kind: 'person', uid: 'u1' });
    await api.comment('co-a', 't1', 'Hello');
    await api.ready('co-a', 't1');
    await api.markDone('co-a', 't1');
    await api.markDone('co-a', 't1', 'Filed.');
    await api.reopen('co-a', 't1');
    await api.createWork('co-a', 't1', { projectId: 10 });
    await api.createWork('co-a', 't1', { projectId: 10, title: 'Prepare the filing' });
  } finally { delete globalThis.__ccSent; }
  const body = (x) => (x?.body === undefined ? undefined : JSON.parse(x.body));
  assert.deepEqual(sent.map(([path, init]) => [path, init?.method ?? 'GET', body(init)]), [
    ['/company/co%20a/compliance?status=done&owner=u1', 'GET', undefined],
    ['/company/co-a/compliance', 'GET', undefined],
    ['/company/co-a/compliance/t%2F1', 'GET', undefined],
    ['/company/co-a/compliance/assignable', 'GET', undefined],
    ['/company/co-a/compliance', 'POST', { title: 'X', due: '2027-01-01' }],
    ['/company/co-a/compliance/t1', 'PATCH', { title: 'Y' }],
    ['/company/co-a/compliance/t1/assignee', 'PUT', { assignee: null }],
    ['/company/co-a/compliance/t1/assignee', 'PUT', { assignee: { kind: 'person', uid: 'u1' } }],
    ['/company/co-a/compliance/t1/comments', 'POST', { body: 'Hello' }],
    ['/company/co-a/compliance/t1/ready', 'POST', {}],
    ['/company/co-a/compliance/t1/done', 'POST', {}],
    ['/company/co-a/compliance/t1/done', 'POST', { note: 'Filed.' }],
    ['/company/co-a/compliance/t1/reopen', 'POST', {}],
    ['/company/co-a/compliance/t1/work', 'POST', { project_id: 10 }],
    ['/company/co-a/compliance/t1/work', 'POST', { project_id: 10, title: 'Prepare the filing' }],
  ]);
  // One line in the generated module list (D527, #4105), in its alphabetical place.
  assert.match(read('frontend/src/lib/apiModules.generated.js'), /export \* from '\.\/api\/companyActions\.js';\nexport \* from '\.\/api\/companyCompliance\.js';\nexport \* from '\.\/api\/companyDocuments\.js';/);
});

test('2: the seam goes through the client; Create work answers the Work off block while the engine is off', async () => {
  const src = read('frontend/src/pages/work/workAdapter.js');
  for (const [m, call, reason] of [
    ['complianceTasks: (uid, filter)', 'cc.list(uid, filter)', 'COMPLIANCE_OFF'], ['complianceTask: (uid, taskUid)', 'cc.task(uid, taskUid)', 'COMPLIANCE_OFF'],
    ['markDone: (uid, taskUid, note)', 'cc.markDone(uid, taskUid, note)', 'COMPLIANCE_OFF'], ['createWork: (uid, taskUid, opts)', 'cc.createWork(uid, taskUid, opts)', 'WORK_OFF'],
  ]) assert.ok(src.includes(`${m} => through(() => ${call}, ${reason})`), m);
  const { through, WORK_OFF } = await import('../src/pages/work/workAdapter.js');
  const off = Object.assign(new Error('x'), { status: 404, data: { error: 'agent_engine_off' } });
  assert.deepEqual(await through(async () => { throw off; }, WORK_OFF), { available: false, reason: WORK_OFF });
  const refused = Object.assign(new Error('x'), { status: 403, data: { error: 'not_company_admin', message: 'Only a company admin changes compliance tasks.' } });
  await assert.rejects(through(async () => { throw refused; }, WORK_OFF), (e) => e === refused, 'a refusal became the off block');
});

test('3: filters, Done, the Month view and the card read the list and invent nothing', () => {
  const ids = (xs) => xs.map((t) => t.uid);
  assert.deepEqual(ids(filterTasks(TASKS)), ['a', 'b', 'c', 'e', 'f', 'g'], 'open is the default');
  assert.deepEqual(ids(filterTasks(TASKS, { status: 'done' })), ['d']);
  assert.equal(filterTasks(TASKS, { status: 'all' }).length, 7);
  assert.deepEqual(ids(filterTasks(TASKS, { jurisdiction: 'Delaware' })), ['a']);
  assert.deepEqual(ids(filterTasks(TASKS, { owner: 'none' })), ['e', 'f', 'g']);
  assert.deepEqual(ids(filterTasks(TASKS, { owner: 'g1' })), ['b']);
  assert.deepEqual(ids(filterTasks(TASKS, { type: 'Payment' })), ['c', 'f']);
  const o = filterOptions(TASKS);
  assert.deepEqual(o.jurisdiction, ['Delaware', 'US']);
  assert.deepEqual(o.owner, [['none', 'No owner'], ['u1', 'Ada'], ['g1', 'Lex'], ['u2', 'Mo']]);
  assert.deepEqual(o.type, ['Filing', 'Payment', 'Renewal', 'Report', 'Signature']);
  assert.deepEqual(filterOptions(null).jurisdiction, []);
  const grid = monthGrid(TASKS, '2026-11');
  assert.equal(grid.label, 'November 2026');
  assert.equal(grid.weeks[0][6].day, 1, '1 November 2026 is a Sunday, the last of its Monday week');
  assert.deepEqual(grid.weeks.flat().filter((c) => c?.tasks.length).map((c) => [c.day, ids(c.tasks)]), [[20, ['b']]]);
  assert.ok(grid.weeks.every((w) => w.length === 7));
  assert.equal(monthGrid(TASKS, 'nope'), null);
  assert.equal(firstMonth(TASKS), '2026-10');
  assert.equal(firstMonth([], NOW), '2026-11');
  assert.deepEqual(ids(nextTasks(TASKS)), ['a', 'b', 'c', 'f', 'g'], 'overdue first, a task without a date never, at most five');
  assert.deepEqual(nextTasks([{ uid: 'z', title: 'Done', due: '2026-01-01', status: 'done' }]), []);
  const seven = Array.from({ length: 7 }, (_, i) => ({ uid: `n${i}`, title: `T${i}`, due: `2027-0${7 - i}-01`, status: 'due' }));
  assert.deepEqual(ids(nextTasks(seven)), ['n6', 'n5', 'n4', 'n3', 'n2'], 'more than five, or out of date order');
  assert.match(NO_TASKS_RECORDED, /^Not recorded/);
  assert.deepEqual(agenda(filterTasks(TASKS), NOW).overdue.map((t) => t.uid), ['a']);
});

test('4: a refusal is the Worker\'s sentence; flags and the timeline are words; an agent\'s cost is shown or said missing', () => {
  assert.equal(refusalLine({ data: { error: 'agent_cannot_close', message: 'An agent prepares a compliance task; only a company admin marks it done.' } }),
    'An agent prepares a compliance task; only a company admin marks it done.');
  assert.equal(refusalLine({ data: { error: 'read_only_admin' } }), 'That could not be saved. Try again.', 'a bare code is shown');
  assert.equal(refusalLine(new Error('SQLITE_CONSTRAINT')), 'That could not be saved. Try again.');
  assert.deepEqual(taskFlags(TASKS[1]), ['Ready for review']);
  assert.deepEqual(taskFlags(TASKS[2]), ['Needs a new owner']);
  assert.equal(timelineLine({ kind: 'comment', actor: { kind: 'agent', name: 'Lex' }, cost_microusd: 4200 }), 'Lex commented · $0.004');
  assert.equal(timelineLine({ kind: 'ready_for_review', actor: { kind: 'agent', name: 'Lex' }, cost_microusd: null }), 'Lex marked it ready for review · cost not recorded');
  assert.equal(timelineLine({ kind: 'done', actor: { kind: 'person', name: 'Ada' } }), 'Ada marked it done');
  assert.equal(timelineLine({ kind: 'needs_reassignment', actor: { kind: 'system' } }), 'Axal flagged it for a new owner: the owner’s seat ended');
});

test('5: readers see no checkbox, Mark done or New; a standalone project has no Compliance; the page, card and Calendar are wired', () => {
  const page = (can) => renderToStaticMarkup(h(MemoryRouter, null, h(Agenda, { ag: agenda(filterTasks(TASKS), NOW), can: complianceCan({ can_manage: can }) })));
  assert.match(page(true), /type="checkbox"/);
  assert.match(page(true), /Mark done/);
  assert.match(page(true), /Ready for review/);
  assert.match(page(true), /Needs a new owner/);
  assert.doesNotMatch(page(false), /type="checkbox"|Mark done/);
  const src = read('frontend/src/pages/work/CompliancePage.jsx');
  assert.match(src, /\{state\.status === 'off' \|\| can\.create \? \(/, 'New is drawn for a reader');
  assert.match(src, /testId="compliance-read-only"/);
  // The sidebar: a company's block names Compliance; a standalone project has none.
  const co = scopeFor({ company: { uid: 'co-a', name: 'Acme' } });
  assert.ok(JSON.stringify(co).includes('/account/companies/co-a/settings/compliance'));
  const solo = scopeFor({ project: { id: 1, name: 'Solo', company_id: null } });
  assert.ok(!JSON.stringify(solo).includes('Compliance'), 'a standalone project shows Compliance');
  const tabs = read('frontend/src/pages/account/companies/CompanySettingsTabs.jsx');
  assert.match(tabs, /\{tab === 'legal' \? <><LegalTab uid=\{uid\} name=\{name\} \/><ComplianceCard uid=\{uid\} \/><\/> : null\}/);
  const sheet = read('frontend/src/pages/CalendarComplianceSheet.jsx');
  assert.match(sheet, /if \(co && change === 'done'\) await companyComplianceApi\.markDone\(co\.uid, item\.source_uid\);/);
  assert.match(sheet, /c\.company_task\n\s+\? <Link className=\{actionGhost\} to=\{companyCompliancePath\(c\.company\.uid\)\}/, 'a company task can be deleted from the Calendar');
  assert.match(sheet, /data-testid="cal-compliance-company"/);
});
