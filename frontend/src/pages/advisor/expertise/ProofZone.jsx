import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, NothingYet, Pill, SaveNote, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass,
} from './kit';

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
 * THE LINK IS SHOWN ONCE. The worker returns `request_token` on the request and
 * on no later read — an advisor who could read the token back could answer on
 * the attester's behalf, which would make every attestation here self-issued.
 * So the link lives in this component's state until the page is left, and the
 * copy says so rather than letting someone discover it by coming back.
 *
 * NOTHING IS SENT FROM HERE. Recording the ask and delivering it are separate,
 * and a page that quietly emailed an address someone typed would be deciding
 * the second one on its own.
 */

const KINDS = [
  ['engagement', 'Engagement'],
  ['outcome', 'Outcome'],
  ['role', 'Role'],
  ['credential', 'Credential'],
];

const BLANK = { kind: 'engagement', title: '', organization: '', period_note: '', detail: '' };

function ConsentLink({ token }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/attest/${token}`;
  return (
    <Card variant="accent" padding="md" className="mt-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        Send this link yourself — shown once
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-axal-ink-2">
        Nothing was emailed. Give this to the person you named, through whatever channel you
        already have with them. It will not be shown again after you leave this page.
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
  const [token, setToken] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setNote(null);
    if (!draft.attester_name.trim()) {
      setNote({ ok: false, text: 'Name the person you are asking.' });
      return;
    }
    setBusy(true);
    try {
      const res = await api.requestAdvisorProofConsent(item.id, {
        attester_name: draft.attester_name.trim(),
        attester_email: draft.attester_email.trim() || null,
        attester_role: draft.attester_role.trim() || null,
        relationship: draft.relationship.trim() || null,
      });
      setToken(res?.request_token || null);
      setNote({ ok: true, text: 'Request recorded. The claim stays self-stated until they answer.' });
      onDone?.();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'The request could not be recorded.' });
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
        <Field label="Their email" hint="Optional. Recorded for your reference; nothing is sent.">
          <input className={inputClass} value={draft.attester_email}
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
      {token && <ConsentLink token={token} />}
    </form>
  );
}

export default function ProofZone() {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [asking, setAsking] = useState(null);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorProof();
      setState({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your proof record could not be read.', items: [] });
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
      setNote({ ok: false, text: err?.message || 'That could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    setNote(null);
    try {
      await api.deleteMyAdvisorProof(row.id);
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be removed.' });
    }
  };

  const empty = (
    <NothingYet
      title="Nothing claimed yet"
      body="Add what you have actually done, then ask the person who saw you do it to confirm it. A claim nobody has confirmed stays visibly weaker than one somebody has — that difference is the point of this zone."
    />
  );

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <ZoneHeading
          title="Add a claim"
          blurb="Your own statement of your work. It renders as self-stated until a named person confirms it through their own link."
        />
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

      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={state.items.length === 0} empty={empty}>
        <div className="space-y-3">
          {state.items.map((row) => {
            const live = (row.consents || []).filter((c) => c.consent_given && !c.withdrawn_at);
            const pending = (row.consents || []).filter((c) => !c.consent_given && !c.withdrawn_at);
            const withdrawn = (row.consents || []).filter((c) => c.withdrawn_at);
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
                    <div className="mt-0.5 text-[11.5px] text-axal-ink-3">
                      {[row.organization, row.period_note].filter(Boolean).join(' · ')}
                    </div>
                    {row.detail && (
                      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">{row.detail}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={ghostButtonClass}
                      onClick={() => setAsking(asking === row.id ? null : row.id)}>
                      {asking === row.id ? 'Close' : 'Ask someone to confirm'}
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={() => remove(row)}
                      aria-label={`Remove ${row.title}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {live.map((c) => (
                  <blockquote key={c.id} className="mt-3 border-l-2 border-emerald-400 pl-3">
                    <p className="text-[12px] leading-relaxed text-axal-ink-2">
                      {c.statement || 'Confirmed, with no statement added.'}
                    </p>
                    <footer className="mt-1 text-[11px] text-axal-ink-3">
                      {c.attester_name}{c.attester_role ? `, ${c.attester_role}` : ''}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </footer>
                  </blockquote>
                ))}

                {pending.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-axal-ink-3">
                    Waiting on {pending.map((c) => c.attester_name).join(', ')}. Asking is not being
                    told yes — this stays self-stated until they answer.
                  </p>
                )}
                {withdrawn.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-axal-ink-3">
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
