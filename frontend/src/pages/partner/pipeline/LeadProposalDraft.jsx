// A lead's proposal draft in the opportunity sheet: Save draft, Edit, Discard and an Eadwyn start (D4838 part 10, #5936).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { partnerLeadDraftsApi } from '../../../lib/api/partnerLeadDrafts';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import useAiSpend from '../../../hooks/useAiSpend';
import { Field, inputClass, buttonClass, ghostButtonClass } from '../kit';
import { NotRecorded } from '../../../workspaces/canvasKit';
import { formatMinor, parseMinor, toMajorString } from '../../../lib/money.js';

/**
 * PP03c — Draft proposal, built to the owner's answer A on #5936.
 *
 * A DRAFT IS NOT A PROPOSAL, AND NOTHING HERE SAYS ONE WAS SENT. The draft is the firm's working
 * shape for a lead it has not bid on (`partner_lead_proposal_drafts`). A proposal exists only once
 * the firm bids, on Proposals. So every label on this block ends "not sent", and there is no Send.
 *
 * EADWYN STARTS A DRAFT; IT NEVER SAVES ONE BY ITSELF. The band is the Leads page's own Eadwyn
 * surface (`pipeline/leads`) scoped to this one lead, with its cost shown before the run (D424).
 * Accepting it stores its text as this lead's scope with `origin: eadwyn`, which keeps the
 * "Eadwyn proposal · not sent" mark through any later edit.
 */

export const SHAPES = [['fixed_project', 'Fixed project'], ['retainer', 'Retainer'], ['time_and_materials', 'Time and materials']];
const SHAPE_LABEL = Object.fromEntries(SHAPES);

/** The block's label: who started the draft, and that it has not been sent. */
export function draftLabel(draft) {
  return draft?.origin === 'eadwyn' ? 'Eadwyn proposal · not sent' : 'Draft proposal · not sent';
}

/** "$12,500.00" from minor units (lib/money.js), or null when no price is recorded or the currency is not one StudioOS prices in. */
export function draftPrice(draft) {
  if (draft?.price_cents == null) return null;
  return formatMinor(draft.price_cents, draft.currency || 'USD', { locale: 'en-US' });
}

/**
 * The form's fields to the write's body. A price is typed in whole currency units (it may carry
 * cents); anything that is not a non-negative number is an error, never a guess.
 */
export function draftBody(form, origin) {
  const currency = String(form.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency is a three-letter code, such as USD.' };
  const typed = String(form.price ?? '').replace(/[\s$]/g, '');
  let price_cents = null;
  if (typed !== '') {
    // lib/money.js reads major units to minor units exactly, in the currency's own decimals.
    const parsed = parseMinor(typed, currency);
    if (!parsed.ok) return { error: parsed.reason === 'currency' ? parsed.message : `Price must be a number, zero or more. ${parsed.message}` };
    price_cents = parsed.minor;
  }
  const scope = String(form.scope || '').trim();
  const shape = form.shape || null;
  if (!shape && price_cents == null && !scope) return { error: 'Add a shape, a price or a scope, or discard the draft.' };
  return { body: { shape, price_cents, currency, scope: scope || null, ...(origin ? { origin } : {}) } };
}

const formOf = (d) => ({
  shape: d?.shape || '',
  price: d?.price_cents == null ? '' : (toMajorString(d.price_cents, d?.currency || 'USD') ?? ''),
  currency: d?.currency || 'USD',
  scope: d?.scope || '',
});

/**
 * @param {object} props
 * @param {number} props.needId
 * @param {string} props.leadName   the lead as the zone names it (the client, else the need's title)
 * @param {string|null} [props.company]  the client company, where recorded, for the discard question
 * @param {object} [props.api]  the draft writes, for a test
 * @param {object} [props.ai]   the host's `useAiSpend()` result, for a test; read here otherwise
 */
export default function LeadProposalDraft({ needId, leadName, company = null, api = partnerLeadDraftsApi, ai: aiProp }) {
  const spend = useAiSpend({ enabled: !aiProp });
  const ai = aiProp || spend;
  const [read, setRead] = useState({ status: 'loading', draft: null, message: null });
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setRead((r) => ({ ...r, status: 'loading' }));
    try {
      const r = await api.get(needId);
      if (!alive.current) return;
      setRead({ status: 'ready', draft: r?.draft || null, message: null });
    } catch (e) {
      if (!alive.current) return;
      setRead({ status: e?.status === 409 ? 'refused' : 'unreadable', draft: null, message: e?.message || null });
    }
  }, [api, needId]);
  useEffect(() => { load(); }, [load]);

  const save = async (fields, origin) => {
    const built = draftBody(fields, origin);
    if (built.error) { setNote({ ok: false, text: built.error }); return false; }
    setBusy(true); setNote(null);
    try {
      const r = await api.save(needId, built.body);
      if (!alive.current) return false;
      setRead({ status: 'ready', draft: r?.draft || null, message: null });
      setForm(null);
      setNote({ ok: true, text: 'Draft saved. It has not been sent.' });
      return true;
    } catch (e) {
      if (alive.current) setNote({ ok: false, text: e?.message || 'The draft could not be saved.' });
      return false;
    } finally { if (alive.current) setBusy(false); }
  };

  const discard = async () => {
    setBusy(true); setNote(null);
    try {
      await api.discard(needId);
      if (!alive.current) return;
      setRead({ status: 'ready', draft: null, message: null });
      setConfirm(false); setForm(null);
      setNote({ ok: true, text: 'Draft discarded. The lead is still on your list.' });
    } catch (e) {
      if (alive.current) setNote({ ok: false, text: e?.message || 'The draft could not be discarded.' });
    } finally { if (alive.current) setBusy(false); }
  };

  const who = company && company !== leadName ? `${leadName} (${company})` : leadName;
  const draft = read.draft;

  let content;
  if (read.status === 'loading') {
    content = <p className="text-[12.5px] text-axal-muted" aria-busy="true" data-testid="lead-draft-loading">Reading the draft…</p>;
  } else if (read.status === 'refused') {
    content = <p className="text-[12.5px] text-axal-muted" data-testid="lead-draft-refused">{read.message || 'This is no longer a lead, so it has no draft here.'}</p>;
  } else if (read.status === 'unreadable') {
    content = (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert" data-testid="lead-draft-unreadable">
        Unreadable: the draft could not be read. This is not a claim that there is none.
        <button type="button" className={`${ghostButtonClass} ml-2`} onClick={load}>Try again</button>
      </div>
    );
  } else if (form) {
    content = (
      <form className="grid gap-3" data-testid="lead-draft-form"
        onSubmit={(e) => { e.preventDefault(); save(form, draft ? undefined : 'manual'); }}>
        <Field label="Shape">
          <select className={inputClass} value={form.shape} data-testid="lead-draft-shape"
            onChange={(e) => setForm((f) => ({ ...f, shape: e.target.value }))}>
            <option value="">Not chosen</option>
            {SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <Field label="Price">
            <input className={inputClass} inputMode="decimal" value={form.price} data-testid="lead-draft-price"
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
          </Field>
          <Field label="Currency">
            <input className={inputClass} maxLength={3} value={form.currency} data-testid="lead-draft-currency"
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
          </Field>
        </div>
        <Field label="Scope" hint="What the firm would do, in its own words.">
          <textarea className={`${inputClass} min-h-[96px]`} maxLength={4000} value={form.scope} data-testid="lead-draft-scope"
            onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))} />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={`${ghostButtonClass} min-h-[44px] sm:min-h-0`} disabled={busy}
            onClick={() => { setForm(null); setNote(null); }}>Cancel</button>
          <button type="submit" className={`${buttonClass} min-h-[44px] sm:min-h-0`} disabled={busy} data-testid="lead-draft-save">Save draft</button>
        </div>
      </form>
    );
  } else if (draft) {
    content = (
      <div className="grid gap-2" data-testid="lead-draft">
        <p className="m-0 text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-amber-deep dark:text-amber-300" data-testid="lead-draft-label">{draftLabel(draft)}</p>
        <dl className="m-0 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-axal-muted">Shape</dt><dd className="m-0">{SHAPE_LABEL[draft.shape] || <NotRecorded />}</dd>
          <dt className="text-axal-muted">Price</dt><dd className="m-0 font-mono">{draftPrice(draft) || <NotRecorded />}</dd>
          <dt className="text-axal-muted">Scope</dt><dd className="m-0 whitespace-pre-wrap">{draft.scope || <NotRecorded />}</dd>
        </dl>
        {confirm ? (
          <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 text-[12.5px] dark:border-gray-700 sm:flex-row sm:items-center" data-testid="lead-draft-discard-confirm">
            <span className="flex-1">Discard the draft proposal for {who}? The lead stays on your list.</span>
            <button type="button" className={`${ghostButtonClass} min-h-[44px] sm:min-h-0`} disabled={busy} onClick={() => setConfirm(false)}>Keep draft</button>
            <button type="button" className={`${buttonClass} min-h-[44px] sm:min-h-0`} disabled={busy} onClick={discard} data-testid="lead-draft-discard-yes">Discard draft</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={`${ghostButtonClass} min-h-[44px] sm:min-h-0`} disabled={busy}
              onClick={() => { setForm(formOf(draft)); setNote(null); }} data-testid="lead-draft-edit">Edit</button>
            <button type="button" className={`${ghostButtonClass} min-h-[44px] sm:min-h-0`} disabled={busy}
              onClick={() => { setConfirm(true); setNote(null); }} data-testid="lead-draft-discard">Discard</button>
          </div>
        )}
      </div>
    );
  } else {
    content = (
      <div className="grid gap-2" data-testid="lead-draft-none">
        <p className="m-0 text-[12.5px] text-axal-muted">No draft for this lead yet. Write one, or start from Eadwyn below.</p>
        <div>
          <button type="button" className={`${buttonClass} min-h-[44px] sm:min-h-0`}
            onClick={() => { setForm(formOf(null)); setNote(null); }} data-testid="lead-draft-new">Write a draft</button>
        </div>
      </div>
    );
  }

  return (
    <section className="grid gap-3 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="lead-proposal-draft" aria-label="Draft proposal">
      <h3 className="mb-0 text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Draft proposal</h3>
      {content}
      {note && (
        <p role={note.ok ? 'status' : 'alert'} className={`m-0 text-[12px] ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`} data-testid="lead-draft-note">{note.text}</p>
      )}
      {read.status === 'ready' && !form && (
        <ZoneDraft
          surface="pipeline/leads" scopeKey={String(needId)} scoped railOption="draft:proposal" ai={ai}
          label="Eadwyn proposal · not sent"
          run="Draft with Eadwyn"
          accept="Use as this lead's draft"
          foot="Shaped from your own catalogue and floor. Using it saves a draft; nothing is sent."
          empty={`An outline for ${leadName}, from your listed services, your stated floor and the client's own words.`}
          nothingToDraft="This is not one of your open leads, so Eadwyn has nothing to draft from."
          onAccepted={(item) => { if (item?.body) save({ ...formOf(draft), scope: item.body }, 'eadwyn'); }}
        />
      )}
    </section>
  );
}
