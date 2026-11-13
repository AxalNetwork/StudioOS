import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { Eyebrow } from '../../components/site/SiteBlocks';
import { SiteSwitch } from '../../components/site/NewsletterSignup';
import { newsletterApi } from '../../lib/api/newsletter';
import {
  NEWSLETTER_TOPICS, changedChoices, preferenceRows, preferencesFailure, topicLabel, unsubscribedLine,
} from './newsletterModel';
import '../../components/site/newsletter.css';

/**
 * `/newsletter/preferences?token=` — D813 (#2259), board W3. Reached from the
 * link in every newsletter and transactional email; no sign-in, the signed
 * token is the only key.
 *
 *   - the topic switches and Save, which sends only what changed
 *     (`PUT /api/newsletter/preferences`);
 *   - "Unsubscribe from everything" (`POST /api/newsletter/unsubscribe`, no
 *     topic), and, when the link names a topic (`&topic=`), "Unsubscribe from
 *     [topic]";
 *   - the unsubscribed page, "You're unsubscribed from [topic].", with
 *     Resubscribe.
 *
 * RESUBSCRIBING AFTER "EVERYTHING" RETIRES THIS LINK. D810 treats turning a
 * topic back on as a fresh consent and raises the token's version, so the
 * page says a new link is in the email that follows rather than reloading
 * with a token that no longer opens.
 */
export function PreferencesView({
  view, draft, onDraft, onSave, onUnsubscribe, onResubscribe, onRetry, linkTopic,
}) {
  if (view.state === 'loading') return <p className="ax-nl-lede" role="status">Loading your topics…</p>;
  if (view.state === 'invalid') {
    return (
      <div data-testid="nl-prefs-invalid">
        <h1 className="ax-nl-h1">This link is not valid any more.</h1>
        <p className="ax-nl-lede">Use the link in your latest email from Axal VC, or subscribe again for a new one.</p>
        <Link to="/newsletter" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action">Subscribe again</Link>
      </div>
    );
  }
  if (view.state === 'unconfigured') {
    return (
      <div data-testid="nl-prefs-unconfigured">
        <h1 className="ax-nl-h1">Newsletter settings are not open yet.</h1>
        <p className="ax-nl-lede">Nothing was changed. Try this link again later.</p>
      </div>
    );
  }
  if (view.state === 'error') {
    return (
      <div data-testid="nl-prefs-error">
        <h1 className="ax-nl-h1">Your topics could not be read.</h1>
        <p className="ax-nl-lede">Nothing was changed.</p>
        <button type="button" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (view.state === 'unsubscribed') {
    return (
      <div data-testid="nl-unsubscribed">
        <h1 className="ax-nl-h1">{unsubscribedLine(view.topic)}</h1>
        <p className="ax-nl-lede">
          {view.topic ? 'Your other topics are unchanged.' : 'We will not send you newsletters. An email confirming it is on its way.'}
        </p>
        {view.error && <p className="ax-nl-error" role="alert">{view.error}</p>}
        <button type="button" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action" onClick={onResubscribe} disabled={view.busy}>
          {view.busy ? 'Saving…' : 'Resubscribe'}
        </button>
      </div>
    );
  }
  if (view.state === 'resubscribed') {
    return (
      <div data-testid="nl-resubscribed">
        <h1 className="ax-nl-h1">You&apos;re subscribed again.</h1>
        <p className="ax-nl-lede">We&apos;ve emailed you a new link to manage your topics. This one no longer opens.</p>
      </div>
    );
  }

  const rows = preferenceRows(view.data.topics);
  const dirty = Boolean(changedChoices(view.data.topics, draft));
  const offAll = view.data.status === 'unsubscribed';
  const showTopicOff = linkTopic && view.data.topics?.[linkTopic];
  return (
    <div data-testid="nl-prefs">
      <h1 className="ax-nl-h1">Your newsletters</h1>
      {view.data.email && <p className="ax-nl-email">For {view.data.email}</p>}
      {offAll && (
        <p className="ax-nl-lede" data-testid="nl-prefs-off">
          {unsubscribedLine(null)} Turn a topic on and save to subscribe again.
        </p>
      )}
      <div className="ax-nl-card">
        {showTopicOff && (
          <div className="ax-nl-actions ax-nl-actions-top">
            <button type="button" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action" disabled={view.busy}
              onClick={() => onUnsubscribe(linkTopic)} data-testid="nl-unsub-topic">
              Unsubscribe from {topicLabel(linkTopic)}
            </button>
          </div>
        )}
        <ul className="ax-nl-topics" aria-label="Newsletters">
          {rows.map((t) => (
            <li key={t.key} className="ax-nl-topic" data-testid={`nl-pref-${t.key}`}>
              <span className="ax-nl-topic-t">{t.label}</span>
              <SiteSwitch checked={Boolean(draft[t.key])} label={t.label} disabled={view.busy}
                onChange={(on) => onDraft({ ...draft, [t.key]: on })} />
            </li>
          ))}
        </ul>
        {view.error && <p className="ax-nl-error" role="alert">{view.error}</p>}
        {view.saved && !dirty && <p className="ax-nl-ok" role="status">Saved. We&apos;ve emailed you a note of the change.</p>}
        <div className="ax-nl-actions">
          <button type="button" className="ax-btn ax-btn-md ax-btn-primary ax-nl-action" onClick={onSave} disabled={view.busy || !dirty}>
            {view.busy ? 'Saving…' : 'Save'}
          </button>
          {!offAll && (
            <button type="button" className="ax-nl-danger" onClick={() => onUnsubscribe(null)} disabled={view.busy}>
              Unsubscribe from everything
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const draftOf = (topics) => Object.fromEntries(Object.entries(topics || {}).map(([k, v]) => [k, Boolean(v)]));
const KNOWN = NEWSLETTER_TOPICS.map((t) => t.key);

/** The reads, writes and state, without the site frame, so a test can mount it. */
export function PreferencesFlow() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const linkTopic = KNOWN.includes(params.get('topic')) ? params.get('topic') : null;
  const [view, setView] = useState({ state: token ? 'loading' : 'invalid' });
  const [draft, setDraft] = useState({});
  // What was on before an unsubscribe, so Resubscribe restores it.
  const [before, setBefore] = useState(null);

  const load = useCallback(() => {
    if (!token) { setView({ state: 'invalid' }); return; }
    setView({ state: 'loading' });
    newsletterApi.preferences(token)
      .then((data) => { setView({ state: 'ready', data }); setDraft(draftOf(data?.topics)); })
      .catch((e) => setView({ state: preferencesFailure(e) }));
  }, [token]);
  useEffect(load, [load]);

  const failWrite = (e) => {
    const state = preferencesFailure(e);
    if (state === 'invalid') setView({ state });
    else setView((v) => ({ ...v, busy: false, error: e?.message || 'Your change could not be saved. Nothing was changed.' }));
  };

  async function save() {
    const choices = changedChoices(view.data.topics, draft);
    if (!choices) return;
    setView((v) => ({ ...v, busy: true, error: '', saved: false }));
    try {
      const r = await newsletterApi.savePreferences(token, choices);
      const wasOff = view.data.status === 'unsubscribed';
      if (wasOff && r?.status === 'confirmed') { setView({ state: 'resubscribed' }); return; }
      setView({ state: 'ready', data: r, saved: true });
      setDraft(draftOf(r?.topics));
    } catch (e) { failWrite(e); }
  }

  async function unsubscribe(topic) {
    setView((v) => ({ ...v, busy: true, error: '' }));
    try {
      await newsletterApi.unsubscribe(token, topic);
      setBefore(topic ? { [topic]: true } : Object.fromEntries(Object.entries(view.data.topics || {}).filter(([, on]) => on)));
      setView({ state: 'unsubscribed', topic });
    } catch (e) { failWrite(e); }
  }

  async function resubscribe() {
    const choices = before && Object.keys(before).length ? before : { brief: true };
    setView((v) => ({ ...v, busy: true, error: '' }));
    try {
      const r = await newsletterApi.savePreferences(token, choices);
      if (!view.topic) { setView({ state: 'resubscribed' }); return; }
      setView({ state: 'ready', data: r, saved: true });
      setDraft(draftOf(r?.topics));
    } catch (e) { failWrite(e); }
  }

  return (
    <PreferencesView view={view} draft={draft} onDraft={setDraft} onSave={save}
      onUnsubscribe={unsubscribe} onResubscribe={resubscribe} onRetry={load} linkTopic={linkTopic} />
  );
}

export default function NewsletterPreferencesPage() {
  return (
    <SitePage title="Newsletter preferences" signup={false}>
      <div className="ax-wrap ax-nl-page">
        <div className="ax-nl-page-in">
          <Eyebrow>Newsletter</Eyebrow>
          <PreferencesFlow />
        </div>
      </div>
    </SitePage>
  );
}
