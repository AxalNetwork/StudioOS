/**
 * D814 (#2260) — `/product-testing`, board D3 of the "StudioOS · Newsletter
 * and Product testing" prompt (prompt 2 on #2255). Built from the prompt's
 * written boards on the owner's ruling of 2026-10-20 20:12Z; the canvas's
 * restyle is a follow-up S1 files when it lands.
 *
 * TWO TABS, IN THE URL. `?tab=` is `open` (Open programmes, the default) or
 * `applications` (My applications), and a tab change replaces it. The bell's
 * product-testing notifications link to `?tab=applications`.
 *
 * EVERY READ IS D812's (`productTestingApi`, `lib/api/productTesting.js`):
 * the open programmes with the consent sentence, and the caller's
 * applications. Each list is loading, unreadable (with Try again), empty or
 * ready on its own. No figure is invented: a count, a date or a place that is
 * not recorded says so.
 *
 * APPLY. The Worker lists only what the caller may apply to, and checks again
 * on apply. A programme that filled or closed while the page was open, or one
 * not for the caller's role, holds its Apply and says why
 * (`applyBlock`). The sheet asks each of the programme's questions, the
 * availability, and the required consent "Email me about this programme";
 * Submit waits for all of them. A refusal shows the Worker's own sentence.
 *
 * WITHDRAW takes an applied or a picked application (`withdrawable`), as the
 * Worker does; a refusal shows its sentence on the row.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CircleAlert, FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { productTestingApi } from '../../lib/api.js';
import { reportError } from '../../lib/log.js';
import { Lightbox, Pill, RailFrame, WorkerRail, usePhoneWidth } from '../../ui';
import {
  ANSWER_MAX, AVAILABILITY_MAX, TABS, applyBlock, canSubmit, day, placesLine, rolesLine, statusPill, tabOf, testingLine, withdrawable,
} from './productTestingModel.js';

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40';
const BUTTON = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:hover:bg-violet-500`;
const GHOST = `${BUTTON} border border-axal-hairline text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800`;

const loading = { state: 'loading' };

/** One read's state: loading, unreadable (with the error), or ready. */
function useRead(load) {
  const [read, setRead] = useState(loading);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead(loading);
    load().then((data) => { if (alive) setRead({ state: 'ready', data }); })
      .catch((e) => { if (alive) { reportError('ProductTesting', e); setRead({ state: 'unreadable', error: e }); } });
    return () => { alive = false; };
  }, [load, n]);
  return [read, useCallback(() => setN((x) => x + 1), [])];
}

export function Pending({ testId }) {
  return (
    <div className={`${CARD} flex items-center gap-2 text-[13px] text-axal-muted dark:text-gray-400`} role="status" data-testid={testId}>
      <Loader2 size={14} className="animate-spin" /> Loading…
    </div>
  );
}

export function UnreadableState({ what, onRetry, testId }) {
  return (
    <div className={`${CARD} flex flex-wrap items-center gap-2 text-[13px]`} role="alert" data-testid={testId}>
      <CircleAlert size={15} className="text-red-600 dark:text-red-400" />
      <b className="text-axal-ink dark:text-gray-100">Unreadable</b>
      <span className="text-axal-muted dark:text-gray-400">{what} could not be read.</span>
      <button type="button" className={`${GHOST} ml-auto`} onClick={onRetry} data-testid={`${testId}-retry`}><RefreshCw size={13} /> Try again</button>
    </div>
  );
}

function Empty({ children, testId }) {
  return <div className={`${CARD} text-[13px] text-axal-muted dark:text-gray-400`} data-testid={testId}>{children}</div>;
}

/** The product's mark: its first letter. The logo key has no route that serves it yet. */
function Mark({ name }) {
  const letter = String(name || '?').trim()[0]?.toUpperCase() || '?';
  return <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-axal-lavender text-[15px] font-extrabold text-axal-violet-deep dark:bg-violet-900/40 dark:text-violet-300">{letter}</span>;
}

export function ProgrammeCard({ programme: p, role, onApply, now }) {
  const block = applyBlock(p, role, now);
  const closes = day(p.closes_at);
  return (
    <article className={`${CARD} flex flex-col gap-3`} data-testid={`programme-${p.uid}`}>
      <header className="flex items-start gap-3">
        <Mark name={p.product_name} />
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">{p.product_name}</h3>
          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
            <span>Run by {p.owner_name || 'Not recorded'}</span>
            {p.owner_kind === 'partner' && <Pill tone="seam" data-testid={`pill-partner-${p.uid}`}>Partner</Pill>}
            {p.my_status && <Pill tone={statusPill(p.my_status).tone}>{statusPill(p.my_status).label}</Pill>}
          </p>
        </div>
      </header>
      {p.summary && <p className="text-[13px] text-axal-ink dark:text-gray-200">{p.summary}</p>}
      <dl className="grid gap-1.5 text-[12.5px] sm:grid-cols-2">
        <div><dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">What testers do</dt><dd className="text-axal-ink dark:text-gray-200">{p.tester_tasks || 'Not recorded'}</dd></div>
        <div><dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">Time</dt><dd className="text-axal-ink dark:text-gray-200">{p.time_needed || 'Not recorded'}</dd></div>
        <div><dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">Dates</dt><dd className="text-axal-ink dark:text-gray-200">{testingLine(p.testing_starts, p.testing_ends)}{closes ? ` · Apply by ${closes}` : ''}</dd></div>
        <div><dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">Places</dt><dd className="text-axal-ink dark:text-gray-200" data-testid={`places-${p.uid}`}>{placesLine(p)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">Who can apply</dt><dd className="text-axal-ink dark:text-gray-200">{rolesLine(p.eligible_roles)}</dd></div>
      </dl>
      <footer className="mt-auto flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!!block} onClick={() => onApply(p)} data-testid={`apply-${p.uid}`}>Apply</button>
        {block && <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid={`apply-reason-${p.uid}`}>{block}</span>}
      </footer>
    </article>
  );
}

/** The application sheet: the questions, availability, the consent, Submit. */
export function ApplySheet({ programme: p, consent, onClose, onApplied }) {
  const questions = Array.isArray(p.questions) ? p.questions : [];
  const [answers, setAnswers] = useState(() => questions.map(() => ''));
  const [availability, setAvailability] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = canSubmit(questions, answers, agreed) && availability.length <= AVAILABILITY_MAX;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await productTestingApi.apply(p.uid, { answers: answers.map((a) => a.trim()), availability: availability.trim() || null, consentEmail: true });
      onApplied();
    } catch (e) {
      setError(e?.message || 'The application could not be sent.');
      setBusy(false);
    }
  };
  const field = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  return (
    <Lightbox label={`Apply to test ${p.product_name}`} eyebrow="Product testing" title={`Apply to test ${p.product_name}`} sub={`Run by ${p.owner_name || 'Not recorded'}`} onClose={onClose} testId="apply-sheet"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={!ready || busy} onClick={submit} data-testid="apply-submit">{busy ? <Loader2 size={13} className="animate-spin" /> : null}Submit</button>
        </div>
      )}>
      <div className="grid gap-4">
        {questions.map((q, i) => (
          <label key={i} className="block text-[13px] font-semibold text-axal-ink dark:text-gray-100">
            {q}
            <textarea className={field} rows={3} maxLength={ANSWER_MAX} value={answers[i]} data-testid={`apply-answer-${i}`}
              onChange={(e) => { const v = e.target.value; setAnswers((prev) => prev.map((a, j) => (j === i ? v : a))); }} />
          </label>
        ))}
        <label className="block text-[13px] font-semibold text-axal-ink dark:text-gray-100">
          Availability <span className="font-normal text-axal-muted dark:text-gray-400">(optional)</span>
          <input type="text" className={field} maxLength={AVAILABILITY_MAX} value={availability} placeholder="When you can test" data-testid="apply-availability"
            onChange={(e) => setAvailability(e.target.value)} />
        </label>
        <div className="flex items-start gap-3 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
          <button type="button" role="switch" aria-checked={agreed} aria-labelledby="apply-consent-label" data-testid="apply-consent"
            onClick={() => setAgreed((v) => !v)}
            className={`mt-0.5 inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${agreed ? 'bg-axal-violet dark:bg-violet-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${agreed ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <div className="text-[13px]">
            <p id="apply-consent-label" className="font-semibold text-axal-ink dark:text-gray-100">Email me about this programme <span className="font-normal text-axal-muted dark:text-gray-400">(required)</span></p>
            {consent?.text && <p className="text-axal-muted dark:text-gray-400" data-testid="apply-consent-text">{consent.text}</p>}
          </div>
        </div>
        {error && <p className="text-[13px] text-red-700 dark:text-red-300" role="alert" data-testid="apply-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

export function ApplicationRow({ application: a, onWithdrawn }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pill = statusPill(a.status);
  const applied = day(a.applied_at);
  const withdraw = async () => {
    setBusy(true);
    setError(null);
    try { await productTestingApi.withdraw(a.uid); onWithdrawn(); } catch (e) { setError(e?.message || 'The application could not be withdrawn.'); setBusy(false); }
  };
  return (
    <li className={`${CARD} flex flex-wrap items-center gap-3`} data-testid={`application-${a.uid}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{a.product_name || 'Programme not recorded'}</p>
        <p className="text-[12px] text-axal-muted dark:text-gray-400">{testingLine(a.testing_starts, a.testing_ends)}{applied ? ` · Applied ${applied}` : ''}</p>
        {error && <p className="mt-1 text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid={`withdraw-error-${a.uid}`}>{error}</p>}
      </div>
      <Pill tone={pill.tone} data-testid={`status-${a.uid}`}>{pill.label}</Pill>
      {withdrawable(a) && <button type="button" className={GHOST} disabled={busy} onClick={withdraw} data-testid={`withdraw-${a.uid}`}>Withdraw</button>}
    </li>
  );
}

const RAIL_NOTE = 'Applying, and every email to testers, is yours to decide. Eadwyn does not apply for you.';

/**
 * The rail, in the caller's accent. Each mount names its role literally
 * (`branch_rail_mount.test.mjs` keeps computed roles to a ceiling); an
 * exploring member, who has no accent of their own, takes the founder's.
 */
function railFor(role) {
  switch (role) {
    case 'investor': return <WorkerRail workspace="Product testing" role="investor" note={RAIL_NOTE} />;
    case 'advisor': return <WorkerRail workspace="Product testing" role="advisor" note={RAIL_NOTE} />;
    case 'partner': return <WorkerRail workspace="Product testing" role="partner" note={RAIL_NOTE} />;
    case 'admin': return <WorkerRail workspace="Product testing" role="admin" note={RAIL_NOTE} />;
    default: return <WorkerRail workspace="Product testing" role="founder" note={RAIL_NOTE} />;
  }
}

export default function ProductTestingPage({ user }) {
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const tab = tabOf(search);
  const phone = usePhoneWidth();
  const role = user?.role;
  const [programmes, reloadProgrammes] = useRead(productTestingApi.programmes);
  const [applications, reloadApplications] = useRead(productTestingApi.myApplications);
  const [applying, setApplying] = useState(null);
  const [notice, setNotice] = useState(null);

  const choose = (id) => {
    const q = new URLSearchParams(search);
    if (id === 'open') q.delete('tab'); else q.set('tab', id);
    const s = q.toString();
    navigate({ pathname, search: s ? `?${s}` : '' }, { replace: true });
  };
  const applied = () => {
    const name = applying?.product_name;
    setApplying(null);
    setNotice(`You applied to test ${name}. You will hear in the bell whether you are picked.`);
    reloadProgrammes();
    reloadApplications();
  };

  const programmeItems = programmes.state === 'ready' ? (programmes.data?.items || []) : [];
  const applicationItems = applications.state === 'ready' ? (applications.data?.items || []) : [];
  const now = Date.now();

  const body = (
    <div className={phone ? 'grid gap-4 px-4 py-4' : 'grid gap-5'} data-testid="product-testing-page" data-layout={phone ? 'phone' : 'desktop'} data-tab={tab}>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100"><FlaskConical size={20} /> Product testing</h1>
        <p className="mt-1 text-[13.5px] text-axal-muted dark:text-gray-400">Test new products from Axal VC and its partners before they launch.</p>
      </header>
      <nav className="flex gap-1 border-b border-axal-hairline dark:border-gray-700" role="tablist" aria-label="Product testing">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => choose(t.id)} data-testid={`tab-${t.id}`}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === t.id ? 'border-axal-violet text-axal-ink dark:border-violet-400 dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {notice && <p className={`${CARD} text-[13px] text-axal-ink dark:text-gray-100`} role="status" data-testid="apply-notice">{notice}</p>}

      {tab === 'open' && (
        programmes.state === 'loading' ? <Pending testId="programmes-loading" />
          : programmes.state === 'unreadable' ? <UnreadableState what="The open programmes" onRetry={reloadProgrammes} testId="programmes-unreadable" />
            : programmeItems.length === 0 ? <Empty testId="programmes-empty">No programmes are open to you right now. New ones appear here, and on your Studio page.</Empty>
              : (
                <div className={phone ? 'grid gap-3' : 'grid gap-4 xl:grid-cols-2'} data-testid="programmes">
                  {programmeItems.map((p) => <ProgrammeCard key={p.uid} programme={p} role={role} now={now} onApply={(x) => { setNotice(null); setApplying(x); }} />)}
                </div>
              )
      )}

      {tab === 'applications' && (
        applications.state === 'loading' ? <Pending testId="applications-loading" />
          : applications.state === 'unreadable' ? <UnreadableState what="Your applications" onRetry={reloadApplications} testId="applications-unreadable" />
            : applicationItems.length === 0 ? <Empty testId="applications-empty">You have not applied to a programme yet. <Link className="font-semibold underline" to="/product-testing">See open programmes</Link></Empty>
              : (
                <ul className="grid gap-3" data-testid="applications">
                  {applicationItems.map((a) => <ApplicationRow key={a.uid} application={a} onWithdrawn={() => { reloadApplications(); reloadProgrammes(); }} />)}
                </ul>
              )
      )}

      {applying && <ApplySheet programme={applying} consent={programmes.data?.consent} onClose={() => setApplying(null)} onApplied={applied} />}
    </div>
  );

  return (
    <RailFrame rail={railFor(role)} data-testid="product-testing-frame">
      {body}
    </RailFrame>
  );
}
