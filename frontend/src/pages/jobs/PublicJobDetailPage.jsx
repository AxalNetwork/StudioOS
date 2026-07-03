// Task #68 — Public Job Board: public role detail + apply form (no auth).
// Mirrors PublicEventDetailPage: slate palette, Turnstile lifecycle, inline
// success/error states. Adds an optional resume upload (PDF ≤ 5MB → data URI).
import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Briefcase, MapPin, Globe, ArrowLeft, Loader2, AlertTriangle, CheckCircle2, Upload, X,
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import { jobsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const EMPLOYMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', intern: 'Internship', contract: 'Contract',
};
const SENIORITY_LABELS = {
  intern: 'Intern', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead', executive: 'Executive',
};

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

const APPLY_ERROR_MESSAGES = {
  turnstile_failed: 'Verification failed — please complete the challenge again.',
  invalid_email: 'Please enter a valid email address.',
  already_applied: "You've already applied to this role.",
  rate_limited: 'Too many applications from your network. Please try again later.',
  storage_not_configured: 'Resume uploads are temporarily unavailable. Please try again without a resume.',
  resume_rejected: 'Your resume was rejected. Please upload a PDF under 5MB.',
  not_found: 'This role is no longer accepting applications.',
};

export default function PublicJobDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState({ name: '', email: '', cover_note: '', linkedin_url: '', portfolio_url: '' });
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeError, setResumeError] = useState('');
  const [status, setStatus] = useState({ state: 'idle', error: '', result: null });

  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const res = await jobsPublic.read(slug);
        if (!cancelled) setJob(res?.job || null);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e?.status === 404 ? 'This role could not be found.' : 'Could not load this role.');
          reportError(e, { where: 'PublicJobDetailPage.load', slug });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [slug]);

  // Turnstile lifecycle (copied from PublicEventDetailPage).
  const formVisible = status.state !== 'sent';
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !formVisible || !job) return;
    let cancelled = false;
    let interval;
    const renderTurnstile = () => {
      if (cancelled || !turnstileRef.current) return;
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
      }
      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        theme: 'auto',
      });
    };
    if (typeof window.turnstile === 'undefined') {
      let attempts = 0;
      interval = setInterval(() => {
        attempts += 1;
        if (typeof window.turnstile !== 'undefined' && turnstileRef.current) {
          clearInterval(interval);
          renderTurnstile();
        } else if (attempts >= 50) {
          clearInterval(interval);
        }
      }, 200);
    } else {
      renderTurnstile();
    }
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }
    };
  }, [formVisible, job]);

  // Where the applicant is routed after a successful submit. Spec: successful
  // apply must route the applicant INTO the existing registration flow (or
  // sign-in if they already have an account) — not just show a link. Prefill
  // their email so the flow is one tap; the application is linked to the new
  // account by email match on the founder's applicants view.
  const postApplyDest = () => {
    const email = encodeURIComponent(form.email || '');
    return status.result?.has_account
      ? `/login?email=${email}`
      : `/register?email=${email}&intent=job-application`;
  };

  // Surface the confirmation briefly, then auto-advance into registration/sign-in.
  useEffect(() => {
    if (status.state !== 'sent') return undefined;
    const t = setTimeout(() => navigate(postApplyDest()), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state, status.result]);

  const onPickResume = (e) => {
    setResumeError('');
    const file = e.target.files?.[0] || null;
    if (!file) { setResumeFile(null); return; }
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setResumeError('Resume must be a PDF file.');
      setResumeFile(null);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      setResumeError('Resume must be under 5MB.');
      setResumeFile(null);
      e.target.value = '';
      return;
    }
    setResumeFile(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus({ state: 'error', error: 'Please complete the verification challenge.', result: null });
      return;
    }
    setStatus({ state: 'sending', error: '', result: null });
    try {
      let resumeDataUri;
      let resumeName;
      if (resumeFile) {
        resumeDataUri = await readFileAsDataUri(resumeFile);
        resumeName = resumeFile.name;
      }
      const res = await jobsPublic.apply(slug, {
        name: form.name,
        email: form.email,
        cover_note: form.cover_note || undefined,
        linkedin_url: form.linkedin_url || undefined,
        portfolio_url: form.portfolio_url || undefined,
        resume_data_uri: resumeDataUri,
        resume_name: resumeName,
        turnstile_token: turnstileToken,
      });
      setTurnstileToken('');
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
      }
      setStatus({ state: 'sent', error: '', result: res });
    } catch (err) {
      const raw = err?.message || '';
      const msg = APPLY_ERROR_MESSAGES[raw] || raw || 'Something went wrong. Please try again.';
      setStatus({ state: 'error', error: msg, result: null });
      if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
        setTurnstileToken('');
      }
      if (!APPLY_ERROR_MESSAGES[raw]) reportError(err, { where: 'PublicJobDetailPage.apply', slug });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10">
        <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 mb-6">
          <ArrowLeft size={16} /> All roles
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading…
          </div>
        ) : loadError ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3">
            <AlertTriangle size={18} /> {loadError}
          </div>
        ) : job ? (
          <>
            <header className="mb-6">
              <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 mb-2">
                <Briefcase size={18} />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
                </span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight">{job.title}</h1>
              {job.startup_name ? (
                <p className="mt-1 text-slate-600 dark:text-slate-400">{job.startup_name}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                {job.seniority ? <span>{SENIORITY_LABELS[job.seniority] || job.seniority}</span> : null}
                {job.remote ? (
                  <span className="inline-flex items-center gap-1"><Globe size={14} /> Remote</span>
                ) : job.location_text ? (
                  <span className="inline-flex items-center gap-1"><MapPin size={14} /> {job.location_text}</span>
                ) : null}
              </div>
            </header>

            {job.summary ? (
              <p className="text-lg text-slate-700 dark:text-slate-300 mb-6">{job.summary}</p>
            ) : null}
            {job.description ? (
              <div className="prose prose-slate dark:prose-invert max-w-none mb-10 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {job.description}
              </div>
            ) : null}

            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              {status.state === 'sent' ? (
                <div className="text-center py-6">
                  <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-3" />
                  <h2 className="text-xl font-semibold">Application submitted</h2>
                  <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Thanks for applying to <span className="font-medium">{job.title}</span>.{' '}
                    {status.result?.has_account
                      ? 'Sign in to track your application — taking you there now…'
                      : 'Finish creating your account to track this and future applications — taking you there now…'}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(postApplyDest())}
                    className="mt-4 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 text-white font-medium text-sm hover:bg-violet-700"
                  >
                    {status.result?.has_account ? 'Sign in now' : 'Create your account'}
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <h2 className="text-lg font-semibold">Apply for this role</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Name</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Email <span className="text-red-500">*</span></label>
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">LinkedIn URL</label>
                      <input
                        type="url"
                        value={form.linkedin_url}
                        onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))}
                        placeholder="https://linkedin.com/in/…"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Portfolio URL</label>
                      <input
                        type="url"
                        value={form.portfolio_url}
                        onChange={(e) => setForm((f) => ({ ...f, portfolio_url: e.target.value }))}
                        placeholder="https://…"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Cover note</label>
                    <textarea
                      rows={4}
                      value={form.cover_note}
                      onChange={(e) => setForm((f) => ({ ...f, cover_note: e.target.value }))}
                      placeholder="Tell the team why you're a great fit"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Resume (PDF, optional)</label>
                    {resumeFile ? (
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm">
                        <span className="truncate">{resumeFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setResumeFile(null)}
                          className="shrink-0 text-slate-400 hover:text-red-500"
                          aria-label="Remove resume"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-500 cursor-pointer hover:border-violet-400">
                        <Upload size={16} />
                        <span>Choose a PDF (max 5MB)</span>
                        <input type="file" accept="application/pdf,.pdf" onChange={onPickResume} className="hidden" />
                      </label>
                    )}
                    {resumeError ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{resumeError}</p> : null}
                  </div>

                  {TURNSTILE_SITE_KEY ? <div ref={turnstileRef} className="flex justify-start" /> : null}

                  {status.state === 'error' ? (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
                      <AlertTriangle size={16} /> {status.error}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={status.state === 'sending' || (TURNSTILE_SITE_KEY && !turnstileToken)}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 text-white font-medium text-sm hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {status.state === 'sending' ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : 'Submit application'}
                  </button>
                </form>
              )}
            </section>
          </>
        ) : null}
      </main>
      <PublicFooter />
    </div>
  );
}
