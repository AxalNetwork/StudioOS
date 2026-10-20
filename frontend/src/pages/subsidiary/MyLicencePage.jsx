import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Bell, Loader2, History, Lock, Globe,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { bpsPercent } from '../../lib/bps';
import { FROZEN, STILL_READABLE, FREEZE_RULE } from '../../lib/branchFreeze';
import { reportError } from '../../lib/log';
import { FREEZING_STATUSES, noticeKindLabel } from '../../lib/notices';
import { branchOfUser } from '../../lib/shellRole';
import {
  kindLabel, longDate, pageState, seatRows, stateBanner, tabPath,
} from '../../lib/licencePage';
import { useAuth } from '../../hooks/useAuthSync';
import { refreshLicenceNeeds } from '../../hooks/useLicenceNeeds';
import { Unrecorded } from '../../ui';
import DomainWizard from '../../components/licence/DomainWizard';
import AdminBoardFrame from '../admin/AdminBoardFrame';
import {
  CopyStamp, LicenceHeader, LicenceStateBanner, LicenceTabs, PartTwoPlaceholder,
} from './LicenceFrame';
import LicenceSummary from './LicenceSummary';
import LicenceTerms from './LicenceTerms';

/**
 * Licences — /admin/my-licence and its five tabs (D800, #2233: Summary, Terms,
 * Contract, Statements, Requests, History; the canvas `Licences Page.dc.html`).
 * The subsidiary administrator's own view.
 *
 * A subsidiary admin is not a super admin: they run one territory under a
 * licence HQ issued them, and the design gives them their own dashboard rather
 * than a filtered copy of HQ's. This is that dashboard's honest half.
 *
 * WHAT IT DOES NOT SHOW, and why the page says so in a panel rather than
 * leaving dashes for the reader to interpret. The Admin · Subsidiary canvas
 * puts seats USED against seats licensed, plus queues of LP applications,
 * referrals, cohort applications and moderation, all scoped to the territory.
 * Every one of those needs each account to name the licence it belongs to.
 * Migration 187 built the licence LEDGER and was explicit that it is not the
 * tenancy SCOPE; migration 190 added who ADMINISTERS a licence, which is an
 * identity, not a filter. So nothing is attributable to a territory yet.
 *
 * Seats LICENSED is in the ledger, and is shown. Seats used is not, and the
 * server says so in `derived_metrics_available` rather than sending a zero
 * this page would have to guess the meaning of — the same rule the fund
 * analytics follow.
 *
 * Everything on this page is read-only. HQ writes licences; a holder reading
 * their own terms is the whole feature.
 */

const fmtMoney = (cents, currency) => {
  if (cents == null) return 'Not recorded';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR' })
      .format(Number(cents) / 100);
  } catch { return `${(Number(cents) / 100).toLocaleString()} ${currency || ''}`.trim(); }
};
// Basis points, not a float — see migration 187. 3500 → "35%".
//
// THE ARITHMETIC MOVED TO `lib/bps.js` AND THE SENTENCE DID NOT (D149). The
// shared formatter returns `null` for an absent value and never a phrase,
// because the three pages that had their own copy disagreed about what absence
// should read as — and 'Not recorded' is this page's copy, chosen to match the
// eight other absences around it. Folding it into the helper would have
// flattened that choice; the split is D117's, one layer down.
const fmtBps = (bps) => bpsPercent(bps) ?? 'Not recorded';
const fmtDate = (v) => (v ? String(v).slice(0, 10) : 'Not recorded');

const STATUS_TONE = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  terminated: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  pending_activation: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const SEAT_LABEL = {
  founder: 'Founder', investor: 'Investor / LP', advisor: 'Advisor', partner: 'Service Partner',
};

/**
 * A licensed count the copy did not carry is not zero. Zero is a measured
 * count; a missing key was never read.
 */
export function seatFigure(value) {
  if (value == null) {
    return (
      <Unrecorded reason="This seat type was not on the licence copy, so it is not shown as zero." />
    );
  }
  return value;
}

/**
 * The way out of a freeze. On a branch that is an escalation, and
 * /branch/approvals answers. Off a branch that page refuses, and no page on
 * HQ records a licence appeal from the holder, so the absence is named.
 */
/**
 * D796 (#2229): the shell's "Settings" row became "Licences" and opens this
 * page on both tiers, so on a branch this card is the way on to the branch's
 * own settings (`/branch/settings`), which the row stays lit on. Off a branch
 * there is no such page, and nothing is drawn.
 */
export function BranchSettingsLink({ onBranch }) {
  if (!onBranch) return null;
  return (
    <Link
      to="/branch/settings"
      data-testid="my-licence-branch-settings"
      className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-violet-700"
    >
      <span className="text-sm font-semibold text-gray-900 dark:text-white">Branch settings →</span>
      <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
        Who decides each setting on this branch, and its domain.
      </span>
    </Link>
  );
}

export function LicenceAppeal({ onBranch }) {
  if (onBranch) {
    return (
      <p className="mt-3 text-[12.5px] text-rose-900 dark:text-rose-200">
        There is no field on this branch that can change the licence status. The way out is an
        appeal to HQ, which is an escalation like any other —{' '}
        <Link to="/branch/approvals" className="font-semibold underline underline-offset-2">
          open one
        </Link>
        .
      </p>
    );
  }
  return (
    <p className="mt-3 text-[12.5px] text-rose-900 dark:text-rose-200" data-testid="licence-appeal-absent">
      There is no field on this page that can change the licence status.{' '}
      <Unrecorded reason="This account is not on a branch deployment. An appeal is an escalation raised on the branch approvals page, and that page refuses here. Nothing on HQ records a licence appeal from the holder of this account.">
        No appeal from this page
      </Unrecorded>
    </p>
  );
}

function Panel({ icon: Icon, title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {Icon && <Icon size={15} className="text-violet-600" />} {title}
      </h2>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * D136 — the compliance ladder, from the addressee's end               *
 * ------------------------------------------------------------------ */

// `complianceLadder.ts:226` sends the freeze notification with
// `link: '/admin/my-licence'`, so this page is the ladder's declared
// destination — and until now it said nothing about it. A frozen administrator
// met a 423 and a page describing their commercial terms.
//
// THE THREE STATES ARE THREE DIFFERENT CLAIMS and must not share a banner:
//   `issued`   — you have been asked something, by a date. Nothing is frozen.
//   `overdue`  — the date passed unanswered. Your account cannot write.
//   `rejected` — HQ read your answer and did not accept it. Still frozen.
// Rendering the first as a freeze would be a false alarm; rendering the second
// as a reminder would be the opposite failure, and worse.
// D138 — `FREEZING` was declared here AND in `AdminLicences.jsx`; it is
// `FREEZING_STATUSES` in `lib/notices.js` now, imported above, on the rule
// `lib/README.md` states. `ANSWERABLE` stays here: it has exactly one caller,
// and a single-use export is not a consolidation.
const ANSWERABLE = new Set(['issued', 'overdue']);

const NOTICE_TONE = {
  issued: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  overdue: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  responded: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  withdrawn: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};


// NOT DISMISSIBLE, AND THAT IS THE POINT. `components/InfoStrip.jsx` and both
// `*Banner*` components persist a dismissal to `localStorage`; a compliance
// freeze a click makes disappear is not a freeze, and the one thing the reader
// needs is the sentence that says what lifts it.
//
// IT IS ALSO NOT A FULL-PAGE EARLY RETURN. This page's four early returns all
// mean "there is nothing to show". A frozen administrator has everything to
// show — their territory, their terms, their seats — and exactly one thing they
// have to do, so the banner sits above the page rather than replacing it.
function NoticeBanner({ notices }) {
  const frozen = notices.filter((n) => FREEZING_STATUSES.has(n.status));
  const open = notices.filter((n) => n.status === 'issued');
  if (frozen.length === 0 && open.length === 0) return null;

  if (frozen.length > 0) {
    const worst = frozen[frozen.length - 1];
    return (
      <div
        data-testid="licence-frozen-banner"
        className="rounded-lg border border-rose-300 bg-rose-50 p-3.5 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
      >
        <div className="flex items-start gap-2">
          <Lock size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              Your account is frozen{frozen.length > 1 ? ` by ${frozen.length} notices` : ''}
              {worst?.froze_at ? `, since ${fmtDate(worst.froze_at)}` : ''}.
            </p>
            {/* The same sentence the freeze notification and the email template
                already carry (`services/complianceLadder.ts`), rather than a
                third wording of one fact. */}
            <p className="mt-0.5">
              Writes are paused; reading is not. Answering the notice is what lifts it.
            </p>
            <p className="mt-1 text-[13px]">
              {frozen.length > 1
                ? 'Every one of them has to be answered.'
                : `“${worst?.subject || 'A compliance notice'}” — the notice is below.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const next = open[open.length - 1];
  return (
    <div
      data-testid="licence-notice-banner"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="flex items-start gap-2">
        <Bell size={15} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">
            HQ is waiting on you{open.length > 1 ? ` about ${open.length} things` : ''}.
          </p>
          <p className="mt-0.5">
            {open.length > 1
              ? 'Each one has its own deadline.'
              : `“${next?.subject || 'A compliance notice'}” — answer by ${fmtDate(next?.respond_by)}.`}{' '}
            A deadline that passes unanswered freezes this account until you answer.
          </p>
        </div>
      </div>
    </div>
  );
}

function NoticeCard({ notice, onAnswered }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const answerable = ANSWERABLE.has(notice.status);

  async function submit() {
    setBusy(true); setErr('');
    try {
      await api.myNoticeRespond(notice.uid, draft.trim());
      setDraft('');
      onAnswered();
    } catch (e) {
      reportError('MyLicencePage:noticeRespond', e);
      setErr(e?.message || 'That did not go through. Nothing was recorded.');
    } finally { setBusy(false); }
  }

  return (
    <li className="rounded-lg border border-gray-200 p-3.5 dark:border-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{notice.subject}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {noticeKindLabel(notice.kind)} · issued {fmtDate(notice.created_at)}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${NOTICE_TONE[notice.status] || NOTICE_TONE.withdrawn}`}>
          {String(notice.status || '').replace(/_/g, ' ')}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{notice.body}</p>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>Answer by {fmtDate(notice.respond_by)}</span>
        {notice.froze_at && FREEZING_STATUSES.has(notice.status) && (
          <span className="font-medium text-rose-700 dark:text-rose-300">
            Frozen since {fmtDate(notice.froze_at)}
          </span>
        )}
        {notice.responded_at && <span>You answered {fmtDate(notice.responded_at)}</span>}
        {notice.reviewed_at && <span>HQ reviewed {fmtDate(notice.reviewed_at)}</span>}
      </div>

      {notice.response && (
        <div className="mt-2 rounded-md bg-gray-50 p-2.5 dark:bg-gray-800/60">
          <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">What you sent</div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{notice.response}</p>
        </div>
      )}
      {notice.review_note && (
        <div className="mt-2 rounded-md bg-gray-50 p-2.5 dark:bg-gray-800/60">
          <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">HQ&apos;s note</div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{notice.review_note}</p>
        </div>
      )}

      {answerable ? (
        <div className="mt-3">
          <textarea
            rows={3} maxLength={5000} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What you have done about it, in at least 10 characters. HQ reads this."
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            type="button" disabled={busy || draft.trim().length < 10}
            onClick={submit}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : 'Send this to HQ'}
          </button>
          {/* WHAT SENDING DOES, AND WHAT IT DOES NOT. The freeze lifts on the
              answer rather than on HQ accepting it — holding it through a review
              of unknown length would punish somebody for doing exactly what they
              were asked. But an answer is not compliance: writing "paid it"
              settles nothing until HQ has read it, and if they reject it the
              account freezes again. Saying only the first half would be the more
              flattering sentence and the false one. */}
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
            Answering lifts the freeze straight away, so you can work while HQ reads it. It is not
            the end of it: HQ accepts or rejects, and a rejection freezes the account again.
            {notice.status === 'overdue' && ' Answering late is still answering — this is what lifts it.'}
          </p>
          {err && <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{err}</p>}
        </div>
      ) : notice.status === 'responded' ? (
        <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
          Answered and with HQ. Your account can write; HQ decides whether this is settled.
        </p>
      ) : null}
    </li>
  );
}

/**
 * D244 — what the branch's one attempt to fetch its licence from HQ did.
 *
 * The server writes every sentence here; this renders them and invents none.
 * `called` separates "this page asked HQ just now" from "it did not ask" —
 * which covers both a refusal made before calling (no secret, no binding, no
 * throttle store) and a request waiting out an earlier attempt's window, whose
 * own sentence already says which. The retry time is shown in UTC, from the
 * server's ISO stamp, because a reader's local zone is not where the window is
 * kept. An older server sends no `pull`; then nothing is drawn rather than a
 * guess at why.
 */
export function LicencePullNote({ pull }) {
  if (!pull || typeof pull !== 'object') return null;
  const reason = typeof pull.reason === 'string' && pull.reason.trim() ? pull.reason.trim() : null;
  const retry = typeof pull.retry_after === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(pull.retry_after) ? pull.retry_after : null;
  return (
    <div
      data-testid="licence-pull"
      className="mx-auto mt-4 max-w-xl rounded-lg border border-gray-200 bg-gray-50 p-3 text-left text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
    >
      <p className="font-medium text-gray-700 dark:text-gray-200">
        {pull.called
          ? 'This page asked HQ for the licence just now, and it did not arrive.'
          : 'This page did not ask HQ for the licence this time.'}
      </p>
      {reason && <p className="mt-1">{reason}</p>}
      {retry && (
        <p className="mt-1">
          It is asked again on the first visit after{' '}
          <time dateTime={retry}>{`${retry.slice(0, 10)} ${retry.slice(11, 16)} UTC`}</time>.
        </p>
      )}
    </div>
  );
}

/**
 * D800 — the Terms tab's rows the licence row itself carries, chipped
 * "Ledger" (board L2). Built here, with this page's own formatters, so a term
 * the ledger lacks reads "Not recorded" exactly as it always has on this page.
 * `term` names the D799 `REQUESTABLE_TERMS` key a row's "Request a change"
 * opens on; a row without one offers none. `schedule` marks the sections D797's
 * schedule fills (#2242), which say why they are empty until HQ records it.
 */
export function ledgerSections(l) {
  const seats = l?.seats || {};
  const r = (label, value, term) => ({ label, value, source: 'Ledger', ...(term ? { term } : {}) });
  const territories = Array.isArray(l?.territories) && l.territories.length ? l.territories.join(', ') : 'Not recorded';
  const host = l?.domain?.hostname
    ? `${l.domain.hostname} · ${String(l.domain.state || 'Not recorded').replace(/_/g, ' ')}`
    : (l?.domain_available === false ? 'Not recorded' : 'None bound');
  return [
    { title: 'Parties', schedule: true, rows: [
      r('Licensee', [l?.legal_entity_name, l?.registered_address].filter(Boolean).join(', ') || 'Not recorded'),
      r('Signatory', [l?.signatory_name, l?.signatory_title].filter(Boolean).join(', ') || 'Not recorded'),
    ] },
    { title: 'Territory and exclusivity', schedule: true, rows: [r('Countries', territories, 'territory')] },
    { title: 'Term and renewal', schedule: true, rows: [
      r('Start', l?.starts_on ? longDate(l.starts_on) : 'Not recorded', 'term'),
      r('Length', l?.term_years ? `${l.term_years} years` : 'Not recorded', 'term'),
      r('Renewal date', l?.renews_on ? longDate(l.renews_on) : 'Not recorded', 'term'),
    ] },
    { title: 'Fees and money', schedule: true, rows: [
      r('Annual licence fee', fmtMoney(l?.annual_fee_cents, l?.currency), 'fee'),
      r('Revenue share', fmtBps(l?.revenue_share_bps)),
      r('AI token split', fmtBps(l?.token_split_bps)),
    ] },
    { title: 'Deal terms', schedule: true, rows: [] },
    { title: 'Seats', rows: ['founder', 'investor', 'advisor', 'partner'].map((k) => r(
      SEAT_LABEL[k], seats[k] === null || seats[k] === undefined ? 'Not recorded' : String(seats[k]), 'seats',
    )) },
    { title: 'Brand and platform', rows: [
      r('Brand name', l?.brand_name || 'Not recorded'),
      r('Kind', kindLabel(l?.kind)),
      r('Custom host', host),
    ] },
    { title: 'Compliance and reporting', schedule: true, ladder: true, rows: [] },
  ];
}

function MyLicencePageBody({ tab = 'summary' }) {
  const { user } = useAuth();
  const onBranch = Boolean(branchOfUser(user));
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  // D136 — A SECOND, INDEPENDENT READ. The notices are not part of
  // `GET /licence/mine` and their failure is not the licence's: a page that
  // dropped the terms because the notice table could not be read would take the
  // working half down with the broken one, and a frozen administrator needs
  // both. `undefined` is loading, `null` is unreadable, `[]` is none — the same
  // three states `AdminsEditor` draws, because an empty list and a failed read
  // are different claims.
  const [notices, setNotices] = useState(undefined);
  const [noticesReason, setNoticesReason] = useState('');

  const loadNotices = useCallback(() => {
    api.myNotices()
      .then((d) => {
        if (d?.notices_available === false) {
          setNotices(null);
          setNoticesReason(d.notices_reason || 'Your notices could not be read.');
          return;
        }
        setNotices(Array.isArray(d?.items) ? d.items : []);
        setNoticesReason('');
      })
      .catch((e) => {
        reportError('MyLicencePage:notices', e);
        setNotices(null);
        setNoticesReason(e?.message || 'Your notices could not be read.');
      });
  }, []);
  useEffect(loadNotices, [loadNotices]);
  // D800 — an answer changes what waits on the Administrator, so the Licences
  // row's count and "Needs you" read again with the notices.
  const onAnswered = useCallback(() => { loadNotices(); refreshLicenceNeeds(); }, [loadNotices]);

  // D197 — EXTRACTED SO THE DOMAIN WIZARD CAN RE-READ IT. The wizard's three
  // writes change a field on this very payload (`licence.domain`), so it hands
  // back the loader rather than holding a second copy of the row — the tile-vs-
  // table disagreement D128 ended, one component down.
  const loadLicence = useCallback(() => {
    api.myLicence()
      .then(setData)
      .catch((e) => {
        // 404 is "you administer none", not a failure. The distinction matters:
        // one is an empty state, the other is a broken page.
        //
        // D107 — and on a branch there is a THIRD state wearing the same 404.
        // `licence_not_pushed` means this deployment exists and HQ has not
        // sent it its licence yet: provisioning has not finished. Rendering
        // that as "you do not administer a territory licence" would tell the
        // one person on the deployment who DOES administer it that they do
        // not, and would send them to ask HQ for an assignment they already
        // have. The two need different sentences because they need different
        // actions from support.
        //
        // D244 — and the 404 now says WHY no copy arrived. A missing copy is
        // fetched from HQ once, and `pull` carries what that attempt did — or
        // why none was made — in a sentence written for this reader. Kept
        // beside the answer, not instead of it: "not pushed yet" is true in
        // every one of those cases and tells an administrator nothing to do.
        if (e?.status === 404 && e?.data?.error === 'licence_not_pushed') {
          setData({ notPushed: true, branch: e?.data?.branch || null, pull: e?.data?.pull || null });
        } else if (e?.status === 404) setData({ none: true });
        else { reportError('MyLicencePage:load', e); setErr(e?.message || 'Could not load your licence'); }
      });
  }, []);
  useEffect(loadLicence, [loadLicence]);

  if (err) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle size={15} className="mr-1.5 -mt-0.5 inline" />{err}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={15} className="animate-spin" /> Loading your licence…
      </div>
    );
  }

  if (data.notPushed) {
    return (
      <div className="mx-auto max-w-4xl p-6" data-testid="licence-not-pushed">
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">Licences</h1>
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            HQ has not pushed this branch its licence yet.
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            This deployment{data.branch ? ` (${data.branch})` : ''} is running, and the licence
            terms behind it are held at HQ until they are copied here. This is a provisioning
            step that has not finished — not a licence you are missing.
          </p>
          <LicencePullNote pull={data.pull} />
        </div>
      </div>
    );
  }

  // D800 — board L7's "No licence on record". HQ links a licence to an
  // account; the Administrator cannot, so the one action is to ask HQ.
  if (data.none) {
    return (
      <div className="mx-auto mt-10 max-w-xl p-6" data-testid="licence-none">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            Your account is not linked to a licence. Ask HQ.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Licences are issued and linked by Axal VC HQ. Once yours is linked, its terms, contract
            and statements appear here.
          </p>
          <Link to="/help" className="rounded-md bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
            Contact HQ
          </Link>
        </div>
      </div>
    );
  }

  const l = data.licence || {};
  const seats = l.seats || {};
  const state = pageState(data);
  // D797's schedule rides `/mine` as `terms` once HQ records it; until then it
  // is absent, and every term reads "Not recorded" with the reason.
  const terms = data.terms && typeof data.terms === 'object' ? data.terms : null;
  const seatView = seatRows(l);

  const seatsCard = (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="licence-seats">
      <div className="flex items-center justify-between gap-2.5 px-4 py-3 text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
        <span>Seats</span>
        <Link to={`${tabPath('requests')}?kind=seat_increase`} className="text-[11.5px] font-bold text-slate-700 dark:text-slate-300">Request seats</Link>
      </div>
      <div className="space-y-2.5 border-t border-gray-100 px-4 pb-3.5 pt-2.5 dark:border-gray-800">
        {/* D127 / D129 — A BRANCH COUNTS ITS OWN SEATS; HQ COUNTS NONE. The
            used figure is read per type off `seats_used_by_type` and never
            summed or derived here; on HQ that map is absent, so no bar is
            filled and the sentence says why rather than drawing a zero. */}
        {!seatView.counted && (
          <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400" data-testid="licence-seats-not-counted">
            Seats used is not counted on HQ yet
          </p>
        )}
        {seatView.rows.map(({ key: k, ...r }) => (
          <div key={k} className="space-y-1">
            <div className="flex justify-between text-[12.5px]">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{SEAT_LABEL[k]}</span>
              <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
                {r.used === null ? 'Not recorded' : r.used} / {seatFigure(seats[k])}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={`h-1.5 rounded-full ${r.near ? 'bg-amber-700' : 'bg-slate-700 dark:bg-slate-300'}`} style={{ width: `${r.pct}%` }} />
            </div>
          </div>
        ))}
        {data.derived_metrics_available === false && data.derived_metrics_reason && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{data.derived_metrics_reason}</p>
        )}
      </div>
    </section>
  );

  // D142 / S7 — WHAT A SUSPENSION ACTUALLY DOES, on the page that holds
  // the licence it was done to. The shell bar announces a refusal at the
  // moment it happens; this is the state, and the split is the one
  // `AdminFrozenBar` already draws between a bar and this page.
  //
  // THE TWO LISTS COME FROM `lib/branchFreeze.js`, NOT FROM COPY TYPED
  // HERE. The Locked column is a claim about what the SERVER refuses, and
  // a hand-written version of it is a second copy of a rule that lives in
  // `requireBranchNotSuspended`'s call sites. `branch_shell_s7_s13` asserts
  // the files named there are exactly the files that call the gate, so a
  // sixth gate with no row — or a row naming a file with no gate — fails
  // the build rather than quietly mis-describing the product. D800 draws it
  // inside board L7's Suspended banner, which is where "what still works and
  // what is frozen" sits on the canvas.
  const suspendedDetail = l.status === 'suspended' && (
    <section
      data-testid="branch-suspended-detail"
      className="mt-3 rounded-lg border border-rose-200 bg-white/70 p-3.5 dark:border-rose-900 dark:bg-rose-950/30"
    >
      <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">
        Queues frozen by HQ{l.suspended_at ? ` since ${fmtDate(l.suspended_at)}` : ''}.
      </h2>
      <p className="mt-1 text-[13px] text-rose-900/90 dark:text-rose-200/90">
        Your database is intact and nothing here is deleted. {FREEZE_RULE}
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Still readable · your database, untouched
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {STILL_READABLE.map((r) => (
              <li key={r.row} className="text-[12.5px] text-gray-700 dark:text-gray-300">
                <span className="font-semibold">{r.row}</span> — {r.note}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
            Locked · frozen by HQ
          </div>
          <ul className="mt-1.5 space-y-1.5" data-testid="branch-locked-rows">
            {FROZEN.map((r) => (
              <li key={r.row} className="text-[12.5px] text-gray-700 dark:text-gray-300">
                <span className="font-semibold">{r.row}</span> — {r.note}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {/* THE ONE DOOR OUT, and it is deliberately not gated by the freeze:
          `routes/branch_escalations.ts` says so in its own header, because
          gating the appeal would freeze the way out of the freeze. Off a
          branch that door refuses, so the absence is named instead. */}
      <LicenceAppeal onBranch={onBranch} />
    </section>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      {/* ABOVE THE BRAND NAME, DELIBERATELY. A frozen administrator's first
          question is not which territory this is. The banner is the page's
          first statement on every tab and the tab below it still renders — a
          freeze stops writes, not reading, and a page that replaced itself
          would be enforcing something the server does not. */}
      {Array.isArray(notices) && <NoticeBanner notices={notices} />}
      <div className="space-y-2">
        <LicenceHeader licence={l} terms={terms} />
        {/* D107 — a copy shows its age. On HQ `source` is absent and nothing
            renders here: HQ's read IS the ledger, and stamping it would claim
            a staleness it does not have. */}
        <CopyStamp data={data} />
        {l.status_note && l.status !== 'suspended' && (
          <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {l.status_note}
          </p>
        )}
        <LicenceTabs />
      </div>

      {tab === 'summary' && (
        <LicenceSummary
          licence={l}
          terms={terms}
          termsReason={data.terms_reason}
          user={user}
          state={state}
          seats={seatsCard}
          suspended={suspendedDetail}
          after={(
            <div className="grid gap-3 lg:grid-cols-2">
              <BranchSettingsLink onBranch={onBranch} />
              {/* S17–S19 — D197. THE WIZARD IS MOUNTED HERE BECAUSE THIS IS
                  ALREADY THE HOLDER'S OWN VIEW: `/admin/my-licence` resolves
                  through `licence_admins`, which is the same membership the
                  three domain writes are gated on, so the screen and the route
                  agree about who is asking without a second identity check.
                  On a branch the server answers `domain_available: false` with
                  its reason, because the host register is HQ's — so the wizard
                  states that instead of offering a form whose every write would
                  answer 501. The canvas draws the host as a Terms row; this is
                  where it is bound. */}
              <Panel icon={Globe} title="Custom host">
                <DomainWizard
                  domain={l.domain || null}
                  available={l.domain_available}
                  reason={l.domain_reason}
                  onChanged={loadLicence}
                />
              </Panel>
            </div>
          )}
        />
      )}

      {/* A frozen licence keeps its request lane open (D142 locks the queues, not
          the way to HQ); a terminated one has nothing left to change. */}
      {tab === 'terms' && (
        <LicenceTerms sections={ledgerSections(l)} reason={data.terms_reason} canRequest={l.status !== 'terminated'} />
      )}

      <PartTwoPlaceholder tab={tab} />

      {tab === 'history' && (
        <div className="space-y-4" data-testid="licence-history">
          {state === 'suspended' && <LicenceStateBanner banner={stateBanner(state, l)} />}
          <Panel icon={Bell} title="Notices from HQ">
            {notices === undefined && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            )}
            {/* An unreadable store is not an empty inbox — telling somebody
                whose account is frozen that they have no notices would leave
                them with no route out of the freeze. */}
            {notices === null && (
              <p data-testid="licence-notices-unavailable" className="text-sm text-gray-500 dark:text-gray-400">
                {noticesReason} This is not the same as having none — nothing was read.
              </p>
            )}
            {Array.isArray(notices) && notices.length === 0 && (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">
                HQ has sent you no notices.
              </p>
            )}
            {Array.isArray(notices) && notices.length > 0 && (
              <ul className="space-y-3">
                {notices.map((n) => (
                  <NoticeCard key={n.uid} notice={n} onAnswered={onAnswered} />
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              HQ issues these; the deadline is theirs. What is yours is the answer — and answering is
              what lifts a freeze, including after the deadline has passed.
            </p>
          </Panel>

          <Panel icon={History} title="Licence history">
            {/* D107 — an empty array and an UNAVAILABLE trail are different claims
                and must not share a sentence. `licence_events` is HQ's append-only
                record and is not pushed to a branch, so the server sends
                `events_available: false` with its reason; rendering that as
                "Nothing recorded yet" would tell a branch admin that nothing has
                happened to their licence, which is a statement about HQ's data
                that this deployment cannot make. Checked BEFORE the length test,
                since the array is empty in both cases. */}
            {data.events_available === false ? (
              <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="licence-events-unavailable">
                {data.events_reason}
              </p>
            ) : (data.events || []).length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.events.map((e, i) => (
                  <li key={`${e.created_at}-${i}`} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 text-sm sm:grid-cols-[150px_110px_minmax(0,1fr)]" data-testid="licence-event">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{eventLabel(e.event)}</span>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{longDate(e.created_at)}</span>
                    <span className="text-gray-600 dark:text-gray-400">{e.note || 'by HQ'}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Append-only. Nothing here is ever edited or removed — a contract dispute is exactly
              the case where an overwritten status is useless.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}

/** An event's machine word as board L6 names it: `terms_changed` → "Terms changed". */
export function eventLabel(event) {
  const s = String(event || '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Not recorded';
}

// D774 (#2100): S39 drew no rail. The board's page, in the Admin boards' frame.
// D800 (#2233): one page for the six tabs; `tab` is the sub-path App.jsx routed.
export default function MyLicencePage({ tab = 'summary' }) {
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads your licence on this page. It changes nothing." data-testid="admin-board-settings">
      <MyLicencePageBody tab={tab} />
    </AdminBoardFrame>
  );
}
