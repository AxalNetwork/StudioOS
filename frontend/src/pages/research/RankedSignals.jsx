/**
 * D7173 (#7173) — Research › Markets › Top-ranked signals, to the D7038 canvas
 * (`design/incoming/Research Markets Ranked Signals and Evidence Page.dc.html`,
 * boards RMS-01 to RMS-08). Mounted by `MarketDirectoryZone.jsx`.
 *
 * The card reads `GET /api/signals` (limit 3) and holds five states apart:
 * live, live but empty, labelled illustrative examples, loading, and a failed
 * read with Retry (the Worker's 503 `signals_unreadable`), which never says
 * "none" and never shows examples. View evidence opens the signal in the
 * shared `Sheet` (a bottom sheet on a phone) with Why now and the evidence the
 * list already returned, newest first. `?signal=` names the open signal beside
 * the directory's own URL state; closing returns focus to the same button.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Sheet } from '../../ui';
import { StateChip } from '../../ui/Honesty';
import { api } from '../../lib/api';
import {
  cardState, confidenceState, dayLabel, evidenceNewestFirst, newestObserved, kindCount,
  sourceLink, trackedSectorFor, geographyOf, CONFIDENCE_MEANS, ONE_KIND_CAP,
} from './rankedSignalsRead.js';

const SHOWN = 3;
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const KIND_LABEL = { news: 'News', hiring: 'Hiring', filing: 'Filing', registry: 'Registry', developer: 'Developer', discussion: 'Discussion', earnings: 'Earnings', profile: 'Profile' };
const kindLabel = (k) => KIND_LABEL[k] || (k ? String(k).charAt(0).toUpperCase() + String(k).slice(1) : 'Evidence');
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600';

/* ---------- confidence (RMS-03) ---------- */

function Meter({ pct }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-16 rounded-full bg-gray-200 dark:bg-gray-700">
      <span className="block h-1.5 rounded-full bg-gray-600 dark:bg-gray-300" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** One signal's confidence: a value with its meter, Not recorded, or Unavailable. */
export function Confidence({ signal, note = true }) {
  const c = confidenceState(signal);
  if (c.state === 'unavailable') return <StateChip kind="unavailable" label="Confidence unavailable" data-testid="signal-confidence" />;
  if (c.state === 'not_recorded') return <StateChip kind="not_recorded" label="Confidence not recorded" data-testid="signal-confidence" />;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="signal-confidence" data-platform-state="value">
      <Meter pct={c.pct} />
      <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{c.pct}%</span>
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">confidence</span>
      {c.zero && note ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">· no evidence recorded</span> : null}
    </span>
  );
}

/* ---------- the card's rows ---------- */

function SignalRow({ signal, rank, illustrative, open, onOpen, buttonRef }) {
  const where = [signal.sector, geographyOf(signal)].filter(Boolean).join(' · ');
  const updated = dayLabel(signal.updated_at);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-800" data-testid="signal-row">
      <span className="inline-grid h-7 w-7 flex-none place-items-center rounded-md bg-gray-100 text-[12.5px] font-extrabold text-axal-ink dark:bg-gray-800 dark:text-gray-100">
        <span aria-hidden="true">{rank}</span><span className="sr-only">Rank {rank}</span>
      </span>
      <div className="min-w-0 flex-1 basis-[200px]">
        {illustrative ? <StateChip kind="provisional" label="Example" className="mb-1" /> : null}
        <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{signal.title}</p>
        {where ? <p className="mt-0.5 text-[11.5px] text-axal-muted dark:text-gray-400">{where}</p> : null}
        <p className="mt-0.5 text-[11.5px] text-axal-muted dark:text-gray-400">
          {illustrative ? `Example set dated ${updated || 'not recorded'}` : (updated ? `Updated ${updated}` : 'Update date not recorded')}
        </p>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
        <Confidence signal={signal} />
        <button
          ref={buttonRef}
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-expanded={open ? 'true' : 'false'}
          data-testid="signal-view-evidence"
          className={`inline-flex min-h-[44px] items-center rounded-lg px-2 text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300 ${FOCUS}`}
        >
          {illustrative ? 'View example evidence' : 'View evidence'}<span className="sr-only">: {signal.title}</span>
        </button>
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
          <span className="h-7 w-7 rounded-md bg-gray-200 dark:bg-gray-700" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
            <span className="block h-2.5 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
          </span>
          <span className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700" />
        </li>
      ))}
    </ul>
  );
}

/** A failed read, in the card's own words (RMS-04): Unavailable, never "none", never examples. */
function ReadFailed({ title, claim, onRetry }) {
  const [retried, setRetried] = useState(false);
  return (
    <div role={retried ? 'alert' : undefined} data-platform-state="unavailable"
      className="flex flex-wrap items-start gap-2.5 rounded-[9px] border-[1.5px] border-dashed border-gray-400 bg-white p-3 text-[12.5px] dark:border-gray-500 dark:bg-gray-900">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <StateChip kind="unavailable" className="self-start" />
        <b className="text-axal-ink dark:text-gray-100">{title}</b>
        <span className="text-[12px] text-gray-600 dark:text-gray-400">{claim}</span>
      </span>
      {onRetry ? (
        <button type="button" onClick={() => { setRetried(true); onRetry(); }}
          className={`inline-flex min-h-[44px] items-center rounded-md px-2 text-[12px] font-bold text-violet-700 hover:underline dark:text-violet-300 ${FOCUS}`}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* ---------- the evidence sheet (RMS-02, RMS-02C) ---------- */

function EvidenceItem({ item, sourceName, illustrative }) {
  const observed = dayLabel(item.observed_at);
  const link = illustrative ? null : sourceLink(item.url);
  return (
    <li className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800" data-testid="signal-evidence-item">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">{kindLabel(item.kind)}{illustrative ? <StateChip kind="provisional" label="Example" /> : null}</span>
        <span className="normal-case tracking-normal">{observed ? `Observed ${observed}` : 'Observation date not recorded'}</span>
      </div>
      <p className="mt-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{item.title}</p>
      <p className="mt-0.5 text-[11.5px] text-axal-muted dark:text-gray-400">{sourceName}{illustrative ? ' · example text' : ''}</p>
      {link ? (
        <a href={link.href} target="_blank" rel="noopener noreferrer"
          className={`mt-1.5 inline-flex min-h-[44px] items-center gap-1 text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300 ${FOCUS}`}>
          Open source <span className="font-normal text-axal-muted dark:text-gray-400">{link.host}</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <div className="mt-1.5 text-[12px] text-axal-muted dark:text-gray-400" data-testid="signal-evidence-citation">
          <p className="font-semibold">{illustrative ? 'Example citation · no URL' : 'Recorded citation · no URL recorded'}</p>
          <p>“{item.title}”, {sourceName}{observed ? `, observed ${observed}` : ''}.</p>
        </div>
      )}
    </li>
  );
}

function EvidenceList({ signal, illustrative, sourceNames, onRetry }) {
  if (signal.evidence_state === 'unavailable') {
    return <ReadFailed title="Could not load the evidence for this signal." claim="This is not a sign it has none. The list and the other panels still work." onRetry={onRetry} />;
  }
  const items = evidenceNewestFirst(signal.evidence_items || []);
  if (!items.length) {
    return (
      <div className="flex flex-col gap-1 rounded-[9px] bg-gray-50 p-3 text-[12.5px] dark:bg-gray-800/60" data-platform-state="none">
        <StateChip kind="not_applicable" label="None" className="self-start" />
        <b className="text-axal-ink dark:text-gray-100">No evidence is recorded for this {illustrative ? 'example' : 'live signal'}.</b>
        <span className="text-gray-600 dark:text-gray-400">Its confidence is 0% for that reason. Treat the claim as unbacked.</span>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((e, i) => <EvidenceItem key={e.id || i} item={e} illustrative={illustrative} sourceName={sourceNames[e.source_key] || e.source_key || 'Source not recorded'} />)}
    </ul>
  );
}

function SectorLink({ signal, sectors }) {
  if (!signal.sector) return null;
  if (sectors?.status === 'unreadable') {
    return <p className="text-[12px] text-axal-muted dark:text-gray-400"><StateChip kind="unavailable" label="Sectors unavailable" /> The tracked sectors could not be read, so no profile link is shown.</p>;
  }
  if (sectors?.status !== 'ready') return null;
  const tracked = trackedSectorFor(signal, sectors.data?.items || []);
  if (tracked) {
    return (
      <Link to={`/research/markets/sector/${encodeURIComponent(tracked.slug)}`} data-testid="signal-sector-link"
        className={`inline-flex min-h-[44px] items-center text-[13px] font-semibold text-axal-violet hover:underline dark:text-violet-300 ${FOCUS}`}>
        Open sector profile: {tracked.name} →
      </Link>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400" data-testid="signal-sector-none">
      <StateChip kind="not_recorded" label="No sector profile" />
      <span>“{signal.sector}” is not a tracked sector yet, so there is no profile to open.</span>
    </p>
  );
}

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-axal-ink dark:text-gray-100">{children}</dd>
    </div>
  );
}

/** The sheet's body: facts, what confidence measures, Why now, evidence, sector. Exported for tests. */
export function SignalEvidence({ signal, illustrative = false, sourceNames = {}, sectors = null, onRetry }) {
  const evidenceUnread = signal.evidence_state === 'unavailable';
  const items = signal.evidence_items || [];
  const newest = newestObserved(items);
  const kinds = kindCount(items);
  const where = [signal.sector, geographyOf(signal)].filter(Boolean).join(' · ');
  return (
    <div className="space-y-4 px-5 py-4" data-testid="signal-evidence">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="Sector · geography">{where || <StateChip kind="not_recorded" />}</Fact>
        <Fact label="Signal updated">{dayLabel(signal.updated_at) || <StateChip kind="not_recorded" />}</Fact>
        <Fact label="Newest evidence observed">
          {evidenceUnread ? <StateChip kind="unavailable" />
            : newest || <span className="inline-flex flex-wrap items-center gap-1.5"><StateChip kind="not_applicable" label="None" /><span className="text-[12px] text-axal-muted dark:text-gray-400">no evidence recorded</span></span>}
        </Fact>
        <Fact label="Confidence">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Confidence signal={signal} note={false} />
            {!evidenceUnread && kinds ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">· {kinds} {kinds === 1 ? 'kind' : 'kinds'} of source {kinds === 1 ? 'backs it' : 'agree'}</span> : null}
          </span>
        </Fact>
      </dl>
      <div className="rounded-[9px] bg-gray-50 p-3 text-[12px] leading-relaxed text-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
        <p className="font-bold text-axal-ink dark:text-gray-100">What confidence measures</p>
        <p className="mt-0.5">{CONFIDENCE_MEANS} {ONE_KIND_CAP}</p>
      </div>
      <section>
        <h3 className="text-[12px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Why now</h3>
        {signal.why_now
          ? <p className="mt-1 text-[13px] leading-relaxed text-axal-ink dark:text-gray-100">{signal.why_now}</p>
          : <p className="mt-1"><StateChip kind="not_recorded" /></p>}
      </section>
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Evidence{evidenceUnread ? '' : ` · ${items.length}`}</h3>
          <span className="text-[11px] text-axal-faint dark:text-gray-500">Newest first by observation date</span>
        </div>
        <div className="mt-2"><EvidenceList signal={signal} illustrative={illustrative} sourceNames={sourceNames} onRetry={onRetry} /></div>
      </section>
      <SectorLink signal={signal} sectors={sectors} />
    </div>
  );
}

/** Source names from `GET /api/signals/sources`, read once a sheet opens; a failure falls back to the key. */
function useSourceNames(enabled) {
  const [names, setNames] = useState(null);
  useEffect(() => {
    if (!enabled || names) return undefined;
    let live = true;
    api.signals.sources()
      .then((d) => { if (live) setNames(Object.fromEntries((d?.sources || []).map((s) => [s.key, s.name]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [enabled, names]);
  return names || {};
}

function EvidenceSheet({ signal, rank, total, illustrative, sectors, onClose, opener, onRetry }) {
  const heading = useRef(null);
  const sourceNames = useSourceNames(true);
  return (
    <Sheet label={signal.title} width={560} phone="sheet" onClose={onClose} initialFocus={heading} returnFocusTo={opener} testId="signal-sheet">
      <header className="flex items-start justify-between gap-3 border-b border-axal-hairline px-5 py-[18px] dark:border-gray-800">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-violet dark:text-violet-300">
            {illustrative ? `Example · rank ${rank}` : `Signal · rank ${rank}${total ? ` of ${fmt(total)}` : ''}`}
          </div>
          <h2 ref={heading} tabIndex={-1} className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink outline-none dark:text-gray-100">{signal.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" data-testid="signal-sheet-close"
          className={`-mr-1 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[20px] leading-none text-axal-muted hover:bg-gray-100 hover:text-axal-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 ${FOCUS}`}>×</button>
      </header>
      <SignalEvidence signal={signal} illustrative={illustrative} sourceNames={sourceNames} sectors={sectors} onRetry={onRetry} />
    </Sheet>
  );
}

/* ---------- the card (RMS-01, RMS-04) ---------- */

/**
 * `sigs` is the page's read of `GET /api/signals` (`{ status, data, reload }`);
 * `sectors` its read of `GET /api/research/sectors`, for the exact-name sector link.
 */
export function LatestSignals({ sigs, sectors = null }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pushed = useRef(false);
  const buttons = useRef({});
  const state = cardState(sigs);
  const illustrative = state === 'illustrative';
  const list = (sigs?.data?.signals || []).slice(0, SHOWN);
  const total = sigs?.data?.total;
  const openId = params.get('signal');
  const openIndex = state === 'live' || illustrative ? list.findIndex((s) => s.id === openId) : -1;
  const opener = useMemo(() => ({ get current() { return buttons.current[openId] || null; } }), [openId]);

  const open = (id) => {
    pushed.current = true;
    setParams((prev) => { const next = new URLSearchParams(prev); next.set('signal', id); return next; });
  };
  const close = () => {
    // Opened here: step back, so Back and ✕ agree. Arrived by link: drop the key in place.
    if (pushed.current) { pushed.current = false; navigate(-1); return; }
    setParams((prev) => { const next = new URLSearchParams(prev); next.delete('signal'); return next; }, { replace: true });
  };

  let body;
  let count = null;
  let foot = null;
  if (state === 'loading') {
    body = <><p className="mb-2 text-[12px] text-axal-muted dark:text-gray-400" role="status">Loading signals…</p><SkeletonRows /></>;
  } else if (state === 'unreadable') {
    body = <ReadFailed title="Could not load signals." claim="This is not a sign there are none. The other Markets panels are unaffected." onRetry={sigs.reload} />;
  } else if (state === 'empty') {
    body = (
      <div className="flex flex-col gap-1 rounded-[9px] bg-gray-50 p-3 text-[12.5px] dark:bg-gray-800/60" data-platform-state="none">
        <StateChip kind="not_applicable" label="None" className="self-start" />
        <b className="text-axal-ink dark:text-gray-100">No ranked signals in the live store.</b>
        <span className="text-gray-600 dark:text-gray-400">The read worked and nothing is ranked right now. Examples are not shown in their place.</span>
      </div>
    );
    foot = 'signals · live store · 0 ranked';
  } else {
    if (illustrative) count = `${fmt(list.length)} ${list.length === 1 ? 'example' : 'examples'}`;
    else if (total) count = `${fmt(list.length)} of ${fmt(total)}`;
    body = (
      <>
        {illustrative ? (
          <div className="mb-2 rounded-[9px] border border-amber-300 bg-amber-50 p-3 text-[12px] dark:border-amber-500/50 dark:bg-amber-500/10">
            <StateChip kind="provisional" label="Illustrative" />
            <p className="mt-1 font-semibold text-amber-900 dark:text-amber-200">Illustrative examples, not live observations.</p>
            <p className="text-amber-800 dark:text-amber-300">No live signal has been ingested yet, so these are the platform’s example set. Their evidence is example text.</p>
          </div>
        ) : null}
        <ul className="space-y-2">
          {list.map((s, i) => (
            <SignalRow key={s.id} signal={s} rank={i + 1} illustrative={illustrative} open={openIndex === i}
              onOpen={() => open(s.id)} buttonRef={(el) => { if (el) buttons.current[s.id] = el; }} />
          ))}
        </ul>
      </>
    );
    foot = illustrative ? 'signals · example set · not live' : `signals · live store · ${sigs.data.mode || 'founder'} ranking`;
  }

  return (
    <Card data-testid="markets-signals">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Top-ranked signals</h2>
        {count ? <span className="text-[12px] text-axal-muted dark:text-gray-400">{count}</span> : null}
      </div>
      <p className="mt-1 text-[11px] text-axal-faint dark:text-gray-500">Ordered by rank. Confidence is a separate 0–100% score for how well the evidence backs each signal.</p>
      <div className="mt-2">{body}</div>
      {foot ? <p className="mt-3 text-[11px] text-axal-faint dark:text-gray-500">{foot}</p> : null}
      {openIndex >= 0 ? (
        <EvidenceSheet signal={list[openIndex]} rank={openIndex + 1} total={total} illustrative={illustrative}
          sectors={sectors} onClose={close} opener={opener} onRetry={sigs.reload} />
      ) : null}
    </Card>
  );
}

export default LatestSignals;
