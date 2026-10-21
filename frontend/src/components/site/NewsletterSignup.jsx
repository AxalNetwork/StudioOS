import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { newsletterApi } from '../../lib/api/newsletter';
import { loadTurnstile } from '../../lib/turnstile';
import {
  BLOCK_LINE, BLOCK_TITLE, FINE_PRINT, PUBLIC_TOPICS, SENT_NOTE, SENT_TITLE, TOPIC_NOTES,
  looksLikeEmail, signupBody, signupError,
} from '../../pages/site/newsletterModel';
import './newsletter.css';

/**
 * D813 (#2259), board W1 — the website's newsletter signup, in two sizes:
 *
 *   - `variant="block"`: the band every `SitePage` draws above the footer,
 *     "The Axal VC Brief" with one field and Subscribe;
 *   - `variant="page"`: `/newsletter`'s form, with the six public topics as
 *     switches.
 *
 * Both post to D810's `POST /api/newsletter/subscribe` through
 * `newsletterApi.subscribe`, with a Turnstile token and the honeypot. The
 * answer is the same for every address, so the sent state is too: it never
 * says whether this one is already subscribed (`SENT_NOTE`).
 *
 * TURNSTILE LOADS ON INTENT. The block is on every public page, so its widget
 * (and the script behind it) mounts only once the email field is focused; the
 * `/newsletter` page mounts it at once.
 */

const TURNSTILE_SITE_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || '';

/** The Turnstile widget's lifecycle, as ContactPage runs it, started only while `active`. */
function useTurnstile(active) {
  const ref = useRef(null);
  const widget = useRef(null);
  const [token, setToken] = useState('');
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !active) return undefined;
    let cancelled = false;
    let interval;
    const render = () => {
      if (cancelled || !ref.current) return;
      if (widget.current !== null) { try { window.turnstile.remove(widget.current); } catch {} }
      widget.current = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t) => setToken(t),
        'expired-callback': () => setToken(''),
        theme: 'light',
      });
    };
    loadTurnstile().catch(() => {});
    if (typeof window.turnstile === 'undefined') {
      let attempts = 0;
      interval = setInterval(() => {
        attempts += 1;
        if (typeof window.turnstile !== 'undefined' && ref.current) { clearInterval(interval); render(); }
        else if (attempts >= 50) clearInterval(interval);
      }, 200);
    } else {
      render();
    }
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (widget.current !== null) { try { window.turnstile.remove(widget.current); } catch {} widget.current = null; }
    };
  }, [active]);
  const reset = () => {
    if (widget.current !== null) { try { window.turnstile.reset(widget.current); } catch {} }
    setToken('');
  };
  return { ref, token, reset, required: Boolean(TURNSTILE_SITE_KEY) };
}

/** The site's switch: a real switch, its state in words for a screen reader. */
export function SiteSwitch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`ax-nl-switch${checked ? ' is-on' : ''}`}
    >
      <span aria-hidden="true" />
    </button>
  );
}

/** The six public topics as switch rows. */
export function TopicSwitches({ value, onChange, rows = PUBLIC_TOPICS, disabled = false }) {
  return (
    <ul className="ax-nl-topics" aria-label="Newsletters">
      {rows.map((t) => (
        <li key={t.key} className="ax-nl-topic" data-testid={`nl-topic-${t.key}`}>
          <span className="ax-nl-topic-t">
            {t.label}
            {TOPIC_NOTES[t.key] && <span className="ax-nl-topic-n"> ({TOPIC_NOTES[t.key].toLowerCase()})</span>}
          </span>
          <SiteSwitch checked={Boolean(value[t.key])} label={t.label} disabled={disabled}
            onChange={(on) => onChange({ ...value, [t.key]: on })} />
        </li>
      ))}
    </ul>
  );
}

/** The sent state, the same for every address. */
export function SentNote({ onAgain }) {
  return (
    <div className="ax-nl-sent" role="status" data-testid="nl-sent">
      <div className="ax-nl-sent-t">{SENT_TITLE}</div>
      <p className="ax-nl-sent-d">{SENT_NOTE}</p>
      {onAgain && <button type="button" className="ax-link ax-nl-again" onClick={onAgain}>Use another email</button>}
    </div>
  );
}

export default function NewsletterSignup({ variant = 'block' }) {
  const page = variant === 'page';
  const [email, setEmail] = useState('');
  const [hp, setHp] = useState('');
  const [picked, setPicked] = useState({ brief: true });
  const [status, setStatus] = useState({ state: 'idle', error: '' });
  const [intent, setIntent] = useState(page);
  const turnstile = useTurnstile(intent && status.state !== 'sent');

  const fail = (error) => setStatus({ state: 'error', error });

  async function submit(e) {
    e.preventDefault();
    if (!looksLikeEmail(email)) { fail('Enter a valid email address.'); return; }
    const body = signupBody({ email, picked: page ? picked : { brief: true }, turnstileToken: turnstile.token, hp });
    if (!body.topics.length) { fail('Pick at least one newsletter.'); return; }
    if (turnstile.required && !turnstile.token) { fail('Complete the verification challenge.'); return; }
    setStatus({ state: 'sending', error: '' });
    try {
      await newsletterApi.subscribe(body);
      setStatus({ state: 'sent', error: '' });
      setEmail('');
    } catch (err) {
      fail(signupError(err));
      if (turnstile.required) turnstile.reset();
    }
  }

  const id = page ? 'ax-nl-page-email' : 'ax-nl-block-email';
  const sending = status.state === 'sending';
  const form = status.state === 'sent'
    ? <SentNote onAgain={() => setStatus({ state: 'idle', error: '' })} />
    : (
      <form className={`ax-nl-form${page ? ' ax-nl-form-page' : ''}`} onSubmit={submit} noValidate data-testid="nl-form">
        {page && <TopicSwitches value={picked} onChange={setPicked} disabled={sending} />}
        <div className="ax-nl-row">
          <label className="ax-nl-vh" htmlFor={id}>Email</label>
          <input
            id={id}
            className="ax-nl-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            placeholder="you@company.com"
            value={email}
            onFocus={() => setIntent(true)}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
          />
          <button type="submit" className="ax-btn ax-btn-md ax-btn-primary ax-nl-send" disabled={sending}>
            {sending ? 'Sending…' : 'Subscribe'}
          </button>
        </div>
        {/* Honeypot: hidden from people; a bot fills every field. */}
        <input type="text" name="hp" value={hp} onChange={(e) => setHp(e.target.value)}
          tabIndex={-1} autoComplete="off" aria-hidden="true" className="ax-nl-hp" />
        {status.state === 'error' && <p className="ax-nl-error" role="alert">{status.error}</p>}
        {turnstile.required && intent && <div ref={turnstile.ref} className="ax-nl-turnstile" />}
        <p className="ax-nl-fine">
          {FINE_PRINT} <Link to="/privacy" className="ax-nl-fine-link">Privacy policy</Link>
        </p>
      </form>
    );

  if (page) return <div className="ax-nl-card" data-testid="nl-page-form">{form}</div>;
  return (
    <section className="ax-band ax-nl-block" aria-labelledby="ax-nl-block-h" data-testid="nl-block">
      <div className="ax-wrap ax-nl-block-in">
        <div>
          <h2 id="ax-nl-block-h" className="ax-nl-block-h">{BLOCK_TITLE}</h2>
          <p className="ax-nl-block-d">{BLOCK_LINE}</p>
          <Link to="/newsletter" className="ax-link ax-nl-more">Choose your topics →</Link>
        </div>
        {form}
      </div>
    </section>
  );
}
