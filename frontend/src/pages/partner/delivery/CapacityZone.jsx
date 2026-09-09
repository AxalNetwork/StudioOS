import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill,
  // `StatCard` left with the four tiles it drew. The strip is the artboard's
  // own composition now, and `CapTile` can draw an absence as the shared
  // `NotRecorded` chip rather than as an em dash a reader reads as zero.
  Section, Field, SaveNote,
  UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Delivery · Capacity — `/delivery/capacity`.
 *
 * THE ZONE'S REAL SUBJECT SURVIVES, AND THE CANVAS'S THRESHOLD STILL DOES NOT.
 *
 * The card this zone used to render named the consequential row exactly right:
 * "an over-committed person who also holds a granted seat inside a client's
 * systems — a trust exposure, not only a throughput one, because the grant
 * assumes attention the calendar no longer has." Migration 208 gave that
 * sentence two stores, `engagement_seats` and `engagement_hours`, and this page
 * reads both.
 *
 * WHAT CHANGED, AND WHAT DID NOT. This page refused to say "over-committed"
 * because nothing recorded a cap, and it was right to: the `pd3` artboard draws
 * its bars against a hardcoded `CAP_H = 40`, and adopting that number would
 * have invented the firm's cap and then presented the result as a finding. That
 * refusal still stands against the canvas's forty. What it was never a reason
 * for is refusing a cap THE FIRM ITSELF STATES — the same class of fact as the
 * budget floor in `partner_fit_rules`, asserted by the people it describes and
 * quotable back to them. Migration 230 gives them somewhere to put an answer;
 * it does not put one there, and a firm that has not answered still reads
 * `Over-committed` as `Not recorded` with the original reason under it.
 *
 * THE WEEK IS THREE COLUMNS, NOT ONE. `engagement_hours.engagement_id` is NOT
 * NULL, so the client book cannot hold admin, recruiting or the losing
 * proposal — and a total assembled from client rows alone under-reports every
 * person by exactly the part of the week nobody is billed for, in the
 * reassuring direction. Migration 231 holds the third column; a person whose
 * internal hours nobody stated shows a total marked as a floor rather than a
 * measurement.
 *
 * PROJECT AND SEAT HOURS SPLIT BY WHOSE SEAT IT IS. An hour is a seat hour when
 * the person who logged it holds a seat on that engagement — their own grant,
 * not the engagement's mode. Two people can work one embedded engagement while
 * only one of them is inside the client's systems.
 *
 * A REVOKED SEAT IS STILL SHOWN, struck through, and still claims the hours
 * logged under it. `revoked_at` is a column rather than a delete precisely so
 * the record that access once existed cannot quietly disappear.
 *
 * A SEAT CAN ONLY BE HELD BY THIS FIRM'S OWN PEOPLE. 208's
 * `engagement_seats.holder_user_id` references `users(id)` with no partner
 * constraint, so the schema alone would let a firm enter any account in the
 * product into a register of who has access inside a client's systems. The
 * worker closes that; this page only ever offers the firm's own roster.
 */

/**
 * The period label one month on, in the `YYYY-MM` shape `currentPeriod()` on
 * the worker produces. `Next week` reads it; nothing writes it, so a period
 * nobody has logged against comes back empty and says so.
 */
function nextPeriod(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The strip tile, in the anatomy the artboards share. */
function CapTile({ label, value, note, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/** First names only, the way the artboard's `Over-committed` note reads. */
function firstNames(people) {
  return people.map((p) => String(p.name || '').split(' ')[0]).filter(Boolean).join(', ');
}

export default function PartnerCapacityZone() {
  const [state, setState] = useState({
    loading: true, error: '', data: null, people: null, engagements: null,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [granting, setGranting] = useState(false);
  const [grant, setGrant] = useState({ engagement_id: '', holder_user_id: '', scope: '' });
  const [hours, setHours] = useState({ engagement_id: '', person_user_id: '', hours: '' });
  const [cap, setCap] = useState({ person_user_id: '', weekly_hours: '', note: '' });
  const [internal, setInternal] = useState({ person_user_id: '', hours: '' });
  const [view, setView] = useState('this_week');

  // ══ TWO OF THE `pd3` CHIPS CHANGE THE PERIOD, NOT THE ROWS ═══════════════
  // Hours are logged per period, so `This week` and `Next week` are two reads
  // of the same store rather than two views of one read — which is why the
  // period is part of the load rather than a filter over what came back, and
  // why next week is usually empty rather than quiet.
  const period = view === 'next_week' ? nextPeriod() : undefined;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [capacity, ppl, health] = await Promise.all([
        api.getPartnerCapacity(period),
        api.listPartnerPeople(),
        api.getPartnerDeliveryHealth(),
      ]);
      setState({
        loading: false,
        error: '',
        data: capacity || {},
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
  }, [period]);
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
  const over = people.filter((p) => p.over_committed === true);

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  // `Seats only` NARROWS THE ROSTER; the two period chips already narrowed the
  // READ. `All` is everyone the period returned — a person appears if they hold
  // a seat or logged hours, because neither table alone is the roster.
  // Every key is named rather than falling through: `this_week` and
  // `next_week` chose the PERIOD in the load above, so here they are the whole
  // roster that period returned, and `all` is the same list under a label the
  // artboard draws.
  const visible = (() => {
    if (view === 'seats') return people.filter((p) => (p.live_seats || 0) > 0);
    if (view === 'this_week' || view === 'next_week' || view === 'all') return people;
    return people;
  })();

  const rowActions = partnerZoneActions('delivery/capacity', { view: { header: ['Person', 'Seats held', 'Project h', 'Seat h', 'Internal h', 'Total'], rows: visible, cells: (p) => [p.name, p.live_seats, p.project_hours, p.seat_hours, p.internal_hours, p.total_hours] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Capacity" actions={rowActions} />;
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('delivery/capacity', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
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
            title="Capacity & allocation"
            blurb={
              'People, not projects. Where the firm is over-committed — and where '
              + 'an over-committed person also holds a granted seat inside a '
              + 'client’s systems, which is a trust exposure rather than only a '
              + 'throughput one.'
            }
            action={engagements.length > 0 && (
              <button type="button" className={ghostButtonClass} onClick={() => setGranting((v) => !v)}>
                {granting ? 'Cancel' : 'Grant a seat'}
              </button>
            )}
          />

          {/* ══ THE `pd3` STRIP ═══════════════════════════════════════════════
              `Over-committed · Seats held · Project hours · Seat hours`, each
              counted over the WHOLE roster rather than the chip-narrowed list:
              a firm's project hours do not change because the reader narrowed
              to seat-holders. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <CapTile
              label="Over-committed"
              value={String(d?.over_committed_count ?? 0)}
              nr={d?.over_committed_count == null}
              note={d?.over_committed_count == null
                ? 'no cap is stated, so nobody is over one'
                : (firstNames(over) || 'none')}
            />
            <CapTile
              label="Seats held"
              value={String(d?.live_seats ?? liveSeats.length)}
              note="each scoped and revocable"
            />
            <CapTile
              label="Project hours"
              value={`${d?.project_hours_total ?? 0} h`}
              note={`this period · ${d?.period || '—'}`}
            />
            <CapTile
              label="Seat hours"
              value={`${d?.seat_hours_total ?? 0} h`}
              note="inside client systems"
            />
          </div>

          <Instrument
            testid="delivery-capacity"
            title="People"
            meta={d?.cap_hours == null
              ? 'No cap stated · seat hours counted, not estimated'
              : `Cap ${d.cap_hours} h · seat hours counted, not estimated`}
            cols="1.1fr 1.6fr .8fr .8fr .8fr 1.1fr"
            head={['Person', 'Seats held', 'Project h', 'Seat h', 'Internal h', 'Total']}
            rows={visible.map((p) => {
              const places = Array.isArray(p.seat_places) ? p.seat_places : [];
              const live = places.filter((s) => !s.revoked);
              const lead = live[0] || places[0];
              return {
                key: p.user_id,
                rowClass: p.over_committed === true ? 'bg-red-50/40 dark:bg-red-950/10' : '',
                cells: [
                  p.name ? { text: p.name } : { nr: true },
                  // WHERE THE SEAT IS, not how many. "Two seats" is a number;
                  // "Halverton · Board, KPIs" is the exposure. An em dash here
                  // is a known nothing — they hold no seat — rather than an
                  // unknown, which is why it is not `Not recorded`.
                  places.length === 0
                    ? { text: '—' }
                    : {
                      text: places.map((s) => s.client).filter(Boolean).join(', ') || undefined,
                      ...(lead?.scope
                        ? { grant: `Granted · ${lead.scope}`, grantRevoked: Boolean(lead.revoked) }
                        : {}),
                      sub: places.length > live.length
                        ? `${places.length - live.length} revoked, kept on the record`
                        : undefined,
                    },
                  // ZERO IS AN ANSWER HERE AND ABSENCE IS NOT. The hours book
                  // exists, so nothing logged against this person reads as
                  // unmeasured rather than as a person who did no work.
                  p.project_hours == null ? { nr: true } : { text: `${p.project_hours} h` },
                  p.seat_hours == null ? { nr: true } : { text: `${p.seat_hours} h` },
                  // INTERNAL HOURS ARE STATED OR THEY ARE ABSENT. No book
                  // records unbilled time by default, so an absent row means
                  // nobody said — never zero.
                  p.internal_hours == null
                    ? { nr: true }
                    : { text: `${p.internal_hours} h`, sub: p.internal_note || undefined },
                  // THE TOTAL IS THE WEEK, and it says so when it is only part
                  // of one. Against a stated cap it reads `N of C h` and
                  // carries `Over`; with no cap it is a number and says there
                  // is nothing to be over.
                  p.total_hours == null
                    ? { nr: true }
                    : {
                      text: p.cap_hours == null
                        ? `${p.total_hours} h`
                        : `${p.total_hours} of ${p.cap_hours} h`,
                      ...(p.over_committed === true ? { pill: 'Over', pillTone: 'danger' } : {}),
                      sub: p.internal_hours == null
                        ? 'internal hours not stated — a floor, not a measurement'
                        : (p.cap_hours == null ? 'no cap stated' : undefined),
                    },
                ],
              };
            })}
            note={'A person over their cap while holding a granted seat is the row this zone exists for, and it is read differently from the rest: a stretched operator inside a client’s own systems is a trust exposure, because the grant assumes attention the calendar no longer has. Reallocating project work does not fix it; renegotiating the seat does. Seat hours are counted from the hours logged against engagements where that person holds the grant — not estimated, and not moved into the project column when a founder later revokes it, because the work was still done inside their systems. A total with no internal hours behind it is marked a floor: the client book cannot hold admin or recruiting time, and a week assembled from billable rows alone under-reports in the reassuring direction.'}
          />

          {visible.length === 0 && people.length > 0 && (
            <p className="text-[12px] text-axal-ink-2">
              Nobody is in this state. {people.length} on the roster for {d?.period}.
            </p>
          )}

          <ZoneDraft
            surface="delivery/capacity"
            label="Draft · capacity findings"
            accept="Accept findings"
            run="Read the roster"
            foot="Hours read from engagement rows."
            empty="Who is over cap, by how much, and which overage sits behind a granted seat — separating schedulable overflow from seat commitments, because only one of them can be moved without going back to the founder."
            nothingToDraft="Nobody holds a seat or has logged hours this period, so there is nothing to read."
          />

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

          {/* ══ THE FIRM'S OWN NUMBER ═════════════════════════════════════════
              Nothing here computes a cap or offers a default. A firm types what
              it considers a full week; leaving it empty and saving clears the
              statement, so the first number typed is never permanent. */}
          <Section title="The week this firm says it has">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Whose" hint="The firm's default, or one person's override.">
                <select className={inputClass} value={cap.person_user_id}
                  onChange={(e) => setCap({ ...cap, person_user_id: e.target.value })}>
                  <option value="">The firm’s default</option>
                  {roster.map((p) => (
                    <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>
                  ))}
                </select>
              </Field>
              <Field label="Hours a week" hint="Leave empty and save to clear the cap.">
                {/* The placeholder is a SHAPE, not a suggestion. Offering the
                    canvas's forty in the empty box would put the number this
                    zone refuses to assume one keystroke from being typed in
                    and then read back as the firm's own answer. */}
                <input className={inputClass} value={cap.weekly_hours} inputMode="decimal" placeholder="e.g. 37.5"
                  onChange={(e) => setCap({ ...cap, weekly_hours: e.target.value })} />
              </Field>
              <Field label="Why this number" hint="Shown beside the cap — “four days, one for internal” means something different from “forty, and we mean it”.">
                <input className={inputClass} value={cap.note} maxLength={300}
                  onChange={(e) => setCap({ ...cap, note: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <button
                  type="button" className={buttonClass} disabled={busy}
                  onClick={async () => {
                    const raw = cap.weekly_hours.trim();
                    await run(
                      () => api.setPartnerCapacityCap({
                        person_user_id: cap.person_user_id ? Number(cap.person_user_id) : null,
                        // EMPTY CLEARS, it does not save a zero. Zero hours
                        // would say this person works none, which is a claim;
                        // no row says nobody has stated a cap.
                        weekly_hours: raw === '' ? null : Number(raw),
                        note: cap.note,
                      }),
                      raw === '' ? 'Cap cleared.' : 'Cap saved.', 'cap',
                    );
                    setCap({ person_user_id: '', weekly_hours: '', note: '' });
                  }}
                >
                  {cap.weekly_hours.trim() === '' ? 'Clear' : 'Save cap'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-2">
              {d?.cap_hours == null
                ? d?.cap_note
                : `Firm default: ${d.cap_hours} h a week${d.cap_note ? ` — ${d.cap_note}` : ''}. A person with their own number overrides it.`}
            </p>
            <SaveNote note={note?.scope === 'cap' ? note : null} />
          </Section>

          {/* ══ THE HOURS NO CLIENT PAYS FOR ══════════════════════════════════ */}
          <Section title={`Internal hours · ${d?.period || ''}`}>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Person">
                <select className={inputClass} value={internal.person_user_id}
                  onChange={(e) => setInternal({ ...internal, person_user_id: e.target.value })}>
                  <option value="">Choose one</option>
                  {roster.map((p) => (
                    <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>
                  ))}
                </select>
              </Field>
              <Field label="Hours" hint="Admin, recruiting, the proposal that lost. Empty clears the statement; 0 states there were none.">
                <input className={inputClass} value={internal.hours} inputMode="decimal" placeholder="e.g. 6"
                  onChange={(e) => setInternal({ ...internal, hours: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <button
                  type="button" className={buttonClass}
                  disabled={busy || !internal.person_user_id}
                  onClick={async () => {
                    const raw = internal.hours.trim();
                    await run(
                      () => api.setPartnerInternalHours({
                        person_user_id: Number(internal.person_user_id),
                        period: d.period,
                        hours: raw === '' ? null : Number(raw),
                      }),
                      raw === '' ? 'Statement cleared.' : 'Internal hours saved.', 'internal',
                    );
                    setInternal({ person_user_id: '', hours: '' });
                  }}
                >
                  {internal.hours.trim() === '' ? 'Clear' : 'Save'}
                </button>
              </div>
            </div>
            <SaveNote note={note?.scope === 'internal' ? note : null} />
          </Section>

          <Section title={`Client hours · ${d?.period || ''}`}>
            <div className="grid gap-3 md:grid-cols-4">
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
          </Section>

          <Section title="Seats inside client systems">
            {seats.length === 0 ? (
              <p className="text-[12.5px] text-axal-ink-2">No seat has been recorded.</p>
            ) : (
              <div>
                {seats.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 first:border-t-0 text-[12.5px]">
                    <span className={s.revoked_at ? 'text-axal-ink-3 line-through' : 'font-semibold'}>
                      {s.holder_name || <NotRecorded>Unnamed</NotRecorded>}
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

          <StatedLimit title="What this page will and will not say">
            <p>
              <strong>The cap is yours, never ours.</strong> Nothing here computes,
              infers or defaults one, and a firm that has not stated a number
              still reads <em>Not recorded</em> against <em>Over-committed</em>.
              The capacity artboard draws its bars against a hardcoded forty;
              adopting that would have invented your cap and then presented the
              result to you as a finding, on the one page whose job is to be
              trusted about exposure.
            </p>
            <p className="mt-2">
              <strong>A total with no internal hours is a floor.</strong> The
              client hours book cannot hold admin, recruiting or the proposal that
              lost — its rows require an engagement — so a week assembled from it
              alone under-reports by exactly the part nobody is billed for, and
              in the reassuring direction. Rows say so rather than quietly
              totalling less.
            </p>
            <p className="mt-2">
              <strong>An over-committed seat-holder is not a scheduling
              problem.</strong> A stretched operator inside a client’s own
              systems is a trust exposure: the grant assumes attention the
              calendar no longer has. This page marks it; it does not revoke
              anything, because the grant is the founder’s to withdraw.
            </p>
            <p className="mt-2">
              <strong>Hours are what somebody logged.</strong> No timesheet,
              calendar or ticket system feeds them, so a person with no hours
              reads as unmeasured rather than as idle. And a revoked seat stays on
              this page struck through, still counting the hours worked under it:
              access that once existed is a fact worth keeping, which is why
              revoking is a state rather than a delete.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
