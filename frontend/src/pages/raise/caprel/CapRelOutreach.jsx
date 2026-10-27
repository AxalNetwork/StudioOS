import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { cyclesWrite } from '../../../lib/api/cycles';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { Unreadable } from '../../../ui';
import { Dialog, Footer, NextStepDialog, nameOf, useProspects, useWrite } from './CapRelPipeline';
import { tabSearch } from './capRelModel';
import { DRAFT_PURPOSES, followUpGroups, followUpMeta, mailtoHref, snoozedDue } from './capRelTabsModel';

/**
 * D1193 (#3127, CRL8) — Outreach: the follow-ups due, Eadwyn's drafts for
 * the founder to send from their own email, the materials each investor was
 * sent, and the updates to prospects.
 *
 * READS. The prospects (`api.raiseProspects`), the caller's open drafts
 * (`capitalRelationshipsApi.proposals`), the materials read, and the updates
 * (`api.raiseUpdates`). Each block answers alone; one that fails says so.
 * WRITES. Done, Snooze and Set next step through `PUT …/next-step` (the one
 * prospect writer); a draft is one metered run (`…/drafts`), kept or thrown
 * away through `railProposalsApi.decide`. Axal never sends a draft.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200';
const BTN_S = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-2.5 text-[12px] font-semibold text-axal-ink no-underline hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const EADWYN = 'flex h-6 w-6 flex-none items-center justify-center rounded-full bg-axal-violet text-[11px] font-extrabold text-white dark:bg-violet-600';
const H3 = `m-0 text-[14px] font-extrabold ${INK}`;

function useRead(fn, deps) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    Promise.resolve().then(fn)
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...read, reload: () => setN((x) => x + 1) };
}

/** Eadwyn drafts a message (CRL8): one metered run; the draft waits in Outreach, and the founder sends it. */
export function DraftDialog({ projectId, prospect, purpose: initial = 'follow_up', via: initialVia = '', onClose, onDone }) {
  const [purpose, setPurpose] = useState(initial);
  const [via, setVia] = useState(initialVia);
  const w = useWrite((out) => { onDone?.(out?.draft); onClose(); });
  const choices = DRAFT_PURPOSES.filter((p) => p.value !== 'thank_you' || prospect?.stage === 'passed' || initial === 'thank_you');
  return (
    <Dialog label="Draft a message" testId="caprel-draft-dialog" onClose={onClose} title={`Draft a message · ${prospect?.name || 'investor'}`}
      sub="Eadwyn drafts it. Nothing is sent: you read it, change it, and send it from your own email."
      footer={<Footer testId="caprel-draft" busy={w.busy} error={w.error} onClose={onClose} cta="Draft it" disabled={purpose === 'intro' && !via.trim()}
        onGo={() => w.run(() => capitalRelationshipsApi.draft(projectId, { prospect_id: prospect.id, purpose, ...(purpose === 'intro' ? { via: via.trim() } : {}) }), 'Eadwyn could not draft that just now')} />}>
      <div className="flex flex-col gap-3">
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">What it is</legend>
          {choices.map((o) => (
            <label key={o.value} className={`flex items-center gap-2 text-[13px] ${INK}`}>
              <input type="radio" name="caprel-draft-purpose" checked={purpose === o.value} onChange={() => setPurpose(o.value)} data-testid={`caprel-draft-${o.value}`} />{o.label}
            </label>
          ))}
        </fieldset>
        {purpose === 'intro' ? <label className={LABEL}>Who you are asking<input className={FIELD} value={via} maxLength={120} onChange={(e) => setVia(e.target.value)} data-testid="caprel-draft-via" /></label> : null}
        <p className={`m-0 text-[12px] ${MUTED}`}>A draft that names a figure is not kept: Eadwyn never writes an amount.</p>
      </div>
    </Dialog>
  );
}

/** Done or Snooze a next step: the dialog says what changes, and the write goes through the one writer. */
function StepChangeDialog({ projectId, prospect, mode, onClose, onDone }) {
  const due = mode === 'snooze' ? snoozedDue(prospect.next_step_due) : null;
  const w = useWrite(() => { onDone?.(); onClose(); });
  const body = mode === 'done'
    ? { next_step: null, next_step_due: null, warm_path: prospect.warm_path ?? null }
    : { next_step: prospect.next_step, next_step_due: due, warm_path: prospect.warm_path ?? null };
  return (
    <Dialog label={mode === 'done' ? 'Mark done' : 'Snooze'} testId={`caprel-${mode}-dialog`} onClose={onClose}
      title={mode === 'done' ? `Done: ${prospect.next_step}` : `Snooze: ${prospect.next_step}`}
      sub={mode === 'done' ? `The next step with ${nameOf(prospect)} is cleared. Log what happened as a step if you want it on their timeline.` : `The next step with ${nameOf(prospect)} moves to ${due}.`}
      footer={<Footer testId={`caprel-${mode}`} busy={w.busy} error={w.error} onClose={onClose} cta={mode === 'done' ? 'Mark done' : `Snooze to ${due}`}
        onGo={() => w.run(() => cyclesWrite.raise.prospectNextStep(projectId, prospect.id, body), 'That could not be saved')} />}>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>Your co-founders see the change in Outreach and Activity.</p>
    </Dialog>
  );
}

/** Read and change a draft before sending it yourself; Save keeps your version, Dismiss throws it away. */
function DraftEditDialog({ draft, email, onClose, onDone }) {
  const [subject, setSubject] = useState(draft.payload?.subject || '');
  const [body, setBody] = useState(draft.payload?.body || '');
  const w = useWrite(() => { onDone?.(); onClose(); });
  return (
    <Dialog label="Edit draft" testId="caprel-draft-edit" onClose={onClose} width={620} title={`${draft.payload?.eyebrow || 'Draft'} · to ${draft.payload?.to || draft.investor || 'investor'}`}
      sub="Save my version keeps your words in place of Eadwyn’s and closes the draft. Nothing is sent."
      footer={<Footer testId="caprel-draft-edit" busy={w.busy} error={w.error} onClose={onClose} cta="Save my version"
        onGo={() => w.run(() => railProposalsApi.decide(draft.uid, 'edit', { ...draft.payload, subject, body }), 'Your version could not be saved')} />}>
      <div className="flex flex-col gap-3">
        <label className={LABEL}>Subject<input className={FIELD} value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className={LABEL}>Message<textarea className={FIELD} rows={8} value={body} onChange={(e) => setBody(e.target.value)} data-testid="caprel-draft-edit-body" /></label>
        <a className={`${BTN_S} w-fit`} href={mailtoHref(email, subject, body)} data-testid="caprel-draft-edit-mail">Open in my email</a>
      </div>
    </Dialog>
  );
}

function DismissDialog({ draft, onClose, onDone }) {
  const w = useWrite(() => { onDone?.(); onClose(); });
  return (
    <Dialog label="Dismiss draft" testId="caprel-draft-dismiss" onClose={onClose} title="Dismiss this draft?"
      sub={`Eadwyn’s ${String(draft.payload?.eyebrow || 'draft').toLowerCase()} to ${draft.payload?.to || draft.investor || 'this investor'} is thrown away. Nothing was sent.`}
      footer={<Footer testId="caprel-draft-dismiss" busy={w.busy} error={w.error} onClose={onClose} cta="Dismiss"
        onGo={() => w.run(() => railProposalsApi.decide(draft.uid, 'discard'), 'The draft could not be dismissed')} />}>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>You can ask Eadwyn for another draft at any time.</p>
    </Dialog>
  );
}

function FollowUps({ projectId, prospects, onChanged }) {
  const [dialog, setDialog] = useState(null);
  const groups = useMemo(() => followUpGroups(prospects.items || []), [prospects.items]);
  const shown = groups.filter((g) => g.items.length);
  return (
    <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="caprel-outreach-followups">
      <div className="flex items-baseline gap-2"><h3 className={`${H3} mr-auto`}>Follow-ups</h3>{prospects.items ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{followUpMeta(groups)}</span> : null}</div>
      {prospects.status === 'unreadable' ? <Unreadable what="Your investors" claim="This is not a claim that nothing is due." onRetry={prospects.reload} /> : null}
      {prospects.status === 'loading' && !prospects.items ? <div className="h-24 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" /> : null}
      {prospects.items && !shown.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="caprel-outreach-none">No follow-up is due, and everyone in conversation has a next step.</p> : null}
      {shown.map((g) => (
        <div key={g.key} data-testid={`caprel-followups-${g.key}`}>
          <p className={`m-0 pt-3 pb-1 text-[10.5px] font-extrabold uppercase tracking-wide ${g.key === 'overdue' ? 'text-red-700 dark:text-red-300' : MUTED}`}>{g.label} · {g.items.length}</p>
          {g.items.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 dark:border-gray-800" data-testid="caprel-followup">
              <div className="mr-auto min-w-0">
                <div className={`text-[13px] font-bold ${INK}`}>{nameOf(p)}</div>
                <div className={`text-[12px] ${g.key === 'overdue' ? 'text-red-700 dark:text-red-300' : MUTED}`}>
                  {p.next_step ? `${g.key === 'overdue' ? 'Overdue · ' : ''}${p.next_step} · due ${String(p.next_step_due).slice(0, 10)}` : 'No next step'}
                </div>
              </div>
              {p.next_step ? (
                <>
                  <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'done', p })} data-testid="caprel-followup-done">Done</button>
                  <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'snooze', p })} data-testid="caprel-followup-snooze">Snooze</button>
                  <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'draft', p })} data-testid="caprel-followup-draft">Draft a message</button>
                </>
              ) : <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'next', p })} data-testid="caprel-followup-set">Set next step</button>}
            </div>
          ))}
        </div>
      ))}
      {dialog?.kind === 'done' || dialog?.kind === 'snooze' ? <StepChangeDialog projectId={projectId} prospect={dialog.p} mode={dialog.kind} onClose={() => setDialog(null)} onDone={onChanged} /> : null}
      {dialog?.kind === 'next' ? <NextStepDialog projectId={projectId} prospect={dialog.p} onClose={() => setDialog(null)} onDone={onChanged} /> : null}
      {dialog?.kind === 'draft' ? <DraftDialog projectId={projectId} prospect={{ id: dialog.p.id, name: nameOf(dialog.p), stage: dialog.p.stage }} onClose={() => setDialog(null)} onDone={onChanged} /> : null}
    </section>
  );
}

function Drafts({ read, emails }) {
  const [dialog, setDialog] = useState(null);
  const [copied, setCopied] = useState('');
  const copy = (d) => {
    const text = `${d.payload?.subject ? `${d.payload.subject}\n\n` : ''}${d.payload?.body || ''}`;
    Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => setCopied(d.uid), () => setCopied(''));
  };
  const drafts = read.data?.drafts || [];
  return (
    <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="caprel-outreach-drafts">
      <div className="flex items-baseline gap-2"><h3 className={`${H3} mr-auto`}>Drafts</h3>{read.data ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{drafts.length}</span> : null}</div>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>Eadwyn drafts. You send it from your own email.</p>
      {read.status === 'unreadable' ? <Unreadable what="Your drafts" claim="This is not a claim that you have none." onRetry={read.reload} /> : null}
      {read.data && !drafts.length ? <p className={`m-0 pt-2 text-[12.5px] ${MUTED}`} data-testid="caprel-drafts-none">No draft is waiting. Draft a message from a follow-up.</p> : null}
      {drafts.map((d) => (
        <div key={d.uid} className="flex gap-2.5 border-t border-axal-hairline py-2.5 dark:border-gray-800" data-testid="caprel-draft">
          <span className={EADWYN} aria-hidden="true">E</span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={`text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED}`}>{d.payload?.eyebrow || 'Draft'} · to {d.payload?.to || d.investor || 'investor'}</span>
            {d.payload?.subject ? <span className={`text-[12.5px] font-bold ${INK}`}>{d.payload.subject}</span> : null}
            <p className={`m-0 whitespace-pre-line text-[13px] leading-relaxed ${INK}`}>{d.payload?.body}</p>
            <span className={`text-[11.5px] ${MUTED}`}>Drafted by Eadwyn. Nothing is sent until you send it.</span>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className={BTN_S} onClick={() => copy(d)} data-testid="caprel-draft-copy">{copied === d.uid ? 'Copied' : 'Copy'}</button>
              <a className={BTN_S} href={mailtoHref(emails.get(Number(d.payload?.prospect_id)) || '', d.payload?.subject, d.payload?.body)} data-testid="caprel-draft-mail">Open in my email</a>
              <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'edit', d })} data-testid="caprel-draft-edit-open">Edit</button>
              <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'dismiss', d })} data-testid="caprel-draft-dismiss-open">Dismiss</button>
            </div>
          </div>
        </div>
      ))}
      {dialog?.kind === 'edit' ? <DraftEditDialog draft={dialog.d} email={emails.get(Number(dialog.d.payload?.prospect_id)) || ''} onClose={() => setDialog(null)} onDone={read.reload} /> : null}
      {dialog?.kind === 'dismiss' ? <DismissDialog draft={dialog.d} onClose={() => setDialog(null)} onDone={read.reload} /> : null}
    </section>
  );
}

function Materials({ projectId, search }) {
  const read = useRead(() => capitalRelationshipsApi.materials(projectId), [projectId]);
  const tone = (c) => (c?.state === 'sent' ? INK : MUTED);
  return (
    <section className={`${CARD} flex min-w-0 flex-col`} data-testid="caprel-outreach-materials">
      <h3 className={`${H3} px-4 pt-4`}>Materials sent</h3>
      {read.status === 'unreadable' ? <div className="px-4 py-3"><Unreadable what="Materials sent" claim="This is not a claim that nothing was sent." onRetry={read.reload} /></div> : null}
      {read.status === 'loading' && !read.data ? <div className="m-4 h-24 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" /> : null}
      {read.data ? (
        <div className="overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
            <thead><tr className={`border-b border-axal-hairline text-[10.5px] font-extrabold uppercase tracking-wide ${MUTED} dark:border-gray-800`}>
              {['Investor', 'Deck link', 'Data room', 'Call for Capital'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {(read.data.items || []).map((m) => (
                <tr key={m.prospect_id} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="caprel-material">
                  <td className={`px-3 py-2 font-bold ${INK}`}>{m.name}</td>
                  <td className={`px-3 py-2 font-mono ${tone(m.deck)}`}>{m.deck.text}</td>
                  <td className={`px-3 py-2 font-mono ${tone(m.data_room)}`}>{m.data_room.text}</td>
                  <td className={`px-3 py-2 ${tone(m.call)}`}>{m.call.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(read.data.items || []).length ? <p className={`m-0 px-3 py-2 text-[12.5px] ${MUTED}`}>No investor is in conversation yet.</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-2">
        <p className={`m-0 mr-auto text-[11.5px] ${MUTED}`}>{read.data?.basis || 'Deck links come from the Pitch deck; data-room access from the Data room.'}</p>
        <Link to={`/raise/pitch${tabSearch(search)}`} className={BTN_S} data-testid="caprel-outreach-deck-link">Send a deck link</Link>
      </div>
    </section>
  );
}

function Updates({ projectId, search }) {
  const read = useRead(() => api.raiseUpdates(projectId), [projectId]);
  const shared = read.data?.shared_updates || [];
  const recorded = read.data?.items || [];
  return (
    <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="caprel-outreach-updates">
      <h3 className={H3}>Updates to prospects</h3>
      {read.status === 'unreadable' ? <Unreadable what="Your updates" claim="This is not a claim that none were shared." onRetry={read.reload} /> : null}
      {shared.map((u) => (
        <div key={u.uid} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 dark:border-gray-800" data-testid="caprel-update-shared">
          <div className="mr-auto"><div className={`text-[13px] font-bold ${INK}`}>{u.title || u.period || 'An update'} · shared {String(u.sent_at).slice(0, 10)} with {u.investors} {Number(u.investors) === 1 ? 'investor' : 'investors'}</div><div className={`text-[12px] ${MUTED}`}>Shared from Grow</div></div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">Shared</span>
        </div>
      ))}
      {recorded.map((u) => (
        <div key={u.uid} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 dark:border-gray-800" data-testid="caprel-update-recorded">
          <div className="mr-auto"><div className={`text-[13px] font-bold ${INK}`}>{u.subject}</div><div className={`text-[12px] ${MUTED}`}>Recorded on the timeline, never emailed.</div></div>
          <span className={`rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-bold ${MUTED} dark:border-gray-700`}>Read only</span>
        </div>
      ))}
      {read.data && !shared.length && !recorded.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No update has gone to prospects yet.</p> : null}
      <Link to={`/grow/update${tabSearch(search)}`} className={`${BTN_S} mt-2 w-fit`} data-testid="caprel-outreach-share">Share an update</Link>
      <p className={`m-0 text-[11.5px] ${MUTED}`}>Updates go through Grow’s share sheet.</p>
    </section>
  );
}

export default function CapRelOutreach({ projectId, search = '' }) {
  const prospects = useProspects(projectId);
  const drafts = useRead(() => capitalRelationshipsApi.proposals(projectId), [projectId]);
  const emails = useMemo(() => new Map((prospects.items || []).filter((p) => p.email).map((p) => [Number(p.id), p.email])), [prospects.items]);
  const changed = useCallback(() => { prospects.reload(); drafts.reload(); }, [prospects, drafts]);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" data-testid="caprel-outreach">
      <div className="lg:col-span-7"><FollowUps projectId={projectId} prospects={prospects} onChanged={changed} /></div>
      <div className="lg:col-span-5"><Drafts read={drafts} emails={emails} /></div>
      <div className="min-w-0 lg:col-span-8"><Materials projectId={projectId} search={search} /></div>
      <div className="lg:col-span-4"><Updates projectId={projectId} search={search} /></div>
    </div>
  );
}
