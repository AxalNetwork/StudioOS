import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  // `StatCard` went with the three tiles it drew: the strip is the artboard's
  // own composition now, and `ProofTile` below is the tile that carries the
  // artboard's note under each figure.
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  Section, Field, SaveNote, UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument } from '../../../workspaces/canvasKit';

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

/**
 * The one consent state of an item, and the ONLY place it is decided.
 *
 * THE CHIPS AND THE PILL READ THE SAME FUNCTION, which they did not before: the
 * chip row asked `consents.some((k) => k.withdrawn_at)` for `Blocked` and the
 * card asked `is_published` for its badge, so an item that was published AND
 * carried an older withdrawal answered to both `Published` and `Blocked`. It is
 * published; it is not blocked. One function, four answers, no row in two
 * states at once.
 *
 * THE FOURTH STATE HAS NO CHIP AND MUST NOT BORROW ONE. An item with an EMPTY
 * `consents` array is one nobody has been asked about, which is not the same as
 * one where somebody was asked and has not replied. It falls under `All` and
 * only `All` — sweeping it into `Awaiting consent` would have this zone claim a
 * request was made, and this is the zone whose whole argument is the difference
 * between what a firm can show and what it is only claiming.
 */
export function consentState(item) {
  const consents = Array.isArray(item?.consents) ? item.consents : [];
  if (item?.is_published) return 'published';
  if (consents.some((k) => k.withdrawn_at)) return 'withdrawn';
  if (consents.some((k) => !k.consent_given && !k.withdrawn_at)) return 'awaiting';
  return 'not_asked';
}

const CONSENT_LABEL = {
  published: 'Published',
  awaiting: 'Awaiting consent',
  withdrawn: 'Withdrawn',
  not_asked: 'Nobody asked',
};
const CONSENT_TONE = {
  published: 'ok', awaiting: 'warn', withdrawn: 'danger', not_asked: 'neutral',
};

/** The strip tile, in the anatomy the artboards share. */
function ProofTile({ label, value, note }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 font-mono text-[16px] font-extrabold tabular-nums tracking-tight text-axal-ink dark:text-gray-100">{value}</div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

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

/**
 * `Ask for consent`, the artboard's first op.
 *
 * ITS OLD REASON WAS TRUE OF A PAGE THAT NO LONGER EXISTS. It read "consent is
 * given by the founder, and no founder-side surface exists to ask from here" —
 * and `/attest/partner/:token` is that surface, mounted in `App.jsx`, with
 * `POST /proof/:id/consent-request` issuing the credential. The ask has been
 * real; only the header op was still describing its absence.
 *
 * IT PICKS AN OUTCOME FIRST, because a consent is about a specific claim.
 * Consent to "a case study" and consent to "a case study naming our revenue"
 * are different consents, which is why the store keeps the wording — so a
 * header op that asked without naming what it was asking about would be
 * issuing a credential against nothing in particular.
 *
 * PUBLISHED ITEMS ARE STILL IN THE LIST. A second consenter on an already-
 * published outcome is a normal thing to want: two people at the client, or a
 * replacement for one who withdrew.
 */
function AskModal({ items, busy, issued, onAsk, onClose }) {
  const [pick, setPick] = useState(items[0]?.id ?? null);
  const item = items.find((i) => i.id === pick) || null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Ask a client for consent</h3>
          <button type="button" className={ghostButtonClass} onClick={onClose}>Close</button>
        </div>
        {items.length === 0 ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-axal-ink-2">
            There is nothing to ask about yet. Record a case study or an outcome first —
            a consent is about a specific claim, so there has to be one.
          </p>
        ) : (
          <>
            <Field label="Which outcome" hint="The consent is recorded against this item and no other.">
              <select className={inputClass} value={pick ?? ''} onChange={(e) => setPick(Number(e.target.value))}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title} — {CONSENT_LABEL[consentState(i)]}
                  </option>
                ))}
              </select>
            </Field>
            {item && (
              <AskPanel
                item={item} busy={busy} onAsk={onAsk}
                issuedToken={issued?.itemId === item.id ? issued : null}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function PartnerProofZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [issued, setIssued] = useState(null);
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', kind: 'case_study', detail: '', outcome_note: '' });
  const [view, setView] = useState('all');

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

  // The chips select on `consentState` — the same function the pill and the
  // instrument's Consent column read, so no row can answer to two chips at
  // once. `Blocked` is `withdrawn` here rather than the artboard's "engagement
  // not complete": nothing links a proof item to an engagement's completion,
  // and a consent taken back is the one state in this store that blocks
  // publication for a reason other than an unanswered ask.
  const visible = items.filter((item) => {
    const state = consentState(item);
    if (view === 'published') return state === 'published';
    if (view === 'blocked') return state === 'withdrawn';
    if (view === 'awaiting') return state === 'awaiting';
    return true;
  });

  // ══ THE ARTBOARD'S FOUR TILES, COUNTED OVER THE WHOLE SHELF ══════════════
  // Never over `visible`: a figure that changes because a chip was clicked is
  // not reporting what its label claims.
  const awaiting = items.filter((i) => consentState(i) === 'awaiting');
  const blocked = items.filter((i) => consentState(i) === 'withdrawn');
  // `Client-verified metrics` IS THE ZONE'S WHOLE ARGUMENT AS A NUMBER: a claim
  // about a result that a client agreed to. A published item with no result
  // claimed is not a verified metric, and a self-stated result is not one
  // either — which is what the artboard's note "none self-reported" means.
  const verified = items.filter((i) => i.is_published && i.outcome_note);
  // The artboard's `aiFoot` is "Three requests; each needs a human send." The
  // three is its own sample; the count here is this firm's held items, because
  // transcribing a figure out of an artboard is how a page comes to state a
  // number about somebody else's data.
  const heldCount = awaiting.length + blocked.length
    + items.filter((i) => consentState(i) === 'not_asked').length;

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  // `Ask for consent` is supplied by this page: a handler the page does not
  // supply renders nothing at all, which is the whole point of the kind.
  const handlers = {
    askConsent: () => { setNote(null); setAsking(true); },
  };
  const rowActions = partnerZoneActions('offers/proof', { handlers, view: { header: ['Outcome', 'Kind', 'Provenance', 'Founder', 'Consent', 'What it says'], rows: visible, cells: (r) => [r.title, r.kind, r.need_title, r.founder_name, CONSENT_LABEL[consentState(r)], r.outcome_note] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Proof" actions={rowActions} />;
  }

  return (
    <>
      {/* Hoisted out of `ZoneBody` exactly as `RelationshipsZone` does it, so a
          component a dozen other zones mount does not have to learn about
          filters. The export takes `visible` rather than `items`: a file that
          did not match the chips on screen would be the same untruth as a chip
          that narrows nothing. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('offers/proof', { value: view, onChange: setView })}
        actions={rowActions}
      />
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

          {/* ══ THE `po4` STRIP ═════════════════════════════════════════════
              `Published · Awaiting consent · Blocked · Client-verified
              metrics`, all four counted from rows.

              ONE NOTE IS NOT THE ARTBOARD'S, AND DELIBERATELY. Its `Published`
              tile reads "live on the public profile" — there is no public
              profile in this product, `Preview public page` is still prose for
              exactly that reason, and repeating the artboard's note would have
              the strip promise a page that does not exist. The note says what
              published means here instead. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <ProofTile
              label="Published"
              value={String(d?.published_count ?? 0)}
              note="a client agreed, and has not withdrawn"
            />
            <ProofTile label="Awaiting consent" value={String(awaiting.length)} note="asked, no answer" />
            <ProofTile label="Blocked" value={String(blocked.length)} note="consent withdrawn" />
            <ProofTile
              label="Client-verified metrics"
              value={String(verified.length)}
              note="a result a client agreed to; self-stated ones are not counted"
            />
          </div>

          <Instrument
            testid="proof-shelf"
            title="Outcome shelf"
            meta="Seam-fed · consent gates publication"
            cols="1.9fr 1.4fr 1.1fr 2fr"
            head={['Outcome', 'Provenance', 'Consent', 'What it says']}
            rows={visible.map((item) => {
              const state = consentState(item);
              return {
                key: item.id,
                cells: [
                  { text: item.title, sub: KIND_LABEL[item.kind] || item.kind },
                  // THE SEAM MARK IS EARNED PER ROW, not painted on every one.
                  // The artboard's shelf is entirely seam-fed because every row
                  // there came out of an engagement record; here an item can be
                  // typed by hand, and one with nothing behind it is the single
                  // most useful thing this column can say.
                  item.need_title
                    ? { text: item.need_title, sub: item.founder_name || undefined, seam: 'From engagement' }
                    : { nr: true },
                  { pill: CONSENT_LABEL[state], pillTone: CONSENT_TONE[state] },
                  item.outcome_note
                    ? { text: item.outcome_note, ...(state === 'published' ? {} : { gate: 'Not public' }) }
                    : { nr: true },
                ],
              };
            })}
            note={'Consent is a gate rather than a warning: an unconsented outcome has no published form to suppress, so it simply is not one — and nothing on this page is a metric the firm reported about itself and marked confirmed. Two things this shelf says that the artboard\u2019s cannot. A row with no engagement behind it carries no seam mark and reads absent in Provenance: the artboard is entirely seam-fed because every row there came from an engagement record the client can see from their side, and an item typed by hand here has no such other side. And `Blocked` means a consent taken back rather than the artboard\u2019s incomplete engagement \u2014 nothing links a proof item to an engagement\u2019s completion, so a withdrawal is the one state in this store that blocks publication for a reason other than an unanswered ask.'}
          />

          <ZoneDraft
            surface="offers/proof"
            label="Draft · consent requests"
            accept="Accept drafts"
            run="Draft the requests"
            foot={`${heldCount} request${heldCount === 1 ? '' : 's'}; each needs a human send.`}
            empty="A consent request per held outcome, naming the engagement, the specific claim, and where it would appear — for a person to send from the account that did the work."
            nothingToDraft="Every outcome is published, so there is nothing to ask for."
          />

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
            {/* A narrowed view that finds nothing says which view it is, the way
                `LibraryZone` does: a bare empty list under a selected chip reads
                as "you have no proof", which is a different and much worse
                claim than "none of it is in this state". */}
            {items.length > 0 && visible.length === 0 && (
              <p className="mb-3 text-[12px] text-axal-ink-2">
                No item is in this state. {items.length} recorded in total.
              </p>
            )}
            <div className="space-y-3">
              {visible.map((item) => (
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

          {asking && (
            <AskModal
              items={items} busy={busy} issued={issued}
              onAsk={ask} onClose={() => setAsking(false)}
            />
          )}

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
    </>
  );
}
