/**
 * D9111 (#9111) — the execution-budget pieces both sides draw (D4137-p3): a meter in words (SAB-H), the runs halted
 * for budget, and the sponsor's read-only budget in Team (SA17D) with its Refused state (SA17E). Kept apart from
 * `Budgets.jsx` (the HQ panel) so Team's agent profile carries none of HQ's panel. Rules live in `budgetsModel.js`.
 */
import React, { useEffect, useState } from 'react';
import { DataState } from '../../../ui';
import { teamAgentsApi } from '../../../lib/api/teamAgents.js';
import { agentMeters, haltedRows, periodText, setLine } from './budgetsModel.js';

export const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const BTN = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const SKEL = 'animate-pulse rounded bg-gray-200 dark:bg-gray-800';
const BAR = { at_cap: 'bg-red-600 dark:bg-red-500', near: 'bg-amber-500 dark:bg-amber-400', within: 'bg-violet-600 dark:bg-violet-400' };
const WORD = {
  at_cap: 'font-bold text-red-700 dark:text-red-400', near: 'font-bold text-amber-700 dark:text-amber-300',
  unavailable: 'font-semibold text-red-700 dark:text-red-400', within: MUTED, no_cap: MUTED, not_applicable: MUTED, not_recorded: MUTED,
};

// ── One meter ───────────────────────────────────────────────────────────────────────────────────────────────

export function Meter({ m, label }) {
  const name = m.kind === 'within' || m.kind === 'near' || m.kind === 'at_cap' ? `${label}: ${m.used} of ${m.cap}, ${m.share}%` : `${label}: ${m.word}`;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-meter={m.kind}>
      {m.kind === 'within' || m.kind === 'near' || m.kind === 'at_cap' ? (
        <>
          <span className="text-[13px] tabular-nums text-gray-900 dark:text-gray-100">{m.used} / {m.cap}</span>
          <div role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(m.share, 100)} className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
            <div className={`h-1.5 rounded-full ${BAR[m.kind]}`} style={{ width: `${Math.min(m.share, 100)}%` }} />
          </div>
        </>
      ) : m.kind === 'no_cap' ? (
        <span className="text-[13px] tabular-nums text-gray-900 dark:text-gray-100">{m.used} used</span>
      ) : m.kind === 'not_recorded' ? (
        <span className="text-[13px] text-gray-900 dark:text-gray-100">cap {m.cap}</span>
      ) : m.kind === 'unavailable' && m.cap ? (
        <span className="text-[13px] text-gray-900 dark:text-gray-100">cap {m.cap}</span>
      ) : null}
      <span className={`text-[12px] ${WORD[m.kind]}`} aria-label={m.kind === 'within' || m.kind === 'near' || m.kind === 'at_cap' ? undefined : name}>{m.word}</span>
    </div>
  );
}

export function HaltedRuns({ rows, onOpen, id = 'halted-runs' }) {
  return (
    <section aria-label="Runs halted for budget" className={CARD} id={id} data-testid="halted-runs">
      <h3 className="m-0 text-[14px] font-bold">Runs halted for budget</h3>
      {rows.length ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {rows.map((h) => (
            <li key={h.run_uid} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline pb-2 dark:border-gray-800" data-refusal={h.refusal}>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{h.label}{h.agent ? ` · ${h.agent}` : ''}</span>
                <span className={`block text-[12px] ${MUTED}`}>{h.line} {h.when}. Run <code>{h.run_uid}</code></span>
              </span>
              {onOpen ? <button type="button" className={BTN} onClick={() => onOpen(h.run_uid)}>Open run</button> : null}
            </li>
          ))}
        </ul>
      ) : <p className={`m-0 mt-2 text-[13px] ${MUTED}`}>No run has been halted for budget.</p>}
      <p className={`m-0 mt-2 text-[12px] ${MUTED}`}>A halted run stops at its next step and keeps its step summary. Nothing is retried by itself; the sponsor restarts the task once a cap allows it.</p>
    </section>
  );
}

// ── SA17D and SA17E: the sponsor's view in Team, read only ──────────────────────────────────────────────────

/** SA17D: the four meters and the halted runs, with no edit control. */
export function SponsorBudget({ budget, halted }) {
  const rows = haltedRows(halted);
  return (
    <section aria-label="Budget" className="flex flex-col gap-3" data-testid="sponsor-budget">
      <h3 className="m-0 text-[14px] font-bold">Budget · {periodText(budget?.period)}</h3>
      <p className={`m-0 text-[12px] ${MUTED}`}>Read only. An HQ super admin sets these caps. To ask for a change, write to Support with the agent’s name. {setLine(budget)}.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {agentMeters(budget).map((c) => (
          <div key={c.key} className="flex flex-col gap-1">
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>{c.label}</span>
            <Meter m={c.meter} label={c.label} />
          </div>
        ))}
      </div>
      <HaltedRuns rows={rows} id="sponsor-halted-runs" />
    </section>
  );
}

/** SA17E: the read was refused (not the sponsor, or not this team's agent). No figure, and whether it exists is not said. */
export function RefusedBudget({ notSponsor = false }) {
  return (
    <div data-testid="sponsor-budget-refused">
      <DataState state="refused" size="block" as="div" what="This agent’s budget"
        reason={notSponsor
          ? 'Only the person who sponsors this agent sees its budget. No figure is shown.'
          : 'This is not an agent you sponsor. A sponsor sees the budgets of the agents they sponsor in their own company or project. No figure is shown.'} />
    </div>
  );
}

/** The sponsor's card: reads `agentBudget(uid)` and draws SA17D, Unavailable or Refused. */
export function SponsorBudgetCard({ uid }) {
  const [state, setState] = useState({ status: 'loading' });
  const load = () => {
    setState({ status: 'loading' });
    teamAgentsApi.agentBudget(uid).then(
      (d) => setState({ status: 'ready', data: d }),
      (e) => setState({ status: [403, 404].includes(Number(e?.status)) ? 'refused' : 'unavailable', notSponsor: Number(e?.status) === 403 }),
    );
  };
  useEffect(load, [uid]);
  if (state.status === 'loading') return <div className={`${SKEL} h-24 w-full`} aria-busy="true" data-testid="sponsor-budget-loading" />;
  if (state.status === 'refused') return <RefusedBudget notSponsor={state.notSponsor} />;
  if (state.status === 'unavailable') return <DataState state="unavailable" size="block" as="div" what="This agent’s budget" claim="No use or cap is shown, and none is drawn as 0." onRetry={load} retryLabel="Try again" />;
  return <SponsorBudget budget={state.data?.budget} halted={state.data?.halted} />;
}
