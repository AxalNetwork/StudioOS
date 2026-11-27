/**
 * D1531 (#3742 E8, `design/incoming/Agent Engine Page.dc.html`, TM10–TM19 and
 * TM5m): the agent engine's screens in plain words. Pure: no React, no network.
 *
 * Every read is through `agentEngineApi` (`lib/api/agentEngine.js`), whose
 * routes are all mounted (`routes/agent_engine.ts`). A missing cost reads
 * "Not recorded", never $0; a refusal is the Worker's own sentence when it
 * sends one, else the canvas's sentence for its code.
 */
import { NOT_RECORDED } from '../../lib/absence';
import { money } from './teamModel.js';

export { NOT_RECORDED };

/** `{ available, value_microusd }` as "$0.12", or null when it was not recorded. */
export function spend(s) {
  if (!s || s.available !== true) return null;
  const v = Number(s.value_microusd ?? s.value);
  return Number.isFinite(v) ? money(v) : null;
}

/** "$1.10 to date", or "Not recorded". */
export const costToDate = (s) => (spend(s) ? `${spend(s)} to date` : NOT_RECORDED);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "15 Jan 2027" from an ISO date or timestamp (read as UTC); null when unreadable. */
export function dayWord(iso) {
  const s = String(iso || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return `${Number(m[3])} ${MONTHS[mo - 1]} ${m[1]}`;
}

/** The status of a read that may be off: `agent_engine_off` is not an error. */
export function readFailure(e) {
  const status = Number(e?.status ?? e?.response?.status ?? 0);
  const code = String(e?.code || e?.data?.code || e?.data?.error || '');
  if (status === 404 && (code === 'agent_engine_off' || code === 'team_agents_off')) return 'off';
  if (status === 403 && (code === 'not_member' || code === 'not_manager')) return 'refused';
  return 'error';
}

export const ENGINE_OFF = 'AI agents are not switched on for this team. Goals and plans appear once they are.';
export const NOT_SAME = 'That is not the same as having none.';

// ── Refusals (TM10S, TM19F, TM15) ─────────────────────────────────────────
export const REFUSALS = Object.freeze({
  cap: 'This agent has reached its monthly cap, so it is paused. Raise the cap to resume it.',
  agent_cap_reached: 'This agent has reached its monthly cap, so it is paused. Raise the cap to resume it.',
  out_of_tokens: 'Your AI tokens are used up. Add tokens to run this.',
  module_not_allowed: 'This agent does not work in that module. Its rule book lists where it works.',
  option_not_allowed: 'This agent may not propose that here. Its rule book lists what it may propose.',
  sponsor_lost_access: 'The person who added this agent can no longer manage this team, so it is paused. An editor can add it again.',
  platform_paused: 'Axal has paused all AI agents on the platform. Open proposals can still be decided.',
  halted: 'Axal has paused all AI agents on the platform. Open proposals can still be decided.',
  gateway_limit: 'Agents reached the platform’s limit, so they are paused for now. You can still work on this yourself.',
  engine_paused: 'Agents are paused on the platform. You can still run them yourself.',
  scope_paused: 'Agents are paused on this team. An editor can resume them.',
  agent_not_live: 'That agent is not working on this team right now.',
  not_ready: 'That task is not ready for this agent: it must be open, assigned to it, with nothing left to wait on.',
  agent_busy: 'This agent is already working on a task.',
  scope_busy: 'This team runs as many agents at once as it allows. Try again when one finishes.',
  queue_full: 'Proposals are waiting for a decision. Decide one first.',
  plan_decided: 'This plan was already accepted or discarded.',
  invalid_plan: 'Keep at least one item, or discard the plan.',
  plan_invalid: 'The plan could not be read, so nothing was created.',
  plan_not_saved: 'The plan could not be read, so nothing was created.',
  parent_not_in_company: 'That parent goal is not in this company.',
  role_taken: 'This team already has an agent in that role.',
  persona_on_team: 'This team already has an agent in that role.',
  model_not_offered: 'That agent is not offered to teams now. Choose another.',
  persona_retired: 'That agent is not offered to teams now. Choose another.',
  cap_over_limit: 'That cap is above the most a team may set for this agent.',
  plan_required: 'Agents come with a paid Founder plan.',
  note_too_long: 'A note is at most 1,000 characters.',
  not_manager: 'Only this team’s editors can do this.',
});

/** A refusal in words: the Worker's sentence first, then the code's, then a plain fallback. */
export function refusalSentence(e, fallback = 'That did not go through. Nothing changed.') {
  // The client puts the Worker's sentence on `e.message` (D258's `readRefusal`), or the bare code when it sent none.
  const code = String(e?.code || e?.data?.code || (typeof e?.data?.error === 'string' ? e.data.error : '') || '');
  const message = String(e?.message || '').trim();
  if (message && message !== code && !/^HTTP \d|^Request failed|^[a-z_]+$|^Session expired$/.test(message)) return message;
  return REFUSALS[code] || fallback;
}

// ── TM10: goals ───────────────────────────────────────────────────────────
export const GOAL_STATUSES = Object.freeze([['open', 'Open'], ['achieved', 'Achieved'], ['dropped', 'Dropped']]);
export const GOAL_STAGES = Object.freeze([['idea', 'Idea'], ['validate', 'Validate'], ['build', 'Build'], ['launch', 'Launch'], ['raise', 'Raise'], ['grow', 'Grow']]);
export const GOAL_PRIORITIES = Object.freeze([['low', 'Low'], ['normal', 'Normal'], ['high', 'High']]);
const label = (list, key) => (list.find(([k]) => k === String(key || '').toLowerCase()) || [null, null])[1];
export const statusWord = (s) => label(GOAL_STATUSES, s) || (s ? String(s) : 'Open');
export const stageWord = (s) => label(GOAL_STAGES, s);
export const GOALS_EMPTY = { title: 'No goals yet', body: 'A goal is what the team is trying to reach. Tasks hang off it, and an agent can draft a plan for it.' };
export const GOALS_READER = 'You can read goals on this team. Managers add and edit them.';
export const GOALS_ERROR = 'Goals could not be read.';
export const COMPANY_GOALS_NOTE = 'Company goals and their status. Agents plan goals inside a project.';
export const COMPANY_PLAN_OFF = 'Agents plan goals inside a project. Open a project to plan this goal.';
export const BAD_DATE = 'The target date is a day, such as 2027-03-31.';

/** "4 of 6 tasks done", or null with no tasks. */
export function progressWords(p) {
  const total = Number(p?.total);
  if (!Number.isFinite(total) || total <= 0) return null;
  return `${Math.max(0, Number(p?.done) || 0)} of ${total} tasks done`;
}

/** One goal row as TM10a draws it. */
export function goalRow(g) {
  return {
    uid: g?.uid,
    title: String(g?.title || '').trim() || 'Untitled goal',
    status: statusWord(g?.status),
    tone: String(g?.status || 'open') === 'achieved' ? 'pos' : String(g?.status || 'open') === 'open' ? 'vio' : 'mut',
    parent: g?.parent?.title ? `↳ ${g.parent.title}` : '—',
    due: dayWord(g?.target_date) || '—',
    progress: progressWords(g?.progress),
    done: Math.max(0, Number(g?.progress?.done) || 0),
    total: Math.max(0, Number(g?.progress?.total) || 0),
    cost: costToDate(g?.cost),
  };
}

/** TM10b's line under a goal's title. */
export function goalLine(g) {
  const parts = [statusWord(g?.status)];
  const due = dayWord(g?.target_date);
  if (due) parts.push(`target ${due}`);
  if (g?.parent?.title) parts.push(`parent: ${g.parent.title}`);
  const p = progressWords(g?.progress);
  if (p) parts.push(p);
  return `${parts.join(' · ')}.`;
}

/** The goal form's body from its fields, or `{ error }` for the field that is wrong. */
export function goalBody(f, { project = true, edit = false } = {}) {
  const title = String(f?.title || '').trim();
  if (!title) return { error: { field: 'title', text: 'Write the goal’s title first.' } };
  const date = String(f?.target_date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: { field: 'target_date', text: BAD_DATE } };
  const body = { title };
  for (const k of ['why', 'metric']) { const v = String(f?.[k] || '').trim(); if (v || edit) body[k] = v || null; }
  if (date || edit) body.target_date = date || null;
  if (f?.priority) body.priority = f.priority;
  if (project && (f?.stage || edit)) body.stage = f.stage || null;
  if (!project && (f?.parent_goal_uid || edit)) body.parent_goal_uid = f.parent_goal_uid || null;
  if (edit && f?.status) body.status = f.status;
  return { body };
}

/** TM10b: a goal's tasks grouped by module, in the order modules first appear. */
export function tasksByModule(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const titles = new Map(list.map((t) => [t.uid, t.title]));
  const groups = new Map();
  for (const t of list) {
    const k = t.module || 'none';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ ...t, waits: (t.depends_on || []).map((u) => titles.get(u)).filter(Boolean) });
  }
  return [...groups].map(([module, rows]) => ({ module, label: module === 'none' ? 'No module' : moduleWord(module), rows }));
}
export const moduleWord = (m) => String(m || '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const TASK_STATUS = { open: 'Open', ready: 'Ready', in_progress: 'In progress', running: 'In progress', review: 'In review', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled', backlog: 'Backlog' };
export const taskStatusWord = (s) => TASK_STATUS[String(s || '')] || (s ? moduleWord(s) : 'Open');

/** TM10c: the quote chip's line. */
export function quoteLine(q, by, agentName) {
  const who = by === 'eadwyn' ? 'by Eadwyn' : `by ${agentName || 'the planner agent'}`;
  const v = q && q.available === true ? spend({ available: true, value_microusd: q.value_microusd }) : null;
  return v ? `${v} · ${who}` : 'Cost can’t be estimated right now';
}
export const quotePaidBy = (by, agentName) => (by === 'eadwyn'
  ? 'Paid from your AI tokens.'
  : `Run by ${agentName || 'the team’s planner agent'}, the team’s planner agent, from its sponsor’s AI tokens under its monthly cap.`);
export const QUOTE_DOWN = 'The quote did not answer. Draft still works; the run shows its real cost when it finishes.';

/** TM10d: one plan item's line under its title. */
export function planItemLine(item, items) {
  const all = Array.isArray(items) ? items : [];
  const waits = (item?.depends_on || []).map((i) => all[i]?.title).filter(Boolean);
  const due = Number.isFinite(Number(item?.due_in_days)) && item?.due_in_days != null ? `Due in ${Number(item.due_in_days)} days` : 'No due date';
  return `${waits.length ? `Waits on: ${waits.join(', ')} · ` : ''}${due}`;
}

/** The accept body: the indices left out and the titles changed. */
export function acceptBody(items, kept, titles) {
  const remove = []; const changed = {};
  (items || []).forEach((it, i) => {
    if (!kept[i]) { remove.push(i); return; }
    const t = String(titles?.[i] ?? '').trim();
    if (t && t !== it.title) changed[i] = t;
  });
  return { remove: remove.length ? remove : undefined, titles: Object.keys(changed).length ? changed : undefined };
}

// ── TM13: handoffs ────────────────────────────────────────────────────────
const STEP_STATUS = { accepted: 'Accepted', edited: 'Accepted', proposed: 'Waiting', waiting: 'Waiting', refused: 'Refused', discarded: 'Refused', withdrawn: 'Refused', expired: 'Refused' };
export const stepStatus = (s) => STEP_STATUS[String(s || '')] || 'Waiting';
const LOOPS = {
  loop: 'Stopped: this would hand the work back to an agent already in the chain.',
  handoff_loop: 'Stopped: this would hand the work back to an agent already in the chain.',
  depth: 'Stopped: the chain is already three steps deep.',
  handoff_depth: 'Stopped: the chain is already three steps deep.',
  too_deep: 'Stopped: the chain is already three steps deep.',
};
export const loopWords = (r) => LOOPS[String(r?.reason || r || '')] || (r?.reason ? `Stopped: ${String(r.reason).replace(/_/g, ' ')}.` : 'Stopped.');
export function stepDecision(step) {
  if (step?.decided_by?.name) return `accepted by ${step.decided_by.name}`;
  return stepStatus(step?.status) === 'Accepted' ? 'decided by: Not recorded' : 'no decision yet';
}
export const HANDOFFS_EMPTY = { title: 'No handoffs yet', body: 'When one agent hands work to another, the chain appears here.' };

// ── TM14: evaluation ──────────────────────────────────────────────────────
/** A rate the Worker sends as a fraction (0.82) as "82%"; "—" when it is not rated. */
export const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v) * 100)}%`);
export function hours(h) {
  if (h == null || !Number.isFinite(Number(h))) return '—';
  const n = Number(h);
  return `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} h`;
}
export function evalRow(r) {
  const rated = r?.acceptance != null;
  return {
    role_key: r?.role_key,
    rated,
    note: rated ? null : (r?.note || `Too few decisions to rate (${Number(r?.decided) || 0})`),
    accepted: pct(r?.acceptance), edited: pct(r?.edit), discarded: pct(r?.discard),
    median: hours(r?.median_decision_h),
    open: Number(r?.open_past_3d) || 0,
    expired: Number(r?.expired) || 0,
    cost: spend(r?.cost_per_accepted) || NOT_RECORDED,
    refused: Array.isArray(r?.refused) ? r.refused.map((x) => ({ text: REFUSALS[x?.reason] || String(x?.reason || '').replace(/_/g, ' '), n: Number(x?.n) || 0 })) : [],
  };
}
export const EVAL_TITLE = 'How agents are doing';
export const EVAL_LINE = 'Decisions people took on each agent’s proposals, and what each accepted proposal cost.';
export const EVAL_EMPTY = { title: 'No decisions yet', body: 'Rates appear once people have decided on agents’ proposals.' };
export const NO_LIVE_AGENT = 'An agent no longer on this team';

/** TM14b: one skill's golden-case line. */
export function skillCheck(s) {
  const passed = Number(s?.pass) || 0;
  const total = Number(s?.total) || 0;
  const regressed = Array.isArray(s?.regressed) ? s.regressed : [];
  return {
    name: `${s?.name || 'Skill'}${s?.version ? ` · v${s.version}` : ''}`,
    cases: total ? `golden cases ${passed}/${total}` : 'golden cases —',
    notRun: Number(s?.not_run) || 0,
    last: dayWord(s?.last_run) ? `Last run ${dayWord(s.last_run)}` : 'Last run: Not recorded',
    regressions: regressed.length ? `Regressed: ${regressed.map((x) => [x?.case, x?.model].filter(Boolean).join(' · ')).join(', ')}` : 'No regressions',
  };
}

// ── TM15: an agent for this goal ──────────────────────────────────────────
export const SUGGEST_TITLE = 'An agent for this goal';
export const SUGGEST_EMPTY = 'Nothing to suggest for this goal. The team already covers it.';
export const SUGGEST_FOOT = 'You set each cap. Nothing runs until a task is started.';
export const SUGGEST_READER = 'You can read this team. A manager adds agents.';
export const monthWord = (est) => (spend(est) ? `About ${spend(est)} a month` : NOT_RECORDED);

/** The cap field in dollars to micro-dollars; null when it is not a positive number. */
export function capMicro(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) : null;
}

// ── TM18: moves ───────────────────────────────────────────────────────────
/** A move's notice, from the side that reads it. */
export function moveNotice(m, { side = 'project', projectName = 'This project' } = {}) {
  const on = dayWord(m?.at);
  const when = on ? ` on ${on}` : '';
  const from = m?.from?.name; const to = m?.to?.name;
  const who = m?.by?.name ? `Moved by ${m.by.name}` : 'Moved by: Not recorded';
  if (side === 'company' && m?.direction === 'out') {
    const blocked = Number(m?.blocked_tasks) || 0;
    return { text: `${m?.project?.name || projectName} left ${from || 'this company'}${when}.${blocked ? ` ${blocked} task${blocked === 1 ? ' was' : 's were'} blocked.` : ''}`, by: who, tone: 'amb', suggest: false };
  }
  if (side === 'company' && m?.direction === 'in') {
    return { text: `${m?.project?.name || projectName} joined ${to || 'this company'}${when}. Its agents stayed with the project.`, by: who, tone: 'info', suggest: true };
  }
  const subject = 'This project';
  if (from && to) return { text: `${subject} moved from ${from} to ${to}${when}. Its agents stayed with the project.`, by: who, tone: 'info', suggest: false };
  if (to) return { text: `${subject} joined ${to}${when}. Its agents stayed with the project.`, by: who, tone: 'info', suggest: false };
  return { text: `${subject} left ${from || 'its company'}${when}. Its agents stayed with the project.`, by: who, tone: 'info', suggest: false };
}
/** The key a dismissed notice is kept under in this browser. */
export const moveKey = (m) => `axal:move-dismissed:${m?.project?.id ?? ''}:${m?.at ?? ''}:${m?.direction ?? ''}`;
export const MOVES_ERROR = { title: 'Moves could not be read.', body: 'No notice is shown until they can.' };
export const MOVE_STOPPED = 'Stopped: the project moved to another company.';

// ── TM19: engine states ───────────────────────────────────────────────────
export const ENGINE_TITLE = 'AI agents on this team';
export const ENGINE_LINE = 'How many may run at once, and whether they start their own work.';
export const PAUSE_TEAM = 'Pause this team’s agents';
export const PAUSE_TEAM_HINT = 'Agents start no new work here. Proposals already made can still be decided.';
export const PAUSE_CONFIRM = {
  title: 'Pause this team’s agents?',
  body: 'Agents start no new work on this team. Runs in progress finish. Proposals already made can still be decided. An editor can resume them at any time.',
};
export const TEAM_PAUSED = 'Agents are paused on this team. An editor can resume them.';
export const ENGINE_READER = 'You can read these settings. An editor changes them.';
export const autonomyWord = (a) => (a === 'self_start' ? 'Agents start their own ready tasks' : 'A person starts each task');
export const parallelLine = (n) => `Run at most ${Math.max(1, Number(n) || 1)} agent${Number(n) === 1 ? '' : 's'} at once`;

/** TM19b: the banner a Work, Calendar or Ask surface draws for an engine read; null when nothing is paused. */
export function engineBanner(engine, halt = null) {
  if (!engine) return null;
  if (engine.halted) {
    const when = halt?.at ? ` since ${String(halt.at).slice(0, 16).replace('T', ' ')} UTC` : '';
    const who = halt?.by?.name ? ` by ${halt.by.name}` : '';
    return { tone: 'kill', text: `Axal has paused all AI agents on the platform${when}${who}. Agents start no new work; proposals already made can still be decided.` };
  }
  if (engine.engine === 'paused' || engine.engine === 'canary') return { tone: 'amb', text: REFUSALS.engine_paused };
  if (engine.scope_paused) return { tone: 'amb', text: TEAM_PAUSED };
  return null;
}

/** TM19c: a task blocked because its proposal waited 7 days. */
export const EXPIRED_LINE = 'No decision in 7 days; the proposal is still open.';
export const isExpiredBlock = (t) => String(t?.blocked_reason || '') === 'decision_expired' || String(t?.blocked_reason || '') === 'proposal_expired';

/** TM19f: the start button's line from a quote. */
export function startLine(q) {
  const v = q && q.available === true ? spend({ available: true, value_microusd: q.value_microusd }) : null;
  return v ? { button: `Start · ~${v}`, hint: `Holds up to ${v} · you pay what it uses` } : { button: 'Start', hint: 'Cost can’t be estimated right now' };
}

// ── TM5m: memory and duties ───────────────────────────────────────────────
export const NOTE_LIMIT = 1000;
export const NOTE_KINDS = { decision: 'Decision', fact: 'Fact', summary: 'Summary' };
export const noteKind = (k) => NOTE_KINDS[String(k || '')] || 'Note';
export function noteLine(n) {
  const by = n?.by?.name ? `Added by ${n.by.name}` : 'Added by the agent';
  const at = dayWord(n?.at);
  const until = dayWord(n?.expires_at);
  return [by, at, until ? `kept until ${until}` : null].filter(Boolean).join(' · ');
}
export function noteProblem(body) {
  const t = String(body || '');
  if (!t.trim()) return 'Write the fact first.';
  if (t.length > NOTE_LIMIT) return 'A note is at most 1,000 characters.';
  return null;
}
export const noteCount = (t) => `${String(t || '').length.toLocaleString('en-US')} / 1,000`;
export const MEMORY_EMPTY = 'No notes yet. Facts the team adds, and decisions it takes on this agent’s proposals, appear here.';
export const MEMORY_RETENTION = 'Notes are kept while this agent works for the team and for 90 days after it is removed. The step summaries of its runs are kept for 180 days. Managers can forget a note, or everything, at any time.';
export const retentionLine = (r) => String(r?.text || '').trim() || MEMORY_RETENTION;
export const forgetAllTitle = (n) => `Forget all ${n} note${n === 1 ? '' : 's'}? This can’t be undone.`;
export const forgotLine = (n) => `Forgot ${Number(n) || 0} note${Number(n) === 1 ? '' : 's'}`;

export const DUTIES_EMPTY = 'No scheduled duties. This agent runs when a task is started, or when you schedule it on the Calendar.';
const OUTCOME = {
  task_created: 'Made a task',
  made_task: 'Made a task',
  completed: 'Made a task',
  out_of_tokens: 'Skipped: its sponsor was out of AI tokens',
  sponsor_out_of_tokens: 'Skipped: its sponsor was out of AI tokens',
  agent_paused: 'Skipped: the agent was paused',
  paused: 'Skipped: the agent was paused',
  skill_retired: 'Skipped: its skill was retired',
  scope_gone: 'Skipped: its team is gone',
  team_gone: 'Skipped: its team is gone',
};
export function dutyOutcome(o) {
  if (!o) return 'Not run yet';
  const k = typeof o === 'string' ? o : (o.kind || o.outcome || o.status || '');
  if (typeof o === 'object' && o.text) return o.text;
  return OUTCOME[k] || `Last outcome: ${String(k).replace(/_/g, ' ')}`;
}
export const cadenceWord = (c) => String(c || '').toLowerCase() || '—';
export const dutyMonth = (est) => (spend(est) ? `${spend(est)} / mo` : NOT_RECORDED);

/** The persona holding `roleKey` on this team, by name; else the role in words (never a raw key). */
export function holderName(roleKey, team) {
  const a = (Array.isArray(team) ? team : []).find((x) => x?.role_key === roleKey && x?.status !== 'removed');
  const n = a ? (String(a?.persona?.name || '').trim() || [a.first_name, a.last_name].filter(Boolean).join(' ').trim()) : '';
  return n || null;
}
