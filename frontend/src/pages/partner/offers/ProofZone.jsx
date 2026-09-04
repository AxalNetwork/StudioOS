import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  StatCard, Section, Field, SaveNote, NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';

/**
 * Offers · Proof — `/offers/proof`.
 *
 * CONSENT IS A GATE, NOT A WARNING. That sentence is the zone, and it decides
 * every rendering choice below. An outcome the client has not agreed to publish
 * has no published form to suppress — it simply is not one — so this page never
 * shows a case study with a "not confirmed" badge beside it and calls that
 * caution. It shows two different things: what the firm has published, and what
 * the firm is currently only asserting about itself.
 *
 * PUBLISHED IS DERIVED, NEVER STORED. The worker computes it as
 * `consent_given = 1 AND withdrawn_at IS NULL`, both halves, at read time.
 * There is no API method to set it and no control on this page that could —
 * which is the point: a storefront that could mark its own evidence as
 * confirmed is a storefront with no evidence in it.
 *
 * THE FIRM CAN ONLY EVER RECORD A WITHDRAWAL. Granting is the token holder's
 * alone. The asymmetry is deliberate and it runs the right way: a client who
 * tells the firm "take that down" is served immediately, and a firm that would
 * like a yes has to go and get one.
 *
 * WITHDRAWAL IS A STATE, NOT A DELETE. A withdrawn consent stays on the record
 * saying it was given and taken back, because a consent that can silently
 * vanish is not evidence — and because a firm that could delete a refusal could
 * re-ask until it got a different answer with nothing on the record.
 *
 * THE TOKEN IS SHOWN EXACTLY ONCE. It is the client's credential for answering;
 * a firm that could read it back could answer on the client's behalf. The
 * response to the request carries it, no later read does, and this page says so
 * rather than letting someone close the panel and come looking for it.
 */

const KINDS = [
  ['case_study', 'Case study'],
  ['outcome', 'Outcome'],
  ['testimonial', 'Testimonial'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

function ConsentRow({ consent, onWithdraw, busy }) {
  const live = consent.consent_given && !consent.withdrawn_at;
  return (
    <div className="border-t border-axal-hairline py-2 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-semibold">{consent.consenter_name}</span>
            {consent.consenter_role && <span className="text-axal-ink-3">{consent.consenter_role}</span>}
            {live && <Pill tone="ok">Agreed</Pill>}
            {consent.withdrawn_at && <Pill tone="neutral">Withdrawn</Pill>}
            {!live && !consent.withdrawn_at && <Pill tone="warn">Not answered</Pill>}
          </div>
          {consent.consent_text && (
            /* The exact words agreed to, quoted. Consent to "a case study" and
               consent to "a case study naming our revenue" are different
               consents, so a boolean cannot stand in for the wording. */
            <p className="mt-1 max-w-xl text-[12px] italic leading-relaxed text-axal-ink-2">
              “{consent.consent_text}”
            </p>
          )}
          <div className="mt-0.5 text-[11px] text-axal-ink-3">
            {consent.requested_at && <>Asked {formatDay(consent.requested_at)}</>}
            {consent.consent_given_at && <> · agreed {formatDay(consent.consent_given_at)}</>}
            {consent.withdrawn_at && <> · withdrawn {formatDay(consent.withdrawn_at)}</>}
          </div>
        </div>
        {live && (
          <button
            type="button" className={ghostButtonClass} disabled={busy}
            title="Records that this client has withdrawn. The row stays and says so."
            onClick={() => onWithdraw(consent)}
          >
            Record a withdrawal
          </button>
        )}
      </div>
    </div>
  );
}

function AskPanel({ item, onAsk, busy, issuedToken }) {
  const [form, setForm] = useState({ consenter_name: '', consenter_email: '', consenter_role: '' });

  // NOT named `issued`, though the parent's state is. The two are different
  // bindings and sharing the name reads as one — and it trips
  // `_zoneGuards.mjs`'s null-deref rule, which cannot tell a prop from the
  // `useState(null)` of the same name in the same file. The rule is right to be
  // crude here: a reader has the same problem.
  if (issuedToken) {
    const link = `${window.location.origin}/attest/partner/${issuedToken.request_token}`;
    return (
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-amber-deep dark:text-amber-300">
          Copy this link now
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-axal-ink-2">
          This is the only time it is shown. It is {issuedToken.consenter_name}’s
          credential for answering, so no later read returns it — a firm that
          could read it back could answer on their client’s behalf, which would
          make every consent here self-issued.
        </p>
        <input
          className={`${inputClass} font-mono text-[11.5px]`}
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
        />
        <p className="mt-2 text-[11.5px] text-axal-ink-3">
          Nothing was emailed. Send it however you already talk to them.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Who is being asked">
          <input className={inputClass} value={form.consenter_name} maxLength={200}
            onChange={(e) => setForm({ ...form, consenter_name: e.target.value })} />
        </Field>
        <Field label="Email" hint="Recorded, not sent to.">
          <input className={inputClass} value={form.consenter_email} maxLength={300}
            onChange={(e) => setForm({ ...form, consenter_email: e.target.value })} />
        </Field>
        <Field label="Their role">
          <input className={inputClass} value={form.consenter_role} maxLength={200}
            onChange={(e) => setForm({ ...form, consenter_role: e.target.value })} />
        </Field>
      </div>
      <button
        type="button" className={`${buttonClass} mt-3`}
        disabled={busy || !form.consenter_name.trim()}
        onClick={() => onAsk(item, form)}
      >
        Create the ask
      </button>
      <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-3">
        This records the ask and gives you a link. It does not send anything —
        whether this product should email your client on your behalf is not a
        decision a form should make quietly.
      </p>
    </div>
  );
}

function ProofCard({ item, onSave, onDelete, onAsk, onWithdraw, busy, note, issued }) {
  const [edit, setEdit] = useState(false);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState(item);
  useEffect(() => { setDraft(item); }, [item]);

  return (
    <div className="rounded-xl border border-axal-hairline p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold tracking-tight">{item.title}</span>
            <Pill tone="neutral">{KIND_LABEL[item.kind] || item.kind}</Pill>
            {/* Two states, drawn differently on purpose. "Published" and
                "self-stated" are different evidence and must never render
                alike — the second is the firm reporting a metric about itself,
                and saying so is the whole job of this zone. */}
            {item.is_published
              ? <Pill tone="ok">Published with consent</Pill>
              : <Pill tone="warn">Self-stated</Pill>}
          </div>
          <div className="mt-0.5 text-[11.5px] text-axal-ink-3">
            {item.need_title
              ? <>From {item.need_title}{item.founder_name ? ` · ${item.founder_name}` : ''}</>
              : <Unrecorded>No engagement attached</Unrecorded>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => setEdit((v) => !v)}>
            {edit ? 'Cancel' : 'Edit'}
          </button>
          <button type="button" className={ghostButtonClass} onClick={() => setAsking((v) => !v)}>
            {asking ? 'Close' : 'Ask for consent'}
          </button>
        </div>
      </div>

      {item.detail && (
        <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">{item.detail}</p>
      )}
      {item.outcome_note && (
        <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
          <span className="font-semibold">Result claimed: </span>{item.outcome_note}
          {!item.is_published && (
            <span className="text-axal-ink-3">
              {' '}— the firm’s own account of it, with nothing confirming it yet.
            </span>
          )}
        </p>
      )}

      {edit && (
        <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Title">
              <input className={inputClass} value={draft.title || ''} maxLength={200}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Kind">
              <select className={inputClass} value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-3 grid gap-3">
            <Field label="What the work was">
              <textarea className={inputClass} rows={3} value={draft.detail || ''} maxLength={4000}
                onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
            </Field>
            <Field
              label="Result claimed"
              hint="Your account of the outcome. It stays a claim until a client confirms it."
            >
              <input className={inputClass} value={draft.outcome_note || ''} maxLength={1000}
                onChange={(e) => setDraft({ ...draft, outcome_note: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy}
              onClick={async () => { await onSave(item, draft); setEdit(false); }}>Save</button>
            <button type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
              disabled={busy} onClick={() => onDelete(item)}>Delete</button>
          </div>
          <SaveNote note={note?.scope === `proof:${item.id}` ? note : null} />
        </div>
      )}

      {asking && (
        <AskPanel
          item={item} busy={busy} onAsk={onAsk}
          issuedToken={issued?.itemId === item.id ? issued : null}
        />
      )}

      {item.consents.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            Consent record
          </div>
          <div className="mt-1">
            {item.consents.map((k) => (
              <ConsentRow key={k.id} consent={k} busy={busy}
                onWithdraw={(x) => onWithdraw(item, x)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PartnerProofZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [issued, setIssued] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', kind: 'case_study', detail: '', outcome_note: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.listPartnerProof();
      setState({ loading: false, error: '', data: r || {} });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The proof record did not load.', data: null });
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

  const ask = useCallback(async (item, form) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.requestPartnerProofConsent(item.id, form);
      // Held in component state only, and only until the next load. It is never
      // written anywhere and never re-fetched, because no later read returns it.
      setIssued({ itemId: item.id, request_token: r.request_token, consenter_name: r.consenter_name });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e?.message || 'The ask was not recorded.', scope: `proof:${item.id}` });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Proof" />
        <NoPartnerProfile />
      </>
    );
  }

  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0}
      empty={(
        <NothingYet
          title="No proof is recorded yet"
          body={
            'A case study or an outcome starts as your own account of the work. '
            + 'It becomes proof when the client agrees to it being shown — and '
            + 'until they do, this page will say which of the two it is.'
          }
          action={(
            <button type="button" className={buttonClass} onClick={() => setAdding(true)}>
              Add a case study
            </button>
          )}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="What the firm can show, and what it is only claiming"
          blurb={
            'Every item carries the engagement it came from and the client’s own '
            + 'answer about publishing it. Consent is a gate rather than a '
            + 'warning: an unconsented outcome has no published form to suppress.'
          }
          action={(
            <button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add an item'}
            </button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="Items" value={items.length} hint="case studies, outcomes, testimonials" />
          <StatCard
            label="Published with consent"
            value={d?.published_count ?? 0}
            hint="a client agreed, and has not withdrawn"
          />
          <StatCard
            label="Self-stated"
            value={d?.self_stated_count ?? 0}
            hint="the firm’s own account, unconfirmed"
          />
        </div>

        {adding && (
          <div className="rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Title">
                <input className={inputClass} value={newItem.title} maxLength={200}
                  onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} />
              </Field>
              <Field label="Kind">
                <select className={inputClass} value={newItem.kind}
                  onChange={(e) => setNewItem({ ...newItem, kind: e.target.value })}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="What the work was">
                <textarea className={inputClass} rows={3} value={newItem.detail} maxLength={4000}
                  onChange={(e) => setNewItem({ ...newItem, detail: e.target.value })} />
              </Field>
            </div>
            <button
              type="button" className={`${buttonClass} mt-3`}
              disabled={busy || !newItem.title.trim()}
              onClick={async () => {
                await run(() => api.createPartnerProof(newItem), 'Added.', 'new');
                setNewItem({ title: '', kind: 'case_study', detail: '', outcome_note: '' });
                setAdding(false);
              }}
            >
              Add item
            </button>
            <SaveNote note={note?.scope === 'new' ? note : null} />
          </div>
        )}

        <Section title="Proof">
          <div className="space-y-3">
            {items.map((item) => (
              <ProofCard
                key={item.id}
                item={item}
                busy={busy}
                note={note}
                issued={issued}
                onSave={(it, draft) => run(
                  () => api.updatePartnerProof(it.id, {
                    title: draft.title, kind: draft.kind,
                    detail: draft.detail, outcome_note: draft.outcome_note,
                  }),
                  'Saved.', `proof:${it.id}`,
                )}
                onDelete={(it) => run(
                  () => api.deletePartnerProof(it.id),
                  'Deleted.', `proof:${it.id}`,
                )}
                onAsk={ask}
                onWithdraw={(it, k) => run(
                  () => api.withdrawPartnerProofConsent(it.id, k.id),
                  'Withdrawal recorded.', `proof:${it.id}`,
                )}
              />
            ))}
          </div>
        </Section>

        <StatedLimit title="What this zone does not claim, and what it will not let you do">
          <p>
            <strong>Nothing here can mark its own evidence as confirmed.</strong>{' '}
            Published is computed from the consent rows at read time — a live
            consent is one that was given and not withdrawn, both checked — and
            there is no field, form or API call on this page that sets it. A
            storefront able to confirm its own claims would have no evidence in
            it at all.
          </p>
          <p className="mt-2">
            <strong>Withdrawing is yours; agreeing is not.</strong> You can record
            that a client has taken their consent back, and it takes effect at
            once. You cannot record that one agreed — only the person holding the
            link can, which is what makes the record mean anything.
          </p>
          <p className="mt-2">
            <strong>The ask is recorded, not sent.</strong> Nothing here emails
            your client. The link is yours to pass on however you already talk to
            them, and it is shown once because it is their credential rather than
            yours.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
