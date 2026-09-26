import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowRight, FlaskConical } from "lucide-react";
import { spinoutLab } from "../lib/api";
import { useAuth } from "../hooks/useAuthSync";
import { reportError } from "../lib/log";
import SpinoutLabMarketingPage from "./SpinoutLabMarketingPage";
import SpinoutLabWorkspace from "./SpinoutLabWorkspace";
import LabIntro from "../components/spinout/LabIntro";
import { Unreadable } from "../ui";
// The facts both surfaces read. They live in lib/ rather than here because
// this file imports the marketing page and the marketing page renders the
// intro — a cycle, if the intro had to reach back up here for them.
import {
  // `LAB_APPLY_HREF` is `ApplyCtaSection`'s DEFAULT `applyHref` and was never
  // imported — a latent `ReferenceError` in an exported component. Every caller
  // happens to pass the prop today (this file's own at the bottom, and
  // `SpinoutLabMarketingPage`), so the default is never evaluated and nothing has
  // thrown yet; the first caller that omits it would blank the page. Found by
  // ESLint's `no-undef`, which is the whole reason that step exists.
  LAB_APPLY_HREF,
  LAB_APPLY_HREF_SIGNED_IN, LAB_CONTACT_HREF,
  parseSqliteUtc, fmtRaised, openCohortCopy,
  useCohortDirectory, useShippedFeed, useCohortPlaces, placesLabel,
} from "../lib/spinoutLab";
import { DEFAULT_TRACK } from "../lib/spinoutLabArsenal";

// Reference-design shared content (Spin-Out Lab.dc.html): graduate alumni
// cards and the application CTA. Shared with SpinoutLabMarketingPage so both
// surfaces stay in lockstep.

// Graduate cards are LIVE data — GET /spinout-lab/graduates (public; the
// section renders on the logged-out marketing page too). Only the avatar
// color themes below are presentational.
const GRAD_AVATAR_THEMES = [
  { bg: 'bg-violet-100 dark:bg-violet-900', ink: 'text-violet-700 dark:text-violet-200' },
  { bg: 'bg-blue-100 dark:bg-blue-900', ink: 'text-blue-700 dark:text-blue-200' },
  { bg: 'bg-teal-100 dark:bg-teal-900', ink: 'text-teal-700 dark:text-teal-200' },
  { bg: 'bg-amber-100 dark:bg-amber-900', ink: 'text-amber-700 dark:text-amber-200' },
  { bg: 'bg-pink-100 dark:bg-pink-900', ink: 'text-pink-700 dark:text-pink-200' },
  { bg: 'bg-indigo-100 dark:bg-indigo-900', ink: 'text-indigo-700 dark:text-indigo-200' },
];

function gradInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function gradDateLabel(iso) {
  const d = parseSqliteUtc(iso);
  if (!d) return null;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function gradCohortLabel(cohort) {
  if (cohort == null || cohort === '') return 'Alumni';
  const s = String(cohort).trim();
  return /^\d+$/.test(s) ? `Cohort ${s}` : s;
}

export function GraduatesSection() {
  // null = loading, 'error' = fetch failed, [] = no graduates yet
  const [grads, setGrads] = useState(null);

  useEffect(() => {
    let alive = true;
    spinoutLab
      .graduates()
      .then((r) => {
        if (alive) setGrads(Array.isArray(r) ? r : []);
      })
      .catch((e) => {
        reportError('spinout-lab:graduates', e);
        if (alive) setGrads('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Graduate companies.</h2>
        {Array.isArray(grads) && grads.length > 0 && (
          <span className="text-[12.5px] text-gray-400">Select a company to view its profile</span>
        )}
      </div>
      {grads === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm animate-pulse">
              <div className="w-11 h-11 rounded-[11px] bg-gray-100 dark:bg-gray-800 mb-3.5" />
              <div className="h-3.5 w-2/5 rounded bg-gray-100 dark:bg-gray-800 mb-2" />
              <div className="h-3 w-3/5 rounded bg-gray-100 dark:bg-gray-800" />
            </div>
          ))}
        </div>
      )}
      {grads === 'error' && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-6 text-[13px] text-gray-500 dark:text-gray-400">
          Couldn't load graduate companies right now — please try again later.
        </div>
      )}
      {Array.isArray(grads) && grads.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-[16px] p-8 text-center">
          <div className="text-[14px] font-bold text-gray-700 dark:text-gray-300 mb-1">No graduates yet.</div>
          <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
            Companies appear here automatically when their founders complete the 4-week sprint.
          </div>
        </div>
      )}
      {Array.isArray(grads) && grads.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {grads.map((g, i) => {
            const t = GRAD_AVATAR_THEMES[i % GRAD_AVATAR_THEMES.length];
            const raised = fmtRaised(g.raised);
            const gradDate = gradDateLabel(g.graduated_at);
            const cardBody = (
              <>
                <div className="flex items-center justify-between mb-3.5">
                  <div className={`w-11 h-11 rounded-[11px] font-extrabold text-[15px] flex items-center justify-center ${t.bg} ${t.ink}`}>{gradInitials(g.name)}</div>
                  <span className="tabular-nums text-[11px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/50 border border-violet-100 dark:border-violet-800/50 rounded-full px-2.5 py-1">{gradCohortLabel(g.cohort)}</span>
                </div>
                <div className="text-[15px] font-bold text-gray-900 dark:text-gray-100">{g.name}</div>
                <div className="text-[12px] text-gray-400 mb-3.5">{g.sector || 'Spin-Out Lab graduate'}</div>
                <div className="tabular-nums text-[19px] font-extrabold tracking-[-.01em]">
                  {raised ? `${raised} raised` : 'Incorporated'}
                </div>
                <div className="text-[12px] text-gray-500 mt-1 leading-[1.4]">
                  {g.last_round ? `Last round: ${g.last_round}` : gradDate ? `Graduated ${gradDate}` : 'Completed the 4-week sprint'}
                </div>
                {g.uid && (
                  <div className="mt-3.5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 dark:text-violet-400">
                    View profile <span className="text-[13px]" aria-hidden="true">→</span>
                  </div>
                )}
              </>
            );
            const cardClass = 'text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm block w-full';
            return g.uid ? (
              <Link
                key={g.uid}
                to={`/startups/${encodeURIComponent(g.uid)}`}
                className={`${cardClass} hover:border-violet-300 hover:shadow-lg dark:hover:border-violet-700 transition-all -translate-y-0 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2`}
              >
                {cardBody}
              </Link>
            ) : (
              <div key={`${g.name}-${i}`} className={cardClass}>
                {cardBody}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// LP-facing counterpart to ApplyCtaSection. An investor browsing the program
// is a prospective source of capital, not a cohort applicant, so the call to
// action points at the LP workspace instead of the founder application.
export function LpCtaSection() {
  return (
    <section className="rounded-[20px] p-10 text-center relative overflow-hidden text-white" style={{ background: 'radial-gradient(900px 300px at 85% 120%,rgba(196,181,253,.35),transparent 60%),linear-gradient(115deg,#5b21b6,#7c3aed)' }}>
      <h2 className="m-0 text-[32px] font-black tracking-[-.03em]">Back the graduates.</h2>
      <p className="tabular-nums my-3 mb-6 text-[15px] text-[#e9d5ff]">
        Axal VC Spin-Out Fund I invests exclusively in Lab graduates — underwritten by 28 days of
        observed execution data, not a pitch.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to="/spinout-lab/investor-workspace" data-testid="link-lp-workspace" className="h-11 px-5.5 rounded-[11px] bg-white dark:bg-gray-100 text-[#6d28d9] text-[14px] font-bold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-white transition-colors">
          Open LP Workspace <span className="text-[16px]" aria-hidden="true">→</span>
        </Link>
        <a href={LAB_CONTACT_HREF} className="h-11 px-5.5 rounded-[11px] border border-white/40 bg-transparent text-white text-[14px] font-semibold flex items-center hover:bg-white/10 transition-colors">
          Talk to the GP
        </a>
      </div>
      <p className="mt-6 text-[12px] text-[#c4b5fd]">Participation is limited to accredited investors and reviewed individually.</p>
    </section>
  );
}

export function ApplyCtaSection({ applyHref = LAB_APPLY_HREF }) {
  // Resolve the currently-open cohort client-side (mirrors Worker math).
  // Deadline = 7 days before the 1st of the cohort month at 23:59:59 ET.
  // Workspace access is automatically granted at midnight Delaware time on
  // the 1st by the Worker's cohort-timing cron — no client action needed.
  const cohort = useMemo(() => openCohortCopy(), []);

  const headline = cohort
    ? `Apply to Cohort ${cohort.cohortNum}.`
    : 'Apply to the next cohort.';

  const sub = cohort
    ? `Applications close ${cohort.deadlineLabel}.`
    : 'Applications are now open.';
  // The place count is read, never typed: `cohort.places` from /brief.
  const places = useCohortPlaces();

  return (
    <section className="rounded-[20px] p-10 text-center relative overflow-hidden text-white" style={{ background: 'radial-gradient(900px 300px at 85% 120%,rgba(196,181,253,.35),transparent 60%),linear-gradient(115deg,#5b21b6,#7c3aed)' }}>
      <h2 className="m-0 text-[32px] font-black tracking-[-.03em]">{headline}</h2>
      <p className="tabular-nums my-3 mb-6 text-[15px] text-[#e9d5ff]" data-testid="apply-cta-sub">
        {sub}
        {places.status === 'ok' ? ` ${placesLabel(places.places)} in each cohort.` : null}
      </p>
      {places.status === 'error' ? (
        <div className="-mt-3 mb-6 mx-auto w-fit rounded-lg bg-white dark:bg-gray-900 px-3 py-2">
          <Unreadable
            what="The number of places in a cohort"
            claim="This is not a statement that the cohort is full."
            onRetry={places.retry}
          />
        </div>
      ) : null}
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to={applyHref} className="h-11 px-5.5 rounded-[11px] bg-white dark:bg-gray-100 text-[#6d28d9] text-[14px] font-bold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-white transition-colors">
          Apply Now <span className="text-[16px]" aria-hidden="true">→</span>
        </Link>
        <a href={LAB_CONTACT_HREF} className="h-11 px-5.5 rounded-[11px] border border-white/40 bg-transparent text-white text-[14px] font-semibold flex items-center hover:bg-white/10 transition-colors">
          Talk to a Program Manager
        </a>
      </div>
      <p className="mt-6 text-[12px] text-[#c4b5fd]">Spin-Out Lab is open to all Axal VC users. Acceptance is selective. No equity taken by Axal VC.</p>
    </section>
  );
}

/**
 * Why a strong application can be refused: the cohort's place count, read from
 * `/brief`. While the read is in flight or has failed the sentence still holds
 * without a number — it never borrows one.
 */
function CapacityReason() {
  const places = useCohortPlaces();
  return places.status === 'ok'
    ? <>Each cohort has {placesLabel(places.places)}, so strong applications get turned down for space alone. </>
    : <>Each cohort has a fixed number of places, so strong applications get turned down for space alone. </>;
}

/**
 * Standing acknowledgement of the founder's own application.
 *
 * `GET /spinout-lab/state` has always returned the founder's latest
 * `spinout_applications` row, and this page has always thrown it away — so a
 * founder who applied on Tuesday came back on Thursday to the same marketing
 * page and the same "Apply Now" button, with nothing anywhere confirming their
 * application exists. Pressing it again is not merely redundant: the apply
 * endpoint 409s a second pending application, so the only feedback the product
 * gave them was an error.
 *
 * Pending REPLACES the apply CTA (re-applying is the thing that 409s).
 * Refused sits ABOVE it, because a refused founder genuinely may re-apply —
 * the insert only guards against a second *pending* row.
 */
export function ApplicationStatusSection({ application }) {
  const status = String(application?.status || '').toLowerCase();
  if (status !== 'pending' && status !== 'refused') return null;

  const submitted = parseSqliteUtc(application.created_at);
  const decided = parseSqliteUtc(application.decided_at);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const pending = status === 'pending';
  const tone = pending
    ? { ring: 'ring-amber-300/70 dark:ring-amber-400/30', chip: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300', dot: 'bg-amber-500' }
    : { ring: 'ring-gray-300/70 dark:ring-gray-600/40', chip: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300', dot: 'bg-gray-400' };

  return (
    <section
      data-testid="application-status"
      data-status={status}
      className={`rounded-[20px] p-8 bg-white dark:bg-gray-800 ring-1 ${tone.ring} shadow-sm`}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`h-2 w-2 rounded-full ${tone.dot}`} aria-hidden="true" />
        <span className={`text-[11px] font-bold uppercase tracking-[.08em] px-2 py-0.5 rounded-full ${tone.chip}`}>
          {pending ? 'In review' : 'Not this cohort'}
        </span>
      </div>

      <h2 className="m-0 text-[24px] font-black tracking-[-.02em] text-gray-900 dark:text-gray-50">
        {pending ? 'Your application is in review.' : 'You weren’t selected for this cohort.'}
      </h2>

      <p className="mt-2.5 text-[14.5px] leading-relaxed text-gray-600 dark:text-gray-300">
        {pending ? (
          <>
            We have your application{application.company_name ? <> for <strong className="font-semibold text-gray-900 dark:text-gray-100">{application.company_name}</strong></> : null}
            {submitted ? <>, submitted {fmt(submitted)}</> : null}. Every application is read by a
            program manager, and you’ll get an email either way — you don’t need to apply again.
          </>
        ) : (
          <>
            {decided ? <>We reviewed your application on {fmt(decided)}. </> : null}
            <CapacityReason />
            You’re welcome to apply again below.
          </>
        )}
      </p>

      {application.cohort ? (
        <p className="mt-4 text-[12.5px] text-gray-500 dark:text-gray-400">
          Applied to <span className="font-semibold text-gray-700 dark:text-gray-200">{application.cohort}</span>
        </p>
      ) : null}

      {pending ? (
        <div className="mt-6 flex gap-3 flex-wrap">
          <a href={LAB_CONTACT_HREF} className="h-10 px-4 rounded-[10px] border border-gray-300 dark:border-gray-600 text-[13.5px] font-semibold text-gray-700 dark:text-gray-200 flex items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            Talk to a Program Manager
          </a>
        </div>
      ) : null}
    </section>
  );
}

// Task #7 — "You're in" celebration for admitted-but-not-started founders.
// Rendered on /spinout-lab (sidebar stays); the CTA calls the existing
// start endpoint and hands over to the workspace Dashboard. Exported for
// the admin journey preview (Task #106), which feeds it simulated props.
export function CongratulationsScreen({ cohort, onStart, starting, startError }) {
  return (
    <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100 flex items-center justify-center px-6 py-16">
      <div className="max-w-[620px] w-full text-center">
        <div className="rounded-[24px] p-10 md:p-14 text-white relative overflow-hidden mb-6" style={{ background: 'radial-gradient(1200px 400px at 12% -20%,rgba(139,92,246,.5),transparent 60%),linear-gradient(115deg,#1e1b3a 0%,#2a1d54 55%,#3b1d6e 100%)' }}>
          <div className="relative z-10">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
              <FlaskConical size={30} className="text-violet-300" />
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe] mb-4">
              Spin-Out Lab · {cohort || 'Next cohort'}
            </div>
            <h1 className="m-0 text-[40px] leading-[1.05] font-black tracking-[-0.03em] text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(90deg,#fff,#c4b5fd)', WebkitBackgroundClip: 'text' }}>
              Congratulations — you're in.
            </h1>
            <p className="mt-4 mb-8 text-[16px] text-[#cbc4e8] font-medium leading-relaxed">
              You've been admitted to the Spin-Out Lab. The next 28 days are four
              gates that open on evidence — Validate, Build, Pitch, Fund — with
              every Lab tool on one company and one clock, and incorporation among
              them for founders who still need an entity.
            </p>
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="inline-flex items-center gap-2 bg-white dark:bg-gray-100 text-violet-900 font-bold text-[16px] px-8 py-4 rounded-2xl hover:bg-violet-50 dark:hover:bg-white transition-colors disabled:opacity-60"
            >
              {starting ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
              Start Week 1
            </button>
          </div>
        </div>
        {startError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 px-4 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400">
            {startError}
          </div>
        )}
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          Week 1 opens your founder workspace: the 4-week program timeline, your
          deliverables checklist, and every Lab tool as it unlocks.
        </p>
      </div>
    </div>
  );
}

/**
 * `/spinout-lab`, signed in and not yet applied — the in-app Spin-Out Lab
 * introduction, and the branch `SpinoutLabPage` falls through to when a member
 * has an account but no cohort.
 *
 * DESIGN HANDOFF: `design/canvases/integrated/Spin-Out Lab · Intro.dc.html`,
 * rendered by `components/spinout/LabIntro.jsx` — the same component the
 * logged-out page renders. The header, hero, pipeline and deliverables that
 * used to live here were a hand-maintained copy of the ones in
 * `SpinoutLabMarketingPage.jsx`; they are now one tree in one file.
 *
 * WHAT THIS SURFACE KNOWS THAT THE PUBLIC ONE DOES NOT, and the whole of it:
 * whether this member's own application said they already have a company. If
 * it did, the track opens on Find fit and the page says why. Nothing else is
 * inferred — a member who has not applied gets the default track, because the
 * product holds no other signal about where their company is, and picking one
 * for them from silence would be a guess wearing a fact's clothes.
 *
 * `previewAllUnlocked` is gone from the signature. It only ever fed the phase
 * Lock/Unlock icons in the pipeline block this replaced, no caller passed it,
 * and the admin journey preview drives `SpinoutLabWorkspace` instead.
 */
export function Dashboard({ state, investorView = false }) {
  // The one thing the signed-in surface can honestly preselect. The answer
  // comes from the member's own application row (`spinout_applications
  // .incorporated`), not from `users.is_incorporated` — that flag means
  // "has been through the Lab", which is a different question and would
  // preselect a track for exactly the people who cannot re-enter.
  const appliedIncorporated =
    String(state?.application?.incorporated || '').toLowerCase() === 'yes';

  const [track, setTrack] = useState(appliedIncorporated ? 'fit' : DEFAULT_TRACK);
  const [jurisdiction, setJurisdiction] = useState('de');
  const cohort = useMemo(() => openCohortCopy(), []);

  const directory = useCohortDirectory();
  const shipped = useShippedFeed({ enabled: true });

  return (
    <div className="min-h-[100dvh] bg-white dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100">
      <LabIntro
        surface="app"
        cohort={cohort}
        applyHref={LAB_APPLY_HREF_SIGNED_IN}
        track={track}
        onTrack={setTrack}
        jurisdiction={jurisdiction}
        onJurisdiction={setJurisdiction}
        directory={directory}
        shipped={shipped}
        preselectNote={appliedIncorporated
          ? 'Your application said the company is already incorporated, so this opened on Find fit. Change it if that is wrong.'
          : null}
      >
        <GraduatesSection />

        {/* An investor never reaches this page in normal navigation — the
            route sends them to SpinoutLabInvestorPage — but the rule this
            encodes is a property of THIS page: never offer a cohort
            application to someone whose role the apply endpoint refuses. */}
        {investorView ? <LpCtaSection /> : (
          <>
            {/* A founder mid-review gets their own status instead of a button
                that 409s. Refused founders get BOTH — the acknowledgement and
                the CTA — because only a *pending* row blocks re-application. */}
            <ApplicationStatusSection application={state?.application} />
            {String(state?.application?.status || '').toLowerCase() === 'pending'
              ? null
              : <ApplyCtaSection applyHref="/spinout-lab/apply" />}
          </>
        )}
      </LabIntro>
    </div>
  );
}

export default function SpinoutLabPage() {
  const { user, refresh } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const next = await spinoutLab.state();
      setState(next);
    } catch (e) {
      // A failed /state fetch (backend restart, rate limit) must NOT
      // silently render the wrong page for an active founder — surface an
      // explicit retry instead.
      setLoadError(true);
      reportError("spinout-lab:state", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  useEffect(() => {
    const onAdvanced = () => {
      load();
    };
    window.addEventListener("spinout-lab:advanced", onAdvanced);
    return () => window.removeEventListener("spinout-lab:advanced", onAdvanced);
  }, [load]);

  if (!user) return <SpinoutLabMarketingPage />;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your sprint…
      </div>
    );
  }

  // Task #7 — admitted-but-not-started founders see the "You're in"
  // celebration; Start Week 1 flips the lab on via the existing endpoint.
  if (state && !state.active && state.admitted && !state.is_incorporated) {
    const onStart = async () => {
      setStarting(true);
      setStartError("");
      try {
        const next = await spinoutLab.start();
        setState(next);
        try { await refresh({ force: true }); } catch { /* no-op */ }
      } catch (e) {
        setStartError(e?.message || "Could not start the Lab — please try again");
        reportError("spinout-lab:start", e);
      } finally {
        setStarting(false);
      }
    };
    return (
      <CongratulationsScreen
        cohort={state.cohort}
        onStart={onStart}
        starting={starting}
        startError={startError}
      />
    );
  }

  const isAdmin = user?.role === 'admin';

  // Active (or graduated) founders get the real workspace: week timeline,
  // deliverables checklist, and the unlocked-tools grid, all at /spinout-lab.
  // Admins always get previewAllUnlocked so every week and tool is accessible
  // for product review, regardless of milestone progress.
  if (state && (state.active || state.is_incorporated)) {
    return <SpinoutLabWorkspace state={state} previewAllUnlocked={isAdmin} />;
  }

  // Admins without an active enrollment still need to review the workspace.
  // Synthesise a minimal Week 1 state so the workspace renders fully unlocked.
  if (isAdmin) {
    const adminPreviewState = { active: true, week: 1, days_remaining: 28, milestones: [], unlocked_features: [] };
    return <SpinoutLabWorkspace state={adminPreviewState} previewAllUnlocked />;
  }

  // If we couldn't load state at all, don't guess — the program overview
  // would look like "no access" to an active founder. Offer a retry.
  if (!state && loadError) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="text-spinout-state-error">
          We couldn't load your Spin-Out Lab status. This is usually temporary.
        </p>
        <button
          type="button"
          data-testid="button-retry-spinout-state"
          onClick={() => { setLoading(true); load(); }}
          className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  // Everyone else (not applied / application pending) sees the program
  // overview with the Apply CTA — except investors, whose route into the
  // program is the LP fund, not a cohort application.
  return <Dashboard state={state || {}} investorView={user?.role === 'investor'} />;
}
