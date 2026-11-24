// D621 (#1280 step 2) — the two parts of the Help Center canvas that needed a
// store, wired to D603's (`routes/help_center.ts`, migration 408):
//
//   PopularGuides      H1's "Popular this week": the four most-read guides of
//                      the last seven days that this reader can open.
//   GuideFeedback      H2's "Did this answer it?": one answer per member per
//                      guide, the last one wins; a no opens one field for what
//                      was missing. It also counts the reader's view.
//   GuideAnswersAdmin  The answers, for an admin, on the Help Center home: per
//                      guide, yes and no, most "no" first, and each "what was
//                      missing". No member is named; the route sends none.
//
// D6861 (#6861) redraws all three to Help Center v2 (D4957): Popular two by
// two beside Your tickets (HC1); after a No, what next (HC6); and the admin's
// content review with no names, owner and review, broken links checked
// against the manifest, and the searches that found nothing (HC12).
//
// Each is a presentational view and a small wrapper that reads. A read in
// flight draws no figure, and a failed read says so: it is never a week nobody
// read anything, or a guide nobody answered.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { helpCenterApi } from '../../lib/api/helpCenter';
import { reportError } from '../../lib/log';
import { guideReviewFor, guideVerificationFor, staleWord, contentReviewItems, staleRuleSentence } from './guideGovernance';
import { guideLinkFlags, linkFlagLine, searchMissesView } from './v2/helpV2';
import {
  MISSING_MAX, POPULAR_ASKED, POPULAR_DAYS, adminFeedbackView, answeredLine, feedbackFrom, guideHref,
  popularGuides, viewsLine,
} from './helpCenter';

const LABEL = 'font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-gray-500 dark:text-gray-400';
const META = 'font-mono text-[11px] text-gray-500 dark:text-gray-400';
const CARD = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const BUTTON = 'rounded-[9px] border border-gray-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:border-violet-200 hover:text-violet-700 disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:text-violet-300';
const PRIMARY = 'rounded-[9px] border border-violet-600 bg-violet-600 px-4 py-2 text-[12.5px] font-bold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60';

function Failed({ text, onRetry }) {
  return (
    <div role="alert" className="mt-3 rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <span className="text-[12.5px]">{text}</span>{' '}
      {onRetry && <button type="button" onClick={onRetry} className="text-xs font-bold underline">Try again</button>}
    </div>
  );
}

// ── Popular this week ────────────────────────────────────────────────────────

/** `read` is { status: 'loading' | 'error' | 'ok', cards }. */
export function PopularGuidesView({ read, onRetry }) {
  return (
    <section aria-labelledby="help-popular" data-testid="help-popular">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="help-popular" className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Popular</h2>
        <span className={META}>views, last {POPULAR_DAYS} days</span>
      </div>
      {read.status === 'loading' && (
        <div className="mt-3 grid grid-cols-2 gap-[11px]" aria-busy="true" aria-label="Loading the most-read guides">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}
        </div>
      )}
      {read.status === 'error' && (
        <Failed text="The most-read guides could not be read. This is not a sign nobody reads them." onRetry={onRetry} />
      )}
      {read.status === 'ok' && read.cards.length === 0 && (
        <p className="mt-3 text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="help-popular-none">
          No views are recorded for these guides this week.
        </p>
      )}
      {read.status === 'ok' && read.cards.length > 0 && (
        <ol className="mt-3 grid list-none grid-cols-1 gap-[11px] p-0 sm:grid-cols-2">
          {read.cards.map((c, i) => (
            <li key={c.anchor}>
              <Link
                to={guideHref(c.anchor)}
                className={`${CARD} block h-full px-4 py-[15px] transition-colors hover:border-violet-200 dark:hover:border-violet-900`}
                data-testid="help-popular-card"
              >
                <span
                  className={`inline-block rounded-full border px-2 py-[3px] font-mono text-[11px] font-bold ${
                    i === 0
                      ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
                      : 'border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="mt-2.5 text-[13px] font-bold leading-snug tracking-tight text-gray-900 dark:text-gray-100">{c.title}</div>
                <div className="mt-1 text-[11.5px] text-gray-500 dark:text-gray-400">{c.area}</div>
                <div className="mt-[7px] font-mono text-[10.5px] text-gray-600 dark:text-gray-300">{viewsLine(c.views)}, last {POPULAR_DAYS} days</div>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11.5px] text-gray-500 dark:text-gray-400">A view is one member reading a guide on one day. Only guides you can open are listed.</p>
    </section>
  );
}

/** The "Popular this week" read: `[read, retry]`. A phone's Help home (D700) draws it as rows. */
export function usePopularGuides(sections, enabled = true) {
  const [read, setRead] = useState({ status: enabled ? 'loading' : 'ok', cards: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setRead({ status: 'ok', cards: [] });
      return undefined;
    }
    let alive = true;
    setRead({ status: 'loading', cards: [] });
    helpCenterApi.popular({ days: POPULAR_DAYS, limit: POPULAR_ASKED })
      .then((reply) => {
        if (!alive) return;
        const cards = popularGuides(reply, sections);
        setRead(cards ? { status: 'ok', cards } : { status: 'error', cards: [] });
      })
      .catch((e) => {
        reportError('HelpCenter:popular', e);
        if (alive) setRead({ status: 'error', cards: [] });
      });
    return () => { alive = false; };
  }, [attempt, sections, enabled]);
  return [read, () => setAttempt((n) => n + 1)];
}

export function PopularGuides({ sections }) {
  const [read, retry] = usePopularGuides(sections);
  return <PopularGuidesView read={read} onRetry={retry} />;
}

// ── Did this answer it? ──────────────────────────────────────────────────────

const FEEDBACK_NOTE = 'A no opens one field asking what was missing. Axal’s admins read the answers, without your name.';

/**
 * `read` is `feedbackFrom(...)` or { state: 'loading' }; `mode` is 'idle',
 * 'asking' (the no field is open) or 'changing' (an answer is being replaced).
 */
export function GuideFeedbackView({ read, mode, missing, save, onYes, onNo, onSend, onCancel, onChange, onKeep, onMissing, next = null }) {
  const answered = read.state === 'answered' && mode === 'idle';
  const choosing = read.state !== 'loading' && !answered && mode !== 'asking';
  return (
    <section id="feedback" aria-labelledby="help-feedback" className={`${CARD} scroll-mt-6 px-[22px] py-5`} data-testid="help-feedback">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 id="help-feedback" className="text-[14px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Did this answer it?</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400" data-testid="help-feedback-note">
            {answered ? answeredLine(read.answer) : FEEDBACK_NOTE}
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          {read.state === 'loading' && (
            <span aria-busy="true" aria-label="Loading your answer" className="block h-9 w-[118px] animate-pulse rounded-[9px] bg-gray-100 dark:bg-gray-800" />
          )}
          {choosing && (
            <>
              <button type="button" onClick={onYes} disabled={save.busy} className={BUTTON} data-testid="help-feedback-yes">Yes</button>
              <button type="button" onClick={onNo} disabled={save.busy} className={BUTTON} data-testid="help-feedback-no">No</button>
              {mode === 'changing' && (
                <button type="button" onClick={onKeep} className="text-[12px] font-semibold text-gray-500 underline dark:text-gray-400">Keep my answer</button>
              )}
            </>
          )}
          {answered && (
            <button type="button" onClick={onChange} className="text-[12px] font-bold text-violet-700 underline dark:text-violet-300" data-testid="help-feedback-change">
              Change your answer
            </button>
          )}
        </div>
      </div>
      {answered && read.answer === 'no' && read.missing && (
        <blockquote className="mt-3 border-l-2 border-gray-200 pl-3 text-[12.5px] italic leading-relaxed text-gray-600 dark:border-gray-700 dark:text-gray-300" data-testid="help-feedback-missing">
          {read.missing}
        </blockquote>
      )}
      {answered && read.answer === 'no' && next && <WhatNext next={next} missing={read.missing} />}
      {read.state === 'unreadable' && mode !== 'asking' && (
        <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400" data-testid="help-feedback-unreadable">
          Your earlier answer could not be read. A new answer replaces it.
        </p>
      )}
      {mode === 'asking' && (
        <form onSubmit={(e) => { e.preventDefault(); onSend(); }} className="mt-3 grid gap-2" data-testid="help-feedback-form">
          <label htmlFor="help-missing" className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300">What was missing?</label>
          <textarea
            id="help-missing"
            value={missing}
            onChange={(e) => onMissing(e.target.value.slice(0, MISSING_MAX))}
            maxLength={MISSING_MAX}
            rows={3}
            placeholder="Optional"
            className="w-full rounded-[9px] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-violet-400 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={META}>{missing.length} of {MISSING_MAX}</span>
            <span className="flex gap-2">
              <button type="button" onClick={onCancel} className={BUTTON}>Cancel</button>
              <button type="submit" disabled={save.busy} className={PRIMARY} data-testid="help-feedback-send">Send</button>
            </span>
          </div>
        </form>
      )}
      {save.failed && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="help-feedback-not-saved">
          Your answer was not saved. Try again.
        </p>
      )}
    </section>
  );
}

/**
 * HC6 — after "No": related guides, search again, a ticket that carries only
 * the guide's link and the member's own words (both shown and editable in the
 * sheet before Submit), and Message the team when the plan includes chat.
 * `next` is { related, onOpenTicket(missing), chatAvailable, onOpenChat }.
 */
export function WhatNext({ next, missing }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const related = Array.isArray(next.related) ? next.related : [];
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800" data-testid="help-feedback-next">
      <h3 className="text-[13.5px] font-extrabold text-gray-900 dark:text-gray-100">What next</h3>
      <div className="mt-2.5 grid gap-3 md:grid-cols-3">
        <div className="grid content-start gap-1.5 rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-gray-800/60">
          <b className="text-[12.5px] text-gray-900 dark:text-gray-100">Related guides</b>
          {related.length > 0
            ? related.map((r) => (
              <Link key={r.anchor} to={guideHref(r.anchor)} className="text-[12.5px] font-semibold text-violet-700 hover:underline dark:text-violet-300">{r.title}</Link>
            ))
            : <span className="text-[12px] text-gray-500 dark:text-gray-400">This guide lists none.</span>}
        </div>
        <form role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/help?q=${encodeURIComponent(q.trim())}`); }} className="grid content-start gap-1.5 rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-gray-800/60">
          <label htmlFor="help-next-search" className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">Search again</label>
          <input id="help-next-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Other words for it" className="min-h-[40px] rounded-[9px] border border-gray-200 bg-white px-3 text-[13px] text-gray-900 placeholder:text-gray-500 focus:border-violet-400 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-400" />
        </form>
        <div className="grid content-start gap-1.5 rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-gray-800/60">
          <b className="text-[12.5px] text-gray-900 dark:text-gray-100">Open a ticket</b>
          <span className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">Carries this guide’s link{missing ? ' and your words above' : ''}. You see and edit both before Submit.</span>
          <button type="button" onClick={() => next.onOpenTicket?.(missing || '')} className={`${BUTTON} justify-self-start`} data-testid="help-feedback-ticket">Open a ticket</button>
        </div>
      </div>
      {next.chatAvailable && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-gray-500 dark:text-gray-400">
          <button type="button" onClick={next.onOpenChat} className="text-[12.5px] font-bold text-violet-700 underline dark:text-violet-300">Message the team</button>
          Shown because your plan includes chat
        </p>
      )}
    </div>
  );
}

export function GuideFeedback({ anchor, next = null }) {
  const [read, setRead] = useState({ state: 'loading' });
  const [mode, setMode] = useState('idle');
  const [missing, setMissing] = useState('');
  const [save, setSave] = useState({ busy: false, failed: false });

  // One view per member per guide per day; the Worker drops the rest (D603).
  useEffect(() => {
    helpCenterApi.recordView(anchor).catch((e) => reportError('HelpCenter:view', e));
  }, [anchor]);

  useEffect(() => {
    let alive = true;
    setRead({ state: 'loading' });
    setMode('idle');
    setMissing('');
    setSave({ busy: false, failed: false });
    helpCenterApi.myFeedback(anchor)
      .then((reply) => { if (alive) setRead(feedbackFrom(reply)); })
      .catch((e) => {
        reportError('HelpCenter:feedback', e);
        if (alive) setRead({ state: 'unreadable' });
      });
    return () => { alive = false; };
  }, [anchor]);

  const send = (answer) => {
    setSave({ busy: true, failed: false });
    helpCenterApi.saveFeedback(anchor, answer, answer === 'no' ? missing.trim() : undefined)
      .then((reply) => {
        setRead(feedbackFrom(reply));
        setMode('idle');
        setSave({ busy: false, failed: false });
      })
      .catch((e) => {
        reportError('HelpCenter:feedback-save', e);
        setSave({ busy: false, failed: true });
      });
  };

  return (
    <GuideFeedbackView
      read={read}
      mode={mode}
      missing={missing}
      save={save}
      onYes={() => send('yes')}
      onNo={() => { setSave({ busy: false, failed: false }); setMode('asking'); }}
      onSend={() => send('no')}
      onCancel={() => setMode(read.state === 'answered' ? 'changing' : 'idle')}
      onChange={() => { setMissing(read.missing || ''); setMode('changing'); }}
      onKeep={() => setMode('idle')}
      onMissing={setMissing}
      next={next}
    />
  );
}

// ── The answers, for an admin (HC12) ─────────────────────────────────────────

export const ADMIN_ROWS = 5;

const NUM = 'text-right font-mono tabular-nums';

/**
 * `read` is { status: 'loading' | 'error' | 'ok', view } with `view` from
 * `adminFeedbackView`; `sections` is the manifest the broken-link check reads.
 * Counts and notes only: the route sends no member, and nothing here names one.
 * Owner and review are D4641's: "Verification pending" until a first verified
 * date exists.
 */
export function GuideAnswersAdminView({ read, onRetry, all, onAll, sections = [], children = null }) {
  const v = read.view;
  const guides = v ? (all ? v.guides : v.guides.slice(0, ADMIN_ROWS)) : [];
  const texts = v ? (all ? v.missing : v.missing.slice(0, ADMIN_ROWS)) : [];
  const more = v ? Math.max(0, v.guides.length - guides.length) + Math.max(0, v.missing.length - texts.length) : 0;
  const reviewQueue = v ? contentReviewItems(v) : null;
  const flags = (anchor) => linkFlagLine(guideLinkFlags(anchor, sections));
  return (
    <section aria-labelledby="help-answers" className={`${CARD} grid gap-4 px-5 py-[18px]`} data-testid="help-answers-admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className={LABEL}>Admins only</span>
          <h2 id="help-answers" className="text-[18px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Guide answers and content review</h2>
        </div>
        <span className={META} data-testid="help-answers-meta">
          {read.status === 'ok' ? `${v.yes} yes · ${v.no} no · no names` : 'no names'}
        </span>
      </div>
      {read.status === 'loading' && (
        <div className="grid gap-2" aria-busy="true" aria-label="Loading the answers">
          {[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-gray-100 motion-reduce:animate-none dark:bg-gray-800" />)}
        </div>
      )}
      {read.status === 'error' && (
        <>
          <Failed text="The guide answers could not be read." onRetry={onRetry} />
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400">Never drawn as 0 Yes · 0 No.</p>
        </>
      )}
      {read.status === 'ok' && v.guides.length === 0 && (
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="help-answers-none">
          No member has answered yet.
        </p>
      )}
      {read.status === 'ok' && v.guides.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3" data-testid="help-answers-totals">
            {[['Yes answers, all time', v.yes], ['No answers, all time', v.no]].map(([label, n]) => (
              <div key={label} className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
                <small className="block text-[11.5px] text-gray-500 dark:text-gray-400">{label}</small>
                <b className="font-mono text-[22px] text-gray-900 dark:text-gray-100">{n.toLocaleString('en-US')}</b>
              </div>
            ))}
            <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
              <small className="block text-[11.5px] text-gray-500 dark:text-gray-400">Who answered</small>
              <b className="text-[14px] text-gray-900 dark:text-gray-100">No names</b>
              <small className="block text-[11.5px] text-gray-500 dark:text-gray-400">Counts and notes only</small>
            </div>
          </div>

          <section aria-labelledby="help-answers-guides" className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 id="help-answers-guides" className="text-[14px] font-extrabold text-gray-900 dark:text-gray-100">Guides by No answers</h3>
              <span className={META}>{v.guides.length} guide{v.guides.length === 1 ? '' : 's'} answered · all time</span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {reviewQueue?.length || 0} guides need a content follow-up from negative feedback. This list is derived from feedback, not a resolved ticket queue.
            </p>
            <div className="hidden md:block">
              <table className="w-full border-collapse text-[12.5px]">
                <caption className="sr-only">Guides sorted by No answers</caption>
                <thead>
                  <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                    {['Guide', 'Area', 'Yes', 'No', 'Owner', 'Review', 'Broken link · stale'].map((h) => (
                      <th key={h} scope="col" className={`py-2 pr-3 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400 ${h === 'Yes' || h === 'No' ? 'text-right' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {guides.map((g) => (
                    <tr key={g.anchor} className="border-b border-gray-100 last:border-b-0 dark:border-gray-800" data-testid="help-answers-row">
                      <td className="py-2 pr-3">
                        {g.area ? (
                          <Link to={guideHref(g.anchor)} className="font-bold text-gray-900 hover:text-violet-700 dark:text-gray-100 dark:hover:text-violet-300">{g.title}</Link>
                        ) : (
                          <span className="font-mono text-[12px] text-gray-500 dark:text-gray-400" title="This guide is no longer in the Help Center.">{g.title}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{g.area || '—'}</td>
                      <td className={`py-2 pr-3 ${NUM} text-gray-700 dark:text-gray-300`}>{g.yes}</td>
                      <td className={`py-2 pr-3 ${NUM} font-bold text-gray-900 dark:text-gray-100`}>{g.no}</td>
                      <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{guideReviewFor(g.anchor).owner}</td>
                      <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{guideVerificationFor(g.anchor).line}</td>
                      <td className="py-2 font-mono text-[11px] text-gray-500 dark:text-gray-400" data-testid="help-answers-flags">{flags(g.anchor)} · {staleWord(guideVerificationFor(g.anchor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="m-0 grid list-none gap-0 p-0 md:hidden">
              {guides.map((g) => (
                <li key={g.anchor} className="border-b border-gray-100 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="help-answers-card">
                  <b className="block text-[13px] text-gray-900 dark:text-gray-100">{g.title}</b>
                  <span className="block font-mono text-[11px] text-gray-500 dark:text-gray-400">{g.yes} yes · {g.no} no · {guideReviewFor(g.anchor).owner} · {guideVerificationFor(g.anchor).line}</span>
                  <span className="block font-mono text-[11px] text-gray-500 dark:text-gray-400">{flags(g.anchor)} · {staleWord(guideVerificationFor(g.anchor))}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Broken links are checked against the guides as written. {staleRuleSentence()}
            </p>
          </section>

          {texts.length > 0 && (
            <section aria-labelledby="help-answers-missing" className="grid gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 id="help-answers-missing" className="text-[14px] font-extrabold text-gray-900 dark:text-gray-100">What was missing</h3>
                <span className={META}>{v.missing.length} note{v.missing.length === 1 ? '' : 's'} · newest first · the newest 500 are kept</span>
              </div>
              <ul className="m-0 grid list-none gap-2 p-0">
                {texts.map((t, i) => (
                  <li key={`${t.anchor}-${t.at}-${i}`} className="rounded-[11px] bg-gray-50 px-3 py-2 dark:bg-gray-800/60" data-testid="help-answers-missing">
                    <div className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">“{t.text}”</div>
                    <div className="mt-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">{t.title}{t.at ? ` · ${String(t.at).slice(0, 10)}` : ''}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!all && more > 0 && (
            <button type="button" onClick={onAll} className="justify-self-start text-[12.5px] font-bold text-violet-700 hover:underline dark:text-violet-300" data-testid="help-answers-all">
              Show all {v.guides.length} guide{v.guides.length === 1 ? '' : 's'} and {v.missing.length} note{v.missing.length === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}
      {children}
    </section>
  );
}

// ── D6861 — searches that found nothing, for an admin ───────────────────────

export const SEARCH_MISS_DAYS = 30;

/** `read` is { status: 'loading' | 'error' | 'ok', view } with `view` from `searchMissesView`. */
export function SearchMissesAdminView({ read, onRetry }) {
  const v = read.view;
  return (
    <section aria-labelledby="help-search-misses" className="grid gap-2 border-t border-gray-100 pt-4 dark:border-gray-800" data-testid="help-search-misses">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="help-search-misses" className="text-[14px] font-extrabold text-gray-900 dark:text-gray-100">Searches that found nothing</h3>
        <span className={META}>last {SEARCH_MISS_DAYS} days · most searched first · no names</span>
      </div>
      {read.status === 'loading' && <div aria-busy="true" aria-label="Loading the searches that found nothing" className="h-5 animate-pulse rounded bg-gray-100 motion-reduce:animate-none dark:bg-gray-800" />}
      {read.status === 'error' && <Failed text="The searches that found nothing could not be read. This is not a sign every search found a guide." onRetry={onRetry} />}
      {read.status === 'ok' && v.searches.length === 0 && (
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="help-search-misses-none">No member’s search came up empty in the last {SEARCH_MISS_DAYS} days.</p>
      )}
      {read.status === 'ok' && v.searches.length > 0 && (
        <ul className="m-0 grid list-none gap-0 p-0">
          {v.searches.map((m) => (
            <li key={m.query} className="flex items-baseline justify-between gap-3 border-b border-gray-100 py-1.5 last:border-b-0 dark:border-gray-800" data-testid="help-search-miss">
              <span className="min-w-0 break-words text-[12.5px] text-gray-800 dark:text-gray-200">“{m.query}”</span>
              <span className="shrink-0 font-mono text-[11px] text-gray-500 dark:text-gray-400">{m.searches} member search{m.searches === 1 ? '' : 'es'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Counted once per member per day, with no member kept. A search that looks like an email address or an account number is never recorded.
      </p>
    </section>
  );
}

function SearchMissesAdmin() {
  const [read, setRead] = useState({ status: 'loading', view: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', view: null });
    helpCenterApi.adminSearchMisses({ days: SEARCH_MISS_DAYS })
      .then((reply) => {
        if (!alive) return;
        const view = searchMissesView(reply);
        setRead(view ? { status: 'ok', view } : { status: 'error', view: null });
      })
      .catch((e) => {
        reportError('HelpCenter:search-misses', e);
        if (alive) setRead({ status: 'error', view: null });
      });
    return () => { alive = false; };
  }, [attempt]);
  return <SearchMissesAdminView read={read} onRetry={() => setAttempt((n) => n + 1)} />;
}

export function GuideAnswersAdmin({ sections }) {
  const [read, setRead] = useState({ status: 'loading', view: null });
  const [attempt, setAttempt] = useState(0);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', view: null });
    helpCenterApi.adminFeedback()
      .then((reply) => {
        if (!alive) return;
        const view = adminFeedbackView(reply, sections);
        setRead(view ? { status: 'ok', view } : { status: 'error', view: null });
      })
      .catch((e) => {
        reportError('HelpCenter:answers', e);
        if (alive) setRead({ status: 'error', view: null });
      });
    return () => { alive = false; };
  }, [attempt, sections]);
  return (
    <GuideAnswersAdminView read={read} onRetry={() => setAttempt((n) => n + 1)} all={all} onAll={() => setAll(true)} sections={sections}>
      <SearchMissesAdmin />
    </GuideAnswersAdminView>
  );
}
