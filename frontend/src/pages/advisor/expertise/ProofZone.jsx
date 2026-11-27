import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, Trash2 } from 'lucide-react';
import { Card } from '../../../ui';
import { StateChip } from '../../../ui/Honesty';
import { api } from '../../../lib/api';
import {
  ASK_REFUSALS, Field, MoreRows, NothingYet, Pill, SaveNote, StaleNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass, refusalText,
} from './kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { advisorProofApi } from '../../../lib/api/advisorProof.js';
import {
  PROOF_DELETE_FAILED, proofDeleteLines, proofDeleteTitle, proofDeletedLine,
} from './expertiseModel';
import {
  ASK_STEPS, PROOF_CARD_STATES, PROOF_PRIVATE_NOTE, proofActionText, proofCardState, proofDate,
  proofKindLabel, proofPublicLine, proofWhenLine, proofWhoLine,
} from './proofModel';
import { usePagedList } from './pages';

const readProofPage = (page) => api.listMyAdvisorProof(page);

/**
 * Expertise · Proof (EX-08, EX-09; D4825) — what you claim, and who has
 * confirmed it.
 *
 * THE WHOLE ZONE IS ONE DISTINCTION: a claim you made about your own work, and
 * a claim someone else has confirmed. They are different evidence and this page
 * must never render them the same way. `attested` is computed by the worker
 * from whether a live consent row exists (migration 204), so it cannot be set
 * by the person it describes. Each card leads with one state taken from the
 * Worker's own (`proofCardState` in `proofModel.js`): Confirmed, Awaiting
 * confirmation, Needs reconfirmation, Declined or Withdrawn, Self-stated. It
 * names who was asked or who confirmed, the date, and whether it is public.
 * The word is "Confirmed by <name>", never "Verified": Axal does not verify
 * anyone's identity.
 *
 * ASKING IS NOT BEING TOLD YES. Recording a consent request leaves the item
 * unconfirmed. It becomes attested only when the named person answers through
 * their own link.
 *
 * THE LINK IS AN INVITATION (D4670). Each pending ask carries `invite_token`
 * on every read, so the link is drawn from the list and a refresh never loses
 * it. Holding it lets someone read the claim, not answer it: answering needs a
 * code that Axal emails, when the attester asks for one, to the address named
 * here. That is why the address is required and cannot be the advisor's own.
 * A pending request can be cancelled (#5315 part 1), which closes its link.
 *
 * NOTHING IS SENT FROM HERE. Recording the ask and handing over the link are
 * the advisor's; the only mail is the attester's own code, sent on their
 * request.
 *
 * A REFUSAL READS AS A FIXED SENTENCE keyed on its code (`ASK_REFUSALS` in
 * the kit, `PROOF_ACTION_REFUSALS` in the model), never the raw error text.
 *
 * D4681 (#4681): DELETING IS DELIBERATE AND WHOLE. Delete… asks first and says
 * what goes with the claim (every consent record, names and statements, and
 * any link still out), that it cannot be undone and that no copy is kept. The
 * Worker deletes the claim and its consents in one batch, so a failure leaves
 * both as they were, and the page says so.
 *
 * PUBLISHING IS THE ADVISOR'S, AND ONLY FOR CONFIRMED PROOF (#5315 part 2).
 * Nothing publishes on confirmation. Publish proof is offered only on a
 * confirmed card; the Worker refuses it unless a confirmation of the claim as
 * it now reads exists, and Make private takes it back off the profile.
 */

const KINDS = [
  ['engagement', 'Engagement'],
  ['outcome', 'Outcome'],
  ['role', 'Role'],
  ['credential', 'Credential'],
];

const BLANK = { kind: 'engagement', title: '', organization: '', period_note: '', detail: '' };

/** What a consent row says, as the advisor reads it (`state` from the Worker). */
export const CONSENT_STATES = Object.freeze({
  pending: 'Waiting for an answer',
  confirmed: 'Confirmed',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  cancelled: 'Request cancelled',
  needs_reconfirmation: 'Confirmed before verification, or about an earlier wording: ask again',
});

// EX-04 phone: every control on a card is a 44px target below `sm`.
const tap = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 sm:min-h-[32px]';

/** One pending request's link, with its two actions (EX-09 "Request created"). */
function ConsentLink({ token, onCancel, cancelling, testid }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/attest/${token}`;
  return (
    <Card variant="accent" padding="md" className="mt-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-muted">
        Send this link yourself
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
        Nothing was emailed. Give this to the person you named, through whatever channel you
        already have with them. It shows them the claim; to answer, they ask for a code that Axal
        emails to the address you gave, so the link alone cannot confirm anything.
      </p>
      <code className="mt-2 block min-w-0 truncate rounded-lg bg-white/70 px-2 py-1.5 text-[11.5px] dark:bg-gray-900/70">{url}</code>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={`${buttonClass} ${tap}`}
          onClick={() => {
            navigator.clipboard?.writeText(url).then(
              () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); },
              () => setCopied(false),
            );
          }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy invitation link'}
        </button>
        {onCancel && (
          <button type="button" className={`${ghostButtonClass} ${tap}`} disabled={cancelling} onClick={onCancel} data-testid={testid}>
            {cancelling ? 'Cancelling…' : 'Cancel request'}
          </button>
        )}
      </div>
    </Card>
  );
}

/** EX-09: Claim → Attester → Request → Confirmation, for one claim. */
function AskForm({ item, onDone, onClose, onCancel }) {
  const [draft, setDraft] = useState({ attester_name: '', attester_email: '', attester_role: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [created, setCreated] = useState(null);
  // D4711: the form opens with the cursor on its first field.
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus?.(); }, []);
  const step = created ? 2 : 1;

  const submit = async (e) => {
    e.preventDefault();
    setNote(null);
    if (!draft.attester_name.trim()) {
      setNote({ ok: false, text: ASK_REFUSALS.attester_name_required });
      return;
    }
    if (!draft.attester_email.trim()) {
      setNote({ ok: false, text: ASK_REFUSALS.attester_email_required });
      return;
    }
    setBusy(true);
    try {
      const res = await api.requestAdvisorProofConsent(item.id, {
        attester_name: draft.attester_name.trim(),
        attester_email: draft.attester_email.trim(),
        attester_role: draft.attester_role.trim() || null,
        relationship: null,
      });
      setDraft({ attester_name: '', attester_email: '', attester_role: '' });
      setCreated(res?.invite_token ? res : null);
      setNote({ ok: true, text: 'Request created. The claim stays unconfirmed until they answer.' });
      onDone?.();
    } catch (err) {
      setNote({ ok: false, text: refusalText(err, 'The request could not be created. Nothing was saved.') });
    } finally {
      setBusy(false);
    }
  };

  const where = [item.organization, item.period_note].filter(Boolean).join(' · ');
  return (
    <form onSubmit={submit} className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700"
      aria-label={`Ask someone to confirm “${item.title}”`} data-testid={`advisor-proof-ask-${item.id}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault?.(); onClose?.(); } }}>
      <h4 className="text-[13px] font-extrabold">Ask someone to confirm “{item.title}”</h4>
      <ol className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold" aria-label="Steps" data-testid={`advisor-proof-ask-steps-${item.id}`}>
        {ASK_STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined}
            className={`rounded-full border px-2 py-0.5 ${i < step ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
              : i === step ? 'border-axal-violet bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700'}`}>
            {i < step ? '✓ ' : ''}{s}
          </li>
        ))}
      </ol>
      <div className="mt-3">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-muted">They will be shown exactly this</div>
        <div className="mt-1 rounded-lg border border-axal-hairline bg-axal-ground p-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid={`advisor-proof-ask-claim-${item.id}`}>
          <p className="text-[11px] font-semibold text-axal-muted">{proofKindLabel(item.kind)}</p>
          <p className="text-[13px] font-extrabold">{item.title}</p>
          {where && <p className="text-[12px] text-axal-muted">{where}</p>}
          {item.detail && <p className="mt-1 text-[12px] leading-relaxed">{item.detail}</p>}
        </div>
        <p className="mt-1 text-[11px] text-axal-muted">Pinned when you send. If you change the claim later, any confirmation needs to be given again.</p>
      </div>
      {!created && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Their name" hint="Required.">
              <input ref={nameRef} className={inputClass} value={draft.attester_name} data-testid={`advisor-proof-ask-name-${item.id}`}
                onChange={(e) => setDraft({ ...draft, attester_name: e.target.value })} />
            </Field>
            <Field label="Their role and company, as it will appear">
              <input className={inputClass} value={draft.attester_role}
                onChange={(e) => setDraft({ ...draft, attester_role: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Their email" hint="Required. Their code is sent here when they answer. It cannot be your own.">
                <input type="email" className={inputClass} value={draft.attester_email}
                  onChange={(e) => setDraft({ ...draft, attester_email: e.target.value })} />
              </Field>
            </div>
          </div>
          <p className="mt-3 rounded-lg bg-axal-ground p-2.5 text-[12px] leading-relaxed text-axal-muted dark:bg-gray-900">
            Nothing is emailed when you create the request. You get a link to send them yourself; they
            request a one-time code at that address to answer.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className={`${ghostButtonClass} ${tap}`} onClick={() => onClose?.()}>Back</button>
            <button type="submit" className={`${buttonClass} ${tap}`} disabled={busy}>
              {busy ? 'Creating…' : 'Create request'}
            </button>
          </div>
        </>
      )}
      <SaveNote note={note} testid={`advisor-proof-ask-note-${item.id}`} />
      {created && (
        <section aria-label="Request created" className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-bold">Request created</span>
            <Pill tone={PROOF_CARD_STATES.awaiting.tone}>{PROOF_CARD_STATES.awaiting.label}</Pill>
          </div>
          <ConsentLink token={created?.invite_token} onCancel={() => onCancel?.(created)} />
          <div className="mt-2 flex justify-end">
            <button type="button" className={`${ghostButtonClass} ${tap}`} onClick={() => onClose?.()}>Done</button>
          </div>
        </section>
      )}
    </form>
  );
}

/** The card's lead action, by its state (EX-08: one each). */
const ASK_LABELS = {
  self_stated: 'Ask someone to confirm',
  needs_reconfirmation: 'Ask again',
  declined: 'Ask someone else',
  withdrawn: 'Ask someone else',
  awaiting: 'Ask another person',
  confirmed: 'Ask another person',
};

export default function ProofZone() {
  // #4689: a page at a time; the tiles read `counts`, the whole record's figures.
  const list = usePagedList(readProofPage, { errorText: 'Your proof record could not be read.' });
  const state = { loading: list.loading, error: list.error, items: list.rows };
  const counts = list.res?.counts || null;
  const load = list.load;
  const [draft, setDraft] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [asking, setAsking] = useState(null);
  const [view, setView] = useState('all');
  const [confirming, setConfirming] = useState(null);
  const [acting, setActing] = useState(null);
  const [rowNote, setRowNote] = useState({});
  // D4711: the delete question takes focus on its safe answer; closing it, or
  // the ask form, hands focus back to the row button that opened it.
  const rowButtons = useRef({});
  const keepRef = useRef(null);
  const [returnFocus, setReturnFocus] = useState(null);
  useEffect(() => { if (confirming != null) keepRef.current?.focus?.(); }, [confirming]);
  useEffect(() => {
    if (!returnFocus) return;
    rowButtons.current[returnFocus]?.focus?.();
    setReturnFocus(null);
  }, [returnFocus]);
  const closeConfirm = (id) => { setConfirming(null); setReturnFocus(`delete-${id}`); };
  const closeAsk = (id) => { setAsking(null); setReturnFocus(`ask-${id}`); };
  const [deleting, setDeleting] = useState(false);
  const [uid, setUid] = useState(null);
  const navigate = useNavigate();

  // The public profile's address, for Public preview. A read that fails leaves
  // the preview disabled rather than guessing a link.
  useEffect(() => {
    let live = true;
    api.getMyAdvisor?.().then((p) => { if (live) setUid(p?.uid || null); }, () => {});
    return () => { live = false; };
  }, []);


  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setNote(null);
    if (!draft.title.trim()) { setNote({ ok: false, text: 'A claim needs a title.' }); return; }
    setBusy(true);
    try {
      await api.createMyAdvisorProof({
        kind: draft.kind,
        title: draft.title.trim(),
        organization: draft.organization.trim() || null,
        period_note: draft.period_note.trim() || null,
        detail: draft.detail.trim() || null,
      });
      setDraft(BLANK);
      setNote({ ok: true, text: 'Added — self-stated until someone confirms it.' });
      await list.refresh();
    } catch (err) {
      setNote({ ok: false, text: refusalText(err, 'That could not be saved.') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    setNote(null);
    setDeleting(true);
    try {
      const res = await api.deleteMyAdvisorProof(row.id);
      setConfirming(null);
      setNote({ ok: true, text: proofDeletedLine(Number(res?.consents_removed) || 0) });
      await list.refresh();
    } catch (err) {
      setNote({ ok: false, text: refusalText(err, PROOF_DELETE_FAILED) });
    } finally {
      setDeleting(false);
    }
  };

  // #5315 part 2: publish or unpublish one confirmed claim. Never on its own.
  const publish = async (row, published) => {
    setActing(`publish-${row.id}`);
    setRowNote((n) => ({ ...n, [row.id]: null }));
    try {
      await advisorProofApi.setPublication(row.id, published);
      setRowNote((n) => ({ ...n, [row.id]: { ok: true, text: published ? 'Published. Founders see it on your profile as confirmed.' : 'Made private. It is no longer on your profile.' } }));
      await list.refresh();
    } catch (err) {
      setRowNote((n) => ({ ...n, [row.id]: { ok: false, text: proofActionText(err, published ? 'It could not be published. Nothing changed.' : 'It could not be made private. Nothing changed.') } }));
    } finally {
      setActing(null);
    }
  };

  // #5315 part 1: cancel a request nobody has answered; its link stops working.
  const cancel = async (row, consent) => {
    setActing(`cancel-${consent.id}`);
    setRowNote((n) => ({ ...n, [row.id]: null }));
    try {
      await advisorProofApi.cancelConsent(row.id, consent.id);
      setRowNote((n) => ({ ...n, [row.id]: { ok: true, text: `Request to ${consent.attester_name || 'them'} cancelled. Its link no longer opens the claim.` } }));
      if (asking === row.id) setAsking(null);
      await list.refresh();
    } catch (err) {
      setRowNote((n) => ({ ...n, [row.id]: { ok: false, text: proofActionText(err, 'The request could not be cancelled. It is still open.') } }));
    } finally {
      setActing(null);
    }
  };

  // Public preview: the public profile, as a founder sees it. Disabled until a
  // saved profile gives it an address.
  const previewPath = uid ? `/advisors/${encodeURIComponent(uid)}` : null;
  const preview = {
    onClick: () => previewPath && navigate(previewPath),
    disabled: !previewPath,
    title: previewPath ? 'Your public profile, as a founder sees it' : 'Save your profile first: there is no public page yet',
  };

  const attested = state.items.filter((p) => p.attested);
  const selfStated = state.items.filter((p) => !p.attested);
  const awaiting = state.items.filter((p) => (p.consents || []).some((c) => c.state === 'pending'));
  // D392 — the chips are the strip's counts, as views.
  const PROOF_VIEWS = { attested: attested, awaiting: awaiting, self: selfStated };
  const shown = PROOF_VIEWS[view] || state.items;
  // D4689: every figure is the whole list. D7807 (#7807): so is Needs
  // reconfirmation, which the Worker counts in the same read as the others,
  // and the tile reads that figure on any page size. It is never counted off
  // the page: a count that did not come back is Unavailable, never 0.
  const reconfirmCount = Number.isInteger(counts?.needs_reconfirmation) ? counts.needs_reconfirmation : null;

  const addForm = (
    <Card padding="lg">
      <ZoneHeading
        title="Add a claim"
        blurb="Your own statement of your work. It reads as self-stated until a named person confirms it through their own link."
      />
      <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="advisor-proof-add">
        <Field label="What">
          <input className={inputClass} value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Led the payments rebuild" />
        </Field>
        <Field label="Kind">
          <select className={inputClass} value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Where">
          <input className={inputClass} value={draft.organization}
            onChange={(e) => setDraft({ ...draft, organization: e.target.value })} />
        </Field>
        <Field label="When" hint="In your own words.">
          <input className={inputClass} value={draft.period_note}
            onChange={(e) => setDraft({ ...draft, period_note: e.target.value })}
            placeholder="2023–2025" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Detail">
            <textarea rows={2} className={inputClass} value={draft.detail}
              onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className={`${buttonClass} ${tap}`} disabled={busy}>
            {busy ? 'Adding…' : 'Add claim'}
          </button>
        </div>
      </form>
    </Card>
  );

  const empty = (
    <NothingYet
      title="Nothing claimed yet"
      body="Add what you have actually done, then ask the person who saw you do it to confirm it. A claim nobody has confirmed stays visibly weaker than one somebody has — that difference is the point of this zone."
    />
  );

  return (
    <div className="space-y-4">
      {/* EX-08: proof is private until the advisor publishes a confirmed claim. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl rounded-lg border border-axal-hairline bg-white p-3 text-[12px] leading-relaxed text-axal-muted dark:border-gray-700 dark:bg-gray-900" data-testid="advisor-proof-not-public">
          <b className="text-axal-ink dark:text-gray-100">Proof is private.</b> {PROOF_PRIVATE_NOTE}
        </p>
        <button type="button" className={`${buttonClass} ${tap}`} aria-expanded={adding} data-testid="advisor-proof-add-toggle"
          onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : 'Add a claim'}
        </button>
      </div>
      <SaveNote note={note} testid="advisor-proof-note" />

      {/* Canvas stats strip, whole-list counts (D4689). */}
      {state.items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="advisor-proof-tiles">
          {[
            { label: 'Confirmed', value: String(counts?.attested ?? attested.length), note: 'by the person named' },
            { label: 'Awaiting an answer', value: String(counts?.awaiting ?? awaiting.length), note: 'asked, no answer yet' },
            { label: 'Needs reconfirmation', value: reconfirmCount == null ? null : String(reconfirmCount), unread: reconfirmCount == null, testid: 'advisor-proof-reconfirm-count', note: 'an earlier answer no longer counts' },
            { label: 'Not confirmed', value: String(counts?.self_stated ?? selfStated.length), note: 'no current confirmation' },
          ].map((s) => (
            <Card key={s.label} padding="md">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-muted">{s.label}</div>
              <div className="mt-1 text-[15px] font-extrabold tabular-nums" data-testid={s.testid}>
                {s.unread ? <StateChip kind="unavailable" /> : s.value === null ? <Unrecorded /> : s.value}
              </div>
              <div className="mt-0.5 text-[10px] text-axal-muted">{s.note}</div>
            </Card>
          ))}
        </div>
      )}

      {(adding || (!state.loading && !state.error && state.items.length === 0)) && addForm}

      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('expertise/proof', { value: view, onChange: setView })}
        actions={advisorZoneActions('expertise/proof', { handlers: { openPublicPreview: preview }, view: { header: ['Proof', 'Kind', 'Detail', 'Attested', 'Consents recorded'], rows: shown, cells: (r) => [r.title, r.kind, r.detail, r.attested ? 'yes' : 'no', (r.consents || []).length] } })}
      />
      <ZoneBody loading={state.loading} error={state.error} onRetry={load} what="Your proof"
        notice={<StaleNote error={list.refreshError} onRetry={list.refresh} testid="advisor-proof-stale" />}
        isEmpty={state.items.length === 0} empty={empty}>
        {shown.length === 0 && (
          <p className="text-[12.5px] text-axal-muted">{`No claim is in this state. ${counts?.total ?? state.items.length} in total.`}</p>
        )}
        {/* D4828 (EX-04a): two proof cards a row on a tablet, one on a phone and on a desktop. */}
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 lg:grid-cols-1" data-testid="advisor-proof-cards">
          {shown.map((row) => {
            const card = proofCardState(row);
            const tone = PROOF_CARD_STATES[card.state];
            const who = proofWhoLine(card);
            const live = (row.consents || []).filter((c) => c.state === 'confirmed');
            const pending = (row.consents || []).filter((c) => c.state === 'pending');
            const stale = (row.consents || []).filter((c) => c.state === 'needs_reconfirmation');
            const cancelled = (row.consents || []).filter((c) => c.state === 'cancelled');
            const leads = card.state !== 'awaiting' && card.state !== 'confirmed';
            return (
              <Card key={row.id} padding="md" className="min-w-0" data-testid={`advisor-proof-card-${row.id}`}>
                <article aria-label={row.title}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[13.5px] font-extrabold">{row.title}</h3>
                      <div className="mt-0.5 text-[11.5px] text-axal-muted">
                        {[KINDS.find(([k]) => k === row.kind)?.[1] || row.kind, row.organization, row.period_note].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {/* The one label that matters. `attested` comes from the
                        worker, computed from a consent row — the advisor
                        cannot set it about themselves. */}
                    <span data-testid={`advisor-proof-state-${row.id}`}>
                      {row.attested
                        ? <Pill tone="ok" dot>{tone.label}</Pill>
                        : card.state === 'self_stated' ? <Pill tone="neutral">Self-stated</Pill> : <Pill tone={tone.tone} dot>{tone.label}</Pill>}
                    </span>
                  </div>
                  {who && who.who && (
                    <p className="mt-2 text-[12.5px]" data-testid={`advisor-proof-who-${row.id}`}>
                      {who.lead} <b>{who.who}</b>
                    </p>
                  )}
                  <p className="mt-1 text-[11.5px] text-axal-muted" data-testid={`advisor-proof-when-${row.id}`}>{proofWhenLine(card)}</p>
                  <p className="mt-0.5 text-[11.5px] text-axal-muted" data-testid={`advisor-proof-public-${row.id}`}>{proofPublicLine(row)}</p>
                  {row.detail && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">{row.detail}</p>
                  )}

                  {live.map((c) => (
                    <blockquote key={c.id} className="mt-3 border-l-2 border-emerald-400 pl-3">
                      <p className="text-[12px] leading-relaxed text-axal-muted">
                        {c.statement || 'Confirmed, with no statement added.'}
                      </p>
                      <footer className="mt-1 text-[11px] text-axal-muted">
                        {c.attester_name}{c.attester_role ? `, ${c.attester_role}` : ''}
                        {c.relationship ? ` · ${c.relationship}` : ''}
                      </footer>
                    </blockquote>
                  ))}

                  {/* D4670: each pending ask's link, from the list, so a refresh never loses it. */}
                  {pending.filter((c) => c.invite_token).map((c) => (
                    <div key={`link-${c.id}`}>
                      <p className="mt-2 text-[11px] font-semibold">For {c.attester_name}{proofDate(c.requested_at) ? ` · asked ${proofDate(c.requested_at)}` : ''}</p>
                      <ConsentLink token={c.invite_token} onCancel={() => cancel(row, c)} cancelling={acting === `cancel-${c.id}`}
                        testid={`advisor-proof-cancel-${c.id}`} />
                    </div>
                  ))}
                  {stale.length > 0 && (
                    <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300" data-testid="proof-needs-reconfirmation">
                      {stale.map((c) => c.attester_name).join(', ')}: {CONSENT_STATES.needs_reconfirmation}. Their earlier
                      answer is kept on the record and no longer counts as confirmed.
                    </p>
                  )}
                  {(card.state === 'declined' || card.state === 'withdrawn') && (
                    <p className="mt-2 text-[11.5px] text-axal-muted">
                      The record is kept rather than deleted, because an attestation that can vanish is
                      not evidence of anything.
                    </p>
                  )}
                  {cancelled.length > 0 && (
                    <p className="mt-2 text-[11.5px] text-axal-muted">
                      {cancelled.map((c) => `${c.attester_name}: ${CONSENT_STATES.cancelled}${proofDate(c.cancelled_at) ? ` ${proofDate(c.cancelled_at)}` : ''}`).join(' · ')}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {card.state === 'confirmed' && (
                      <button type="button" className={`${row.published ? ghostButtonClass : buttonClass} ${tap}`}
                        disabled={acting === `publish-${row.id}`} data-testid={`advisor-proof-publish-${row.id}`}
                        onClick={() => publish(row, !row.published)}>
                        {acting === `publish-${row.id}` ? 'Saving…' : row.published ? 'Make private' : 'Publish proof'}
                      </button>
                    )}
                    <button type="button" className={`${leads ? buttonClass : ghostButtonClass} ${tap}`}
                      ref={(n) => { rowButtons.current[`ask-${row.id}`] = n; }} aria-expanded={asking === row.id}
                      data-testid={`advisor-proof-ask-toggle-${row.id}`}
                      onClick={() => (asking === row.id ? closeAsk(row.id) : setAsking(row.id))}>
                      {asking === row.id ? 'Close' : ASK_LABELS[card.state]}
                    </button>
                    <button type="button" className={`${ghostButtonClass} ${tap} text-red-700 dark:text-red-300`}
                      onClick={() => (confirming === row.id ? closeConfirm(row.id) : setConfirming(row.id))}
                      ref={(n) => { rowButtons.current[`delete-${row.id}`] = n; }} aria-expanded={confirming === row.id}
                      aria-label={`Delete ${row.title}`} data-testid={`advisor-proof-delete-${row.id}`}>
                      <Trash2 size={13} aria-hidden="true" /> Delete…
                    </button>
                  </div>
                  <SaveNote note={rowNote[row.id] || null} testid={`advisor-proof-row-note-${row.id}`} />

                  {confirming === row.id && (
                    <div role="alertdialog" aria-label={proofDeleteTitle(row)} aria-describedby={`advisor-proof-confirm-lines-${row.id}`}
                      data-testid={`advisor-proof-confirm-${row.id}`}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault?.(); closeConfirm(row.id); } }}
                      className="mt-3 rounded-[10px] border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                      <div className="text-[12.5px] font-bold">{proofDeleteTitle(row)}</div>
                      <ul id={`advisor-proof-confirm-lines-${row.id}`} className="m-0 mt-1 list-disc pl-5 text-[12px] leading-relaxed text-axal-muted">
                        {proofDeleteLines(row).map((l) => <li key={l}>{l}</li>)}
                      </ul>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" ref={keepRef} className={`${ghostButtonClass} ${tap}`} onClick={() => closeConfirm(row.id)} data-testid={`advisor-proof-keep-${row.id}`}>Keep it</button>
                        <button type="button" disabled={deleting} onClick={() => remove(row)} data-testid={`advisor-proof-delete-confirm-${row.id}`}
                          className="inline-flex min-h-[44px] items-center rounded-lg bg-axal-destructive px-3 text-[12px] font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 lg:min-h-[32px]">
                          {deleting ? 'Deleting…' : 'Delete for good'}
                        </button>
                      </div>
                    </div>
                  )}

                  {asking === row.id && (
                    <AskForm item={row} onDone={list.refresh} onClose={() => closeAsk(row.id)}
                      onCancel={(consent) => cancel(row, consent)} />
                  )}
                </article>
              </Card>
            );
          })}
        </div>
        <MoreRows line={list.line} onMore={list.more} busy={list.moreBusy} error={list.moreError} testid="advisor-proof-more" />
      </ZoneBody>
    </div>
  );
}
