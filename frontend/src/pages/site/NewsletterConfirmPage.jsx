import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { Eyebrow } from '../../components/site/SiteBlocks';
import { newsletterApi } from '../../lib/api/newsletter';
import { confirmView, confirmedTitle } from './newsletterModel';
import '../../components/site/newsletter.css';

/**
 * `/newsletter/confirm?token=` — D813 (#2259), board W2.
 *
 * It calls D810's `GET /api/newsletter/confirm` once. The token is single
 * use, so the read runs once per token even under React's double effect, and
 * Try again re-reads only after a failure the route did not explain.
 *
 * "You're subscribed to [n] newsletters" needs the topics, and D810's JSON
 * answer carries none today: the page draws the count and the list when the
 * answer has them, and the plain sentence until then. No count is invented.
 */
export function ConfirmView({ view, onRetry }) {
  if (view.state === 'loading') return <p className="ax-nl-lede" role="status">Confirming your subscription…</p>;
  if (view.state === 'confirmed') {
    return (
      <div data-testid="nl-confirmed">
        <h1 className="ax-nl-h1">{confirmedTitle(view.topics)}</h1>
        {view.topics?.length ? (
          <ul className="ax-nl-list">{view.topics.map((t) => <li key={t}>{t}</li>)}</ul>
        ) : (
          <p className="ax-nl-lede">Thank you. A welcome email is on its way, with the link to manage your topics.</p>
        )}
        <p className="ax-nl-fine">Every email has a link to manage your topics or unsubscribe in one click.</p>
      </div>
    );
  }
  if (view.state === 'expired') {
    return (
      <div data-testid="nl-confirm-expired">
        <h1 className="ax-nl-h1">This link has expired.</h1>
        <p className="ax-nl-lede">Confirmation links last a short while. Subscribe again and we&apos;ll send you a new one.</p>
        <Link to="/newsletter" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action">Subscribe again</Link>
      </div>
    );
  }
  if (view.state === 'invalid') {
    return (
      <div data-testid="nl-confirm-invalid">
        <h1 className="ax-nl-h1">This link has already been used or is not valid.</h1>
        <p className="ax-nl-lede">If you have confirmed already, there is nothing more to do. Otherwise, subscribe again for a new link.</p>
        <Link to="/newsletter" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action">Subscribe again</Link>
      </div>
    );
  }
  if (view.state === 'unconfigured') {
    return (
      <div data-testid="nl-confirm-unconfigured">
        <h1 className="ax-nl-h1">Newsletter signups are not open yet.</h1>
        <p className="ax-nl-lede">Nothing was changed. Try this link again later.</p>
      </div>
    );
  }
  return (
    <div data-testid="nl-confirm-error">
      <h1 className="ax-nl-h1">Your subscription could not be confirmed.</h1>
      <p className="ax-nl-lede">The confirmation did not reach us. Your link has not been used.</p>
      <button type="button" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action" onClick={onRetry}>Try again</button>
    </div>
  );
}

/** The read and its state, without the site frame, so a test can mount it. */
export function ConfirmFlow() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [view, setView] = useState(() => (token ? { state: 'loading' } : { state: 'invalid' }));
  const [attempt, setAttempt] = useState(0);
  const sent = useRef('');

  useEffect(() => {
    if (!token) { setView({ state: 'invalid' }); return; }
    const key = `${token}#${attempt}`;
    if (sent.current === key) return;
    sent.current = key;
    setView({ state: 'loading' });
    newsletterApi.confirm(token)
      .then((r) => setView(confirmView(r, null)))
      .catch((e) => setView(confirmView(null, e || {})));
  }, [token, attempt]);

  return <ConfirmView view={view} onRetry={() => setAttempt((n) => n + 1)} />;
}

export default function NewsletterConfirmPage() {
  return (
    <SitePage title="Confirm your subscription" signup={false}>
      <div className="ax-wrap ax-nl-page">
        <div className="ax-nl-page-in">
          <Eyebrow>Newsletter</Eyebrow>
          <ConfirmFlow />
        </div>
      </div>
    </SitePage>
  );
}
