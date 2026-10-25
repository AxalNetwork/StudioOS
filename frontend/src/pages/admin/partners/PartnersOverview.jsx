import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chart, ChartTable, Legend, Unrecorded, actionPrimary } from '../../../ui';
import {
  AGREEMENT_BANNER, EMPTY_LINE, EMPTY_TITLE, NEEDS_YOU_SHOWN, OVERVIEW_STALE, READING, dealTiles, dealsByTypeState,
  invitationTiles, invitationsAtStage, isFirstUse, isStale, overviewAgreement, stageChart, weeklyInvitations, weeklyRedemptions,
} from './partnersDeskModel';
import { AMBER, CARD, Card, EYE, Failed, H2, LINK, SUB, Tile } from './parts';

/**
 * D923 (#2370), completed by D929 (#2725) — Overview (PI1; PI11a on a phone,
 * PI12 in dark). Every tile, Needs-you row and chart comes from part 4's
 * overview read, `GET /api/admin/partners/overview` (D927), which counts
 * every row in D1, so nothing here is capped or fanned out:
 *   · tile row 1: open, lapsed, signed in 90 days, and the median days from
 *     first send to signed;
 *   · tile row 2: active deals and those ending within 30 days, awaiting
 *     signature, referral redemptions in 90 days, and sends that failed;
 *   · Needs you, every row kind the read returns, each with its one action,
 *     seven at a time, "Show all" expanding in place; cards on a phone;
 *   · C1–C4, each a block in D893's states with "View as table". A C1 bar
 *     opens Invitations at its stage, a C3 segment Deals of its type and
 *     state;
 *   · PI9's banner while the Worker's agreement-ready rule says the Partner
 *     Services agreement is not ready, and PI9b's first use (from R1).
 * The doors below are written out (`to="…"`) so the reachability walk finds
 * each one. The Firms row opens Advisors & Partners › Firms (D952).
 */

/** One Needs-you row's action. Each target is a literal door, by kind. */
function RowAction({ row, onResend }) {
  const cls = `${LINK} whitespace-nowrap`;
  // A lapsed or unsent invitation outside the newest 200 opens its record instead of the Resend dialog.
  if ((row.kind === 'Lapsed' || row.kind === 'Not sent') && !row.action.resend) {
    return <Link to={row.action.to} className={cls} data-testid={`partners-needs-${row.key}-go`}>Open invitation</Link>;
  }
  switch (row.kind) {
    case 'Lapsed':
    case 'Not sent':
      return <button type="button" className={cls} onClick={() => onResend(row.action.resend)} data-testid={`partners-needs-${row.key}-go`}>Resend</button>;
    case 'Agreement':
      return <Link to="/admin/contracts?tab=templates" className={cls}>Open in Contracts</Link>;
    case 'Term ending':
      return <Link to={`/admin/partner-invitations/deals/${row.dealId}`} className={cls}>Open deal</Link>;
    case 'Due diligence':
      return <Link to={row.action.to} className={cls} data-testid={`partners-needs-${row.key}-go`}>Open in Due diligence</Link>;
    case 'Firms':
      return <Link to="/admin/advisors-partners/firms" className={cls} data-testid="partners-needs-firms-go">Open Firms</Link>;
    case 'Rev-share':
      return <Link to={row.action.to} className={cls}>Open Referrals</Link>;
    default:
      return null;
  }
}

function NeedsYou({ needs, onResend, onRetry }) {
  const [all, setAll] = useState(false);
  const rows = all ? needs.rows : needs.rows.slice(0, NEEDS_YOU_SHOWN);
  return (
    <Card title="Needs you" meta={needs.settled ? `${needs.rows.length.toLocaleString('en-US')} ${needs.rows.length === 1 ? 'row' : 'rows'}` : 'Reading…'} testId="partners-needs">
      {needs.failed.map((f) => (
        <Failed key={f.key} what={f.what} claim={f.reason || 'What it would add here is not known.'} onRetry={onRetry} testId={`partners-needs-failed-${f.key}`} />
      ))}
      {/* Guard L: a source at its cap says what it covered, so an empty block is never read as "nothing". */}
      {(needs.cover || []).map((c) => <p key={c.key} className={`m-0 ${SUB}`} data-testid={`partners-needs-cover-${c.key}`}>{c.text}</p>)}
      {needs.settled && !needs.rows.length && !needs.failed.length && !(needs.cover || []).length ? (
        <p className={`m-0 ${SUB}`} data-testid="partners-needs-none">Nothing here needs you now.</p>
      ) : null}
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-axal-hairline py-2.5 max-lg:mb-2 max-lg:rounded-[10px] max-lg:border max-lg:px-3 lg:border-t lg:first:border-t-0 dark:border-gray-700" data-testid={`partners-needs-${row.key}`}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={EYE}>{row.kind}</span>
                <span className="text-[13px] leading-snug text-axal-ink dark:text-gray-100">{row.text}</span>
              </span>
              <RowAction row={row} onResend={onResend} />
            </li>
          ))}
        </ul>
      ) : null}
      {needs.rows.length > NEEDS_YOU_SHOWN && !all ? (
        <button type="button" onClick={() => setAll(true)} className={`${LINK} self-start`} data-testid="partners-needs-all">
          {`Showing ${NEEDS_YOU_SHOWN} of ${needs.rows.length.toLocaleString('en-US')} · Show all`}
        </button>
      ) : null}
    </Card>
  );
}

/**
 * One chart block in D893's four states (Tile and Block, `AdminInsights.jsx`):
 * Reading…, could not be read with Try again, Not recorded with its reason,
 * or the chart with its one sentence, "View as table", its legend, what it
 * covers and its foot. A zero is drawn only when the block was read.
 */
export function ChartBlock({ b, onRetry, onSelect, children }) {
  const [table, setTable] = useState(false);
  const ready = b.state === 'ready';
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby={`partners-h-${b.key}`} data-testid={`partners-${b.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id={`partners-h-${b.key}`} className={H2}>{b.title}</h2>
        {ready ? (
          <button type="button" className={LINK} aria-pressed={table} onClick={() => setTable((t) => !t)} data-testid={`partners-${b.key}-table-toggle`}>
            {table ? 'View as chart' : 'View as table'}
          </button>
        ) : null}
      </div>
      {b.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid={`partners-${b.key}-loading`}>{READING}</span> : null}
      {b.state === 'unreadable' ? (
        <div data-testid={`partners-${b.key}-unreadable`}><Failed what={b.title} claim={b.reason} onRetry={onRetry} /></div>
      ) : null}
      {b.state === 'unrecorded' ? (
        <span className="flex flex-col gap-0.5" data-testid={`partners-${b.key}-unrecorded`}>
          <span className="text-[13px]"><Unrecorded reason={b.reason} /></span>
          <span className={SUB}>{b.reason}</span>
        </span>
      ) : null}
      {ready ? (
        <>
          {table
            ? <div data-testid={`partners-${b.key}-table`}><ChartTable chart={b.chart} caption={b.alt} /></div>
            : <div role="img" aria-label={b.alt} data-testid={`partners-${b.key}-chart`}><Chart chart={b.chart} onSelect={onSelect} /></div>}
          {children}
          {b.legend?.length ? <Legend items={b.legend} /> : null}
          {b.lines?.map((l) => <p key={l} className={`m-0 text-[12px] font-semibold ${AMBER}`}>{l}</p>)}
          {b.foot ? <p className="m-0 text-[11.5px] leading-normal text-axal-muted dark:text-gray-400">{b.foot}</p> : null}
        </>
      ) : null}
    </section>
  );
}

/** C1's closed line: Signed · Lapsed · Revoked, each opening Invitations at it. */
function ClosedLine({ closed }) {
  return (
    <p className="m-0 font-mono text-[12px] text-axal-ink dark:text-gray-100" data-testid="partners-c1-closed">
      <span className="font-display font-bold">Closed:</span>
      {closed.map((c, i) => (
        <React.Fragment key={c.key}>
          {i ? ' · ' : ' '}
          <Link to={invitationsAtStage(c.key)} className="underline decoration-dotted underline-offset-2 hover:text-axal-violet dark:hover:text-violet-300" data-testid={`partners-c1-closed-${c.key}`}>
            {`${c.word} ${c.n.toLocaleString('en-US')}`}
          </Link>
        </React.Fragment>
      ))}
    </p>
  );
}

/** C1–C4 in a 2×2 grid; one chart per card on a phone (PI11a). */
function Charts({ reads }) {
  const navigate = useNavigate();
  const c1 = stageChart(reads.overview);
  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2" data-testid="partners-charts">
      <ChartBlock b={c1} onRetry={reads.reload} onSelect={(stage) => navigate(invitationsAtStage(stage))}>
        <ClosedLine closed={c1.closed || []} />
      </ChartBlock>
      <ChartBlock b={weeklyInvitations(reads.overview)} onRetry={reads.reload} />
      <ChartBlock b={dealsByTypeState(reads.overview)} onRetry={reads.reload} onSelect={(row, part) => { if (part.to) navigate(part.to); }} />
      <ChartBlock b={weeklyRedemptions(reads.overview)} onRetry={reads.reload} />
    </div>
  );
}

export default function PartnersOverview({ reads, needs, actions }) {
  const agreement = overviewAgreement(reads.overview);
  const first = isFirstUse(reads.invitations);
  return (
    <div className="flex flex-col gap-3.5" data-testid="partners-overview">
      {agreement?.state === 'not_ready' ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="partners-agreement-banner">
          <span>{AGREEMENT_BANNER}</span>
          <Link to="/admin/contracts?tab=templates" className="font-bold underline">Open in Contracts</Link>
        </div>
      ) : null}

      {first ? (
        <section className={`${CARD} flex flex-col items-center gap-2.5 px-6 py-10 text-center`} data-testid="partners-first-use">
          <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full border border-axal-lavender-edge bg-axal-lavender text-[18px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">+</span>
          <h2 className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">{EMPTY_TITLE}</h2>
          <p className={`m-0 max-w-md ${SUB}`}>{EMPTY_LINE}</p>
          <button type="button" className={actionPrimary} onClick={actions.newInvitation}>New invitation</button>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="partners-tiles-invitations">
            {invitationTiles(reads.overview).map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} />)}
          </div>
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="partners-tiles-deals">
            {dealTiles(reads.overview).map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} />)}
          </div>
          {isStale(reads.overview) ? (
            <p className={`m-0 text-[12px] font-semibold ${AMBER}`} data-testid="partners-overview-stale">{OVERVIEW_STALE}</p>
          ) : null}
        </>
      )}

      <NeedsYou needs={needs} onResend={actions.resend} onRetry={reads.reload} />

      {first ? null : <Charts reads={reads} />}
    </div>
  );
}
