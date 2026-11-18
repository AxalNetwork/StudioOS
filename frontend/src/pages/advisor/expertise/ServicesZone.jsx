import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, MoreRows, NothingYet, SaveNote, StaleNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, dollarsToCents, ghostButtonClass, inputClass, money, refusalText,
} from './kit';
import { SERVICE_LIMITS, SUPPORTED_CURRENCIES } from '../../../lib/advisorLimits';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { FillFormBar, useScopedFill } from '../../../ui/useScopedFill.jsx';
import { usePagedList } from './pages';

const readServicesPage = (page) => api.listMyAdvisorServices(page);
import { SCOPED_FORMS } from '../../../lib/fillScoped.js';
import {
  SERVICE_BOOKABLE, SERVICE_FAILED, SERVICE_NOT_PUBLIC, SESSIONS_PATH, serviceDraftOf, serviceEditBody,
  serviceRemoveLines, publicationCounts,
} from './expertiseModel';
import ServiceCard from './ServiceCard';

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
 *
 * D4711 (#4711, Expertise P3): Remove asks first, as Proof's delete does, and
 * says what it removed. A row has one write in flight at a time, so a second
 * press cannot send a second request. Every failure is a fixed sentence keyed
 * on the Worker's refusal code (`refusalText`), never the error's own text.
 * Opening a row's edit form moves focus to its Title; closing it returns focus
 * to the button that opened it.
 *
 * D4824 (#4824, EX-06 / EX-07): a card shows the publication state the Worker
 * stores — Draft, Published or Hidden (D5315 part 3) — with one action to move
 * it (Publish, Hide, Publish again) and an Undo that puts the previous state
 * back. Active / Inactive is no longer a control here: the Worker moves it with
 * the publication state, and two state dials on one card is what #4824 asked to
 * remove. Preview opens the public profile, where only Published services show.
 * Booking stays with Practice › Sessions (#4832); the card links there read-only.
 */

const KINDS = [
  ['fixed', 'Fixed', 'One engagement, one price.'],
  ['package', 'Package', 'A bundle of sessions or deliverables.'],
  ['retainer', 'Retainer', 'Recurring, usually monthly.'],
];

const BLANK = { title: '', kind: 'fixed', duration_note: '', price: '', currency: 'USD', scope: '' };

export default function ServicesZone() {
  // #4689: a page at a time; the tiles read `counts`, the whole list's figures.
  const list = usePagedList(readServicesPage, { errorText: 'Your services could not be read.' });
  const state = { loading: list.loading, error: list.error, items: list.rows };
  const counts = list.res?.counts || null;
  const load = list.load;
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
  // D4711: the row asking "Remove …?", and the rows with a write in flight.
  const [confirming, setConfirming] = useState(null);
  const [pending, setPending] = useState(() => new Set());
  const pendingRef = useRef(new Set());
  const editTitleRef = useRef(null);
  const rowButtons = useRef({});
  const [returnFocus, setReturnFocus] = useState(null);
  // D4824: the last publication change, so its Undo can put the previous state back.
  const [undo, setUndo] = useState(null);
  // The public profile's address, for Preview. A read that fails leaves Preview off rather than guessing a link.
  const [uid, setUid] = useState(null);
  useEffect(() => {
    let live = true;
    api.getMyAdvisor?.().then((p) => { if (live) setUid(p?.uid || null); }, () => {});
    return () => { live = false; };
  }, []);
  const claim = (id) => {
    if (pendingRef.current.has(id)) return false;
    pendingRef.current.add(id);
    setPending(new Set(pendingRef.current));
    return true;
  };
  const release = (id) => {
    pendingRef.current.delete(id);
    setPending(new Set(pendingRef.current));
  };
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

  useEffect(() => { load(); }, [load]);
  // D4711: an opened edit form takes focus at its Title; a closed one, or a
  // closed "Remove …?", hands it back to the row's own button.
  useEffect(() => { if (editing != null) editTitleRef.current?.focus?.(); }, [editing]);
  useEffect(() => {
    if (!returnFocus) return;
    rowButtons.current[returnFocus]?.focus?.();
    setReturnFocus(null);
  }, [returnFocus]);

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
        currency: draft.currency,
        scope: draft.scope.trim() || null,
      });
      await fill.afterSave(created?.id);
      setDraft(BLANK);
      setNote({ ok: true, text: 'Service added.' });
      await list.refresh();
    } catch (err) {
      setNote({ ok: false, text: refusalText(err, SERVICE_FAILED.add) });
    } finally {
      setBusy(false);
    }
  };

  // D4824: move a service's publication state. `undoOf` is the state to go back
  // to; an Undo is itself a move, and offers no Undo of its own.
  const setPublication = async (row, to, done, undoOf = null) => {
    if (!claim(row.id)) return;
    setNote(null);
    setUndo(null);
    try {
      await api.updateMyAdvisorService(row.id, { publication_state: to });
      // With an Undo the toast says it, once; an Undo itself is said in the note.
      if (undoOf) setUndo({ id: row.id, title: row.title, to: undoOf, done });
      else setNote({ ok: true, text: `“${row.title}” is ${done}.` });
      await list.refresh();
    } catch (err) {
      setNote({ ok: false, text: refusalText(err, SERVICE_FAILED.publish) });
    } finally {
      release(row.id);
    }
  };
  const undoLast = () => {
    if (!undo) return;
    const { id, title, to } = undo;
    const back = to === 'published' ? 'published on your public profile again'
      : to === 'hidden' ? 'hidden from your public profile again' : 'back to Draft';
    // The row as it now stands, so a title edited since is the one said.
    const row = state.items.find((r) => r.id === id) || { id, title };
    setPublication(row, to, back);
  };

  const startEdit = (row) => { setEditing(row.id); setEditDraft(serviceDraftOf(row)); setEditNote(null); };
  const stopEdit = () => {
    if (editing != null) setReturnFocus(`edit-${editing}`);
    setEditing(null); setEditNote(null);
  };
  const saveEdit = async (e, row) => {
    e.preventDefault();
    const parsed = dollarsToCents(editDraft.price);
    if (parsed.error) { setEditNote({ ok: false, text: parsed.error }); return; }
    const { body, error } = serviceEditBody(row, editDraft, parsed.cents);
    if (error) { setEditNote({ ok: false, text: error }); return; }
    if (!Object.keys(body).length) { stopEdit(); return; }
    setSaving(true);
    try {
      // D4674: only the changed fields are sent, with the revision this form was
      // opened on, so an edit made elsewhere in the meantime is a conflict and
      // not a silent overwrite.
      const saved = await api.updateMyAdvisorService(row.id, { ...body, revision: row.updated_at });
      // The form is reset from what the server stored, not from what was typed.
      setEditDraft(serviceDraftOf(saved));
      stopEdit();
      setNote({ ok: true, text: 'Service saved.' });
      await list.refresh();
    } catch (err) {
      if (err?.code === 'revision_conflict' || err?.status === 409) {
        // Show the row as it now stands, and keep what the person typed visible
        // in the note rather than saving it over a change they have not seen.
        const current = err?.data?.current;
        if (current) setEditDraft(serviceDraftOf(current));
        setEditNote({ ok: false, text: err?.message || 'This service was changed somewhere else. It is shown as it now stands; your change was not saved.' });
        await list.refresh();
      } else {
        setEditNote({ ok: false, text: refusalText(err, SERVICE_FAILED.edit) });
      }
    } finally {
      setSaving(false);
    }
  };

  const keep = (row) => { setConfirming(null); setReturnFocus(`remove-${row.id}`); };
  const remove = async (row) => {
    if (!claim(row.id)) return;
    setNote(null);
    try {
      await api.deleteMyAdvisorService(row.id);
      setConfirming(null);
      setNote({ ok: true, text: `Removed “${row.title}”.` });
      await list.refresh();
    } catch (err) {
      if (err?.status === 404) {
        // Another tab, or an earlier press, already removed it: say so, and redraw.
        setConfirming(null);
        setNote({ ok: true, text: `“${row.title}” was already removed.` });
        await list.refresh();
      } else {
        setNote({ ok: false, text: refusalText(err, SERVICE_FAILED.remove) });
      }
    } finally {
      release(row.id);
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
  const pubCounts = publicationCounts(list.res, state.items);
  const previewPath = uid ? `/advisors/${encodeURIComponent(uid)}` : null;

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
            { label: 'Services', value: String(counts?.total ?? state.items.length), note: counts ? `${counts.priced} priced, ${counts.unpriced} not` : `${priced.length} priced, ${unpriced.length} not` },
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
            { label: 'Unpriced', value: String(counts?.unpriced ?? unpriced.length), note: (counts?.unpriced ?? unpriced.length) ? 'scope settled, price is not' : 'all priced' },
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
        <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="advisor-service-add">
          <Field label="Title" fill={{ ctl: fill, name: 'title', value: draft.title }}>
            <input ref={titleRef} className={inputClass} value={draft.title} data-testid="advisor-service-title" maxLength={SERVICE_LIMITS.title}
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
            <input className={inputClass} value={draft.price} inputMode="decimal" data-testid="advisor-service-price"
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder="2500" />
          </Field>
          <Field label="Currency" hint="Chosen, not assumed: the price is in this currency.">
            <select className={inputClass} value={draft.currency} data-testid="advisor-service-currency"
              onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Duration" hint="In your own words.">
            <input className={inputClass} value={draft.duration_note} maxLength={SERVICE_LIMITS.duration_note}
              onChange={(e) => setDraft({ ...draft, duration_note: e.target.value })}
              placeholder="One day, on site" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="What it covers" fill={{ ctl: fill, name: 'scope', value: draft.scope }}>
              <textarea rows={2} className={inputClass} value={draft.scope} maxLength={SERVICE_LIMITS.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Adding…' : 'Add service'}
            </button>
            <SaveNote note={note} testid="advisor-services-note" />
          </div>
        </form>
      </Card>

      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('expertise/services', { value: view, onChange: setView })}
        actions={advisorZoneActions('expertise/services', { handlers: { focusAddForm }, view: { header: ['Service', 'Kind', 'Active', 'Price (minor units)', 'Currency', 'Units sold'], rows: shown, cells: (r) => [r.title, r.kind, r.is_active, r.price_cents, r.currency, r.units_sold] } })}
      />
      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        notice={<StaleNote error={list.refreshError} onRetry={list.refresh} testid="advisor-services-stale" />}
        isEmpty={state.items.length === 0} empty={empty}>
        {shown.length === 0 && (
          <p className="text-[12.5px] text-axal-muted">{`No ${view} service is listed. ${counts?.total ?? state.items.length} in total.`}</p>
        )}
        <p className="mb-2 text-[12px] text-axal-muted" data-testid="advisor-services-publication-counts">
          {`${pubCounts.published} published · ${pubCounts.draft} draft · ${pubCounts.hidden} hidden`}
        </p>
        <UndoNote text={undo?.done ? `“${state.items.find((r) => r.id === undo?.id)?.title ?? undo?.title}” is ${undo?.done}.` : null}
          busy={pending.has(undo?.id)} onUndo={undoLast} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((row) => (
            <ServiceCard key={row.id} row={row}
              wide={editing === row.id || confirming === row.id}
              editing={editing === row.id} confirming={confirming === row.id}
              busy={pending.has(row.id)} previewPath={previewPath}
              buttonRef={(key, n) => { rowButtons.current[`${key}-${row.id}`] = n; }}
              onEdit={() => (editing === row.id ? stopEdit() : startEdit(row))}
              onPublication={(action, from) => setPublication(row, action.to, action.done, from)}
              onAskRemove={() => setConfirming(confirming === row.id ? null : row.id)}>
              {confirming === row.id ? (
                <ConfirmRemove row={row} busy={pending.has(row.id)} onKeep={() => keep(row)} onRemove={() => remove(row)} />
              ) : null}
              {editing === row.id ? (
                <form onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault?.(); stopEdit(); } }} onSubmit={(e) => saveEdit(e, row)} className="mt-3 grid grid-cols-1 gap-3 border-t border-axal-hairline pt-3 sm:grid-cols-2 dark:border-gray-700"
                  data-testid={`advisor-service-form-${row.id}`}>
                  <Field label="Title">
                    <input ref={editTitleRef} className={inputClass} value={editDraft.title} data-testid="advisor-service-edit-title" maxLength={SERVICE_LIMITS.title}
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
                  <Field label="Currency" hint="Changing it means entering the price in the new currency too.">
                    <select className={inputClass} value={editDraft.currency} data-testid="advisor-service-edit-currency"
                      onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value })}>
                      {(SUPPORTED_CURRENCIES.includes(editDraft.currency) ? SUPPORTED_CURRENCIES : [editDraft.currency, ...SUPPORTED_CURRENCIES])
                        .map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Duration">
                    <input className={inputClass} value={editDraft.duration_note} data-testid="advisor-service-edit-duration" maxLength={SERVICE_LIMITS.duration_note}
                      onChange={(e) => setEditDraft({ ...editDraft, duration_note: e.target.value })} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="What it covers">
                      <textarea rows={2} className={inputClass} value={editDraft.scope} data-testid="advisor-service-edit-scope" maxLength={SERVICE_LIMITS.scope}
                        onChange={(e) => setEditDraft({ ...editDraft, scope: e.target.value })} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                    <button type="submit" className={buttonClass} disabled={saving} data-testid="advisor-service-edit-save">
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={stopEdit}>Cancel</button>
                    <SaveNote note={editNote} testid={`advisor-service-edit-note-${row.id}`} />
                  </div>
                </form>
              ) : null}
            </ServiceCard>
          ))}
        </div>
        <div className="space-y-3">
          <MoreRows line={list.line} onMore={list.more} busy={list.moreBusy} error={list.moreError} testid="advisor-services-more" />
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

/**
 * D4711: "Remove …?" asked in place, on the row, the way Proof asks before a
 * delete. Focus starts on the safe answer; Escape is "Keep it".
 */
function ConfirmRemove({ row, busy, onKeep, onRemove }) {
  const keepRef = useRef(null);
  const titleId = React.useId();
  const bodyId = React.useId();
  useEffect(() => { keepRef.current?.focus?.(); }, []);
  return (
    <div role="alertdialog" aria-labelledby={titleId} aria-describedby={bodyId} data-testid={`advisor-service-confirm-${row.id}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault?.(); onKeep(); } }}
      className="mt-3 rounded-[10px] border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
      <div id={titleId} className="text-[12.5px] font-bold">{`Remove “${row.title}”?`}</div>
      <ul id={bodyId} className="m-0 mt-1 list-disc pl-5 text-[12px] leading-relaxed text-axal-muted">
        {serviceRemoveLines(row).map((l) => <li key={l}>{l}</li>)}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" ref={keepRef} className={ghostButtonClass} onClick={onKeep} data-testid={`advisor-service-keep-${row.id}`}>Keep it</button>
        <button type="button" disabled={busy} onClick={onRemove} data-testid={`advisor-service-remove-confirm-${row.id}`}
          className="inline-flex min-h-[32px] items-center rounded-lg bg-axal-destructive px-3 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </div>
  );
}

/**
 * D4824 (EX-06): the toast after a publication change, with its Undo. It sits
 * in the page, not over it, so it is never in the way of the next card, and
 * stays until the next change replaces it.
 */
function UndoNote({ text, busy, onUndo }) {
  // The live region is always mounted (D4711): a region that arrives with its
  // text is not announced.
  return (
    <div role="status" aria-live="polite" data-testid="advisor-service-undo">
      {text ? (
        <div className="mb-3 inline-flex flex-wrap items-center gap-3 rounded-[10px] border border-axal-hairline bg-white px-3 py-1 text-[12px] font-semibold shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <span aria-hidden="true" className="text-emerald-700 dark:text-emerald-300">✓</span>
          <span>{text}</span>
          <button type="button" onClick={onUndo} disabled={busy} data-testid="advisor-service-undo-button"
            aria-label={`Undo: ${text}`}
            className="min-h-[44px] px-2 font-bold text-emerald-700 underline disabled:opacity-50 dark:text-emerald-300">
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}
