import React, { useEffect } from 'react';
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
 */
export const VISIBILITY_DAYS = 30;

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

export function VisibilityView({ data, onRetry, more = null }) {
  const surfaces = Array.isArray(data?.surfaces) ? orderSurfaces(data.surfaces) : null;
  const writing = data?.writing || null;
  const days = data?.window?.days || VISIBILITY_DAYS;
  return (
    <>
      <Card className="p-4" data-testid="advisor-visibility-surfaces">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-sm font-extrabold tracking-tight">Booking requests, by link</span>
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
                    <span className="text-[12.5px] font-semibold">{s.name}</span>
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
      </Card>

      <Card className="p-4" data-testid="advisor-visibility-writing">
        <div className="mb-3 text-sm font-extrabold tracking-tight">Your writing</div>
        {writing === null ? (
          <BlockUnreadable what="Your writing" onRetry={onRetry} testid="advisor-visibility-writing-unreadable" />
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div>
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Published</div>
              <div className="mt-1 text-base font-extrabold tabular-nums">{writing.published}</div>
            </div>
            <div>
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Opens here</div>
              <div className="mt-1 text-base font-extrabold tabular-nums">{writing.opens}</div>
              <div className="mt-1 text-[10px] leading-snug text-axal-faint">{writing.opens_note}</div>
            </div>
            <div>
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Requests from a piece</div>
              <div className="mt-1.5"><Unrecorded /></div>
              <div className="mt-1 text-[10px] leading-snug text-axal-faint">{writing.requests_note}</div>
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Card className="px-3 py-2.5" data-testid="advisor-visibility-views">
          <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Profile views</div>
          <div className="mt-1.5"><Unrecorded /></div>
          <div className="mt-1 text-[10px] leading-snug text-axal-faint">{data?.views_note}</div>
        </Card>
        <Card className="px-3 py-2.5" data-testid="advisor-visibility-engagements">
          <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Engagements by surface</div>
          <div className="mt-1.5"><Unrecorded /></div>
          <div className="mt-1 text-[10px] leading-snug text-axal-faint">{data?.engagements_note}</div>
        </Card>
      </div>
    </>
  );
}

const isLink = (s) => s.kind !== 'no_link';

// A later page whose links could not be read is a failed "Show more", never a
// page of no links: the rows already read stay and the button says so.
const readVisibilityPage = async (page) => {
  if (!page?.offset) return api.getMyAdvisorVisibility(VISIBILITY_DAYS);
  const res = await api.getMyAdvisorVisibility(VISIBILITY_DAYS, page);
  if (!Array.isArray(res?.surfaces)) throw new Error('The next links could not be read. Try again.');
  return res;
};

export default function VisibilityZone() {
  const list = usePagedList(readVisibilityPage, {
    key: 'surfaces', pageKey: 'links', rowKey: 'key', counts: isLink, errorText: 'Your visibility could not be read.',
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
        title="Where you appear"
        blurb="Requests through each of your booking links, and opens of your writing here on Axal. Only what is recorded."
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
