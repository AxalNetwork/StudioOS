import React, { useState } from 'react';
import { Pill, Skeleton, Unreadable, Unrecorded } from '../../../ui';
import { api } from '../../../lib/api';
import { Field, SaveNote, buttonClass, ghostButtonClass, inputClass, money } from '../expertise/kit';
import {
  PRICE_MODES, bookableState, canBeBookable, priceMode, sessionTypeBody, sessionTypeForm,
} from './practiceTools';

/** Ops A2: explicit price/free/included facts and server-enforced bookable controls, with attributed booking counts. */

const LABEL = 'text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint';
const GRID = 'grid grid-cols-2 gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,2fr)_72px_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center';

/** The canvas's bookable switch. A disabled one says why on hover. */
export function Switch({ on, disabled = false, onClick, label, title, testid }) {
  return (
    <button type="button" role="switch" aria-checked={on ? 'true' : 'false'} aria-label={label}
      title={title} disabled={disabled} onClick={onClick} data-testid={testid}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-emerald-700' : 'bg-gray-300 dark:bg-gray-600'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform dark:bg-gray-100 ${on ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
    </button>
  );
}

/** The price cell: four outcomes, and a null is never a zero. */
export function PriceCell({ type }) {
  const mode = priceMode(type);
  if (mode === 'free') return <span className="text-[12.5px] font-bold">Free intro</span>;
  if (mode === 'included') {
    return <span className="text-[12.5px] font-bold">Included <span className="text-[11px] font-normal text-axal-faint">no separate charge</span></span>;
  }
  if (mode === 'price') return <span className="text-[12.5px] font-bold tabular-nums">{money(type.price_cents)}</span>;
  return (
    <span className="text-[11.5px]">
      <Unrecorded reason="No price is set, and none is assumed.">Not recorded</Unrecorded>
      <span className="text-axal-faint"> · no price set</span>
    </span>
  );
}

export default function SessionTypesPanel({ types, loading = false, read = true, onChanged }) {
  // null, 'new', or the id of the type being edited.
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);
  const list = Array.isArray(types) ? types : [];

  /** Resolves to null on success, or to the refusal the editor shows. */
  const save = async (body, existing) => {
    setBusy('save'); setNote(null);
    try {
      if (existing) {
        await api.updateMyAdvisorSessionType(existing.id, body);
        setNote({ ok: true, text: `Saved “${body.name}”.` });
      } else {
        await api.createMyAdvisorSessionType(body);
        const bookable = body.is_active;
        setNote({ ok: true, text: `Created “${body.name}”, ${bookable ? 'bookable' : 'not bookable'}.` });
      }
      setEditor(null);
      await onChanged?.();
      return null;
    } catch (err) {
      return err?.message || 'That session type could not be saved. Nothing was changed.';
    } finally { setBusy(''); }
  };

  const toggle = async (type) => {
    const next = !type.is_active;
    if (next && !canBeBookable(type)) {
      setNote({ ok: false, text: 'A type with no price cannot be bookable. Set a price or mark it included first.' });
      return;
    }
    setBusy(`t-${type.id}`); setNote(null);
    try {
      await api.updateMyAdvisorSessionType(type.id, { is_active: next });
      setNote({ ok: true, text: `“${type.name}” is ${next ? 'bookable' : 'not bookable'} now.` });
      await onChanged?.();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be changed. Nothing was saved.' });
    } finally { setBusy(''); }
  };

  return (
    <div className="mt-3" data-testid="session-types-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[11.5px] leading-relaxed text-axal-faint">
          What a client can book. Each type has a length, a price or &ldquo;included&rdquo;, and a bookable switch.
        </p>
        {read && !loading && (
          <button type="button" className={ghostButtonClass} onClick={() => setEditor(editor === 'new' ? null : 'new')}
            data-testid="new-session-type">
            {editor === 'new' ? 'Close' : 'New session type'}
          </button>
        )}
      </div>
      <SaveNote note={note} />

      {loading && <div className="mt-3 space-y-2" aria-busy="true"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>}

      {!loading && !read && (
        <div className="mt-3">
          <Unreadable what="Your session types" claim="This is not a claim that you offer none." onRetry={onChanged} />
        </div>
      )}

      {!loading && read && editor === 'new' && (
        <div className="mt-3"><SessionTypeEditor busy={busy === 'save'} onCancel={() => setEditor(null)} onSave={save} /></div>
      )}

      {!loading && read && list.length === 0 && editor !== 'new' && (
        <p className="mt-3 rounded-[10px] border border-dashed border-axal-hairline p-3 text-[12px] leading-relaxed text-axal-muted dark:border-gray-700"
          data-testid="session-types-empty">
          No session types yet. Clients cannot book until one is bookable.
        </p>
      )}

      {!loading && read && list.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-[10px] border border-axal-hairline dark:border-gray-700">
          <div className={`${GRID} hidden border-b border-axal-hairline bg-axal-ground px-3 py-2 md:grid dark:border-gray-700 dark:bg-gray-900/40`}>
            <span className={LABEL}>Name</span>
            <span className={LABEL}>Length</span>
            <span className={LABEL}>Price</span>
            <span className={LABEL}>Bookable</span>
            <span className={LABEL}>Bookings</span>
            <span />
          </div>
          {list.map((type) => (
            <TypeRow key={type.id} type={type} busy={busy} editing={editor === type.id}
              onToggle={() => toggle(type)} onEdit={() => setEditor(editor === type.id ? null : type.id)}
              onCancel={() => setEditor(null)} onSave={save} />
          ))}
        </div>
      )}

      {read && !loading && (
        <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">
          A type with no price reads <Unrecorded>Not recorded</Unrecorded> and cannot be bookable until a price or
          &ldquo;included&rdquo; is set. Counts include bookings attributed to this type; older bookings have no recorded type.
        </p>
      )}
    </div>
  );
}

function TypeRow({ type, busy, editing, onToggle, onEdit, onCancel, onSave }) {
  const state = bookableState(type);
  const blocked = state === 'off' && !canBeBookable(type);
  return (
    <div className="border-b border-axal-hairline last:border-b-0 dark:border-gray-800" data-testid={`type-a2-${type.id}`}>
      <div className={`${GRID} px-3 py-2.5`}>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <div className="text-[12.5px] font-bold">{type.name}</div>
          {type.cadence_note && <div className="text-[11px] text-axal-faint">{type.cadence_note}</div>}
        </div>
        <div className="text-[12px] tabular-nums">
          <span className={`${LABEL} mr-1.5 md:hidden`}>Length</span>
          {type.duration_minutes != null
            ? `${type.duration_minutes} min`
            : <Unrecorded reason="No length is set for this type.">Not recorded</Unrecorded>}
        </div>
        <div>
          <span className={`${LABEL} mr-1.5 md:hidden`}>Price</span>
          <PriceCell type={type} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Switch on={Boolean(type.is_active)} disabled={blocked || busy === `t-${type.id}`} onClick={onToggle}
            label={`${type.name} is bookable`} testid={`toggle-a2-${type.id}`}
            title={blocked ? 'Set a price or mark it included first.' : undefined} />
          <span className="text-[11.5px] text-axal-muted">{type.is_active ? 'Bookable' : 'Not bookable'}</span>
          {state === 'unpriced_on' && <Pill tone="warn">Bookable with no price</Pill>}
        </div>
        <div className="text-[12px]">
          <span className={`${LABEL} mr-1.5 md:hidden`}>Bookings</span>
          {type.booking_count == null ? <Unrecorded>Not recorded</Unrecorded> : `${type.booking_count} attributed`}
        </div>
        <div className="col-span-2 md:col-span-1 md:text-right">
          <button type="button" className={ghostButtonClass} onClick={onEdit} data-testid={`edit-a2-${type.id}`}>
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>
      {editing && (
        <div className="px-3 pb-3">
          <SessionTypeEditor type={type} busy={busy === 'save'} onCancel={onCancel} onSave={onSave} />
        </div>
      )}
    </div>
  );
}

/**
 * The canvas's "Edit session type" panel, for a new type or a stored one.
 * `onSave(body, type)` resolves to null on success or to the route's refusal,
 * shown here, under the form.
 */
export function SessionTypeEditor({ type = null, busy = false, onCancel, onSave }) {
  const [form, setForm] = useState(() => sessionTypeForm(type));
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const name = `price-mode-${type?.id ?? 'new'}`;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const res = sessionTypeBody(form);
    if (res.error) { setError(res.error); return; }
    const refusal = await onSave?.(res.body, type);
    if (refusal) setError(refusal);
  };

  return (
    <form onSubmit={submit} data-testid={`editor-a2-${type?.id ?? 'new'}`}
      className="rounded-[10px] border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="text-[12.5px] font-extrabold tracking-tight">{type ? 'Edit session type' : 'New session type'}</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Length" hint="Minutes.">
          <input className={inputClass} value={form.duration} inputMode="numeric" onChange={set('duration')} placeholder="60" />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Price</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {PRICE_MODES.map((m) => (
              <label key={m.key} className="flex items-center gap-1.5 text-[12px]">
                <input type="radio" name={name} value={m.key} checked={form.mode === m.key}
                  onChange={() => setForm((f) => ({ ...f, mode: m.key, bookable: m.key === 'unset' ? false : f.bookable }))} />
                {m.label}{m.hint && <span className="text-axal-faint">({m.hint.toLowerCase()})</span>}
              </label>
            ))}
          </div>
          {form.mode === 'price' && (
            <input className={`${inputClass} sm:max-w-[200px]`} value={form.amount} inputMode="decimal"
              onChange={set('amount')} placeholder="280" aria-label="Price in dollars" />
          )}
        </fieldset>
        <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
          <input type="checkbox" checked={form.bookable} disabled={form.mode === 'unset'}
            onChange={(e) => setForm((f) => ({ ...f, bookable: e.target.checked }))} />
          <span>
            Bookable
            {form.mode === 'unset' && <span className="text-axal-faint">: set a price or mark it included first</span>}
          </span>
        </label>
        <Field label="Line under the name" hint="Optional. For example: one per client, or 2 sessions and async.">
          <input className={inputClass} value={form.note} onChange={set('note')} />
        </Field>
      </div>
      {error && <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className={ghostButtonClass} onClick={onCancel}>Cancel</button>
        <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
