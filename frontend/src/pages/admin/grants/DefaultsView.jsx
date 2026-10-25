import React, { useMemo, useState } from 'react';
import { programGrantsApi } from '../../../lib/api/programGrants.js';
import { actionGhost } from '../../../ui';
import { DefaultsDialog, ReasonDialog } from './GrantDialogs';
import { defaultsCards } from './grantsModel';

/**
 * D987 (#2778) — GR6: the terms new grants start from, one card per program
 * in catalogue order, from the defaults the grid's read carries (D982). "Can
 * be granted" and Edit defaults each ask for a reason and save with D982's
 * PUT. A program not ready to grant has its switch off and locked; an HQ-only
 * program is HQ's to keep.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const ALERT = 'flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';

function Switch({ on, disabled, onClick, label, testId }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} data-testid={testId}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${on ? 'bg-axal-violet' : 'bg-axal-hairline dark:bg-gray-700'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function DefaultsView({ grid, reload }) {
  const [act, setAct] = useState(null);
  const [done, setDone] = useState('');
  const g = grid.status === 'ready' ? grid.data : null;
  const cards = useMemo(() => (g ? defaultsCards(g.programs, g) : []), [g]);

  return (
    <div className="flex flex-col gap-3.5" data-testid="grants-defaults-view">
      <p className="m-0 rounded-[10px] bg-axal-ground px-3.5 py-2.5 text-[13px] text-axal-ink dark:bg-gray-800 dark:text-gray-100">New grants start from these terms. Grants in force keep their own terms until HQ changes them.</p>
      {done ? <p role="status" className="m-0 rounded-[9px] bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="defaults-done">{done}</p> : null}
      {grid.status === 'loading' && !g ? <span className="font-mono text-[13px] text-axal-muted">Reading…</span> : null}
      {grid.status === 'error' ? (
        <div role="alert" className={ALERT} data-testid="defaults-unreadable">
          <span>Default terms could not be read.</span>
          <button type="button" className={actionGhost} onClick={reload}>Try again</button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const locked = c.kind === 'notready';
          return (
            <section key={c.key} className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4 ${locked ? 'bg-axal-ground dark:bg-gray-800/60' : ''}`} data-testid={`defaults-card-${c.key}`}>
              <span className={EYE}>{c.group}</span>
              <h2 className={H2}>{c.name}</h2>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-axal-ink dark:text-gray-100">Can be granted</span>
                <Switch on={!!c.grantable && !locked} disabled={locked || c.kind === 'hq'} label={`${c.name} can be granted`}
                  onClick={() => setAct({ key: 'switch', card: c })} testId={`defaults-switch-${c.key}`} />
              </div>
              {locked ? <span className={SUB}>{c.locked || 'Not ready to grant'}</span> : null}
              {c.kind === 'hq' ? <span className={SUB}>HQ keeps this program. Studios see ‘Runs at HQ’.</span> : null}
              {!locked && c.rows.length ? (
                <dl className="m-0 flex flex-col gap-1.5">
                  {c.rows.map((r) => (
                    <div key={r.key} className="flex items-baseline justify-between gap-2 text-[13px]" data-testid={`defaults-term-${c.key}-${r.key}`}>
                      <dt className="text-axal-muted dark:text-gray-400">{r.label}</dt>
                      <dd className={`m-0 text-right font-mono ${r.text === 'Not recorded' ? 'text-axal-muted' : 'text-axal-ink dark:text-gray-100'}`}>{r.text}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {!locked && c.kind !== 'hq' && c.rows.length ? (
                <button type="button" className={`${actionGhost} self-start`} onClick={() => setAct({ key: 'edit', card: c })} data-testid={`defaults-edit-${c.key}`}>Edit defaults</button>
              ) : null}
              {c.foot ? <span className={SUB}>{c.foot}</span> : null}
              <span className={SUB}>{c.updated}</span>
            </section>
          );
        })}
      </div>

      {act?.key === 'switch' ? (() => {
        const on = !!act.card.grantable;
        return (
          <ReasonDialog testId="defaults-switch-dialog" title={`${on ? 'Stop granting' : 'Allow granting'} ${act.card.name}?`}
            body={on ? `HQ can no longer grant ${act.card.name} to a studio. Grants in force keep running until HQ ends them.` : `HQ can grant ${act.card.name} to a studio, starting from these terms.`}
            button={on ? 'Stop granting' : 'Allow granting'} danger={on}
            run={(reason) => programGrantsApi.saveDefaults(act.card.key, { grantable: !on, reason })}
            onClose={() => setAct(null)} onDone={() => { setDone(`${act.card.name} ${on ? 'can no longer be granted' : 'can be granted'}.`); setAct(null); reload(); }} />
        );
      })() : null}
      {act?.key === 'edit' ? (
        <DefaultsDialog card={act.card} onClose={() => setAct(null)}
          onDone={() => { setDone(`${act.card.name}’s default terms are saved. New grants start from them.`); setAct(null); reload(); }} />
      ) : null}
    </div>
  );
}
