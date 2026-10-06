import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Heart, Lock, AlertTriangle, ExternalLink, Star } from 'lucide-react';
import PageExplainer from '../components/PageExplainer';
import { safeReadJSON } from '../lib/storage';
import { api } from '../lib/api';
import { Card, Pill, RailFrame, SectionLabel, Skeleton, Unrecorded, Unreadable, WorkerRail } from '../ui';
import {
  CANVAS_SCORES, MORE_SCORES, TOPICS, MAX_TAGS, NOT_STORED_REASON, HISTORY_ROW_CAP,
  isDay, utcToday, weekStart, thisWeekEntry, formFromEntry, buildCheckinPayload,
  answeredCount, pastWeeks, formatDay, formatWhen, splitBookings, bookingStatus, canRate,
  resourceKind, resourceFacts, safeHref, homeCoverage, countRange,
  canMemberCancel, storedStars, MEMBER_CANCELLABLE, AGGREGATE_SCORE_KEYS,
} from './wellbeing/wellbeingModel';
import { BTN, FIELD, PageHeader, CardHead, NotRecorded, ScoreDots, Sparkline, Outcome } from './wellbeing/WellbeingParts';

/**
 * /wellbeing — the member's Wellbeing home (canvas `wb-home`, D570).
 *
 * Four cards on the canvas's two columns: this week's check-in, my past weeks,
 * my bookings and resources. Each reads on its own, so one failed read never
 * blanks the others, and each has its own loading, empty and unreadable state.
 *
 * WHAT THE CANVAS DREW THAT THE WORKER DOES NOT STORE, and what this page does
 * about each (the reasons are in `wellbeing/wellbeingModel.js` and D570):
 *   - Support and decisions are drawn and marked "Not recorded": the check-in
 *     route has no field for either, and an input it would silently drop is
 *     worse than none.
 *   - "One per week" is this page's rule, kept by re-saving onto this week's
 *     day. The route upserts per day and refuses nothing.
 *   - A booking records no service, and no route lets a member cancel one.
 *
 * Eadwyn reads none of it. The rail's coverage is built from the resource
 * library alone (`homeCoverage`), because coverage lines are sent to a model
 * when a reader asks for a read-back.
 */

function readUser() { return safeReadJSON('user', {}); }

const IDLE_SAVE = { saving: false, ok: null, error: null, fieldErrors: {}, encrypted: null };

// ---------------------------------------------------------------------------
// This week's check-in
// ---------------------------------------------------------------------------
export function CheckinCard({
  status, today, entry, form, save = IDLE_SAVE, onScore, onNote, onTopic, onSave, onRetry,
}) {
  const week = isDay(today) ? weekStart(today) : null;
  const errors = save.fieldErrors || {};
  const moreOpen = MORE_SCORES.some((s) => form?.values?.[s.field] != null) || (form?.tags || []).length > 0;
  return (
    <Card padding="lg" data-testid="card-checkin">
      <CardHead title="This week’s check-in" meta={week ? `week of ${formatDay(week)} · one per week` : null} />
      {status === 'loading' ? <Skeleton.Text lines={6} /> : status === 'unreadable' ? (
        <Unreadable
          what="Your check-ins"
          claim="Saving waits until they can be read, so this week’s entry is never written twice."
          onRetry={onRetry}
        />
      ) : (
        <>
          <p className="mb-3 text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-checkin-week">
            {entry
              ? `You checked in on ${formatDay(entry.day)}. Saving again replaces that entry.`
              : 'No check-in this week yet.'}
          </p>
          <div className="space-y-3.5">
            {CANVAS_SCORES.map((s) => (s.field ? (
              <div key={s.key}>
                <ScoreDots
                  name={s.key}
                  label={s.label}
                  low={s.low}
                  high={s.high}
                  value={form?.values?.[s.field] ?? null}
                  onChange={(v) => onScore?.(s.field, v)}
                  disabled={save.saving}
                />
                {errors[s.field] && <p role="alert" className={FIELD.error}>{errors[s.field]}</p>}
              </div>
            ) : (
              <div key={s.key} className="flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid={`score-${s.key}-not-recorded`}>
                <span className="min-w-[5.5rem] text-[13px] font-semibold text-axal-ink dark:text-gray-100">{s.label}</span>
                <NotRecorded reason={NOT_STORED_REASON} />
              </div>
            )))}
          </div>

          <div className="mt-4">
            <label htmlFor="checkin-note" className={FIELD.label}>Private note (optional)</label>
            <textarea
              id="checkin-note"
              data-testid="input-checkin-note"
              rows={3}
              maxLength={4000}
              value={form?.note || ''}
              onChange={(e) => onNote?.(e.target.value)}
              disabled={save.saving}
              className={FIELD.input}
            />
            {errors.free_text && <p role="alert" className={FIELD.error}>{errors.free_text}</p>}
          </div>

          <details className="mt-3 rounded-axal-md border border-axal-hairline px-3 py-2 dark:border-gray-700" open={moreOpen} data-testid="checkin-more">
            <summary className="cursor-pointer text-xs font-semibold text-axal-ink dark:text-gray-100">
              More (optional): mood, focus, connection and topics
            </summary>
            <div className="mt-3 space-y-3.5">
              {MORE_SCORES.map((s) => (
                <div key={s.key}>
                  <ScoreDots
                    name={s.key}
                    label={s.label}
                    low={s.low}
                    high={s.high}
                    value={form?.values?.[s.field] ?? null}
                    onChange={(v) => onScore?.(s.field, v)}
                    disabled={save.saving}
                  />
                  {errors[s.field] && <p role="alert" className={FIELD.error}>{errors[s.field]}</p>}
                </div>
              ))}
              <div>
                <span className={FIELD.label}>Topics</span>
                <p className={FIELD.note}>Up to {MAX_TAGS}. The experts listed first when you book are the ones who work on these.</p>
                <div className="mt-2 flex flex-wrap gap-1.5" data-testid="checkin-topics">
                  {TOPICS.map((t) => {
                    const on = (form?.tags || []).includes(t.tag);
                    return (
                      <button
                        key={t.tag}
                        type="button"
                        aria-pressed={on}
                        disabled={save.saving}
                        onClick={() => onTopic?.(t.tag)}
                        className={`rounded-axal-pill border px-2.5 py-1 text-xs font-medium transition-colors ${
                          on
                            ? 'border-axal-violet/40 bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300'
                            : 'border-axal-hairline bg-white text-axal-muted hover:border-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                {errors.tags && <p role="alert" className={FIELD.error}>{errors.tags}</p>}
              </div>
            </div>
          </details>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
            {save.encrypted === false ? (
              <span role="alert" className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300" data-testid="text-checkin-not-encrypted">
                <Lock size={12} aria-hidden="true" /> Saved, but not encrypted: the server could not encrypt it this time. Only you can read it.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-axal-muted dark:text-gray-400" data-testid="text-checkin-encrypted">
                <Lock size={12} aria-hidden="true" /> {save.encrypted === true ? 'Saved encrypted.' : 'Stored encrypted.'} Only you can read it.
              </span>
            )}
            <button type="button" className={BTN.primary} onClick={onSave} disabled={save.saving} data-testid="button-save-checkin">
              {save.saving ? 'Saving…' : entry ? 'Update this week' : 'Save check-in'}
            </button>
          </div>
          <div className="mt-2"><Outcome ok={save.ok} error={save.error || errors.day} testId="checkin" /></div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// My past weeks
// ---------------------------------------------------------------------------
export function PastWeeksCard({ status, weeks = [], onRetry }) {
  const recorded = weeks.filter((w) => w.entries > 0).length;
  const unread = weeks.filter((w) => w.unread);
  const extra = MORE_SCORES.filter((s) => weeks.some((w) => w.values?.[s.field] != null));
  return (
    <Card data-testid="card-past-weeks">
      <CardHead title="My past weeks" meta={status === 'ready' && weeks.length ? `${weeks.length} weeks · 1 = low · 5 = high` : null} />
      {status === 'loading' ? <Skeleton.Text lines={5} /> : status === 'unreadable' ? (
        <Unreadable what="Your past weeks" claim="This is not a sign that you skipped them." onRetry={onRetry} />
      ) : !recorded && !unread.length ? (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-past-weeks-empty">
          No past weeks yet. Each weekly check-in adds a point to these lines.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {CANVAS_SCORES.map((s) => (
              <li key={s.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="text-xs font-semibold text-axal-ink dark:text-gray-100">{s.label}</span>
                {s.field
                  ? <Sparkline series={weeks.map((w) => w.values?.[s.field] ?? null)} label={s.label} testId={`spark-${s.key}`} />
                  : <Unrecorded reason={NOT_STORED_REASON}>Not recorded</Unrecorded>}
              </li>
            ))}
          </ul>
          {extra.length > 0 && (
            <>
              <SectionLabel className="mt-3">Also recorded</SectionLabel>
              <ul className="mt-1.5 space-y-2">
                {extra.map((s) => (
                  <li key={s.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
                    <span className="text-xs font-semibold text-axal-ink dark:text-gray-100">{s.label}</span>
                    <Sparkline series={weeks.map((w) => w.values?.[s.field] ?? null)} label={s.label} testId={`spark-${s.key}`} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-3 space-y-1 text-xs text-axal-muted dark:text-gray-400">
            <p data-testid="text-past-weeks-count">
              {recorded} of {weeks.length} weeks have a check-in. A week without one is a gap in the line, never a zero.
            </p>
            <p>Weeks saved before support and decisions were asked have neither: those are gaps, never zeros.</p>
            {unread.length > 0 && (
              <p data-testid="text-past-weeks-unread">
                Weeks up to {formatDay(unread[unread.length - 1].week)} are left blank: they are older than the {HISTORY_ROW_CAP} most recent check-ins this page reads.
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------
function RateStars({ booking, state, onRate }) {
  // D574 — the stars already stored come with the booking, so a rating
  // survives a reload; a rating given on this page replaces them.
  const stars = state?.stars ?? (state ? null : storedStars(booking));
  if (stars && !state?.busy && !state?.error) {
    return <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300" role="status">Rated {stars} of 5.</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid={`rate-${booking.uid}`}>
      <span className="text-xs text-axal-muted dark:text-gray-400">Rate:</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={state?.busy}
          onClick={() => onRate?.(booking, n)}
          aria-label={`Rate ${booking.expert_name || 'this expert'} ${n} of 5`}
          className="rounded p-0.5 text-amber-500 hover:text-amber-600 disabled:opacity-50"
        >
          <Star size={14} aria-hidden="true" />
        </button>
      ))}
      {state?.error && <span role="alert" className="text-xs text-red-700 dark:text-red-300">{state.error}</span>}
    </span>
  );
}

function CancelBooking({ booking, state, onCancel }) {
  if (state?.stage === 'confirm') {
    return (
      <span className="inline-flex items-center gap-1.5" data-testid={`cancel-confirm-${booking.uid}`}>
        <span className="text-xs text-axal-muted dark:text-gray-400">Cancel this session?</span>
        <button type="button" className={BTN.link} disabled={state.busy} onClick={() => onCancel?.(booking, 'go')}>Yes, cancel</button>
        <button type="button" className={BTN.link} disabled={state.busy} onClick={() => onCancel?.(booking, 'keep')}>Keep it</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" className={BTN.link} onClick={() => onCancel?.(booking, 'ask')} data-testid={`button-cancel-${booking.uid}`}>Cancel</button>
      {state?.error && <span role="alert" className="text-xs text-red-700 dark:text-red-300">{state.error}</span>}
    </span>
  );
}

function BookingRow({ booking, past, now, rate, onRate, cancel, onCancel, timeZone }) {
  const status = bookingStatus(booking.status);
  const when = formatWhen(booking.scheduled_at, { timeZone });
  const call = safeHref(booking.meet_link);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2.5" data-testid={`booking-${booking.uid}`}>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">
          {booking.expert_name || <Unrecorded reason="The booking names no expert.">Expert not recorded</Unrecorded>}
          {' · '}
          {String(booking.service_title ?? '').trim()
            || <Unrecorded reason="No service was chosen for this booking.">no service chosen</Unrecorded>}
        </div>
        <div className="text-xs tabular-nums text-axal-muted dark:text-gray-400">
          {when || <Unrecorded reason="Booked through the expert’s own scheduler, which keeps the time.">Time not recorded</Unrecorded>}
          {' · '}
          {Number.isFinite(Number(booking.duration_minutes)) ? `${booking.duration_minutes} min` : 'length not recorded'}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={status.tone}>{status.label}</Pill>
        {!past && call && <a href={call} target="_blank" rel="noopener noreferrer" className={BTN.link}>Join call <ExternalLink size={12} aria-hidden="true" /></a>}
        {!past && canMemberCancel(booking, now) && <CancelBooking booking={booking} state={cancel} onCancel={onCancel} />}
        {past && canRate(booking, now) && <RateStars booking={booking} state={rate} onRate={onRate} />}
      </div>
    </li>
  );
}

export function MyBookingsCard({
  status, bookings = [], tab = 'upcoming', onTab, now = Date.now(), rated = {}, onRate, cancels = {}, onCancel, onRetry, timeZone,
}) {
  const { upcoming, past } = splitBookings(bookings, now);
  const rows = tab === 'past' ? past : upcoming;
  const tabs = [['upcoming', 'Upcoming', upcoming.length], ['past', 'Past', past.length]];
  return (
    <Card data-testid="card-my-bookings">
      <CardHead title="My bookings">
        <div className="flex gap-1" role="tablist" aria-label="Bookings">
          {tabs.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => onTab?.(key)}
              className={`rounded-axal-xs px-2.5 py-1.5 text-[12.5px] font-semibold ${
                tab === key ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'
              }`}
            >
              {label}{status === 'ready' ? ` · ${n}` : ''}
            </button>
          ))}
        </div>
      </CardHead>
      {status === 'loading' ? <Skeleton.Text lines={3} /> : status === 'unreadable' ? (
        <Unreadable what="Your bookings" claim="This is not a sign that you have none." onRetry={onRetry} />
      ) : rows.length ? (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid={`list-bookings-${tab}`}>
          {rows.map((b) => (
            <BookingRow key={b.uid} booking={b} past={tab === 'past'} now={now} rate={rated[b.uid]} onRate={onRate} cancel={cancels[b.uid]} onCancel={onCancel} timeZone={timeZone} />
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid={`text-bookings-${tab}-empty`}>
          {tab === 'past' ? 'No past bookings.' : 'No upcoming bookings.'}
        </p>
      )}
      {status === 'ready' && tab === 'upcoming' && upcoming.some((b) => b.payment_status === 'paid' && MEMBER_CANCELLABLE.includes(b.status)) && (
        <p className="mt-2 text-xs text-axal-muted dark:text-gray-400" data-testid="text-cancel-paid">
          A paid session is cancelled by the expert, so its payment is refunded with it.
        </p>
      )}
      {status === 'ready' && tab === 'past' && past.some((b) => canRate(b, now)) && (
        <p className="mt-2 text-xs text-axal-muted dark:text-gray-400">One rating per expert; rating again replaces it.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 text-xs text-axal-muted dark:border-gray-700 dark:text-gray-400">
        <span>Only you and the expert see a booking. A booking made here carries no note.</span>
        <Link to="/wellbeing/book" className={BTN.link} data-testid="link-book-expert">Book an expert →</Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
export function ResourcesCard({ status, resources = [], expanded = false, onToggle, onRetry, isAdmin = false }) {
  const shown = expanded ? resources : resources.slice(0, 3);
  return (
    <Card data-testid="card-resources">
      <CardHead title="Resources for you" meta={status === 'ready' ? `${resources.length} in the library` : null} />
      {status === 'loading' ? <Skeleton.Text lines={3} /> : status === 'unreadable' ? (
        <Unreadable what="The resource library" claim="This is not a sign that it is empty." onRetry={onRetry} />
      ) : !resources.length ? (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-resources-empty">No resources yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="list-resources">
            {shown.map((r) => {
              const href = safeHref(r.url);
              const facts = resourceFacts(r);
              return (
                <li key={r.id ?? r.uid} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Pill tone={r.category === 'hotline' ? 'warn' : 'neutral'}>{resourceKind(r.category)}</Pill>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="truncate text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">
                        {r.name}
                      </a>
                    ) : (
                      <span className="truncate text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.name}</span>
                    )}
                  </span>
                  {facts.length > 0 && <span className="text-xs text-axal-muted dark:text-gray-400">{facts.join(' · ')}</span>}
                </li>
              );
            })}
          </ul>
          {resources.length > 3 && (
            <button type="button" className={`${BTN.link} mt-2`} onClick={onToggle} data-testid="button-resources-toggle">
              {expanded ? 'Show fewer' : `Show all ${resources.length}`}
            </button>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 text-xs text-axal-muted dark:border-gray-700 dark:text-gray-400">
        <span>In the library’s own order. Nothing here is chosen from your check-ins, and the library records no reading or listening time.</span>
        {isAdmin && <Link to="/admin/wellbeing/resources" className={BTN.link} data-testid="link-manage-library">Manage the library →</Link>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Admin aggregate (admin view only)
// ---------------------------------------------------------------------------
// D570: the six scores `/aggregate` actually returns. It used to read
// `support` and `decisions`, which that route never sends, so two of its five
// tiles were always a dash and the three it does send were never shown.
const AGGREGATE_LABELS = { mood: 'Mood', stress: 'Stress', sleep: 'Sleep', energy: 'Energy', focus: 'Focus', social: 'Connection' };

function PulseTile({ label, children }) {
  return (
    <div className="rounded-axal-md bg-axal-ground p-3">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-lg font-semibold tabular-nums text-axal-ink sm:text-2xl dark:text-gray-100">{children}</div>
    </div>
  );
}

/**
 * The pulse's founder and submission counts. `/aggregate` rounds both down
 * to a multiple of five, so each shows the range it stands for
 * (`countRange`): printed bare, a cohort of three founders read "0".
 */
export function PulseCounts({ data }) {
  const range = (n) => countRange(n)
    ?? <span className="text-sm"><Unrecorded reason="The pulse did not return this count.">Not recorded</Unrecorded></span>;
  return (
    <div className="mb-4" data-testid="pulse-counts">
      <div className="grid grid-cols-3 gap-3">
        <PulseTile label="Founders">{range(data?.cohort_size)}</PulseTile>
        <PulseTile label="Submissions">{range(data?.submissions)}</PulseTile>
        <PulseTile label="Window">{data?.window_days}d</PulseTile>
      </div>
      <p className="mt-2 text-xs text-axal-muted dark:text-gray-400">
        Counts are rounded down to a multiple of five so no founder can be singled out, and are shown as the range they stand for.
      </p>
    </div>
  );
}

function AdminAggregate() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [days, setDays] = useState(30);

  const load = async (d = days) => {
    setErr(null);
    // D332 — a request failure of ANY kind used to be rendered as
    // `insufficient_data: true`, the exact shape the worker's own /aggregate
    // sends for a genuinely small cohort (and, until D574, also sent on an
    // internal read failure; it now answers 503). So a request
    // that never reached the worker at all — a 404 from a stale deploy, a
    // network failure — read on screen as "not enough people have checked in
    // yet", which is a claim about the cohort, not about the read. The
    // worker's own response is trusted as-is; any thrown error goes to `err`.
    try { setData(await api.wellbeingAggregate(d)); }
    catch (e) { setErr(e?.message || 'Failed'); }
  };
  useEffect(() => { load(days); /* eslint-disable-next-line */ }, [days]);

  return (
    <Card padding="lg" data-testid="card-admin-aggregate">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-axal-muted dark:text-gray-400" />
          <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Anonymized founder pulse</h2>
        </div>
        <select
          value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <p className="mb-4 flex items-start gap-1.5 text-xs text-axal-muted dark:text-gray-400">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
        Aggregate-only. We never show per-founder check-ins. Withheld below the minimum cohort size to prevent re-identification.
      </p>
      {err && <div className="text-sm text-red-600 dark:text-red-300">{err}</div>}
      {!data && !err && <Skeleton.Text lines={2} />}
      {data && (
        <>
          <PulseCounts data={data} />
          {data.insufficient_data ? (
            <div className="flex items-start gap-2 rounded-axal-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Below the minimum cohort of {data.min_cohort} unique founders. Averages are withheld so a single response can't be inferred.</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {AGGREGATE_SCORE_KEYS.map((k) => (
                <div key={k} className="rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700">
                  <SectionLabel>{AGGREGATE_LABELS[k]}</SectionLabel>
                  <div className="mt-1 text-2xl font-semibold text-axal-ink dark:text-gray-100">
                    {data.averages?.[k] != null
                      ? <>{data.averages[k]}<span className="text-sm font-normal text-axal-faint">/5</span></>
                      : <span className="text-sm"><Unrecorded reason="No check-in in this window answered this score.">Not recorded</Unrecorded></span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function WellbeingPage() {
  const user = readUser();
  const role = (user.role || '').toLowerCase();
  const viewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('viewMode')) || role;
  const isInvestor = role === 'investor';
  const isAdmin = role === 'admin';
  const showAggregate = isAdmin && viewMode === 'admin';

  const [history, setHistory] = useState({ status: 'loading', checkins: [], today: null });
  const [form, setForm] = useState(() => formFromEntry(null));
  const [save, setSave] = useState(IDLE_SAVE);
  const [bookings, setBookings] = useState({ status: 'loading', rows: [] });
  const [tab, setTab] = useState('upcoming');
  const [rated, setRated] = useState({});
  const [resources, setResources] = useState({ status: 'loading', rows: [] });
  const [expanded, setExpanded] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistory((h) => ({ ...h, status: 'loading' }));
    try {
      const r = await api.wellbeingMyCheckins();
      const checkins = Array.isArray(r?.checkins) ? r.checkins : [];
      const today = isDay(r?.today) ? r.today : utcToday();
      setHistory({ status: 'ready', checkins, today });
      // The form starts from what this week already holds, so a save sends
      // every stored value back rather than erasing the ones not touched.
      setForm(formFromEntry(thisWeekEntry(checkins, today)));
    } catch {
      setHistory({ status: 'unreadable', checkins: [], today: null });
    }
  }, []);

  const loadBookings = useCallback(async () => {
    setBookings((b) => ({ ...b, status: 'loading' }));
    try {
      const r = await api.wellbeingMyBookings();
      setBookings({ status: 'ready', rows: Array.isArray(r?.bookings) ? r.bookings : [] });
    } catch {
      setBookings({ status: 'unreadable', rows: [] });
    }
  }, []);

  const loadResources = useCallback(async () => {
    setResources((r) => ({ ...r, status: 'loading' }));
    try {
      const r = await api.wellbeingResources();
      setResources({ status: 'ready', rows: Array.isArray(r?.resources) ? r.resources : [] });
    } catch {
      setResources({ status: 'unreadable', rows: [] });
    }
  }, []);

  useEffect(() => {
    if (isInvestor) return;
    loadHistory();
    loadBookings();
    loadResources();
  }, [isInvestor, loadHistory, loadBookings, loadResources]);

  const entry = history.status === 'ready' ? thisWeekEntry(history.checkins, history.today) : null;
  const weeks = useMemo(
    () => (history.status === 'ready' ? pastWeeks(history.checkins, history.today) : []),
    [history],
  );

  const setScore = (field, value) => {
    setSave(IDLE_SAVE);
    setForm((f) => ({ ...f, values: { ...f.values, [field]: value } }));
  };
  const setNote = (note) => { setSave(IDLE_SAVE); setForm((f) => ({ ...f, note })); };
  const toggleTopic = (tag) => {
    setSave(IDLE_SAVE);
    setForm((f) => {
      const tags = f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag].slice(0, MAX_TAGS);
      return { ...f, tags };
    });
  };

  const submit = async () => {
    if (history.status !== 'ready') return;
    const body = buildCheckinPayload({ ...form, entry });
    if (!answeredCount(body)) {
      setSave({ ...IDLE_SAVE, error: 'Answer at least one score before saving.' });
      return;
    }
    setSave({ ...IDLE_SAVE, saving: true });
    try {
      const saved = await api.wellbeingSubmit(body);
      setSave({
        ...IDLE_SAVE,
        ok: entry ? 'Updated this week’s check-in.' : `Saved for the week of ${formatDay(weekStart(history.today))}.`,
        // D574 — the route says whether this save was encrypted.
        encrypted: typeof saved?.stored_encrypted === 'boolean' ? saved.stored_encrypted : null,
      });
      await loadHistory();
    } catch (e) {
      const fields = e?.status === 400 && e?.data?.fields && typeof e.data.fields === 'object' ? e.data.fields : {};
      setSave({ ...IDLE_SAVE, fieldErrors: fields, error: e?.message || 'The check-in could not be saved.' });
    }
  };

  // D574 — cancelling asks first, then reloads the list from the route.
  const [cancels, setCancels] = useState({});
  const cancelBooking = async (booking, step) => {
    if (step === 'ask') { setCancels((c) => ({ ...c, [booking.uid]: { stage: 'confirm' } })); return; }
    if (step === 'keep') { setCancels((c) => ({ ...c, [booking.uid]: null })); return; }
    setCancels((c) => ({ ...c, [booking.uid]: { stage: 'confirm', busy: true } }));
    try {
      await api.wellbeingCancelBooking(booking.uid);
      setCancels((c) => ({ ...c, [booking.uid]: null }));
      await loadBookings();
    } catch (e) {
      setCancels((c) => ({ ...c, [booking.uid]: { error: e?.message || 'The booking was not cancelled.' } }));
    }
  };

  const rate = async (booking, stars) => {
    setRated((r) => ({ ...r, [booking.uid]: { busy: true } }));
    try {
      await api.wellbeingExpertRate(booking.expert_uid, { stars });
      setRated((r) => ({ ...r, [booking.uid]: { stars } }));
    } catch (e) {
      setRated((r) => ({ ...r, [booking.uid]: { error: e?.message || 'The rating could not be saved.' } }));
    }
  };

  if (isInvestor) {
    return (
      <div className="max-w-3xl">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-axal-ink dark:text-gray-100">
          <Heart className="h-6 w-6 text-rose-500" /> Wellbeing
        </h1>
        <PageExplainer pageKey="wellbeing" />
        <Card padding="lg" className="mt-4 text-sm text-axal-muted dark:text-gray-400">
          Wellbeing data is private to founders and admin operators. Investors do not have access.
        </Card>
      </div>
    );
  }

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Wellbeing"
          role="founder"
          stance="Private by design"
          note="Eadwyn never reads your check-ins, your notes or your bookings. All it can read back on this page is a count of the resource library."
          coverage={homeCoverage(resources.status === 'ready' ? resources.rows : null)}
          coverageNote="Counts from the resource library only. Nothing you write on this page is sent to a model."
          unavailable={[
            ['How your scores moved', 'Describing your weeks would mean sending your check-ins to a model. They stay private to you, so this is not offered.'],
          ]}
        />
      )}
      data-testid="wellbeing-home"
    >
      <section className="min-w-0 space-y-4" aria-label="Wellbeing">
        <PageHeader
          title="Wellbeing"
          sub="A weekly check-in, your bookings with experts, and resources. Check-ins are stored encrypted; only you can read them."
        />
        {showAggregate && <AdminAggregate />}
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <CheckinCard
            status={history.status}
            today={history.today}
            entry={entry}
            form={form}
            save={save}
            onScore={setScore}
            onNote={setNote}
            onTopic={toggleTopic}
            onSave={submit}
            onRetry={loadHistory}
          />
          <div className="space-y-4">
            <PastWeeksCard status={history.status} weeks={weeks} onRetry={loadHistory} />
            <MyBookingsCard
              status={bookings.status}
              bookings={bookings.rows}
              tab={tab}
              onTab={setTab}
              rated={rated}
              onRate={rate}
              cancels={cancels}
              onCancel={cancelBooking}
              onRetry={loadBookings}
            />
            <ResourcesCard
              status={resources.status}
              resources={resources.rows}
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
              onRetry={loadResources}
              isAdmin={isAdmin}
            />
          </div>
        </div>
      </section>
    </RailFrame>
  );
}
