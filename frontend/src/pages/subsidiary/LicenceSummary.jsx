import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { licenceAccountApi } from '../../lib/api/licenceAccount';
import { licenceRequestsApi } from '../../lib/api/licenceRequests';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { reportError } from '../../lib/log';
import useLicenceNeeds from '../../hooks/useLicenceNeeds';
import {
  NOT_RECORDED, allowanceCard, contractCard, feeCard, money, needRow, needsCount, oweCard, percent,
  renewalCard, shareCard, stateBanner, tabPath, termCard,
} from '../../lib/licencePage';
import { LicenceStateBanner } from './LicenceFrame';

/**
 * D800 (#2233) — the Licences page's Summary (canvas board L1).
 *
 * FOUR CARDS FROM THE LEDGER, THE REST FROM THEIR OWN READS. Term, Renewal,
 * Fee and Share come from `/api/licence/mine`, which the page already holds.
 * Needs you, What you owe HQ and Your contract are D798's three reads; the
 * Renewal card asks D799's requests whether a renewal or a notice is with HQ;
 * the AI allowance is the caller's own (`/api/ai-budget/me`). EACH READ FAILS
 * ALONE: an unreadable statement table costs its card its figures and says so,
 * and the terms beside it still render, as D136's notices read already does.
 */

const card = 'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const label = 'text-[10px] font-extrabold uppercase tracking-widest text-gray-500 dark:text-gray-400';
const btn = 'whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-bold';
const btnPrimary = `${btn} border-slate-700 bg-slate-700 text-white hover:bg-slate-800`;
const btnGhost = `${btn} border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200`;

/** A read in its own state: `undefined` loading, `null` unreadable with its reason, else the payload. */
function useRead(load, key) {
  const [state, setState] = useState({ value: undefined, reason: '' });
  useEffect(() => {
    let alive = true;
    load().then(
      (v) => { if (alive) setState({ value: v, reason: '' }); },
      (e) => {
        if (e?.status !== 404) reportError(`MyLicencePage:${key}`, e);
        if (alive) setState({ value: null, reason: e?.message || 'This could not be read just now.' });
      },
    );
    return () => { alive = false; };
  }, [load, key]);
  return state;
}

const readStatements = () => licenceAccountApi.statements();
const readContract = () => licenceAccountApi.contract();
const readRequests = () => licenceRequestsApi.list();
const readBudget = () => aiBudgetApi.mine();

function Bar({ pct, warn = false }) {
  return (
    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-1.5 rounded-full ${warn ? 'bg-amber-700' : 'bg-slate-700 dark:bg-slate-300'}`} style={{ width: `${pct ?? 0}%` }} />
    </div>
  );
}

function Missing({ children }) {
  return <p className="text-xs italic text-gray-400 dark:text-gray-500">{children}</p>;
}

function CardHead({ title, right }) {
  return (
    <div className="flex items-center justify-between gap-2.5 px-4 py-3 text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
      <span>{title}</span>{right}
    </div>
  );
}

/** Row 1: Term, Renewal, Annual licence fee, Revenue share to HQ. */
export function SummaryCards({ licence, terms, requests, now = new Date() }) {
  const term = termCard(licence, now);
  const renew = renewalCard(licence, { terms, requests, now });
  const fee = feeCard(licence, now);
  const share = shareCard(licence, terms);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="licence-cards">
      <div className={`${card} space-y-1.5 px-4 py-3.5`} data-testid="licence-card-term">
        <span className={label}>Term</span>
        <p className="text-base font-bold text-gray-900 dark:text-gray-100">{term.title}</p>
        <p className="font-mono text-xs text-gray-500 dark:text-gray-400">{term.range}</p>
        {term.pct !== null && <Bar pct={term.pct} />}
      </div>
      <div className={`${card} space-y-1.5 px-4 py-3.5`} data-testid="licence-card-renewal" data-variant={renew.variant}>
        <span className={label}>Renewal</span>
        <p className="text-[15px] font-bold leading-snug text-gray-900 dark:text-gray-100">{renew.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{renew.detail}</p>
      </div>
      <div className={`${card} space-y-1.5 px-4 py-3.5`} data-testid="licence-card-fee">
        <span className={label}>Annual licence fee</span>
        <p className="font-mono text-xl font-semibold text-gray-900 dark:text-gray-100">{fee.amount}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{fee.next}</p>
      </div>
      <div className={`${card} space-y-1.5 px-4 py-3.5`} data-testid="licence-card-share">
        <span className={label}>Revenue share to HQ</span>
        <p className="font-mono text-xl font-semibold text-gray-900 dark:text-gray-100">{share.share}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{share.detail}</p>
      </div>
    </div>
  );
}

/** "Needs you": D798's list, in its order, each with its one button. */
export function NeedsYou({ needs }) {
  const count = needsCount(needs);
  const items = Array.isArray(needs?.items) ? needs.items.map(needRow) : [];
  return (
    <section className={`${card} overflow-hidden`} data-testid="licence-needs">
      <CardHead title="Needs you" right={count ? <span className="font-mono text-xs font-medium text-gray-500">{count}</span> : null} />
      {needs === undefined && <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-800"><Missing>Loading…</Missing></div>}
      {needs === null && (
        <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-800" data-testid="licence-needs-unreadable">
          <Missing>What needs you could not be read just now. This is not the same as nothing.</Missing>
        </div>
      )}
      {needs && items.length === 0 && (
        <p className="border-t border-gray-100 px-4 py-5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400" data-testid="licence-needs-empty">Nothing needs you</p>
      )}
      {items.map((n, i) => (
        <div key={`${n.title}-${i}`} className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5 text-xs dark:border-gray-800" data-testid="licence-need">
          <span className="text-gray-800 dark:text-gray-200">{n.title}</span>
          <Link to={n.to} className={n.primary ? btnPrimary : btnGhost}>{n.label}</Link>
        </div>
      ))}
      {needs?.reasons?.seats && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">{needs.reasons.seats}</p>
      )}
    </section>
  );
}

function KeyValues({ rows }) {
  return (
    <div className="px-4 pb-3 pt-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-gray-50 py-1.5 text-xs last:border-0 dark:border-gray-800/60">
          <span className="text-gray-500 dark:text-gray-400">{k}</span>
          <span className={v === NOT_RECORDED ? 'italic text-gray-400 dark:text-gray-500' : 'text-right font-mono text-[13px] text-gray-900 dark:text-gray-100'}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** "What you owe HQ": the latest statement HQ issued. */
export function OweHq({ read }) {
  const owe = read.value === undefined ? undefined : oweCard(read.value);
  return (
    <section className={`${card} overflow-hidden`} data-testid="licence-owe">
      <CardHead title="What you owe HQ" right={owe?.status ? <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{owe.status}</span> : null} />
      <div className="border-t border-gray-100 dark:border-gray-800">
        {owe === undefined && <div className="px-4 py-4"><Missing>Loading…</Missing></div>}
        {read.value === null && <div className="px-4 py-4"><Missing>{read.reason}</Missing></div>}
        {owe?.reason && <div className="px-4 py-4"><Missing>{owe.reason}</Missing></div>}
        {owe?.empty && <div className="px-4 py-4"><Missing>HQ has issued no statement on this licence yet.</Missing></div>}
        {owe?.rows && <KeyValues rows={owe.rows} />}
        <div className="px-4 pb-3"><Link to={tabPath('statements')} className={`${btnGhost} inline-block`}>Open statements</Link></div>
      </div>
    </section>
  );
}

/** D797's deal terms, five of them; until HQ records the schedule each reads "Not recorded". */
const GLANCE = [
  ['first_look_business_days', 'HQ first look', (v) => `${v} business days`],
  ['co_invest_max_bps', 'Co-investment with the Axal VC Fund', (v) => `up to ${percent(v)}`],
  ['carry_share_bps', 'Your carry share', (v) => percent(v)],
  ['referral_fee_bps', 'Referral fee', (v) => percent(v)],
  ['hq_approval_above_cents', 'HQ approval above', (v, c) => money(v, c)],
];

export function DealGlance({ terms, termsReason, currency }) {
  const rows = GLANCE.map(([key, k, fmt]) => [k, terms && terms[key] !== null && terms[key] !== undefined ? fmt(terms[key], currency) : NOT_RECORDED]);
  return (
    <section className={`${card} overflow-hidden`} data-testid="licence-deal-glance">
      <CardHead title="Deal terms at a glance" right={<Link to={tabPath('terms')} className="text-[11.5px] font-bold text-slate-700 dark:text-slate-300">All terms →</Link>} />
      <div className="border-t border-gray-100 dark:border-gray-800">
        {!terms && <p className="px-4 pt-3 text-[11px] text-gray-500 dark:text-gray-400">{termsReason || 'HQ has not recorded this licence’s terms yet.'}</p>}
        <KeyValues rows={rows} />
      </div>
    </section>
  );
}

/** "Your contract": the one waiting, and the one in force. */
export function YourContract({ read }) {
  const c = read.value === undefined ? undefined : contractCard(read.value);
  const TONE = { waiting: 'text-amber-800 dark:text-amber-300', muted: 'text-gray-500 dark:text-gray-400', ok: 'text-gray-600 dark:text-gray-300' };
  return (
    <section className={`${card} space-y-1.5 px-4 py-3.5`} data-testid="licence-contract-card">
      <span className={label}>Your contract</span>
      {c === undefined && <Missing>Loading…</Missing>}
      {read.value === null && <Missing>{read.reason}</Missing>}
      {c?.reason && <Missing>{c.reason}</Missing>}
      {c?.title && <p className="text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{c.title}</p>}
      {(c?.lines || []).map((line, i) => (typeof line === 'string'
        ? <p key={i} className="text-xs text-gray-500 dark:text-gray-400">{line}</p>
        : <p key={i} className={`text-xs ${TONE[line.tone] || ''}`}>{line.text}</p>))}
      <div className="flex flex-wrap gap-2 pt-1">
        {c?.signUrl && <a href={c.signUrl} className={btnPrimary} data-testid="licence-sign">Sign</a>}
        <Link to={tabPath('contract')} className={btnGhost}>Open contract</Link>
      </div>
    </section>
  );
}

/**
 * "Administrators". NO READ GIVES THE OTHERS: the list is HQ's (`licence_admins`)
 * and only a Super Admin reads it, so the card names the caller and says the
 * rest is HQ's to show, rather than drawing a list of one as if it were all.
 */
export function Administrators({ user, adminRole }) {
  const name = user?.name || user?.email || 'You';
  const role = adminRole ? `${String(adminRole).charAt(0).toUpperCase()}${String(adminRole).slice(1)}` : NOT_RECORDED;
  return (
    <section className={`${card} overflow-hidden`} data-testid="licence-admins">
      <CardHead title="Administrators" right={<Link to={tabPath('requests')} className="text-[11.5px] font-bold text-slate-700 dark:text-slate-300">Request a delegate</Link>} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 text-xs dark:border-gray-800">
        <span className="flex items-center gap-2"><span className="font-semibold text-gray-900 dark:text-gray-100">{name}</span><span className="text-gray-500">{role} · you</span></span>
      </div>
      <p className="border-t border-gray-100 px-4 py-2.5 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
        The licence’s other administrators are on HQ’s record, which is not readable from this page yet.
      </p>
    </section>
  );
}

/** "AI allowance for this licence": the caller's own daily and monthly allowance, and this month's use. */
export function AiAllowance({ read }) {
  const a = read.value ? allowanceCard(read.value) : null;
  return (
    <section className={`${card} space-y-2 px-4 py-3.5`} data-testid="licence-allowance">
      <span className={label}>AI allowance for this licence</span>
      {read.value === undefined && <Missing>Loading…</Missing>}
      {read.value === null && <Missing>{read.reason}</Missing>}
      {a && (
        <>
          <div className="flex gap-4 text-xs text-gray-700 dark:text-gray-300">
            <span>Daily <b className="font-mono font-medium">{a.daily}</b></span>
            <span>Monthly <b className="font-mono font-medium">{a.monthly}</b></span>
          </div>
          <Bar pct={a.pct} />
          <p className="font-mono text-[11.5px] text-gray-500 dark:text-gray-400">{a.used}</p>
        </>
      )}
    </section>
  );
}

/**
 * The Summary's grid. `seats`, `suspended` and `after` are drawn by the page
 * (`MyLicencePage.jsx`): the Seats card, D142's frozen lists and the custom
 * host keep the pins D129, D142 and D197 hold on that file. The state banner
 * (board L7) is drawn here because its "Sign" is the contract read's link.
 */
export default function LicenceSummary({ licence, terms, termsReason, user, state, seats, suspended, after }) {
  const needs = useLicenceNeeds(true);
  const statements = useRead(readStatements, 'statements');
  const contract = useRead(readContract, 'contract');
  const requests = useRead(readRequests, 'requests');
  const budget = useRead(readBudget, 'allowance');
  const banner = stateBanner(state, licence, { signUrl: contract.value?.sign_url || null });
  return (
    <div className="space-y-3" data-testid="licence-summary">
      <LicenceStateBanner banner={banner}>{state === 'suspended' ? suspended : null}</LicenceStateBanner>
      <SummaryCards licence={licence} terms={terms} requests={requests.value || null} />
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <NeedsYou needs={needs} />
          <OweHq read={statements} />
          <DealGlance terms={terms} termsReason={termsReason} currency={licence?.currency} />
        </div>
        <div className="space-y-3">
          {seats}
          <YourContract read={contract} />
          <Administrators user={user} adminRole={licence?.admin_role} />
          <AiAllowance read={budget} />
        </div>
      </div>
      {after}
    </div>
  );
}
