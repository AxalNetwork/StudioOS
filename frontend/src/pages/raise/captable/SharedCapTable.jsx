import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { capTableAccessApi } from '../../../lib/api/capTableAccess';
import { Unreadable, actionGhost } from '../../../ui';
import { CARD, INK, MONO, MUTED, EYEBROW, Section, Skeleton, TD, Table } from './CapTableTool';
import CapTableDialog, { useWrite } from './CapTableDialog';
import { SUPPORT_REASON, logRows, sharedLine, sharedView, supportProblem } from './capTableAccess';

/**
 * D1026 (#2863) — a cap table read through D1019's levels, for everyone but
 * its founders:
 *   - CT17a, an Advisor: the Summary, or the level the founder granted;
 *   - CT17b, an Operating Partner: the level granted, read only;
 *   - CT18a/b, an Admin: the group summary, then "Open for support…" asks a
 *     reason and shows the full table read only, with the line the founder
 *     also reads in their log;
 *   - CT18c, the Super Admin: the full table read only, and the access log
 *     across companies;
 *   - the venture link (`/share/captable/venture/:token`), at the link's level.
 * Who reads at which level is the Worker's (`resolveAccess`): the page draws
 * the `via` and `level` it answers, never a role it guessed.
 */

const PILL = 'inline-flex w-fit items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';
const LAVENDER = 'rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200';

/** One view at its level, from `sharedView`. */
export function SharedViewBody({ read, testId = 'shared-view' }) {
  const v = sharedView(read);
  if (v.kind === 'none') return <p className={`m-0 text-[13px] ${INK}`} data-testid={`${testId}-none`}>{v.reason}</p>;
  const split = (
    <div className="flex flex-col gap-1.5" data-testid={`${testId}-split`}>
      <span className={EYEBROW}>By group</span>
      {v.split?.length
        ? v.split.map((g) => <div key={g.group} className="flex justify-between text-[13px]"><span className={INK}>{g.group}</span><span className={`${MONO} ${INK}`}>{g.pct}</span></div>)
        : <span className={`text-[12.5px] ${MUTED}`}>No split could be worked out from the saved model.</span>}
    </div>
  );
  const ledger = (rows) => (
    <Table testId={`${testId}-positions`} cols={[{ key: 'h', label: 'Holder' }, { key: 'g', label: 'Group' }, { key: 's', label: 'Shares' }, { key: 'p', label: '% fully diluted' }]}
      rows={rows.map((r, i) => (
        <tr key={`${r.holder}-${i}`} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid={`${testId}-row`}>
          <td className={`${TD} font-bold`}>{r.holder}</td><td className={TD}>{r.group}</td><td className={`${TD} ${MONO}`}>{r.shares}</td><td className={`${TD} ${MONO}`}>{r.pct}</td>
        </tr>
      ))} />
  );
  return (
    <div className="flex flex-col gap-3" data-testid={`${testId}-${v.kind}`}>
      {read?.source_note ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid={`${testId}-source`}>{read.source_note}</p> : null}
      {v.kind === 'summary' ? (
        <>
          {split}
          <span className={`text-[13px] ${INK}`} data-testid={`${testId}-rounds`}>{v.rounds == null ? 'Rounds raised: not recorded.' : `${v.rounds} ${v.rounds === 1 ? 'round' : 'rounds'} raised.`}</span>
        </>
      ) : v.kind === 'own' ? (
        <>
          {v.rows.length ? ledger(v.rows) : <span className={`text-[12.5px] ${MUTED}`} data-testid={`${testId}-own-none`}>The saved model names no position for {v.holder}.</span>}
          {v.instruments.length ? <span className={`text-[12.5px] ${INK}`}>{v.instruments.map((i) => `${i.type} · ${i.basis} · signed ${i.signed}`).join(' · ')}</span> : null}
          {split}
        </>
      ) : (
        <>
          {v.rows.length ? ledger(v.rows) : <span className={`text-[12.5px] ${MUTED}`}>The saved model holds no positions.</span>}
          {v.rounds.length ? (
            <div className="flex flex-col gap-1" data-testid={`${testId}-round-list`}>
              <span className={EYEBROW}>Rounds and pricing</span>
              {v.rounds.map((r, i) => <span key={i} className={`text-[12.5px] ${INK}`}>{r.name} · {r.price}</span>)}
            </div>
          ) : null}
        </>
      )}
      {v.disclosure ? <p className={`m-0 text-[11.5px] ${MUTED}`}>{v.disclosure}</p> : null}
    </div>
  );
}

function HqLog() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    setState({ status: 'loading', data: null });
    capTableAccessApi.hqLog().then((data) => setState({ status: 'ready', data })).catch((e) => setState({ status: 'error', data: null, message: e?.message }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const rows = state.status === 'ready' ? logRows(state.data) : [];
  return (
    <Section title="Access log · every company" testId="captable-hq-log">
      {state.status === 'loading' ? <Skeleton testId="captable-hq-log-loading" /> : state.status === 'error'
        ? <Unreadable what="The access log" claim="This is not a claim that nobody opened a cap table." onRetry={load} />
        : rows.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No cap table has been opened yet.</p> : (
          <Table testId="captable-hq-log-table" cols={[{ key: 'w', label: 'When' }, { key: 'c', label: 'Company' }, { key: 'p', label: 'Who' }, { key: 'x', label: 'What' }]}
            rows={rows.map((r) => (
              <tr key={r.id} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-hq-log-row">
                <td className={`${TD} ${MONO}`}>{r.when}</td><td className={TD}>{r.venture}</td><td className={TD}>{r.who}</td><td className={TD}>{r.what}</td>
              </tr>
            ))} />
        )}
      <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`}>No IP address is kept.</p>
    </Section>
  );
}

function SupportDialog({ projectId, onClose, onOpened }) {
  const [reason, setReason] = useState('');
  const w = useWrite(onOpened);
  const problem = supportProblem(reason);
  return (
    <CapTableDialog title="Open for support" testId="captable-support-dialog" write={w} onClose={onClose} action="Open read only" disabled={!!problem}
      sub="The founder sees your reason in their access log. The table opens read only; a correction goes through the record’s correction, with its own reason."
      onAction={() => w.run(() => capTableAccessApi.support(projectId, reason.trim()))}>
      <label className="flex flex-col gap-1.5">
        <span className={EYEBROW}>Reason the founder will see · required</span>
        <textarea className="min-h-[72px] rounded-[8px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900" maxLength={SUPPORT_REASON.max}
          value={reason} onChange={(e) => setReason(e.target.value)} data-testid="captable-support-reason" />
      </label>
      {problem && reason ? <span className={`text-[12px] ${MUTED}`} data-testid="captable-support-problem">{problem}</span> : null}
    </CapTableDialog>
  );
}

function Frame({ title, line, pills, aside, children, testId }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={testId}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${INK}`}>{title}</h1>
          {line ? <p className={`m-0 text-[13px] ${MUTED}`} data-testid={`${testId}-line`}>{line}</p> : null}
          {pills}
        </div>
        {aside}
      </header>
      {children}
    </div>
  );
}

/** `/cap-tables/:projectId` — the read for an Advisor, an Operating Partner, an Admin and the Super Admin. */
export function CapTableReadPage() {
  const { projectId } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null });
  const [support, setSupport] = useState(null);
  const [asking, setAsking] = useState(false);
  const load = useCallback(() => {
    setState({ status: 'loading', data: null }); setSupport(null);
    capTableAccessApi.view(projectId)
      .then((data) => setState({ status: 'ready', data }))
      .catch((e) => setState({ status: [403, 404].includes(e?.status) ? 'refused' : 'error', data: null, message: e?.message || '' }));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  const read = support || state.data;
  if (state.status === 'loading') return <Frame title="Cap table" testId="captable-read"><Skeleton testId="captable-read-loading" /></Frame>;
  if (state.status === 'refused') return <Frame title="Cap table" testId="captable-read"><p className={`m-0 text-[13px] ${INK}`} data-testid="captable-read-refused">{state.message || 'The founder has not shared the cap table with you.'}</p></Frame>;
  if (state.status === 'error') return <Frame title="Cap table" testId="captable-read"><Unreadable what="This cap table" claim="This is not a claim that it is empty." onRetry={load} /></Frame>;
  const via = read?.via;
  const readOnly = <span className={PILL} data-testid="captable-read-only">Read only</span>;
  return (
    <Frame title="Cap table" testId="captable-read" line={sharedLine(read)} pills={read?.read_only !== false ? readOnly : null}
      aside={via === 'studio' && !support
        ? <button type="button" className={actionGhost} onClick={() => setAsking(true)} data-testid="captable-support-open">Open for support…</button>
        : null}>
      {support ? <p className={`m-0 ${LAVENDER}`} data-testid="captable-support-line">You are viewing this cap table as a studio admin, for: ‘{support.reason}’. The founder sees why, and each correction.</p> : null}
      {via === 'studio' && !support ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-support-note">{read.support || 'Open for support asks for a reason first. The founder sees it.'}</p> : null}
      <section className={`${CARD} px-4 py-3`}><SharedViewBody read={read} testId="captable-read-view" /></section>
      {via === 'grant' || via === 'member' ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="captable-read-scenarios">Scenarios stay the founder’s: a shared level shows the saved model, not its drafts.</p> : null}
      {via === 'hq' ? <HqLog /> : null}
      {asking ? <SupportDialog projectId={projectId} onClose={() => setAsking(false)} onOpened={(out) => { setAsking(false); if (out) setSupport(out); }} /> : null}
    </Frame>
  );
}

/** `/share/captable/venture/:token` — a venture link, at its level (D1019 §6). Public. */
export function VentureSharePage() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    capTableAccessApi.shared(token)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((e) => { if (alive) setState({ status: [403, 410].includes(e?.status) ? 'refused' : 'error', data: null, message: e?.message || '' }); });
    return () => { alive = false; };
  }, [token]);
  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 py-8">
      <Frame title="Cap table" testId="captable-venture-share" line={state.status === 'ready' ? sharedLine({ ...state.data, via: 'link' }) : null}>
        {state.status === 'loading' ? <Skeleton testId="captable-venture-share-loading" />
          : state.status === 'refused' ? <p className={`m-0 text-[13px] ${INK}`} data-testid="captable-venture-share-refused">{state.message || 'This link is not valid.'}</p>
            : state.status === 'error' ? <Unreadable what="This shared cap table" claim="This is not a claim that it is empty." onRetry={() => window.location.reload()} />
              : <section className={`${CARD} px-4 py-3`}><SharedViewBody read={state.data} testId="captable-venture-share-view" /></section>}
        <Link to="/" className={`text-[12px] ${MUTED}`}>StudioOS</Link>
      </Frame>
    </main>
  );
}
