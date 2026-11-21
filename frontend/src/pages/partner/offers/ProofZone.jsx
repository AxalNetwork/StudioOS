import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import OfferPages from '../../../ui/OfferPages.jsx';
import {
  // D4842: no tile strip and no shelf. OF-03 is the result cards alone.
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  Field, NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { useGuardedWrite, scopedNote, zoneNote, WriteNote } from './useGuardedWrite';
import {
  PROOF_CONSENT, PROOF_CHIP_OF, proofConsentKey, proofProvenance, proofHeadline, proofSecondAction, proofChipCounts,
} from './proofCards.js';

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
  // D4672: awaiting is an OPEN ask about the claim as it reads now. An ask the
  // firm edited the claim under, or whose link lapsed, is not awaiting anything.
  if (consents.some((k) => k.state === 'requested')) return 'awaiting';
  // Asked, but every ask was about an older revision or has expired: no chip of
  // its own (it falls under `All`), and never "Nobody asked", which it was not.
  if (consents.some((k) => k.state === 'superseded' || k.state === 'expired')) return 'ask_again';
  return 'not_asked';
}

const CONSENT_LABEL = {
  published: 'Published',
  awaiting: 'Awaiting consent',
  withdrawn: 'Withdrawn',
  ask_again: 'Ask again',
  not_asked: 'Nobody asked',
};

/**
 * D4672: one consent row's state in words, from the Worker's `state`. Every
 * state a request can be in reads differently: requested, confirmed, declined,
 * withdrawn and superseded are different facts about different evidence.
 */
export const CONSENT_ROW_PILL = Object.freeze({
  requested: { tone: 'warn', label: 'Requested' },
  confirmed: { tone: 'ok', label: 'Confirmed' },
  declined: { tone: 'neutral', label: 'Declined' },
  withdrawn: { tone: 'danger', label: 'Withdrawn' },
  superseded: { tone: 'neutral', label: 'Superseded' },
  expired: { tone: 'neutral', label: 'Expired' },
});

function ConsentRow({ consent, onWithdraw, busy }) {
  const live = consent.state === 'confirmed';
  const pill = CONSENT_ROW_PILL[consent.state] || { tone: 'neutral', label: 'Not recorded' };
  return (
    <div className="border-t border-axal-hairline py-2 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-semibold">{consent.consenter_name}</span>
            {consent.consenter_role && <span className="text-axal-faint">{consent.consenter_role}</span>}
            <Pill tone={pill.tone}>{pill.label}</Pill>
            {consent.revision != null && <span className="text-axal-faint">about version {consent.revision}</span>}
          </div>
          {consent.consent_text && (
            /* The exact words agreed to, quoted. Consent to "a case study" and
               consent to "a case study naming our revenue" are different
               consents, so a boolean cannot stand in for the wording. */
            <p className="mt-1 max-w-xl text-[12px] italic leading-relaxed text-axal-muted">
              “{consent.consent_text}”
            </p>
          )}
          <div className="mt-0.5 text-[11px] text-axal-faint">
            {consent.requested_at && <>Asked {formatDay(consent.requested_at)}</>}
            {consent.consent_given_at && <> · agreed {formatDay(consent.consent_given_at)}</>}
            {consent.withdrawn_at && <> · {consent.consent_given_at ? 'withdrawn' : 'declined'} {formatDay(consent.withdrawn_at)}</>}
            {consent.state === 'requested' && consent.expires_at && <> · link valid until {formatDay(consent.expires_at)}</>}
          </div>
          {consent.state === 'superseded' && (
            <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-axal-muted">
              This was about an earlier version of the claim, so it no longer publishes the current one. Ask again to confirm the current wording.
            </p>
          )}
          {consent.state === 'requested' && consent.invite_token && (
            <input
              aria-label={`Link for ${consent.consenter_name}`}
              className={`${inputClass} mt-1 font-mono text-[11px]`}
              readOnly
              value={`${window.location.origin}/attest/partner/${consent.invite_token}`}
              onFocus={(e) => e.target.select()}
            />
          )}
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

function AskPanel({ item, onAsk, busy, issuedToken, note }) {
  const [form, setForm] = useState({ consenter_name: '', consenter_email: '', consenter_role: '' });

  // NOT named `issued`, though the parent's state is. The two are different
  // bindings and sharing the name reads as one — and it trips
  // `_zoneGuards.mjs`'s null-deref rule, which cannot tell a prop from the
  // `useState(null)` of the same name in the same file. The rule is right to be
  // crude here: a reader has the same problem.
  if (issuedToken) {
    const link = `${window.location.origin}/attest/partner/${issuedToken.invite_token}`;
    return (
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-amber-deep dark:text-amber-300">
          Send this link to {issuedToken.consenter_name}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-axal-muted">
          It shows them this claim exactly as it reads now. To answer, they ask for
          a code that Axal emails to the address you gave, so holding the link is
          not enough to answer — not for you, and not for anyone it is forwarded to.
          If you edit the claim before they answer, this request stops applying and
          you ask again.
        </p>
        <input
          className={`${inputClass} font-mono text-[11.5px]`}
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
        />
        <p className="mt-2 text-[11.5px] text-axal-faint">
          Nothing was emailed. Send it however you already talk to them.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Who is being asked">
          <input className={inputClass} value={form.consenter_name} maxLength={200}
            onChange={(e) => setForm({ ...form, consenter_name: e.target.value })} />
        </Field>
        <Field label="Email" hint="Their code to answer is sent here. It cannot be your firm’s.">
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
        disabled={busy || !form.consenter_name.trim() || !form.consenter_email.trim()}
        onClick={() => onAsk(item, form)}
      >
        Create the ask
      </button>
      <WriteNote note={scopedNote(note, `ask:${item.id}`)} busy={busy} />
      <p className="mt-2 text-[11.5px] leading-relaxed text-axal-faint">
        This records the ask and gives you a link to pass on. Axal sends nothing
        on your behalf; the only email is the code your client asks for when they
        answer.
      </p>
    </div>
  );
}

/**
 * D4842 — ONE CARD PER RESULT, OUTCOME FIRST (OF-03). The order is the issue's:
 * the outcome, the client and the work, the consent label, then who agreed and
 * when, the engagement, and whether it is published. Edit, delete and the
 * consent record sit behind View proof, so system detail never leads.
 *
 * A client-approved card has a solid green outline and a self-stated one a
 * dashed outline (OF-10), and the label still says which in words.
 */
export function ProofCard({ item, onSave, onDelete, onAsk, onWithdraw, busy, note, issued }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState(item);
  useEffect(() => { setDraft(item); }, [item]);

  const key = proofConsentKey(consentState(item), item);
  const label = PROOF_CONSENT[key];
  const head = proofHeadline(item);
  const lines = proofProvenance(key, item);
  const second = proofSecondAction(key);
  const outline = key === 'approved'
    ? 'border-2 border-emerald-600 dark:border-emerald-500'
    : key === 'self_stated' || key === 'superseded'
      ? 'border border-dashed border-gray-400 dark:border-gray-500'
      : 'border border-axal-hairline dark:border-gray-700';

  return (
    <article
      className={`flex flex-col gap-2 rounded-xl bg-white p-4 dark:bg-gray-900 ${outline}`}
      data-testid="proof-card" data-consent={key}
    >
      <h3 className="text-[16px] font-extrabold leading-snug tracking-tight text-axal-ink dark:text-gray-100">{head.outcome}</h3>
      <div className="text-[13px] text-axal-muted dark:text-gray-300">
        {head.client ? <b className="text-axal-ink dark:text-gray-100">{head.client}</b> : <Unrecorded>Client not named</Unrecorded>}
        {head.context && <span> · {head.context}</span>}
        <span className="text-axal-faint"> · {KIND_LABEL[item.kind] || item.kind}</span>
      </div>
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-bold ${CONSENT_CHIP_CLASS[label.tone]}`}
        data-testid="proof-consent"
      >
        <i aria-hidden="true" className="not-italic">{label.icon}</i>{label.label}
      </span>
      <p className="text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-300">
        {lines.when}<br />{lines.engagement}
      </p>
      <p className="text-[12px] text-axal-faint">{label.line}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className={`${ghostButtonClass} min-h-[44px] md:min-h-0`} aria-expanded={open}
          onClick={() => { setOpen((v) => !v); setAsking(false); }}>
          {open ? 'Hide proof' : 'View proof'}
        </button>
        <button type="button" className={`${ghostButtonClass} min-h-[44px] md:min-h-0`}
          onClick={() => {
            if (second.opens === 'ask') { setAsking((v) => !v); setOpen(false); } else { setOpen(true); setAsking(false); }
          }}>
          {second.label}
        </button>
      </div>

      {asking && (
        <AskPanel
          item={item} busy={busy} onAsk={onAsk} note={note}
          issuedToken={issued?.itemId === item.id ? issued : null}
        />
      )}

      {open && (
        <div className="mt-1 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="proof-detail">
          {item.detail && (
            <p className="max-w-2xl text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-300">{item.detail}</p>
          )}
          {head.context && <p className="mt-1 text-[12px] text-axal-faint">Recorded as “{item.title}”.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={ghostButtonClass} onClick={() => setEdit((v) => !v)}>
              {edit ? 'Cancel' : 'Edit'}
            </button>
            {key !== 'approved' && key !== 'requested' && (
              <button type="button" className={ghostButtonClass} onClick={() => setAsking((v) => !v)}>
                {asking ? 'Close' : 'Ask for consent'}
              </button>
            )}
          </div>

          {edit && (
            <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700">
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
                  onClick={() => onSave(item, draft, () => setEdit(false))}>Save</button>
                <button type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
                  disabled={busy} onClick={() => onDelete(item)}>Delete</button>
              </div>
              <WriteNote note={scopedNote(note, `proof:${item.id}`)} busy={busy} />
            </div>
          )}

          {item.consents.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
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
      )}
    </article>
  );
}

/** The consent label's colours. The icon and the word carry the meaning; colour only repeats it. */
const CONSENT_CHIP_CLASS = {
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  danger: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300',
};

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
function AskModal({ items, busy, issued, onAsk, onClose, note }) {
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
          <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted">
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
                item={item} busy={busy} onAsk={onAsk} note={note}
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
  const [issued, setIssued] = useState(null);
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', kind: 'case_study', detail: '', outcome_note: '' });
  const [view, setView] = useState('all');
  const currentPage = useRef(1);
  const request = useRef(0);

  const load = useCallback(async (page = currentPage.current) => {
    const generation = ++request.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      let r = await api.listPartnerProof(page);
      if (page > 1 && r?.page_size && Array.isArray(r?.items) && r.items.length === 0) {
        r = await api.listPartnerProof(Math.max(1, Math.ceil(r.total / r.page_size)));
      }
      if (generation !== request.current) return false;
      currentPage.current = r?.page ?? 1;
      setState({ loading: false, error: '', data: r || {} });
      return true;
    } catch (e) {
      if (generation !== request.current) return false;
      setState({ loading: false, error: e?.message || 'The proof record did not load.', data: null });
      return false;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // #4688: one write mechanism, shared with Visibility and Audience fit. See
  // `useGuardedWrite.jsx` for what "saved" means and what Retry repeats.
  const { busy, note, save, reload, clearNote } = useGuardedWrite(load);
  const run = useCallback(
    (write, saved, scope, onSaved) => save(write, { saved, scope, onSaved }),
    [save],
  );
  const toggleAdding = (open) => { clearNote(); setAdding(open); };

  const ask = useCallback((item, form) => run(
    async () => {
      const r = await api.requestPartnerProofConsent(item.id, form);
      setIssued({ itemId: item.id, invite_token: r.invite_token, consenter_name: r.consenter_name });
    },
    'The ask is recorded.', `ask:${item.id}`,
  ), [run]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];

  // D4842: the chips are OF-03's five (All, Client approved, Approval
  // requested, Self-stated, Withdrawn), and they select on the card's own label
  // (`proofConsentKey`, from `consentState`): the chip, the label and the
  // export can never disagree about a row. Superseded counts under Self-stated
  // and Declined under Withdrawn (`PROOF_CHIP_OF`).
  const keyed = items.map((item) => ({ item, key: proofConsentKey(consentState(item), item) }));
  const visible = keyed
    .filter(({ key }) => view === 'all' || PROOF_CHIP_OF[key] === view)
    .map(({ item }) => item);
  const chipCounts = proofChipCounts(keyed.map(({ key }) => key));

  // Counted over the whole page, never over `visible`: the draft band's foot
  // says how many held items there are, whatever chip is selected.
  const awaiting = items.filter((i) => consentState(i) === 'awaiting');
  const blocked = items.filter((i) => consentState(i) === 'withdrawn');
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
    askConsent: () => { clearNote(); setAsking(true); },
  };
  const rowActions = partnerZoneActions('offers/proof', { handlers, view: { header: ['Outcome', 'Kind', 'Provenance', 'Founder', 'Consent', 'What it says'], rows: visible, cells: (r) => [r.title, r.kind, r.need_title, r.founder_name, PROOF_CONSENT[proofConsentKey(consentState(r), r)].label, r.outcome_note] } });

  // NOT AN EARLY RETURN ANY MORE. This was
  //   `if (isNoPartnerProfile(state.error)) return <UnlinkedZone … />;`
  // which drew a card INSTEAD of the zone — on twelve zones, so an admin
  // reading this workspace saw twelve copies of one card and never a page.
  // `ZoneBody` takes the line as a `notice` above its states, and the zone
  // renders underneath in its own empty state, which is also the state that
  // says what this zone holds. The gate itself is untouched: the read still
  // 400s, so `isEmpty` is forced rather than inferred from rows that never
  // arrived, and `error` is cleared so the shared "This did not load" card —
  // the exact confusion `isNoPartnerProfile` exists to prevent — cannot fire.
  const unlinked = isNoPartnerProfile(state.error);

  return (
    <>
      {/* Hoisted out of `ZoneBody` exactly as `RelationshipsZone` does it, so a
          component a dozen other zones mount does not have to learn about
          filters. The export takes `visible` rather than `items`: a file that
          did not match the chips on screen would be the same untruth as a chip
          that narrows nothing. */}
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store.
          An action states what the zone DOES and an export over nothing
          loaded renders disabled and says so; a filter chip is a claim about
          ROWS, and a selectable `Published` over a store this account cannot
          read is the "an empty set reads as an answer" failure
          `zoneFilterBuilder.js` exists to prevent, reached from a new
          direction. `profile_zone_actions.test.mjs` asserts both halves. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : partnerZoneFilters('offers/proof', { value: view, onChange: setView, counts: chipCounts })}
        actions={rowActions}
      />
      {/* THE EDITOR IS NOT A CHILD OF `ZoneBody` (#4688): with no rows `ZoneBody`
          draws only its empty state, so a form among its children never
          mounted for the first record. Mounted by `adding` alone, it also
          survives a refresh and an unreadable list. */}
      {adding && (
        <div className="mb-6 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700" data-testid="proof-editor">
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
            onClick={() => run(
              () => api.createPartnerProof(newItem), 'Added.', 'new',
              () => {
                setNewItem({ title: '', kind: 'case_study', detail: '', outcome_note: '' });
                setAdding(false);
              },
            )}
          >
            Add item
          </button>
          <WriteNote note={scopedNote(note, 'new')} busy={busy} />
        </div>
      )}
      <WriteNote note={zoneNote(note)} busy={busy} onReload={reload} />
      <ZoneBody
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={reload}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || (items.length === 0)}
        empty={(
          /* OF03b: the empty state names the commercial outcome and offers one action. */
          <NothingYet
            title="Show founders why they should hire you"
            body={
              'Add a result from completed work. It starts as your own account, and '
              + 'it is published once the client approves the wording.'
            }
            action={(
              <button type="button" className={buttonClass} onClick={() => toggleAdding(true)}>
                Add your first proof
              </button>
            )}
          />
        )}
      >
        <div className="space-y-6">
          <ZoneHeading
            title="Proof"
            blurb="Results from completed work. Client-approved results carry the most weight."
            action={(
              <button type="button" className={buttonClass} onClick={() => toggleAdding(!adding)}>
                {adding ? 'Cancel' : '+ Add proof'}
              </button>
            )}
          />

          {(d?.has_more || d?.page > 1) && (
            <p className="text-sm text-axal-muted">The filters and their counts apply to this page of proof.</p>
          )}

          {/* OF-03: the result cards, two across at desktop and one on a phone
              (OF09b). A chip that finds nothing says which view it is, because
              a bare empty grid reads as "you have no proof". */}
          {items.length > 0 && visible.length === 0 && (
            <p className="text-[12px] text-axal-muted">
              No proof on this page is in this state. {d?.total ?? items.length} recorded in total.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2" data-testid="proof-grid">
            {visible.map((item) => (
              <ProofCard
                key={item.id}
                item={item}
                busy={busy}
                note={note}
                issued={issued}
                onSave={(it, draft, onSaved) => run(
                  () => api.updatePartnerProof(it.id, {
                    title: draft.title, kind: draft.kind,
                    detail: draft.detail, outcome_note: draft.outcome_note,
                  }),
                  'Saved.', `proof:${it.id}`, onSaved,
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
          <OfferPages label="Proof" result={d} busy={busy || state.loading} onPage={load} />

          <ZoneDraft
            surface="offers/proof"
            railOption="draft:consent-requests"
            label="Draft · consent requests"
            accept="Accept drafts"
            run="Draft the requests"
            foot={`${heldCount} request${heldCount === 1 ? '' : 's'}; each needs a human send.`}
            empty="A consent request per held outcome, naming the engagement, the specific claim, and where it would appear — for a person to send from the account that did the work."
            nothingToDraft="Every outcome is published, so there is nothing to ask for."
          />

          {asking && (
            <AskModal
              items={items} busy={busy} issued={issued} note={note}
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
              once and for good. You cannot record that one agreed — only the person
              who reads the address you named can, with a code Axal emails there,
              which is what makes the record mean anything.
            </p>
            <p className="mt-2">
              <strong>A consent is about one version of the claim.</strong> Editing
              the title, detail, outcome or engagement makes a new version; a
              consent stays with the version it was given for, shown as superseded,
              and the new one is self-stated until the client confirms it.
            </p>
            <p className="mt-2">
              <strong>The ask is recorded, not sent.</strong> The link is yours to
              pass on however you already talk to your client. It shows them the
              claim; it cannot answer it.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
