import React, { useEffect, useState } from 'react';
import { capTableHolderApi } from '../../../lib/api/capTableHolder';
import { cyclesApi } from '../../../lib/api/cycles';
import { Lightbox, Unreadable } from '../../../ui';
import { Tag } from './CapTableTag';
import { filingsOf, holderView } from './overviewModel';

/**
 * D1022 (#2859) — the holder drawer (CT2, with CT2p for people) at
 * `/raise/cap-table/h-<n>`, over Overview. Its positions and issuances come
 * from the record CapTableOverview already read; a person's vesting from the
 * venture's equity plan (D1020) and their 83(b) from Build's company-creation
 * read; what they can see from the access grants (D1019). Each read answers
 * alone. Void is part 10's dialog (#2862), drawn only when `onVoid` is given.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] px-3 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30`;
const AMBER = 'inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';

function useOptional(load, projectId) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(load)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch(() => { if (alive) setState({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function Section({ title, children, testId }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid={testId}>
      <h3 className={`m-0 ${EYEBROW}`}>{title}</h3>
      {children}
    </section>
  );
}

export default function HolderDrawer({ projectId, holderId, record, grants, onClose, onVoid }) {
  const plan = useOptional(() => capTableHolderApi.equityPlan(projectId), projectId);
  const build = useOptional(() => cyclesApi.module('build', projectId, 'company-creation'), projectId);
  const ready = record.status === 'ready';
  const v = ready ? holderView(record.data, holderId, {
    grants: grants.status === 'ready' ? grants.data : null,
    plan: plan.status === 'ready' ? plan.data : null,
    filings: build.status === 'ready' ? filingsOf(build.data) : null,
  }) : null;
  const title = v?.found ? v.name : 'Holder';
  return (
    <Lightbox label={title} eyebrow="Holder" title={title} width={600} onClose={onClose} testId="captable-holder-drawer"
      footer={(
        <div className="flex justify-between gap-2">
          {onVoid && v?.found ? <button type="button" className={DANGER} onClick={() => onVoid(holderId)} data-testid="captable-holder-void">Void an issuance</button> : <span />}
          <button type="button" className={GHOST} onClick={onClose}>Close</button>
        </div>
      )}>
      {record.status === 'loading' ? <p className={`m-0 text-[12.5px] ${MUTED}`} aria-busy="true">Reading…</p>
        : record.status !== 'ready' ? <div data-testid="captable-holder-unreadable"><Unreadable what="This holder" claim="This is not a claim that they hold nothing." onRetry={onClose} /></div>
          : !v.found ? <p className={`m-0 text-[13px] ${INK}`} data-testid="captable-holder-none">Nothing is on record for this holder yet. Their figures in your saved model are Modelled, and are not shown here.</p>
            : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {v.group ? <span className={`rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold ${MUTED} dark:border-gray-700`}>{v.group}</span> : null}
                  <span className={`font-mono text-[11.5px] ${INK}`} data-testid="captable-holder-pct">% fully diluted {v.pctFd}</span>
                  <Tag kind="record" />
                </div>
                <Section title="Positions" testId="captable-holder-positions">
                  {v.positions.length ? v.positions.map((p) => <span key={p.key} className={`text-[12.5px] font-bold ${INK}`}>{p.line}</span>)
                    : <span className={`text-[12.5px] ${MUTED}`}>No shares or options held on record now.</span>}
                </Section>
                <Section title="Issuances" testId="captable-holder-issuances">
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {v.issuances.map((i) => (
                      <li key={i.uid} className="flex flex-col gap-0.5" data-testid="captable-holder-issuance">
                        <span className={`text-[12.5px] ${i.void ? `line-through ${MUTED}` : INK}`}>{i.line}</span>
                        {i.sub ? <span className={`text-[11.5px] ${MUTED}`}>{i.sub}</span> : null}
                        {i.correction ? <span className={`text-[11.5px] ${MUTED}`}>Corrected by an admin: {i.correction}</span> : null}
                        <span className="flex flex-wrap items-center gap-2 text-[11.5px]">
                          <span className={MUTED}>{i.source}</span>
                          {i.document ? <span className={`font-mono ${INK}`} data-testid="captable-holder-document">{i.document}</span> : <span className={AMBER} data-testid="captable-holder-no-document">! No document</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
                {v.person ? (
                  <Section title="Vesting and 83(b)" testId="captable-holder-person">
                    {v.vesting?.status === 'unreadable' ? <div data-testid="captable-holder-vesting-unreadable"><Unreadable what="Vesting" claim="This is not a claim that none is recorded." /></div>
                      : v.vesting.length === 0 ? <span className={`text-[12.5px] ${MUTED}`} data-testid="captable-holder-vesting-none">No vesting schedule is recorded for this venture.</span>
                        : v.vesting.map((g) => (
                          <div key={g.key} className="flex flex-col gap-1" data-testid="captable-holder-vesting">
                            <span className={`font-mono text-[12px] font-semibold ${INK}`}>{g.terms}</span>
                            <span className={`text-[12.5px] ${INK}`}>{g.vested}</span>
                            {g.pct != null ? <span className="block h-2 w-60 overflow-hidden rounded-full border border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800"><span className="block h-full bg-axal-violet" style={{ width: `${Math.min(100, g.pct)}%` }} /></span> : null}
                          </div>
                        ))}
                    {v.election?.status === 'unreadable'
                      ? <div data-testid="captable-holder-83b-unreadable"><Unreadable what="The 83(b)" claim="This is not a claim that none was filed." /></div>
                      : <span className={`text-[12.5px] ${INK}`} data-testid="captable-holder-83b">{v.election.text}</span>}
                  </Section>
                ) : null}
                <Section title="What they can see" testId="captable-holder-access">
                  {v.access.status === 'unreadable'
                    ? <span className={`text-[12.5px] ${MUTED}`} data-testid="captable-holder-access-unreadable">Who sees what could not be read, or is the owner’s and co-founders’ to see. This is not a claim that nothing is shared.</span>
                    : (
                      <>
                        <span className={`text-[12.5px] font-bold ${INK}`} data-testid="captable-holder-level">{v.access.level}</span>
                        {v.access.scope ? <span className={`text-[11.5px] ${MUTED}`}>{v.access.scope}</span> : null}
                      </>
                    )}
                </Section>
              </div>
            )}
    </Lightbox>
  );
}
