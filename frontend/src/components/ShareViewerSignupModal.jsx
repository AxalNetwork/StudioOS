import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Loader2, ArrowRight, FileSignature, MessageSquare } from 'lucide-react';
import { useEscapeClose } from './useEscapeClose';
import { api } from '../lib/api';

const STEPS = { SIGNUP: 'signup', NDA: 'nda', POST_NDA: 'post_nda', DONE: 'done' };

export default function ShareViewerSignupModal({
  category, shareToken, deckId, viewId, projectId, projectName, methodId, onClose,
  slides,
}) {
  useEscapeClose(onClose);
  const [step, setStep] = useState(STEPS.SIGNUP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [form, setForm] = useState({
    email: '', name: '', role: category === 'commercial' ? 'partner' : 'investor',
  });
  const [user, setUser] = useState(null);
  const [, setNdaDoc] = useState(null);
  const [dealPack, setDealPack] = useState([]);
  const [feedback, setFeedback] = useState({
    overall_note: '', problem_fit: '', willingness_to_pay: '', contact: '',
    slide_reactions: {},
  });

  function setSlideReaction(idx, value) {
    setFeedback((prev) => {
      const next = { ...(prev.slide_reactions || {}) };
      if (next[idx] === value) delete next[idx];
      else next[idx] = value;
      return { ...prev, slide_reactions: next };
    });
  }
  const REACTION_OPTS = [
    { key: 'like', label: '👍 Like' },
    { key: 'confused', label: '❓ Confused' },
    { key: 'want_more', label: '💡 Want more' },
  ];
  const [dealForm] = useState({
    check_size: '$25,000', valuation_cap: '$8M', discount: '20%',
  });

  async function submitSignup(e) {
    e.preventDefault();
    setError(null); setRequiresLogin(false); setBusy(true);
    try {
      const res = await api.deckShareSignup(shareToken, {
        email: form.email, name: form.name, role: form.role, view_id: viewId,
      });
      setUser(res);
      setStep(STEPS.NDA);
    } catch (err) {
      // 409 from the worker when the email already maps to an existing
      // account — we never auto-log-in across emails, so surface a
      // "Sign in" path instead. (Closes the takeover vector flagged in
      // code review.)
      if (err?.status === 409 && err?.data?.requires_login) {
        setRequiresLogin(true);
        setError(err.data.message || 'An account already exists for this email. Please sign in to continue.');
      } else {
        setError(err?.message || 'Signup failed');
      }
    } finally { setBusy(false); }
  }

  async function submitNda() {
    if (!user) return;
    setError(null); setBusy(true);
    try {
      // user_id is no longer trusted server-side (auth comes from the
      // session cookie minted by /signup) — passing it only for back-
      // compat / dev FastAPI; the worker route ignores it.
      const res = await api.deckShareNda(shareToken, {
        view_id: viewId, signed_by: form.name || user.email,
      });
      setNdaDoc(res);
      setStep(STEPS.POST_NDA);
      // Pre-load deal pack if fundraising. Surface failures so the user
      // sees an actionable error instead of the modal hanging at the
      // "Generating documents…" placeholder.
      if (category === 'fundraising') {
        try {
          const pack = await api.deckShareDealPack(shareToken, {
            view_id: viewId, ...dealForm,
          });
          setDealPack(pack?.documents || []);
        } catch (err) {
          setError(err?.message || 'Could not generate deal pack');
        }
      }
    } catch (err) {
      setError(err?.message || 'NDA signing failed');
    } finally { setBusy(false); }
  }

  async function submitFeedback() {
    setError(null); setBusy(true);
    try {
      await api.deckShareFeedback(shareToken, {
        view_id: viewId, ...feedback,
      });
      setStep(STEPS.DONE);
    } catch (err) {
      setError(err?.message || 'Could not save feedback');
    } finally { setBusy(false); }
  }

  async function signDealPack() {
    if (dealPack.length === 0) return;
    setError(null); setBusy(true);
    try {
      await api.deckShareSignDealPack(shareToken, {
        view_id: viewId,
        signed_by: form.name || user.email,
        document_ids: dealPack.map((d) => d.id).filter(Boolean),
      });
      setStep(STEPS.DONE);
    } catch (err) {
      setError(err?.message || 'Could not record signature');
    } finally { setBusy(false); }
  }

  // Portal to <body> so the overlay escapes any CSS-transformed ancestor
  // (the deck stage is rendered inside a `scale()` container — a plain
  // `fixed` child would be positioned/scaled relative to that transform
  // instead of the viewport). Task #23.
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full my-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b dark:border-slate-700 px-6 py-4 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
              {step === STEPS.SIGNUP && 'Join the Axal VC network'}
              {step === STEPS.NDA && 'Review and sign the NDA'}
              {step === STEPS.POST_NDA && category === 'commercial' && 'Share your feedback'}
              {step === STEPS.POST_NDA && category === 'fundraising' && 'Review the deal pack'}
              {step === STEPS.DONE && 'All set'}
            </h2>
            {projectName && (
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{projectName}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5">
          {error && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 dark:bg-red-900/20 dark:text-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          {step === STEPS.SIGNUP && (
            <form onSubmit={submitSignup} className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">
                Create your Axal VC account to continue. We'll send a verification email later.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Email</label>
                <input
                  type="email" required value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Full name</label>
                <input
                  type="text" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">I am a…</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950"
                >
                  <option value="investor">Investor</option>
                  <option value="partner">Operator / Partner</option>
                  <option value="founder">Founder</option>
                </select>
              </div>
              <button
                type="submit" disabled={busy}
                className="w-full mt-2 inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight size={14} />}
                {busy ? 'Creating account…' : 'Continue'}
              </button>
              {requiresLogin && (
                <a
                  href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/')}&email=${encodeURIComponent(form.email)}`}
                  className="block w-full mt-2 text-center bg-white border border-violet-300 text-violet-700 hover:bg-violet-50 text-sm font-medium px-4 py-2.5 rounded-lg dark:bg-gray-900"
                >
                  Sign in to your existing account
                </a>
              )}
            </form>
          )}

          {step === STEPS.NDA && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Welcome, {user?.name}. Review and accept the startup NDA before proceeding.
              </p>
              <div className="border dark:border-slate-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-950 text-xs leading-relaxed max-h-64 overflow-y-auto">
                <p className="font-semibold mb-2">{projectName || 'Startup'} — Non-Disclosure Agreement</p>
                <p className="text-gray-600 dark:text-slate-400">
                  You agree to keep all information disclosed in this deck and any subsequent
                  materials confidential. The full template will be sent to your email for your
                  records, and is governed by the standard Axal VC investor NDA.
                </p>
              </div>
              <button
                onClick={submitNda} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature size={14} />}
                {busy ? 'Recording signature…' : 'I agree — sign NDA'}
              </button>
            </div>
          )}

          {step === STEPS.POST_NDA && category === 'commercial' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                <MessageSquare className="inline w-4 h-4 mr-1" />
                Quick structured feedback for the team.
              </p>
              {Array.isArray(slides) && slides.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                    Per-slide reactions <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <div className="border dark:border-slate-700 rounded-lg divide-y dark:divide-slate-700 max-h-56 overflow-y-auto">
                    {slides.map((s) => {
                      const cur = feedback.slide_reactions?.[s.index];
                      return (
                        <div key={s.index} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className="flex-1 truncate text-gray-700 dark:text-slate-300">
                            <span className="text-gray-400 mr-1.5">{s.index + 1}.</span>{s.title}
                          </span>
                          <div className="flex gap-1 shrink-0">
                            {REACTION_OPTS.map((opt) => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => setSlideReaction(s.index, opt.key)}
                                className={`px-2 py-1 rounded border text-[11px] ${cur === opt.key
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : 'bg-white dark:bg-slate-950 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                              >{opt.label}</button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Problem fit</label>
                <div className="flex gap-2">
                  {['strong', 'mild', 'none'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFeedback({ ...feedback, problem_fit: v })}
                      className={`flex-1 px-3 py-1.5 text-xs rounded border ${feedback.problem_fit === v
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white dark:bg-slate-950 dark:border-slate-700'}`}
                    >{v}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Willingness to pay</label>
                <input
                  type="text" value={feedback.willingness_to_pay}
                  onChange={(e) => setFeedback({ ...feedback, willingness_to_pay: e.target.value })}
                  className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950"
                  placeholder="$200/seat/mo, $5k/yr, …"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Anything else?</label>
                <textarea
                  rows={4} value={feedback.overall_note}
                  onChange={(e) => setFeedback({ ...feedback, overall_note: e.target.value })}
                  className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950"
                  placeholder="What resonated, what didn't, what's missing?"
                />
              </div>
              <button
                onClick={submitFeedback} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 size={14} />}
                {busy ? 'Saving…' : 'Send feedback'}
              </button>
            </div>
          )}

          {step === STEPS.POST_NDA && category === 'fundraising' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Generated deal pack for {projectName || 'this startup'}. Review each document, then sign all to record your commitment.
              </p>
              {dealPack.length === 0 && (
                <p className="text-xs text-gray-500">Generating documents…</p>
              )}
              {dealPack.map((d) => (
                <details key={d.id} className="border dark:border-slate-700 rounded-lg">
                  <summary className="px-3 py-2 text-sm font-medium cursor-pointer">{d.title}</summary>
                  <pre className="px-3 py-2 text-[11px] whitespace-pre-wrap font-mono bg-gray-50 dark:bg-slate-950 max-h-60 overflow-y-auto">{d.content}</pre>
                </details>
              ))}
              <button
                onClick={signDealPack} disabled={busy || dealPack.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature size={14} />}
                {busy ? 'Signing…' : 'Sign all and notify the founder'}
              </button>
            </div>
          )}

          {step === STEPS.DONE && (
            <div className="text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">Thank you</p>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                {category === 'commercial'
                  ? 'Your feedback has been delivered to the founders.'
                  : 'The founder has been notified — you can track progress from your Axal VC dashboard.'}
              </p>
              <button
                onClick={onClose}
                className="mt-4 inline-flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800"
              >Close</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
