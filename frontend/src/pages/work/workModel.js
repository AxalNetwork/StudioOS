import { NOT_RECORDED } from '../../lib/absence';

/**
 * D1614 (#3968, canvases WK and CO) — Work and company compliance, as plain
 * functions: the words, the columns, the cards, the burn-up's geometry and the
 * compliance agenda. The pages draw them; the tests read them without a DOM.
 *
 * THE OWNER'S RULES (#3968, 2026-11-01):
 *   · Only PROJECTS have Work: a board, a backlog, a burn-up, a feed and a
 *     workload. A company hosts projects and carries the legal and compliance
 *     duties; it has no board, and nothing rolls up into it.
 *   · Agents propose; a named person accepts. "In review" waits for that person.
 *   · "Not recorded" is never a 0, and a read that failed says so.
 */

export const WORK_PURPOSE = 'Everything the project’s people and AI agents are doing, in one place.';
export const WORK_TABS = Object.freeze([
  { key: 'board', label: 'Board' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'burnup', label: 'Burn-up' },
  { key: 'mine', label: 'My items' },
]);

/** WK1: the six columns, in order, with the line under each title. */
export const COLUMNS = Object.freeze([
  { key: 'triage', label: 'To triage', line: 'New items, waiting to be sorted', tone: 'grey' },
  { key: 'backlog', label: 'Backlog', line: 'Agreed, not scheduled yet', tone: 'sky' },
  { key: 'ready', label: 'Ready', line: 'This is ready to be picked up', tone: 'green' },
  { key: 'in_progress', label: 'In progress', line: 'A person or an agent is on it', tone: 'violet' },
  { key: 'in_review', label: 'In review', line: 'Waiting for a named person to accept', tone: 'amber' },
  { key: 'done', label: 'Done', line: 'Accepted and closed', tone: 'positive' },
]);
const COLUMN_KEYS = new Set(COLUMNS.map((c) => c.key));
export const columnLabel = (key) => COLUMNS.find((c) => c.key === key)?.label ?? null;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The board: each column with its cards and its estimate. A card in an unknown
 * column is not drawn in any column (never guessed into one). A column whose
 * cards carry no estimate at all reads "Not recorded", never 0.
 */
export function boardColumns(items) {
  const list = Array.isArray(items) ? items : [];
  return COLUMNS.map((c) => {
    const cards = list.filter((i) => i && i.column === c.key);
    const ests = cards.map((i) => num(i.estimate)).filter((e) => e != null);
    return { ...c, cards, count: cards.length, estimate: cards.length && !ests.length ? NOT_RECORDED : ests.reduce((a, b) => a + b, 0) };
  });
}

/** A card's assignee line: a person by name, an agent by name and role, or "Unassigned". */
export function assigneeLine(item) {
  const a = item?.assignee;
  if (!a || (!a.name && !a.agent_uid)) return { text: 'Unassigned', agent: false, role: null };
  if (a.kind === 'agent' || a.agent_uid) return { text: a.name || 'AI agent', agent: true, role: a.role || null };
  return { text: a.name || NOT_RECORDED, agent: false, role: null };
}

/** The last run's chip (WK1): its words, and the cost so far or charged. */
export function runChip(run) {
  if (!run || !run.status) return null;
  const words = { completed: 'Completed', failed: 'Failed', waiting: 'Waiting for you', running: 'Running' }[run.status];
  if (!words) return null;
  const c = num(run.charged_microusd);
  const cost = c == null ? null : `${money(c)}${run.status === 'running' ? ' so far' : ''}`;
  return { words, tone: run.status, cost };
}

/** A due date, and "soon" within three days. */
export function dueLine(due, now = new Date()) {
  if (!due) return null;
  const d = new Date(`${String(due).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const days = Math.round((d.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  return { text, soon: days >= 0 && days <= 3, overdue: days < 0 };
}

/** "Move to ▾": every column but the card's own. */
export function moveTargets(item) {
  return COLUMNS.filter((c) => c.key !== item?.column);
}

/** The amber "Needs you" strip: proposals waiting and failed runs, in words. */
export function needsYou(items) {
  const list = Array.isArray(items) ? items : [];
  const waiting = list.filter((i) => i?.run?.status === 'waiting');
  const failed = list.filter((i) => i?.run?.status === 'failed');
  if (!waiting.length && !failed.length) return null;
  const parts = [];
  for (const i of waiting) parts.push(`${assigneeLine(i).text} proposed ${num(i.run.proposals) ?? 'some'} changes on “${i.title}”`);
  for (const i of failed) parts.push(`${assigneeLine(i).text}’s run on “${i.title}” failed`);
  const proposals = waiting.reduce((s, i) => s + (num(i.run.proposals) || 0), 0);
  return { line: parts.join(' · '), review: proposals ? `Review ${proposals} proposal${proposals === 1 ? '' : 's'}` : null, failed: failed.length > 0 };
}

/** WK2: the backlog's columns, and its sort (title, then the board's order). */
export const BACKLOG_COLUMNS = Object.freeze(['Title', 'Assignee', 'Column', 'Priority', 'Est.', 'Due', 'Goal', 'Module', 'Cost']);
export function backlogRows(items, { hideDone = true } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && COLUMN_KEYS.has(i.column) && !(hideDone && i.column === 'done'));
  return [...list].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

/** "Assign to…" groups people, then AI agents; with agents off they are drawn greyed with the reason (WK8). */
export const AGENTS_OFF_REASON = 'AI agents are not switched on for this project. A project owner turns them on in Team.';
export function assignGroups({ people = [], agents = [], agentsOn = true } = {}) {
  return [
    { label: 'People', options: people.map((p) => ({ id: `u:${p.id}`, name: p.name || NOT_RECORDED, disabled: false })) },
    { label: 'AI agents', options: agents.map((a) => ({ id: `a:${a.uid}`, name: a.name, role: a.role || null, disabled: !agentsOn, why: agentsOn ? null : AGENTS_OFF_REASON })) },
  ].filter((g) => g.options.length);
}

/**
 * WK3: the burn-up's geometry. `series` is `[{ day, scope, completed }]`. A
 * day the Worker did not record is skipped, never drawn at 0. Before the
 * first item the chart is "Not recorded".
 */
export const BURN_RANGES = Object.freeze(['2 weeks', '1 month', '3 months', 'Max', 'Custom range']);
export const BURN_SPLITS = Object.freeze(['People', 'Agents', 'Both']);
export function burnup(series, { width = 1000, height = 260 } = {}) {
  const pts = (Array.isArray(series) ? series : []).filter((p) => p && num(p.scope) != null && num(p.completed) != null);
  if (!pts.length) return { empty: true, line: NOT_RECORDED };
  const top = Math.max(...pts.map((p) => num(p.scope)), 1);
  const x = (i) => (pts.length === 1 ? 0 : (i / (pts.length - 1)) * width);
  const y = (v) => height - (v / top) * height;
  const path = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(num(p[k])).toFixed(1)}`).join(' ');
  const first = pts[0];
  const last = pts[pts.length - 1];
  const open = num(last.scope) - num(last.completed);
  return {
    empty: false,
    scope: path('scope'),
    completed: path('completed'),
    area: `${path('scope')} L${x(pts.length - 1).toFixed(1)},${y(num(last.completed)).toFixed(1)} ${[...pts].reverse().map((p, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y(num(p.completed)).toFixed(1)}`).join(' ')} Z`,
    tiles: { scope: num(last.scope), completed: num(last.completed), open },
    line: `Scope grew from ${num(first.scope)} to ${num(last.scope)} items; ${num(last.completed)} are completed and ${open} are open.`,
  };
}

/** WK5: a run's outcome and cost, in the canvas's words. */
export function runOutcome(run) {
  const s = run?.status;
  if (s === 'completed') return { title: 'Completed', tone: 'positive' };
  if (s === 'failed') return { title: 'Failed', tone: 'negative', reason: run.reason || NOT_RECORDED };
  if (s === 'skipped') return { title: 'Skipped', tone: 'muted', reason: run.reason || NOT_RECORDED };
  if (s === 'cancelled') return { title: 'Cancelled', tone: 'muted' };
  if (s === 'running') return { title: 'Running', tone: 'violet' };
  return { title: NOT_RECORDED, tone: 'muted' };
}
export function runCost(run) {
  const h = num(run?.hold_microusd);
  const c = num(run?.charged_microusd);
  const parts = [h == null ? null : `Held ${money(h)}`, c == null ? 'charge not recorded' : `charged ${money(c)}`];
  const t = num(run?.tokens);
  if (t != null) parts.push(`${t.toLocaleString('en-US')} tokens`);
  if (run?.model) parts.push(run.model);
  return parts.filter(Boolean).join(' · ');
}

function money(micro) {
  const usd = micro / 1_000_000;
  const three = usd.toFixed(3);
  return `$${three.endsWith('0') ? usd.toFixed(2) : three}`;
}

// ---------------------------------------------------------------------------
// CO1 to CO5 — the company's compliance tasks.
// ---------------------------------------------------------------------------

export const COMPLIANCE_PURPOSE = (company) => `The filings, payments and renewals ${company || 'this company'} owes, and who owns each.`;
export const COMPLIANCE_TYPES = Object.freeze(['Filing', 'Payment', 'Renewal', 'Report', 'Signature']);

/**
 * CO2: an agenda, not columns — an Overdue section pinned first, then one
 * section per month, oldest first, each task with its date in the gutter. A
 * task without a due date is not placed in a month (never guessed).
 */
export function agenda(tasks, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const open = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.status !== 'done' && t.due);
  const dayOf = (t) => Date.parse(`${String(t.due).slice(0, 10)}T00:00:00Z`);
  const overdue = open.filter((t) => dayOf(t) < today).sort((a, b) => dayOf(a) - dayOf(b));
  const months = new Map();
  for (const t of open.filter((x) => dayOf(x) >= today).sort((a, b) => dayOf(a) - dayOf(b))) {
    const d = new Date(dayOf(t));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!months.has(key)) months.set(key, { key, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase(), tasks: [] });
    months.get(key).tasks.push(t);
  }
  return {
    overdue: overdue.map((t) => ({ ...t, late: Math.round((today - dayOf(t)) / 86_400_000) })),
    months: [...months.values()],
  };
}

/** The date in the agenda's gutter: "OCT", "15", "THU". */
export function gutter(due) {
  const d = new Date(`${String(due || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return {
    month: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
    day: String(d.getUTCDate()),
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(),
  };
}

/** The four counters over the agenda (CO2). A count the read did not give is "Not recorded". */
export function complianceTiles(tasks, now = new Date()) {
  if (!Array.isArray(tasks)) return { overdue: NOT_RECORDED, next30: NOT_RECORDED, quarter: NOT_RECORDED, doneYear: NOT_RECORDED };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOf = (t) => Date.parse(`${String(t.due || t.done_at || '').slice(0, 10)}T00:00:00Z`);
  const q = Math.floor(now.getUTCMonth() / 3);
  const qEnd = Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1);
  const open = tasks.filter((t) => t && t.status !== 'done' && t.due);
  return {
    overdue: open.filter((t) => dayOf(t) < today).length,
    next30: open.filter((t) => dayOf(t) >= today && dayOf(t) <= today + 30 * 86_400_000).length,
    quarter: open.filter((t) => dayOf(t) >= today && dayOf(t) < qEnd).length,
    doneYear: tasks.filter((t) => t && t.status === 'done' && String(t.done_at || '').slice(0, 4) === String(now.getUTCFullYear())).length,
  };
}

/** A linked project item's chip ("In progress in Pilot app"). */
export function linkedWork(link) {
  if (!link || !link.project_name) return null;
  const col = columnLabel(link.column);
  return col ? `${col} in ${link.project_name}` : `In ${link.project_name}`;
}

/** Who may change compliance tasks (CO3r): a company admin only. Readers see no checkbox and no New. */
export function complianceCan(viewer) {
  const admin = viewer?.can_manage === true;
  return { markDone: admin, create: admin, createWork: admin, reschedule: admin };
}

/** Standalone project (CO5): no company, so no Legal and no Compliance. */
export const STANDALONE_LINE = 'No company, so no Legal and no Compliance anywhere for this project.';
export const NO_PROJECTS_LINE = 'Add a project to this company first.';
export const CREATE_WORK_LINE = (task) => `The item lands in that project’s Backlog, linked back here as “For: ${task}”. The task stays with the company.`;
