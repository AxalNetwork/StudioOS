/**
 * D9111 (#9111) — HQ › AI agents › Operations › Spend › Agent budgets, built to the landed canvas (D4137-p3, SA15 to
 * SA19, handoff SAB-H) over D8071's routes (`frontend/src/lib/api/aiAgentBudgets.js`).
 *
 *   SA15  one workspace's four ceilings, its agents' four meters each (used / cap, period, share), highest share
 *         first, and the runs halted for budget.
 *   SA16  Edit caps, a side panel (a bottom sheet at 390, SA18B): each cap with its unit, this period's use, who set
 *         it and when; a reason; only the changed fields are sent, and the row takes the Worker's answer. The
 *         platform has no ceiling for an agent's caps, so none is shown here (a departure from the canvas).
 *         Edit ceilings does the same for the workspace's four, where the platform figure is shown and enforced.
 *   SA17  Loading in the table's shape, No cap in words with use still shown, Unavailable (never 0) with Try again,
 *         Saving, Save failed and Above the ceiling in the panel; the sponsor's read-only view and its Refused
 *         state are `SponsorBudget` and `SponsorBudgetCard` in `BudgetParts.jsx`, drawn in Team.
 *   SA18  at 390: one agent per card, the meters stacked, the ceilings two by two, halted runs one tap away.
 *   SA19  dark: every surface carries its dark token; the states keep their words and glyphs.
 *
 * A refusal is worded by `policyRefusal` (`refusals.js`), which already words every budget code. Rules live in
 * `budgetsModel.js`; this file draws them.
 */
import React, { useEffect, useRef, useState } from 'react';
import { DataState, Sheet } from '../../../ui';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import { aiAgentBudgetsApi as budgetsApi } from '../../../lib/api/aiAgentBudgets.js';
import { BTN, CARD, HaltedRuns, Meter, MUTED, SKEL } from './BudgetParts.jsx';
import { policyRefusal, REASON_MAX } from './refusals.js';
import {
  AGENT_CAPS, CEILINGS, METER_WORDS, NOT_RECORDED, agentLabel, agentMeters, agentsOf, canSave, capsForm, ceilingRows, ceilingsForm,
  changedCaps, changedCeilings, haltedRows, periodText, setLine, workspaceKey, workspaceList, workspaceName,
} from './budgetsModel.js';

const BTN_PRIMARY = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-violet-700 px-3 text-[13px] font-semibold text-white hover:bg-violet-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const INPUT = 'min-h-11 w-28 rounded-lg border border-gray-300 bg-white px-2 text-[14px] text-gray-900 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100';

// ── The view switch (SAB-H) ─────────────────────────────────────────────────────────────────────────────────

export const SPEND_VIEWS = Object.freeze([['platform', 'Platform spend'], ['budgets', 'Agent budgets']]);
export function SpendSwitch({ view, onChange }) {
  return (
    <div role="group" aria-label="Spend view" className="inline-flex gap-1 rounded-lg border border-axal-hairline p-1 dark:border-gray-700" data-testid="spend-view-switch">
      {SPEND_VIEWS.map(([key, label]) => (
        <button key={key} type="button" aria-pressed={view === key} onClick={() => onChange(key)} data-testid={`spend-view-${key}`}
          className={`min-h-11 rounded-md px-3 text-[13px] font-semibold ${view === key ? 'bg-violet-50 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' : 'text-gray-700 dark:text-gray-300'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── SA15: ceilings, the agent table, halted runs ────────────────────────────────────────────────────────────

export function Ceilings({ workspace, platform, unavailable = false, phone = false }) {
  const rows = ceilingRows(workspace, platform, { unavailable });
  return (
    <section aria-label="Workspace ceilings" className={CARD} data-testid="budget-ceilings">
      <h3 className="m-0 text-[14px] font-bold">Workspace ceilings · {workspaceName(workspace)}</h3>
      <p className={`m-0 mt-1 text-[12px] ${MUTED}`}>An empty ceiling uses the platform figure from Policies.</p>
      <div className={`mt-3 grid gap-3 ${phone ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-1" data-testid={`ceiling-${r.key}`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>{r.label}</span>
            <Meter m={r.meter} label={r.label} />
            <span className={`text-[11px] ${MUTED}`}>{r.source_words}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const COLUMN_HEAD = (c, period) => (c.per === 'month' ? `${c.column} · ${period}` : `${c.column} · ${c.per}`);

export function AgentTable({ agents, period, onEdit }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Agent budgets">
        <thead>
          <tr className="border-b border-axal-hairline text-left text-[12px] dark:border-gray-700">
            <th className="p-2">Agent</th>
            {AGENT_CAPS.map((c) => <th key={c.key} className="p-2">{COLUMN_HEAD(c, period)}</th>)}
            <th className="p-2"><span className="sr-only">Edit</span></th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agent_uid} className="border-b border-axal-hairline align-top dark:border-gray-800" data-testid={`budget-row-${a.agent_uid}`}>
              <td className="p-2"><span className="font-semibold">{agentLabel(a)}</span><br /><span className={`text-[12px] ${MUTED}`}>{setLine(a)}</span></td>
              {agentMeters(a).map((c) => <td key={c.key} className="p-2"><Meter m={c.meter} label={c.label} /></td>)}
              <td className="p-2 text-right">{onEdit ? <button type="button" className={BTN} onClick={(e) => onEdit(a, e.currentTarget)}>Edit caps</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** SA18: one agent per card, its four meters stacked. */
export function PhoneAgentCard({ agent, onEdit }) {
  return (
    <article className={CARD} data-testid={`budget-card-${agent.agent_uid}`}>
      <h4 className="m-0 text-[15px] font-bold">{agentLabel(agent)}</h4>
      <p className={`m-0 text-[12px] ${MUTED}`}>{setLine(agent)}</p>
      <div className="mt-3 flex flex-col gap-3">
        {agentMeters(agent).map((c) => (
          <div key={c.key} className="flex flex-col gap-1">
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>{c.column} · {c.per === 'month' ? 'this month' : c.per}</span>
            <Meter m={c.meter} label={c.label} />
          </div>
        ))}
      </div>
      {onEdit ? <button type="button" className={`${BTN} mt-3 w-full`} onClick={(e) => onEdit(agent, e.currentTarget)}>Edit caps</button> : null}
    </article>
  );
}

/** SA15 (and SA18 with `phone`): everything the read sends for one workspace. */
export function BudgetsView({ data, workspace, onWorkspace, onEdit, onEditCeilings, onOpenRun, phone = false }) {
  const list = workspaceList(data);
  const ws = list.find((w) => workspaceKey(w) === workspace) || list[0] || null;
  const key = workspaceKey(ws);
  const agents = agentsOf(data, key);
  const period = periodText(agents[0]?.period);
  const halted = haltedRows(data?.halted, data?.agents, key);
  const noCaps = agents.length > 0 && agents.every((a) => AGENT_CAPS.every((c) => a.caps?.[c.key] == null));
  return (
    <div className="flex flex-col gap-4" data-testid={phone ? 'budgets-phone' : 'budgets-desktop'}>
      <div className="flex flex-wrap items-center gap-3">
        {list.length > 1 ? (
          <label className="flex items-center gap-2 text-[13px]">Workspace
            <select className={INPUT.replace('w-28', 'w-auto')} value={key} onChange={(e) => onWorkspace?.(e.target.value)}>
              {list.map((w) => <option key={workspaceKey(w)} value={workspaceKey(w)}>{workspaceName(w)}</option>)}
            </select>
          </label>
        ) : null}
        <span className={`text-[12px] ${MUTED}`}>Period: {period} · sorted by the highest share used</span>
        {ws && onEditCeilings ? <button type="button" className={BTN} onClick={(e) => onEditCeilings(ws, e.currentTarget)}>Edit ceilings</button> : null}
      </div>
      {!ws ? <p className={`m-0 text-[13px] ${MUTED}`}>No agents are on any team, so there are no budgets to show.</p> : (
        <>
          {noCaps ? <p className={`m-0 rounded-lg border border-dashed border-gray-300 p-3 text-[13px] dark:border-gray-600`} data-testid="budgets-no-caps">○ No caps are set for {workspaceName(ws)}’s agents. Usage is still counted. Without a cap an agent stops only at the workspace ceilings and its team’s monthly dollar cap.</p> : null}
          <Ceilings workspace={ws} platform={data?.platform} phone={phone} />
          {phone ? (
            <>
              <a href="#halted-runs" className={`${BTN} justify-between`}>■ {halted.length} run{halted.length === 1 ? '' : 's'} halted for budget <span aria-hidden="true">›</span></a>
              {agents.map((a) => <PhoneAgentCard key={a.agent_uid} agent={a} onEdit={onEdit} />)}
            </>
          ) : (
            <section aria-label="Agent budgets" className={CARD}>
              <h3 className="m-0 text-[14px] font-bold">Agent budgets · {workspaceName(ws)}</h3>
              <p className={`m-0 mt-1 text-[12px] ${MUTED}`}>{agents.length} agent{agents.length === 1 ? '' : 's'} · sorted by the highest share used</p>
              <AgentTable agents={agents} period={period.split(' · ')[0]} onEdit={onEdit} />
            </section>
          )}
          <HaltedRuns rows={halted} onOpen={onOpenRun} />
        </>
      )}
    </div>
  );
}

/** SA17A: Loading, in the table's shape. */
export function LoadingBudgets() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" data-testid="budgets-loading">
      <p role="status" className={`m-0 text-[13px] ${MUTED}`}>◌ Loading budgets and usage</p>
      <div className={`${CARD} grid grid-cols-2 gap-3 lg:grid-cols-4`}>{CEILINGS.map((c) => <div key={c.key} className="flex flex-col gap-2"><div className={`${SKEL} h-3 w-1/2`} /><div className={`${SKEL} h-4 w-3/5`} /><div className={`${SKEL} h-1.5 w-full`} /></div>)}</div>
      <div className={CARD}>{[0, 1, 2].map((i) => <div key={i} className="grid grid-cols-5 gap-3 border-b border-axal-hairline py-3 dark:border-gray-800">{[0, 1, 2, 3, 4].map((j) => <div key={j} className={`${SKEL} h-4`} />)}</div>)}</div>
    </div>
  );
}

/** SA17C: the read failed (503 budget_unreadable). No figure is drawn, none as 0. */
export function UnavailableBudgets({ onRetry }) {
  return (
    <div data-testid="budgets-unavailable">
      <DataState state="unavailable" size="block" as="div" what="The agent budgets" claim="No use or cap is shown, and none is drawn as 0. Caps still apply in runs." onRetry={onRetry} retryLabel="Try again" announce="always" />
    </div>
  );
}

// ── SA16 and SA17F: Edit caps, Edit ceilings ────────────────────────────────────────────────────────────────

function Status({ saving, failed }) {
  if (saving) return <p role="status" className={`m-0 text-[13px] ${MUTED}`} data-testid="budget-saving">◌ Saving…</p>;
  if (failed) return <p role="alert" className="m-0 rounded-lg border border-red-300 bg-red-50 p-2 text-[13px] text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300" data-testid="budget-save-failed">{failed}</p>;
  return null;
}

function ReasonField({ value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold">Reason
      <textarea className={INPUT.replace('min-h-11 w-28', 'min-h-[64px] w-full py-2')} maxLength={REASON_MAX} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="Why are you changing these caps?" />
      <span className={`text-[12px] font-normal ${MUTED}`}>Logged in Audit with your name, the time, and before and after.</span>
    </label>
  );
}

/** "Used 2.45M · 82% of the current 3.00M · ▲ 80% and over", or the cap's state in words. */
const useLine = (m) => (m.kind === 'no_cap' ? `Used ${m.used} · ${METER_WORDS.no_cap}`
  : m.kind === 'not_recorded' ? `Use ${NOT_RECORDED.toLowerCase()} · cap ${m.cap}`
    : `Used ${m.used} · ${m.share}% of the current ${m.cap}${m.kind === 'at_cap' ? ` · ${METER_WORDS.at_cap}` : m.kind === 'near' ? ` · ${METER_WORDS.near}` : ''}`);

/** The panel's body, pure for a test: the four fields with unit, use, who set them and when; a reason; the states. */
export function EditCapsBody({ agent, form, onField, reason, onReason, saving = false, failed = '', problem = null }) {
  const meters = agentMeters(agent);
  return (
    <div className="flex flex-col gap-4" data-testid="edit-caps">
      <Status saving={saving} failed={failed} />
      {meters.map((c) => (
        <div key={c.field} className="flex flex-col gap-1 border-b border-axal-hairline pb-3 dark:border-gray-800">
          <label className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">{c.label}
            <input className={INPUT} inputMode="decimal" value={form[c.field] ?? ''} disabled={saving} aria-invalid={problem?.field === c.field || undefined}
              onChange={(e) => onField(c.field, e.target.value)} placeholder="No cap" />
            <span className={`font-normal ${MUTED}`}>{c.unit}</span>
          </label>
          <span className="text-[12px]">{useLine(c.meter)}</span>
          {problem?.field === c.field ? <span role="alert" className="text-[12px] text-red-700 dark:text-red-400">{problem.message}</span> : null}
          <span className={`text-[12px] ${MUTED}`}>{setLine(agent)}</span>
        </div>
      ))}
      <ReasonField value={reason} onChange={onReason} disabled={saving} />
    </div>
  );
}

function EditCapsPanel({ agent, onClose, onSaved, opener }) {
  const [form, setForm] = useState(() => capsForm(agent.caps));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState('');
  const changes = changedCaps(form, agent.caps);
  const save = async () => {
    if (!canSave(changes, reason)) return;
    setSaving(true); setFailed('');
    try {
      const next = await budgetsApi.setAgentBudget(agent.agent_uid, changes.caps, reason.trim());
      onSaved({ ...agent, ...next });
    } catch (e) {
      setFailed(`Not saved. ${policyRefusal(e)} Your entries are kept.`);
      setSaving(false);
    }
  };
  return (
    <Sheet title={`Edit caps · ${agentLabel(agent)}`} sub={`${workspaceName({ scope_kind: agent.scope_kind, scope_id: agent.scope_id, scope_name: agent.scope_name })} · ${periodText(agent.period)}`}
      width={480} phone="sheet" onClose={onClose} returnFocusTo={opener} testId="edit-caps-sheet"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={onClose} disabled={saving}>Cancel</button><button type="button" className={BTN_PRIMARY} disabled={saving || !canSave(changes, reason)} onClick={save}>{failed ? 'Try again' : 'Save caps'}</button></div>}>
      <EditCapsBody agent={agent} form={form} onField={(k, v) => setForm((f) => ({ ...f, [k]: v }))} reason={reason} onReason={setReason}
        saving={saving} failed={failed} problem={changes.ok ? null : changes} />
    </Sheet>
  );
}

/** SA17F's Above the ceiling belongs here: the workspace's four, each against the platform figure. */
export function EditCeilingsBody({ workspace, platform, form, onField, reason, onReason, saving = false, failed = '', problem = null }) {
  const rows = ceilingRows(workspace, platform);
  return (
    <div className="flex flex-col gap-4" data-testid="edit-ceilings">
      <Status saving={saving} failed={failed} />
      {rows.map((r) => (
        <div key={r.key} className="flex flex-col gap-1 border-b border-axal-hairline pb-3 dark:border-gray-800">
          <label className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">{r.label}
            <input className={INPUT} inputMode="decimal" value={form[r.key] ?? ''} disabled={saving} aria-invalid={problem?.field === r.key || undefined}
              onChange={(e) => onField(r.key, e.target.value)} placeholder="Platform figure" />
            <span className={`font-normal ${MUTED}`}>{r.money ? '$' : r.key === 'agents_cap' ? 'agents' : 'live'}</span>
          </label>
          <span className="text-[12px]">Used {r.meter.used ?? NOT_RECORDED} · platform ceiling {r.platform == null ? 'none' : r.text(r.platform)}</span>
          {problem?.field === r.key ? <span role="alert" className="text-[12px] text-red-700 dark:text-red-400" data-testid={problem.above ? 'above-ceiling' : undefined}>{problem.message}</span> : null}
        </div>
      ))}
      <ReasonField value={reason} onChange={onReason} disabled={saving} />
    </div>
  );
}

function EditCeilingsPanel({ workspace, platform, onClose, onSaved, opener }) {
  const [form, setForm] = useState(() => ceilingsForm(workspace.caps));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState('');
  const changes = changedCeilings(form, workspace.caps, platform);
  const save = async () => {
    if (!canSave(changes, reason)) return;
    setSaving(true); setFailed('');
    try {
      const next = await budgetsApi.setWorkspaceBudget(workspace.scope_kind, workspace.scope_id, changes.caps, reason.trim());
      onSaved({ ...workspace, caps: next.caps }, next.platform);
    } catch (e) {
      setFailed(`Not saved. ${policyRefusal(e)} Your entries are kept.`);
      setSaving(false);
    }
  };
  return (
    <Sheet title={`Edit ceilings · ${workspaceName(workspace)}`} sub="Blank uses the platform figure. The platform figure is edited on Policies." width={480} phone="sheet"
      onClose={onClose} returnFocusTo={opener} testId="edit-ceilings-sheet"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={onClose} disabled={saving}>Cancel</button><button type="button" className={BTN_PRIMARY} disabled={saving || !canSave(changes, reason)} onClick={save}>{failed ? 'Try again' : 'Save ceilings'}</button></div>}>
      <EditCeilingsBody workspace={workspace} platform={platform} form={form} onField={(k, v) => setForm((f) => ({ ...f, [k]: v }))} reason={reason} onReason={setReason}
        saving={saving} failed={failed} problem={changes.ok ? null : changes} />
    </Sheet>
  );
}

// ── The container ───────────────────────────────────────────────────────────────────────────────────────────

/** Spend › Agent budgets. `RunDetail` is Operations › Runs' run detail, passed in so a halted run opens it. */
export default function Budgets({ RunDetail = null }) {
  const phone = usePhoneWidth();
  const [state, setState] = useState({ status: 'loading' });
  const [workspace, setWorkspace] = useState('');
  const [edit, setEdit] = useState(null);
  const [run, setRun] = useState(null);
  const opener = useRef(null);
  const load = () => {
    setState({ status: 'loading' });
    budgetsApi.budgets().then((data) => setState({ status: 'ready', data }), () => setState({ status: 'unavailable' }));
  };
  useEffect(load, []);
  if (state.status === 'loading') return <LoadingBudgets />;
  if (state.status === 'unavailable') return <UnavailableBudgets onRetry={load} />;
  const data = state.data;
  const savedAgent = (row) => {
    setState({ status: 'ready', data: { ...data, agents: data.agents.map((a) => (a.agent_uid === row.agent_uid ? row : a)) } });
    setEdit(null);
  };
  const savedWorkspace = (ws, platform) => {
    setState({ status: 'ready', data: { ...data, platform: platform ?? data.platform, workspaces: data.workspaces.map((w) => (workspaceKey(w) === workspaceKey(ws) ? { ...w, caps: ws.caps } : w)) } });
    setEdit(null);
  };
  return (
    <>
      <BudgetsView data={data} workspace={workspace} onWorkspace={setWorkspace} phone={phone}
        onEdit={(agent, el) => { opener.current = el; setEdit({ agent }); }}
        onEditCeilings={(ws, el) => { opener.current = el; setEdit({ workspace: ws }); }}
        onOpenRun={RunDetail ? setRun : null} />
      {run && RunDetail ? <div className="mt-4"><RunDetail key={run} uid={run} close={() => setRun(null)} /></div> : null}
      {edit?.agent ? <EditCapsPanel agent={edit.agent} opener={opener} onClose={() => setEdit(null)} onSaved={savedAgent} /> : null}
      {edit?.workspace ? <EditCeilingsPanel workspace={edit.workspace} platform={data.platform} opener={opener} onClose={() => setEdit(null)} onSaved={savedWorkspace} /> : null}
    </>
  );
}

