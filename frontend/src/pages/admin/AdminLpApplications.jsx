// GP Application Review — the admin queue for Spin-Out Fund I LP applications.
//
// Design handoff: GP-Application-Review.dc.html. Recreated natively in the
// admin shell (same pattern as AdminExploring / AdminCohortApplications) rather
// than ported as a standalone page: it inherits the app's auth, nav, dark mode
// and toast conventions.
//
// The design's split layout is kept — queue on the left, detail on the right,
// summary counts across the top — because it is what makes repeated review
// fast: the reviewer never loses queue position to open a record.
//
// ONE DELIBERATE DEPARTURE FROM THE DESIGN. Its decision panel asserts
// "Approvals grant reporting access immediately." That is not true of this
// product and must not be implemented: `lpAccessState()` documents that an
// application raises the access ladder to 'pending' and NO FURTHER, even when
// approved, because the reporting archive is keyed to a `limited_partners`
// holding an approved applicant does not yet have. The Downstream panel below
// therefore reports what actually happens — approval unblocks LPA issuance;
// access follows the countersigned LPA — and the worker returns those lines
// rather than the page asserting them. Shipping the design's sentence would
// promise portfolio disclosure to someone who has signed nothing.
//
// Not reproduced from the design: bulk approve/decline and side-by-side
// comparison. Both are real conveniences, but a bulk decline cannot satisfy
// the per-application reason the API (rightly) requires, and shipping a
// disabled-looking control is worse than leaving it out.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700';
const LBL = 'text-[10.5px] font-bold uppercase tracking-[0.11em] text-gray-400 dark:text-gray-500';

// Tabs mirror the design's segmentation. `open` is the roll-up the worker
// computes (pending + in_review + needs_follow_up) and is the default view:
// the queue should open on what still needs a human.
const TABS = [
  { key: 'open', label: 'Needs action' },
  { key: 'pending', label: 'New' },
  { key: 'in_review', label: 'In review' },
  { key: 'needs_follow_up', label: 'Needs follow-up' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: '', label: 'All' },
];

const STATUS_STYLE = {
  pending: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  in_review: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  needs_follow_up: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  declined: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  withdrawn: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
};

// Decline is last and visually quietest — it is the destructive action, and it
// is the one the API refuses without a reason.
const ACTIONS = [
  { status: 'approved', label: 'Approve', cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
  { status: 'in_review', label: 'Mark in review', cls: 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50' },
  { status: 'needs_follow_up', label: 'Request follow-up', cls: 'bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300' },
  { status: 'declined', label: 'Decline', cls: 'bg-white dark:bg-gray-800 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50' },
];

const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US')}`);
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

function StatusChip({ status, label }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.withdrawn}`}>
      {label}
    </span>
  );
}

export default function AdminLpApplications() {
  const [tab, setTab] = useState('open');
  const [apps, setApps] = useState([]);
  const [counts, setCounts] = useState({});
  const [selId, setSelId] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState(null);
  const [downstream, setDownstream] = useState([]);
  // Which fund's queue is on screen. lp_applications has always been per-fund
  // (migration 165 keys its unique index on fund_slug); the queue read one
  // hardcoded slug, so a Fund II application was written and then invisible.
  const [fund, setFund] = useState('');
  const [funds, setFunds] = useState([]);

  const load = useCallback(async (keepSel) => {
    try {
      // Always fetch the full set and segment client-side: the counts must not
      // change as the reviewer switches tabs, and it keeps tab switching instant.
      const r = await api.adminLpApplications(fund || undefined);
      const list = Array.isArray(r?.applications) ? r.applications : [];
      setApps(list);
      setCounts(r?.counts || {});
      setFunds(Array.isArray(r?.funds) ? r.funds : []);
      if (!fund && r?.fund_slug) setFund(r.fund_slug);
      setStatus('ready');
      if (!keepSel) setSelId((prev) => (prev && list.some((a) => a.id === prev) ? prev : (list[0]?.id ?? null)));
    } catch (e) {
      reportError('AdminLpApplications:load', e);
      setStatus('error');
    }
  }, [fund]);

  useEffect(() => { load(false); }, [load]);

  const shown = useMemo(() => {
    let list = apps;
    if (tab === 'open') list = list.filter((a) => ['pending', 'in_review', 'needs_follow_up'].includes(a.status));
    else if (tab) list = list.filter((a) => a.status === tab);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) => `${a.name} ${a.firm || ''} ${a.email}`.toLowerCase().includes(q));
    // Oldest first — the queue's job is to surface what has waited longest.
    return [...list].sort((a, b) => b.age_days - a.age_days);
  }, [apps, tab, search]);

  const sel = useMemo(() => apps.find((a) => a.id === selId) || null, [apps, selId]);

  // Clear the note draft when moving to a different application, so one
  // applicant's reasoning can never be saved onto another's record.
  useEffect(() => { setNote(''); setFlash(null); setDownstream([]); }, [selId]);

  const decide = async (nextStatus) => {
    if (!sel || busy) return;
    const trimmed = note.trim();
    if (nextStatus === 'declined' && !trimmed) {
      setFlash({ kind: 'error', msg: 'A decline needs a reason — the applicant is shown this note.' });
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      const r = await api.adminLpApplicationReview(sel.id, {
        status: nextStatus,
        ...(trimmed ? { review_note: trimmed } : {}),
      });
      if (r?.application) {
        setApps((prev) => prev.map((a) => (a.id === r.application.id ? r.application : a)));
        setCounts({}); // stale until the refetch below lands
      }
      setDownstream(Array.isArray(r?.downstream) ? r.downstream : []);
      setNote('');
      setFlash({ kind: 'ok', msg: `Recorded — ${r?.application?.status_label || titleCase(nextStatus)}.` });
      load(true);
    } catch (e) {
      reportError('AdminLpApplications:decide', e);
      setFlash({ kind: 'error', msg: e?.message || 'Could not record the decision.' });
    } finally {
      setBusy(false);
    }
  };

  const saveNoteOnly = async () => {
    if (!sel || busy || !note.trim()) return;
    // Re-stating the current status with a note is how the API records a note
    // without changing the decision.
    await decide(sel.status === 'pending' ? 'in_review' : sel.status);
  };

  if (status === 'loading') {
    return (
      <div className="p-6 flex items-center gap-2 text-gray-500" data-testid="lpapps-loading">
        <Loader2 size={16} className="animate-spin" /> Loading the application queue…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="p-6" data-testid="lpapps-error">
        <div className={`${CARD} p-6 max-w-lg`}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-none" />
            <div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">Could not load the queue</div>
              {/* Never render an empty queue on failure — that reads as "no
                  applications waiting", which is how a submission goes unseen. */}
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                The application store did not respond. This is not the same as an empty queue —
                there may be applications waiting.
              </p>
              <button type="button" onClick={() => { setStatus('loading'); load(false); }}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium">
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1560px] mx-auto" data-testid="lpapps-page">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">GP Application Review</h1>
        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800">
          Internal · not LP-visible
        </span>
        {funds.length > 1 ? (
          <select
            value={fund}
            onChange={(e) => { setFund(e.target.value); setSelId(null); }}
            data-testid="lpapps-fund"
            className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 outline-none"
          >
            {funds.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
          </select>
        ) : (
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
            {funds[0]?.name || 'Axal VC Spin-Out Lab Fund I'}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Status changes are logged against your name with a timestamp.
      </p>

      {/* summary counts */}
      <div className="flex gap-6 overflow-x-auto border-b border-gray-200 dark:border-gray-700 mb-5">
        {TABS.filter((t) => t.key).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            data-testid={`lpapps-tab-${t.key}`}
            className={`flex-none pb-3 pt-1 text-left border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-violet-600' : 'border-transparent'}`}>
            <div className={`text-xl font-extrabold tabular-nums ${tab === t.key ? 'text-violet-700 dark:text-violet-400' : 'text-gray-900 dark:text-gray-100'}`}>
              {counts[t.key] ?? 0}
            </div>
            <div className={`${LBL} whitespace-nowrap mt-0.5`}>{t.label}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_1.35fr] gap-4 items-start">
        {/* ── queue ── */}
        <div className={`${CARD} overflow-hidden`}>
          <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, firm or email…"
              data-testid="lpapps-search"
              className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 outline-none" />
            <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">{shown.length} of {apps.length}</span>
          </div>
          <div className="max-h-[calc(100vh-360px)] overflow-y-auto">
            {shown.length === 0 ? (
              <div className="p-11 text-center" data-testid="lpapps-empty">
                <div className="text-sm font-bold text-gray-600 dark:text-gray-300">Nothing in this view</div>
                <div className="text-xs text-gray-400 mt-1">
                  {apps.length === 0
                    ? 'No LP applications have been submitted for this fund yet.'
                    : 'No applications match the current filter or search.'}
                </div>
              </div>
            ) : shown.map((a) => (
              <button key={a.id} type="button" onClick={() => setSelId(a.id)}
                data-testid={`lpapps-row-${a.id}`}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 border-l-2 transition-colors ${
                  selId === a.id ? 'bg-violet-50 dark:bg-violet-900/20 border-l-violet-600' : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{a.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {a.firm || 'Independent'} · {titleCase(a.investor_type)}
                    </div>
                  </div>
                  <StatusChip status={a.status} label={a.status_label} />
                </div>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="text-xs font-bold tabular-nums text-gray-900 dark:text-gray-100">{money(a.target_commitment)}</span>
                  <span className={`ml-auto text-[11px] tabular-nums ${a.age_days >= 14 ? 'text-red-600' : a.age_days >= 7 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {a.age_days === 1 ? '1 day' : `${a.age_days} days`}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── detail ── */}
        {!sel ? (
          <div className={`${CARD} p-8 text-center text-sm text-gray-500`}>Select an application to review.</div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="lpapps-detail">
            <div className={`${CARD} p-5`}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{sel.name}</span>
                    <StatusChip status={sel.status} label={sel.status_label} />
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {sel.firm || 'Independent'} · {titleCase(sel.investor_type)}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{sel.email}</div>
                </div>
                <div className="text-right flex-none">
                  <div className="text-xl font-extrabold tabular-nums text-violet-700 dark:text-violet-400">{money(sel.target_commitment)}</div>
                  <div className={LBL}>Indicated commitment</div>
                </div>
              </div>
            </div>

            {/* submitted application */}
            <div className={`${CARD} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700"><span className={LBL}>Submitted application</span></div>
              {[
                ['Investor type', titleCase(sel.investor_type)],
                ['Indicated commitment', money(sel.target_commitment)],
                ['Preference areas', sel.preference_areas.length ? sel.preference_areas.map(titleCase).join(' · ') : '—'],
                ['Accreditation', 'Self-certified at submission (Rule 501)'],
                ['Submitted', sel.created_at || '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 px-5 py-2.5 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex-none w-40 text-xs font-semibold text-gray-400">{k}</div>
                  <div className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300">{v}</div>
                </div>
              ))}
              <div className="px-5 py-4">
                <div className={`${LBL} mb-2`}>Why this fund</div>
                <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sel.note || <span className="text-gray-400">Not provided.</span>}</div>
              </div>
            </div>

            {/* decision */}
            <div className={`${CARD} p-5`}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className={LBL}>Decision</span>
                <span className="text-[11px] text-gray-400 tabular-nums">
                  {sel.reviewer_name ? `Last action by ${sel.reviewer_name}${sel.reviewed_at ? ` · ${sel.reviewed_at}` : ''}` : 'No reviewer assigned'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Logged against your name. Declining requires a reason — the applicant is shown it.
              </p>
              <div className="flex gap-2 flex-wrap">
                {ACTIONS.map((a) => (
                  <button key={a.status} type="button" disabled={busy}
                    onClick={() => decide(a.status)}
                    data-testid={`lpapps-action-${a.status}`}
                    className={`px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed ${a.cls}`}>
                    {busy ? '…' : a.label}
                  </button>
                ))}
              </div>

              {flash && (
                <div data-testid="lpapps-flash"
                  className={`mt-3 text-sm font-medium ${flash.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {flash.kind === 'ok' && <Check size={13} className="inline mr-1" />}{flash.msg}
                </div>
              )}

              {downstream.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800" data-testid="lpapps-downstream">
                  <div className={`${LBL} mb-2`}>Downstream</div>
                  {downstream.map((d) => (
                    <div key={d.key} className="flex items-start gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-none ${d.done ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <div className="min-w-0">
                        <div className={`text-xs font-bold ${d.done ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>{d.label}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{d.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <span className={LBL}>Internal review note</span>
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                  data-testid="lpapps-note"
                  placeholder="Record the reasoning — what you verified, what remains open, what the applicant was told."
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 outline-none resize-y" />
                <button type="button" onClick={saveNoteOnly} disabled={busy || !note.trim()}
                  data-testid="lpapps-save-note"
                  className="mt-2 px-4 py-2 rounded-lg text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed">
                  Save note
                </button>
              </div>

              {sel.review_note && (
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                  <div className={`${LBL} mb-1.5`}>Recorded reason</div>
                  <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sel.review_note}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
