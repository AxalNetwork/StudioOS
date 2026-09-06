import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill, Unrecorded,
  StatCard, Section, Field, SaveNote, NotComputable,
  NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';

/**
 * Delivery · Capacity — `/delivery/capacity`.
 *
 * THE ZONE'S REAL SUBJECT SURVIVES; THE CANVAS'S THRESHOLD DOES NOT.
 *
 * The card this zone used to render named the consequential row exactly right:
 * "an over-committed person who also holds a granted seat inside a client's
 * systems — a trust exposure, not only a throughput one, because the grant
 * assumes attention the calendar no longer has." Migration 208 gave that
 * sentence two stores, `engagement_seats` and `engagement_hours`, and this page
 * reads both.
 *
 * WHAT IT STILL CANNOT SAY IS "OVER-COMMITTED", and the reason is flat: nothing
 * anywhere records the firm's capacity cap. `engagement_hours` records hours
 * and stops. The capacity canvas draws its bars against a hardcoded `CAP_H =
 * 40`; adopting that number here would invent the firm's cap and then present
 * the result as a finding, on a page whose whole purpose is to be trusted about
 * exposure. So there is no cap bar, no red row and no "over" anywhere — the
 * worker returns `cap_hours: null` with the reason and this page prints it.
 *
 * WHAT REMAINS IS TRUE AND IS STILL THE POINT: this person holds N live seats
 * inside client systems and logged H hours this period. A reader who knows
 * their own firm's cap can draw the conclusion the canvas wanted; this page
 * simply will not draw it for them from a number nobody set.
 *
 * A REVOKED SEAT IS STILL SHOWN, struck through. `revoked_at` is a column
 * rather than a delete precisely so the record that access once existed cannot
 * quietly disappear.
 *
 * A SEAT CAN ONLY BE HELD BY THIS FIRM'S OWN PEOPLE. 208's
 * `engagement_seats.holder_user_id` references `users(id)` with no partner
 * constraint, so the schema alone would let a firm enter any account in the
 * product into a register of who has access inside a client's systems. The
 * worker closes that; this page only ever offers the firm's own roster.
 */

export default function PartnerCapacityZone() {
  const [state, setState] = useState({
    loading: true, error: '', data: null, people: null, engagements: null,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [granting, setGranting] = useState(false);
  const [grant, setGrant] = useState({ engagement_id: '', holder_user_id: '', scope: '' });
  const [hours, setHours] = useState({ engagement_id: '', person_user_id: '', hours: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [cap, ppl, health] = await Promise.all([
        api.getPartnerCapacity(),
        api.listPartnerPeople(),
        api.getPartnerDeliveryHealth(),
      ]);
      setState({
        loading: false,
        error: '',
        data: cap || {},
        people: Array.isArray(ppl?.items) ? ppl.items : [],
        engagements: Array.isArray(health?.items) ? health.items : [],
      });
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || 'The capacity record did not load.',
        data: null, people: null, engagements: null,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (fn, ok, scope) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: ok, scope });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e?.message || 'That did not save.', scope });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const d = state.data;
  const people = Array.isArray(d?.people) ? d.people : [];
  const seats = Array.isArray(d?.seats) ? d.seats : [];
  const roster = state.people || [];
  const engagements = state.engagements || [];
  const liveSeats = seats.filter((s) => !s.revoked_at);

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Capacity" />
        <NoPartnerProfile />
      </>
    );
  }

  return (
    <ZoneBody
      actions={partnerZoneActions('delivery/capacity', { view: { header: ['Person', 'Live seats'], rows: people, cells: (p) => [p.name, p.live_seats] } })}
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={people.length === 0 && seats.length === 0}
      empty={(
        <NothingYet
          title="No seat granted and no hours logged"
          body={
            'This zone is people rather than projects: who is committed to what, '
            + 'and who holds access inside a client’s systems. Grant a seat or '
            + 'log a period’s hours and the roster starts filling in.'
          }
          action={engagements.length > 0
            ? <button type="button" className={buttonClass} onClick={() => setGranting(true)}>Grant a seat</button>
            : <Link to="/pipeline/proposals" className="text-[12.5px] font-semibold text-amber-700 underline">Open proposals</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="People, seats and hours"
          blurb={
            'Who holds access inside a client’s systems, and what they logged '
            + 'this period. There is no cap to be over — see below — so nothing '
            + 'here is marked over-committed.'
          }
          action={engagements.length > 0 && (
            <button type="button" className={ghostButtonClass} onClick={() => setGranting((v) => !v)}>
              {granting ? 'Cancel' : 'Grant a seat'}
            </button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="People" value={people.length} hint={`this period · ${d?.period || '—'}`} />
          <StatCard label="Live seats" value={liveSeats.length} hint="granted access, not revoked" />
          <StatCard
            label="Revoked"
            value={seats.length - liveSeats.length}
            hint="kept on the record on purpose"
          />
          {/* NOT a utilisation bar. There is no cap, so there is no percentage
              and no red. The stat says what it is instead of implying one. */}
          <StatCard label="Capacity cap" value="—" hint="not recorded anywhere — see below" />
        </div>

        {d?.cap_note && (
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.cap_note}</p>
        )}

        {granting && (
          <div className="rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Engagement">
                <select className={inputClass} value={grant.engagement_id}
                  onChange={(e) => setGrant({ ...grant, engagement_id: e.target.value })}>
                  <option value="">Choose one</option>
                  {engagements.map((e) => (
                    <option key={e.engagement_id} value={e.engagement_id}>
                      {e.founder_name || e.need_title || e.engagement_uid}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Who holds it" hint="Your firm's own people only — a seat register naming anyone else would be false.">
                <select className={inputClass} value={grant.holder_user_id}
                  onChange={(e) => setGrant({ ...grant, holder_user_id: e.target.value })}>
                  <option value="">Choose one</option>
                  {roster.map((p) => (
                    <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>
                  ))}
                </select>
              </Field>
              <Field label="Scope" hint="In the client's words — “Board, KPIs”, “prod read-only”.">
                <input className={inputClass} value={grant.scope} maxLength={400}
                  onChange={(e) => setGrant({ ...grant, scope: e.target.value })} />
              </Field>
            </div>
            <button
              type="button" className={`${buttonClass} mt-3`}
              disabled={busy || !grant.engagement_id || !grant.holder_user_id}
              onClick={async () => {
                await run(
                  () => api.grantPartnerSeat(grant.engagement_id, {
                    holder_user_id: Number(grant.holder_user_id), scope: grant.scope,
                  }),
                  'Seat recorded.', 'grant',
                );
                setGrant({ engagement_id: '', holder_user_id: '', scope: '' });
                setGranting(false);
              }}
            >
              Record the seat
            </button>
            {roster.length === 0 && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-3">
                No one is attached to this firm yet, so there is nobody to hold a
                seat. That is an account link an admin makes, not something this
                page can do.
              </p>
            )}
            <SaveNote note={note?.scope === 'grant' ? note : null} />
          </div>
        )}

        <Section title={`People · ${d?.period || ''}`}>
          {people.length === 0 ? (
            <p className="text-[12.5px] text-axal-ink-2">Nobody holds a seat or has logged hours this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                  <tr>
                    <th className="pb-1 pr-3">Person</th>
                    <th className="pb-1 pr-3">Hours this period</th>
                    <th className="pb-1 pr-3">Live seats</th>
                    <th className="pb-1 pr-3">Engagements</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.user_id} className="border-t border-axal-hairline">
                      <td className="py-2 pr-3 font-semibold">{p.name || <Unrecorded>Unnamed</Unrecorded>}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {/* Null, not zero. Nobody logging hours for a person is
                            not the same as that person doing no work. And no
                            bar: there is no cap to draw one against. */}
                        {p.hours === null
                          ? <NotComputable why={p.hours_note}>Not logged</NotComputable>
                          : `${p.hours}h`}
                      </td>
                      <td className="py-2 pr-3">
                        {p.live_seats > 0
                          ? <Pill tone={p.live_seats > 1 ? 'warn' : 'info'}>{p.live_seats}</Pill>
                          : <span className="text-axal-ink-3">none</span>}
                        {p.revoked_seats > 0 && (
                          <span className="ml-1.5 text-[11px] text-axal-ink-3">
                            +{p.revoked_seats} revoked
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{p.engagement_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
              Log hours for {d?.period}
            </div>
            <div className="mt-2 grid gap-3 md:grid-cols-4">
              <Field label="Engagement">
                <select className={inputClass} value={hours.engagement_id}
                  onChange={(e) => setHours({ ...hours, engagement_id: e.target.value })}>
                  <option value="">Choose one</option>
                  {engagements.map((e) => (
                    <option key={e.engagement_id} value={e.engagement_id}>
                      {e.founder_name || e.need_title || e.engagement_uid}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Person">
                <select className={inputClass} value={hours.person_user_id}
                  onChange={(e) => setHours({ ...hours, person_user_id: e.target.value })}>
                  <option value="">Choose one</option>
                  {roster.map((p) => (
                    <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>
                  ))}
                </select>
              </Field>
              <Field label="Hours">
                <input className={inputClass} value={hours.hours} inputMode="decimal" placeholder="e.g. 32"
                  onChange={(e) => setHours({ ...hours, hours: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <button
                  type="button" className={buttonClass}
                  disabled={busy || !hours.engagement_id || !hours.person_user_id || hours.hours.trim() === ''}
                  onClick={async () => {
                    await run(
                      () => api.savePartnerHours(
                        hours.engagement_id, hours.person_user_id, d.period,
                        { hours: Number(hours.hours) },
                      ),
                      'Hours logged.', 'hours',
                    );
                    setHours({ engagement_id: '', person_user_id: '', hours: '' });
                  }}
                >
                  Log
                </button>
              </div>
            </div>
            <SaveNote note={note?.scope === 'hours' ? note : null} />
          </div>
        </Section>

        <Section title="Seats inside client systems">
          {seats.length === 0 ? (
            <p className="text-[12.5px] text-axal-ink-2">No seat has been recorded.</p>
          ) : (
            <div>
              {seats.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 first:border-t-0 text-[12.5px]">
                  <span className={s.revoked_at ? 'text-axal-ink-3 line-through' : 'font-semibold'}>
                    {s.holder_name || <Unrecorded>Unnamed</Unrecorded>}
                  </span>
                  <span className="text-axal-ink-3">at</span>
                  <span className={s.revoked_at ? 'text-axal-ink-3 line-through' : ''}>
                    {s.founder_name || s.need_title || s.engagement_uid}
                  </span>
                  {s.scope && <Pill tone="neutral">{s.scope}</Pill>}
                  <span className="text-[11px] text-axal-ink-3">
                    granted {formatDay(s.granted_at)}
                    {s.days_held != null && ` · ${s.days_held}d`}
                  </span>
                  {s.revoked_at
                    ? <Pill tone="neutral">Revoked {formatDay(s.revoked_at)}</Pill>
                    : (
                      <button
                        type="button" className={`${ghostButtonClass} ml-auto`} disabled={busy}
                        title="Records the revocation. The seat stays on this page struck through — the fact that access existed is worth keeping."
                        onClick={() => run(() => api.revokePartnerSeat(s.id), 'Seat revoked.', `seat:${s.id}`)}
                      >
                        Revoke
                      </button>
                    )}
                </div>
              ))}
            </div>
          )}
          <SaveNote note={String(note?.scope || '').startsWith('seat:') ? note : null} />
        </Section>

        <StatedLimit title="Why nothing here is marked over-committed">
          <p>
            <strong>No capacity cap is recorded anywhere in this product.</strong>{' '}
            Hours are real and are shown. A threshold to be over is not: nothing
            stores what this firm considers a full period for a person. The
            canvas draws its bars against a hardcoded 40 — adopting that number
            would be inventing your cap and then presenting the result to you as
            a finding, on the one page whose job is to be trusted about exposure.
          </p>
          <p className="mt-2">
            <strong>What is here is still the point.</strong> A person holding
            several live seats inside client systems while logging a heavy period
            is the row the zone exists for — and both halves of it are true and
            visible above. Drawing the conclusion needs your cap, which you have
            and this product does not.
          </p>
          <p className="mt-2">
            <strong>Hours are what somebody logged.</strong> No timesheet,
            calendar or ticket system feeds them, so a person with no hours reads
            as “not logged” rather than as idle. And a revoked seat stays on this
            page struck through: access that once existed is a fact worth
            keeping, which is why revoking is a state rather than a delete.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
