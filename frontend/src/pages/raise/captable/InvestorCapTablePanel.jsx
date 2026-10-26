/**
 * D1027 (#2864, part 12 of #2432) — the investor's read-only Cap table panel
 * (CT15, CT15o, CT15n), mounted on the deal page's Terms tab (DL10, DL24) and
 * on the investor's company page (`/portfolio/companies/:uid/terms`). The
 * investor never opens the founder's tool in Raise.
 *
 * It reads D1019's `GET /api/captable/access/:projectId` once (the Worker logs
 * the open) and draws exactly what the level returns:
 *   - Investor or Full: the group bar, the positions with the pool as one line
 *     and "Your position" in lavender when the grant names the caller's
 *     holder, the recorded instruments, rounds and pricing or why they are
 *     not recorded, and why the payout at exit values is not shown;
 *   - Own position: the caller's shares and fully diluted %, and the group bar;
 *   - Summary: the group bar and the rounds line;
 *   - not shared (403): CT15n's sentence and "Ask for access", which asks the
 *     founder in an in-page dialog and is answered on their Access tab.
 * A failed read is "could not be read" with Try again, never "not shared".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { capTableAccessApi } from '../../../lib/api/capTableAccess';
import { Unreadable, actionGhost } from '../../../ui';
import { CARD, EYEBROW, INK, MONO, MUTED, Skeleton, TD, Table } from './CapTableTool';
import CapTableDialog, { useWrite } from './CapTableDialog';
import {
  ASK_DIALOG, NO_ACCESS, PAYOUT_NOT_SHARED, READ_ONLY, ROUNDS_NOT_RECORDED, askLine, askOutcome, headerLine, ownLines, panelOf,
} from './investorPanelModel';

const TONE = {
  Founders: 'bg-axal-violet dark:bg-violet-400',
  Investors: 'bg-sky-500 dark:bg-sky-400',
  'Option pool': 'bg-amber-500 dark:bg-amber-400',
  Other: 'bg-gray-400 dark:bg-gray-500',
};
const LAV_ROW = 'bg-axal-lavender dark:bg-violet-950/40';
const MINE_PILL = 'ml-2 inline-flex items-center gap-1 rounded-full border border-axal-lavender-edge bg-white px-2 py-0.5 text-[10.5px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300';

function GroupBar({ bar, testId }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={`${testId}-bar`}>
      <span className={EYEBROW}>Fully diluted by group</span>
      {bar.parts.length ? (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="img"
            aria-label={bar.parts.map((p) => `${p.group} ${p.pct}%`).join(', ')}>
            {bar.parts.map((p) => <span key={p.group} className={`h-full ${TONE[p.group] || TONE.Other}`} style={{ width: `${Math.max(0, Math.min(100, p.pct))}%` }} data-testid={`${testId}-bar-part`} />)}
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px]">
            {bar.parts.map((p) => (
              <li key={p.group} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${TONE[p.group] || TONE.Other}`} />
                <span className={INK}>{p.group}</span><span className={`${MONO} ${MUTED}`}>{p.pct}%</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {bar.reason ? <span className={`text-[12px] ${MUTED}`} data-testid={`${testId}-bar-reason`}>{bar.reason}</span> : null}
    </div>
  );
}

function Positions({ rows, testId }) {
  return (
    <Table testId={`${testId}-positions`} cols={[{ key: 'h', label: 'Holder' }, { key: 'g', label: 'Group' }, { key: 's', label: 'Shares' }, { key: 'p', label: '% fully diluted' }]}
      rows={rows.map((r, i) => (
        <tr key={`${r.holder}-${i}`} className={`border-b border-axal-ground last:border-b-0 dark:border-gray-700 ${r.mine ? LAV_ROW : ''}`} data-testid={r.mine ? `${testId}-mine` : `${testId}-row`}>
          <td className={`${TD} font-bold`}>{r.holder}{r.mine ? <span className={MINE_PILL}>◆ Your position</span> : null}</td>
          <td className={TD}>{r.group}</td><td className={`${TD} ${MONO}`}>{r.shares}</td><td className={`${TD} ${MONO}`}>{r.pct}</td>
        </tr>
      ))} />
  );
}

function NoAccess({ projectId, venture, testId }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(null);
  // A sent ask, or one the Worker already holds, closes the dialog with its line; any other refusal stays in it.
  const w = useWrite((out) => { if (out) { setOutcome(askOutcome(null)); setOpen(false); } });
  const send = () => w.run(async () => {
    try { return await capTableAccessApi.ask(projectId); } catch (e) {
      const o = askOutcome(e);
      if (o.asked || o.reload) { setOutcome(o); setOpen(false); return null; }
      throw e;
    }
  });
  return (
    <div className="flex flex-col items-start gap-2" data-testid={`${testId}-no-access`}>
      <span aria-hidden="true" className={`text-[20px] ${MUTED}`}>⊘</span>
      <p className={`m-0 text-[14px] font-bold ${INK}`}>{NO_ACCESS}</p>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{askLine(venture)}</p>
      {outcome ? <p className={`m-0 text-[12.5px] font-semibold ${INK}`} role="status" data-testid={`${testId}-asked`}>{outcome.line}</p>
        : <button type="button" className={actionGhost} onClick={() => setOpen(true)} data-testid={`${testId}-ask`}>Ask for access</button>}
      {open && (
        <CapTableDialog title={ASK_DIALOG.title} sub={ASK_DIALOG.sub} testId={`${testId}-ask-dialog`} write={w} onClose={() => setOpen(false)}
          action="Ask for access" onAction={send}>
          <p className="m-0">{askLine(venture)}</p>
        </CapTableDialog>
      )}
    </div>
  );
}

export default function InvestorCapTablePanel({ projectId, venture, testId = 'captable-panel' }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [asOf, setAsOf] = useState(null);
  const load = useCallback(() => {
    if (!projectId) return;
    setState({ status: 'loading', data: null });
    capTableAccessApi.view(projectId)
      .then((data) => { setAsOf(new Date()); setState({ status: 'ready', data }); })
      .catch((e) => setState({ status: e?.status === 403 ? 'refused' : 'error', data: null }));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  const p = panelOf(state);
  const title = `Cap table · ${venture || 'this company'}`;
  return (
    <section className={`${CARD} flex flex-col gap-3 px-4 py-3.5`} aria-label={title} data-testid={testId}>
      <header className="flex flex-col gap-0.5">
        <h3 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{title}</h3>
        {state.status === 'ready' ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`${testId}-line`}>{headerLine(state.data, asOf)}</p> : null}
      </header>
      {p.kind === 'loading' && <Skeleton testId={`${testId}-loading`} />}
      {p.kind === 'no_access' && <NoAccess projectId={projectId} venture={venture} testId={testId} />}
      {p.kind === 'unreadable' && <div data-testid={`${testId}-unreadable`}><Unreadable what="The cap table" claim="That is not a claim that it is not shared with you." onRetry={load} /></div>}
      {p.kind === 'none' && <p className={`m-0 text-[13px] ${INK}`} data-testid={`${testId}-none`}>{p.view.reason}</p>}
      {p.kind === 'own' && (
        <div className="flex flex-col gap-3" data-testid={`${testId}-own`}>
          {ownLines(p.view).length
            ? ownLines(p.view).map((l) => <p key={l} className={`m-0 rounded-[10px] px-3 py-2 text-[13px] font-semibold ${INK} ${LAV_ROW}`} data-testid={`${testId}-own-line`}>{l}</p>)
            : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`${testId}-own-none`}>The record names no position for you.</p>}
          <GroupBar bar={p.bar} testId={testId} />
        </div>
      )}
      {p.kind === 'summary' && (
        <div className="flex flex-col gap-3" data-testid={`${testId}-summary`}>
          <GroupBar bar={p.bar} testId={testId} />
          <span className={`text-[13px] ${INK}`}>{p.view.rounds == null ? 'Rounds raised: not recorded.' : `${p.view.rounds} ${p.view.rounds === 1 ? 'round' : 'rounds'} raised.`}</span>
        </div>
      )}
      {(p.kind === 'investor' || p.kind === 'full') && (
        <div className="flex flex-col gap-3" data-testid={`${testId}-${p.kind}`}>
          <GroupBar bar={p.bar} testId={testId} />
          {p.view.rows.length ? <Positions rows={p.view.rows} testId={testId} /> : <span className={`text-[12.5px] ${MUTED}`}>The record holds no positions.</span>}
          {p.kind === 'investor' ? <p className={`m-0 text-[11.5px] ${MUTED}`}>Investor level: the pool is one line, and who holds options is not shown.</p> : null}
          <div className="flex flex-col gap-1" data-testid={`${testId}-rounds`}>
            <span className={EYEBROW}>Rounds and pricing</span>
            {p.view.rounds.length
              ? p.view.rounds.map((r, i) => <span key={i} className={`text-[12.5px] ${INK}`}>{r.name} · {r.price}</span>)
              : <span className={`text-[12.5px] ${MUTED}`}>{ROUNDS_NOT_RECORDED}</span>}
            {p.view.instruments.length
              ? <span className={`text-[12.5px] ${INK}`} data-testid={`${testId}-instruments`}>{p.view.instruments.map((i) => `${i.holder || 'Holder not recorded'} · ${i.type} · ${i.amount}`).join(' · ')}</span>
              : null}
          </div>
          <div className="flex flex-col gap-1" data-testid={`${testId}-payout`}>
            <span className={EYEBROW}>Your payout at the founder’s exit values</span>
            <span className={`text-[12.5px] ${MUTED}`}>{PAYOUT_NOT_SHARED}</span>
          </div>
        </div>
      )}
      {state.status === 'ready' && p.view?.disclosure ? <p className={`m-0 text-[11.5px] ${MUTED}`}>{p.view.disclosure}</p> : null}
      {state.status === 'ready' ? <p className={`m-0 text-[11.5px] ${MUTED}`}>{READ_ONLY}</p> : null}
    </section>
  );
}
