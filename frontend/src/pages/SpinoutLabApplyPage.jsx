import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Loader2, ArrowLeft, Lock } from "lucide-react";
import { useAuth } from "../hooks/useAuthSync";
import { spinoutLab } from "../lib/api";
import { resolveOpenCohort, useCohortPlaces, placesLabel } from "../lib/spinoutLab";
import {
  APPLY_STEPS, ORIGIN_OPTIONS, TTO_OPTIONS, IP_OPTIONS, CONFIDENTIAL_NOTE, FIELD_LABEL,
  emptyBasics, emptyAnswers, missingOnStep, missingBasics, missingAnswers, answersPayload,
  draftBody, fromDraft, consequenceFor, phaseOf, applicantFromLegacy, whenOf,
} from "../lib/applicationLifecycle";
import { ApplicationStatusScreen } from "../components/spinout/ApplicationStatus";
import LabPageShell from "../components/spinout/LabPageShell";
import { Unreadable } from "../ui";

// Apply to the open cohort, and see where the application stands (D384) —
// the Apply & Status canvas (design/canvases/out-of-scope/Apply and
// Status.dc.html): P1 the five-step application, P2 the status screen. It
// replaces the one-page form from the older Spin-Out Lab.dc.html APPLY VIEW
// and its "Application received" card; the status the founder sees now lives
// here, on one screen, rather than in a separate block on /spinout-lab.
//
// The heading never types a cohort number: it reads the window `/state`
// returns (`resolveOpenCohort()` as the fallback) — a typed sample label is
// what once put "Apply to Cohort 6" on the first cohort ever offered.
// No contact fields: the account is the applicant.

const STAGES = ["Idea / pre-formation", "Prototype in progress", "Early revenue"];
const JURIS = [
  { key: "de", label: "Delaware C-Corp — Delaware, USA" },
  { key: "wy", label: "Wyoming C-Corp — Wyoming, USA" },
];

// The admin journey preview (Task #106) renders this page read-only: no
// fetch, no redirect, and Submit simulates the status screen locally.
const PREVIEW_APPLICANT = {
  application_id: null, status: "pending", submitted_at: null, decided_at: null, withdrawn_at: null,
  answers: null, answers_recorded: true, pool: null, note: null, interview: null, reapply: null,
};

const input = "w-full h-[42px] px-3 border border-gray-200 dark:border-gray-700 rounded-[10px] text-[14px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none focus:border-violet-400 focus:ring-[3px] focus:ring-violet-500/15";
const area = "w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-[10px] text-[14px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none resize-y focus:border-violet-400 focus:ring-[3px] focus:ring-violet-500/15";
const labelCls = "text-[12.5px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className={labelCls}>{label}</div>
      {children}
      {hint ? <div className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{hint}</div> : null}
    </label>
  );
}

function Choice({ on, name, note, badge, onClick, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={on}
      className={`w-full text-left flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-colors ${on
        ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10"
        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
      <span className={`mt-0.5 w-5 h-5 flex-none rounded-full border-[1.5px] flex items-center justify-center ${on ? "border-violet-600" : "border-gray-300 dark:border-gray-600"}`}>
        {on ? <span className="w-2.5 h-2.5 rounded-full bg-violet-600" /> : null}
      </span>
      <span className="min-w-0">
        <span className={`block text-[14px] ${on ? "font-bold" : "font-semibold"} text-gray-900 dark:text-gray-100`}>
          {name}{badge ? <span className="ml-2 text-[10.5px] font-bold tracking-[.06em] text-violet-700 dark:text-violet-300">{badge}</span> : null}
        </span>
        {note ? <span className="block mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400">{note}</span> : null}
      </span>
    </button>
  );
}

/** The five steps. Exported so the tests render each one. */
export function ApplyStep({ step, basics, answers, setBasics, setAnswers }) {
  const b = (k) => (v) => setBasics((prev) => ({ ...prev, [k]: v }));
  const a = (k) => (v) => setAnswers((prev) => ({ ...prev, [k]: v }));
  const toggleIp = (key) => setAnswers((prev) => ({
    ...prev, ip: prev.ip.includes(key) ? prev.ip.filter((x) => x !== key) : [...prev.ip, key],
  }));

  if (step === 1) {
    return (
      <div className="flex flex-col gap-[18px]" data-testid="apply-step-1">
        <Field label="Company or working name">
          <input type="text" value={basics.company} onChange={(e) => b("company")(e.target.value)} placeholder="e.g. Northwind Labs" data-testid="apply-company" className={input} />
        </Field>
        <Field label="What you are building">
          <textarea rows={4} value={basics.idea} onChange={(e) => b("idea")(e.target.value)} placeholder="What are you building, who is it for, and why now?" data-testid="apply-idea" className={area} />
        </Field>
        <div>
          <div className={labelCls}>Are you already incorporated?</div>
          <div className="flex gap-2">
            {[{ v: "no", label: "Not yet" }, { v: "yes", label: "Already incorporated" }].map((o) => (
              <button key={o.v} type="button" onClick={() => b("incorporated")(o.v)} aria-pressed={basics.incorporated === o.v}
                className={`flex-1 h-[40px] rounded-[10px] text-[13.5px] font-semibold border ${basics.incorporated === o.v
                  ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40"
                  : "bg-white dark:bg-gray-950 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3.5 flex-wrap">
          <label className="flex-[1_1_200px] min-w-0 block">
            <div className={labelCls}>Current stage</div>
            <select value={basics.stage || STAGES[0]} onChange={(e) => b("stage")(e.target.value)} className={input}>
              {STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex-[1_1_200px] min-w-0 block">
            <div className={labelCls}>{basics.incorporated === "yes" ? "Current jurisdiction" : "Preferred jurisdiction"}</div>
            <select value={basics.jurisKey} onChange={(e) => b("jurisKey")(e.target.value)} className={input}>
              {JURIS.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
            </select>
          </label>
        </div>
      </div>
    );
  }
  if (step === 2) {
    const ttoChoices = TTO_OPTIONS.filter((t) => t.key !== "not_applicable" || answers.origin === "corporate");
    return (
      <div className="flex flex-col gap-[18px]" data-testid="apply-step-2">
        <p className="m-0 text-[13.5px] text-gray-600 dark:text-gray-300">
          Two questions about where the venture comes from. They are read first by the reviewer and are not scored: a university spin-out and an independent build need opposite first steps.
        </p>
        <div>
          <div className={labelCls}>Origin</div>
          <div className="flex flex-col gap-2">
            {ORIGIN_OPTIONS.map((o) => (
              <Choice key={o.key} on={answers.origin === o.key} name={o.name} note={o.note} onClick={() => a("origin")(o.key)} testId={`origin-${o.key}`} />
            ))}
          </div>
        </div>
        {answers.origin && answers.origin !== "independent" ? (
          <>
            <div className="flex gap-3.5 flex-wrap">
              <div className="flex-[1_1_200px] min-w-0">
                <Field label={answers.origin === "university" ? "Institution" : "Employer"}>
                  <input type="text" value={answers.institution} onChange={(e) => a("institution")(e.target.value)} className={input} data-testid="apply-institution" />
                </Field>
              </div>
              <div className="flex-[1_1_200px] min-w-0">
                <Field label={answers.origin === "university" ? "Research group" : "Team or division"} hint="Optional">
                  <input type="text" value={answers.research_group} onChange={(e) => a("research_group")(e.target.value)} className={input} />
                </Field>
              </div>
            </div>
            <div>
              <div className={labelCls}>Tech-transfer status</div>
              <div className="flex flex-col gap-2">
                {ttoChoices.map((t) => (
                  <Choice key={t.key} on={answers.tto_status === t.key} name={t.name} note={t.note}
                    badge={answers.tto_status === t.key ? "YOUR ANSWER" : null}
                    onClick={() => a("tto_status")(t.key)} testId={`tto-${t.key}`} />
                ))}
              </div>
            </div>
          </>
        ) : null}
        <div>
          <div className={labelCls}>IP assignment state</div>
          <div className="flex flex-wrap gap-2">
            {IP_OPTIONS.map((c) => {
              const on = answers.ip.includes(c.key);
              return (
                <button key={c.key} type="button" onClick={() => toggleIp(c.key)} aria-pressed={on} data-testid={`ip-${c.key}`}
                  className={`text-[13px] px-4 py-2 rounded-full border ${on
                    ? "font-bold border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                    : "font-semibold border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-600 dark:text-gray-300"}`}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  if (step === 3) {
    return (
      <div className="flex flex-col gap-[18px]" data-testid="apply-step-3">
        <Field label="How many people are on the team?" hint="Founders and anyone working on it now, 1 to 50.">
          <input type="number" min={1} max={50} value={answers.team_size} onChange={(e) => a("team_size")(e.target.value)} className={`${input} max-w-[160px]`} data-testid="apply-team-size" />
        </Field>
        <Field label="Who does what" hint="Optional. Names are not needed; roles are.">
          <textarea rows={3} value={answers.team_roles} onChange={(e) => a("team_roles")(e.target.value)} className={area} />
        </Field>
        <div>
          <div className={labelCls}>Does someone on the team own the commercial side?</div>
          <div className="flex gap-2">
            {[{ v: true, label: "Yes" }, { v: false, label: "Not yet" }].map((o) => (
              <button key={String(o.v)} type="button" onClick={() => a("commercial_lead")(o.v)} aria-pressed={answers.commercial_lead === o.v}
                className={`flex-1 h-[40px] rounded-[10px] text-[13.5px] font-semibold border ${answers.commercial_lead === o.v
                  ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40"
                  : "bg-white dark:bg-gray-950 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (step === 4) {
    return (
      <div className="flex flex-col gap-[18px]" data-testid="apply-step-4">
        <Field label="Traction so far" hint="Optional. Customer conversations, pilots, letters of intent, revenue. Leave it blank if there is none yet.">
          <textarea rows={5} value={answers.traction} onChange={(e) => a("traction")(e.target.value)} className={area} />
        </Field>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[18px]" data-testid="apply-step-5">
      <Field label="Why Axal VC, and why now?">
        <textarea rows={5} value={answers.why_axal} onChange={(e) => a("why_axal")(e.target.value)} className={area} data-testid="apply-why" />
      </Field>
    </div>
  );
}

export default function SpinoutLabApplyPage({ previewMode = null, onPreviewSubmitted = null }) {
  const isPreview = previewMode != null;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(!isPreview);
  const [loadError, setLoadError] = useState(false);
  const [applicant, setApplicant] = useState(previewMode === "submitted" ? PREVIEW_APPLICANT : null);
  const [company, setCompany] = useState(null);
  const [appWindow, setAppWindow] = useState(null);
  const [showForm, setShowForm] = useState(previewMode !== "submitted");

  const [basics, setBasics] = useState(emptyBasics);
  const [answers, setAnswers] = useState(emptyAnswers);
  const [step, setStep] = useState(1);
  const [savedAt, setSavedAt] = useState(null);
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const places = useCohortPlaces();
  const fallbackCohort = useMemo(() => {
    try { const c = resolveOpenCohort(); return `Cohort ${c.cohortNum}`; } catch { return "Next Cohort"; }
  }, []);
  const cohortName = appWindow?.label ? `${appWindow.label} Cohort` : fallbackCohort;

  const adopt = useCallback((s) => {
    const next = s?.applicant ?? applicantFromLegacy(s?.application);
    setApplicant(next);
    setCompany(s?.application?.company_name || null);
    const phase = phaseOf(next);
    setShowForm(phase === "none");
    return phase;
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const s = await spinoutLab.state();
      if (s?.admitted) { navigate("/spinout-lab", { replace: true }); return; }
      if (s?.application_window) setAppWindow(s.application_window);
      const phase = adopt(s);
      if (phase === "none" || phase === "withdrawn" || phase === "declined") {
        try {
          const d = fromDraft((await spinoutLab.applyDraft())?.draft);
          if (d) { setBasics(d.basics); setAnswers(d.answers); setStep(d.step); setSavedAt(d.updatedAt); }
        } catch (e) {
          setDraftNote(e?.message || "Your saved draft could not be read. Nothing was lost; reload to try again.");
        }
      }
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [adopt, navigate]);

  useEffect(() => { if (!isPreview) load(); }, [isPreview, load]);

  const saveDraft = async () => {
    if (isPreview) return;
    setSaving(true); setDraftNote("");
    try {
      const r = await spinoutLab.saveApplyDraft(draftBody(basics, answers, step));
      setSavedAt(r?.updated_at || null);
      setDraftNote("Draft saved.");
    } catch (e) {
      setDraftNote(e?.message || "Your draft was not saved. Your answers are still on this page; try again.");
    } finally { setSaving(false); }
  };

  const go = (n) => { setError(""); setStep(n); };
  const next = () => {
    const missing = missingOnStep(step, basics, answers);
    if (missing.length) { setError(`Still needed: ${missing.map((k) => FIELD_LABEL[k]).join(", ")}.`); return; }
    go(step + 1);
  };

  const submit = async () => {
    setError("");
    const missing = [...missingBasics(basics), ...missingAnswers(answers)];
    if (missing.length) { setError(`Still needed: ${missing.map((k) => FIELD_LABEL[k]).join(", ")}.`); return; }
    if (isPreview) {
      setApplicant(PREVIEW_APPLICANT); setShowForm(false);
      if (onPreviewSubmitted) onPreviewSubmitted();
      return;
    }
    setSubmitting(true);
    try {
      const juris = JURIS.find((j) => j.key === basics.jurisKey) || JURIS[0];
      await spinoutLab.apply({
        company_name: basics.company.trim(),
        idea: basics.idea.trim(),
        incorporated: basics.incorporated,
        stage: basics.stage || STAGES[0],
        jurisdiction: juris.label,
        cohort: cohortName,
        ...(appWindow ? { target_cycle: { year: appWindow.year, month: appWindow.month } } : {}),
        answers: answersPayload(answers),
      });
      setBasics(emptyBasics()); setAnswers(emptyAnswers()); setStep(1); setSavedAt(null);
      adopt(await spinoutLab.state());
    } catch (err) {
      setError(err?.message || "Your application was not submitted. Your answers are still on this page; try again.");
    } finally { setSubmitting(false); }
  };

  const withdraw = async () => {
    setBusy(true); setError("");
    try {
      const r = await spinoutLab.withdrawApplication();
      setApplicant(r?.applicant ?? { ...applicant, status: "withdrawn" });
    } catch (e) {
      setError(e?.message || "Your application could not be withdrawn just now. Try again in a moment.");
    } finally { setBusy(false); }
  };

  const reschedule = async (reason) => {
    setBusy(true); setError("");
    try {
      const r = await spinoutLab.requestInterviewReschedule(reason);
      if (r?.applicant) setApplicant(r.applicant);
      return true;
    } catch (e) {
      setError(e?.message || "Your request was not sent. Try again.");
      return false;
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <LabPageShell width="apply" spaceY="" className="py-16" testId="spinout-apply-page">
        <div className="flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={22} /></div>
      </LabPageShell>
    );
  }

  const consequence = consequenceFor(answers);
  const current = APPLY_STEPS[step - 1];
  const nextStep = APPLY_STEPS[step];

  return (
    <LabPageShell width="apply" spaceY="" testId="spinout-apply-page">
      <Link to="/spinout-lab"
        className="inline-flex items-center gap-2 h-[34px] px-3 rounded-[9px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors mb-5">
        <ArrowLeft size={14} aria-hidden="true" /> Back to Spin-Out Lab
      </Link>

      {loadError ? (
        <Unreadable what="Your application" claim="This is not a statement that you have no application." onRetry={() => { setLoading(true); load(); }} />
      ) : !showForm && applicant ? (
        <ApplicationStatusScreen
          applicant={applicant}
          company={company}
          onWithdraw={isPreview ? null : withdraw}
          onReschedule={reschedule}
          onApplyAgain={isPreview ? null : () => { setError(""); setShowForm(true); }}
          busy={busy}
          error={error}
        />
      ) : (
        <div className="flex flex-wrap gap-6 items-start">
          {/* STEP RAIL */}
          <nav aria-label="Application steps" className="flex-[0_1_220px] min-w-[200px]" data-testid="apply-rail">
            <div className="text-[12px] font-bold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400 mb-3">Application</div>
            <ol className="flex flex-col gap-3">
              {APPLY_STEPS.map((s) => {
                const done = s.n < step, on = s.n === step;
                return (
                  <li key={s.n}>
                    <button type="button" onClick={() => (s.n < step ? go(s.n) : null)} aria-current={on ? "step" : undefined}
                      className="flex items-start gap-3 text-left" disabled={s.n > step}>
                      <span className={`w-6 h-6 flex-none rounded-full border-[1.5px] flex items-center justify-center font-mono text-[11px] font-bold ${done
                        ? "bg-violet-600 border-violet-600 text-white" : on
                          ? "bg-violet-50 border-violet-600 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                          : "bg-white border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-700"}`}>
                        {done ? <Check size={12} aria-hidden="true" /> : s.n}
                      </span>
                      <span>
                        <span className={`block text-[13px] ${on ? "font-bold text-gray-900 dark:text-gray-50" : "font-semibold text-gray-600 dark:text-gray-300"}`}>{s.name}</span>
                        {s.note ? <span className="block text-[11.5px] text-gray-500 dark:text-gray-400">{s.note}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="mt-5 flex gap-2 text-[12px] text-gray-500 dark:text-gray-400">
              <Lock size={14} className="flex-none mt-0.5" aria-hidden="true" />
              <p className="m-0" data-testid="apply-confidential">{CONFIDENTIAL_NOTE}</p>
            </div>
          </nav>

          {/* STEP */}
          <div className="flex-[1_1_440px] min-w-[300px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[20px] p-8 shadow-sm">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400 mb-4">
              <span className="w-[7px] h-[7px] rounded-full bg-emerald-500"></span>
              {cohortName} · Applications Open
            </span>
            <p className="tabular-nums mt-0 mb-4 text-[13px] text-gray-500 dark:text-gray-400">
              {appWindow?.closes_at
                ? `Applications close ${new Date(appWindow.closes_at).toLocaleString(undefined, { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.`
                : "Applications close seven days before the cohort starts, at 23:59 Delaware time."}
              {places.status === "ok" ? ` ${placesLabel(places.places)} in each cohort.` : null}
            </p>
            {places.status === "error" ? (
              <div className="-mt-2 mb-4">
                <Unreadable what="The number of places in a cohort" claim="This is not a statement that the cohort is full." onRetry={places.retry} />
              </div>
            ) : null}
            <div className="text-[12px] font-mono text-gray-500 dark:text-gray-400">Step {step} of {APPLY_STEPS.length}</div>
            <h1 className="mt-1 mb-5 text-[24px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100" data-testid="apply-step-title">{current.name}</h1>
            {step === 1 ? (
              <div className="text-[12.5px] text-gray-500 dark:text-gray-400 mb-4">Applying as {user?.name || user?.email || "your account"}.</div>
            ) : null}

            <ApplyStep step={step} basics={basics} answers={answers} setBasics={setBasics} setAnswers={setAnswers} />

            {error ? <div role="alert" className="mt-4 text-[13px] text-red-600 dark:text-red-400 font-medium" data-testid="apply-error">{error}</div> : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {step > 1 ? (
                <button type="button" onClick={() => go(step - 1)} className="h-[42px] px-4 rounded-[11px] border border-gray-200 dark:border-gray-700 text-[14px] font-semibold text-gray-700 dark:text-gray-200">Back</button>
              ) : null}
              {nextStep ? (
                <button type="button" onClick={next} data-testid="apply-continue"
                  className="h-[42px] px-5 rounded-[11px] bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-bold">
                  Continue to {nextStep.name}
                </button>
              ) : (
                <button type="button" onClick={submit} disabled={submitting} data-testid="apply-submit"
                  className="h-[42px] px-5 rounded-[11px] bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-bold flex items-center gap-2 disabled:opacity-60">
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : "Submit application"}
                </button>
              )}
              {!isPreview ? (
                <button type="button" onClick={saveDraft} disabled={saving} data-testid="apply-save-draft"
                  className="ml-auto h-[42px] px-4 rounded-[11px] text-[13.5px] font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-60">
                  {saving ? <Loader2 className="animate-spin" size={14} /> : "Save draft"}
                </button>
              ) : null}
            </div>
            {draftNote || savedAt ? (
              <p className="mt-2 mb-0 text-[12px] text-gray-500 dark:text-gray-400" data-testid="apply-draft-note">
                {draftNote || `Draft saved ${whenOf(savedAt) || ""}`.trim()}
              </p>
            ) : null}
            <p className="mt-4 mb-0 text-[12.5px] text-gray-400">No equity taken by Axal VC. Acceptance is selective.</p>
          </div>

          {/* WHAT YOUR ANSWER CHANGES — step 2 only, as the canvas draws it */}
          {step === 2 ? (
            <aside className="flex-[1_1_260px] min-w-[240px] rounded-[18px] border border-violet-100 dark:border-violet-500/20 bg-violet-50/50 dark:bg-violet-500/5 p-6" data-testid="apply-consequence">
              <div className="text-[13px] font-bold text-gray-800 dark:text-gray-100">What your answer is used for</div>
              <p className="mt-2 mb-0 text-[13.5px] leading-relaxed text-gray-700 dark:text-gray-200">{consequence.text}</p>
              <p className="mt-3 mb-0 text-[12px] text-gray-500 dark:text-gray-400">{consequence.foot}</p>
            </aside>
          ) : null}
        </div>
      )}
    </LabPageShell>
  );
}
