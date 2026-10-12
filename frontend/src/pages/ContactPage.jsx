import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import SitePage from '../components/site/SitePage';
import { Eyebrow, FilterPills } from '../components/site/SiteBlocks';
import { request } from '../lib/api';
import { loadTurnstile } from '../lib/turnstile';
import { openCohortCopy } from '../lib/spinoutLab';
import './site/contact.css';

/**
 * `/contact` — the owner's canvas CONTACT view (D680, #1554).
 *
 * The form posts to the existing `POST /api/contact` (cloudflare-worker/src/
 * routes/contact.ts) through `request()`, with the Turnstile widget and the
 * honeypot it always had. D680 taught that route the form's intent, company
 * and link; it derives the issue's subject from them.
 *
 * WHAT IS NOT PRINTED, AND WHY. The canvas closes the form with "Everything
 * you send is confidential. We do not share applications outside the fund
 * team." The route files each submission as an issue on the repository named
 * in wrangler.toml, AxalNetwork/StudioOS, which is public, so the sentence is
 * not true of the code and is left out until submissions go somewhere private
 * (D680). The canvas's "Cohort 5" is an example; the cohort is the Lab's own
 * rule, `openCohortCopy()`, as on the front page.
 */

const TURNSTILE_SITE_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || '';

/** The canvas's three intents, keyed as `contact.ts`'s CONTACT_INTENTS keys them. */
export const INTENTS = [
  { value: 'lab', label: 'Spin-Out Lab' },
  { value: 'invest', label: 'Investing / LP' },
  { value: 'advise', label: 'Advising' },
];

/**
 * The fourth intent. The Administrators page's "Request a licence" links to
 * `/contact?topic=licence`; the pill is drawn only then, so a visitor who came
 * for anything else sees the canvas's three (D680).
 */
export const LICENCE_INTENT = { value: 'licence', label: 'Licence' };

export function intentsFor(topic) {
  return topic === 'licence' ? [...INTENTS, LICENCE_INTENT] : INTENTS;
}

/** The pill pressed on arrival: Licence for `?topic=licence`, else the canvas's default. */
export function initialIntent(topic) {
  return topic === 'licence' ? LICENCE_INTENT.value : INTENTS[0].value;
}

/** The three ways in, with the canvas's addresses. `cohort` is `openCohortCopy()`'s answer or null. */
export function contactRoutes(cohort) {
  return [
    {
      t: 'Founder applications',
      d: `${cohort ? `Cohort ${cohort.cohortNum} applications` : 'Cohort applications'}, Office Hours requests, and programme questions.`,
      email: 'founders@axal.vc',
    },
    {
      t: 'Investor relations',
      d: 'Fund I access, LP onboarding, and reporting. Guillaume Lauzier, General Partner.',
      email: 'guillaume.lauzier@axal.vc',
    },
    {
      t: 'Advisors & partners',
      d: 'Advisor applications and service-partner enquiries for the Lab network.',
      email: 'network@axal.vc',
    },
  ];
}

/**
 * What the sent state says. The held-for-a-cohort sentence is about Lab
 * applications, so it follows only the Spin-Out Lab intent.
 */
export function sentNote(intent, cohort) {
  const reply = 'We reply within five business days.';
  if (intent !== 'lab') return reply;
  const which = cohort ? `Cohort ${cohort.cohortNum}` : 'the open cohort';
  return `${reply} If ${which} is full, we will tell you which cohort you are being held for.`;
}

export const MAX_LINK = 500;

/** The route's rule for the optional link: empty, or an http(s) URL of at most 500 characters. */
export function isHttpLink(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  if (s.length > MAX_LINK) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** The body `POST /api/contact` receives. `message` is the about box. */
export function contactPayload({ intent, form, turnstileToken }) {
  return {
    intent,
    name: form.name,
    email: form.email,
    company: form.company,
    link: String(form.link || '').trim(),
    message: form.about,
    hp: form.hp,
    turnstileToken,
  };
}

const EMPTY = { name: '', email: '', company: '', link: '', about: '', hp: '' };

const REFUSALS = {
  turnstile_failed: 'Verification failed — please complete the challenge again.',
  invalid_link: 'The link must start with http:// or https:// and be at most 500 characters.',
};

export default function ContactPage() {
  const [params] = useSearchParams();
  const topic = params.get('topic');
  const intents = intentsFor(topic);
  const cohort = openCohortCopy();

  // The pressed pill belongs to the topic it was pressed under: a link that
  // changes `?topic=` in place starts again from that topic's default.
  const [picked, setPicked] = useState({ topic, value: initialIntent(topic) });
  const intent = picked.topic === topic ? picked.value : initialIntent(topic);
  const setIntent = (value) => setPicked({ topic, value });
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState({ state: 'idle', error: '', issueUrl: '', intent: '' });
  const [turnstileToken, setTurnstileToken] = useState('');

  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ---- Cloudflare Turnstile widget lifecycle (mirrors RegisterPage) ----
  const formVisible = status.state !== 'sent';
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !formVisible) return;
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
      // Cap polling at 50 attempts (~10s) so a blocked Turnstile script
      // (ad blocker, offline) doesn't leak an interval per mount.
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
  }, [formVisible]);

  const fail = (error) => setStatus({ state: 'error', error, issueUrl: '', intent: '' });

  const submit = async (e) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      fail('Please complete the verification challenge.');
      return;
    }
    if (!isHttpLink(form.link)) {
      fail(REFUSALS.invalid_link);
      return;
    }
    setStatus({ state: 'sending', error: '', issueUrl: '', intent: '' });
    try {
      const res = await request('/contact', {
        method: 'POST',
        body: JSON.stringify(contactPayload({ intent, form, turnstileToken })),
      });
      setStatus({ state: 'sent', error: '', issueUrl: res?.issue_url || '', intent });
      setForm(EMPTY);
      setTurnstileToken('');
    } catch (err) {
      // D258 — the refusal's code is `err.code`; `err.message` is its sentence.
      fail(REFUSALS[err?.code] || err?.message || 'Something went wrong. Please try again.');
      if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
        setTurnstileToken('');
      }
    }
  };

  return (
    <SitePage title="Contact">
      <div className="ax-wrap ax-contact">
        <div className="ax-contact-grid">
          <div>
            <Eyebrow>Get in touch</Eyebrow>
            <h1 className="ax-contact-h1">Tell us what you are building.</h1>
            <p className="ax-contact-lede">
              Three sentences is enough. We read everything and reply within five business days — including when the answer is no.
            </p>
            <ul className="ax-contact-routes" aria-label="Who to write to">
              {contactRoutes(cohort).map((r) => (
                <li key={r.email} className="ax-contact-route">
                  <div className="ax-contact-route-t">{r.t}</div>
                  <div className="ax-contact-route-d">{r.d}</div>
                  <a className="ax-mono" href={`mailto:${r.email}`}>{r.email}</a>
                </li>
              ))}
            </ul>
          </div>

          <div className="ax-contact-card">
            {status.state === 'sent' ? (
              <div className="ax-contact-sent" role="status">
                <div className="ax-contact-tick" aria-hidden="true">✓</div>
                <div className="ax-contact-sent-t">Received.</div>
                <p className="ax-contact-sent-d">{sentNote(status.intent, cohort)}</p>
                <div className="ax-contact-sent-more">
                  {status.issueUrl ? (
                    <span>Reference: <a className="ax-link" href={status.issueUrl} target="_blank" rel="noopener noreferrer">tracking link</a>.</span>
                  ) : null}
                  <button
                    type="button"
                    className="ax-link ax-contact-again"
                    onClick={() => setStatus({ state: 'idle', error: '', issueUrl: '', intent: '' })}
                  >
                    Send another enquiry
                  </button>
                </div>
              </div>
            ) : (
              <form className="ax-contact-form" onSubmit={submit} aria-labelledby="ax-contact-k">
                <div id="ax-contact-k" className="ax-lbl-q ax-contact-k">Application enquiry</div>
                <FilterPills options={intents} value={intent} onChange={setIntent} label="What the enquiry is about" />

                <label className="ax-vh" htmlFor="ax-contact-name">Full name</label>
                <input
                  id="ax-contact-name"
                  className="ax-contact-input"
                  type="text"
                  required
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Full name"
                  value={form.name}
                  onChange={update('name')}
                />
                <label className="ax-vh" htmlFor="ax-contact-email">Email</label>
                <input
                  id="ax-contact-email"
                  className="ax-contact-input"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={update('email')}
                />
                <label className="ax-vh" htmlFor="ax-contact-company">Company or project name</label>
                <input
                  id="ax-contact-company"
                  className="ax-contact-input"
                  type="text"
                  required
                  maxLength={200}
                  autoComplete="organization"
                  placeholder="Company or project name"
                  value={form.company}
                  onChange={update('company')}
                />
                <label className="ax-vh" htmlFor="ax-contact-link">Website, repo, or deck link (optional)</label>
                <input
                  id="ax-contact-link"
                  className="ax-contact-input"
                  type="url"
                  inputMode="url"
                  maxLength={MAX_LINK}
                  autoComplete="url"
                  placeholder="Website, repo, or deck link (optional)"
                  value={form.link}
                  onChange={update('link')}
                />
                <label className="ax-vh" htmlFor="ax-contact-about">What you are building</label>
                <textarea
                  id="ax-contact-about"
                  className="ax-contact-input"
                  required
                  minLength={10}
                  maxLength={5000}
                  rows={4}
                  placeholder="What are you building, and what is the hardest unresolved question in it right now?"
                  value={form.about}
                  onChange={update('about')}
                />

                {/* Honeypot — hidden from real users; bots fill everything. */}
                <input
                  type="text"
                  name="hp"
                  value={form.hp}
                  onChange={update('hp')}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="ax-contact-hp"
                />

                {status.state === 'error' && <p className="ax-contact-error" role="alert">{status.error}</p>}

                {TURNSTILE_SITE_KEY && <div ref={turnstileRef} />}

                <button
                  type="submit"
                  className="ax-btn ax-btn-lg ax-btn-primary ax-contact-send"
                  disabled={status.state === 'sending' || Boolean(TURNSTILE_SITE_KEY && !turnstileToken)}
                >
                  {status.state === 'sending' ? 'Sending…' : 'Send enquiry →'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </SitePage>
  );
}
