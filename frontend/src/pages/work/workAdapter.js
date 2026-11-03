/**
 * D1614 (#3968) — Work's and company compliance's one seam to the Worker.
 *
 * A method is OFF until its route is on `main`: it answers
 * `{ available: false, reason }` without a request, so a page draws the honest
 * "not switched on yet" block and never invents a board, a chart or a task.
 * `burnup` is on (#3970), and so are W1's board, item, move, assign and create
 * (#3969, wired by #3973): each goes through `workApi`, and an engine that is
 * off answers the same honest block. The compliance methods are on (#3976),
 * through `companyComplianceApi`; only "Create work" depends on the engine (it
 * lands on W1's board), and answers the off block while the engine is off.
 * The builder of each Worker part adds the client method with its route, in a
 * module under `frontend/src/lib/api/` (D527), and replaces only that method's
 * body here with `through(…)`.
 *
 *   board, item, move, assign, create  W1  #3969  scope_tasks: columns, estimate, order, labels
 *   burnup                             W2  #3970  the burn-up series
 *   run, retry, feed                   W3  #3971  run detail and the project activity feed
 *   workload, schedule                 W4  #3972  people's and agents' items on the Calendar, a time block
 *   agentSessions                      #3957 (S06)  scheduled agent sessions (CAL10); off until it merges
 *   D1614 W6 (#3974) turned on run, retry, feed, workload and schedule.
 *   complianceTasks, complianceTask,
 *   markDone, createWork               #3976 (S15)  the company compliance list
 *   complianceCreate, complianceUpdate,
 *   complianceAssignable, complianceAssign,
 *   complianceComment, complianceReady,
 *   complianceReopen                   #3976        its task sheet's other changes
 */
import { workApi } from '../../lib/api/work.js';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { companyComplianceApi as cc } from '../../lib/api/companyCompliance.js';

export const WORK_OFF = 'Work is not switched on yet. Its board, backlog and burn-up arrive with the Worker part (#3969).';
export const COMPLIANCE_OFF = 'Compliance tasks are not switched on yet. They arrive with the company compliance list (#3976).';

const off = (reason) => async () => ({ available: false, reason });

/** A live method: `{ available: true, data }`, or the off block when the engine is off. */
export async function through(call, reason) {
  try {
    return { available: true, data: await call() };
  } catch (e) {
    const status = e?.status ?? e?.response?.status ?? null;
    const code = e?.code || e?.data?.code || e?.data?.error || null;
    if (status === 404 && code === 'agent_engine_off') return { available: false, reason };
    throw e;
  }
}

export const workAdapter = {
  board: (projectId, opts) => through(() => workApi.board(projectId, opts), WORK_OFF),
  item: (uid) => through(async () => (await workApi.item(uid))?.task ?? null, WORK_OFF),
  move: (uid, column, position) => through(async () => (await workApi.move(uid, { column, position }))?.task ?? null, WORK_OFF),
  assign: (uid, assignee) => through(async () => (await workApi.assign(uid, assignee))?.task ?? null, WORK_OFF),
  create: (projectId, body) => through(async () => (await workApi.create(projectId, body))?.task ?? null, WORK_OFF),
  burnup: (projectId, opts) => through(() => workApi.burnup(projectId, opts), WORK_OFF),
  // D1614 W6 (#3974): W3's run, retry and feed (#4183) and W4's workload and time block (#4195).
  run: (uid) => through(() => agentEngineApi.run(uid), WORK_OFF),
  retry: (uid) => through(async () => (await agentEngineApi.retryRun(uid))?.run ?? null, WORK_OFF),
  feed: (projectId, opts) => through(() => agentEngineApi.projectActivity(projectId, opts), WORK_OFF),
  workload: (projectId, opts) => through(() => workApi.workload(projectId, opts), WORK_OFF),
  schedule: (uid, block) => through(async () => (await workApi.schedule(uid, block))?.task ?? null, WORK_OFF),
  // #3957 (S06): a Calendar agent session (CAL10) opens the run sheet, and agent sessions join Workload, when it merges.
  agentSessions: off('Scheduled agent sessions arrive with #3957.'),
  complianceTasks: (uid, filter) => through(() => cc.list(uid, filter), COMPLIANCE_OFF),
  complianceTask: (uid, taskUid) => through(() => cc.task(uid, taskUid), COMPLIANCE_OFF),
  markDone: (uid, taskUid, note) => through(() => cc.markDone(uid, taskUid, note), COMPLIANCE_OFF),
  createWork: (uid, taskUid, opts) => through(() => cc.createWork(uid, taskUid, opts), WORK_OFF),
  complianceCreate: (uid, body) => through(() => cc.create(uid, body), COMPLIANCE_OFF),
  complianceUpdate: (uid, taskUid, body) => through(() => cc.update(uid, taskUid, body), COMPLIANCE_OFF),
  complianceAssignable: (uid) => through(() => cc.assignable(uid), COMPLIANCE_OFF),
  complianceAssign: (uid, taskUid, assignee) => through(() => cc.assign(uid, taskUid, assignee), COMPLIANCE_OFF),
  complianceComment: (uid, taskUid, body) => through(() => cc.comment(uid, taskUid, body), COMPLIANCE_OFF),
  complianceReady: (uid, taskUid) => through(() => cc.ready(uid, taskUid), COMPLIANCE_OFF),
  complianceReopen: (uid, taskUid) => through(() => cc.reopen(uid, taskUid), COMPLIANCE_OFF),
};

/** Every method, with the issue that turns it on, for the decision file and its test. */
export const WORK_SEAM = Object.freeze({
  board: '#3969', item: '#3969', move: '#3969', assign: '#3969', create: '#3969',
  burnup: '#3970', run: '#3971', retry: '#3971', feed: '#3971', workload: '#3972', schedule: '#3972', agentSessions: '#3957',
  complianceTasks: '#3976', complianceTask: '#3976', markDone: '#3976', createWork: '#3976',
  complianceCreate: '#3976', complianceUpdate: '#3976', complianceAssignable: '#3976', complianceAssign: '#3976',
  complianceComment: '#3976', complianceReady: '#3976', complianceReopen: '#3976',
});
