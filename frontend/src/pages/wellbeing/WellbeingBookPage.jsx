import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Check, ExternalLink, Search, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Pill, Skeleton, Unrecorded, Unreadable } from '../../ui';
import {
  SESSION_MINUTES, arrivedExpert, bookingPayload, servicePrice, chosenServiceLabel, browserTimeZone, countLabel, expertRate, formatWhen, groupSlots,
  nextOpening, safeHref, specialties, wantedCategories, withArrived,
} from './wellbeingModel';
import { BTN, FIELD, PageHeader, CardHead, NotRecorded, StepChips, Outcome } from './WellbeingParts';

/**
 * /wellbeing/book — book an expert in four steps (canvas `wb-book`, D570).
 *
 * The canvas draws the four steps side by side and no Eadwyn rail
 * (`rail: false`), and this page keeps both. It is the one booking flow: the
 * home page's old in-page directory and its booking modal moved here, filters
 * included, because a list this long needs them.
 *
 * WHAT THE ROUTES GIVE EACH STEP.
 *   1. Expert — `GET /api/wellbeing/experts` (the ranked directory) and, for
 *      the line under each card, `GET /experts/:uid/slots`. Opening a profile
 *      (`GET /experts/:uid`) is never needed, so no free-tier view is spent.
 *      An expert's profile sends its card along (`?expert=` and navigation
 *      state), and that expert is listed first even when the directory's
 *      twelve leave them out.
 *   2. Service — the expert's active services, which the directory returns
 *      on each card since D574. A member picks one, or a plain 30-minute
 *      session; the route takes the length and price from the service.
 *   3. Time — `GET /experts/:uid/slots`, cut from the expert's weekly grid
 *      (D574), or the default hours when they have set none, which the step
 *      says; or the expert's own scheduler.
 *   4. Confirm — `POST /experts/:uid/book` with the slot and the service.
 *      No note is ever sent: a booking carries none (D331).
 */

const STEPS = ['Expert', 'Service', 'Time', 'Confirm'];
const LIST_LIMIT = 12;
const LANGUAGES = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'],
  ['zh', 'Mandarin'], ['ja', 'Japanese'], ['hi', 'Hindi'], ['ar', 'Arabic'],
];
const MODALITIES = [['video', 'Video'], ['phone', 'Phone'], ['in_person', 'In person'], ['async_chat', 'Async chat']];
const PRICE_CAPS = [100, 200, 350, 500];
/** An older Worker returns `services: null`: the list was not read, which is not "none". */
export const SERVICE_GAP = 'This expert’s services could not be read, so a booking is a 30-minute session with no service attached.';
const RATE_GAP = 'This expert has not published a rate.';
const EMPTY_FILTERS = { q: '', category: '', language: '', modality: '', price_max: '' };

const selectCls = `${FIELD.input} sm:w-auto`;

export function DirectoryToolbar({ filters, categories = [], onChange, count }) {
  const set = (key) => (e) => onChange?.({ ...filters, [key]: e.target.value });
  return (
    <Card className="space-y-2.5" data-testid="toolbar-experts">
      <label className="relative block">
        <span className="sr-only">Search experts</span>
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-axal-faint" aria-hidden="true" />
        <input type="search" value={filters.q} onChange={set('q')} placeholder="Search experts…" className={`${FIELD.input} pl-9`} data-testid="input-expert-search" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Specialty" value={filters.category} onChange={set('category')} className={selectCls}>
          <option value="">Any specialty</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select aria-label="Language" value={filters.language} onChange={set('language')} className={selectCls}>
          <option value="">Any language</option>
          {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="How you meet" value={filters.modality} onChange={set('modality')} className={selectCls}>
          <option value="">Any format</option>
          {MODALITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Highest rate" value={filters.price_max} onChange={set('price_max')} className={selectCls}>
          <option value="">Any rate</option>
          {PRICE_CAPS.map((cap) => <option key={cap} value={cap}>Up to ${cap} / hr</option>)}
        </select>
        <span className="ml-auto text-xs tabular-nums text-axal-muted dark:text-gray-400" data-testid="text-expert-count">
          {count} · Sort: best match
        </span>
      </div>
    </Card>
  );
}

function ExpertOption({ expert, labels, opening, selected, onSelect }) {
  const rate = expertRate(expert);
  const tags = specialties(expert, labels).slice(0, 3);
  const ratings = Number(expert.rating_count) || 0;
  return (
    <Card
      as="button"
      type="button"
      variant={selected ? 'accent' : 'plain'}
      padding="sm"
      aria-pressed={selected}
      onClick={() => onSelect?.(expert.uid)}
      className={selected ? 'ring-2 ring-axal-violet' : ''}
      data-testid={`expert-${expert.uid}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-bold text-axal-ink dark:text-gray-100">{expert.name}</span>
        {selected && <Check size={14} className="shrink-0 text-axal-violet" aria-hidden="true" />}
      </span>
      {expert.headline && <span className="mt-0.5 block truncate text-xs text-axal-muted dark:text-gray-400">{expert.headline}</span>}
      {tags.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1">{tags.map((t) => <Pill key={t}>{t}</Pill>)}</span>
      )}
      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {rate
          ? <span className="font-semibold tabular-nums text-axal-ink dark:text-gray-100">{rate}</span>
          : <Unrecorded reason={RATE_GAP}>Rate not recorded</Unrecorded>}
        {expert.first_session_free && <Pill tone="ok">First session free</Pill>}
        {expert.pricing_model === 'sliding_scale' && <Pill tone="info">Sliding scale</Pill>}
      </span>
      <span className="mt-1 flex items-center gap-1 text-xs text-axal-muted dark:text-gray-400">
        <Star size={12} className="text-amber-500" aria-hidden="true" />
        {ratings ? `${Number(expert.rating_avg || 0).toFixed(1)} · ${ratings} rating${ratings === 1 ? '' : 's'}` : 'No ratings yet'}
      </span>
      <span className={`mt-1 block text-xs ${opening.kind === 'unreadable' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`opening-${expert.uid}`}>
        {opening.text}
      </span>
    </Card>
  );
}

export function ExpertColumn({ status, experts = [], labels = new Map(), slots = {}, selected, missingSelected = false, onSelect, onRetry, timeZone }) {
  const allClosed = status === 'ready' && experts.length > 0
    && experts.every((e) => slots[e.uid]?.status === 'ready' && !slots[e.uid].external && !(slots[e.uid].slots || []).length);
  return (
    <Card data-testid="step-expert">
      <CardHead title="1 · Expert" as="h2" />
      {status === 'loading' ? <Skeleton.Text lines={5} /> : status === 'unreadable' ? (
        <Unreadable what="The expert directory" claim="This is not a sign that no expert is listed." onRetry={onRetry} />
      ) : !experts.length ? (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-experts-empty">No expert matches these filters. Try clearing them.</p>
      ) : (
        <div className="space-y-2 xl:max-h-[34rem] xl:overflow-y-auto xl:pr-1">
          {missingSelected && (
            <p className={FIELD.note} data-testid="text-expert-not-listed">
              The expert you came for is not in this list. Clear the filters, choose another, or{' '}
              <Link to={`/wellbeing/expert/${encodeURIComponent(selected)}`} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">book them from their profile</Link>.
            </p>
          )}
          {allClosed && (
            <p className={FIELD.note} data-testid="text-no-openings">No expert has an open slot in the next few days.</p>
          )}
          {experts.map((e) => (
            <ExpertOption
              key={e.uid}
              expert={e}
              labels={labels}
              opening={nextOpening(slots[e.uid], { timeZone })}
              selected={selected === e.uid}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function ServiceOption({ on, onPick, testId, title, sub }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      data-testid={testId}
      className={`block w-full rounded-axal-md border p-3 text-left ${on ? 'border-axal-violet bg-axal-lavender/50 dark:bg-violet-900/20' : 'border-axal-hairline dark:border-gray-700'}`}
    >
      <div className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{title}</div>
      <div className="text-xs text-axal-muted dark:text-gray-400">{sub}</div>
    </button>
  );
}

export function ServiceColumn({ expert, serviceUid = null, onService }) {
  const services = Array.isArray(expert?.services) ? expert.services : null;
  const plainSub = expertRate(expert) ? `${expert.name}’s published rate: ${expertRate(expert)}` : <Unrecorded reason={RATE_GAP}>Rate not recorded</Unrecorded>;
  return (
    <Card data-testid="step-service">
      <CardHead title="2 · Service" as="h2" />
      {!expert ? (
        <p className={FIELD.note}>Choose an expert first.</p>
      ) : (
        <div className="space-y-2" data-testid="list-services">
          {services === null && <NotRecorded label="Services not read" reason={SERVICE_GAP} testId="text-services-gap" />}
          {services && !services.length && <p className={FIELD.note} data-testid="text-no-services">{expert.name} lists no services.</p>}
          {(services || []).map((s) => (
            <ServiceOption
              key={s.uid}
              on={serviceUid === s.uid}
              onPick={() => onService?.(s.uid)}
              testId={`service-${s.uid}`}
              title={s.title}
              sub={[`${s.duration_minutes} min`, servicePrice(s)].filter(Boolean).join(' · ')}
            />
          ))}
          <ServiceOption
            on={!serviceUid}
            onPick={() => onService?.(null)}
            testId="service-plain"
            title={`A ${SESSION_MINUTES}-minute session`}
            sub={plainSub}
          />
        </div>
      )}
    </Card>
  );
}

export function TimeColumn({ expert, slotState, chosen, onChoose, onRetry, timeZone }) {
  const groups = useMemo(() => groupSlots(slotState?.slots || [], { timeZone }), [slotState, timeZone]);
  const launch = safeHref(slotState?.launch_url);
  return (
    <Card data-testid="step-time">
      <CardHead title="3 · Time" as="h2" meta={expert && slotState?.status === 'ready' && !slotState.external ? `Times in ${timeZone}` : null} />
      {!expert ? (
        <p className={FIELD.note}>Choose an expert first.</p>
      ) : !slotState || slotState.status === 'loading' ? <Skeleton.Text lines={4} /> : slotState.status === 'unreadable' ? (
        <Unreadable what="Availability" claim="This is not a sign that the expert is fully booked." onRetry={onRetry} />
      ) : slotState.external ? (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-external-scheduler">
          {expert.name} books through their own scheduler{launch ? '' : ', and no link to it is recorded'}. Confirming records the booking here and opens it, where you pick the time.
        </p>
      ) : !groups.length ? (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-no-slots">
          No open slot in the next few days. Try another expert.
        </p>
      ) : (
        <div className="space-y-3 xl:max-h-[34rem] xl:overflow-y-auto xl:pr-1" data-testid="list-slot-days">
          {slotState.source === 'default_hours' && (
            <p className={FIELD.note} data-testid="text-default-hours">
              {expert.name} has not set weekly hours, so these are the default ones: weekdays, 09:00 to 17:00 UTC.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 text-xs font-semibold text-axal-ink dark:text-gray-100">{g.label}</div>
              <div className="grid grid-cols-4 gap-1.5">
                {g.slots.map((s) => {
                  const on = chosen === s.iso;
                  return (
                    <button
                      key={s.iso}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChoose?.(s.iso)}
                      className={`rounded-axal-xs py-1.5 text-center text-xs tabular-nums transition-colors ${
                        on
                          ? 'bg-axal-violet font-semibold text-white'
                          : 'border border-axal-hairline bg-white text-axal-ink hover:border-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
                      }`}
                      data-testid={`slot-${s.iso}`}
                    >
                      {s.time}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ConfirmColumn({ expert, slotState, chosen, serviceUid = null, booking = {}, onConfirm, onReset, timeZone }) {
  const external = !!slotState?.external;
  const ready = !!expert && (external || !!chosen);
  const result = booking.result;
  const launch = safeHref(result?.launch_url);
  const rows = expert ? [
    ['Expert', expert.name],
    ['Service', chosenServiceLabel(expert, serviceUid)],
    ['When', external ? 'Chosen in their scheduler' : (formatWhen(chosen, { timeZone }) || 'Choose a time')],
    ['Rate', expertRate(expert) || <Unrecorded key="rate" reason={RATE_GAP}>Not recorded</Unrecorded>],
  ] : [];
  return (
    <Card variant={ready ? 'accent' : 'plain'} data-testid="step-confirm">
      <CardHead title="4 · Confirm" as="h2" />
      {!expert ? (
        <p className={FIELD.note}>Choose an expert and a time.</p>
      ) : result ? (
        <div className="space-y-2.5" data-testid="booking-done">
          <p className="flex items-start gap-1.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300" role="status">
            <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            {result.message || 'Booked.'}
          </p>
          {result.scheduled_at && (
            <p className="text-xs tabular-nums text-axal-muted dark:text-gray-400">In your time: {formatWhen(result.scheduled_at, { timeZone })}</p>
          )}
          {launch && (
            <a href={launch} target="_blank" rel="noopener noreferrer" className={BTN.link}>Open their scheduler <ExternalLink size={12} aria-hidden="true" /></a>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/wellbeing" className={BTN.ghost}>Back to Wellbeing</Link>
            <button type="button" className={BTN.ghost} onClick={onReset}>Book another</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="space-y-1.5 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-axal-muted dark:text-gray-400">{k}</dt>
                <dd className="text-right font-semibold tabular-nums text-axal-ink dark:text-gray-100">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-axal-muted dark:text-gray-400">
            Visible to you and the expert alone. No note is stored with the booking, and no payment is taken when you confirm.
          </p>
          <button type="button" className={`${BTN.primary} w-full`} disabled={!ready || booking.busy} onClick={onConfirm} data-testid="button-confirm-booking">
            {booking.busy ? 'Booking…' : external ? 'Confirm and open their scheduler' : 'Confirm'}
          </button>
          <Outcome error={booking.error} testId="booking" />
        </div>
      )}
    </Card>
  );
}

export default function WellbeingBookPage() {
  const [params] = useSearchParams();
  const { state: navState } = useLocation();
  const wanted = params.get('expert');
  const timeZone = useMemo(() => browserTimeZone(), []);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [query, setQuery] = useState(EMPTY_FILTERS);
  const [goals, setGoals] = useState(null);
  const [categories, setCategories] = useState([]);
  const [list, setList] = useState({ status: 'loading', experts: [], filtered: null });
  const [slots, setSlots] = useState({});
  const [selected, setSelected] = useState(() => wanted || null);
  const [chosen, setChosen] = useState(null);
  const [serviceUid, setServiceUid] = useState(null);
  const [booking, setBooking] = useState({ busy: false, result: null, error: null });

  const labels = useMemo(() => new Map(categories.map((c) => [c.key, c.label])), [categories]);
  const arrived = useMemo(() => arrivedExpert(navState, wanted), [navState, wanted]);
  const experts = useMemo(() => withArrived(list.experts, arrived), [list.experts, arrived]);

  // The catalogue names the specialties; the member's own past topics rank
  // the directory, as the home page's directory always did. Neither failing
  // stops the list: unnamed keys are shown cased, and no topics ranks plainly.
  useEffect(() => {
    let alive = true;
    api.wellbeingExpertCategories()
      .then((r) => { if (alive) setCategories(Array.isArray(r?.categories) ? r.categories : []); })
      .catch(() => {});
    api.wellbeingMyCheckins()
      .then((r) => { if (alive) setGoals(wantedCategories(r?.checkins)); })
      .catch(() => { if (alive) setGoals([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  const loadExperts = useCallback(async () => {
    if (goals === null) return;
    setList((l) => ({ ...l, status: 'loading' }));
    try {
      const r = await api.wellbeingExperts({
        ...query, tz: timeZone, want_categories: goals, want_languages: ['en'], limit: LIST_LIMIT,
      });
      setList({
        status: 'ready',
        experts: Array.isArray(r?.matches) ? r.matches : [],
        filtered: Number.isFinite(r?.filtered_count) ? r.filtered_count : null,
      });
    } catch {
      setList({ status: 'unreadable', experts: [], filtered: null });
    }
  }, [goals, query, timeZone]);
  useEffect(() => { loadExperts(); }, [loadExperts]);

  const loadSlots = useCallback((uid) => {
    setSlots((s) => ({ ...s, [uid]: { status: 'loading' } }));
    return api.wellbeingExpertSlots(uid)
      .then((r) => setSlots((s) => ({
        ...s,
        [uid]: {
          status: 'ready', external: !!r?.external, launch_url: r?.launch_url || null,
          slots: Array.isArray(r?.slots) ? r.slots : [], source: r?.source || null,
        },
      })))
      .catch(() => setSlots((s) => ({ ...s, [uid]: { status: 'unreadable' } })));
  }, []);

  // Each listed expert's openings, for the line under its card and for step 3.
  useEffect(() => {
    if (list.status !== 'ready') return;
    list.experts.forEach((e) => { if (e.uid !== arrived?.uid) loadSlots(e.uid); });
  }, [list, arrived, loadSlots]);
  // The arrived expert's openings do not wait for the directory, or need it.
  useEffect(() => { if (arrived) loadSlots(arrived.uid); }, [arrived, loadSlots]);

  const expert = experts.find((e) => e.uid === selected) || null;
  const slotState = expert ? slots[expert.uid] : null;
  const step = booking.result ? STEPS.length : !expert ? 0 : (slotState?.external || chosen) ? 3 : 2;
  const shown = list.experts.length;
  const count = list.status !== 'ready'
    ? 'Reading the directory'
    : list.filtered != null ? countLabel({ from: shown ? 1 : 0, to: shown, total: list.filtered }) : `${shown} listed`;

  const select = (uid) => {
    setSelected(uid);
    setChosen(null);
    setServiceUid(null);
    setBooking({ busy: false, result: null, error: null });
  };

  const confirm = async () => {
    if (!expert) return;
    const external = !!slotState?.external;
    if (!external && !chosen) return;
    setBooking({ busy: true, result: null, error: null });
    try {
      const r = await api.wellbeingExpertBook(expert.uid, bookingPayload({ slot: chosen, external, serviceUid }));
      setBooking({ busy: false, result: r || {}, error: null });
      const open = external ? safeHref(r?.launch_url) : null;
      if (open && typeof window !== 'undefined') window.open(open, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setBooking({ busy: false, result: null, error: e?.message || 'The booking could not be made.' });
      // The route's concurrency guard: the slot went while it was on screen.
      if (e?.status === 409 && !external) {
        setChosen(null);
        loadSlots(expert.uid);
      }
    }
  };

  return (
    <div className="space-y-4" data-testid="wellbeing-book">
      <PageHeader
        back={{ to: '/wellbeing', label: 'Wellbeing' }}
        title="Book an expert"
        sub="Four steps: expert, service, time, confirm. A booking is visible to you and the expert alone, and carries no notes."
      />
      <DirectoryToolbar filters={filters} categories={categories} onChange={setFilters} count={count} />
      <StepChips steps={STEPS} current={step} />
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ExpertColumn
          status={list.status}
          experts={experts}
          labels={labels}
          slots={slots}
          selected={selected}
          missingSelected={!!selected && list.status === 'ready' && !expert}
          onSelect={select}
          onRetry={loadExperts}
          timeZone={timeZone}
        />
        <ServiceColumn expert={expert} serviceUid={serviceUid} onService={(uid) => { setServiceUid(uid); setBooking({ busy: false, result: null, error: null }); }} />
        <TimeColumn
          expert={expert}
          slotState={slotState}
          chosen={chosen}
          onChoose={(iso) => { setChosen(iso); setBooking({ busy: false, result: null, error: null }); }}
          onRetry={() => expert && loadSlots(expert.uid)}
          timeZone={timeZone}
        />
        <ConfirmColumn
          expert={expert}
          slotState={slotState}
          chosen={chosen}
          serviceUid={serviceUid}
          booking={booking}
          onConfirm={confirm}
          onReset={() => { setChosen(null); setBooking({ busy: false, result: null, error: null }); if (expert) loadSlots(expert.uid); }}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}
