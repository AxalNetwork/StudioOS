import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox } from '../../ui';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import {
  ACCEPT_ALL_MAX, NOT_RECORDED, TX_VIEWS, acceptAllIds, analyticsLists, analyticsTiles, bySide, channelFilters, consentBanner,
  inboxRows, pendingNotice, pendingTranslations, readFailure, setupSteps, themeQuotes, transcriptTurns,
} from './channelSessionModel.js';

/**
 * D862 (#2507) — the parts of Record a session's chat boards (WA1–WA13), drawn
 * with the channel as an argument so Telegram (#2515) and Calls (#2525) reuse
 * them: the inbox, the transcript, the analytics, the proposals, the guided
 * connect and the four states. The rules are `channelSessionModel.js`.
 *
 * Every change opens an in-page dialog that says what it changes; nothing
 * here opens a browser pop-up. A figure the store does not hold reads Not
 * recorded with its reason, never 0.
 */

export const CARD = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
export const H3 = 'm-0 text-[14px] font-extrabold text-gray-900 dark:text-gray-100';
export const MUTED = 'text-[12px] leading-snug text-gray-500 dark:text-gray-400';
export const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-violet-700 px-3.5 text-[12.5px] font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]';
export const BTN_SEC = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 text-[12.5px] font-semibold text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:min-h-[36px]';
export const BTN_GHOST = 'inline-flex min-h-[44px] items-center justify-center rounded-lg px-2.5 text-[12.5px] font-semibold text-violet-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-300 sm:min-h-[36px]';
const LINK = 'font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300';

const TONES = {
  pos: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  amb: 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/30 dark:text-amber-300',
  neg: 'border border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300',
  mut: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  out: 'border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100',
  lav: 'border border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-400/40 dark:bg-violet-950/30 dark:text-violet-200',
};

export function Pill({ tone = 'mut', children, testId }) {
  return <span className={`inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONES[tone] || TONES.mut}`} data-testid={testId}>{children}</span>;
}

/** The Source chips a figure carries (#2431): Recorded, Typed, or Not recorded. */
export function SourceChips({ sources }) {
  if (!sources?.length) return <Pill tone="mut">Source: {NOT_RECORDED}</Pill>;
  return <span className="inline-flex gap-1">{sources.map((s) => <Pill key={s} tone="out">{s}</Pill>)}</span>;
}

/** One read: loading, ready, or its failure (forbidden, unreadable). */
export function useRead(read, deps) {
  const [st, setSt] = useState({ status: 'loading', data: null, error: null });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    setSt((s) => ({ ...s, status: 'loading' }));
    Promise.resolve().then(read).then(
      (data) => { if (n === seq.current) setSt({ status: 'ready', data, error: null }); },
      (error) => { if (n === seq.current) setSt({ status: readFailure(error), data: null, error }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...st, reload: load };
}

/* ------------------------------------------------------------------ *
 * WA8–WA11: the four states
 * ------------------------------------------------------------------ */

export function LoadingBoard({ testId = 'channel-loading' }) {
  return (
    <div aria-busy="true" className={`${CARD} flex flex-col gap-3`} data-testid={testId}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="h-3 w-28 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          <span className="h-3 flex-1 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          <span className="h-3 w-16 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      ))}
      <span className={MUTED}>Reading…</span>
    </div>
  );
}

export function ErrorBoard({ what, onRetry, testId = 'channel-error' }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/40 dark:bg-red-950/30" data-testid={testId}>
      <div>
        <h2 className="m-0 text-[14px] font-extrabold text-red-900 dark:text-red-200">{what} could not be read. That is not the same as having none.</h2>
        <p className="m-0 mt-1 text-[12px] text-red-800 dark:text-red-300">Nothing was changed.</p>
      </div>
      <button type="button" className={BTN_SEC} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>
    </div>
  );
}

export function EmptyBoard({ label, connectTo, testId = 'channel-empty' }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-gray-300 bg-white p-6 dark:border-gray-600 dark:bg-gray-900" data-testid={testId}>
      <h2 className="m-0 text-[16px] font-extrabold text-gray-900 dark:text-gray-100">No {label} number is connected yet.</h2>
      <p className="m-0 text-[13px] text-gray-600 dark:text-gray-400">Connect a {label} Business number to bring customer chats into Interviews. Nothing is kept until each person agrees.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link to={connectTo} className={BTN} data-testid={`${testId}-connect`}>Connect {label}</Link>
        <Link to="/privacy/interviews" className={LINK}>How consent works</Link>
      </div>
    </div>
  );
}

export function NoPermissionBoard({ label, testId = 'channel-nop' }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900" data-testid={testId}>
      <Pill tone="mut">No access</Pill>
      <h2 className="m-0 text-[16px] font-extrabold text-gray-900 dark:text-gray-100">Only the venture’s founder can open {label} chats.</h2>
      <p className="m-0 text-[13px] text-gray-600 dark:text-gray-400">Chats hold what customers said in private. Ask the founder to share Record a session with you.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Dialogs: every change says what it changes
 * ------------------------------------------------------------------ */

export function ConfirmDialog({ title, sub, confirm, tone = 'pri', onConfirm, onClose, testId }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await onConfirm(); onClose(); } catch (e) { setErr(e?.message || 'It could not be done. Nothing was changed.'); setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={onClose} width={480} phone="sheet" testId={testId}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_SEC} onClick={onClose}>Cancel</button>
          <button type="button" className={tone === 'neg' ? `${BTN} bg-red-700 hover:bg-red-800` : BTN} onClick={go} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? 'Working…' : confirm}</button>
        </div>
      )}>
      {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`${testId}-error`}>{err}</p> : null}
    </Lightbox>
  );
}

/** Assign a waiting chat to one of the venture's interviews. Creating one stays on the inbox page. */
export function AssignDialog({ row, interviews, onAssign, onClose, inboxHref }) {
  const [id, setId] = useState(interviews.status === 'ready' && interviews.interviews[0] ? String(interviews.interviews[0].id) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = interviews.status === 'ready' ? interviews.interviews : [];
  const go = async () => {
    setBusy(true); setErr('');
    try { await onAssign(row.uid, Number(id)); onClose(); } catch (e) { setErr(e?.message || 'The chat could not be assigned. Nothing was changed.'); setBusy(false); }
  };
  return (
    <Lightbox label="Assign to interview" title="Assign to interview" sub={`${row.name}’s messages become that interview’s transcript, and new ones follow.`} onClose={onClose} width={520} phone="sheet" testId="wa-assign"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_SEC} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN} onClick={go} disabled={busy || !id} data-testid="wa-assign-confirm">{busy ? 'Assigning…' : 'Assign'}</button>
        </div>
      )}>
      {interviews.status === 'loading' ? <p className={MUTED}>Reading your interviews…</p> : null}
      {interviews.status === 'unreadable' ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">Your interviews could not be read. Try again.</p> : null}
      {interviews.status === 'ready' && !list.length ? <p className={MUTED} data-testid="wa-assign-none">This venture has no interview yet. <Link to={inboxHref} className={LINK}>Create one from the inbox</Link>.</p> : null}
      {list.length ? (
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">Interview
          <select value={id} onChange={(e) => setId(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[13px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" data-testid="wa-assign-select">
            {list.map((i) => <option key={i.id} value={String(i.id)}>{i.label || i.name || `Interview ${i.id}`}</option>)}
          </select>
        </label>
      ) : null}
      {err ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-red-700 dark:text-red-300">{err}</p> : null}
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * WA2: the chats inbox
 * ------------------------------------------------------------------ */

export function ChannelInbox({ items, channel, onChannel, onAssign, onAsk, onIgnore, sessionHref, now }) {
  const rows = inboxRows(items, channel, now);
  return (
    <section className="flex flex-col gap-3" data-testid="channel-inbox">
      <div role="radiogroup" aria-label="Channel" className="flex flex-wrap gap-2">
        {channelFilters(items, channel).map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={f.on ? 'true' : 'false'} onClick={() => onChannel(f.key)} data-testid={`inbox-filter-${f.key}`}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold sm:min-h-[34px] ${f.on ? TONES.lav : TONES.out}`}>
            {f.t} <span className="font-mono text-[11px]">{f.n}</span>
          </button>
        ))}
      </div>
      {!rows.length ? <p className={`${CARD} ${MUTED}`} data-testid="inbox-none">No chats here yet. Customers who write to your business number appear here.</p> : (
        <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`}>
          {rows.map((r) => (
            <li key={r.uid} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid={`inbox-row-${r.uid}`}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                  <span className="truncate">{r.name}</span>
                  <Pill tone="out">{r.channel}</Pill>
                  <Pill tone={r.consent.tone} testId={`inbox-consent-${r.uid}`}>Consent: {r.consent.t}</Pill>
                </span>
                <span className={MUTED}>{r.count} · {r.when}{r.interviewee ? ` · in the interview with ${r.interviewee}` : ''}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.sessionId ? <Link to={sessionHref(r.sessionId)} className={BTN_SEC} data-testid={`inbox-open-${r.uid}`}>Open session</Link> : null}
                {r.canAssign ? <button type="button" className={BTN} onClick={() => onAssign(r)} data-testid={`inbox-assign-${r.uid}`}>Assign to interview</button> : null}
                {r.canAsk ? <button type="button" className={BTN_SEC} onClick={() => onAsk(r)} data-testid={`inbox-ask-${r.uid}`}>Ask for consent…</button> : null}
                {r.canIgnore ? <button type="button" className={`${BTN_GHOST} text-red-700 dark:text-red-300`} onClick={() => onIgnore(r)} data-testid={`inbox-ignore-${r.uid}`}>Ignore</button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * WA3, WA7: the transcript
 * ------------------------------------------------------------------ */

export function ChannelTranscript({ read, meta }) {
  const [view, setView] = useState('both');
  const segments = read?.segments || [];
  const turns = transcriptTurns(segments, view);
  const banner = consentBanner(read?.channel_consent);
  const notice = pendingNotice(pendingTranslations(segments));
  return (
    <section className="flex flex-col gap-3" data-testid="channel-transcript">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={MUTED} data-testid="transcript-meta">{meta}</p>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
          {TX_VIEWS.map((v) => (
            <button key={v.key} type="button" role="radio" aria-checked={view === v.key ? 'true' : 'false'} onClick={() => setView(v.key)} data-testid={`transcript-view-${v.key}`}
              className={`min-h-[44px] rounded-md px-3 text-[12px] font-semibold sm:min-h-[30px] ${view === v.key ? 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'text-gray-700 dark:text-gray-300'}`}>{v.t}</button>
          ))}
        </div>
      </div>
      <div className={`rounded-xl p-3 ${TONES[banner.tone]}`} data-testid="transcript-consent">
        <p className="m-0 text-[13px] font-semibold">{banner.t}</p>
        <p className="m-0 text-[12px]">{banner.p}</p>
      </div>
      {notice ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 ${TONES.amb}`} data-testid="transcript-pending">
          <div><p className="m-0 text-[13px] font-semibold">{notice.t}</p><p className="m-0 text-[12px]">{notice.p}</p></div>
          <a href={ADD_TOKENS_PATH} className={BTN_SEC}>Add tokens</a>
        </div>
      ) : null}
      {!turns.length ? <p className={`${CARD} ${MUTED}`} data-testid="transcript-none">No message is in this session yet.</p> : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {turns.map((t) => (
            <li key={t.id} className={`flex max-w-[78%] flex-col gap-1 ${t.you ? 'items-end self-end' : 'self-start'}`} data-testid={`turn-${t.id}`}>
              <span className={MUTED}>{t.who}{t.at ? ` · ${t.at}` : ''}{t.voice ? ' · voice note' : ''}</span>
              <div className={`flex flex-col gap-1.5 rounded-xl px-3 py-2.5 ${t.you ? 'border border-violet-200 bg-violet-50 dark:border-violet-400/40 dark:bg-violet-950/30' : 'border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'}`}>
                {t.showOriginal ? <p className="m-0 text-[13px] text-gray-900 dark:text-gray-100" data-testid={`turn-original-${t.id}`}>{t.original}</p> : null}
                {t.showTranslation ? (
                  <p className="m-0 border-t border-gray-100 pt-1.5 text-[13px] text-gray-700 dark:border-gray-800 dark:text-gray-300" data-testid={`turn-translation-${t.id}`}>
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.from}</span>{t.translation}
                  </p>
                ) : null}
                {t.pending ? <span className="text-[11.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid={`turn-pending-${t.id}`}>Translation pending</span> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * WA4, WA5, WA13: analytics
 * ------------------------------------------------------------------ */

export function ChannelAnalytics({ data, venture = false, trend = null, title }) {
  const tiles = analyticsTiles(data, venture);
  const sides = bySide(data);
  const lists = analyticsLists(data);
  const quotes = themeQuotes(data);
  return (
    <section className="flex flex-col gap-4" data-testid={venture ? 'channel-analytics-venture' : 'channel-analytics-session'}>
      <div className="flex flex-col gap-1">
        <h2 className={H3}>{title}</h2>
        <p className={MUTED}>Every figure comes from chats with consent, and carries its source.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.e} className={`${CARD} flex flex-col gap-1`} data-testid={`tile-${t.e.toLowerCase().replace(/\s+/g, '-')}`}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.e}</span>
            <span className={`font-mono text-[20px] font-semibold ${t.missing ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{t.text}</span>
            {t.sub ? <span className={MUTED}>{t.sub}</span> : null}
            {t.missing ? <span className={MUTED}>{t.reason}</span> : null}
            <SourceChips sources={t.sources} />
          </div>
        ))}
      </div>
      {trend ? (
        <div className={CARD} data-testid="analytics-trend">
          <h3 className={H3}>Chats by week</h3>
          <div className="mt-3 flex h-40 items-end gap-2">
            {trend.map((b, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" data-testid={`trend-${i}`}>
                <span className="font-mono text-[11px] text-gray-700 dark:text-gray-300">{b.v}</span>
                {b.missing
                  ? <span className="w-full border-t border-dashed border-gray-400 dark:border-gray-500" title={NOT_RECORDED} data-testid={`trend-missing-${i}`} />
                  : <span className={`w-full rounded-t ${b.partial ? 'border border-violet-500 bg-violet-200 dark:bg-violet-500/40' : 'bg-violet-600 dark:bg-violet-400'}`} style={{ height: `${Math.max(2, b.h)}%` }} />}
                <span className="text-[10.5px] text-gray-500 dark:text-gray-400">{b.missing ? NOT_RECORDED : b.l}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={CARD} data-testid="analytics-by-side">
          <h3 className={H3}>Messages by side</h3>
          {sides ? sides.map((s) => (
            <div key={s.l} className="mt-2 flex items-center gap-2 text-[12.5px] text-gray-800 dark:text-gray-200">
              <span className="w-20">{s.l}</span>
              <span className="h-2 flex-1 rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-full rounded-full bg-violet-600 dark:bg-violet-400" style={{ width: `${Math.max(2, s.w)}%` }} /></span>
              <span className="w-10 text-right font-mono">{s.n}</span>
            </div>
          )) : <p className={MUTED}>{NOT_RECORDED}: {data?.messages?.reason || 'the counts were not sent.'}</p>}
        </div>
        {lists.map((l) => (
          <div key={l.t} className={CARD} data-testid={`analytics-list-${l.t.toLowerCase().replace(/\s+/g, '-')}`}>
            <h3 className={H3}>{l.t}</h3>
            {l.L === null ? <p className={MUTED}>{NOT_RECORDED}{l.reason ? `: ${l.reason}` : ''}</p>
              : !l.L.length ? <p className={MUTED}>None mentioned.</p>
                : <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[12.5px] text-gray-800 dark:text-gray-200">{l.L.map((x, i) => <li key={i} className="flex justify-between gap-2"><span>{x.a}</span><span className="font-mono text-gray-500 dark:text-gray-400">{x.n}</span></li>)}</ul>}
          </div>
        ))}
      </div>
      <div className={CARD} data-testid="analytics-quotes">
        <h3 className={H3}>Quotes per theme</h3>
        {quotes.withheld ? <p className={MUTED} data-testid="analytics-quotes-withheld">{quotes.withheld}</p> : (
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {quotes.themes.map((q, i) => (
              <li key={i} className="text-[12.5px] text-gray-800 dark:text-gray-200">
                <span className="font-semibold">{q.th}</span>
                {q.counts ? <span className={`ml-2 ${MUTED}`}>{q.counts}</span> : q.quotes.map((x, j) => <blockquote key={j} className="m-0 mt-1 border-l-2 border-violet-300 pl-2 text-gray-700 dark:border-violet-500 dark:text-gray-300">“{x}”</blockquote>)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * WA6: proposals to accept
 * ------------------------------------------------------------------ */

function Confidence({ conf }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid="proposal-confidence">
      {[1, 2, 3].map((i) => <span key={i} className={`block h-1.5 w-1.5 rounded-full ${i <= conf.dots ? 'bg-violet-600 dark:bg-violet-400' : 'bg-gray-300 dark:bg-gray-600'}`} />)}
      {conf.t}
    </span>
  );
}

export function ChannelProposals({ groups, editHref, onAccept, onDiscard, onAcceptAll, line }) {
  const [ask, setAsk] = useState(null);
  const all = acceptAllIds(groups);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <section className="flex flex-col gap-3" data-testid="channel-proposals">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={MUTED}>{line}</p>
        {all.length ? <button type="button" className={BTN} onClick={() => setAsk({ kind: 'all' })} data-testid="proposals-accept-all">Accept all ({all.length})</button> : null}
      </div>
      {!total ? <p className={`${CARD} ${MUTED}`} data-testid="proposals-none">Nothing to accept yet.</p> : groups.map((g) => (
        <div key={g.key} className={CARD} data-testid={`proposals-group-${g.key}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className={H3}>{g.g} <span className="font-mono text-[12px] text-gray-500">{g.items.length}</span></h3>
            <span className={MUTED}>{g.mod}</span>
          </div>
          <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
            {g.items.map((it) => (
              <li key={it.id} className="flex flex-col gap-1.5 py-2.5" data-testid={`proposal-${it.id}`}>
                <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100">{it.t}{it.build ? <Pill tone="lav" testId={`proposal-build-${it.id}`}>For Build</Pill> : null}</span>
                {it.q ? <blockquote className="m-0 border-l-2 border-violet-300 pl-2 text-[12.5px] text-gray-700 dark:border-violet-500 dark:text-gray-300">“{it.q}”</blockquote> : <span className={MUTED}>Quote not recorded.</span>}
                <span className="flex flex-wrap items-center gap-3"><Confidence conf={it.conf} /></span>
                <div className="flex flex-wrap gap-1.5">
                  {it.canAccept ? <button type="button" className={BTN_SEC} onClick={() => setAsk({ kind: 'accept', it })} data-testid={`proposal-accept-${it.id}`}>Accept</button> : <span className={MUTED}>Proposed only: it cannot be accepted from here.</span>}
                  <Link to={editHref} className={BTN_GHOST} data-testid={`proposal-edit-${it.id}`}>Edit</Link>
                  <button type="button" className={BTN_GHOST} onClick={() => setAsk({ kind: 'discard', it })} data-testid={`proposal-dismiss-${it.id}`}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {ask?.kind === 'accept' ? <ConfirmDialog title="Accept this proposal" sub={`“${ask.it.t}” is written to Validate under your name.`} confirm="Accept" onConfirm={() => onAccept(ask.it.id)} onClose={() => setAsk(null)} testId="proposal-accept-dialog" /> : null}
      {ask?.kind === 'discard' ? <ConfirmDialog title="Dismiss this proposal" sub={`“${ask.it.t}” is dismissed for good and is never proposed again. Nothing in Validate changes.`} confirm="Dismiss" tone="neg" onConfirm={() => onDiscard(ask.it.id)} onClose={() => setAsk(null)} testId="proposal-dismiss-dialog" /> : null}
      {ask?.kind === 'all' ? <ConfirmDialog title={`Accept ${all.length} proposals`} sub={`Each is written to Validate under your name. Accept all takes at most ${ACCEPT_ALL_MAX} at a time.`} confirm="Accept all" onConfirm={() => onAcceptAll(all)} onClose={() => setAsk(null)} testId="proposal-all-dialog" /> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * WA1: the guided connect
 * ------------------------------------------------------------------ */

const STEP_MARK = {
  done: 'bg-emerald-700 text-white',
  failed: 'border-[1.5px] border-red-600 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  todo: 'border-[1.5px] border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400',
};

export function ConnectSteps({ view, onPress, signupHref, label = 'WhatsApp' }) {
  const [ask, setAsk] = useState(null);
  const steps = setupSteps(view);
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="channel-connect">
      <div className={`${CARD} p-0`}>
        <div className="p-4">
          <h2 className={H3}>Connect {label}</h2>
          <p className={MUTED}>Six steps. Your progress is saved, so you can leave and come back to the step you were on.</p>
        </div>
        <ol className="m-0 list-none p-0">
          {steps.map((s) => (
            <li key={s.key} className={`flex items-start gap-3 border-t border-gray-100 px-4 py-3.5 dark:border-gray-800 ${s.state === 'failed' ? 'bg-red-50 dark:bg-red-950/20' : ''}`} data-testid={`step-${s.key}`}>
              <span className={`grid h-7 w-7 flex-none place-items-center rounded-full text-[12px] font-extrabold ${STEP_MARK[s.state]}`}>{s.state === 'done' ? '✓' : s.state === 'failed' ? '!' : s.n}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100">{s.t}<Pill tone={s.state === 'done' ? 'pos' : s.state === 'failed' ? 'neg' : 'out'} testId={`step-pill-${s.key}`}>{s.pill}</Pill></span>
                <span className={MUTED}>{s.line}</span>
                {s.action ? <span className="text-[12px] text-gray-700 dark:text-gray-300" data-testid={`step-action-${s.key}`}>{s.action}</span> : null}
                {s.press ? <div><button type="button" className={BTN} onClick={() => setAsk(s)} data-testid={`step-press-${s.key}`}>{s.press}</button></div> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <aside className="flex flex-col gap-3">
        <div className={CARD}>
          <h3 className={H3}>Use Embedded Signup instead</h3>
          <p className={MUTED}>Sign in with your Meta account and Meta sets up the number, registration and webhook for you. The steps you finished are kept.</p>
          <Link to={signupHref} className={`${BTN_SEC} mt-2`} data-testid="connect-signup">Use Embedded Signup</Link>
        </div>
        <div className={CARD}>
          <h3 className={H3}>What Axal keeps</h3>
          <p className={MUTED}>Messages from people who write to your business number, and only after they agree. Never your personal WhatsApp.</p>
        </div>
      </aside>
      {ask ? <ConfirmDialog title={`${ask.t}: ${ask.press.toLowerCase()}`} sub={ask.confirm || 'Axal reads this step from Meta. Nothing in your account changes.'} confirm={ask.press} onConfirm={() => onPress(ask.key)} onClose={() => setAsk(null)} testId="step-dialog" /> : null}
    </section>
  );
}

/** The guided setup is off (the setup read answers 404): Embedded Signup is the way in. */
export function SetupOff({ signupHref }) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-2`} data-testid="connect-off">
      <h2 className={H3}>Connect WhatsApp with Embedded Signup</h2>
      <p className={MUTED}>The step-by-step setup is not switched on for your account yet. Embedded Signup sets up the number, registration and webhook in one sign-in with Meta.</p>
      <Link to={signupHref} className={BTN} data-testid="connect-off-signup">Use Embedded Signup</Link>
    </div>
  );
}

