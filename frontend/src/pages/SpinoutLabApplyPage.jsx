import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Loader2, ArrowLeft } from "lucide-react";
import { useAuth } from "../hooks/useAuthSync";
import { spinoutLab } from "../lib/api";

// Apply to Cohort 4 — signed-in application form (reference design:
// Spin-Out Lab.dc.html APPLY VIEW). No contact fields: the account is the
// applicant, shown in the "Signed in" card. Submit → POST /spinout-lab/apply
// → confirmation card + confirmation email (production Worker).

const STAGES = ["Idea / pre-formation", "Prototype in progress", "Early revenue"];
const JURIS = [
  { key: "de", label: "Delaware C-Corp — Delaware, USA", entity: "Delaware C-Corp" },
  { key: "wy", label: "Wyoming C-Corp — Wyoming, USA", entity: "Wyoming C-Corp" },
];
const APPLY_STEPS = [
  { n: 1, title: "Application review", body: "A program manager reviews within 5 business days." },
  { n: 2, title: "Founder interview", body: "A 30-minute call to align on scope and readiness." },
  { n: 3, title: "Cohort onboarding", body: "Accepted founders start at the Validate gate on day one." },
];

function initialsOf(name, email) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function SpinoutLabApplyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [company, setCompany] = useState("");
  const [idea, setIdea] = useState("");
  const [incorporated, setIncorporated] = useState("no");
  const [stage, setStage] = useState(STAGES[0]);
  const [jurisKey, setJurisKey] = useState("de");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await spinoutLab.state();
        if (!alive) return;
        if (s?.admitted) { navigate("/spinout-lab", { replace: true }); return; }
        if (s?.application?.status === "pending") setSubmitted(true);
      } catch { /* fresh form */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [navigate]);

  const juris = JURIS.find((j) => j.key === jurisKey) || JURIS[0];
  const jurisLabel = incorporated === "yes" ? "Current jurisdiction" : "Preferred jurisdiction";
  const outcomes = [
    `${juris.entity} incorporated`,
    "Vesting cap table on Carta",
    "83(b) Election handled",
    "12-slide venture pitch deck",
  ];

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!company.trim()) { setError("Company / working name is required."); return; }
    if (!idea.trim()) { setError("Please describe your idea or project."); return; }
    setSubmitting(true);
    try {
      await spinoutLab.apply({
        company_name: company.trim(),
        idea: idea.trim(),
        incorporated,
        stage,
        jurisdiction: juris.label,
        cohort: "Cohort 4",
      });
      setSubmitted(true);
    } catch (err) {
      setError(err?.message || "Failed to submit application.");
    } finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-gray-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div className="max-w-[1080px] mx-auto" data-testid="spinout-apply-page">
      <Link
        to="/spinout-lab"
        className="inline-flex items-center gap-2 h-[34px] px-3 rounded-[9px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors mb-5"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to Spin-Out Lab
      </Link>

      <div className="flex flex-wrap gap-6 items-start">
        {/* FORM / CONFIRMATION */}
        <div className="flex-[1_1_460px] min-w-[320px]">
          {!submitted ? (
            <form onSubmit={submit} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[20px] p-8 shadow-sm">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400 mb-4">
                <span className="w-[7px] h-[7px] rounded-full bg-emerald-500"></span>
                Cohort 4 · Applications Open
              </span>
              <h1 className="m-0 text-[26px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">Apply to Cohort 4</h1>
              <p className="tabular-nums mt-2 mb-5 text-[14px] text-gray-500 dark:text-gray-400">Applications close August 1, 2026. 8 spots available.</p>

              {/* Signed-in account */}
              <div className="flex items-center gap-3 bg-violet-50/50 dark:bg-violet-500/5 border border-violet-100 dark:border-violet-500/20 rounded-xl px-3.5 py-3 mb-5">
                <div className="w-[38px] h-[38px] flex-none rounded-full bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 font-bold text-[13px] flex items-center justify-center">{initialsOf(user?.name, user?.email)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-bold text-gray-800 dark:text-gray-100 truncate">{user?.name || "Founder"}</div>
                  <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{user?.email}</div>
                </div>
                <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/50 border border-violet-100 dark:border-violet-800/50 rounded-full px-2.5 py-1">Signed in</span>
              </div>

              <div className="flex flex-col gap-[18px]">
                <label className="block">
                  <div className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Company / working name</div>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Northwind Labs"
                    data-testid="apply-company"
                    className="w-full h-[42px] px-3 border border-gray-200 dark:border-gray-700 rounded-[10px] text-[14px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none focus:border-violet-400 focus:ring-[3px] focus:ring-violet-500/15"
                  />
                </label>
                <label className="block">
                  <div className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Describe your idea or project</div>
                  <textarea
                    rows={4}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="What are you building, who is it for, and why now?"
                    data-testid="apply-idea"
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-[10px] text-[14px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none resize-y focus:border-violet-400 focus:ring-[3px] focus:ring-violet-500/15"
                  />
                </label>

                <div>
                  <div className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Are you already incorporated?</div>
                  <div className="flex gap-2">
                    {[{ v: "no", label: "Not yet" }, { v: "yes", label: "Already incorporated" }].map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => setIncorporated(o.v)}
                        className={`flex-1 h-[40px] rounded-[10px] text-[13.5px] font-semibold transition-all border ${
                          incorporated === o.v
                            ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40"
                            : "bg-white dark:bg-gray-950 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3.5 flex-wrap">
                  <label className="flex-[1_1_200px] min-w-0 block">
                    <div className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Current stage</div>
                    <select
                      value={stage}
                      onChange={(e) => setStage(e.target.value)}
                      className="w-full h-[42px] px-3 border border-gray-200 dark:border-gray-700 rounded-[10px] text-[14px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none focus:border-violet-400"
                    >
                      {STAGES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="flex-[1_1_200px] min-w-0 block">
                    <div className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{jurisLabel}</div>
                    <select
                      value={jurisKey}
                      onChange={(e) => setJurisKey(e.target.value)}
                      className="w-full h-[42px] px-3 border border-gray-200 dark:border-gray-700 rounded-[10px] text-[14px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none focus:border-violet-400"
                    >
                      {JURIS.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
                    </select>
                  </label>
                </div>

                {error && <div className="text-[13px] text-red-600 dark:text-red-400 font-medium">{error}</div>}

                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="apply-submit"
                  className="w-full h-[46px] rounded-[11px] bg-violet-600 hover:bg-violet-700 text-white text-[14.5px] font-bold flex items-center justify-center gap-2 shadow-sm shadow-violet-500/30 transition-colors disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : <>Submit Application <span className="text-[16px]" aria-hidden="true">→</span></>}
                </button>
                <p className="m-0 text-center text-[12.5px] text-gray-400">No equity taken by Axal VC. Acceptance is selective.</p>
              </div>
            </form>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[20px] px-8 py-10 shadow-sm text-center" data-testid="apply-received">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-[18px]">
                <Check size={28} aria-hidden="true" />
              </div>
              <h1 className="m-0 text-[24px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">Application received</h1>
              <p className="mt-2.5 mb-[22px] mx-auto text-[14px] text-gray-500 dark:text-gray-400 max-w-[380px] leading-normal">
                Your Cohort 4 application is in review. A program manager will respond within 5 business days. Selected founders begin with the Validate gate. We've also sent a confirmation to your email.
              </p>
              <Link
                to="/spinout-lab"
                className="inline-flex items-center h-[42px] px-5 rounded-[11px] bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-bold transition-colors"
              >
                Back to Spin-Out Lab
              </Link>
            </div>
          )}
        </div>

        {/* SIDE PANEL */}
        <div className="flex-[1_1_300px] min-w-[280px] flex flex-col gap-4">
          <div className="rounded-[18px] p-6 text-white" style={{ background: "linear-gradient(140deg,#241f45,#3b1d6e)" }}>
            <div className="tabular-nums text-[40px] font-black tracking-[-.03em] text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(90deg,#fff,#c4b5fd)", WebkitBackgroundClip: "text" }}>30 days</div>
            <p className="mt-1.5 mb-[18px] text-[13.5px] text-[#cbc4e8]">Idea to {juris.entity}, funded and venture-ready.</p>
            <div className="flex flex-col gap-2.5">
              {outcomes.map((o) => (
                <div key={o} className="flex items-center gap-2 text-[13px] text-[#ede9fe]">
                  <Check size={15} className="flex-none text-[#a78bfa]" aria-hidden="true" /> {o}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[18px] p-[22px]">
            <div className="text-[14px] font-bold text-gray-800 dark:text-gray-100 mb-3.5">What happens next</div>
            <div className="flex flex-col gap-3.5">
              {APPLY_STEPS.map((s) => (
                <div key={s.n} className="flex gap-3">
                  <div className="tabular-nums w-6 h-6 flex-none rounded-[7px] bg-violet-50 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 font-extrabold text-[12px] flex items-center justify-center">{s.n}</div>
                  <div>
                    <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">{s.title}</div>
                    <div className="text-[12px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5">{s.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
