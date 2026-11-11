import React, { useState } from 'react';
import { Sheet } from '../../ui';
import { agentEngineApi } from '../../lib/api/agentEngine.js';
import { reportError } from '../../lib/log';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, FIELD, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { Chip, CouldNotRead, Progress, Reading, Sentence, useEngineRead } from './EngineParts.jsx';
import SuggestAgentsSheet from './SuggestAgentsSheet.jsx';
import {
  COMPANY_GOALS_NOTE, COMPANY_PLAN_OFF, ENGINE_OFF, GOAL_PRIORITIES, GOAL_STAGES, GOAL_STATUSES, GOALS_EMPTY, GOALS_ERROR, GOALS_READER,
  QUOTE_DOWN, acceptBody, goalBody, goalLine, goalRow, planItemLine, quoteLine, quotePaidBy, refusalSentence, spend, taskStatusWord, tasksByModule,
} from './engineModel.js';

/**
 * D1531 (#3742 E8, TM10): a team's goals and an agent's plan for one.
 *
 *   TM10a   the goal list: title, status, parent, target date, progress and
 *           cost to date ("Not recorded", never $0); a reader gets no actions.
 *   TM10a2  New or edit goal, a Sheet at 520; the Worker's refusals
 *           (invalid_goal, parent_not_in_company) are said as sentences.
 *   TM10b   one goal's plan: its tasks grouped by module, each dependency
 *           written "Waits on: [task]".
 *   TM10c   Draft a plan: the quote first ("$0.12 · by Vesta" or "by
 *           Eadwyn"), then the draft; a quote that does not answer leaves
 *           Draft on.
 *   TM10d   the proposal card: untick or retitle an item, Accept N items or
 *           Discard; a decided plan says so.
 *   TM10e   a company goal: the plan chip is off, "Agents plan goals inside
 *           a project."
 *
 * `scope` is 'project' (Work's Goals view) or 'company' (the Team page's
 * Goals section). An engine that is off says ENGINE_OFF and draws no goals.
 */
export default function GoalsView({ scope, id, canManage = false, compact = false, models = null, roles = null, team = [] }) {
  const project = scope === 'project';
  const goals = useEngineRead(() => agentEngineApi.goals(scope, id), [scope, id], 'agent-engine:goals');
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const [suggest, setSuggest] = useState(null);
  const list = Array.isArray(goals.data?.goals) ? goals.data.goals : [];
  const manage = canManage && goals.status === 'ready';

  if (goals.status === 'off') return <HonestBlock testId="goals-off">{ENGINE_OFF}</HonestBlock>;
  return (
    <section className="flex flex-col gap-3" aria-label="Goals" data-testid={`goals-${scope}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Goals</h2>
          {!project ? <p className={`m-0 ${MUTED}`}>{COMPANY_GOALS_NOTE}</p> : null}
        </div>
        {manage ? <button type="button" className={compact ? BTN_SECONDARY : BTN_PRIMARY} onClick={() => setEditing({})} data-testid="goals-new">+ New goal</button> : null}
      </div>
      {goals.status === 'loading' ? <Reading testId="goals-loading" /> : null}
      {goals.status === 'error' || goals.status === 'refused' ? <CouldNotRead text={GOALS_ERROR} onRetry={goals.reload} testId="goals-error" /> : null}
      {goals.status === 'ready' && !list.length ? (
        <div className="flex flex-col items-center gap-2 rounded-axal-lg border border-dashed border-axal-hairline px-6 py-8 text-center dark:border-gray-700" data-testid="goals-empty">
          <b className="text-[14px] text-axal-ink dark:text-gray-100">{GOALS_EMPTY.title}</b>
          <p className={`m-0 max-w-md ${MUTED}`}>{GOALS_EMPTY.body}</p>
        </div>
      ) : null}
      {goals.status === 'ready' && list.length ? (
        <div className="overflow-x-auto rounded-axal-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]" data-testid="goals-table">
            <thead>
              <tr className={EYEBROW}>
                {['Goal', 'Status', 'Parent goal', 'Target date', 'Progress', 'Cost to date', ''].map((h) => <th key={h || 'act'} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const r = goalRow(g);
                return (
                  <tr key={r.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid="goal-row">
                    <td className="px-3 py-2.5">
                      <button type="button" className="text-left font-bold text-axal-ink hover:underline dark:text-gray-100" onClick={() => setOpen(g)} data-testid="goal-open">{r.title}</button>
                    </td>
                    <td className="px-3 py-2.5"><Chip tone={r.tone}>{r.status}</Chip></td>
                    <td className={`px-3 py-2.5 ${MUTED}`}>{r.parent}</td>
                    <td className={`px-3 py-2.5 ${MONO}`}>{r.due}</td>
                    <td className="px-3 py-2.5"><Progress done={r.done} total={r.total} words={r.progress} /></td>
                    <td className={`px-3 py-2.5 ${MONO}`} data-testid="goal-cost">{r.cost}</td>
                    <td className="px-3 py-2.5 text-right">{manage ? <button type="button" className={BTN_TEXT} onClick={() => setEditing(g)} data-testid="goal-edit">Edit goal</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {goals.status === 'ready' && !canManage ? <p className={`m-0 ${MUTED}`} data-testid="goals-reader">{GOALS_READER}</p> : null}

      {editing ? <GoalSheet scope={scope} id={id} goal={editing.uid ? editing : null} goals={list} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); goals.reload(); }} /> : null}
      {open ? (
        <GoalPlanSheet scope={scope} id={id} goal={open} canManage={manage} onClose={() => setOpen(null)} onChanged={goals.reload}
          onEdit={() => { setEditing(open); setOpen(null); }} onSuggest={() => setSuggest(open)} />
      ) : null}
      {suggest ? <SuggestAgentsSheet scope={scope} id={id} goal={suggest} canManage={manage} models={models} roles={roles} team={team} onClose={() => setSuggest(null)} /> : null}
    </section>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{label}</span>
      {children}
      {error ? <span role="alert" className="text-[12.5px] font-semibold text-axal-destructive dark:text-red-300">{error}</span> : hint ? <span className={MUTED}>{hint}</span> : null}
    </label>
  );
}

/** TM10a2: New goal or Edit goal. */
export function GoalSheet({ scope, id, goal = null, goals = [], onClose, onSaved }) {
  const project = scope === 'project';
  const edit = !!goal;
  const [f, setF] = useState(() => ({
    title: goal?.title || '', why: goal?.why || '', metric: goal?.metric || '', target_date: goal?.target_date ? String(goal.target_date).slice(0, 10) : '',
    stage: goal?.stage || '', parent_goal_uid: goal?.parent?.uid || '', priority: goal?.priority || 'normal', status: goal?.status || 'open',
  }));
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const save = async () => {
    const { body, error } = goalBody(f, { project, edit });
    if (error) { setProblem(error); return; }
    setBusy(true); setProblem(null);
    try {
      const r = edit ? await agentEngineApi.updateGoal(goal.uid, body) : await agentEngineApi.createGoal(scope, id, body);
      onSaved?.(r?.goal || null);
    } catch (e) {
      const code = String(e?.data?.code || e?.code || '');
      setProblem({ field: code === 'parent_not_in_company' ? 'parent_goal_uid' : code === 'invalid_goal' && /date/i.test(String(e?.data?.message || '')) ? 'target_date' : null, text: refusalSentence(e, 'The goal was not saved. Try again.') });
      reportError('agent-engine:goal-save', e);
    } finally {
      setBusy(false);
    }
  };
  const err = (k) => (problem?.field === k ? problem.text : null);
  const parents = goals.filter((g) => g.uid !== goal?.uid);
  return (
    <Sheet title={edit ? 'Edit goal' : 'New goal'} width={520} onClose={onClose} testId="goal-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy} data-testid="goal-save">{edit ? 'Save goal' : 'Create goal'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-4">
        <Field label="Title" error={err('title')}><input className={FIELD} value={f.title} onChange={set('title')} maxLength={200} placeholder="What the team is trying to reach" data-testid="goal-title" /></Field>
        <Field label="Why"><input className={FIELD} value={f.why} onChange={set('why')} maxLength={500} placeholder="Why it matters, in one line" /></Field>
        <Field label="Metric"><input className={FIELD} value={f.metric} onChange={set('metric')} maxLength={200} placeholder="What you will count" /></Field>
        <Field label="Target date" error={err('target_date')}><input className={FIELD} value={f.target_date} onChange={set('target_date')} placeholder="YYYY-MM-DD" inputMode="numeric" data-testid="goal-date" /></Field>
        {project ? (
          <Field label="Stage" hint="Projects only.">
            <select className={FIELD} value={f.stage} onChange={set('stage')}><option value="">Choose a stage</option>{GOAL_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
        ) : (
          <Field label="Parent goal" hint="A project inside a company only." error={err('parent_goal_uid')}>
            <select className={FIELD} value={f.parent_goal_uid} onChange={set('parent_goal_uid')}><option value="">None</option>{parents.map((g) => <option key={g.uid} value={g.uid}>{g.title}</option>)}</select>
          </Field>
        )}
        <Field label="Priority">
          <select className={FIELD} value={f.priority} onChange={set('priority')}>{GOAL_PRIORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        {edit ? (
          <Field label="Status">
            <select className={FIELD} value={f.status} onChange={set('status')}>{GOAL_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
        ) : null}
        {problem && !problem.field ? <Sentence testId="goal-refused">{problem.text}</Sentence> : null}
      </div>
    </Sheet>
  );
}

/** TM10b, with TM10c/TM10d beside it: one goal's tasks by module, and its plan. */
export function GoalPlanSheet({ scope, id, goal, canManage, onClose, onChanged, onEdit, onSuggest }) {
  const project = scope === 'project';
  const tasks = useEngineRead(() => agentEngineApi.tasks(scope, id, { goal: goal.uid }), [scope, id, goal.uid], 'agent-engine:goal-tasks');
  const groups = tasksByModule(tasks.data?.tasks);
  return (
    <Sheet title={goal.title || 'Goal'} sub={goalLine(goal)} width={720} onClose={onClose} testId="goal-plan-sheet"
      footer={canManage ? (
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onSuggest} data-testid="goal-suggest">An agent for this goal</button>
          <button type="button" className={BTN_SECONDARY} onClick={onEdit}>Edit goal</button>
        </div>
      ) : null}>
      <div className="flex flex-col gap-4 px-5 py-4">
        {project ? (
          <PlanAsk goal={goal} canManage={canManage} onAccepted={() => { tasks.reload(); onChanged?.(); }} />
        ) : (
          <div className="flex flex-col gap-1.5 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="goal-company-plan">
            <button type="button" className={`${BTN_SECONDARY} self-start`} disabled aria-disabled="true" title={COMPANY_PLAN_OFF}>Draft a plan for this goal · Not available for a company goal</button>
            <p className={`m-0 ${MUTED}`}>{COMPANY_PLAN_OFF}</p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className={`m-0 ${EYEBROW}`}>Plan · tasks by module</p>
          <p className={`m-0 ${MUTED}`}>Each dependency is written as “Waits on”.</p>
        </div>
        {tasks.status === 'loading' ? <Reading /> : null}
        {tasks.status === 'error' || tasks.status === 'refused' ? <CouldNotRead text="This goal’s tasks could not be read." onRetry={tasks.reload} /> : null}
        {tasks.status === 'off' ? <HonestBlock>{ENGINE_OFF}</HonestBlock> : null}
        {tasks.status === 'ready' && !groups.length ? <p className={`m-0 ${MUTED}`} data-testid="goal-no-tasks">No tasks hang off this goal yet.</p> : null}
        {groups.map((g) => (
          <div key={g.module} className="flex flex-col gap-1.5" data-testid="goal-module">
            <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{g.label} <span className={MONO}>· {g.rows.length} task{g.rows.length === 1 ? '' : 's'}</span></p>
            {g.rows.map((t) => (
              <div key={t.uid} className="flex flex-wrap items-center justify-between gap-2 rounded-axal-md border border-axal-hairline px-3 py-2 dark:border-gray-700">
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{t.title}</span>
                  {t.waits.length ? <span className={MUTED} data-testid="goal-waits">Waits on: {t.waits.join(', ')}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className={MUTED}>{t.assignee?.agent ? [t.assignee.agent.first_name, t.assignee.agent.last_name].filter(Boolean).join(' ') || 'An agent' : t.assignee?.person?.name || 'Unassigned'}</span>
                  <Chip tone={t.status === 'done' ? 'pos' : t.status === 'in_progress' || t.status === 'review' ? 'vio' : 'mut'}>{taskStatusWord(t.status)}</Chip>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** TM10c and TM10d: the quote first, then the draft, then the proposal card. */
export function PlanAsk({ goal, canManage, onAccepted }) {
  const quote = useEngineRead(() => agentEngineApi.planQuote(goal.uid), [goal.uid], 'agent-engine:plan-quote');
  const [draft, setDraft] = useState({ status: 'idle' });
  const [kept, setKept] = useState([]);
  const [titles, setTitles] = useState({});
  const by = quote.data?.by || 'eadwyn';
  const agentName = quote.data?.agent?.name || quote.data?.agent?.first_name || null;
  const make = async () => {
    setDraft({ status: 'busy' });
    try {
      const r = await agentEngineApi.draftPlan(goal.uid);
      const items = r?.proposal?.plan?.items || [];
      setKept(items.map(() => true)); setTitles({});
      setDraft({ status: 'ready', proposal: r?.proposal || null });
    } catch (e) {
      setDraft({ status: 'refused', text: refusalSentence(e, 'The plan could not be read, so nothing was created.') });
      reportError('agent-engine:plan-draft', e);
    }
  };
  const proposal = draft.proposal;
  const items = proposal?.plan?.items || [];
  const dropped = proposal?.plan?.dropped || [];
  const n = kept.filter(Boolean).length;
  const accept = async () => {
    if (!n) { setDraft((d) => ({ ...d, said: 'Keep at least one item, or discard the plan.' })); return; }
    setDraft((d) => ({ ...d, busy: true, said: null }));
    try {
      const r = await agentEngineApi.acceptPlan(goal.uid, proposal.uid, acceptBody(items, kept, titles));
      setDraft({ status: 'accepted', count: (r?.tasks || []).length });
      onAccepted?.();
    } catch (e) {
      setDraft((d) => ({ ...d, busy: false, said: refusalSentence(e) }));
      reportError('agent-engine:plan-accept', e);
    }
  };
  if (!canManage) return null;
  const quoteOk = quote.status === 'ready' && quote.data?.quote?.available === true;
  return (
    <div className="flex flex-col gap-2 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="plan-ask">
      <p className={`m-0 ${EYEBROW}`}>Suggested for this goal</p>
      {draft.status === 'idle' || draft.status === 'busy' || draft.status === 'refused' ? (
        <>
          <button type="button" className={`${BTN_SECONDARY} self-start`} onClick={make} disabled={draft.status === 'busy' || quote.status === 'loading'} data-testid="plan-draft">
            {draft.status === 'busy' ? 'Drafting…' : 'Draft a plan for this goal'}
            <span className={`ml-2 ${MONO}`} data-testid="plan-quote">{quote.status === 'loading' ? 'Reading…' : quoteLine(quote.data?.quote, by, agentName)}</span>
          </button>
          <p className={`m-0 ${MUTED}`}>{quoteOk ? quotePaidBy(by, agentName) : quote.status === 'loading' ? '' : QUOTE_DOWN}</p>
          {draft.status === 'refused' ? <Sentence testId="plan-refused">{draft.text}</Sentence> : null}
        </>
      ) : null}
      {draft.status === 'ready' && proposal ? (
        <div className="flex flex-col gap-2" data-testid="plan-card">
          <p className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{proposal.by === 'agent' && agentName ? `${agentName} proposes a plan` : 'Eadwyn proposes a plan'}</p>
          <p className={`m-0 ${MUTED}`}>For “{goal.title}” · {items.length} item{items.length === 1 ? '' : 's'}</p>
          {items.map((it, i) => (
            <div key={i} className="flex items-start gap-2 rounded-axal-md border border-axal-hairline px-2.5 py-2 dark:border-gray-700" data-testid="plan-item">
              <input type="checkbox" checked={!!kept[i]} onChange={() => setKept((k) => k.map((v, j) => (j === i ? !v : v)))} aria-label={`Keep ${it.title}`} className="mt-1" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <input className={`${FIELD} h-8`} value={titles[i] ?? it.title} onChange={(e) => setTitles((t) => ({ ...t, [i]: e.target.value }))} aria-label={`Title of item ${i + 1}`} disabled={!kept[i]} />
                <span className={MUTED}>{it.module ? `${it.module} · ` : ''}{it.suggested_assignee?.person ? 'A person' : it.suggested_assignee?.role_key ? `The ${String(it.suggested_assignee.role_key).replace(/_/g, ' ')} agent` : 'No one yet'} · {planItemLine(it, items)}</span>
              </span>
            </div>
          ))}
          {dropped.length ? <p className={`m-0 ${MUTED}`} data-testid="plan-dropped">{dropped.join(' ')}</p> : null}
          <p className={`m-0 ${MUTED}`}>Untick an item to leave it out, or retitle it, before you accept.</p>
          {draft.said ? <Sentence testId="plan-said">{draft.said}</Sentence> : null}
          <div className="flex gap-2">
            <button type="button" className={BTN_PRIMARY} onClick={accept} disabled={draft.busy || !n} title={!n ? 'Keep at least one item, or discard the plan.' : undefined} data-testid="plan-accept">Accept {n} item{n === 1 ? '' : 's'}</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setDraft({ status: 'idle' })} data-testid="plan-discard">Discard</button>
          </div>
          {spend(proposal.cost) ? <p className={`m-0 ${MONO}`}>Charged {spend(proposal.cost)}</p> : null}
        </div>
      ) : null}
      {draft.status === 'accepted' ? <Sentence tone="ok" testId="plan-accepted">Accepted · {draft.count} task{draft.count === 1 ? '' : 's'} created</Sentence> : null}
    </div>
  );
}
