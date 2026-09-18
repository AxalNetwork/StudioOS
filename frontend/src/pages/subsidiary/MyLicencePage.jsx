import React, { useCallback, useEffect, useState } from 'react';
import {
  Map, Users, Calendar, Percent, Building2, AlertTriangle, Bell, Loader2, History, Lock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { bpsPercent } from '../../lib/bps';
import { FROZEN, STILL_READABLE, FREEZE_RULE } from '../../lib/branchFreeze';
import { reportError } from '../../lib/log';
import { FREEZING_STATUSES, noticeKindLabel } from '../../lib/notices';

/**
 * My Licence — /admin/my-licence. The subsidiary administrator's own view.
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

function Row({ label, value }) {
  const missing = value === 'Not recorded';
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={missing
        ? 'italic text-gray-400 dark:text-gray-500'
        : 'font-medium text-gray-900 tabular-nums dark:text-gray-100'}>{value}</span>
    </div>
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

export default function MyLicencePage() {
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

  useEffect(() => {
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
        if (e?.status === 404 && e?.data?.error === 'licence_not_pushed') {
          setData({ notPushed: true, branch: e?.data?.branch || null });
        } else if (e?.status === 404) setData({ none: true });
        else { reportError('MyLicencePage:load', e); setErr(e?.message || 'Could not load your licence'); }
      });
  }, []);

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
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">My licence</h1>
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            HQ has not pushed this branch its licence yet.
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            This deployment{data.branch ? ` (${data.branch})` : ''} is running, and the licence
            terms behind it are held at HQ until they are copied here. This is a provisioning
            step that has not finished — not a licence you are missing.
          </p>
        </div>
      </div>
    );
  }

  if (data.none) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">My licence</h1>
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            You do not administer a territory licence.
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            HQ assigns licence administrators. If that should be you, ask them to add your
            account to the licence.
          </p>
        </div>
      </div>
    );
  }

  const l = data.licence || {};
  const seats = l.seats || {};

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      {/* ABOVE THE BRAND NAME, DELIBERATELY. A frozen administrator's first
          question is not which territory this is. The banner is the page's
          first statement and the panels below it still render — a freeze stops
          writes, not reading, and a page that replaced itself would be enforcing
          something the server does not. */}
      {Array.isArray(notices) && <NoticeBanner notices={notices} />}
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{l.brand_name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[l.status] || STATUS_TONE.draft}`}>
            {String(l.status || '').replace(/_/g, ' ')}
          </span>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {l.admin_role}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {l.legal_entity_name} · licence {l.licence_ref || 'Not recorded'}
        </p>
        {/* D107 — a copy shows its age. On HQ `source` is absent and nothing
            renders here: HQ's read IS the ledger, and stamping it would claim
            a staleness it does not have. On a branch every HQ-owned figure on
            the screen below came from this one push, so the stamp belongs at
            the top of the page rather than repeated on each panel. */}
        {data.source === 'hq_copy' && (
          <p
            data-testid="licence-as-of"
            className="mt-1 text-xs text-gray-500 dark:text-gray-400"
          >
            Copy pushed by HQ · as of {fmtDate(data.as_of)}. HQ holds the licence itself;
            a change there reaches this page on the next push.
          </p>
        )}
        {l.status_note && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {l.status_note}
          </p>
        )}
      </header>

      {/* D142 / S7 — WHAT A SUSPENSION ACTUALLY DOES, on the page that holds
          the licence it was done to. The shell bar announces a refusal at the
          moment it happens; this is the state, and the split is the one
          `AdminFrozenBar` already draws between a bar and this page.

          THE TWO LISTS COME FROM `lib/branchFreeze.js`, NOT FROM COPY TYPED
          HERE. The Locked column is a claim about what the SERVER refuses, and
          a hand-written version of it is a second copy of a rule that lives in
          `requireBranchNotSuspended`'s call sites. `branch_shell_s7_s13` asserts
          the files named there are exactly the files that call the gate, so a
          sixth gate with no row — or a row naming a file with no gate — fails
          the build rather than quietly mis-describing the product. */}
      {l.status === 'suspended' && (
        <section
          data-testid="branch-suspended-detail"
          className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900 dark:bg-rose-950/30"
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
              gating the appeal would freeze the way out of the freeze. */}
          <p className="mt-3 text-[12.5px] text-rose-900 dark:text-rose-200">
            There is no field on this branch that can change the licence status. The way out is an
            appeal to HQ, which is an escalation like any other —{' '}
            <Link to="/branch/approvals" className="font-semibold underline underline-offset-2">
              open one
            </Link>
            .
          </p>
        </section>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Panel icon={Map} title="Territories held">
          {(l.territories || []).length === 0 ? (
            <p className="text-sm italic text-gray-400 dark:text-gray-500">No territory is held.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {l.territories.map((cc) => (
                <span key={cc} className="rounded-md border border-gray-200 px-2 py-1 font-mono text-xs text-gray-800 dark:border-gray-700 dark:text-gray-200">
                  {cc}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            A country belongs to one licence at a time. Suspension does not release it;
            only termination does.
          </p>
        </Panel>

        <Panel icon={Percent} title="Commercial terms">
          <Row label="Annual fee" value={fmtMoney(l.annual_fee_cents, l.currency)} />
          <Row label="Revenue share" value={fmtBps(l.revenue_share_bps)} />
          <Row label="Token split" value={fmtBps(l.token_split_bps)} />
          <Row label="Term" value={l.term_years ? `${l.term_years} years` : 'Not recorded'} />
        </Panel>

        <Panel icon={Calendar} title="Dates">
          <Row label="Starts" value={fmtDate(l.starts_on)} />
          <Row label="Renews" value={fmtDate(l.renews_on)} />
          {l.suspended_at && <Row label="Suspended" value={fmtDate(l.suspended_at)} />}
          {l.terminated_at && <Row label="Terminated" value={fmtDate(l.terminated_at)} />}
        </Panel>

        <Panel icon={Building2} title="Entity">
          <Row label="Legal entity" value={l.legal_entity_name || 'Not recorded'} />
          <Row label="Registered address" value={l.registered_address || 'Not recorded'} />
          <Row label="Signatory" value={l.signatory_name || 'Not recorded'} />
          <Row label="Title" value={l.signatory_title || 'Not recorded'} />
        </Panel>
      </div>

      <Panel icon={Users} title="Seats licensed">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {['founder', 'investor', 'advisor', 'partner'].map((k) => (
            <div key={k} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="text-xs text-gray-500 dark:text-gray-400">{SEAT_LABEL[k]}</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {seats[k] ?? 0}
              </div>
            </div>
          ))}
        </div>
        {data.derived_metrics_available === false && (
          <p className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
            <strong className="font-semibold">Seats used is not shown.</strong>{' '}
            {data.derived_metrics_reason}
          </p>
        )}
      </Panel>

      <Panel icon={Bell} title="Notices from HQ">
        {notices === undefined && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        )}
        {/* An unreadable store is not an empty inbox — the same distinction the
            two panels above already draw, on the surface where it matters most:
            telling somebody whose account is frozen that they have no notices
            would leave them with no route out of the freeze. */}
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
              <NoticeCard key={n.uid} notice={n} onAnswered={loadNotices} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          HQ issues these; the deadline is theirs. What is yours is the answer — and answering is
          what lifts a freeze, including after the deadline has passed.
        </p>
      </Panel>

      <Panel icon={History} title="History">
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
              <li key={`${e.created_at}-${i}`} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span className="text-gray-900 dark:text-gray-100">
                  {String(e.event).replace(/_/g, ' ')}
                  {e.note && <span className="ml-2 text-gray-500 dark:text-gray-400">{e.note}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-gray-500 dark:text-gray-400">
                  {fmtDate(e.created_at)}
                </span>
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
  );
}
