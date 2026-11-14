import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import { MoreRows, StatedLimit, Unrecorded, ZoneBody, ZoneHeading } from './kit';
import { usePagedList } from './pages';

/**
 * Advisor › Expertise › Visibility (D1597, #3870; mounted by D1424, #3700,
 * board PH11). It replaces the zone's `NoStoreYet` card, over the one read
 * D1597 built: `GET /api/advisors/me/visibility?days=30` through
 * `api.getMyAdvisorVisibility`.
 *
 * WHAT IT SHOWS IS ONLY WHAT IS RECORDED.
 *   · Requests per booking link in the window, with each status present, and
 *     "Booked without a link" for bookings that name none. A 0 here is real:
 *     its read succeeded.
 *   · Your published pieces and their lifetime opens here on Axal.
 *   · Profile views and engagements per surface are "Not recorded", each with
 *     the Worker's own sentence (owner answer H: no view counter is started).
 *
 * A FAILED READ IS NEVER A ZERO. The two blocks are read apart; the block that
 * came back null reads "… could not be read · Try again", and the other still
 * shows. Nothing is added up across stores into one reach figure.
 *
 * LINKS ARE READ A PAGE AT A TIME (#4689). The Worker returns 100 links a page
 * with `links.next_offset`, and "Show more" appends the next. Each booking is
 * matched to its own link in the Worker, so one on link 101 is that link's and
 * never "Booked without a link"; the total over every link is `requests`.
 *
 * D4827 (#4827), board EX-12 of the Expertise v2 canvas (D4823):
 *   · a 7 / 30 / 90-day window for booking requests. Opens are a lifetime
 *     counter, so their tile says "since published" whatever the window;
 *   · four tiles named for what each one counts: Article opens (raw opens, not
 *     people), Booking requests, and Talk reach and Profile views, which nothing
 *     records and so read Not recorded, never 0;
 *   · Articles by opens: the most-opened pieces and the rest added up;
 *   · session types no active booking link sells, each with Add booking link;
 *   · at most three next steps, each tied to a recorded fact (`visibilityActions`).
 *     None is invented where the data does not support it.
 */
export const VISIBILITY_DAYS = 30;
/** The board's window choices, in days. */
export const VISIBILITY_WINDOWS = [7, 30, 90];
export const ADD_BOOKING_LINK_HREF = '/practice/sessions#booking-links';
export const WRITE_HREF = '/expertise/thinking';
const TALK_REACH_NOTE = 'Nothing in the product records how many people heard a talk.';

const STATUS_LABEL = { pending: 'pending', confirmed: 'confirmed', completed: 'completed', cancelled: 'cancelled', no_show: 'no-show' };

export function statusLine(byStatus) {
  const parts = Object.entries(byStatus || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${STATUS_LABEL[k] || k}`);
  return parts.length ? parts.join(' · ') : null;
}

function BlockUnreadable({ what, onRetry, testid }) {
  return (
    <p role="status" className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid={testid}>
      {what} could not be read ·{' '}
      <button type="button" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300" onClick={onRetry}>Try again</button>
    </p>
  );
}

/** The links read so far, then "Booked without a link" last (rows are merged by key, so it is there once). */
export function orderSurfaces(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return [...list.filter((s) => s.kind !== 'no_link'), ...list.filter((s) => s.kind === 'no_link')];
}

export function requestsLine(requests, days) {
  const n = Number(requests?.total);
  if (!Number.isFinite(n)) return null;
  return `${n} ${n === 1 ? 'request' : 'requests'} in the last ${days} days, across every link`;
}

/**
 * D4827: the next steps the read supports, most useful first, at most three. A session type no link sells can be
 * booked by nobody from a link; the most-opened piece is the one a follow-up builds on. A block that could not be
 * read suggests nothing.
 */
export function visibilityActions(data) {
  const out = [];
  for (const t of data?.unlinked_services?.items || []) {
    out.push({ key: `link:${t.uid}`, text: `${t.name} has no booking link, so nobody can book it from one.`, label: 'Add booking link', to: ADD_BOOKING_LINK_HREF });
  }
  const top = data?.writing?.top?.[0];
  if (top && Number(top.opens) > 0) {
    out.push({ key: `write:${top.slug}`, text: `“${top.title}” has the most opens of your pieces.`, label: 'Write a follow-up', to: WRITE_HREF });
  }
  return out.slice(0, 3);
}

function Tile({ label, testid, children, note }) {
  return (
    <Card className="px-3 py-2.5" data-testid={testid}>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      {children}
      {note ? <div className="mt-1 text-[11px] leading-snug text-axal-faint">{note}</div> : null}
    </Card>
  );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function VisibilityView({ data, onRetry, more = null }) {
  const surfaces = Array.isArray(data?.surfaces) ? orderSurfaces(data.surfaces) : null;
  const writing = data?.writing || null;
  const days = data?.window?.days || VISIBILITY_DAYS;
  const requestsTotal = surfaces !== null && Number.isFinite(Number(data?.requests?.total)) ? Number(data.requests.total) : null;
  const unlinked = data && 'unlinked_services' in data ? data.unlinked_services : undefined;
  const actions = visibilityActions(data);
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="advisor-visibility-tiles">
        <Tile label="Article opens" testid="advisor-visibility-opens" note={writing ? 'Raw opens since each piece was published, not unique people.' : null}>
          {writing === null
            ? <div className="mt-1.5"><BlockUnreadable what="Your writing" onRetry={onRetry} testid="advisor-visibility-opens-unreadable" /></div>
            : <div className="mt-1 text-lg font-extrabold tabular-nums">{writing.opens}</div>}
        </Tile>
        <Tile label="Booking requests" testid="advisor-visibility-requests" note={requestsTotal !== null ? `On your booking links, last ${days} days.` : null}>
          {requestsTotal === null
            ? <div className="mt-1.5"><BlockUnreadable what="Your booking links" onRetry={onRetry} testid="advisor-visibility-requests-unreadable" /></div>
            : <div className="mt-1 text-lg font-extrabold tabular-nums">{requestsTotal}</div>}
        </Tile>
        <Card className="px-3 py-2.5" data-testid="advisor-visibility-talks">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Talk reach</div>
          <div className="mt-1.5"><Unrecorded /></div>
          <div className="mt-1 text-[11px] leading-snug text-axal-faint">{TALK_REACH_NOTE}</div>
        </Card>
        <Card className="px-3 py-2.5" data-testid="advisor-visibility-views">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Profile views</div>
          <div className="mt-1.5"><Unrecorded /></div>
          <div className="mt-1 text-[11px] leading-snug text-axal-faint">{data?.views_note}</div>
        </Card>
      </div>

      {actions.length ? (
        <Card className="p-4" data-testid="advisor-visibility-actions">
          <div className="mb-2 text-sm font-extrabold tracking-tight">Next steps</div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {actions.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]" data-testid="advisor-visibility-action">
                <span>{a.text}</span>
                <Link to={a.to} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300">{a.label}</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-4" data-testid="advisor-visibility-writing">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-sm font-extrabold tracking-tight">Articles by opens</span>
          <span className="text-[11px] text-axal-faint">Since each was published</span>
        </div>
        {writing === null ? (
          <BlockUnreadable what="Your writing" onRetry={onRetry} testid="advisor-visibility-writing-unreadable" />
        ) : !writing.published ? (
          <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="advisor-visibility-writing-none">
            No piece is published yet. <Link to={WRITE_HREF} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300">Write a piece</Link>
          </p>
        ) : (
          <ul className="divide-y divide-axal-hairline">
            {(writing.top || []).map((a) => (
              <li key={a.slug} className="flex items-baseline justify-between gap-4 py-2" data-testid="advisor-visibility-article">
                <span className="min-w-0 break-words text-[12.5px] font-semibold">{a.title}</span>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums text-axal-muted dark:text-gray-300">{plural(Number(a.opens) || 0, 'open', 'opens')}</span>
              </li>
            ))}
            {writing.others?.count > 0 ? (
              <li className="flex items-baseline justify-between gap-4 py-2 text-axal-faint" data-testid="advisor-visibility-article-others">
                <span className="text-[12.5px]">{plural(writing.others.count, 'other piece', 'other pieces')}</span>
                <span className="shrink-0 text-[12px] tabular-nums">{plural(writing.others.opens, 'open', 'opens')}</span>
              </li>
            ) : null}
          </ul>
        )}
        {writing !== null ? <p className="m-0 mt-2 text-[11px] leading-snug text-axal-faint">{writing.opens_note} {writing.requests_note}</p> : null}
      </Card>

      <Card className="p-4" data-testid="advisor-visibility-surfaces">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-sm font-extrabold tracking-tight">Booking links</span>
          <span className="text-[11px] text-axal-faint">Last {days} days</span>
        </div>
        {surfaces !== null && requestsLine(data?.requests, days) ? (
          <p className="m-0 mb-2 text-[11.5px] text-axal-faint" data-testid="advisor-visibility-requests-total">{requestsLine(data.requests, days)}</p>
        ) : null}
        {surfaces === null ? (
          <BlockUnreadable what="Your booking links" onRetry={onRetry} testid="advisor-visibility-surfaces-unreadable" />
        ) : (
          <ul className="divide-y divide-axal-hairline">
            {surfaces.map((s) => (
              <li key={s.key} className="flex items-start justify-between gap-4 py-2.5" data-testid={`advisor-visibility-surface-${s.key}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-[12.5px] font-semibold">{s.name}</span>
                    {s.kind === 'booking_link' && s.is_active === false ? <Pill tone="neutral">Paused</Pill> : null}
                    {s.audience ? <span className="text-[11px] text-axal-faint">{s.audience}</span> : null}
                  </div>
                  {statusLine(s.by_status) ? <div className="mt-0.5 text-[11px] text-axal-faint">{statusLine(s.by_status)}</div> : null}
                  {s.note ? <div className="mt-0.5 text-[11px] text-axal-faint">{s.note}</div> : null}
                </div>
                <div className="shrink-0 text-right text-[12px] font-semibold tabular-nums text-axal-muted dark:text-gray-300">
                  {s.requests != null && Number.isFinite(Number(s.requests)) ? `${s.requests} ${Number(s.requests) === 1 ? 'request' : 'requests'}` : <Unrecorded />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {surfaces !== null && more ? (
          <MoreRows line={more.line} onMore={more.more} busy={more.moreBusy} error={more.moreError} testid="advisor-visibility-more" />
        ) : null}
        {unlinked === null ? (
          <div className="mt-3"><BlockUnreadable what="Your session types" onRetry={onRetry} testid="advisor-visibility-unlinked-unreadable" /></div>
        ) : unlinked && unlinked.items.length ? (
          <ul className="mt-2 divide-y divide-axal-hairline border-t border-axal-hairline" data-testid="advisor-visibility-unlinked">
            {unlinked.items.map((t) => (
              <li key={t.uid} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="advisor-visibility-unlinked-row">
                <span className="text-[12.5px] font-semibold">{t.name} <span className="font-normal text-axal-faint">· No booking link yet</span></span>
                <Link to={ADD_BOOKING_LINK_HREF} className="text-[12px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300">Add booking link</Link>
              </li>
            ))}
            {unlinked.more ? <li className="py-2 text-[11.5px] text-axal-faint">More session types have no booking link. See them under Practice › Sessions.</li> : null}
          </ul>
        ) : null}
      </Card>
    </>
  );
}

const isLink = (s) => s.kind !== 'no_link';

// A later page whose links could not be read is a failed "Show more", never a
// page of no links: the rows already read stay and the button says so.
// D4827: `days` is the window chosen on the board (7, 30 or 90; 30 by default).
export const readVisibilityPage = (days = VISIBILITY_DAYS) => async (page) => {
  if (!page?.offset) return api.getMyAdvisorVisibility(days);
  const res = await api.getMyAdvisorVisibility(days, page);
  if (!Array.isArray(res?.surfaces)) throw new Error('The next links could not be read. Try again.');
  return res;
};

export default function VisibilityZone() {
  const [days, setDays] = useState(VISIBILITY_DAYS);
  const reader = useCallback((page) => readVisibilityPage(days)(page), [days]);
  const list = usePagedList(reader, {
    key: 'surfaces', pageKey: 'links', rowKey: 'key', counts: isLink, errorText: 'Your visibility could not be read.',
    moreErrorText: 'The next links could not be read. Try again.',
  });
  const state = { loading: list.loading, error: list.error };
  const load = list.load;
  useEffect(() => { load(); }, [load]);
  // The latest answer, with every link read so far. A first page whose links
  // failed keeps `surfaces: null`, so the view draws that block as unreadable.
  const data = list.res ? { ...list.res, surfaces: Array.isArray(list.res.surfaces) ? list.rows : null } : null;

  return (
    <div className="space-y-4" data-testid="advisor-expertise-visibility">
      <ZoneHeading
        title="Visibility"
        blurb="What has actually been recorded about your work being seen and booked."
        action={(
          <div role="radiogroup" aria-label="Window" className="flex gap-1" data-testid="advisor-visibility-window">
            {VISIBILITY_WINDOWS.map((d) => (
              <button
                key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
                data-testid={`advisor-visibility-window-${d}`}
                className={`min-h-[32px] rounded-full border px-3 text-[12px] font-semibold ${days === d
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300'}`}
              >
                {d} days
              </button>
            ))}
          </div>
        )}
      />
      <ZoneBody loading={state.loading} error={state.error} onRetry={load} isEmpty={false}>
        <VisibilityView data={data} onRetry={load} more={list} />
        <StatedLimit title="Nothing is added up">
          Opens and booking requests come from different records, so they are never one reach figure,
          and no rate is worked out over bookings that name no link.
        </StatedLimit>
      </ZoneBody>
    </div>
  );
}
