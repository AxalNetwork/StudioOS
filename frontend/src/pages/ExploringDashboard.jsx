// Task #9 — Holding-state dashboard for role='exploring' users.
//
// Auth v2 (A3d) — membership review runs in the background while the user
// keeps working. Three actions stay held; the rest of the workspace is live.
//
// D8730 (#8730) — built to SPV10 to SPV13, SPV23, SPV26 and SPV27 of
// `design/incoming/Studio Home Previews Page.dc.html`. One next step per state
// (`exploringModel.js`), Eadwyn, "Where things stand" with profiling Not
// applicable while exploring (so the page no longer says both "Profiling
// questions don't apply" and "Complete your profiling to unlock"), and, on the
// founder track, the pages an Exploring account can open beside the ones that
// open with membership, which draw no link. An admin here is previewing the
// Exploring ROLE: they pick the visitor state to show, the questions are
// labelled examples, and nothing of their own account is drawn.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Compass, Lock, Rocket } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { useViewMode } from '../contexts/ViewModeContext';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { rolePreviewOf } from '../lib/previewShells';
import { usePhoneWidth } from '../ui/phone/usePhoneWidth.js';
import { StateChip } from '../ui/Honesty';
import PersonalAdvisor from '../components/advisor/PersonalAdvisor';
import { STUDIO_CHAT_ANCHOR } from '../components/advisor/interviewCompleteRow';
import { ExampleChip, NotApplicableChip, RolePreviewInterview, RolePreviewNotice } from '../components/RolePreviewParts';
import { EXPLORING_DEFAULT_EXAMPLE, EXPLORING_EXAMPLE_STATES, exampleStateOf } from '../components/rolePreviewModel';
import {
  AVAILABLE_NOW, OPENS_WITH_MEMBERSHIP, PROFILING_LINE, PROFILING_NA, STICKY_NOTE, TRACK_LABELS,
  discoveryOf, exploringStateOf, nextStepFor, trackOf, welcomeLine,
} from './exploringModel';
// D1337 (#3542): any member with a profile may join the tester pool, Explorers included (D1335 §3).
import ProductTestingStudio from './testing/member/ProductTestingStudio';

// The sentences after "The Axal team" on each track (the first step's body and "Discovery finished").
const LANE_COPY = {
  founder: {
    label: 'Founder',
    next: 'reviews your venture profile and sends a membership agreement to sign. Once it is signed, a short venture setup opens your workspace with the Spin-Out Lab tools.',
    cta: { to: '/spinout-lab', label: 'Apply to the Spin-Out Lab' },
  },
  investor: {
    label: 'Investor',
    next: 'reviews your investor profile and sends a membership agreement to sign. Once it is signed, deal flow and diligence surfaces open up.',
  },
  partner: {
    label: 'Partner',
    next: 'reviews your partner profile and sends a membership agreement to sign. Once it is signed, your partner workspace and referral tools open up.',
  },
  advisor: {
    label: 'Advisor',
    next: 'reviews your advisor profile and sends a membership agreement to sign. Once it is signed, your practice and office-hours surfaces open up.',
  },
};

/** Moves focus to Eadwyn: the first role option, the composer, or the panel. */
function focusEadwyn() {
  if (typeof document === 'undefined') return;
  const box = document.getElementById(STUDIO_CHAT_ANCHOR);
  if (!box) return;
  box.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  const target = box.querySelector('textarea, input:not([type="hidden"]), [role="radio"], button:not([disabled])');
  (target || box).focus?.();
}

function StepAction({ action, testId }) {
  if (!action) return null;
  const cls = action.button
    ? 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700'
    : 'inline-flex min-h-11 items-center text-sm font-semibold text-violet-700 underline dark:text-violet-300';
  if (action.kind === 'link') {
    return <Link to={action.to} data-testid={testId} className={cls}>{action.button && <Rocket size={15} aria-hidden="true" />}{action.label}</Link>;
  }
  return <button type="button" onClick={focusEadwyn} data-testid={testId} className={cls}>{action.label}</button>;
}

function NextStep({ step, phone, onRetryEadwyn }) {
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100" aria-labelledby="exploring-next-h" data-testid="exploring-next-step">
      <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800 dark:text-sky-300">{step.eyebrow}</p>
      <h2 id="exploring-next-h" className="mt-1 text-[18px] font-extrabold tracking-tight">{step.heading}</h2>
      <p className="mt-1.5 max-w-[720px] text-sm">{step.body}</p>
      {step.unavailable && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="exploring-eadwyn-unavailable">
          <StateChip kind="unavailable" />
          <button type="button" onClick={onRetryEadwyn} className="min-h-11 font-bold text-violet-700 hover:underline dark:text-violet-300">Retry</button>
        </p>
      )}
      {step.action && (phone && step.action.button
        ? <p className="mt-2 text-[12px] text-sky-800 dark:text-sky-300">{STICKY_NOTE}</p>
        : <div className="mt-3"><StepAction action={step.action} testId="exploring-lane-cta" /></div>)}
    </section>
  );
}

function WhereThingsStand({ role, discovery, preview, onRetry }) {
  const track = trackOf(role);
  let count;
  if (preview) count = <><NotApplicableChip /><span className="block text-[12px] text-axal-muted dark:text-gray-400">A visitor’s own count.</span></>;
  else if (!track) count = <><NotApplicableChip>Not applicable</NotApplicableChip><span className="block text-[12px] text-axal-muted dark:text-gray-400">They follow your role.</span></>;
  else if (discovery.state === 'loading') count = <span className="text-[12px] text-axal-muted" aria-busy="true">Reading…</span>;
  else if (discovery.state === 'unavailable') {
    count = (
      <span className="flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
        <StateChip kind="unavailable" /> This is not a claim that nothing is answered.
        <button type="button" onClick={onRetry} className="min-h-11 font-bold text-violet-700 hover:underline dark:text-violet-300">Retry</button>
      </span>
    );
  } else if (discovery.complete) count = <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={14} aria-hidden="true" />{discovery.answered} of {discovery.total} answered</span>;
  else count = <span className="text-sm"><b className="text-[18px] tabular-nums">{discovery.answered}</b> of {discovery.total} answered</span>;

  return (
    <section className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40" aria-labelledby="exploring-stand-h" data-testid="exploring-where-things-stand">
      <h2 id="exploring-stand-h" className="mb-3 text-[14px] font-extrabold tracking-tight">Where things stand</h2>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint dark:text-gray-500">Role you are exploring</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {track ? <>{TRACK_LABELS[track]}{preview && <ExampleChip />}</> : <StateChip kind="not_applicable" label="None chosen yet" />}
          </dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint dark:text-gray-500">Discovery questions</dt>
          <dd className="mt-1">{count}</dd>
        </div>
        <div data-testid="exploring-profiling">
          <dt className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint dark:text-gray-500">Profiling</dt>
          <dd className="mt-1"><NotApplicableChip>{PROFILING_NA}</NotApplicableChip><span className="mt-1 block text-[12px] text-axal-muted dark:text-gray-400">{PROFILING_LINE}</span></dd>
        </div>
      </dl>
    </section>
  );
}

function Lanes() {
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="exploring-lanes">
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20" aria-labelledby="exploring-available-h">
        <h2 id="exploring-available-h" className="mb-3 flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={12} aria-hidden="true" /> Available now</h2>
        <ul className="space-y-2.5">
          {AVAILABLE_NOW.map((item) => (
            <li key={item.t}>
              <Link to={item.to} className="block min-h-11 rounded-lg border border-emerald-200 bg-white px-3 py-2 hover:border-emerald-400 dark:border-emerald-800 dark:bg-gray-900">
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{item.t}</span>
                <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">{item.d}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" aria-labelledby="exploring-membership-h">
        <h2 id="exploring-membership-h" className="mb-3 flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400"><Lock size={12} aria-hidden="true" /> Opens with membership</h2>
        <ul className="space-y-2.5">
          {OPENS_WITH_MEMBERSHIP.map((item) => (
            <li key={item.t} className="rounded-lg border border-dashed border-gray-200 px-3 py-2 dark:border-gray-700">
              <span className="block text-sm font-semibold text-gray-700 dark:text-gray-300">{item.t}</span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{item.d}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function ExploringDashboard() {
  const { user } = useAuth();
  const mode = useViewMode();
  const phone = usePhoneWidth();
  // An admin on this page is previewing the role: through the Preview shell, or by opening /exploring from HQ.
  const preview = rolePreviewOf(mode) === 'exploring' || (user?.role === 'admin' && !mode?.isImpersonating);
  const [example, setExample] = useState(EXPLORING_DEFAULT_EXAMPLE);
  const [progress, setProgress] = useState({ status: 'loading' });
  const [progressAttempt, setProgressAttempt] = useState(0);
  const [eadwyn, setEadwyn] = useState({ available: null, key: 0 });

  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const exampleState = exampleStateOf(example);
  const role = preview ? exampleState.role : user?.suggested_role;
  const memberLane = LANE_COPY[user?.suggested_role] || null;
  const lane = preview ? (LANE_COPY[exampleState.role] || null) : memberLane;

  useEffect(() => {
    if (preview) return undefined;
    let alive = true;
    setProgress({ status: 'loading' });
    api.advisor.progress()
      .then((value) => { if (alive) setProgress({ status: 'ok', value }); })
      .catch((e) => { reportError('ExploringDashboard:progress', e); if (alive) setProgress({ status: 'error' }); });
    return () => { alive = false; };
  }, [preview, progressAttempt]);

  const discovery = preview ? { state: 'loading' } : discoveryOf(progress);
  const state = preview ? (example === 'done' ? 'done' : exploringStateOf({ role, discovery: null })) : exploringStateOf({ role, discovery });
  const step = nextStepFor({ state, role, discovery, lane, preview, eadwynAvailable: preview ? true : eadwyn.available !== false });
  const onAvailability = useCallback((available) => setEadwyn((e) => (e.available === available ? e : { ...e, available })), []);
  const retryEadwyn = () => setEadwyn((e) => ({ available: null, key: e.key + 1 }));
  const chip = lane ? `${lane.label} · under review` : 'Exploring';

  return (
    <div className={`space-y-5 ${phone && step.action?.button ? 'pb-24' : ''}`} data-testid="exploring-dashboard" data-state={state} data-preview={preview ? 'true' : undefined}>
      {preview && (
        <>
          <RolePreviewNotice role="exploring" />
          <section className="rounded-xl border-[1.5px] border-dashed border-violet-300 bg-white p-3 dark:border-violet-500/50 dark:bg-gray-900" data-testid="exploring-example-state">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">Example state · preview only</p>
            <label htmlFor="exploring-example-select" className="mt-1 block text-sm font-semibold">Show the Exploring page as</label>
            <select
              id="exploring-example-select"
              value={example}
              onChange={(e) => setExample(e.target.value)}
              aria-describedby="exploring-example-why"
              className="mt-1 min-h-11 w-full max-w-[320px] rounded-lg border border-axal-hairline bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {EXPLORING_EXAMPLE_STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <p id="exploring-example-why" className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">The step and copy are the ones a visitor in that state sees.</p>
          </section>
        </>
      )}

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{preview ? 'Welcome' : `Welcome, ${firstName}`}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            <Compass size={12} aria-hidden="true" /> {chip}
          </span>
          {preview && <ExampleChip>Preview</ExampleChip>}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{welcomeLine(state)}</p>
      </div>

      <NextStep step={step} phone={phone} onRetryEadwyn={retryEadwyn} />

      {preview ? (
        <RolePreviewInterview role="exploring" track={trackOf(role)} />
      ) : (
        <section id={STUDIO_CHAT_ANCHOR} aria-labelledby="exploring-eadwyn-h" tabIndex={-1}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id="exploring-eadwyn-h" className="text-[15px] font-extrabold tracking-tight">Eadwyn</h2>
            {trackOf(role) && discovery.state === 'ready' && <span className="rounded-full bg-axal-ground px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:bg-gray-800 dark:text-gray-400">{discovery.answered} of {discovery.total} answered</span>}
          </div>
          <PersonalAdvisor key={eadwyn.key} disablePersistedFullscreen onAvailabilityChange={onAvailability} />
        </section>
      )}

      <WhereThingsStand role={role} discovery={discovery} preview={preview} onRetry={() => setProgressAttempt((n) => n + 1)} />

      {state === 'founder' && <Lanes />}

      {!preview && <ProductTestingStudio user={user} />}

      {phone && step.action?.button && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-axal-hairline bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95" data-testid="exploring-sticky-action">
          <StepAction action={step.action} testId="exploring-lane-cta" />
        </div>
      )}
    </div>
  );
}
