import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  NothingYet, Pill, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass, money,
} from '../expertise/kit';
import { bookingView, formatDateTime } from '../advisory/kit';
import { classifyBooking } from './opportunityLog';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';

/**
 * Practice · Opportunities — canvas PR1, `/practice/opportunities`.
 *
 * WHAT REPLACED WHAT. This route rendered the legacy five-tab Advisory
 * workspace `embedded`: a pending-request queue plus a slot editor. Both were
 * honest and neither was the artboard, which asks for "every request that has
 * ever arrived, what you did about it, and the terms you sent when you said
 * yes" — a decision LOG, not an inbox.
 *
 * NO NEW ENDPOINT. `GET /advisors/me/bookings` already returns every booking
 * this advisor has ever received with its status, its `cancel_reason`, the
 * counterparty and the slot window; `GET /advisors/me/services` already returns
 * the service definitions. The log, the queue, the rates and the expiry
 * derivation are all compositions of two reads that were already being made.
 *
 * EXPIRY IS DERIVED, AND IT IS THE POINT OF THE ARTBOARD. Nothing stores an
 * "expired" status. A booking still `pending` after its slot has STARTED is one
 * the advisor never answered, and the artboard's sharpest line is about exactly
 * that — "a decline preserves the referral, silence spends it". So the state is
 * computed from two stored facts rather than invented or omitted.
 *
 * TWO CANCELLATIONS ARE NOT DECLINES, and counting them as such would make the
 * accept rate wrong. `routes/advisors.ts` writes `cancel_reason` itself in two
 * places — `'slot_cancelled'` when the advisor withdraws a whole slot, and
 * `'capacity_race'` when two people book the last seat. Neither is an answer to
 * a request. They are shown as withdrawn and excluded from every rate.
 */

const VIEW_LABEL = {
  awaiting: 'Awaiting a decision',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired unanswered',
  withdrawn: 'Withdrawn by you',
};
const VIEW_TONE = {
  awaiting: 'warn', accepted: 'ok', declined: 'neutral', expired: 'danger', withdrawn: 'neutral',
};
const KIND_LABEL = { fixed: 'Fixed', package: 'Package', retainer: 'Retainer' };

export default function OpportunitiesZone() {
  // 'all', NOT the first chip. The chips narrow the decision LOG below, and
  // `history` is by definition everything past the point of decision — so
  // opening on 'awaiting' renders the artboard's headline instrument
  // ("Decision history · Only here") as an empty table with an explanation
  // under a queue that already says the same thing. The log is what this zone
  // is for; the queue above it is unfiltered either way.
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ loading: true, error: '', bookings: [], services: [], servicesUnavailable: false });
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const bookings = await api.listMyAdvisorBookings();
      // The templates are a SECOND source and must not take the page down with
      // them: an advisor with no service definitions still has a decision log.
      const services = await api.listMyAdvisorServices().catch(() => null);
      setState({
        loading: false, error: '',
        bookings: bookings?.items || [],
        services: services?.items || [],
        servicesUnavailable: services === null,
      });
    } catch (error) {
      setState({
        loading: false, error: error?.message || 'The request log could not be read.',
        bookings: [], services: [], servicesUnavailable: true,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // `Date.now()` once per render rather than per row, so every row on one paint
  // is classified against the same instant.
  const now = Date.now();
  const rows = useMemo(() => state.bookings.map((b) => {
    // One adapt per row, then classify from the ADAPTED view — `startsAt`
    // comes from the shared slot/booking adapter, never re-read here.
    const view = bookingView(b);
    return { ...view, raw: b, bucket: classifyBooking(view, now) };
  }), [state.bookings, now]);

  const counts = useMemo(() => {
    const out = { awaiting: 0, accepted: 0, declined: 0, expired: 0, withdrawn: 0 };
    for (const r of rows) out[r.bucket] += 1;
    return out;
  }, [rows]);
  // DECIDED EXCLUDES the withdrawn and the never-answered. An accept rate over
  // requests the advisor never answered would report silence as a refusal.
  const decided = counts.accepted + counts.declined;
  const acceptRate = decided > 0 ? Math.round((counts.accepted / decided) * 100) : null;

  // The queue the artboard asks for: "sorted by what expires first, not what
  // arrived first". A row whose slot is gone cannot expire, so it sorts last.
  const queue = useMemo(() => rows.filter((r) => r.bucket === 'awaiting').sort((a, b) => {
    const x = a.startsAt ? Date.parse(a.startsAt) : Infinity;
    const y = b.startsAt ? Date.parse(b.startsAt) : Infinity;
    return x - y;
  }), [rows]);
  const soon = queue.filter((r) => r.startsAt && Date.parse(r.startsAt) - now < 36e5 * 24).length;

  const history = useMemo(
    () => rows.filter((r) => r.bucket !== 'awaiting')
      .sort((a, b) => String(b.raw.updated_at || '').localeCompare(String(a.raw.updated_at || ''))),
    [rows],
  );
  const visible = filter === 'all' ? history : history.filter((r) => r.bucket === filter);

  const decide = async (row, action) => {
    setBusy(row.raw.id);
    try {
      if (action === 'accept') await api.confirmAdvisorBooking(row.raw.id);
      else await api.cancelAdvisorBooking(row.raw.id, reason.trim() || 'Declined by advisor');
      setDeclining(null); setReason('');
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'That decision could not be recorded.' }));
    } finally { setBusy(''); }
  };

  const exportRows = filter === 'awaiting' ? queue : visible;
  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      isEmpty={!state.loading && !state.error && rows.length === 0}
      onRetry={load}
      empty={<NothingYet
        title="No request has ever arrived"
        body="This log fills as founders book your published office-hour slots. It is empty because nothing has been requested, not because anything was lost — and with no availability published there is nothing to request."
      />}
    >
      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('practice/opportunities', { value: filter, onChange: setFilter })}
        actions={advisorZoneActions('practice/opportunities', {
          view: {
            header: ['Requester', 'Decision', 'When', 'Reason', 'Asked for'],
            rows: exportRows,
            cells: (r) => [
              r.counterpartyName, VIEW_LABEL[r.bucket], r.raw.updated_at,
              r.raw.cancel_reason, r.raw.topic || r.note,
            ],
          },
        })}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Awaiting you" value={counts.awaiting}
          note={counts.awaiting === 0 ? 'Nothing is waiting on an answer'
            : soon === 0 ? 'None reaches its slot within a day'
              : `${soon} ${soon === 1 ? 'reaches its slot' : 'reach their slots'} within a day`} />
        <Stat label="Accept rate" value={acceptRate == null ? <Unrecorded>Not recorded</Unrecorded> : `${acceptRate}%`}
          note={decided === 0 ? 'No request has been answered yet' : `${counts.accepted} of ${decided} answered`} />
        {/* NOT COMPUTED, AND THE TILE SAYS WHY RATHER THAN SHOWING A NUMBER
            FROM THE WRONG COLUMN. `advisor_bookings` has no decided_at:
            `updated_at` is a LAST-TOUCHED stamp, and `routes/advisors.ts:1287`
            moves it again whenever Sessions edits a booking's amount. A median
            off that column would report the billing edit, not the decision. */}
        <Stat label="Median decision" value={<Unrecorded>Not recorded</Unrecorded>}
          note="No decision timestamp is stored" />
        <Stat label="Expired unanswered" value={counts.expired}
          note={counts.expired === 0 ? 'Every request got an answer' : 'Slot passed with no answer given'} />
      </div>

      <Card padding="md" className="mt-3">
        <ZoneHeading
          title="Awaiting a decision"
          blurb="Sorted by what reaches its slot first, not by what arrived first."
        />
        {queue.length === 0
          ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">Nothing is waiting on you. Requests appear here while they are still answerable — once a slot has started, an unanswered request moves to the log below as expired.</p>
          : <ul className="space-y-2">{queue.map((r) => (
            <li key={r.raw.id} data-testid={`row-pr1-awaiting-${r.raw.id}`}
              className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[13px] font-extrabold tracking-tight">{r.counterpartyName || 'Requester not recorded'}</strong>
                    <Pill tone="neutral">Founder</Pill>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-axal-ink-2">{r.raw.topic || r.note || 'No question was written with the request.'}</p>
                  <p className="mt-1 text-[11px] text-axal-ink-3">
                    Arrived {formatDateTime(r.raw.created_at)} · slot {r.startsAt ? formatDateTime(r.startsAt) : 'not recorded'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className={buttonClass} disabled={busy === r.raw.id}
                    onClick={() => decide(r, 'accept')}>Accept</button>
                  <button type="button" className={ghostButtonClass} disabled={busy === r.raw.id}
                    onClick={() => { setDeclining(declining === r.raw.id ? null : r.raw.id); setReason(''); }}>Decline</button>
                </div>
              </div>
              {declining === r.raw.id && (
                <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
                  <label className="block text-[11px] font-extrabold uppercase tracking-[.05em] text-axal-ink-3">
                    Why, in your words
                    <input className={`${inputClass} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="Wanted implementation, not advice" />
                  </label>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">
                    The reason is stored on the request and shown in the log below. A decline with a
                    reason keeps the relationship; the artboard&rsquo;s point is that saying nothing does not.
                  </p>
                  <button type="button" className={`${buttonClass} mt-2`} disabled={busy === r.raw.id}
                    onClick={() => decide(r, 'decline')}>Record the decline</button>
                </div>
              )}
            </li>
          ))}</ul>}
      </Card>

      <Card padding="md" className="mt-3">
        <ZoneHeading
          title="Decision history"
          blurb={`${history.length} request${history.length === 1 ? '' : 's'} past the point of decision${filter === 'all' || filter === 'awaiting' ? '' : ` · showing ${visible.length}`}`}
        />
        {visible.length === 0
          ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{filter === 'awaiting'
            ? 'Requests still awaiting a decision are in the queue above. This log holds only what is past the point of decision, which is why selecting that view empties it.'
            : 'No request sits under this view.'}</p>
          : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[12px]">
            <thead><tr className="text-left text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">
              <th className="pb-2">Requester</th><th className="pb-2">Decision</th><th className="pb-2">When</th><th className="pb-2">Reason</th>
            </tr></thead>
            <tbody>{visible.map((r) => (
              <tr key={r.raw.id} data-testid={`row-pr1-history-${r.raw.id}`} className="border-t border-axal-hairline dark:border-gray-700">
                <td className="py-2 pr-3 font-semibold">{r.counterpartyName || 'Requester not recorded'}</td>
                <td className="py-2 pr-3"><Pill tone={VIEW_TONE[r.bucket]}>{VIEW_LABEL[r.bucket]}</Pill>
                  {r.raw.status === 'no_show' && <span className="mt-1 block text-[10.5px] text-axal-ink-3">Accepted, then recorded a no-show</span>}
                </td>
                <td className="py-2 pr-3 text-axal-ink-2">{r.raw.updated_at ? formatDateTime(r.raw.updated_at) : <Unrecorded />}</td>
                <td className="py-2 text-axal-ink-2">{
                  r.bucket === 'expired' ? 'Never answered. The slot passed.'
                    : r.bucket === 'withdrawn' ? (r.raw.cancel_reason === 'capacity_race' ? 'The last seat went to someone else.' : 'You withdrew the whole slot.')
                      : r.raw.cancel_reason || <Unrecorded>No reason recorded</Unrecorded>
                }</td>
              </tr>
            ))}</tbody>
          </table></div>}
      </Card>

      <Card padding="md" className="mt-3">
        <ZoneHeading
          title="Terms templates"
          blurb="Your stored service definitions — what you offer, and on what terms."
        />
        {state.servicesUnavailable
          ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">Your service definitions could not be read. That is not a claim that you have none.</p>
          : state.services.length === 0
            ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">No service is defined yet. Expertise &rsaquo; Services is where they are written, and they appear here once they are.</p>
            : <ul className="space-y-2">{state.services.map((s) => (
              <li key={s.uid || s.id} data-testid={`row-pr1-template-${s.uid || s.id}`}
                className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[12.5px] font-extrabold tracking-tight">{s.title}</strong>
                  <Pill tone="neutral">{KIND_LABEL[s.kind] || s.kind}</Pill>
                  <span className="ml-auto text-[12px] font-semibold tabular-nums">{s.price_cents == null ? <Unrecorded>Price not recorded</Unrecorded> : money(s.price_cents, s.currency)}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-axal-ink-2">{s.scope || 'No scope is written for this service.'}</p>
                {s.duration_note && <p className="mt-1 text-[11px] text-axal-ink-3">{s.duration_note}</p>}
              </li>
            ))}</ul>}
      </Card>

      {/* The artboard's band, "Proposal · engagement". It drafts the terms; it
          does not send them — see the limits below. */}
      <ZoneDraft
        surface="practice/opportunities"
        label="Proposal · engagement"
        accept="Accept draft"
        run="Draft the terms"
        foot="Drafted from the request and your own stored services. Nothing is sent."
        empty="A set of terms for a waiting request, written against one of your stored services — the scope you already wrote, the price you already set, and what the request actually asked for."
        nothingToDraft="No request is waiting on a decision, so there are no terms to draft."
      />

      <StatedLimit title="What this log cannot say">
        <p>
          <strong>Every requester is a founder.</strong> `advisor_bookings` records the counterparty as
          `founder_user_id` and there is no investor path to a booking, so the artboard&rsquo;s
          investor-side request — an expert call bought by a fund — has no row to be. The kind is shown
          rather than hidden, because it is the only kind there is.
        </p>
        <p className="mt-2">
          <strong>Nothing records where a request came from.</strong> No column carries a referral or a
          cohort, so &ldquo;Referred by&rdquo; and &ldquo;From the Lab cohort&rdquo; are drawn on the artboard and cannot be
          drawn here. Accepting also attaches no terms: <em>Accept</em> confirms the booking, and the
          template you would have sent stays a template.
        </p>
        <p className="mt-2">
          <strong>A template carries no usage count.</strong> The artboard marks each one &ldquo;used 6&times;&rdquo;;
          no booking references a service, so there is nothing to count. Times are the slot&rsquo;s, not the
          request&rsquo;s: a request has no deadline of its own, so it expires when its slot starts.
        </p>
      </StatedLimit>
    </ZoneBody>
  );
}

function Stat({ label, value, note }) {
  return (
    <Card padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">{note}</div>
    </Card>
  );
}
