/**
 * D1614 (#3968) — Work's and company compliance's one seam to the Worker.
 *
 * Every method is OFF today: none of their routes is on `main`. Each answers
 * `{ available: false, reason }` without a request, so a page draws the honest
 * "not switched on yet" block and never invents a board, a chart or a task.
 * The builder of each Worker part adds the client method with its route, in a
 * module under `frontend/src/lib/api/` (D527), and replaces only that method's
 * body here with `through(…)`.
 *
 *   board, item, move, assign, create  W1  #3969  scope_tasks: columns, estimate, order, labels
 *   burnup                             W2  #3970  the burn-up series
 *   run, retry, feed                   W3  #3971  run detail and the project activity feed
 *   workload                           W4  #3972  people's and agents' items on the Calendar
 *   complianceTasks, complianceTask,
 *   markDone, createWork               #3976 (S15)  the company compliance list
 */
export const WORK_OFF = 'Work is not switched on yet. Its board, backlog and burn-up arrive with the Worker part (#3969).';
export const COMPLIANCE_OFF = 'Compliance tasks are not switched on yet. They arrive with the company compliance list (#3976).';

const off = (reason) => async () => ({ available: false, reason });

export const workAdapter = {
  board: off(WORK_OFF),
  item: off(WORK_OFF),
  move: off(WORK_OFF),
  assign: off(WORK_OFF),
  create: off(WORK_OFF),
  burnup: off('The burn-up arrives with #3970.'),
  run: off('Run detail arrives with #3971.'),
  retry: off('Run detail arrives with #3971.'),
  feed: off('The project activity feed arrives with #3971.'),
  workload: off('Workload on the Calendar arrives with #3972.'),
  complianceTasks: off(COMPLIANCE_OFF),
  complianceTask: off(COMPLIANCE_OFF),
  markDone: off(COMPLIANCE_OFF),
  createWork: off(COMPLIANCE_OFF),
};

/** Every method, with the issue that turns it on, for the decision file and its test. */
export const WORK_SEAM = Object.freeze({
  board: '#3969', item: '#3969', move: '#3969', assign: '#3969', create: '#3969',
  burnup: '#3970', run: '#3971', retry: '#3971', feed: '#3971', workload: '#3972',
  complianceTasks: '#3976', complianceTask: '#3976', markDone: '#3976', createWork: '#3976',
});
