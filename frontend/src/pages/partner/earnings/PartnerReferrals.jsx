import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '../../../lib/api';
import { titleCase } from '../../../lib/absence';
import { Card, EmptyState, SectionLabel, Skeleton, Unreadable, Unrecorded, WorkerRail } from '../../../ui';
import WorkspaceShell from '../../../workspaces/WorkspaceShell';
import ZoneNav from '../../../workspaces/ZoneNav';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { StatedLimit, inputClass } from '../kit';
import {
  EARNINGS_AREA, PERIODS, REFERRAL_STATUS,
  commissionsForReferral, countOf, creditsResetDay, dayOf, referralName, statusOf, timeOf, totalsByStatus,
} from '../../../lib/partnerEarnings';
import { Money, Panel, RowTable, StatusPill, UnreadableValue, WriteNote, ghostButton, primaryButton } from './parts';

/**
 * Partner · Referrals — `/partner/referrals` (canvas `pe-referrals`, D569).
 *
 * FOUR READS, EACH WITH ITS OWN STATES:
 *   `GET /network/referral/code`   the code and its two links
 *   `GET /network/referral/list`   who signed up with it
 *   `GET /introductions/credits`   the introduction credits left
 *   `GET /network/commissions/me`  read only to say what each sign-up earned
 *
 * NOT `/referrals`. That page is Refer & Earn, the submissions pipeline at
 * `/refer-earn/*`, and it stays where it is: a submitted referral is a person
 * you put forward for review, while this page is the people who registered
 * with your code. Two programmes, two stores.
 *
 * THE CREDITS ARE MONTHLY. The canvas drew "of [n] this quarter"; the
 * service keys the allowance on the UTC month and renews it on the first, so
 * the card says month and names the day.
 */

const SIGNUP_COLS = 'md:grid-cols-[minmax(0,2fr)_96px_104px_120px_104px_minmax(0,1.2fr)]';

/** The code, its link, and the three things a person does with it. */
export function ReferralCodeCard({ state, data, copied, canShare, onCopy, onShare, onRetry }) {
  let body;
  if (state === 'loading') body = <Skeleton.Text lines={3} />;
  else if (state === 'unreadable') {
    body = <Unreadable what="Your referral code" claim="This is not a claim that you have none." onRetry={onRetry} />;
  } else {
    const code = String(data?.code ?? '').trim();
    const link = String(data?.link ?? '').trim();
    const signUp = String(data?.register_link ?? '').trim();
    const legacy = String(data?.legacy_code ?? '').trim();
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2.5">
          {code
            ? <span className="text-[22px] font-extrabold tracking-wide text-axal-ink dark:text-gray-100" data-testid="text-referral-code">{code}</span>
            : <Unrecorded>No code returned</Unrecorded>}
          <button type="button" className={ghostButton} disabled={!code} onClick={() => onCopy?.('code', code)} data-testid="button-copy-code">Copy code</button>
          <button type="button" className={ghostButton} disabled={!link} onClick={() => onCopy?.('link', link)} data-testid="button-copy-link">Copy link</button>
          {canShare && link
            ? <button type="button" className={primaryButton('partner')} onClick={() => onShare?.(link, code)} data-testid="button-share-code">Share</button>
            : null}
        </div>
        {link ? <p className="mt-2 break-all text-[11.5px] text-axal-muted" data-testid="text-referral-link">{link}</p> : null}
        {signUp && signUp !== link
          ? <p className="mt-1 break-all text-[11.5px] text-axal-muted">Straight to sign-up: {signUp}</p>
          : null}
        {legacy ? <p className="mt-1 text-[11.5px] text-axal-muted" data-testid="text-legacy-code">Your previous code {legacy} still works.</p> : null}
        <div className="mt-2"><WriteNote note={copied} testid="note-copy" /></div>
      </>
    );
  }
  return (
    <Card padding="md" data-testid="card-referral-code">
      <SectionLabel>Your referral code</SectionLabel>
      <div className="mt-2">{body}</div>
    </Card>
  );
}

/** A count, or "Not recorded" — never a coerced zero. */
function Count({ value }) {
  const n = countOf(value);
  return n === null ? <Unrecorded>Not recorded</Unrecorded> : <span className="font-semibold tabular-nums">{n}</span>;
}

/** The introduction credits left, by where they came from. */
export function IntroCreditsCard({ state, data, onRetry }) {
  let body;
  if (state === 'loading') body = <Skeleton.Text lines={3} />;
  else if (state === 'unreadable') {
    body = <Unreadable what="Your introduction credits" claim="This is not a claim that you have none left." onRetry={onRetry} />;
  } else {
    const c = data?.credits || {};
    const balance = countOf(c.balance);
    const renews = creditsResetDay(c.month);
    body = (
      <>
        <div className="flex items-baseline gap-2">
          {balance === null
            ? <Unrecorded>Not recorded</Unrecorded>
            : <span className="text-[28px] font-extrabold tabular-nums tracking-tight text-axal-ink dark:text-gray-100" data-testid="text-credits-balance">{balance}</span>}
          <span className="text-[12px] text-axal-muted">left</span>
        </div>
        <ul className="mt-2 space-y-1 text-[12px] text-axal-muted" data-testid="list-credit-buckets">
          <li><Count value={c.allowance_remaining} /> of <Count value={c.monthly_allowance} /> from this month’s allowance</li>
          <li><Count value={c.referral_remaining} /> of <Count value={c.referral_total} /> earned by referrals</li>
          <li><Count value={c.purchased_remaining} /> of <Count value={c.purchased_total} /> bought</li>
          <li><Count value={c.used_this_month} /> used this month</li>
        </ul>
        <p className="mt-2 text-[11.5px] text-axal-muted" data-testid="text-credits-renew">
          {renews ? `The allowance renews on ${renews} (UTC).` : <Unrecorded>Renewal day not recorded</Unrecorded>}
        </p>
      </>
    );
  }
  return (
    <Card padding="md" data-testid="card-intro-credits">
      <SectionLabel>Introduction credits</SectionLabel>
      <div className="mt-2">{body}</div>
    </Card>
  );
}

/** What one sign-up has earned you, from the commissions that name it. */
function SignupCommission({ referral, commissionsState, commissions }) {
  if (commissionsState === 'loading') return <Skeleton h={14} w="70%" />;
  if (commissionsState === 'unreadable') return <UnreadableValue reason="Your commissions could not be read." />;
  const linked = commissionsForReferral(referral?.id, commissions);
  if (!linked.length) return <span className="text-[12px] text-axal-muted">None linked</span>;
  const { statuses } = totalsByStatus(linked);
  return (
    <span className="flex flex-col gap-0.5">
      {statuses.flatMap((s) => s.sums.map((sum) => (
        <span key={`${s.key}-${sum.currency}`} className="text-[12px]">
          <Money cents={sum.cents} currency={sum.currency} /> <span className="text-axal-muted">{s.label.toLowerCase()}</span>
        </span>
      )))}
    </span>
  );
}

/** The people who signed up with your code, with the four states. */
export function SignupsTable({ state, rows, total, commissionsState, commissions, onRetry, onCopyCode, filters }) {
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Table rows={4} cols={5} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="Your sign-ups" claim="This is not a claim that nobody signed up." onRetry={onRetry} /></div>;
  } else if (total === 0) {
    body = (
      <div className="p-4">
        <EmptyState
          size="sm"
          icon={UserPlus}
          title="Nobody has signed up with your code yet"
          body="When someone registers with your code or link, they appear here with their status."
          cta={onCopyCode ? { label: 'Copy your code', onClick: onCopyCode } : undefined}
          data-testid="empty-signups"
        />
      </div>
    );
  } else {
    body = (
      <RowTable
        testid="table-signups"
        cols={SIGNUP_COLS}
        head={['Who', 'Role', 'Signed up', 'Status', 'KYC', 'Commission']}
        empty={<p className="text-[12.5px] text-axal-muted" data-testid="empty-signups-filtered">No sign-up matches these filters.</p>}
        rows={rows.map((r) => {
          const status = statusOf(REFERRAL_STATUS, r?.status);
          const name = referralName(r);
          const joined = dayOf(r?.created_at);
          const converted = dayOf(r?.converted_at);
          const kyc = titleCase(r?.kyc_status);
          return {
            key: r.id,
            testid: `row-signup-${r.id}`,
            cells: [
              name ? <span className="font-semibold text-axal-ink dark:text-gray-100">{name}</span> : <Unrecorded>Name not recorded</Unrecorded>,
              titleCase(r?.referred_role)
                ? <span className="text-axal-muted" title="The account’s role as it stands now.">{titleCase(r.referred_role)}</span>
                : <Unrecorded>Not recorded</Unrecorded>,
              joined ? <span className="tabular-nums text-axal-muted">{joined}</span> : <Unrecorded>Not recorded</Unrecorded>,
              <span className="flex flex-col items-start gap-0.5">
                <StatusPill status={status} />
                {status.key === 'converted' && converted ? <span className="text-[11px] tabular-nums text-axal-muted">{converted}</span> : null}
              </span>,
              kyc ? <span className="text-axal-muted">{kyc}</span> : <Unrecorded>Not recorded</Unrecorded>,
              <SignupCommission referral={r} commissionsState={commissionsState} commissions={commissions} />,
            ],
          };
        })}
      />
    );
  }
  return (
    <Panel
      title="Signed up with your code"
      meta={state === 'ready' && total ? `${rows.length === total ? total : `${rows.length} of ${total}`} sign-up${total === 1 ? '' : 's'}` : null}
      testid="panel-signups"
    >
      {filters}
      {body}
    </Panel>
  );
}

/** Sign-ups narrowed by status, period and a search over the name and email. */
export function filterSignups(rows, { status = 'all', role = 'all', period = 'all', query = '', now = Date.now() } = {}) {
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  const since = days === null ? null : now - days * 86400000;
  const q = String(query ?? '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (status !== 'all' && String(r?.status ?? '').toLowerCase() !== status) return false;
    if (role !== 'all' && String(r?.referred_role ?? '').trim().toLowerCase() !== role) return false;
    if (since !== null) {
      const t = timeOf(r?.created_at);
      if (t === null || t < since) return false;
    }
    if (q && !`${r?.referred_name ?? ''} ${r?.referred_email ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** The roles present among the sign-ups, as filter options, alphabetical. */
export function signupRoles(rows) {
  const keys = new Set((rows || []).map((r) => String(r?.referred_role ?? '').trim().toLowerCase()).filter(Boolean));
  return [...keys].sort().map((key) => ({ key, label: titleCase(key) }));
}

/** One read into one state: loading, then ready with the data or unreadable. */
function readInto(fn, set, shape = (d) => d) {
  set({ status: 'loading', data: null });
  return fn()
    .then((d) => set({ status: 'ready', data: shape(d) }))
    .catch(() => set({ status: 'unreadable', data: null }));
}

export default function PartnerReferrals() {
  const [code, setCode] = useState({ status: 'loading', data: null });
  const [list, setList] = useState({ status: 'loading', data: null });
  const [credits, setCredits] = useState({ status: 'loading', data: null });
  const [commissions, setCommissions] = useState({ status: 'loading', data: null });
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('all');
  const [role, setRole] = useState('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(null);

  const loadCode = useCallback(() => readInto(() => api.referralCode(), setCode), []);
  const loadList = useCallback(() => readInto(() => api.referralList(), setList, (d) => (Array.isArray(d) ? d : [])), []);
  const loadCredits = useCallback(() => readInto(() => api.introCredits(), setCredits), []);
  const loadCommissions = useCallback(() => readInto(() => api.commissionsMe(), setCommissions), []);
  useEffect(() => { loadCode(); loadList(); loadCredits(); loadCommissions(); }, [loadCode, loadList, loadCredits, loadCommissions]);

  const rows = useMemo(() => (Array.isArray(list.data) ? list.data : []), [list.data]);
  const visible = useMemo(() => filterSignups(rows, { status, role, period, query }), [rows, status, role, period, query]);
  const roles = useMemo(() => signupRoles(rows), [rows]);
  const commissionRows = Array.isArray(commissions.data?.commissions) ? commissions.data.commissions : [];
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (what, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied({ ok: true, text: what === 'code' ? 'Code copied.' : 'Link copied.' });
    } catch {
      setCopied({ ok: false, text: 'This browser would not copy it. Select it above and copy it by hand.' });
    }
  };
  const share = async (link, value) => {
    try {
      await navigator.share({ title: 'Join me on Axal', text: value ? `Use my code ${value}.` : undefined, url: link });
    } catch {
      // Closing the share sheet rejects too; there is nothing to report.
    }
  };

  const chips = [
    ...[['all', 'All'], ['pending', REFERRAL_STATUS.pending.label], ['converted', REFERRAL_STATUS.converted.label]].map(([key, label]) => (
      list.status === 'ready'
        ? { label, testid: `chip-signup-${key}`, active: status === key, onSelect: () => setStatus(key) }
        : { label, testid: `chip-signup-${key}`, disabled: true, title: 'The sign-ups have not been read, so there is nothing to narrow.' }
    )),
  ];

  const coverage = [
    list.status === 'ready' ? `${rows.length} sign-up${rows.length === 1 ? '' : 's'} read` : null,
    credits.status === 'ready' ? 'Introduction credits read' : null,
    commissions.status === 'ready' ? `${commissionRows.length} commission${commissionRows.length === 1 ? '' : 's'} read` : null,
  ].filter(Boolean);

  return (
    <WorkspaceShell
      role="partner"
      title="Referrals"
      intro="Your code, the people who signed up with it, and the introduction credits you have left."
      rail={(
        <WorkerRail
          workspace="Referrals"
          role="partner"
          stance="Stored records only"
          note="This rail reports what the page read. It sends nothing and drafts nothing: sharing your code is your own click."
          coverage={coverage}
          coverageNote={coverage.length ? undefined : 'Nothing has been read yet, so there is nothing to report.'}
          unavailable={[
            ['Share text', 'Eadwyn drafts no share messages here yet: no draft surface reads your code.'],
          ]}
        />
      )}
    >
      <ZoneNav bucket={EARNINGS_AREA} role="partner" />
      <ZoneToolbar role="partner" filters={chips} className="mb-3" />
      <div className="space-y-3">
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <ReferralCodeCard state={code.status} data={code.data} copied={copied} canShare={canShare}
            onCopy={copy} onShare={share} onRetry={loadCode} />
          <IntroCreditsCard state={credits.status} data={credits.data} onRetry={loadCredits} />
        </div>
        <SignupsTable
          state={list.status}
          rows={visible}
          total={rows.length}
          commissionsState={commissions.status}
          commissions={commissionRows}
          onRetry={loadList}
          onCopyCode={code.status === 'ready' && code.data?.code ? () => copy('code', code.data.code) : undefined}
          filters={list.status === 'ready' && rows.length ? (
            <div className="grid gap-2 border-b border-axal-hairline px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] dark:border-gray-700">
              <label className="block">
                <span className="sr-only">Search sign-ups</span>
                <input className={inputClass} type="search" value={query} placeholder="Search sign-ups…"
                  onChange={(e) => setQuery(e.target.value)} data-testid="input-search-signups" />
              </label>
              <label className="block">
                <span className="sr-only">Role</span>
                <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} data-testid="select-signup-role">
                  <option value="all">Every role</option>
                  {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="sr-only">Period</span>
                <select className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="select-signup-period">
                  {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </label>
            </div>
          ) : null}
        />
        <StatedLimit title="What this page does not claim">
          <p><strong>A sign-up’s commission is what names it.</strong> A commission earned on a milestone carries the referral it came from; a purchase commission and a compounding bonus carry none, so they appear on Earnings and not against a sign-up here.</p>
          <p className="mt-2"><strong>The role is the account’s role now.</strong> The sign-up list reads it from the account as it stands today, not as it was when they signed up.</p>
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
