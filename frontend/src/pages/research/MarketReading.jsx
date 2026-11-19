import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card, DataState, Pill, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import { researchMarketReadingsApi } from '../../lib/api/researchMarketReadings.js';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { ACCENT } from '../../workspaces/shellConfig';
import { NotRecorded } from '../../workspaces/canvasKit';
import { StatedLimit } from '../advisor/expertise/kit';
import useRecordCrumb from '../admin/useRecordCrumb';
import { createRecordGate } from './recordGate.js';
import {
  AGE_AT,
  ATTACH_COPY,
  STALE_AT,
  ageBand,
  DRAFT_PILL,
  OWN_RECORD_LINE,
  SUMMARY_COPY,
  ageingAttachmentNote,
  attachState,
  attachesNowhere,
  daysSince,
  freshReadingForm,
  openProposals,
  plainWords,
  railSummaryLine,
  rangeLine,
  rangeReadsForward,
  readingDraft,
  readingFields,
  readingSubmission,
  readingsHiddenFor,
  recordedLine,
  runDayLabel,
  staleAttachmentSentence,
  summaryView,
  usd,
} from './marketReadingRead';

/**
 * `/research/markets/:uid` — one comparable range.
 *
 * THE SHELL ALREADY DRAWS the sidebar, the zone pills and the ANALYTICS mark.
 * This page is the reading. Dark mode is the app theme.
 *
 * A SAVE WRITES A NEW READING. It does not edit the row this page opened.
 * Age is `ran_at`. A stale reading has no Attach control. The catalog price
 * sits beside the scope and is never added into the range. Named engagements
 * are not stored, so the table stays empty.
 *
 * `MarketReadingView` draws the page, shell included, from props; the default
 * export reads the reading and owns the state. The view takes the shell with
 * it because the one-h1 rule spans both: the metric is this page's h1, so the
 * shell's title line is a paragraph once the reading is on screen (D593).
 */

/**
 * THE ACCENT IS VIOLET ON EVERY LICENCE (D7174). D593 coloured this page with
 * the licence's accent (partner amber, advisor green, investor indigo); the
 * Comparable prices canvas (D7039) draws Research's violet, and the owner
 * answered A, as drawn (D7039-p2). `ACCENT.founder` is that violet: #7c3aed,
 * deep #6d28d9, #a78bfa on dark. A caller that still passes a role gets the
 * same values. Tailwind cannot build a class from a hex at runtime, so the page root
 * carries the values as CSS variables and the classes below read them.
 *
 * Two pairs, as `ui/WorkerRail.jsx` does it. What sits on the page ground (the
 * back link, the focus ring, Accept's outline) moves to the 400 weight on dark.
 * A fill under white ink keeps its light value on dark, which is what the
 * canvas's dark board (RMP-14) draws; the `dark:` classes say so rather than
 * leave it to an omission.
 */
export function accentVars() {
  const a = ACCENT.founder;
  return {
    '--mr-accent': a.ink,
    '--mr-accent-deep': a.deep,
    '--mr-accent-line': a.border,
    '--mr-accent-dark': a.deepDark,
  };
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mr-accent)] '
  + 'dark:focus-visible:outline-[color:var(--mr-accent-dark)]';

const inputClass =
  'mt-1 w-full min-w-0 rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-[color:var(--mr-accent)] focus:outline-none focus:ring-1 '
  + 'focus:ring-[color:var(--mr-accent)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 '
  + 'dark:focus:border-[color:var(--mr-accent-dark)] dark:focus:ring-[color:var(--mr-accent-dark)]';

const primaryBtn =
  'rounded-lg bg-[var(--mr-accent)] px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-[var(--mr-accent-deep)] disabled:cursor-not-allowed disabled:opacity-50 '
  + 'dark:bg-[var(--mr-accent)] dark:text-white dark:hover:bg-[var(--mr-accent-deep)] '
  + focusRing;

const ghostBtn =
  'rounded-lg border border-axal-hairline bg-axal-ground px-3 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'hover:bg-axal-ground/80 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 '
  + focusRing;

// Accept is the canvas's outline button in the accent: the licence's border
// and deep ink on light, its 400 weight on dark.
const acceptBtn =
  'rounded-lg border border-[color:var(--mr-accent-line)] bg-transparent px-3 py-1.5 text-[12px] font-semibold '
  + 'text-[color:var(--mr-accent-deep)] hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-[color:var(--mr-accent-dark)]/40 dark:text-[color:var(--mr-accent-dark)] dark:hover:bg-white/5 '
  + focusRing;

const accentLink =
  'font-semibold underline text-[color:var(--mr-accent)] dark:text-[color:var(--mr-accent-dark)] '
  + focusRing;

// The draft band takes the page's violet on every licence (D7174).
const BAND_SKIN = 'border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40';

const fieldBad = 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300';

/** The correction under one field, tied to it by `aria-describedby` (D7039 RMP-08). */
function FieldError({ id, text }) {
  if (!text) return null;
  return (
    <span id={id} className="mt-1 flex items-start gap-1 text-[11px] font-semibold leading-snug text-red-700 dark:text-red-300">
      <span aria-hidden="true" className="flex-none font-extrabold">!</span>
      <span>{text}</span>
    </span>
  );
}

/** A loading block in the shape of what it stands for. */
function Skeleton({ lines = 2 }) {
  return (
    <div aria-hidden="true" className="mt-2 space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`h-3 rounded bg-axal-hairline dark:bg-gray-800 ${i % 2 ? 'w-3/5' : 'w-full'}`} />
      ))}
    </div>
  );
}

// Age and Proposal are the two tiles that gate, and the canvas sets their
// values larger: 20px on a desktop, 17px on a phone. The range and the run
// date are 17px and 14px.
function Tile({ k, v, sub, nr, ink = 'text-axal-ink dark:text-gray-100', hair, big = false }) {
  const size = big ? 'text-[17px] sm:text-[20px]' : 'text-[14px] sm:text-[17px]';
  return (
    <Card className={`min-w-0 ${hair || ''}`}>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{k}</div>
      {nr
        ? <div className="mt-2"><NotRecorded /></div>
        : <div className={`mt-1.5 break-words font-mono font-bold tracking-tight ${size} ${ink}`}>{v}</div>}
      <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

const noop = () => {};

/**
 * D7651 (#7651) — the Eadwyn summary of this reading (D7039 board RMP-12):
 * what it prices, its scope, the range to the cent, the comparable count and
 * the run date, and the catalog price beside it on a service line. Computed
 * by the Worker from the stored row; no model is called. Loading, Unreadable
 * with Try again, and Not recorded each say so rather than draw a figure.
 */
export function SummaryLine({ status = 'idle', view = null, onRetry = noop }) {
  if (status === 'idle') return null;
  return (
    <section
      data-testid="market-reading-summary"
      aria-labelledby="mr-summary-heading"
      aria-busy={status === 'loading' ? 'true' : 'false'}
      className={`min-w-0 rounded-[14px] border px-4 py-3 ${BAND_SKIN}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="mr-summary-heading"
          className="text-[10px] font-extrabold uppercase tracking-[.09em] text-[color:var(--mr-accent-deep)] dark:text-[color:var(--mr-accent-dark)]"
        >
          {SUMMARY_COPY.heading}
        </h2>
        <span className="text-[11px] text-axal-muted dark:text-gray-400">{SUMMARY_COPY.basis}</span>
      </div>
      {status === 'loading' && (
        <>
          <p className="mt-1.5 text-[12.5px] text-axal-muted dark:text-gray-400">{SUMMARY_COPY.loading}</p>
          <Skeleton lines={1} />
        </>
      )}
      {status === 'unavailable' && (
        <div className="mt-1.5">
          <DataState
            state="unavailable"
            what={SUMMARY_COPY.unreadableWhat}
            claim={SUMMARY_COPY.unreadableClaim}
            onRetry={onRetry}
            retryLabel="Try again"
            announce="always"
            as="p"
          />
        </div>
      )}
      {status === 'ready' && view?.state !== 'recorded' && (
        <p data-testid="market-reading-summary-not-recorded" className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400">
          <NotRecorded />
          <span>{view?.reason || SUMMARY_COPY.notRecorded}</span>
        </p>
      )}
      {status === 'ready' && view?.state === 'recorded' && (
        <>
          <p data-testid="market-reading-summary-line" className="mt-1.5 break-words text-[12.5px] leading-relaxed text-axal-ink dark:text-gray-100">
            {view.lead}: <b className="whitespace-nowrap font-mono font-bold">{view.range}</b>{view.tail}
          </p>
          {view.catalog?.state === 'recorded' && (
            <p className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">
              <span className="font-mono">{view.catalog.text}</span> · your offer, beside the range and never added into it.
            </p>
          )}
          {view.catalog?.state === 'not_recorded' && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
              <span>Catalog price</span>
              <NotRecorded />
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** The save that did not happen: its heading, and the Worker's sentence or the network's. */
export const SAVE_FAILED = 'This reading was not saved.';
export const NO_ANSWER = 'StudioOS did not answer, so nothing was recorded. Your entries are still here, to the cent. Record this reading again when you are ready.';

/** The success notice the stored reading opens with (D7039 RMP-04, RMP-06C). */
export const RECORDED = {
  opened: 'Recorded. This is the reading as stored.',
  fresh: 'Recorded as a new reading. The one you opened is unchanged.',
};

export function MarketReadingView({
  role = 'founder',
  payload = null,
  loading = false,
  error = null,
  notFound = false,
  notice = null,
  form = null,
  onForm = noop,
  errors = null,
  fail = null,
  fresh = false,
  busy = false,
  quoteId = '',
  onQuote = noop,
  onRetry = noop,
  onSave = (e) => e?.preventDefault?.(),
  onAttach = noop,
  onFresh = noop,
  draftEdit = '',
  onDraft = noop,
  onDraftEdit = noop,
  kept = '',
  onKeep = noop,
  onDiscard = noop,
  headingRef = null,
  lowRef = null,
  summary = null,
  summaryStatus = 'idle',
  onSummaryRetry = noop,
}) {
  // D6273 Q2 (RS-17): an investor reads no pricing readings. Whatever was
  // passed, the page draws the not-on-your-list card (D7039 RMP-11).
  const hidden = readingsHiddenFor(role);
  const item = hidden ? null : (payload?.item || null);
  const days = item ? daysSince(item.ran_at) : null;
  const band = days == null ? null : ageBand(days);
  const stale = band === 'stale';
  const ready = Boolean(item && form && band);
  const attachments = payload?.attachments || [];
  const proposals = payload?.proposals || [];
  const open = openProposals(proposals, attachments);
  const attachKey = attachState({ stale, attachments, proposals });
  const attach = ATTACH_COPY[attachKey];
  // A founder with nothing to attach to sees no Proposal tile, pill or card,
  // only one line saying what a reading is for them (#6279).
  const ownRecord = attachesNowhere(role, { attachments, proposals });
  const catalog = item ? usd(item.catalog_price_cents) : null;
  const forward = form ? rangeReadsForward(form.low, form.high) : null;
  const draft = item && days != null && band
    ? readingDraft({ days, band, comparableCount: item.comparable_count })
    : '';
  const said = item && days != null && band
    ? plainWords({ ranAt: item.ran_at, days, band, comparableCount: item.comparable_count, ownRecord })
    : null;
  // D7651: the Eadwyn summary (RMP-12) and the rail's "Summaries" line, both
  // from `GET /research/market-readings/:uid/summary`, to the cent.
  const sumView = summaryStatus === 'ready' ? summaryView(summary) : null;
  const railSummary = item ? railSummaryLine(summaryStatus, sumView) : null;
  const ageLabel = stale ? 'Stale' : (band === 'ageing' ? 'Ageing' : 'Current');
  const err = errors || {};
  const describe = (key) => (err[key] ? `mr-${key}-error` : undefined);

  const ageInk = stale
    ? 'text-red-700 dark:text-red-300'
    : (band === 'ageing' ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-gray-100');
  const proposalInk = stale
    ? 'text-red-700 dark:text-red-300'
    : (attachKey === 'nowhere' ? 'text-axal-muted dark:text-gray-300' : 'text-emerald-700 dark:text-emerald-300');
  const staleHair = stale ? 'border-red-200 dark:border-red-900' : '';

  return (
    <WorkspaceShell
      role={role}
      title={item?.metric || 'Market reading'}
      titleAs={ready ? 'p' : 'h1'}
      activeSlug="markets"
      rail={(
        <WorkerRail
          workspace="Research"
          role={role}
          stance="This page does not invent a market figure"
          note={[
            'A save writes a new reading. It does not edit the one you opened, and a stale range cannot be attached.',
            railSummary,
          ].filter(Boolean).join(' ')}
          coverage={[item
            ? `${item.metric}: ${days ?? '—'} days · ${item.comparable_count} comparables`
            : 'One market reading']}
          unavailable={[
            ['Named comparables', 'The count is stored. The engagements behind it are not, so this page will not invent them.'],
            ['A generated range', 'Nothing here calls a model to price a service line.'],
          ]}
        />
      )}
    >
      <div data-testid="market-reading" className="space-y-3" style={accentVars(role)}>
        <Link to="/research/markets" className={`inline-flex min-h-[44px] items-center text-[12px] sm:min-h-0 ${accentLink}`}>
          ‹ Markets
        </Link>

        {(hidden || notFound) && (
          <Card data-testid="market-reading-not-yours" padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">This reading is not on your list.</h2>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-muted">
              Readings are private to whoever recorded them.
            </p>
          </Card>
        )}
        {!hidden && loading && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] text-axal-muted">Loading this reading.</p>
            <Skeleton />
          </Card>
        )}
        {!hidden && error && (
          <Card variant="dashed" padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">This did not load</h2>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-muted">
              {error} Nothing is shown rather than an empty range, because an empty page here would
              say the firm looked and found the work is worth nothing.
            </p>
            <button type="button" onClick={onRetry} className={`${ghostBtn} mt-3 min-h-[44px] sm:min-h-0`}>Try again</button>
          </Card>
        )}

        {ready && (
          <>
            {notice && (notice.ok ? (
              <div
                data-testid="market-reading-notice"
                role="status"
                className="flex items-start gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                <span aria-hidden="true" className="flex-none font-extrabold">✓</span>
                <span>
                  {notice.title ? <b className="block">{notice.title}</b> : null}
                  {notice.text}
                </span>
              </div>
            ) : (
              <p className="text-[12px] font-semibold text-red-700 dark:text-red-300">{notice.text}</p>
            ))}

            <Card
              data-testid="market-reading-header"
              className={stale ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30' : ''}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Market reading</div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink focus:outline-none dark:text-gray-100"
              >
                {item.metric}
              </h1>
              {/* The chip stands for a missing SCOPE and for nothing else. The
                  catalog price is a different fact, drawn apart from the range
                  below (D593, D7039). */}
              <div data-testid="market-reading-scope" className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted">
                <span className="sr-only">Scope:</span>
                {item.scope ? <span>{item.scope}</span> : <NotRecorded />}
              </div>
              <p data-testid="market-reading-line" className="mt-1 text-[12px] text-axal-muted">
                Service line: {item.offering_uid ? 'yes, from your catalog' : 'no, named by what it prices'}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Pill tone={stale ? 'danger' : (band === 'ageing' ? 'warn' : 'ok')}>{ageLabel}</Pill>
                {ownRecord ? null : <Pill tone={attach.tone}>{attach.pill}</Pill>}
                <span className="font-mono text-[11px] text-axal-muted">
                  ran {item.ran_at} · {days} d old
                </span>
              </div>
            </Card>

            <div data-testid="market-reading-tiles" className={`grid grid-cols-2 gap-3 ${ownRecord ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>
              <Tile
                k="Comparable range"
                v={rangeLine(item)}
                sub={`from ${item.comparable_count} comparables · both ends to the cent`}
              />
              <Tile k="Run date" v={item.ran_at} sub={`${runDayLabel(item.ran_at) || item.ran_at} · the day you ran it`} />
              <Tile
                k="Age"
                big
                v={`${days} d old`}
                ink={ageInk}
                hair={staleHair}
                sub={`${ageLabel} · ageing after ${AGE_AT} days, stale at ${STALE_AT} days`}
              />
              {ownRecord ? null : (
                <Tile k="Proposal" big v={attach.tile} ink={proposalInk} hair={staleHair} sub={attach.sub} />
              )}
            </div>

            {/* Two facts side by side, never added together (D7039 RMP-04). */}
            <div data-testid="market-reading-versus" className="grid gap-3 sm:grid-cols-2">
              <Card className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Comparable range · your reading</div>
                <div className="mt-1.5 font-mono text-[15px] font-bold text-axal-ink dark:text-gray-100">{rangeLine(item)}</div>
                <p className="mt-1 text-[12px] text-axal-muted">What {item.comparable_count} comparable engagements went for.</p>
              </Card>
              <Card className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Catalog price · your offer</div>
                {!item.offering_uid ? (
                  <>
                    <div className="mt-1.5 text-[13px] font-bold text-axal-muted dark:text-gray-300">Not applicable</div>
                    <p className="mt-1 text-[12px] text-axal-muted">Not a catalog service line, so there is no listed price.</p>
                  </>
                ) : catalog ? (
                  <>
                    <div className="mt-1.5 font-mono text-[15px] font-bold text-axal-ink dark:text-gray-100">{catalog}</div>
                    <p className="mt-1 text-[12px] text-axal-muted">What you list this service line at, in Offers › Catalog. Never added into the range.</p>
                  </>
                ) : (
                  <>
                    <div className="mt-2"><NotRecorded /></div>
                    <p className="mt-1 text-[12px] text-axal-muted">This service line has no price in your catalog.</p>
                  </>
                )}
              </Card>
            </div>

            <Card data-testid="market-reading-plain">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-extrabold tracking-tight">What this reading says</h2>
                <span className="text-[11px] text-axal-muted">In plain words, from the stored fields only</span>
              </div>
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-axal-ink dark:text-gray-100">
                <li><b>Age.</b> {said.age}</li>
                <li><b>Sample.</b> {said.sample}</li>
                <li><b>What it is not.</b> {said.not}</li>
              </ul>
            </Card>

            <SummaryLine status={summaryStatus} view={sumView} onRetry={onSummaryRetry} />

            <Card>
              <h2 className="text-sm font-extrabold tracking-tight">{fresh ? 'Record a fresh reading' : 'Record this reading'}</h2>
              <p className="mt-1 text-[12px] text-axal-muted">
                {fresh
                  ? 'Keeps what it prices, the scope and the count you last used. The dollars start blank and the run date is today. The stale reading stays as it is.'
                  : 'Opens with this reading’s own figures, to the cent. A save writes a new reading with a new run date; the one you opened is unchanged.'}
              </p>
              <form onSubmit={onSave} className="mt-3" aria-busy={busy ? 'true' : 'false'} noValidate>
                {fail && (
                  <div
                    data-testid="market-reading-save-failed"
                    className="mb-3 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  >
                    <span aria-hidden="true" className="flex-none font-extrabold">!</span>
                    <span><b className="block">{SAVE_FAILED}</b>{fail}</span>
                  </div>
                )}
                <label className="block text-[11px] font-semibold text-axal-muted">
                  Scope <em className="font-normal not-italic text-axal-faint">optional</em>
                  <input
                    aria-label="Scope"
                    className={inputClass}
                    maxLength={200}
                    readOnly={busy}
                    value={form.scope ?? ''}
                    onChange={(e) => onForm({ ...form, scope: e.target.value })}
                  />
                </label>
                <p className="mt-1 text-[11px] text-axal-muted">
                  What this range covers. Left blank, the reading says Not recorded.
                </p>
                {/* One row on a desktop, the button last; two by two on a
                    phone, the button under them and held above the keyboard
                    (D593, D7039 RMP-13). */}
                <div
                  data-testid="market-reading-form-row"
                  className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-start"
                >
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    Low (USD)
                    <input
                      aria-label="Low (USD)"
                      ref={lowRef}
                      className={`${inputClass} font-mono ${forward === false || err.low ? fieldBad : ''}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      readOnly={busy}
                      aria-invalid={forward === false || Boolean(err.low)}
                      aria-describedby={describe('low')}
                      value={form.low}
                      onChange={(e) => onForm({ ...form, low: e.target.value })}
                    />
                    <FieldError id="mr-low-error" text={err.low} />
                  </label>
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    High (USD)
                    <input
                      aria-label="High (USD)"
                      className={`${inputClass} font-mono ${forward === false || err.high ? fieldBad : ''}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      readOnly={busy}
                      aria-invalid={forward === false || Boolean(err.high)}
                      aria-describedby={describe('high')}
                      value={form.high}
                      onChange={(e) => onForm({ ...form, high: e.target.value })}
                    />
                    <FieldError id="mr-high-error" text={err.high} />
                  </label>
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    Comparables
                    <input
                      aria-label="Comparables"
                      className={`${inputClass} font-mono ${err.n ? fieldBad : ''}`}
                      inputMode="numeric"
                      readOnly={busy}
                      aria-invalid={Boolean(err.n)}
                      aria-describedby={describe('n')}
                      value={form.n}
                      onChange={(e) => onForm({ ...form, n: e.target.value })}
                    />
                    <FieldError id="mr-n-error" text={err.n} />
                  </label>
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    Run date
                    <input
                      aria-label="Run date"
                      type="date"
                      className={`${inputClass} ${err.ran_at ? fieldBad : ''}`}
                      readOnly={busy}
                      aria-invalid={Boolean(err.ran_at)}
                      aria-describedby={describe('ran_at')}
                      value={form.ran_at}
                      onChange={(e) => onForm({ ...form, ran_at: e.target.value })}
                    />
                    <FieldError id="mr-ran_at-error" text={err.ran_at} />
                  </label>
                  <button
                    type="submit"
                    className={`${stale && !fresh ? ghostBtn : primaryBtn} col-span-2 justify-self-start max-xl:sticky max-xl:bottom-2 max-xl:min-h-[48px] max-xl:w-full xl:col-span-1 xl:mt-[18px]`}
                    disabled={busy || forward === false}
                  >
                    {busy ? 'Recording…' : 'Record this reading'}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-axal-muted">How many engagements the range came from. Refused if 0. Age counts from the run date.</p>
                {forward === false && (
                  <div
                    role="alert"
                    className="mt-2.5 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  >
                    <span aria-hidden="true" className="flex-none font-extrabold">!</span>
                    <span>High is below low. Nothing is saved until the range reads forward.</span>
                  </div>
                )}
              </form>
            </Card>

            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-extrabold tracking-tight">Comparables basis</h2>
                <span className="font-mono text-[11px] text-axal-muted">
                  {item.comparable_count} counted · 0 named
                </span>
              </div>
              <div
                data-testid="market-reading-comparables-head"
                className="mt-3 hidden grid-cols-[1fr_1.4fr_1.2fr_1.4fr] gap-3 border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint dark:border-gray-700 sm:grid"
              >
                <span>Date</span>
                <span>Engagement went for</span>
                <span>Source</span>
                <span>URL or file</span>
              </div>
              <p className="mt-3 text-[13px] font-bold text-axal-ink dark:text-gray-100">The count has no names behind it</p>
              <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-axal-muted">
                The product stores comparable_count only. A client will ask “which {item.comparable_count}?”.
                Add the engagements you actually used, or leave this blank — never type a count so the form accepts.
                Named engagements are not a column, so there is no control here that would pretend to save one.
              </p>
            </Card>

            {ownRecord ? (
              <Card data-testid="market-reading-own-record">
                <p className="text-[12.5px] leading-relaxed text-axal-muted">{OWN_RECORD_LINE[role]}</p>
                {stale && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className={primaryBtn} onClick={onFresh}>
                      Record a fresh reading
                    </button>
                    <span className="text-[12px] text-axal-muted">Keeps what it prices, blanks the dollars, sets the run date to today.</span>
                  </div>
                )}
              </Card>
            ) : (
              <Card
                data-testid="market-reading-attachment"
                className={stale ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30' : ''}
              >
                <h2 className="text-sm font-extrabold tracking-tight">Proposal attachment</h2>
                {stale ? (
                  <>
                    <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
                      {staleAttachmentSentence(item.ran_at)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" className={primaryBtn} onClick={onFresh}>
                        Record a fresh reading
                      </button>
                      <span className="text-[12px] text-axal-muted">Keeps what it prices, blanks the dollars, sets the run date to today.</span>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">
                      The range and its run date travel together onto the quote.
                    </p>
                    {/* "Still attachable" only where there is a quote to take it. */}
                    {band === 'ageing' && attachKey !== 'nowhere' && (
                      <p className="mt-1 text-[12.5px] text-amber-800 dark:text-amber-300">{ageingAttachmentNote(days)}</p>
                    )}
                    {attachments.length > 0 && (
                      <>
                        <div className="mt-2.5">
                          <Pill tone="ok">Attached</Pill>
                        </div>
                        <ul className="mt-1.5 space-y-1 text-[12.5px] text-axal-ink dark:text-gray-100">
                          {attachments.map((a) => (
                            <li key={a.uid}>
                              {a.proposal_name
                                ? `Attached to ${a.proposal_name}.`
                                : 'This reading is attached. The proposal is not named on the quote.'}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {open.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          aria-label={attachments.length > 0 ? 'Another proposal' : 'Proposal'}
                          className={inputClass}
                          value={quoteId}
                          onChange={(e) => onQuote(e.target.value)}
                        >
                          {open.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.proposal_name || `Quote ${q.id} — proposal not named`}
                            </option>
                          ))}
                        </select>
                        <button type="button" className={ghostBtn} disabled={busy || !quoteId} onClick={onAttach}>
                          {attachments.length > 0 ? 'Attach to another proposal' : 'Attach to a proposal'}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-axal-muted">
                        {attachments.length > 0
                          ? 'There is no other proposal on this account to attach it to.'
                          : 'No proposal on this account. A reading attaches to a quote your partner profile owns.'}
                      </p>
                    )}
                  </>
                )}
              </Card>
            )}

            <div data-testid="market-reading-draft" className={`rounded-[14px] border px-4 py-3.5 ${BAND_SKIN}`}>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--mr-accent)] px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white dark:bg-[var(--mr-accent)] dark:text-white">{DRAFT_PILL}</span>
                <span className="text-[13px] font-extrabold tracking-tight">Reading · demand movement</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-axal-ink dark:text-gray-100">{draft}</p>
              {draftEdit !== '' && (
                <textarea
                  aria-label="Draft preview"
                  className={`${inputClass} min-h-[72px]`}
                  value={draftEdit}
                  onChange={(e) => onDraftEdit(e.target.value)}
                />
              )}
              {kept && (
                <p className="mt-2 text-[12px] text-axal-muted">Kept on this page for this visit: {kept}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button type="button" className={primaryBtn} onClick={() => onDraft(draft)}>Draft</button>
                <button
                  type="button"
                  className={acceptBtn}
                  disabled={!draft}
                  onClick={() => onKeep(draftEdit.trim() || draft)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                  disabled={!draftEdit && !kept}
                  onClick={onDiscard}
                >
                  Discard
                </button>
                <span className="text-[12px] text-axal-muted sm:ml-auto">
                  Run dates carried into any attachment. Accept writes nothing — a reading has no note — and it does not call a model.
                </span>
              </div>
            </div>

            <StatedLimit title="Where these numbers come from">
              <p>
                A reading is what you found, recorded by you. There is no comparables database, and there is not going to be one this product invents.
              </p>
              <p>
                A range is refused without the number of comparables and the date you ran it.
                {ownRecord ? ' Both are kept with the reading.' : ' Both travel onto any proposal.'}
              </p>
            </StatedLimit>
            <p className="text-[11px] text-axal-faint">
              {ownRecord
                ? `Ageing starts after ${AGE_AT} days. Stale, past ${STALE_AT}, needs a fresh reading.`
                : `Ageing starts after ${AGE_AT} days and is still attachable. Stale, past ${STALE_AT}, is blocked.`}
            </p>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

/** The sentence a refused or failed save shows, from the Worker's code (D258) or the network. */
export function saveFailure(err) {
  const code = err?.code || '';
  if (code === 'range_required') return 'High is below low. Nothing is saved until the range reads forward.';
  if (code === 'comparable_count_required') return 'How many engagements the range came from: a whole number, 1 or more. Refused if 0.';
  if (code === 'ran_at_required') return 'A reading needs the date you ran it.';
  if (code === 'not_found') return 'That service line is not in your catalog, so nothing was saved.';
  // No status at all is no answer: the request never reached the Worker.
  if (!err?.status) return NO_ANSWER;
  return err?.message || 'That reading could not be saved.';
}

export default function MarketReading({ role = 'founder' }) {
  const { uid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const hidden = readingsHiddenFor(role);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(!hidden);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState(null);
  const [fail, setFail] = useState(null);
  const [fresh, setFresh] = useState(false);
  const [quoteId, setQuoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftEdit, setDraftEdit] = useState('');
  const [kept, setKept] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryStatus, setSummaryStatus] = useState('idle');
  const headingRef = useRef(null);
  const lowRef = useRef(null);
  // A save on the Markets list opens this page with `{ recorded: true }`: the
  // reading as stored is announced once, from what the Worker returned.
  const arrived = useRef(Boolean(location.state?.recorded));

  // D4607: a read that answers after the route has moved on, or after the
  // page has left, is dropped with its result, its error and its loading state.
  const gate = useRef(null);
  if (!gate.current) gate.current = createRecordGate();
  // The summary has its own ticket, so a late summary for reading A is
  // dropped on B without cancelling B's own reading.
  const summaryGate = useRef(null);
  if (!summaryGate.current) summaryGate.current = createRecordGate();
  useEffect(() => () => { gate.current.invalidate(); summaryGate.current.invalidate(); }, []);

  // D7651: an investor never asks (D6273 Q2); the Worker refuses one anyway.
  const loadSummary = useCallback(async () => {
    if (hidden) return;
    const current = summaryGate.current.begin();
    setSummary(null);
    setSummaryStatus('loading');
    try {
      const res = await researchMarketReadingsApi.summary(uid);
      if (!current()) return;
      setSummary(res?.summary || null);
      setSummaryStatus('ready');
    } catch {
      if (!current()) return;
      setSummary(null);
      setSummaryStatus('unavailable');
    }
  }, [uid, hidden]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const load = useCallback(async () => {
    if (hidden) return;
    const current = gate.current.begin();
    setLoading(true);
    setError(null);
    setNotFound(false);
    // The previous reading goes with it, so nothing of A is saved or attached on B.
    setPayload(null);
    setForm(null);
    setErrors(null);
    setFail(null);
    setFresh(false);
    try {
      const full = await api.research.marketReadingGet(uid);
      if (!current()) return;
      setPayload(full);
      setForm(readingFields(full.item));
      // The picker offers only the proposals this reading is not on yet.
      const open = openProposals(full.proposals, full.attachments);
      setQuoteId(open[0] ? String(open[0].id) : '');
      setDraftEdit('');
      setKept('');
      if (arrived.current) {
        arrived.current = false;
        setNotice({ ok: true, focus: true, title: RECORDED.opened, text: recordedLine(full.item) });
      }
    } catch (e) {
      if (!current()) return;
      setPayload(null);
      setForm(null);
      if (e?.status === 404) setNotFound(true);
      else setError(e?.message || 'The reading did not load.');
    } finally {
      if (current()) setLoading(false);
    }
  }, [uid, hidden]);

  useEffect(() => { load(); }, [load]);

  const item = hidden ? null : (payload?.item || null);
  const stale = item ? ageBand(daysSince(item.ran_at)) === 'stale' : false;
  // D772 (#2098): the reading is the rail's record.
  useRecordCrumb(item?.metric || null, 'market-reading', item ? uid : null);

  // After a save, focus moves to the stored reading's h1 (D7039 handoff).
  useEffect(() => {
    if (notice?.focus && item && headingRef.current) headingRef.current.focus();
  }, [notice, item]);

  const save = async (e) => {
    e.preventDefault();
    // D4607: only the reading the route names, never one still on screen from before.
    if (!item || !form || busy || String(item.uid) !== String(uid)) return;
    const submission = readingSubmission(item, form);
    if (submission.error) {
      // Every correction sits under its own field; the inputs stay as typed.
      setErrors(submission.errors);
      setFail(null);
      return;
    }
    setErrors(null);
    setFail(null);
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.research.marketReadingCreate(submission.body);
      const next = saved?.item?.uid;
      if (next && next !== item.uid) navigate(`/research/markets/${encodeURIComponent(next)}`);
      else await load();
      setNotice({ ok: true, focus: true, title: RECORDED.fresh, text: recordedLine(saved?.item || {}) });
    } catch (err) {
      // D258 — the refusal's code travels on `err.code`, and is compared
      // whole: research_client_prep.ts answers each as a bare `detail` code.
      // The form keeps every input, to the cent.
      setFail(saveFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    if (!item || stale || busy || !quoteId || String(item.uid) !== String(uid)) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.research.attach('reading', item.uid, Number(quoteId));
      await load();
      setNotice({ ok: true, text: 'Attached. The range and its run date travel with that quote.' });
    } catch (err) {
      // D258 — the code is `err.code`; `err.message` is its sentence.
      setNotice({
        ok: false,
        text: err?.code === 'reading_stale'
          ? 'This reading is past ninety days. Record a fresh one before attaching it.'
          : 'That proposal is not on your account, so nothing was attached.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <MarketReadingView
      role={role}
      payload={payload}
      loading={loading}
      error={error}
      notFound={notFound}
      notice={notice}
      form={form}
      onForm={setForm}
      errors={errors}
      fail={fail}
      fresh={fresh}
      busy={busy}
      quoteId={quoteId}
      onQuote={setQuoteId}
      onRetry={load}
      onSave={save}
      onAttach={attach}
      onFresh={() => {
        setForm((current) => freshReadingForm(current, new Date().toISOString().slice(0, 10)));
        setNotice(null);
        setErrors(null);
        setFail(null);
        setFresh(true);
        // Focus lands on Low, the first field still to fill.
        if (lowRef.current) lowRef.current.focus();
      }}
      draftEdit={draftEdit}
      onDraft={setDraftEdit}
      onDraftEdit={setDraftEdit}
      kept={kept}
      onKeep={(text) => {
        setKept(text);
        setDraftEdit('');
      }}
      onDiscard={() => {
        setDraftEdit('');
        setKept('');
      }}
      headingRef={headingRef}
      lowRef={lowRef}
      summary={summary}
      summaryStatus={summaryStatus}
      onSummaryRetry={loadSummary}
    />
  );
}
