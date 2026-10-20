/**
 * `/jobs/:slug` — one role, built to the owner's canvas (D679, #1553;
 * `design/canvases/integrated/Axal VC Website.dc.html`, JOB DETAIL and
 * REGISTRATION GATE).
 *
 * THE PAGE draws only what `GET /api/public/jobs/:slug` returns: the title,
 * the company, the type, the level, the place, the date it was posted, the
 * summary and the description, and the compensation band when the read
 * sends one: a band is stored on every posting that has one, but the read
 * sends it only when the role's founder switched it on (#2181), so the
 * Compensation fact is drawn from that object alone. The canvas's reporting
 * line, start date, stage, "About" paragraph and company figures (a readiness
 * score, revenue) have no column on a posting, so they are not drawn.
 *
 * THE SHEET is the canvas's two steps, carrying the flow this page already
 * ran. The canvas registers first and applies second. The signup cannot be run
 * from a sheet as it stands: it has no password (it emails a sign-in link that
 * must be opened before the account can sign in), it is Turnstile-gated on its
 * own, and the apply route is Turnstile-gated too, so one sheet would need two
 * challenges. So step 1 is the existing application (`jobsPublic.apply`, no
 * account, Turnstile-gated) and step 2 confirms it and hands over to the
 * existing registration — or sign-in, for an address that already has an
 * account — exactly as the page did before. A signed-in member has their name
 * and email filled in and is sent to My applications instead.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Briefcase, Check, Upload, X } from 'lucide-react';
import SitePage from '../../components/site/SitePage';
import NetworkSubNav from '../../components/site/NetworkSubNav';
import { EmptyNote } from '../../components/site/SiteBlocks';
import { jobsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';
import { loadTurnstile } from '../../lib/turnstile';
import { useAuth } from '../../hooks/useAuthSync';
import {
  JOB_COPY, EMPLOYMENT_LABELS, avatarTone, companyInitials, descriptionBlocks, jobFacts, jobGeo, jobMeta,
  otherRoles, postedLabel,
} from '../../lib/siteNetwork2';
import '../site/network2.css';

const TURNSTILE_SITE_KEY = (import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || '';
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
/** How long step 2 stays up before it hands a signed-out applicant to registration or sign-in. */
const HANDOFF_MS = 6000;

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

/**
 * Where an applicant goes after step 2. Spec (Task #68): a successful apply
 * routes the applicant INTO the existing registration flow, or to sign-in when
 * the address already has an account (`has_account` from the apply route),
 * with the email prefilled — the application is linked to the account by
 * email. A member who is already signed in goes to their applications.
 */
export function applyHandoff({ hasAccount, email, signedIn }) {
  const e = encodeURIComponent(email || '');
  if (signedIn) {
    return { href: '/my/applications', label: 'See your applications', line: 'Track it, and every role you apply to, under My applications.', auto: false };
  }
  return hasAccount
    ? { href: `/login?email=${e}`, label: 'Sign in now', line: 'Sign in to track your application.', auto: true }
    : { href: `/register?email=${e}&intent=job-application`, label: 'Create your account', line: 'Finish creating your account to track this and future applications.', auto: true };
}

/** Step 2: the application is in, and what happens next. */
export function ApplySent({ job, handoff, onClose }) {
  const company = job.startup_name;
  return (
    <div className="ax-n2-done">
      <div className="ax-n2-done-icon" aria-hidden="true"><Check size={22} strokeWidth={2.6} /></div>
      <h2 id="ax-n2-sheet-h" className="ax-n2-sheet-t" tabIndex={-1}>Application sent</h2>
      <p className="ax-n2-done-copy">
        Your application for <strong>{job.title}</strong>{company ? ` at ${company}` : ''} has been sent to the hiring founder.
      </p>
      <div className="ax-n2-next">
        <div className="ax-lbl-q" style={{ marginBottom: 10 }}>Next</div>
        <ol>
          <li><span className="ax-mono">01</span><span>The hiring founder reviews your profile alongside the application.</span></li>
          <li><span className="ax-mono">02</span><span>{handoff.line}{handoff.auto ? ' Taking you there now…' : ''}</span></li>
        </ol>
      </div>
      <Link to={handoff.href} className="ax-btn ax-btn-md ax-btn-primary">{handoff.label} →</Link>
      <p className="ax-n2-sheet-foot"><button type="button" className="ax-n2-textlink" onClick={onClose}>Done</button></p>
    </div>
  );
}

/**
 * The application sheet (the canvas's REGISTRATION GATE). Step 1 is the
 * existing public application — the same fields, the same Turnstile gate and
 * the same `jobsPublic.apply` call this page made before — and step 2 is
 * `ApplySent`. It never creates an account itself.
 */
export function ApplySheet({ job, slug, user, onClose }) {
  const navigate = useNavigate();
  const signedIn = Boolean(user);
  const [form, setForm] = useState(() => ({
    name: user?.name || '', email: user?.email || '', cover_note: '', linkedin_url: '', portfolio_url: '',
  }));
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeError, setResumeError] = useState('');
  const [status, setStatus] = useState({ state: 'idle', error: '', result: null });
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);
  const dialogRef = useRef(null);
  const sent = status.state === 'sent';
  const handoff = applyHandoff({ hasAccount: status.result?.has_account, email: form.email, signedIn });

  // Escape closes, Tab stays inside, and the page behind does not scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const nodes = dialogRef.current.querySelectorAll('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])');
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Focus the first field on open, and the confirmation once it is sent.
  useEffect(() => {
    const el = dialogRef.current?.querySelector(sent ? '#ax-n2-sheet-h' : 'input, textarea');
    if (el) el.focus();
  }, [sent]);

  // Turnstile lifecycle (as PublicEventDetailPage runs it).
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || sent) return undefined;
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
        theme: 'light',
      });
    };
    loadTurnstile().catch(() => {});
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
  }, [sent]);

  // A signed-out applicant is carried on into registration or sign-in, as
  // before; closing the sheet first cancels it.
  useEffect(() => {
    if (!sent || !handoff.auto) return undefined;
    const t = setTimeout(() => navigate(handoff.href), HANDOFF_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent, status.result]);

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
      // D258 — the table is keyed by the refusal's CODE, which travels on
      // `err.code`. It used to be keyed by `err.message`, which held the code
      // only while `request()` put a code there; `resume_rejected` arrives
      // with the storage layer's own exception text as its `message`, so
      // keying on the message showed that text instead of this page's sentence.
      const known = Object.hasOwn(APPLY_ERROR_MESSAGES, err?.code ?? '')
        ? APPLY_ERROR_MESSAGES[err.code]
        : null;
      const msg = known || err?.message || 'Something went wrong. Please try again.';
      setStatus({ state: 'error', error: msg, result: null });
      if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
        setTurnstileToken('');
      }
      if (!known) reportError('PublicJobDetailPage:apply', err);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const company = job.startup_name;

  return (
    <div className="ax-n2-scrim" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="ax-n2-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ax-n2-sheet-h"
        onClick={(e) => e.stopPropagation()}
      >
        {sent ? (
          <ApplySent job={job} handoff={handoff} onClose={onClose} />
        ) : (
          <>
            <div className="ax-n2-sheet-head">
              <div>
                <div className="ax-lbl-q">Step 1 of 2 · Your application</div>
                <h2 id="ax-n2-sheet-h" className="ax-n2-sheet-t">{JOB_COPY.applyTitle}</h2>
                <p className="ax-n2-sheet-d">{job.title}{company ? ` at ${company}` : ''}.</p>
              </div>
              <button type="button" className="ax-n2-x" onClick={onClose} aria-label="Close"><X size={15} /></button>
            </div>
            <form onSubmit={submit} className="ax-n2-form">
              <input className="ax-n2-field" type="text" value={form.name} onChange={set('name')} placeholder="Full name" aria-label="Full name" autoComplete="name" />
              <input className="ax-n2-field" type="email" required value={form.email} onChange={set('email')} placeholder="Work email" aria-label="Email" autoComplete="email" />
              <input className="ax-n2-field" type="url" value={form.linkedin_url} onChange={set('linkedin_url')} placeholder="LinkedIn URL (optional)" aria-label="LinkedIn URL" />
              <input className="ax-n2-field" type="url" value={form.portfolio_url} onChange={set('portfolio_url')} placeholder="Portfolio URL (optional)" aria-label="Portfolio URL" />
              <textarea className="ax-n2-field" rows={4} value={form.cover_note} onChange={set('cover_note')} placeholder="Cover note (optional)" aria-label="Cover note" />
              {resumeFile ? (
                <div className="ax-n2-file">
                  <span>{resumeFile.name}</span>
                  <button type="button" className="ax-n2-file-x" onClick={() => setResumeFile(null)} aria-label="Remove resume"><X size={15} /></button>
                </div>
              ) : (
                <label className="ax-n2-file">
                  <span>Resume (PDF, optional, max 5MB)</span>
                  <Upload size={15} aria-hidden="true" />
                  <input type="file" accept="application/pdf,.pdf" onChange={onPickResume} className="sr-only" />
                </label>
              )}
              {resumeError ? <p className="ax-n2-fielderr">{resumeError}</p> : null}
              {TURNSTILE_SITE_KEY ? <div ref={turnstileRef} className="ax-n2-turnstile" /> : null}
              {status.state === 'error' ? <p role="alert" className="ax-n2-alert">{status.error}</p> : null}
              <button
                type="submit"
                disabled={status.state === 'sending' || Boolean(TURNSTILE_SITE_KEY && !turnstileToken)}
                className="ax-btn ax-btn-primary ax-n2-submit"
              >
                {status.state === 'sending' ? 'Sending…' : 'Send application →'}
              </button>
            </form>
            {!signedIn && (
              <p className="ax-n2-sheet-foot">
                Already have an account? <Link to={`/login?next=${encodeURIComponent(`/jobs/${slug}`)}`}>Sign in</Link>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The role itself: the header, the facts, the summary and description, the side cards. */
export function JobBody({ job, related, onApply, applyRef }) {
  const company = job.startup_name;
  const initials = companyInitials(company);
  const posted = postedLabel(job.created_at);
  const sub = [company, jobGeo(job)].filter(Boolean).join(' · ');
  const facts = jobFacts(job);
  const meta = jobMeta(job);
  const blocks = descriptionBlocks(job.description);
  return (
    <div className="ax-n2-job">
      <div>
        <div className="ax-n2-job-head">
          <span className="ax-avatar ax-n2-av-lg" aria-hidden="true" style={{ background: avatarTone(company || job.title) }}>
            {initials || <Briefcase size={22} />}
          </span>
          <div className="ax-n2-main">
            <div className="ax-n2-title-row">
              <span className="ax-chip">{EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}</span>
              {posted && <span className="ax-mono ax-n2-muted" style={{ fontSize: 11.5 }}>Posted {posted}</span>}
            </div>
            <h1 className="ax-n2-job-h1">{job.title}</h1>
            {sub && <p className="ax-n2-job-sub">{sub}</p>}
          </div>
        </div>

        {facts.length > 0 && (
          <dl className="ax-n2-jfacts">
            {facts.map((f) => (
              <div key={f.k}><dt className="ax-lbl-q">{f.k}</dt><dd>{f.v}</dd></div>
            ))}
          </dl>
        )}

        {job.summary ? <p className="ax-n2-intro">{job.summary}</p> : null}

        {blocks.length > 0 && (
          <div className="ax-n2-body">
            {blocks.map((b, i) => {
              const key = `${b.kind}-${i}`;
              if (b.kind === 'h') return <h2 key={key}>{b.text}</h2>;
              if (b.kind === 'list') {
                return (
                  <ul key={key} className="ax-n2-bullets">
                    {b.items.map((it, j) => <li key={`${key}-${j}`}>{it}</li>)}
                  </ul>
                );
              }
              return <p key={key}>{b.text}</p>;
            })}
          </div>
        )}
      </div>

      <aside className="ax-n2-aside" aria-label="Apply">
        <div className="ax-n2-sidecard">
          <h2 className="ax-n2-sidecard-t">{JOB_COPY.applyTitle}</h2>
          <p className="ax-n2-sidecard-d">{JOB_COPY.applyCopy}</p>
          <button ref={applyRef} type="button" onClick={onApply} className="ax-btn ax-btn-primary ax-n2-apply" aria-haspopup="dialog">
            Apply now →
          </button>
          {meta.length > 0 && (
            <dl className="ax-n2-meta">
              {meta.map((m) => <div key={m.k}><dt>{m.k}</dt><dd>{m.v}</dd></div>)}
            </dl>
          )}
        </div>
        {company && Array.isArray(related) && (
          <div className="ax-n2-sidecard">
            <h2 className="ax-lbl-q ax-n2-month-t" style={{ marginBottom: 12 }}>Other roles at {company}</h2>
            {related.length > 0 ? (
              <ul className="ax-n2-related">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link to={`/jobs/${r.slug}`}>
                      <div className="ax-n2-related-t">{r.title}</div>
                      <div className="ax-n2-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                        {[jobGeo(r), EMPLOYMENT_LABELS[r.employment_type]].filter(Boolean).join(' · ')}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ax-n2-muted" style={{ lineHeight: 1.6, margin: 0 }}>
                This is the only open role at {company} right now. <Link to="/jobs" className="ax-link">Browse all roles →</Link>
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

export default function PublicJobDetailPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [related, setRelated] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const applyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError('');
      setApplyOpen(false);
      try {
        const res = await jobsPublic.read(slug);
        if (!cancelled) setJob(res?.job || null);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e?.status === 404 ? 'This role could not be found.' : 'Could not load this role.');
          // `slug` is dropped rather than folded into the scope: it is the
          // page's own path segment, so `entry.path` already records it, and a
          // per-slug scope would break the beacon's `scope|message` dedupe.
          reportError('PublicJobDetailPage:load', e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [slug]);

  // "Other roles at {company}": the public feed searched by the company's
  // name, kept to the same company. A failed read draws no card, not "none".
  useEffect(() => {
    setRelated(null);
    if (!job?.project_id || !job?.startup_name) return undefined;
    let cancelled = false;
    jobsPublic.list({ q: job.startup_name, limit: 50 })
      .then((res) => { if (!cancelled) setRelated(otherRoles(res?.jobs, job)); })
      .catch((e) => { if (!cancelled) reportError('PublicJobDetailPage:related', e); });
    return () => { cancelled = true; };
  }, [job]);

  const closeApply = useCallback(() => {
    setApplyOpen(false);
    if (applyRef.current) applyRef.current.focus();
  }, []);

  return (
    <SitePage title={job?.title || 'Jobs'}>
      <NetworkSubNav />
      <div className="ax-wrap ax-n2-page is-detail">
        <Link to="/jobs" className="ax-n2-back"><ArrowLeft size={14} aria-hidden="true" /> All roles</Link>

        {loading ? (
          <EmptyNote>Loading…</EmptyNote>
        ) : loadError ? (
          <p role="alert" className="ax-n2-alert">{loadError}</p>
        ) : job ? (
          <JobBody job={job} related={related} onApply={() => setApplyOpen(true)} applyRef={applyRef} />
        ) : null}
      </div>
      {applyOpen && job && typeof document !== 'undefined' && createPortal(
        <div className="ax-site">
          <ApplySheet job={job} slug={slug} user={user} onClose={closeApply} />
        </div>,
        document.body,
      )}
    </SitePage>
  );
}
