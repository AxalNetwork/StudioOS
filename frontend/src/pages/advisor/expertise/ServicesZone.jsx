import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, NothingYet, Pill, SaveNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, dollarsToCents, ghostButtonClass, inputClass, money,
} from './kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { FillFormBar, useScopedFill } from '../../../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../../../lib/fillScoped.js';
import {
  SERVICE_BOOKABLE, SERVICE_NOT_PUBLIC, SERVICE_STATES, SESSIONS_PATH, serviceDraftOf, serviceEditBody, serviceStateLabel,
} from './expertiseModel';

/**
 * Expertise · Services — what you sell, and what you charge for it.
 *
 * MONEY IS RECORDED, NOT MOVED. Nothing on this page is a checkout. There is no
 * payment provider behind it, Axal issues no invoice and takes no position on
 * collection — a price here is the advisor's own statement of what they charge,
 * the same way a rate card is. Migration 203's header says the same thing from
 * the schema side.
 *
 * AN UNPRICED SERVICE IS NOT A FREE ONE. `price_cents` is nullable and the
 * empty state reads "Not recorded", never "$0". Zero is a price an advisor may
 * genuinely mean, so it cannot double as "no answer" — and CLAUDE.md's rule is
 * that an unset fact reads as unset.
 *
 * `units_sold` IS NOT SHOWN, and it is a null rather than a zero for a reason
 * worth stating: nothing in the schema links a booking to a service. A booking
 * carries free text in `topic`. Counting the bookings whose topic happens to
 * match a service title would render a guess in the shape of a fact.
 *
 * D1329 (#3490, AF18): Add a service carries Fill with Eadwyn on its Title and
 * What it covers, from the advisor's recorded outcomes and Eadwyn. The price
 * is never filled. Nothing is written until Add service; then the record step
 * keeps only what still equals each proposal.
 *
 * D4681 (#4681): a saved service is edited in place (`PATCH /me/services/:id`,
 * owner-checked), every field at once, so a change never means delete and
 * recreate. Active and Inactive are states of the advisor's own record: a
 * service is never on the public profile and is never booked. What a founder
 * books is a session type and its public booking link (Practice › Sessions).
 */

const KINDS = [
  ['fixed', 'Fixed', 'One engagement, one price.'],
  ['package', 'Package', 'A bundle of sessions or deliverables.'],
  ['retainer', 'Retainer', 'Recurring, usually monthly.'],
];

const BLANK = { title: '', kind: 'fixed', duration_note: '', price: '', scope: '' };

export default function ServicesZone() {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  // D392 — the canvas's chips over `kind`, the column the form above writes.
  const [view, setView] = useState('all');
  // D4681: the one service being edited, and its form.
  const [editing, setEditing] = useState(null);
  const [editDraft, setEditDraft] = useState(() => serviceDraftOf(null));
  const [editNote, setEditNote] = useState(null);
  const [saving, setSaving] = useState(false);
  // D1424 (#3700): the header's "New service" scrolls to this form and puts
  // the cursor in Title. The form is the whole of adding one; nothing opens.
  const titleRef = useRef(null);
  const focusAddForm = useCallback(() => {
    titleRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    titleRef.current?.focus?.({ preventScroll: true });
  }, []);
  const fill = useScopedFill({
    scope: SCOPED_FORMS.service, values: { title: draft.title, scope: draft.scope },
    onValues: (v) => setDraft((d) => ({ ...d, ...v })),
  });

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorServices();
      setState({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your services could not be read.', items: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setNote(null);
    const title = draft.title.trim();
    if (!title) { setNote({ ok: false, text: 'A service needs a title.' }); return; }
    // Parsed here so a typo is a sentence rather than a 400 from the worker.
    const parsed = dollarsToCents(draft.price);
    if (parsed.error) { setNote({ ok: false, text: parsed.error }); return; }
    setBusy(true);
    try {
      const created = await api.createMyAdvisorService({
        title,
        kind: draft.kind,
        duration_note: draft.duration_note.trim() || null,
        price_cents: parsed.cents,
        scope: draft.scope.trim() || null,
      });
      await fill.afterSave(created?.id);
      setDraft(BLANK);
      setNote({ ok: true, text: 'Service added.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'The service could not be saved. Nothing was added.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    setNote(null);
    try {
      await api.updateMyAdvisorService(row.id, { is_active: !row.is_active });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be changed.' });
    }
  };

  const startEdit = (row) => { setEditing(row.id); setEditDraft(serviceDraftOf(row)); setEditNote(null); };
  const stopEdit = () => { setEditing(null); setEditNote(null); };
  const saveEdit = async (e, row) => {
    e.preventDefault();
    const parsed = dollarsToCents(editDraft.price);
    if (parsed.error) { setEditNote({ ok: false, text: parsed.error }); return; }
    const { body, error } = serviceEditBody(row, editDraft, parsed.cents);
    if (error) { setEditNote({ ok: false, text: error }); return; }
    if (!Object.keys(body).length) { stopEdit(); return; }
    setSaving(true);
    try {
      await api.updateMyAdvisorService(row.id, body);
      stopEdit();
      setNote({ ok: true, text: 'Service saved.' });
      await load();
    } catch (err) {
      setEditNote({ ok: false, text: err?.message || 'The change could not be saved. The service is as it was.' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    setNote(null);
    try {
      await api.deleteMyAdvisorService(row.id);
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be removed.' });
    }
  };

  const priced = state.items.filter((s) => s.price_cents != null);
  const unpriced = state.items.filter((s) => s.price_cents == null);

  /**
   * HOW MANY TIMES A SERVICE SOLD IS NOT KNOWN, and the two stats that depend
   * on it say so rather than computing a confident zero.
   *
   * `GET /me/services` returns `units_sold: null` on every row — not sometimes,
   * always — and `routes/advisors.ts` explains why: nothing links a booking to
   * a service. `advisor_bookings` carries a free-text `topic`, not a service
   * id, so counting bookings whose topic happens to match a title would be a
   * guess wearing a number's clothes. Migration 203's header says the same.
   *
   * An earlier revision of this strip read `s.sold` — a field that exists under
   * no name — and defaulted it to 0. That did NOT render as blank: `money(0)`
   * returns "$0", so an advisor with real bookings was shown a practice that
   * had booked $0, and "Most sold" named whichever service happened to be
   * first, since nothing ever beat zero.
   *
   * So both are `null` here, and null reaches the strip as "Not recorded". When
   * a booking can name the service it delivered, `unitsFor` becomes real and
   * these two light up on their own.
   */
  const unitsFor = (s) => (s.units_sold == null ? null : s.units_sold);
  const anyUnitsKnown = state.items.some((s) => unitsFor(s) != null);
  const bookedCents = anyUnitsKnown
    ? priced.reduce((a, s) => a + s.price_cents * (unitsFor(s) ?? 0), 0)
    : null;
  const unitsSold = anyUnitsKnown
    ? state.items.reduce((a, s) => a + (unitsFor(s) ?? 0), 0)
    : null;
  const mostSold = anyUnitsKnown
    ? state.items.reduce((a, b) => ((unitsFor(b) ?? 0) > (unitsFor(a) ?? 0) ? b : a), state.items[0])
    : null;

  const shown = view === 'all' ? state.items : state.items.filter((r) => r.kind === view);

  const empty = (
    <NothingYet
      title="No services recorded yet"
      body="Add what you actually sell — a fixed engagement, a package, a retainer — with the price you charge for it. This is your own record: nothing is billed, invoiced or collected through Axal."
    />
  );

  return (
    <div className="space-y-4">
      {/* Canvas stats strip — computed from the ledger, not asserted. */}
      {state.items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Services', value: String(state.items.length), note: `${priced.length} priced, ${unpriced.length} not` },
            {
              label: 'Booked',
              value: bookedCents == null ? <Unrecorded /> : money(bookedCents),
              note: unitsSold == null ? 'a booking records a topic, not a service' : `from ${unitsSold} units`,
            },
            {
              label: 'Most sold',
              value: mostSold?.title || <Unrecorded />,
              note: mostSold ? `${unitsFor(mostSold)} units` : 'nothing counts sales per service yet',
            },
            { label: 'Unpriced', value: String(unpriced.length), note: unpriced.length ? 'scope settled, price is not' : 'all priced' },
          ].map((s) => (
            <Card key={s.label} padding="md">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{s.label}</div>
              <div className="mt-1 text-[15px] font-extrabold tabular-nums">{s.value}</div>
              <div className="mt-0.5 text-[10px] text-axal-faint">{s.note}</div>
            </Card>
          ))}
        </div>
      )}

      <Card padding="lg">
        <ZoneHeading
          title="Add a service"
          blurb="A price here is what you charge, kept in your own records. No payment runs through this page."
        />
        <p className="-mt-1 mb-3 max-w-2xl text-[12px] leading-relaxed text-axal-muted" data-testid="advisor-services-not-public">
          {SERVICE_NOT_PUBLIC} {SERVICE_BOOKABLE}{' '}
          <Link to={SESSIONS_PATH} className="font-semibold text-emerald-700 underline dark:text-emerald-300">Practice › Sessions</Link>
        </p>
        <FillFormBar fill={fill} />
        <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title" fill={{ ctl: fill, name: 'title', value: draft.title }}>
            <input ref={titleRef} className={inputClass} value={draft.title} data-testid="advisor-service-title"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Fractional CTO day" />
          </Field>
          <Field label="Kind" hint={KINDS.find(([k]) => k === draft.kind)?.[2]}>
            <select className={inputClass} value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Price" hint="Leave blank if you have not set one — blank reads as “not recorded”, not as free.">
            <input className={inputClass} value={draft.price} inputMode="decimal"
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder="2500" />
          </Field>
          <Field label="Duration" hint="In your own words.">
            <input className={inputClass} value={draft.duration_note}
              onChange={(e) => setDraft({ ...draft, duration_note: e.target.value })}
              placeholder="One day, on site" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="What it covers" fill={{ ctl: fill, name: 'scope', value: draft.scope }}>
              <textarea rows={2} className={inputClass} value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Adding…' : 'Add service'}
            </button>
            <SaveNote note={note} />
          </div>
        </form>
      </Card>

      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('expertise/services', { value: view, onChange: setView })}
        actions={advisorZoneActions('expertise/services', { handlers: { focusAddForm }, view: { header: ['Service', 'Kind', 'Active', 'Price (cents)', 'Units sold'], rows: shown, cells: (r) => [r.title, r.kind, r.is_active, r.price_cents, r.units_sold] } })}
      />
      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={state.items.length === 0} empty={empty}>
        {shown.length === 0 && (
          <p className="text-[12.5px] text-axal-muted">{`No ${view} service is listed. ${state.items.length} in total.`}</p>
        )}
        <div className="space-y-3">
          {shown.map((row) => (
            <Card key={row.id} padding="md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-extrabold">{row.title}</span>
                    <Pill tone="neutral">{KINDS.find(([k]) => k === row.kind)?.[1] || row.kind}</Pill>
                    {!row.is_active && <Pill tone="neutral">{serviceStateLabel(row)}</Pill>}
                  </div>
                  {row.duration_note && (
                    <div className="mt-0.5 text-[11.5px] text-axal-faint">{row.duration_note}</div>
                  )}
                  {row.scope && (
                    <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-muted">{row.scope}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-extrabold tabular-nums">
                    {money(row.price_cents, row.currency) ?? <Unrecorded />}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={ghostButtonClass} onClick={() => (editing === row.id ? stopEdit() : startEdit(row))}
                      data-testid={`advisor-service-edit-${row.id}`}>
                      {editing === row.id ? 'Close' : 'Edit'}
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={() => toggleActive(row)}
                      data-testid={`advisor-service-state-${row.id}`}>
                      {row.is_active ? 'Mark inactive' : 'Mark active'}
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={() => remove(row)}
                      aria-label={`Remove ${row.title}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
              {editing === row.id ? (
                <form onSubmit={(e) => saveEdit(e, row)} className="mt-3 grid grid-cols-1 gap-3 border-t border-axal-hairline pt-3 sm:grid-cols-2 dark:border-gray-700"
                  data-testid={`advisor-service-form-${row.id}`}>
                  <Field label="Title">
                    <input className={inputClass} value={editDraft.title} data-testid="advisor-service-edit-title"
                      onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                  </Field>
                  <Field label="Kind">
                    <select className={inputClass} value={editDraft.kind} data-testid="advisor-service-edit-kind"
                      onChange={(e) => setEditDraft({ ...editDraft, kind: e.target.value })}>
                      {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label="Price" hint="Blank reads as “not recorded”, not as free.">
                    <input className={inputClass} value={editDraft.price} inputMode="decimal" data-testid="advisor-service-edit-price"
                      onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })} />
                  </Field>
                  <Field label="Currency" hint="Three letters, such as USD.">
                    <input className={inputClass} value={editDraft.currency} maxLength={3} data-testid="advisor-service-edit-currency"
                      onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value })} />
                  </Field>
                  <Field label="Duration">
                    <input className={inputClass} value={editDraft.duration_note} data-testid="advisor-service-edit-duration"
                      onChange={(e) => setEditDraft({ ...editDraft, duration_note: e.target.value })} />
                  </Field>
                  <Field label="State" hint={SERVICE_STATES.find((x) => x.id === editDraft.is_active)?.hint}>
                    <select className={inputClass} value={editDraft.is_active ? 'active' : 'inactive'} data-testid="advisor-service-edit-state"
                      onChange={(e) => setEditDraft({ ...editDraft, is_active: e.target.value === 'active' })}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="What it covers">
                      <textarea rows={2} className={inputClass} value={editDraft.scope} data-testid="advisor-service-edit-scope"
                        onChange={(e) => setEditDraft({ ...editDraft, scope: e.target.value })} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                    <button type="submit" className={buttonClass} disabled={saving} data-testid="advisor-service-edit-save">
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={stopEdit}>Cancel</button>
                    <SaveNote note={editNote} />
                  </div>
                </form>
              ) : null}
            </Card>
          ))}
          <p className="text-[11px] leading-relaxed text-axal-faint">
            How many times each service has been delivered is not shown. Nothing in the product links
            a booking to a service — a booking records a free-text topic — so a count here would be a
            guess wearing the shape of a number.
          </p>
        </div>
      </ZoneBody>
    </div>
  );
}
