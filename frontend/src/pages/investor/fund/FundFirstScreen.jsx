// D6130 part 2 (#6130): the workspace's first screen, by standing — canvas
// `Axal VC Fund v2 and LP Workspace`, boards VF-01 (visitor), VF-02 and VF-02B
// (applicant), VF-03 (approved, nothing committed), VF-04 (committed), VF-05
// (full rights), VF-15 (position unreadable), VF-16A (phone) and VF-18 (dark).
// A committed reader sees What is due, What to sign and What arrived first,
// never the sales page. The values come from `lib/fundFirstScreenModel.js`.
import React from 'react';
import { Link } from 'react-router-dom';
import { DataState, StateChip } from '../../../ui';
import { TIERS } from '../../../lib/spinoutFundModel';
import { emailHref } from '../../email/emailModel.js';
import { formatCents } from '../fundCallsModel';
import { arrivedItems, commitmentFigures, dayLabel, dueLines, signItems } from '../../../lib/fundFirstScreenModel';
import { CARD, LBL, MONO, GATE } from './FundWorkspaceSupport';

const BLK = `${CARD} flex min-w-0 flex-col gap-2.5 p-4`;
const H2 = 'flex flex-wrap items-baseline gap-2 text-[14.5px] font-extrabold text-gray-900 dark:text-gray-100';
const COUNT = `${MONO} text-[11px] font-semibold text-gray-500 dark:text-gray-400`;
const SUB = `${MONO} mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400`;
const CAP = 'text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400';
const LI = 'grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-gray-100 py-2.5 first:border-t-0 dark:border-gray-800';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-[12.5px] font-bold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN_P = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-violet-600 px-4 text-[13px] font-bold text-white sm:w-auto dark:bg-violet-500';
const BAN = {
  violet: 'border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30',
  green: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30',
  amber: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  gray: 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60',
};
// A word and a glyph for each state: colour never carries the meaning alone.
const PILL = {
  due: ['◔', 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'],
  overdue: ['▲', 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'],
  part_received: ['◑', 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'],
  pending: ['◔', 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'],
  ok: ['✓', 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'],
  none: ['○', 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'],
};

export function Pill({ tone, children }) {
  const [glyph, cls] = PILL[tone] || PILL.none;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-bold ${cls}`} data-tone={tone}>
      <span aria-hidden="true">{glyph}</span>{children}
    </span>
  );
}

const money = (cents) => formatCents(cents);
const callName = (l) => (l.call_number ? `Capital call #${l.call_number}` : 'Capital call (no number recorded)');
const tierOf = (cents) => [...TIERS].reverse().find((t) => cents != null && cents >= t.amountK * 100_000) || null;

function Banner({ tone = 'violet', title, children, action, testId }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3.5 sm:flex-row sm:items-start ${BAN[tone]}`} data-testid={testId}>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold text-gray-900 dark:text-gray-100">{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">{children}</div>
      </div>
      {action}
    </div>
  );
}

/** What is due (VF-04 `dueBlk`): the soonest open line, with its wire facts; the rest are counted. */
export function DueBlock({ portal, today, onRetry }) {
  const due = dueLines(portal, today);
  const [first, ...rest] = due.lines;
  return (
    <section aria-label="What is due" className={`${BLK} ${first ? 'border-l-[3px] border-l-violet-600 dark:border-l-violet-400' : ''}`} data-testid="first-due">
      <h3 className={H2}>What is due {due.known && <span className={COUNT}>{due.lines.length ? `${due.lines.length} open line${due.lines.length === 1 ? '' : 's'}` : 'nothing open'}</span>}</h3>
      {!due.known ? (
        <DataState state="unavailable" size="block" what="Your capital calls" claim="This is not “nothing due”." onRetry={onRetry} retryLabel="Try again" data-testid="first-due-unreadable" />
      ) : !first ? (
        <DataState state="none" size="block">No capital call is open. Nothing is due.</DataState>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <b className="text-[13px] text-gray-900 dark:text-gray-100">{callName(first)}</b>
              <div className={`${MONO} text-[24px] font-bold tracking-tight text-gray-900 dark:text-gray-100`}>{money(first.owed_cents) ?? <DataState state="not_recorded" reason="No amount is recorded on this line." />}</div>
              <span className={SUB}>owed · received to date {money(first.received_cents)}</span>
            </div>
            <Pill tone={first.state === 'pending' ? 'due' : first.state}>{first.word}</Pill>
          </div>
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-gray-500 dark:text-gray-400">Issued</dt><dd className={`${MONO} text-gray-900 dark:text-gray-100`}>{dayLabel(first.issued_on) ?? <DataState state="not_recorded" />}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Due</dt><dd className={`${MONO} text-gray-900 dark:text-gray-100`}>{dayLabel(first.due_date) ?? <DataState state="not_recorded">No due date recorded</DataState>}</dd>
            {first.pay_instructions?.available && <>
              <dt className="text-gray-500 dark:text-gray-400">Account</dt><dd className={`${MONO} text-gray-900 dark:text-gray-100`}>{[first.pay_instructions.bank_name, first.pay_instructions.account_masked].filter(Boolean).join(' · ')}</dd>
              <dt className="text-gray-500 dark:text-gray-400">Reference</dt><dd className={`${MONO} text-gray-900 dark:text-gray-100`}>{first.pay_instructions.reference}</dd>
            </>}
            <dt className="text-gray-500 dark:text-gray-400">Purpose</dt><dd><DataState state="not_recorded" reason="Not on your read yet." /></dd>
          </dl>
          {first.pay_instructions && !first.pay_instructions.available && (
            <p className="text-[12px] text-amber-800 dark:text-amber-300" data-testid="first-due-no-wire">Wire details unavailable. {first.pay_instructions.message || 'Payment instructions for this fund are not configured yet.'}</p>
          )}
          <a href="#my-commitment" className={BTN_P} data-testid="first-due-wire">Wire details for {first.call_number ? `call #${first.call_number}` : 'this call'}</a>
          <span className={CAP}>Wire details open in My commitment, behind a phone check. Nothing is paid from the platform.{rest.length ? ` ${rest.length} more open line${rest.length === 1 ? '' : 's'} there.` : ''}</span>
        </>
      )}
    </section>
  );
}

/** What to sign (VF-04 `signBlk`, VF-03 "To sign"). */
export function SignBlock({ booklet, holdings, onRetry, title = 'What to sign' }) {
  const s = signItems({ booklet, holdings });
  return (
    <section aria-label={title} className={BLK} data-testid="first-sign">
      <h3 className={H2}>{title} {(s.left > 0 || s.complete) && <span className={COUNT}>{s.left ? `${s.left} left` : 'nothing left'}</span>}</h3>
      <ul>
        {s.items.map((i) => (
          <li key={i.key} className={LI}>
            <div className="min-w-0">
              <b className="text-[13px] text-gray-900 dark:text-gray-100">{i.title}</b>
              <small className={SUB}>{i.sub}</small>
              {i.href && <a href={i.href} className="mt-1 inline-flex min-h-[32px] items-center text-[12.5px] font-bold text-violet-700 dark:text-violet-300">{i.action} →</a>}
            </div>
            {i.tone === 'unavailable'
              ? <span className="flex flex-col items-end gap-1"><StateChip kind="unavailable" />{onRetry && <button type="button" onClick={onRetry} className="text-[12px] font-bold underline text-gray-700 dark:text-gray-300">Try again</button>}</span>
              : <Pill tone={i.tone}>{i.word}</Pill>}
          </li>
        ))}
        {s.loading && <li className={LI}><span className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true" /></li>}
      </ul>
      {s.complete && !s.left && <p className={CAP}>Nothing waits for your signature. New documents to sign appear here first.</p>}
    </section>
  );
}

/** What arrived (VF-04 `arrBlk`): the latest three, dated; a source not read is named. */
export function ArrivedBlock({ portal, notices, onRetryNotices, onRetryPortal }) {
  const a = arrivedItems({ portal, notices });
  const retry = () => { if (a.unreadable.includes('Notices')) onRetryNotices?.(); if (a.unreadable.some((n) => n !== 'Notices')) onRetryPortal?.(); };
  return (
    <section aria-label="What arrived" className={BLK} data-testid="first-arrived">
      <h3 className={H2}>What arrived {a.items.length > 0 && <span className={COUNT}>latest {a.items.length}</span>}</h3>
      {a.unreadable.length > 0 && (
        <DataState state="unavailable" what={a.unreadable.join(', ')} claim="This list may be missing them." onRetry={retry} retryLabel="Try again" data-testid="first-arrived-unreadable" />
      )}
      {a.items.length ? (
        <ul>
          {a.items.map((i) => (
            <li key={i.key} className={LI}>
              <div className="min-w-0">
                <b className="text-[13px] text-gray-900 dark:text-gray-100">{i.title}</b>
                <small className={SUB}>{[i.kind.toLowerCase(), i.date, money(i.amount_cents)].filter(Boolean).join(' · ')}{i.extra || ''}</small>
              </div>
              <a href={i.href} className={BTN}>{i.action}</a>
            </li>
          ))}
        </ul>
      ) : a.loading ? (
        <span className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true" />
      ) : !a.unreadable.length && (
        <DataState state="none" size="block">Nothing has been issued to you yet.</DataState>
      )}
      <a href="#documents" className="text-[12.5px] font-bold text-violet-700 dark:text-violet-300">All documents and notices →</a>
    </section>
  );
}

/** The commitment figures (VF-04 "My commitment · Fund I"): seven values, each its own period. */
export function CommitmentFigures({ portal, fundId, today }) {
  const c = commitmentFigures(portal, { fundId, today });
  if (!c) {
    return <p className={CAP} data-testid="first-figures-none">Your figures are in My commitment, one fund at a time.</p>;
  }
  return (
    <section className={`${CARD} p-4`} aria-label="My commitment" data-testid="first-figures">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={H2}>My commitment{c.fund_name ? ` · ${c.fund_name}` : ''}</h3>
        <a href="#my-commitment" className="text-[12px] font-bold text-violet-700 dark:text-violet-300">Open My commitment →</a>
      </div>
      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200 sm:grid-cols-4 lg:grid-cols-7 dark:border-gray-800">
        {c.figures.map((f) => (
          <div key={f.key} className="flex min-w-0 flex-col gap-0.5 border-b border-r border-gray-100 p-3 dark:border-gray-800" data-figure={f.key}>
            <dt className="text-[11.5px] text-gray-500 dark:text-gray-400">{f.label}</dt>
            <dd className={`${MONO} text-[17px] font-bold text-gray-900 dark:text-gray-100`}>
              {'multiple' in f
                ? (f.multiple == null ? <DataState state="not_applicable">No multiple yet</DataState> : `${f.multiple.toFixed(2)}×`)
                : f.unreadable ? <StateChip kind="unavailable" />
                  : (money(f.cents) ?? <DataState state="not_recorded" />)}
            </dd>
            <dd className={`${MONO} text-[10.5px] leading-snug text-gray-500 dark:text-gray-400`}>{f.note}</dd>
          </div>
        ))}
      </dl>
      {c.over_called && <p className={`${CAP} mt-2`}>Calls recorded exceed the commitment; My commitment shows each line.</p>}
    </section>
  );
}

function GpEmail({ fundId, children = 'Email the GP of record' }) {
  if (fundId == null) return null;
  return <Link to={emailHref(`fund_gp:${fundId}`, 'LP workspace')} className={BTN} data-testid="first-email-gp">{children}</Link>;
}

function LabSummary({ P }) {
  return (
    <section className={`${CARD} p-4`} aria-label="Spin-Out Lab" data-testid="first-lab">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={H2}>Spin-Out Lab</h3>
        <Link to="/spinout-lab" className="text-[12px] font-bold text-violet-700 dark:text-violet-300">Open /spinout-lab →</Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[[P.graduates, 'Graduates to date'], [P.onTime, 'Incorporated on time'], [P.alumni, 'Raised by alumni']].map(([v, k]) => (
          <div key={k} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
            <div className={`${MONO} text-[18px] font-bold text-gray-900 dark:text-gray-100`}>{v}</div>
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400">{k}</div>
          </div>
        ))}
      </div>
      <p className={`${CAP} mt-2`}>{P.live ? 'Programme figures from graduate records. They describe the programme, not fund returns.' : 'Programme track record not recorded yet; it appears once graduate records hold it.'}</p>
    </section>
  );
}

const STEPS = ['Review', 'KYC / AML', 'Subscription booklet', 'Sign the LPA'];

function ApplicantSteps({ current }) {
  return (
    <ol className="mt-2.5 grid grid-cols-2 gap-1 sm:grid-cols-4" aria-label="What happens next">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined}
          className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-center text-[11px] font-semibold text-gray-500 aria-[current=step]:border-violet-600 aria-[current=step]:text-violet-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:aria-[current=step]:text-violet-300">
          {i + 1} · {s}
        </li>
      ))}
    </ol>
  );
}

const Note = ({ application }) => (application?.review_note
  ? <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-[12px] text-gray-700 dark:bg-gray-900/50 dark:text-gray-300"><b>Note from the fund team:</b> {application.review_note}</div>
  : null);

/**
 * The first screen. `kind` is `firstScreenKind(...)`; `loading` is drawn by the
 * page's skeleton, so it never reaches here.
 */
export default function FundFirstScreen({
  kind, portal, application, kyc = null, booklet, notices, err, onRetryPortal, onRetryBooklet, onRetryNotices, P, fundId, proofSlot = null, today,
}) {
  const holdings = Array.isArray(portal?.lp_holdings) ? portal.lp_holdings : [];
  let body = null;
  if (kind === 'unreadable') {
    body = (
      <DataState state="unavailable" size="block" what="Your position" announce="always" onRetry={onRetryPortal} retryLabel="Try again" data-testid="first-unreadable"
        claim="This is not a $0 commitment. Your standing is held back rather than shown as Visitor. Fund and terms and Apply still work." reason={err || undefined} />
    );
  } else if (kind === 'visitor') {
    body = (
      <>
        <Banner tone="gray" title={GATE.visitor.title} testId="first-visitor">{GATE.visitor.body}</Banner>
        <div className={`${CARD} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
          <div><b className="text-[14px] text-gray-900 dark:text-gray-100">Ready to talk to the fund?</b>
            <p className={CAP}>Applying sends your answers to the fund team. It commits nothing and moves no money.</p></div>
          <a href="#apply" className={BTN}>Read what applying involves</a>
        </div>
      </>
    );
  } else if (kind === 'applicant') {
    const sent = dayLabel(application?.created_at);
    const target = application?.target_commitment != null ? money(Math.round(Number(application.target_commitment) * 100)) : null;
    body = (
      <Banner tone="violet" title="Application in review" testId="first-applicant"
        action={kyc?.loaded && kyc.status === 'approved' ? null : <Link to="/trust" className={BTN}>Start KYC / AML in Trust</Link>}>
        {[sent ? `Sent ${sent}` : 'Sent · date not recorded', target ? `target commitment ${target}` : null, 'the fund team reviews each application by hand.'].filter(Boolean).join(' · ')}
        <ApplicantSteps current={0} />
        <Note application={application} />
        {proofSlot}
      </Banner>
    );
  } else if (kind === 'approved_no_position') {
    const reviewed = dayLabel(application?.reviewed_at);
    body = (
      <Banner tone="green" title="Approved. Your fund position is being set up." testId="first-approved-no-position" action={<Link to="/trust" className={BTN}>Open Trust →</Link>}>
        {reviewed ? `Reviewed ${reviewed}. ` : ''}The fund team records your position; you will see My commitment once it exists. Your Subscription Booklet is below: read each part, tick what applies, then submit it. Reporting and participation activate once the general partner records your commitment on the fund’s register.
        <Note application={application} />
        {proofSlot}
      </Banner>
    );
  } else if (kind === 'position_unsigned') {
    body = (
      <Banner tone="amber" title="Your position is open. Sign the LPA to continue." testId="first-position-unsigned" action={<a href="#my-commitment" className={BTN}>Open the LPA</a>}>
        A position is recorded with nothing committed and the LPA unsigned. Signing is recorded with its date; it commits no amount.
        {proofSlot}
      </Banner>
    );
  } else if (kind === 'approved') {
    const signed = holdings.map((h) => h?.lpa_signed_at).filter(Boolean).sort().pop();
    body = (
      <section className={`${CARD} flex flex-col gap-3 p-4`} aria-label="What to do next" data-testid="first-approved">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={H2}>What to do next</h3>
          <span className={COUNT}>{signed ? `LPA signed ${dayLabel(signed)} · ` : ''}nothing committed yet</span>
        </div>
        <div className={`grid grid-cols-1 gap-4 ${proofSlot ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <SignBlock booklet={booklet} holdings={holdings} onRetry={onRetryBooklet} title="To sign" />
          {proofSlot && (
            <section aria-label="To fund" className={BLK}>
              <h3 className={H2}>To fund</h3>
              <p className={CAP}>Share a floor, “at least $X”, from your Mercury account. The fund team never sees a balance.</p>
              {proofSlot}
            </section>
          )}
          <section aria-label="To commit" className={BLK} data-testid="first-to-commit">
            <h3 className={H2}>To commit</h3>
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]"><span className="text-gray-500 dark:text-gray-400">Your position</span><b className={`${MONO} text-gray-900 dark:text-gray-100`}>nothing committed · {TIERS[0].amount} minimum</b></div>
            <ul className="flex flex-col gap-1 text-[12px] text-gray-700 dark:text-gray-300">
              {TIERS.map((t) => <li key={t.name}>{t.name} <b className={MONO}>{t.amount}</b> · {t.rights}</li>)}
            </ul>
            <GpEmail fundId={fundId} />
            <span className={CAP}>The fund team records commitments; the platform does not.</span>
          </section>
        </div>
      </section>
    );
  } else if (kind === 'committed' || kind === 'full') {
    const c = commitmentFigures(portal, { fundId, today });
    const committed = c?.figures[0]?.cents ?? null;
    const tier = tierOf(committed);
    const top = TIERS.find((t) => t.hl);
    body = (
      <>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DueBlock portal={portal} today={today} onRetry={onRetryPortal} />
          <SignBlock booklet={booklet} holdings={holdings} onRetry={onRetryBooklet} />
          <ArrivedBlock portal={portal} notices={notices} onRetryNotices={onRetryNotices} onRetryPortal={onRetryPortal} />
        </div>
        <CommitmentFigures portal={portal} fundId={fundId} today={today} />
        {kind === 'committed' && top && (
          <div className={`${CARD} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`} data-testid="first-increase">
            <div><b className="text-[13.5px] text-gray-900 dark:text-gray-100">Increase to {top.amount} for decision rights</b>
              <p className={CAP}>You hold {money(committed) ?? 'a commitment'}{tier ? ` (${tier.name})` : ''}. The fund team records commitments; an email is not a commitment.</p></div>
            <GpEmail fundId={fundId} />
          </div>
        )}
        <LabSummary P={P} />
      </>
    );
  }
  return (
    <section id="overview" aria-labelledby="overview-heading" tabIndex={-1} className="flex scroll-mt-6 flex-col gap-4" data-first-screen={kind}>
      <h2 id="overview-heading" tabIndex={-1} data-section-heading="" className={`${LBL} sr-only`}>Overview</h2>
      {body}
    </section>
  );
}
