import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, Unreadable, Unrecorded } from '../../../ui';
import { api } from '../../../lib/api';
import { Field, SaveNote, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import { Switch } from './SessionTypesPanel';
import {
  AUDIENCE_LABEL, LINK_AUDIENCES, bookingLinkAddress, bookingLinkUrl, linkBody, linksByType,
  priceMode, suggestSlug,
} from './practiceTools';

/** Ops A3: create/toggle links, copy working /b/* addresses and show recorded opens and attributed bookings. */

export default function BookingLinksPanel({ links, types, loading = false, read = true, typesRead = true, onChanged }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [copied, setCopied] = useState('');
  const typeList = typesRead && Array.isArray(types) ? types : [];
  const groups = linksByType(typeList, links);
  const linked = new Set((Array.isArray(links) ? links : []).map((l) => l?.session_type_id).filter((id) => id != null));

  const openCreate = (type) => {
    setError(''); setNote(null);
    setForm({
      session_type_id: type ? String(type.id) : '',
      slug: suggestSlug(type?.name),
      audience: 'public',
      cohort_ref: '',
      note: '',
      requires_payout_account: priceMode(type) === 'price',
    });
  };

  const create = async (e) => {
    e.preventDefault();
    setError('');
    const res = linkBody(form);
    if (res.error) { setError(res.error); return; }
    setBusy(true); setNote(null);
    try {
      await api.createMyAdvisorBookingLink(res.body);
      setForm(null);
      setNote({ ok: true, text: `Created ${bookingLinkAddress(res.body.slug)}.` });
      await onChanged?.();
    } catch (err) {
      setError(err?.message || 'That link could not be created. Nothing was saved.');
    } finally { setBusy(false); }
  };

  const copy = async (slug) => {
    const url = bookingLinkUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(slug);
      setNote({ ok: true, text: `Copied ${url}.` });
    } catch {
      setNote({ ok: false, text: `That could not be copied. Select the address to copy it: ${url}` });
    }
  };

  const typeLabel = (link) => {
    if (link.session_type_id == null) return null;
    const type = typeList.find((t) => t.id === link.session_type_id);
    if (type) return type.name;
    return typesRead ? 'Session type not found' : 'Session type could not be read';
  };
  const toggle = async (link) => {
    setBusy(true); setNote(null);
    try {
      await api.updateMyAdvisorBookingLink(link.id, { is_active: !link.is_active });
      await onChanged?.();
      setNote({ ok: true, text: `Link ${link.is_active ? 'disabled' : 'enabled'}.` });
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'The link could not be changed.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3" data-testid="booking-links-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[11.5px] leading-relaxed text-axal-faint">
          One link per session type, to copy and hand out.
        </p>
        {read && !loading && (
          <button type="button" className={ghostButtonClass} onClick={() => (form ? setForm(null) : openCreate(null))}
            data-testid="new-booking-link">
            {form ? 'Close' : 'New link'}
          </button>
        )}
      </div>

      <p className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
        data-testid="links-not-live">
        A copied link opens its session type. Clients sign in to choose an open time and request a booking.
      </p>
      <SaveNote note={note} />

      {loading && <div className="mt-3 space-y-2" aria-busy="true"><Skeleton className="h-16" /></div>}

      {!loading && !read && (
        <div className="mt-3">
          <Unreadable what="Your booking links" claim="This is not a claim that you have none." onRetry={onChanged} />
        </div>
      )}

      {!loading && read && form && (
        <form onSubmit={create} data-testid="form-a3-create"
          className="mt-3 rounded-[10px] border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Session type">
              <select className={inputClass} value={form.session_type_id}
                onChange={(e) => {
                  const type = typeList.find((t) => String(t.id) === e.target.value) || null;
                  setForm((f) => ({ ...f, session_type_id: e.target.value, slug: f.slug || suggestSlug(type?.name) }));
                }}>
                <option value="">No session type</option>
                {typeList.map((t) => (
                  <option key={t.id} value={String(t.id)} disabled={linked.has(t.id)}>
                    {t.name}{linked.has(t.id) ? ' (has a link)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Address" hint="Lowercase letters, digits, hyphens and slashes. It must be free across Axal.">
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-[11.5px] text-axal-faint">axal.vc/b/</span>
                <input className={inputClass} value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} aria-label="Link address" />
              </div>
            </Field>
            <Field label="Who it is for">
              <select className={inputClass} value={form.audience}
                onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
                {LINK_AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
              </select>
            </Field>
            {form.audience === 'cohort' && (
              <Field label="Cohort" hint="The cohort the link admits.">
                <input className={inputClass} value={form.cohort_ref}
                  onChange={(e) => setForm((f) => ({ ...f, cohort_ref: e.target.value }))} />
              </Field>
            )}
            <Field label="Note" hint="Optional. Shown under the link here.">
              <input className={inputClass} value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </Field>
            <label className="flex items-center gap-2 self-end text-[12px]">
              <input type="checkbox" checked={form.requires_payout_account}
                onChange={(e) => setForm((f) => ({ ...f, requires_payout_account: e.target.checked }))} />
              Requires a verified payout account
            </label>
          </div>
          {error && <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300" role="alert">{error}</p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className={ghostButtonClass} onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
          </div>
        </form>
      )}

      {!loading && read && groups.length === 0 && !form && (
        <p className="mt-3 rounded-[10px] border border-dashed border-axal-hairline p-3 text-[12px] leading-relaxed text-axal-muted dark:border-gray-700"
          data-testid="booking-links-empty">
          No link and no session type yet. A link sells one session type, so create the type first.
        </p>
      )}

      {!loading && read && groups.length > 0 && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {groups.flatMap((group) => (group.links.length
            ? group.links.map((link) => (
              <LinkCard key={link.id} link={link} typeName={typeLabel(link)} copied={copied === link.slug}
                onCopy={copy} onToggle={() => toggle(link)} busy={busy} />
            ))
            : [(
              <div key={`type-${group.type.id}`} data-testid={`unlinked-a3-${group.type.id}`}
                className="flex flex-col justify-between gap-2 rounded-[10px] border border-dashed border-axal-hairline p-3 dark:border-gray-700">
                <span className="text-[12.5px] font-bold">{group.type.name}</span>
                <span className="text-[11px] text-axal-faint">No link yet.</span>
                <button type="button" className={`${ghostButtonClass} self-start`} onClick={() => openCreate(group.type)}>
                  Create link
                </button>
              </div>
            )]))}
        </div>
      )}

      {!loading && read && (
        <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">
          Opens count accepted page-open requests since recording began, including repeat visits.
          Bookings count attributed requests that have not been cancelled. Older requests have no recorded link.
          Every request you have received is on{' '}
          <Link to="/practice/opportunities" className="text-emerald-700 underline dark:text-emerald-300">Opportunities</Link>.
        </p>
      )}
    </div>
  );
}

/** One link: its type, its stored state, the address to copy, and what is not counted. */
export function LinkCard({ link, typeName, copied = false, onCopy, onToggle, busy = false }) {
  return (
    <div data-testid={`link-a3-${link.id}`}
      className="flex flex-col gap-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[12.5px] font-bold">{typeName ?? <Unrecorded>No session type</Unrecorded>}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Switch on={Boolean(link.is_active)} disabled={busy} onClick={onToggle}
            label={`${bookingLinkAddress(link.slug)} is enabled`} testid={`toggle-a3-${link.id}`} />
          <span className="text-[11px] text-axal-muted">{link.is_active ? 'Enabled' : 'Disabled'}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-900/40">
        <span className="min-w-0 truncate font-mono text-[11.5px] text-axal-muted">{bookingLinkAddress(link.slug)}</span>
        <button type="button" className="shrink-0 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300"
          onClick={() => onCopy?.(link.slug)} data-testid={`copy-a3-${link.id}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="text-[11px] leading-relaxed text-axal-faint">
        {AUDIENCE_LABEL[link.audience] || <Unrecorded>Audience not recorded</Unrecorded>}
        {link.audience === 'cohort' && link.cohort_ref ? ` (${link.cohort_ref})` : ''}
        {link.requires_payout_account ? '. Requires a verified payout account.' : '.'}
        {link.note && <span className="block">{link.note}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-axal-faint">
        <span>Opens: {link.opens_count ?? <Unrecorded reason="No open has been recorded since instrumentation began.">Not recorded</Unrecorded>}</span>
        <span>Bookings: {link.booking_count == null ? <Unrecorded>Not recorded</Unrecorded> : `${link.booking_count} attributed`}</span>
      </div>
    </div>
  );
}
