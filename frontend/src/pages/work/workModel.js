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
  // D1614 W6 (#3974): WK7, the project's Workload (the owner: the Workload view is per project).
  { key: 'workload', label: 'Workload' },
  // D1531 (#3742 E8, TM10): the project's goals and an agent's plan for one.
  { key: 'goals', label: 'Goals' },
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
/**
 * #3973: whether this reader may move this card, by the Worker's own rule
 * (`workPermission`): a project editor moves any card; anyone else moves only
 * a card assigned to them by name. Without a viewer, nothing moves.
 */
export function canMove(card, viewer) {
  if (!viewer) return false;
  if (viewer.can_manage === true) return true;
  const a = card?.assignee;
  return !!(a && a.kind === 'person' && viewer.user_uid && a.uid === viewer.user_uid);
}

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
export function burnup(series, { width = 1000, height = 260, split = 'Both' } = {}) {
  const kind = split === 'People' ? 'person' : split === 'Agents' ? 'agent' : null;
  const pts = (Array.isArray(series) ? series : [])
    .filter((p) => p && p.available !== false && num(p.scope) != null && num(p.completed) != null)
    .map((p) => ({ ...p, total_completed: num(p.completed), open: num(p.open) ?? num(p.scope) - num(p.completed), completed: kind ? num(p.completed_by?.[kind]) : num(p.completed) }))
    .filter((p) => p.completed != null);
  if (!pts.length) return { empty: true, line: NOT_RECORDED };
  const top = Math.max(...pts.map((p) => num(p.scope)), 1);
  const x = (i) => (pts.length === 1 ? 0 : (i / (pts.length - 1)) * width);
  const y = (v) => height - (v / top) * height;
  const path = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(num(p[k])).toFixed(1)}`).join(' ');
  const first = pts[0];
  const last = pts[pts.length - 1];
  const open = last.open;
  return {
    empty: false,
    scope: path('scope'),
    completed: path('completed'),
    area: `${path('scope')} L${x(pts.length - 1).toFixed(1)},${y(last.total_completed).toFixed(1)} ${[...pts].reverse().map((p, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y(p.total_completed).toFixed(1)}`).join(' ')} Z`,
    tiles: { scope: num(last.scope), completed: num(last.completed), open },
    line: `Scope grew from ${num(first.scope)} to ${num(last.scope)} items; ${num(last.completed)} are completed${kind ? ` by ${split.toLowerCase()}` : ''} and ${open} are open.`,
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

// ---------------------------------------------------------------------------
// D1614 W6 (#3974) — WK5's run sheet, WK6's activity feed, WK7's workload.
// W3's run (`GET /api/teams/runs/:uid`) and feed, and W4's workload, as words.
// ---------------------------------------------------------------------------

/** A `Spend` (`{ available, value_microusd }`) as money, or "Not recorded": never $0 for an unknown. */
export function spendWords(s) {
  return s && s.available === true && Number.isFinite(Number(s.value_microusd)) ? money(Number(s.value_microusd)) : NOT_RECORDED;
}
/** W3's tokens block. */
export function tokenWords(t) {
  if (!t || t.available !== true) return NOT_RECORDED;
  return `${(Number(t.input || 0) + Number(t.output || 0)).toLocaleString('en-US')} tokens`;
}
/** A duration in plain words. */
export function durationWords(ms) {
  const n = num(ms);
  if (n == null) return NOT_RECORDED;
  const s = Math.round(n / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
const clock = (at) => (at ? String(at).replace('T', ' ').slice(11, 16) : null);

/** W3's outcome kinds in the canvas's words. */
export function detailOutcome(o) {
  switch (o?.kind) {
    case 'in_progress': return { title: 'Running', tone: 'violet' };
    case 'completed': return { title: o.awaiting_decision ? 'Completed · waiting for a decision' : 'Completed', tone: 'positive' };
    case 'skipped': return { title: 'Skipped', tone: 'muted', reason: o.reason_text || NOT_RECORDED };
    case 'cancelled': return { title: 'Cancelled', tone: 'muted', reason: o.reason_text || null };
    case 'failed': return { title: 'Failed', tone: 'negative', reason: o.reason_text || NOT_RECORDED, retryable: o.retryable === true };
    default: return { title: NOT_RECORDED, tone: 'muted' };
  }
}

const DECIDED = { accepted: 'accepted', edited: 'accepted with edits', discarded: 'discarded', proposed: 'waiting', withdrawn: 'withdrawn' };

/** WK5: the run's rows, from W3's `detail`: what it worked on, read, produced and decided, its outcome, timing and cost. */
export function runSheet(r) {
  const d = r?.detail || {};
  const out = detailOutcome(d.outcome);
  const proposals = Array.isArray(d.proposals) ? d.proposals : [];
  const produced = proposals.length
    ? `${proposals.length} ${proposals.length === 1 ? 'proposal' : 'proposals'} · ${proposals.map((p) => `${DECIDED[p.status] || p.status}${p.decided_by?.name ? ` by ${p.decided_by.name}` : ''}`).join(' · ')}`
    : 'No proposal';
  const timing = d.started_at
    ? `Started ${clock(d.started_at)}${d.finished_at ? ` · ${out.tone === 'negative' ? 'stopped' : 'finished'} ${clock(d.finished_at)}` : ''} · ${durationWords(d.duration_ms)}`
    : NOT_RECORDED;
  const cost = d.cost || {};
  const model = cost.model || d.agent?.model || null;
  return {
    title: out.title,
    tone: out.tone,
    agent: d.agent ? `${d.agent.name || NOT_RECORDED}${d.agent.role ? ` · ${d.agent.role}` : ''}` : NOT_RECORDED,
    retryable: out.retryable === true,
    rows: [
      ['Skill', d.skill ? `${d.skill.name} · v${d.skill.version}` : NOT_RECORDED],
      ['Worked on', d.work?.task?.title || NOT_RECORDED],
      ['Instruction', d.work?.instruction || NOT_RECORDED],
      ['Read', [...(d.sources || []), ...(d.tools || [])].join(' · ') || NOT_RECORDED],
      ['Outcome', out.reason ? `${out.title}. ${out.reason}` : out.title],
      ['Produced', produced],
      ['Timing', timing],
      ['Cost', [`Held ${spendWords(cost.held)}`, `charged ${spendWords(cost.charged)}`, tokenWords(cost.tokens), model].filter(Boolean).join(' · ')],
    ],
  };
}

export const FEED_WHO = Object.freeze([['people', 'People'], ['agents', 'AI agents'], ['both', 'Both']]);
const VERB = { created: 'created', assigned: 'assigned', moved: 'moved', completed: 'completed' };

/** WK6: one feed row's sentence, its time and, for a run, its cost. */
export function feedRow(i) {
  const who = i?.by?.name || (i?.by?.kind === 'agent' ? 'An agent' : 'Someone');
  const task = i?.task?.title ? `“${i.task.title}”` : 'a task';
  let text;
  if (i?.type === 'agent_run') {
    const o = detailOutcome(i.outcome);
    text = `${who} ran on ${task} · ${o.title}`;
  } else if (i?.type === 'proposal_decision') {
    text = `${who} ${DECIDED[i.decision] || i.decision} a proposal on ${task}`;
  } else {
    text = `${who} ${VERB[i?.verb] || i?.verb || 'changed'} ${task}${i?.verb === 'moved' && i.to ? ` to ${columnLabel(i.to) || i.to}` : ''}`;
  }
  return { text, at: i?.at ? String(i.at).replace('T', ' ').slice(0, 16) : NOT_RECORDED, cost: i?.type === 'agent_run' ? spendWords(i.cost) : null, run: i?.type === 'agent_run' ? i.run_uid : null };
}

/** WK7: a week's column header, "W46 · 9–15 Nov". */
export function weekLabel(start) {
  const d = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return NOT_RECORDED;
  const end = new Date(d.getTime() + 6 * 86_400_000);
  // ISO week: the week holding that Thursday, counted from the week holding 4 January.
  const thu = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thu - jan4) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  const mon = (x) => x.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `W${week} · ${d.getUTCDate()}${mon(d) === mon(end) ? '' : ` ${mon(d)}`}–${end.getUTCDate()} ${mon(end)}`;
}

/** #3972: an agent's scheduled session slot in the workload read carries `session`; a task never does. */
export const isSession = (item) => !!item?.session;

/** #3972: each agent's scheduled session slots from the workload read, `[{ agent, items }]`, agents with none left out. */
export function workloadSessions(data) {
  return (data?.agents || [])
    .map((r) => ({ agent: r.agent, items: (r.weeks || []).flatMap((w) => (w.items || []).filter(isSession)) }))
    .filter((r) => r.items.length);
}

/** WK7: the rows, people first then agents, each with its weekly cells; amber only when over a recorded capacity. */
export function workloadRows(data) {
  const row = (r, kind) => ({
    key: `${kind}:${(r.person || r.agent)?.uid}`, kind, who: r.person || r.agent,
    capacity: kind === 'person' ? (r.capacity?.available ? `${r.capacity.value} pts a week` : NOT_RECORDED) : null,
    cells: (r.weeks || []).map((w) => ({
      week: w.week_start, items: w.items || [],
      load: `${w.estimate_points ?? 0} pts${w.unestimated ? ` · ${w.unestimated} not estimated` : ''}`,
      over: w.over_capacity === true,
    })),
    unscheduled: r.unscheduled || [],
  });
  return [...(data?.people || []).map((r) => row(r, 'person')), ...(data?.agents || []).map((r) => row(r, 'agent'))];
}

/** WK7 "Schedule work": a time block from a day and hours, as the board's PATCH wants it; or why not. */
export function scheduleBody(day, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) || !/^\d{2}:\d{2}$/.test(String(from || '')) || !/^\d{2}:\d{2}$/.test(String(to || ''))) return { error: 'Choose a day, a start and an end.' };
  const start = `${day}T${from}:00Z`, end = `${day}T${to}:00Z`;
  if (!(Date.parse(end) > Date.parse(start))) return { error: 'The block ends after it starts.' };
  return { body: { scheduled_start: start, scheduled_end: end } };
}
// #3976 — the list's filters, its Month view, and the words for a refusal.
// ---------------------------------------------------------------------------

/** The filters' choices, from the tasks read (never invented): status, jurisdiction, owner and type. */
export function filterOptions(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const owners = new Map();
  for (const t of list) if (t?.owner?.uid) owners.set(t.owner.uid, t.owner.name || 'Not recorded');
  return {
    status: [['open', 'Due'], ['done', 'Done'], ['all', 'All']],
    jurisdiction: uniq(list.map((t) => t?.jurisdiction)),
    owner: [['none', 'No owner'], ...[...owners.entries()].sort((a, b) => a[1].localeCompare(b[1]))],
    type: COMPLIANCE_TYPES.filter((ty) => list.some((t) => t?.type === ty)),
  };
}

/** The list narrowed by the filters; `status` defaults to open (due or snoozed). */
export function filterTasks(tasks, f = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.filter((t) => {
    if (!t) return false;
    const st = f.status || 'open';
    if (st === 'open' && t.status === 'done') return false;
    if (st === 'done' && t.status !== 'done') return false;
    if (f.jurisdiction && t.jurisdiction !== f.jurisdiction) return false;
    if (f.owner === 'none' && t.owner) return false;
    if (f.owner && f.owner !== 'none' && t.owner?.uid !== f.owner) return false;
    if (f.type && t.type !== f.type) return false;
    return true;
  });
}

/**
 * The Month view: the weeks (Monday first) of `month` ("YYYY-MM"), each day
 * with the tasks due on it. A task without a date is never placed.
 */
export function monthGrid(tasks, month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return null;
  const first = Date.UTC(y, m - 1, 1);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const byDay = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const d = String(t?.due || '').slice(0, 10);
    if (!d.startsWith(`${y}-${String(m).padStart(2, '0')}-`)) continue;
    const n = Number(d.slice(8, 10));
    byDay.set(n, [...(byDay.get(n) || []), t]);
  }
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => ({ day: i + 1, tasks: byDay.get(i + 1) || [] }))];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { label: new Date(first).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), weeks };
}

/** The month the Month view opens on: the first open task's, else this month. */
export function firstMonth(tasks, now = new Date()) {
  const open = (Array.isArray(tasks) ? tasks : []).filter((t) => t?.due && t.status !== 'done').map((t) => String(t.due).slice(0, 7)).sort();
  return open[0] || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The sentence a refused change is shown with: the Worker's own, else ours. Never a code. */
export function refusalLine(e) {
  const said = e?.data?.message || e?.data?.detail;
  return typeof said === 'string' && said.trim() ? said : 'That could not be saved. Try again.';
}

/** A task's flags, in words. */
export function taskFlags(t) {
  const out = [];
  if (t?.needs_reassignment) out.push('Needs a new owner');
  if (t?.review_state === 'ready_for_review') out.push('Ready for review');
  return out;
}

/** A timeline entry in words: who, what, and an agent's cost when one was recorded. */
export function timelineLine(e) {
  const who = e?.actor?.kind === 'system' ? 'Axal' : e?.actor?.name || 'Not recorded';
  const what = {
    created: 'created this task', updated: 'edited it', assigned: 'changed the owner', comment: 'commented',
    ready_for_review: 'marked it ready for review', done: 'marked it done', reopened: 'reopened it',
    needs_reassignment: 'flagged it for a new owner: the owner’s seat ended', work_linked: 'created work in a project',
  }[e?.kind] || 'changed it';
  const cost = e?.actor?.kind === 'agent' ? (Number.isSafeInteger(e?.cost_microusd) ? ` · ${money(e.cost_microusd)}` : ' · cost not recorded') : '';
  return `${who} ${what}${cost}`;
}

/** The Compliance card (CO1, and Company settings › Legal): the next open tasks, overdue first, at most `n`. */
export function nextTasks(tasks, n = 5) {
  return (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.status !== 'done' && t.due)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)) || String(a.uid).localeCompare(String(b.uid))).slice(0, n);
}
export const NO_TASKS_RECORDED = 'Not recorded: no compliance task is recorded for this company yet.';

// ---------------------------------------------------------------------------
// D1614 W8 (#3994, frontend half): the Team picker, My tasks, workload by role.
// The owner (2026-11-04): built from the house shell, no WK13 board.
// ---------------------------------------------------------------------------

/** A Team member's role, in words: the project role the Team records, never a guess. */
export const TEAM_ROLE_WORDS = Object.freeze({
  owner: 'Founder', cofounder: 'Co-founder', advisor: 'Advisor', investor: 'Investor', partner: 'Operating partner', admin: 'Admin', member: 'Member',
});
export function teamRoleWords(role) {
  const r = String(role || '').toLowerCase();
  if (!r) return NOT_RECORDED;
  return TEAM_ROLE_WORDS[r] || r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, ' ');
}

/**
 * A licence's badge, in that licence's accent (`workspaces/shellConfig.js` ACCENT):
 * founder violet, investor indigo, advisor emerald, operating partner amber, admin steel.
 * Written out whole, because Tailwind reads class names at build time.
 */
export const LICENCE_BADGE = Object.freeze({
  founder: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
  investor: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  advisor: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  partner: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  admin: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
});
const AGENT_BADGE = 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-300';
export const licenceBadge = (licence) => LICENCE_BADGE[String(licence || '').toLowerCase()] || LICENCE_BADGE.admin;

/** One person's or agent's line in the picker, from the assignable read's `team` list. */
export function assigneeOption(m) {
  if (!m || !m.uid) return null;
  const open = Number(m.open_tasks) || 0;
  const openWords = `${open} open ${open === 1 ? 'task' : 'tasks'}`;
  if (m.kind === 'agent') {
    return {
      kind: 'agent', uid: m.uid, name: m.name || 'AI agent', badge: { text: m.role || 'AI agent', className: AGENT_BADGE },
      line: [m.status === 'paused' ? 'Paused' : 'Active', openWords].join(' · '), paused: m.status === 'paused',
    };
  }
  const cap = m.capacity == null ? 'capacity Not recorded' : `${m.capacity} pts a week`;
  return {
    kind: 'person', uid: m.uid, name: m.name || NOT_RECORDED,
    badge: { text: teamRoleWords(m.team_role), className: licenceBadge(m.licence) },
    line: [openWords, cap].join(' · '), paused: false,
  };
}

/** The picker's two groups (S1, 2026-11-02): this Team's people, then its AI agents. Only this Team. */
export function assigneeGroups(data) {
  const team = Array.isArray(data?.team) ? data.team : [];
  const opts = team.map(assigneeOption).filter(Boolean);
  return [
    { key: 'people', label: 'Team', options: opts.filter((o) => o.kind === 'person') },
    { key: 'agents', label: 'AI agents', options: opts.filter((o) => o.kind === 'agent') },
  ];
}

/** A refusal in the Worker's own words (422 assignee_not_member, read_only_admin, 409 agent_not_live). */
export function refusalWords(e, fallback = 'That could not be saved. Try again.') {
  const d = e?.data && typeof e.data === 'object' ? e.data : {};
  const said = [d.detail, d.message, e?.message].find((x) => typeof x === 'string' && x.trim() && !/^(HTTP \d+|Request failed)$/.test(x));
  return said || fallback;
}

/** My tasks' filters, the Worker's own values (MY_TASK_STATES, MY_TASK_DUES). */
export const MY_TASK_STATES = Object.freeze([
  { key: 'open', label: 'Open' }, { key: 'closed', label: 'Done' }, { key: 'all', label: 'All' },
]);
export const MY_TASK_DUES = Object.freeze([
  { key: '', label: 'Any date' }, { key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Due today' }, { key: 'week', label: 'This week' }, { key: 'none', label: 'No date' },
]);

/** One task row: the column, the due line, blocked, and "needs reassignment" after a seat ended. */
export function myTaskRow(t, now = new Date()) {
  const due = dueLine(t?.due_at, now);
  const chips = [];
  if (t?.blocked) chips.push('Blocked');
  if (t?.needs_reassignment) chips.push('Needs reassignment');
  return {
    uid: t?.uid, title: t?.title || NOT_RECORDED, link: t?.link || null,
    where: t?.column ? columnLabel(t.column) || NOT_RECORDED : (t?.state === 'closed' ? 'Done' : 'Open'),
    due: due ? `${due.overdue ? 'Overdue · ' : 'Due '}${due.text}` : 'No due date', overdue: !!due?.overdue && t?.state !== 'closed', chips,
  };
}

/** The My tasks read as sections: projects first (by project), then compliance (by company). */
export function myTaskSections(data, now = new Date()) {
  const projects = (Array.isArray(data?.projects) ? data.projects : []).map((g) => ({
    key: `project:${g?.project?.id}`, kind: 'project', title: g?.project?.name || NOT_RECORDED,
    rows: (g?.tasks || []).map((t) => myTaskRow(t, now)),
  }));
  const compliance = (Array.isArray(data?.compliance) ? data.compliance : []).map((g) => ({
    key: `company:${g?.company?.uid}`, kind: 'compliance', title: `${g?.company?.name || NOT_RECORDED} · compliance`,
    rows: (g?.tasks || []).map((t) => myTaskRow(t, now)),
  }));
  const sections = [...projects, ...compliance].filter((s) => s.rows.length);
  return { sections, count: sections.reduce((a, s) => a + s.rows.length, 0), more: !!data?.has_more };
}

/** Workload rows by role: the Team's people by licence, in the shell's order, then its AI agents. */
export const WORKLOAD_ROLE_GROUPS = Object.freeze([
  { key: 'founder', label: 'Founders' }, { key: 'investor', label: 'Investors' }, { key: 'advisor', label: 'Advisors' },
  { key: 'partner', label: 'Operating partners' }, { key: 'admin', label: 'Admins' }, { key: 'other', label: 'Team' }, { key: 'agent', label: 'AI agents' },
]);
export function workloadByRole(rows, team) {
  const licenceOf = new Map((Array.isArray(team) ? team : []).filter((m) => m?.kind === 'person').map((m) => [m.uid, String(m.licence || '').toLowerCase()]));
  const known = new Set(WORKLOAD_ROLE_GROUPS.map((g) => g.key));
  const keyOf = (r) => {
    if (r.kind === 'agent') return 'agent';
    const l = licenceOf.get(r.who?.uid);
    return l && known.has(l) && l !== 'agent' ? l : 'other';
  };
  return WORKLOAD_ROLE_GROUPS.map((g) => ({ ...g, rows: (rows || []).filter((r) => keyOf(r) === g.key) })).filter((g) => g.rows.length);
}
