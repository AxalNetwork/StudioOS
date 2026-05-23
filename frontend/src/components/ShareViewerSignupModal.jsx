import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, Loader2, ArrowRight, FileSignature, MessageSquare } from 'lucide-react';
import { useEscapeClose } from './useEscapeClose';
import { api } from '../lib/api';

const STEPS = { SIGNUP: 'signup', NDA: 'nda', POST_NDA: 'post_nda', DONE: 'done' };

export default function ShareViewerSignupModal({
  category, shareToken, deckId, viewId, projectId, projectName, methodId, onClose,
}) {
  useEscapeClose(onClose);
  const [step, setStep] = useState(STEPS.SIGNUP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    email: '', name: '', role: category === 'commercial' ? 'partner' : 'investor',
  });
  const [user, setUser] = useState(null);
  const [ndaDoc, setNdaDoc] = useState(null);
  const [dealPack, setDealPack] = useState([]);
  const [feedback, setFeedback] = useState({
    overall_note: '', problem_fit: '', willingness_to_pay: '', contact: '',
    slide_reactions: {},
  });
  const [dealForm, setDealForm] = useState({
    check_size: '$25,000', valuation_cap: '$8M', discount: '20%',
  });

  async function submitSignup(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const res = await api.deckShareSignup(shareToken, {
        email: form.email, name: form.name, role: form.role, view_id: viewId,
      });
      setUser(res);
      setStep(STEPS.NDA);
    } catch (err) {
      setError(err?.message || 'Signup failed');
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

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full my-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b dark:border-slate-700 px-6 py-4 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
              {step === STEPS.SIGNUP && 'Join the Axal network'}
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
                Create your Axal account to continue. We'll send a verification email later.
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
            </form>
          )}

          {step === STEPS.NDA && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Welcome, {user?.name}. Review and accept the project NDA before proceeding.
              </p>
              <div className="border dark:border-slate-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-950 text-xs leading-relaxed max-h-64 overflow-y-auto">
                <p className="font-semibold mb-2">{projectName || 'Project'} — Non-Disclosure Agreement</p>
                <p className="text-gray-600 dark:text-slate-400">
                  You agree to keep all information disclosed in this deck and any subsequent
                  materials confidential. The full template will be sent to your email for your
                  records, and is governed by the standard Axal investor NDA.
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
                Generated deal pack for {projectName || 'this project'}. Review each document, then sign all to record your commitment.
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
                  : 'The founder has been notified — you can track progress from your Axal dashboard.'}
              </p>
              <button
                onClick={onClose}
                className="mt-4 inline-flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800"
              >Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
