/**
 * D1613 (#3723, boards CAL8 to CAL11 of the "AI agents" addendum) — scheduled
 * AI agent sessions on the Calendar, as words. Pure, so
 * `frontend/test/calendar_agents_d1613.test.mjs` holds each rule and each word.
 *
 * A session is one run of one agent, on one of its role's skills, optionally on
 * one record, at a time or on a repeat. Its work comes back as proposals in
 * Approvals and nothing is applied until a named person accepts it (#3957 on
 * #3849's `agent_duties`). Nothing here says a number the read did not carry:
 * a count, a cost or an estimate that is missing is "Not recorded", never 0.
 */

/** The Worker's kind for a session, once #3957 adds it to the calendar read. */
export const AGENT_KIND = 'agent_session';

/** The sixth source family the addendum draws (teal), added to `FAMILIES` with the kind by #3957. */
export const AGENT_FAMILY = Object.freeze({ key: 'agents', label: 'AI agents' });

export const NOT_RECORDED = 'Not recorded';

/** CAL8: the line under Save, and the line under the estimate. */
export const PROPOSALS_LINE = 'Its work comes back as proposals in Approvals. Nothing is applied until someone accepts it.';
export const HOLD_LINE = 'Each run shows its hold before it starts. Sessions stop when the agent reaches its monthly cap.';
export const INSTRUCTION_MAX = 1000;

export const CADENCES = Object.freeze([
  ['once', 'Once'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'],
]);
export const WEEKDAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

/** The kinds of record a session can work on (CAL8's "Work on"). */
export const TARGET_KINDS = Object.freeze({
  meeting: 'meeting', deal: 'deal', deck: 'deck', module: 'module', document: 'document',
});

const names = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

/** "$0.40" from integer cents; null for anything that is not a count. */
export function money(cents) {
  return Number.isInteger(cents) && cents >= 0 ? `$${(cents / 100).toFixed(2)}` : null;
}

/** CAL9 and CAL10: the state chip. `waiting` is an integer the read counted, or the chip says no number. */
export function stateChip(session) {
  const s = String(session?.state || '');
  if (s === 'running') return { key: 'running', words: 'Running', pulse: true };
  if (s === 'waiting') {
    const n = session?.proposals_waiting;
    const words = Number.isInteger(n) && n > 0 ? `${n} proposal${n === 1 ? '' : 's'} waiting` : 'Proposals waiting';
    return { key: 'waiting', words, tone: 'amber' };
  }
  if (s === 'skipped') return { key: 'skipped', words: 'Skipped' };
  if (s === 'done') return { key: 'done', words: 'Done' };
  if (s === 'cancelled') return { key: 'cancelled', words: 'Cancelled' };
  if (s === 'paused') return { key: 'paused', words: 'Paused' };
  if (s === 'scheduled') return { key: 'scheduled', words: 'Scheduled' };
  return { key: 'unknown', words: NOT_RECORDED };
}

/** The Team page of the session's team, from the scope the read names. */
export function teamPath(scope) {
  const kind = scope?.kind;
  if (kind === 'company' && scope.uid) return `/account/companies/${encodeURIComponent(scope.uid)}/settings/team`;
  if (kind === 'company_project' && scope.uid && scope.id != null) return `/account/companies/${encodeURIComponent(scope.uid)}/settings/projects/${encodeURIComponent(scope.id)}/team`;
  if (kind === 'project' && scope.id != null) return `/projects/${encodeURIComponent(scope.id)}/settings/team`;
  return null;
}

export const USAGE_PATH = '/account/usage/ai-tokens';
export const CONNECTORS_PATH = '/account/connectors';

/**
 * CAL11: why a session was skipped, in the canvas's words, and what to do.
 * Each reason says nothing ran and nothing was charged, because a skipped
 * session is claimed and released before any hold (#3849's sweep).
 */
export function skipReason(session) {
  const r = session?.skip || {};
  const agent = names(session?.agent?.name, 'This agent');
  const team = teamPath(session?.scope);
  switch (r.reason) {
    case 'agent_paused':
      return {
        key: 'agent_paused', title: 'Agent paused',
        line: `${agent} is paused${r.by ? ` by ${r.by}` : ''}, so its sessions are skipped and not charged. The schedule stays.`,
        actions: team ? [{ label: 'Resume the agent in Team › Agents ›', to: `${team}?tab=people` }] : [],
      };
    case 'out_of_tokens': {
      const hold = money(r.hold_cents);
      const who = names(session?.sponsor?.name, 'The sponsor');
      return {
        key: 'out_of_tokens', title: 'Out of AI tokens',
        line: `Skipped. ${who}’s AI tokens cannot cover the hold${hold ? ` of ${hold}` : ''}. Nothing was charged. The next session runs if the balance allows.`,
        actions: [{ label: 'Add tokens', to: '/pricing?for=models#add-tokens', primary: true }, { label: 'Open Usage ›', to: USAGE_PATH }],
      };
    }
    case 'tool_disconnected': {
      const tool = names(r.tool, 'a tool');
      const conn = names(r.connector, 'the connector');
      return {
        key: 'tool_disconnected', title: 'A needed tool is disconnected',
        line: `Skipped. This skill reads ${tool}, and the connection ended${r.ended_on ? ` on ${r.ended_on}` : ''}. Nothing ran and nothing was charged.`,
        actions: [{ label: `Reconnect ${conn} in Connectors ›`, to: CONNECTORS_PATH }],
      };
    }
    case 'skill_retired': {
      const skill = names(session?.skill?.name, 'This skill');
      const v = Number.isInteger(session?.skill?.version) ? ` v${session.skill.version}` : '';
      const next = Number.isInteger(r.replacement_version) ? r.replacement_version : null;
      return {
        key: 'skill_retired', title: 'Skill retired',
        line: `Skipped. Axal retired ${skill}${v}${r.retired_on ? ` on ${r.retired_on}` : ''}. Pick its replacement, or another of ${agent}’s skills, to resume the schedule.`,
        actions: [{ label: 'Pick a skill', pick: true }].concat(next ? [{ label: `Update to v${next} ›`, update: next }] : []),
      };
    }
    default:
      return session?.state === 'skipped'
        ? { key: 'unknown', title: 'Skipped', line: 'Skipped. The reason was not recorded. Nothing ran and nothing was charged.', actions: [] }
        : null;
  }
}

/** CAL11: AI agents are not switched on for the team. */
export function offLine(company) {
  return `AI agents aren’t switched on for ${names(company, 'this company')}. An editor turns them on in Team › Agents. No session can be scheduled until then.`;
}

/** CAL11: a member without edit rights sees sessions and their state, and no actions. */
export function readOnlyLine(company) {
  return `Only ${names(company, 'the company')}’s editors schedule agents.`;
}

const pad = (n) => String(n).padStart(2, '0');

/** "Lisbon time" for an IANA zone. */
const cityOf = (zone) => (zone ? `${String(zone).split('/').pop().replace(/_/g, ' ')} time` : null);

/** CAL10's head line: "Weekly on Monday · 08:00 Lisbon time"; "Once · Thu 12 Nov 2026, 08:00". */
export function repeatLine(schedule) {
  const s = schedule || {};
  const at = /^\d{2}:\d{2}$/.test(String(s.time || '')) ? s.time : null;
  const city = cityOf(s.zone);
  const tail = [at, city].filter(Boolean).join(' ');
  if (s.cadence === 'once') {
    const d = s.run_at ? new Date(s.run_at) : null;
    if (!d || Number.isNaN(d.getTime())) return NOT_RECORDED;
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: s.zone || undefined });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: s.zone || undefined });
    return `Once · ${day}, ${time}${city ? ` ${city}` : ''}`;
  }
  if (s.cadence === 'daily') return tail ? `Daily · ${tail}` : 'Daily';
  if (s.cadence === 'weekly') {
    const day = WEEKDAYS.includes(s.weekday) ? s.weekday : null;
    return [`Weekly${day ? ` on ${day}` : ''}`, tail].filter(Boolean).join(' · ');
  }
  if (s.cadence === 'monthly') {
    const d = Number.isInteger(s.day_of_month) ? `on day ${s.day_of_month}` : '';
    return [`Monthly${d ? ` ${d}` : ''}`, tail].filter(Boolean).join(' · ');
  }
  return NOT_RECORDED;
}

/** CAL8's estimate: "About $0.40 per session · $1.60 this month". A missing number is "Not recorded". */
export function estimateLine(est) {
  if (!est) return NOT_RECORDED;
  const per = money(est.per_session_cents);
  const month = money(est.month_cents);
  if (!per) return NOT_RECORDED;
  return month ? `About ${per} per session · ${month} this month` : `About ${per} per session`;
}

/** CAL8: the cap line, "$3.20 of $20.00 used this month", or null. */
export function capLine(est) {
  const used = money(est?.cap_used_cents);
  const cap = money(est?.cap_cents);
  return used && cap ? `${used} of ${cap} used this month` : null;
}

/** CAL10: "Run now holds up to $0.45 · you pay what it uses". */
export function runNowLine(holdCents) {
  const hold = money(holdCents);
  return hold ? `Run now holds up to ${hold} · you pay what it uses` : 'Run now shows its hold before it starts · you pay what it uses';
}

/** CAL10: the sponsor line, by name only. */
export function sponsorLine(sponsor) {
  return sponsor?.name ? `${sponsor.name} · runs are paid from their AI tokens` : NOT_RECORDED;
}

/** CAL10: one row of Last runs. A run that was skipped or cancelled says "Not charged". */
export function runRow(run) {
  const chip = stateChip({ state: run?.state, proposals_waiting: run?.proposals });
  const n = run?.proposals;
  const note = Number.isInteger(n) ? (n === 0 ? 'No proposals' : `${n} proposal${n === 1 ? '' : 's'}`) : null;
  const charged = run?.state === 'skipped' || run?.state === 'cancelled' ? 'Not charged' : (money(run?.cost_cents) || NOT_RECORDED);
  return { when: names(run?.date, NOT_RECORDED), chip, note, cost: charged };
}

/** CAL10: the amber banner while proposals wait. */
export function waitingBanner(session) {
  const n = session?.proposals_waiting;
  if (!(Number.isInteger(n) && n > 0)) return null;
  const from = session?.last_run_day ? ` from ${session.last_run_day}’s run` : '';
  return { line: `${n} proposal${n === 1 ? '' : 's'}${from} ${n === 1 ? 'is' : 'are'} waiting.`, action: `Review ${n} proposal${n === 1 ? '' : 's'} ›` };
}

/**
 * CAL8: the agent picker. Agents of the viewer's company first, then each
 * project's, each group in the read's order. A paused agent is drawn and
 * cannot be picked.
 */
export function agentGroups(agents) {
  const list = Array.isArray(agents) ? agents : [];
  const groups = [];
  const byKey = new Map();
  for (const a of list) {
    const company = names(a?.company_name, 'Your company');
    const project = names(a?.project_name, null);
    const key = project ? `${company} › ${project}` : company;
    if (!byKey.has(key)) { const g = { key, label: key, project: !!project, agents: [] }; byKey.set(key, g); groups.push(g); }
    byKey.get(key).agents.push({ ...a, pickable: a?.status !== 'paused' });
  }
  return groups.sort((x, y) => Number(x.project) - Number(y.project));
}

/** CAL8: an agent row's second line, "Platform model · [Model A] + 2 read tools · 4 skills". */
export function agentMeta(a) {
  const tools = Number.isInteger(a?.tools) && a.tools > 0 ? ` + ${a.tools} read tool${a.tools === 1 ? '' : 's'}` : '';
  const model = a?.model ? `Platform model · ${a.model}${tools}` : null;
  const skills = Number.isInteger(a?.skills) ? `${a.skills} skill${a.skills === 1 ? '' : 's'}` : null;
  return [model, skills].filter(Boolean).join(' · ') || NOT_RECORDED;
}

/** CAL8: the hint under Skill, "4 skills for Investor relations". */
export function skillHint(skills, role) {
  const n = Array.isArray(skills) ? skills.length : null;
  if (n == null) return null;
  return `${n} skill${n === 1 ? '' : 's'}${role ? ` for ${role}` : ''}`;
}

/** The local `datetime-local` value for `date` at `hour`, as a slot pre-fills CAL8's When. */
export function slotStart(date, hour = 9) {
  const d = date instanceof Date ? new Date(date) : new Date();
  d.setHours(hour, 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

/**
 * CAL8's Save: the body #3957's `POST /api/agents/:uid/duties` takes, or the
 * first problem in words. The instruction is sent as typed (the Worker wraps it
 * as untrusted); a once session must be in the future.
 */
export function sessionBody(form, now = Date.now()) {
  const f = form || {};
  if (!f.agent_uid) return { problem: 'Pick an agent.' };
  if (!f.skill_id) return { problem: 'Pick a skill.' };
  const instruction = String(f.instruction || '');
  if (instruction.length > INSTRUCTION_MAX) return { problem: `Keep the instruction under ${INSTRUCTION_MAX.toLocaleString('en-US')} characters.` };
  const cadence = CADENCES.some(([k]) => k === f.cadence) ? f.cadence : null;
  if (!cadence) return { problem: 'Choose once or a repeat.' };
  const body = { skill_id: f.skill_id, cadence, zone: f.zone || null };
  if (Number.isInteger(f.skill_version)) body.skill_version = f.skill_version;
  if (f.target?.kind && f.target?.id != null) { body.target_kind = f.target.kind; body.target_id = String(f.target.id); }
  if (instruction.trim()) body.instruction = instruction.trim();
  if (cadence === 'once') {
    const at = Date.parse(f.run_at || '');
    if (!Number.isFinite(at)) return { problem: 'Choose a date and time.' };
    if (at <= now) return { problem: 'Choose a time in the future.' };
    body.run_at = new Date(at).toISOString();
  } else {
    if (!/^\d{2}:\d{2}$/.test(String(f.time || ''))) return { problem: 'Choose a time.' };
    body.time = f.time;
    if (cadence === 'weekly') {
      if (!WEEKDAYS.includes(f.weekday)) return { problem: 'Choose a day.' };
      body.weekday = f.weekday;
    }
    if (cadence === 'monthly') {
      const d = Number(f.day_of_month);
      if (!(Number.isInteger(d) && d >= 1 && d <= 28)) return { problem: 'Choose a day from 1 to 28.' };
      body.day_of_month = d;
    }
  }
  return { body };
}

/** What a session sheet may do: the read's `can`, and nothing on a cancelled or read-only session. */
export function sessionActions(session) {
  const can = session?.can || {};
  if (!session || session.state === 'cancelled') return [];
  return [
    can.run_now && { key: 'run', label: 'Run now', primary: true },
    can.reschedule && { key: 'reschedule', label: 'Reschedule' },
    can.pause && { key: 'pause', label: session.cadence === 'once' ? 'Pause' : 'Pause this schedule' },
    can.cancel && { key: 'cancel', label: 'Cancel', danger: true },
  ].filter(Boolean);
}

/** The refusal codes #3957 names, in words. Anything else is the Worker's own sentence, or a plain line. */
const REFUSALS = Object.freeze({
  skill_not_in_role: 'That skill is not one of this agent’s role skills.',
  target_not_readable: 'The sponsor cannot read that record, so the agent cannot work on it.',
  run_at_past: 'Choose a time in the future.',
  over_cap: 'This would go over the agent’s monthly cap. Lower the repeat or raise the cap in Team › Agents.',
  agent_paused: 'This agent is paused. Resume it in Team › Agents first.',
  not_manager: 'Only the team’s editors schedule agents.',
  out_of_tokens: 'The sponsor’s AI tokens cannot cover the hold. Nothing was charged.',
});

export function sessionRefusal(e) {
  const code = e?.code || e?.data?.code || e?.data?.error || null;
  if (code && REFUSALS[code]) return REFUSALS[code];
  const said = e?.data?.message || e?.message;
  return typeof said === 'string' && said.trim() && !/^\d{3}\b|fetch|network/i.test(said) ? said.trim() : 'That did not save. Nothing was scheduled.';
}
