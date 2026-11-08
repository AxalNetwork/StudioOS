// D4808 (#4808) — a proposal's review, before Decide: `/admin/programs/proposals/:uid`. A Super Admin reads every material
// field the studio submitted (the same rows the approved program page shows, from `specRows`), with what each becomes and
// which are not operational, then decides here. The queue's rows lead to this page; the decision dialog opens from it.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { programProposalsApi } from '../../../lib/api/programProposals';
import AdminBoardFrame from '../AdminBoardFrame';
import DecideDialog from './DecideDialog';
import { ProposalPill } from './ProposalTables';
import { BlockFailed, CARD, Done, H2, LINK, Pill, SUB, Skeleton } from './parts';
import { ONLY_HQ, YOURS_UNDER_PROGRAMS, dayLabel } from './proposalsModel';
import { NOT_OPERATIONAL_WORD, NOT_SET, decidedProgramHref, notOperationalLine, specRows } from './genericProgramModel';

const DT = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:opacity-90 dark:bg-violet-600';

function useProposal(uid, enabled) {
  const [read, setRead] = useState({ state: 'loading', proposal: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setRead((r) => ({ state: 'loading', proposal: r.proposal }));
    programProposalsApi.one(uid).then(
      (d) => { if (live) setRead({ state: 'ready', proposal: d?.proposal || null }); },
      (e) => { if (live) setRead({ state: Number(e?.status) === 404 ? 'unknown' : 'unreadable', proposal: null }); },
    );
    return () => { live = false; };
  }, [uid, tick, enabled]);
  return { ...read, set: (proposal) => setRead({ state: 'ready', proposal }), reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Every field, as the studio submitted it. The foot says what nothing enforces. */
export function ProposalSpec({ proposal }) {
  const rows = specRows(proposal);
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="proposal-review-spec">
      <h2 className={H2}>What the studio submitted</h2>
      <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className="flex min-w-0 flex-col gap-0.5" data-testid={`proposal-review-${r.key}`}>
            <dt className={DT}>{r.label}</dt>
            <dd className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100">
              {r.value === null ? <span className="text-axal-muted dark:text-gray-400">{NOT_SET}</span> : <span className="whitespace-pre-line">{r.value}</span>}
              {!r.operational && r.value !== null ? <span className="ml-2"><Pill tone="muted">{NOT_OPERATIONAL_WORD}</Pill></span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className={`m-0 ${SUB}`} data-testid="proposal-review-foot">{notOperationalLine(null)}</p>
    </section>
  );
}

function ReviewBody() {
  const { uid } = useParams();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const one = useProposal(uid, superAdmin);
  const [deciding, setDeciding] = useState(false);
  const [decided, setDecided] = useState(null);

  if (!superAdmin) {
    return (
      <div className="mx-auto mt-24 flex max-w-[520px] flex-col items-center gap-2 px-4 text-center" data-testid="proposal-review-only-hq">
        <h1 className="m-0 text-[20px] font-extrabold text-axal-ink dark:text-gray-100">{ONLY_HQ}</h1>
        <p className={`m-0 ${SUB}`}>{YOURS_UNDER_PROGRAMS}</p>
        <Link to="/admin/programs" className={PRIMARY}>Back to Programs</Link>
      </div>
    );
  }
  const p = decided || one.proposal;
  const programHref = decidedProgramHref(p);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="proposal-review">
      <nav aria-label="Breadcrumb" className="font-mono text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">
        <Link to="/admin/programs" className="hover:text-axal-violet">Programs</Link>{' › '}
        <Link to="/admin/programs/proposals" className="hover:text-axal-violet" data-testid="proposal-review-back">Proposals</Link>{' › Review'}
      </nav>
      {one.state === 'loading' && !p ? <Skeleton lines={5} testId="proposal-review-loading" /> : null}
      {one.state === 'unknown' ? <p className={`m-0 ${SUB}`} data-testid="proposal-review-unknown">No proposal has that uid.</p> : null}
      {one.state === 'unreadable' ? <BlockFailed what="This proposal" onRetry={one.reload} testId="proposal-review-failed" /> : null}
      {p ? (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{p.name || 'Untitled proposal'}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <ProposalPill status={p.status} testId="proposal-review-status" />
                <span className={SUB} data-testid="proposal-review-sent">{p.sent_at ? `Sent ${dayLabel(p.sent_at)}${p.studio ? ` by ${p.studio}` : ''}` : 'Not sent'}</span>
              </div>
            </div>
            {p.status === 'sent' ? (
              <button type="button" className={PRIMARY} onClick={() => setDeciding(true)} data-testid="proposal-review-decide">Decide</button>
            ) : null}
          </header>
          {decided ? (
            <Done testId="proposal-review-decided">
              {`Decision recorded: ${decided.status.replace('_', ' ')}.`}
              {decided.program_key ? <> <Link to={`/admin/programs/${decided.program_key}`} className="font-bold underline" data-testid="proposal-review-open-program">Open program</Link></> : null}
            </Done>
          ) : null}
          {p.hq_note ? <p className={`m-0 ${SUB}`} data-testid="proposal-review-note">{`HQ’s note: ${p.hq_note}`}</p> : null}
          <ProposalSpec proposal={p} />
          {p.status === 'approved' && programHref && !decided ? (
            <p className={`m-0 ${SUB}`}><Link to={`/admin/programs/${p.program_key}`} className={LINK} data-testid="proposal-review-program">Open the program this made</Link></p>
          ) : null}
        </>
      ) : null}
      {deciding && p ? (
        <DecideDialog proposal={p} onClose={() => setDeciding(false)} onDecided={(next) => { setDeciding(false); if (next) setDecided(next); else one.reload(); }} />
      ) : null}
    </div>
  );
}

export default function ProposalReviewPage() {
  return (
    <AdminBoardFrame workspace="Programs" note="Nothing on this page changes until you decide the proposal." data-testid="admin-board-proposal-review">
      <ReviewBody />
    </AdminBoardFrame>
  );
}
