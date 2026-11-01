/**
 * D1613 (#3723, the "AI agents" addendum: CAL8 to CAL11) — scheduled AI agent
 * sessions on the Calendar:
 *
 *   ScheduleAgentSheet   CAL8   New ▾ › Schedule an AI agent: agent (by company,
 *                               then project), skill, what to work on, the
 *                               instruction, once or a repeat, the estimate
 *   AgentSessionSheet    CAL10  one session at `/calendar/item/agent_session/:id`:
 *                        CAL11  its state, schedule, sponsor, last runs, the
 *                               waiting banner, why it was skipped, and its actions
 *   AgentMark            CAL9   the agent mark on a session's grid chip
 *
 * Every read and write goes through `calendarAgentsAdapter.js`, which is off
 * until #3957 lands its routes: each sheet then draws CAL11's "AI agents not
 * switched on" block, and the grids carry no session because the calendar read
 * has no `agent_session` kind yet. Nothing here runs, applies or charges
 * anything: a session's work is proposals that a named person accepts.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Sheet, Unreadable, actionDanger, actionGhost, actionPrimary } from '../ui';
import * as sessions from './calendarAgentsAdapter';
import {
  CADENCES, HOLD_LINE, INSTRUCTION_MAX, NOT_RECORDED, PROPOSALS_LINE, WEEKDAYS,
  agentGroups, agentMeta, capLine, estimateLine, offLine, readOnlyLine, repeatLine, runNowLine, runRow,
  sessionActions, sessionBody, sessionRefusal, skillHint, skipReason, sponsorLine, stateChip, teamPath, waitingBanner,
} from './calendarAgentModel';

const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SECTION = 'flex flex-col gap-1.5 border-t border-axal-hairline px-5 py-3.5 dark:border-gray-700';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400 dark:hover:text-violet-300';
const CHIP = {
  base: 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold',
  plain: 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200',
  amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200',
  agent: 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-900/20 dark:text-teal-200',
};
const ROLE_LINE = (a) => [a?.name, a?.role_name].filter(Boolean).join(' · ');

/** The agent mark (CAL9): a block carries the mark and its state, never colour alone. */
export function AgentMark({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="flex-none text-teal-700 dark:text-teal-300" data-testid="cal-agent-mark">
      <rect x="4" y="6" width="16" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="9.5" cy="12.5" r="1.6" fill="currentColor" />
      <circle cx="14.5" cy="12.5" r="1.6" fill="currentColor" />
      <path d="M12 2.5v3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** A session's state as a chip (CAL9, CAL10). Running carries a pulse; waiting is amber. */
export function StateChip({ session, testId = 'cal-agent-state' }) {
  const c = stateChip(session);
  return (
    <span className={`${CHIP.base} ${c.tone === 'amber' ? CHIP.amber : CHIP.plain}`} data-state={c.key} data-testid={testId}>
      {c.pulse ? <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600 dark:bg-teal-300" /> : null}
      {c.words}
    </span>
  );
}

/** CAL11 "AI agents not switched on": the reason, Close, and the way to Team › Agents. */
function OffBlock({ reason, company, team, onClose, testId }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-6" data-testid={testId}>
      <p className={`m-0 text-[13.5px] font-semibold ${INK}`}>{company ? offLine(company) : reason}</p>
      <span className="flex flex-wrap gap-2">
        <button type="button" className={actionGhost} onClick={onClose}>Close</button>
        <Link to={team || '/team'} className={actionPrimary}>Open Team › Agents ›</Link>
      </span>
    </div>
  );
}

function Field({ label, hint = null, children, testId }) {
  return (
    <label className="flex flex-col gap-1" data-testid={testId}>
      <span className="flex items-baseline gap-2"><span className={EYEBROW}>{label}</span>{hint ? <span className={`text-[11.5px] ${MUTED}`}>{hint}</span> : null}</span>
      {children}
    </label>
  );
}

/** CAL8: the agent picker. A paused agent is drawn, says so, and cannot be picked. */
export function AgentPicker({ agents, picked, onPick }) {
  const groups = useMemo(() => agentGroups(agents), [agents]);
  if (!groups.length) return <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="cal-agent-none">No agents on your teams yet. Add one in Team › Agents.</p>;
  return (
    <div role="radiogroup" aria-label="Agent" className="flex max-h-[240px] flex-col gap-2 overflow-y-auto" data-testid="cal-agent-picker">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-1">
          <span className={EYEBROW}>{g.label}</span>
          {g.agents.map((a) => (
            <button key={a.uid} type="button" role="radio" aria-checked={picked === a.uid} disabled={!a.pickable}
                    onClick={() => onPick(a)} data-testid={`cal-agent-${a.uid}`}
                    className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-left ${picked === a.uid ? 'border-axal-violet dark:border-violet-400' : 'border-axal-hairline dark:border-gray-700'} disabled:cursor-not-allowed disabled:opacity-60`}>
              <AgentMark size={16} />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className={`text-[13px] ${INK}`}>{ROLE_LINE(a) || NOT_RECORDED}</b>
                <span className={`text-[11.5px] ${MUTED}`}>{agentMeta(a)}</span>
              </span>
              <span className={`${CHIP.base} ${CHIP.plain}`}>{a.pickable ? 'Active' : 'Paused'}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * CAL8. `slot` is a drag on a slot or a day ({ start, label }); `target` a record
 * the sheet was opened from ({ kind, id, title }). Both are optional.
 */
export function ScheduleAgentSheet({ slot = null, target = null, zone, onClose, onSaved }) {
  const [list, setList] = useState(null);
  const [agent, setAgent] = useState(null);
  const [skills, setSkills] = useState(null);
  const [form, setForm] = useState(() => ({
    cadence: 'once', run_at: slot?.start || '', time: '08:00', weekday: 'Monday', day_of_month: 1,
    instruction: '', skill_id: '', target, zone,
  }));
  const [est, setEst] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => { let alive = true; sessions.schedulable().then((b) => { if (alive) setList(b); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!agent) return undefined;
    let alive = true;
    setSkills(null); set({ skill_id: '' });
    sessions.agentSkills(agent.uid).then((b) => { if (alive) setSkills(b); });
    return () => { alive = false; };
  }, [agent?.uid]);
  const built = sessionBody({ ...form, agent_uid: agent?.uid });
  const ready = !!built.body;
  useEffect(() => {
    if (!agent || !ready) { setEst(null); return undefined; }
    let alive = true;
    sessions.estimate(agent.uid, built.body).then((b) => { if (alive) setEst(b); });
    return () => { alive = false; };
  }, [agent?.uid, ready, JSON.stringify(built.body || null)]);

  const save = async () => {
    const out = sessionBody({ ...form, agent_uid: agent?.uid });
    if (!out.body) { setProblem(out.problem); return; }
    setProblem(''); setBusy(true);
    try {
      const r = await sessions.schedule(agent.uid, out.body);
      if (!r.available) { setProblem(r.reason || sessionRefusal(r)); return; }
      onSaved?.(r.value);
    } finally { setBusy(false); }
  };

  const title = 'Schedule an AI agent';
  if (!list) {
    return <Lightbox label={title} title={title} onClose={onClose} width={600} phone="full" testId="cal-agent-schedule"><p className={`m-0 px-5 py-6 text-[13px] ${MUTED}`}>Reading…</p></Lightbox>;
  }
  if (!list.available) {
    return (
      <Lightbox label={title} title={title} onClose={onClose} width={600} phone="full" testId="cal-agent-schedule">
        {list.unreadable
          ? <div className="px-5 py-6"><Unreadable what="Your agents" claim="That is not the same as having none." onRetry={() => { setList(null); sessions.schedulable().then(setList); }} /></div>
          : <OffBlock reason={list.reason} company={list.company} team={teamPath(list.scope)} onClose={onClose} testId="cal-agent-schedule-off" />}
      </Lightbox>
    );
  }
  const value = list.value || {};
  if (value.can_schedule === false) {
    return (
      <Lightbox label={title} title={title} onClose={onClose} width={600} phone="full" testId="cal-agent-schedule">
        <div className="flex flex-col gap-3 px-5 py-6" data-testid="cal-agent-schedule-readonly">
          <p className={`m-0 text-[13.5px] font-semibold ${INK}`}>{readOnlyLine(value.company)}</p>
          <button type="button" className={`w-fit ${actionGhost}`} onClick={onClose}>Close</button>
        </div>
      </Lightbox>
    );
  }
  const skillList = skills?.available ? (skills.value?.skills || []) : [];
  const footer = (
    <div className="flex flex-col gap-2">
      <p className={`m-0 text-[12px] ${MUTED}`} data-testid="cal-agent-proposals-line">{PROPOSALS_LINE}</p>
      {problem ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="cal-agent-problem">{problem}</p> : null}
      <span className="flex justify-end gap-2">
        <button type="button" className={actionGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={actionPrimary} onClick={save} disabled={busy || !agent} data-testid="cal-agent-save">{busy ? 'Saving…' : 'Save'}</button>
      </span>
    </div>
  );
  return (
    <Lightbox label={title} title={title} sub={slot?.label ? `From your drag on ${slot.label}` : null} onClose={onClose} width={600} phone="full" footer={footer} testId="cal-agent-schedule">
      <div className="flex flex-col gap-3.5 px-5 py-4">
        <Field label="Agent" hint="Agents of your company, then of each project" testId="cal-agent-field">
          <AgentPicker agents={value.agents} picked={agent?.uid} onPick={setAgent} />
        </Field>
        <Field label="Skill" hint={skills?.available ? skillHint(skillList, agent?.role_name) : null} testId="cal-agent-skill">
          {!agent ? <span className={`text-[12.5px] ${MUTED}`}>Pick an agent first.</span>
            : !skills ? <span className={`text-[12.5px] ${MUTED}`}>Reading…</span>
              : !skills.available ? <span className={`text-[12.5px] ${MUTED}`} data-testid="cal-agent-skill-off">{skills.reason}</span>
                : (
                  <select className={FIELD} value={form.skill_id} onChange={(e) => { const s = skillList.find((x) => String(x.uid) === e.target.value); set({ skill_id: e.target.value, skill_version: s?.pinned_version }); }}>
                    <option value="">Choose a skill</option>
                    {skillList.map((s) => <option key={s.uid} value={s.uid}>{s.name}</option>)}
                  </select>
                )}
        </Field>
        <Field label="Work on" hint="Optional" testId="cal-agent-target">
          {form.target ? (
            <span className={`${CHIP.base} ${CHIP.plain} w-fit`} data-testid="cal-agent-target-chip">
              ▤ {form.target.title || NOT_RECORDED}
              <button type="button" aria-label="Remove the record" className="ml-1" onClick={() => set({ target: null })}>×</button>
            </span>
          ) : <span className={`text-[12.5px] ${MUTED}`}>Choosing a meeting, deal, deck, module or document opens when sessions are switched on.</span>}
        </Field>
        <Field label="Instruction" hint={`${form.instruction.length} / ${INSTRUCTION_MAX.toLocaleString('en-US')}`} testId="cal-agent-instruction">
          <textarea className={`${FIELD} min-h-[72px]`} maxLength={INSTRUCTION_MAX} value={form.instruction} onChange={(e) => set({ instruction: e.target.value })}
                    placeholder="What should it focus on? It is read as a note, never as a command." />
        </Field>
        <fieldset className="flex flex-col gap-2" data-testid="cal-agent-when">
          <legend className={EYEBROW}>When</legend>
          <span className="flex gap-2">
            {[['once', 'Once'], ['repeat', 'Repeat']].map(([k, label]) => {
              const on = k === 'once' ? form.cadence === 'once' : form.cadence !== 'once';
              return <button key={k} type="button" aria-pressed={on} className={on ? actionPrimary : actionGhost} onClick={() => set({ cadence: k === 'once' ? 'once' : (form.cadence === 'once' ? 'weekly' : form.cadence) })} data-testid={`cal-agent-${k}`}>{label}</button>;
            })}
          </span>
          {form.cadence === 'once' ? (
            <input type="datetime-local" className={FIELD} aria-label="Date and time" value={form.run_at} onChange={(e) => set({ run_at: e.target.value })} />
          ) : (
            <span className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select className={FIELD} aria-label="Repeat" value={form.cadence} onChange={(e) => set({ cadence: e.target.value })}>
                {CADENCES.filter(([k]) => k !== 'once').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {form.cadence === 'weekly' ? (
                <select className={FIELD} aria-label="Day" value={form.weekday} onChange={(e) => set({ weekday: e.target.value })}>
                  {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : form.cadence === 'monthly' ? (
                <input type="number" min={1} max={28} className={FIELD} aria-label="Day of the month" value={form.day_of_month} onChange={(e) => set({ day_of_month: e.target.value })} />
              ) : <span />}
              <input type="time" className={FIELD} aria-label="Time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
            </span>
          )}
          {zone ? <span className={`text-[11.5px] ${MUTED}`} data-testid="cal-agent-zone">{zone}</span> : null}
        </fieldset>
        <div className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid="cal-agent-estimate">
          <span className={EYEBROW}>Estimate</span>
          <b className={`text-[13px] ${INK}`}>{est?.available ? estimateLine(est.value) : ready ? (est ? NOT_RECORDED : 'Reading…') : 'Pick an agent, a skill and a time to see the estimate.'}</b>
          {est?.available && capLine(est.value) ? <span className={`text-[12px] ${MUTED}`}>{capLine(est.value)}</span> : null}
          <span className={`text-[11.5px] ${MUTED}`}>{HOLD_LINE}</span>
        </div>
      </div>
    </Lightbox>
  );
}

function Row({ label, children, testId }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1" data-testid={testId}>
      <span className={EYEBROW}>{label}</span>
      <span className={`text-[13px] ${INK}`}>{children}</span>
    </div>
  );
}

/** CAL10 and CAL11, pure on one read, so the test draws every state. */
export function AgentSessionView({ session, onAct, busy = '' }) {
  const s = session || {};
  const skip = skipReason(s);
  const banner = waitingBanner(s);
  const team = teamPath(s.scope);
  const runs = Array.isArray(s.last_runs) ? s.last_runs : [];
  return (
    <div className="flex flex-col" data-testid="cal-agent-session">
      {banner ? (
        <section className="flex flex-wrap items-center gap-2 border-t border-amber-300 bg-amber-50 px-5 py-3 dark:border-amber-700 dark:bg-amber-900/20" data-testid="cal-agent-waiting">
          <span className="flex-1 text-[13px] font-semibold text-amber-900 dark:text-amber-100">{banner.line}</span>
          {team ? <Link to={`${team}?tab=approvals`} className={LINK}>{banner.action}</Link> : null}
        </section>
      ) : null}
      {skip ? (
        <section className={SECTION} data-testid={`cal-agent-skip-${skip.key}`}>
          <span className={EYEBROW}>{skip.title}</span>
          <p className={`m-0 text-[13px] ${INK}`}>{skip.line}</p>
          {skip.actions.length ? (
            <span className="flex flex-wrap gap-2">
              {skip.actions.map((a) => (a.to
                ? <Link key={a.label} to={a.to} className={a.primary ? actionPrimary : LINK}>{a.label}</Link>
                : <button key={a.label} type="button" className={actionGhost} disabled={!!busy || !s.can?.reschedule} onClick={() => onAct?.(a.update ? { key: 'update', version: a.update } : { key: 'pick' })}>{a.label}</button>))}
            </span>
          ) : null}
        </section>
      ) : null}
      <section className={SECTION}>
        <Row label="Skill" testId="cal-agent-row-skill">{s.skill?.name ? `${s.skill.name}${Number.isInteger(s.skill.version) ? ` · v${s.skill.version}` : ''}` : NOT_RECORDED}</Row>
        <Row label="Work on" testId="cal-agent-row-target">
          {s.target?.title ? (s.target.href ? <Link to={s.target.href} className={LINK}>{s.target.title} ›</Link> : s.target.title) : 'Nothing chosen'}
          {s.target?.kind_words ? <span className={MUTED}> · {s.target.kind_words}</span> : null}
        </Row>
        {s.instruction ? <Row label="Instruction" testId="cal-agent-row-instruction"><span className="whitespace-pre-wrap">{s.instruction}</span></Row> : null}
        <Row label="Schedule" testId="cal-agent-row-schedule">{s.schedule_words || repeatLine(s.schedule)}</Row>
        <Row label="Sponsor" testId="cal-agent-row-sponsor">{sponsorLine(s.sponsor)}</Row>
      </section>
      <section className={SECTION} data-testid="cal-agent-runs">
        <span className={EYEBROW}>Last runs</span>
        {!runs.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>{s.cadence === 'once' || s.schedule?.cadence === 'once' ? 'Not run yet. What it makes is proposed to you before it is used.' : 'Not run yet.'}</p>
          : runs.map((r, i) => {
            const row = runRow(r);
            return (
              <div key={r.id || i} className="flex flex-wrap items-center gap-2 py-0.5 text-[12.5px]" data-testid="cal-agent-run">
                <span className={`w-[96px] font-mono ${INK}`}>{row.when}</span>
                <StateChip session={{ state: r.state, proposals_waiting: r.proposals }} testId="cal-agent-run-state" />
                {row.note ? <span className={MUTED}>{row.note}</span> : null}
                <span className={`ml-auto font-mono ${INK}`}>{row.cost}</span>
              </div>
            );
          })}
      </section>
    </div>
  );
}

/** CAL10's footer: the actions the read allows, the Run now hold, or why there are none. */
export function AgentSessionFooter({ session, onAct, busy = '' }) {
  const acts = sessionActions(session);
  if (!acts.length) {
    return session?.can_manage === false
      ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid="cal-agent-readonly">{readOnlyLine(session?.company)}</p>
      : null;
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap gap-2">
        {acts.map((a) => (
          <button key={a.key} type="button" disabled={!!busy} onClick={() => onAct(a)} data-testid={`cal-agent-${a.key}`}
                  className={a.danger ? actionDanger : a.primary ? actionPrimary : actionGhost}>{busy === a.key ? 'Working…' : a.label}</button>
        ))}
      </span>
      {acts.some((a) => a.key === 'run') ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="cal-agent-hold">{runNowLine(session.run_hold_cents)}</p> : null}
    </div>
  );
}

/** `/calendar/item/agent_session/:id`. */
export default function AgentSessionSheet({ id, onClose, onChanged }) {
  const [read, setRead] = useState(null);
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const load = () => { setRead(null); sessions.session(id).then(setRead); };
  useEffect(() => { let alive = true; sessions.session(id).then((b) => { if (alive) setRead(b); }); return () => { alive = false; }; }, [id]);
  const act = async (a) => {
    const call = { run: () => sessions.runNow(id), pause: () => sessions.pause(id), cancel: () => sessions.cancel(id), update: () => sessions.reschedule(id, { skill_version: a.version }) }[a.key];
    if (!call) { setSaid('Rescheduling opens here once sessions are switched on.'); return; }
    setSaid(''); setBusy(a.key);
    try {
      const r = await call();
      if (!r.available) { setSaid(r.reason || sessionRefusal(r)); return; }
      onChanged?.(); load();
    } finally { setBusy(''); }
  };
  const label = 'AI agent session';
  if (!read) return <Sheet label={label} title={label} onClose={onClose} width={560} testId="cal-agent-sheet"><p className={`m-0 px-5 py-6 text-[13px] ${MUTED}`}>Reading…</p></Sheet>;
  if (!read.available) {
    return (
      <Sheet label={label} title={label} onClose={onClose} width={560} testId="cal-agent-sheet">
        {read.unreadable
          ? <div className="px-5 py-6"><Unreadable what="This session" claim="That is not the same as it not existing." onRetry={load} /></div>
          : <OffBlock reason={read.reason} company={read.company} team={teamPath(read.scope)} onClose={onClose} testId="cal-agent-sheet-off" />}
      </Sheet>
    );
  }
  const s = read.value || {};
  const head = (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP.base} ${CHIP.agent}`}><AgentMark /> AI agent</span>
        <StateChip session={s} />
      </span>
      <span className={`text-[12.5px] ${MUTED}`}>{[ROLE_LINE(s.agent), s.schedule_words || repeatLine(s.schedule)].filter(Boolean).join(' · ')}</span>
    </span>
  );
  const footer = (
    <div className="flex flex-col gap-2">
      <AgentSessionFooter session={s} onAct={act} busy={busy} />
      {said ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{said}</p> : null}
    </div>
  );
  return (
    <Sheet label={s.title || label} title={s.title || s.skill?.name || NOT_RECORDED} sub={head} onClose={onClose} width={560} footer={footer} testId="cal-agent-sheet">
      <AgentSessionView session={s} onAct={act} busy={busy} />
    </Sheet>
  );
}
