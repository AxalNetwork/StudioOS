import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, Trash2 } from 'lucide-react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  ASK_REFUSALS, Field, NothingYet, Pill, SaveNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass, refusalText,
} from './kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import {
  PROOF_DELETE_FAILED, PROOF_NOT_PUBLIC, proofDeleteLines, proofDeleteTitle, proofDeletedLine,
} from './expertiseModel';

/**
 * Expertise · Proof — what you claim, and who has confirmed it.
 *
 * THE WHOLE ZONE IS ONE DISTINCTION: a claim you made about your own work, and
 * a claim someone else has confirmed. They are different evidence and this page
 * must never render them the same way. `attested` is computed by the worker
 * from whether a live consent row exists (migration 204), so it cannot be set
 * by the person it describes.
 *
 * ASKING IS NOT BEING TOLD YES. Recording a consent request leaves the item
 * self-stated. It becomes attested only when the named person answers through
 * their own link.
 *
 * THE LINK IS AN INVITATION (D4670). Each pending ask carries `invite_token`
 * on every read, so the link is drawn from the list and a refresh never loses
 * it. Holding it lets someone read the claim, not answer it: answering needs a
 * code that Axal emails, when the attester asks for one, to the address named
 * here. That is why the address is required and cannot be the advisor's own.
 *
 * NOTHING IS SENT FROM HERE. Recording the ask and handing over the link are
 * the advisor's; the only mail is the attester's own code, sent on their
 * request.
 *
 * A REFUSAL READS AS A FIXED SENTENCE keyed on its code (`ASK_REFUSALS` in
 * the kit), never the raw error text.
 *
 * D4681 (#4681): DELETING IS DELIBERATE AND WHOLE. The trash button asks
 * first and says what goes with the claim (every consent record, names and
 * statements, and any link still out), that it cannot be undone and that no
 * copy is kept. The Worker deletes the claim and its consents in one batch,
 * so a failure leaves both as they were, and the page says so.
 *
 * NOTHING HERE IS PUBLIC. `is_public` is stored, but no page shows a proof item
 * to anyone else; publishing waits on the attestation rules (P1). The header's
 * Public preview opens the public profile as a founder sees it, which is how
 * the advisor can check that for themselves.
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
  needs_reconfirmation: 'Confirmed before verification, or about an earlier wording: ask again',
});

function ConsentLink({ token }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/attest/${token}`;
  return (
    <Card variant="accent" padding="md" className="mt-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
        Send this link yourself
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
        Nothing was emailed. Give this to the person you named, through whatever channel you
        already have with them. It shows them the claim; to answer, they ask for a code that Axal
        emails to the address you gave, so the link alone cannot confirm anything.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white/70 px-2 py-1.5 text-[11.5px] dark:bg-gray-900/70">{url}</code>
        <button type="button" className={ghostButtonClass}
          onClick={() => {
            navigator.clipboard?.writeText(url).then(
              () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); },
              () => setCopied(false),
            );
          }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </Card>
  );
}

function AskForm({ item, onDone }) {
  const [draft, setDraft] = useState({ attester_name: '', attester_email: '', attester_role: '', relationship: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

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
        relationship: draft.relationship.trim() || null,
      });
      setDraft({ attester_name: '', attester_email: '', attester_role: '', relationship: '' });
      setNote({ ok: true, text: res?.invite_token
        ? 'Request recorded. Its link is on the claim below. The claim stays self-stated until they answer.'
        : 'Request recorded. The claim stays self-stated until they answer.' });
      onDone?.();
    } catch (err) {
      setNote({ ok: false, text: refusalText(err, 'The request could not be recorded. Nothing was saved.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Who confirms this">
          <input className={inputClass} value={draft.attester_name}
            onChange={(e) => setDraft({ ...draft, attester_name: e.target.value })} />
        </Field>
        <Field label="Their email" hint="Required. When they answer, Axal emails their code here. It cannot be your own.">
          <input type="email" className={inputClass} value={draft.attester_email}
            onChange={(e) => setDraft({ ...draft, attester_email: e.target.value })} />
        </Field>
        <Field label="Their role">
          <input className={inputClass} value={draft.attester_role}
            onChange={(e) => setDraft({ ...draft, attester_role: e.target.value })} />
        </Field>
        <Field label="How you worked together">
          <input className={inputClass} value={draft.relationship}
            onChange={(e) => setDraft({ ...draft, relationship: e.target.value })} />
        </Field>
      </div>
      <button type="submit" className={`${buttonClass} mt-3`} disabled={busy}>
        {busy ? 'Recording…' : 'Record the ask'}
      </button>
      <SaveNote note={note} />
    </form>
  );
}

export default function ProofZone() {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [asking, setAsking] = useState(null);
  const [view, setView] = useState('all');
  const [confirming, setConfirming] = useState(null);
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

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorProof();
      setState({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [] });
    } catch (e) {
      setState({ loading: false, error: refusalText(e, 'Your proof record could not be read.'), items: [] });
    }
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
      await load();
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
      await load();
    } catch (err) {
      setNote({ ok: false, text: refusalText(err, PROOF_DELETE_FAILED) });
    } finally {
      setDeleting(false);
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
  // D392 — the chips are the strip's three counts, as views.
  const PROOF_VIEWS = { attested: attested, awaiting: awaiting, self: selfStated };
  const shown = PROOF_VIEWS[view] || state.items;

  const empty = (
    <NothingYet
      title="Nothing claimed yet"
      body="Add what you have actually done, then ask the person who saw you do it to confirm it. A claim nobody has confirmed stays visibly weaker than one somebody has — that difference is the point of this zone."
    />
  );

  return (
    <div className="space-y-4">
      {/* Canvas stats strip — attested vs self-stated is the contrast the page is built on. */}
      {state.items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Attested', value: String(attested.length), note: 'named client, dated' },
            { label: 'Awaiting consent', value: String(awaiting.length), note: 'asked, no answer yet' },
            { label: 'Self-stated', value: String(selfStated.length), note: 'no external attestation' },
            // No verifying body is connected, so this is absent — never a dash
            // that reads like a value somebody chose (D392).
            { label: 'Credential verified', value: null, note: 'no verifying body connected' },
          ].map((s) => (
            <Card key={s.label} padding="md">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{s.label}</div>
              <div className="mt-1 text-[15px] font-extrabold tabular-nums">{s.value === null ? <Unrecorded /> : s.value}</div>
              <div className="mt-0.5 text-[10px] text-axal-faint">{s.note}</div>
            </Card>
          ))}
        </div>
      )}

      <Card padding="lg">
        <ZoneHeading
          title="Add a claim"
          blurb="Your own statement of your work. It renders as self-stated until a named person confirms it through their own link."
        />
        <p className="-mt-1 mb-3 max-w-2xl text-[12px] leading-relaxed text-axal-muted" data-testid="advisor-proof-not-public">{PROOF_NOT_PUBLIC}</p>
        <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Adding…' : 'Add claim'}
            </button>
            <SaveNote note={note} />
          </div>
        </form>
      </Card>

      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('expertise/proof', { value: view, onChange: setView })}
        actions={advisorZoneActions('expertise/proof', { handlers: { openPublicPreview: preview }, view: { header: ['Proof', 'Kind', 'Detail', 'Attested', 'Consents recorded'], rows: shown, cells: (r) => [r.title, r.kind, r.detail, r.attested ? 'yes' : 'no', (r.consents || []).length] } })}
      />
      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={state.items.length === 0} empty={empty}>
        {shown.length === 0 && (
          <p className="text-[12.5px] text-axal-muted">{`No claim is in this state. ${state.items.length} in total.`}</p>
        )}
        <div className="space-y-3">
          {shown.map((row) => {
            const live = (row.consents || []).filter((c) => c.state === 'confirmed');
            const pending = (row.consents || []).filter((c) => c.state === 'pending');
            const withdrawn = (row.consents || []).filter((c) => c.state === 'withdrawn' || c.state === 'declined');
            const stale = (row.consents || []).filter((c) => c.state === 'needs_reconfirmation');
            return (
              <Card key={row.id} padding="md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-extrabold">{row.title}</span>
                      <Pill tone="neutral">{KINDS.find(([k]) => k === row.kind)?.[1] || row.kind}</Pill>
                      {/* The one label that matters. `attested` comes from the
                          worker, computed from a consent row — the advisor
                          cannot set it about themselves. */}
                      {row.attested
                        ? <Pill tone="ok" dot>Confirmed by {live.length === 1 ? live[0].attester_name : `${live.length} people`}</Pill>
                        : <Pill tone="warn">Self-stated</Pill>}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-axal-faint">
                      {[row.organization, row.period_note].filter(Boolean).join(' · ')}
                    </div>
                    {row.detail && (
                      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-muted">{row.detail}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={ghostButtonClass}
                      onClick={() => setAsking(asking === row.id ? null : row.id)}>
                      {asking === row.id ? 'Close' : 'Ask someone to confirm'}
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={() => setConfirming(confirming === row.id ? null : row.id)}
                      aria-label={`Delete ${row.title}`} data-testid={`advisor-proof-delete-${row.id}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {confirming === row.id && (
                  <div role="alertdialog" aria-label={proofDeleteTitle(row)} data-testid={`advisor-proof-confirm-${row.id}`}
                    className="mt-3 rounded-[10px] border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                    <div className="text-[12.5px] font-bold">{proofDeleteTitle(row)}</div>
                    <ul className="m-0 mt-1 list-disc pl-5 text-[12px] leading-relaxed text-axal-muted">
                      {proofDeleteLines(row).map((l) => <li key={l}>{l}</li>)}
                    </ul>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className={ghostButtonClass} onClick={() => setConfirming(null)} data-testid={`advisor-proof-keep-${row.id}`}>Keep it</button>
                      <button type="button" disabled={deleting} onClick={() => remove(row)} data-testid={`advisor-proof-delete-confirm-${row.id}`}
                        className="inline-flex min-h-[32px] items-center rounded-lg bg-axal-destructive px-3 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                        {deleting ? 'Deleting…' : 'Delete for good'}
                      </button>
                    </div>
                  </div>
                )}

                {live.map((c) => (
                  <blockquote key={c.id} className="mt-3 border-l-2 border-emerald-400 pl-3">
                    <p className="text-[12px] leading-relaxed text-axal-muted">
                      {c.statement || 'Confirmed, with no statement added.'}
                    </p>
                    <footer className="mt-1 text-[11px] text-axal-faint">
                      {c.attester_name}{c.attester_role ? `, ${c.attester_role}` : ''}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </footer>
                  </blockquote>
                ))}

                {pending.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-axal-faint">
                    Waiting on {pending.map((c) => c.attester_name).join(', ')}. Asking is not being
                    told yes — this stays self-stated until they answer.
                  </p>
                )}
                {/* D4670: each pending ask's link, from the list, so a refresh never loses it. */}
                {pending.filter((c) => c.invite_token).map((c) => (
                  <div key={`link-${c.id}`}>
                    <p className="mt-2 text-[11px] font-semibold">For {c.attester_name}</p>
                    <ConsentLink token={c.invite_token} />
                  </div>
                ))}
                {stale.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300" data-testid="proof-needs-reconfirmation">
                    {stale.map((c) => c.attester_name).join(', ')}: {CONSENT_STATES.needs_reconfirmation}. Their earlier
                    answer is kept on the record and no longer counts as confirmed.
                  </p>
                )}
                {withdrawn.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-axal-faint">
                    {withdrawn.map((c) => c.attester_name).join(', ')} declined or withdrew. The
                    record is kept rather than deleted, because an attestation that can vanish is
                    not evidence of anything.
                  </p>
                )}

                {asking === row.id && <AskForm item={row} onDone={load} />}
              </Card>
            );
          })}
        </div>
      </ZoneBody>
    </div>
  );
}
