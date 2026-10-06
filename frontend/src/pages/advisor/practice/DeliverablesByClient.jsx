import React, { useState } from 'react';
import { Card, Pill, Unrecorded } from '../../../ui';
import { Field, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import { STATE_TONE, versionTag } from './deliveryTrail';
import {
  DELIVERABLE_FLOW, attachmentBody, attachmentOf, deliverableEdit, deliverableStep,
  groupByClient, linkHost, safeHref,
} from './practiceTools';

/** Ops A1: client grouping, due date, planned/in-progress work status and delivery/version receipts. */

const STEP_TONE = { ...STATE_TONE, planned: 'neutral', in_progress: 'info', accepted: 'ok' };
const STEP_LABEL = Object.fromEntries(DELIVERABLE_FLOW.map((s) => [s.key, s.label]));

const LABEL = 'text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint';
const GRID = 'grid grid-cols-2 gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,2fr)_96px_minmax(0,1.1fr)_minmax(0,1fr)_auto] md:items-center';

/** The canvas's legend, with what each step is in the store. */
export function FlowLegend() {
  return (
    <div data-testid="deliverable-flow">
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-axal-muted">
        <span>Status flow:</span>
        {DELIVERABLE_FLOW.map((step, i) => (
          <React.Fragment key={step.key}>
            {i > 0 && <span aria-hidden="true" className="text-axal-faint">→</span>}
            <Pill tone={STEP_TONE[step.key]}>{step.label}</Pill>
          </React.Fragment>
        ))}
      </div>
      <p className="mt-1.5 max-w-3xl text-[11px] leading-relaxed text-axal-faint">
        Planned and In progress are recorded by you. Sent and Opened come from delivery receipts.
        Accepted is the client&rsquo;s sign-off on the latest version.
      </p>
    </div>
  );
}

export default function DeliverablesByClient({
  items, engagements = [], busy = '', editing = null, attaching = null,
  onEdit, onAttachOpen, onSave, onAttach, onSend,
}) {
  const groups = groupByClient(items);
  return (
    <div className="space-y-3" data-testid="deliverables-by-client">
      <FlowLegend />
      {groups.map((group) => (
        <Card key={group.client || 'client-not-recorded'} padding="none" className="overflow-hidden"
          data-testid={`client-group-${group.client || 'not-recorded'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
            <strong className="text-[13px] font-extrabold tracking-tight">
              {group.client || <Unrecorded>Client not recorded</Unrecorded>}
            </strong>
            <span className="text-[11px] tabular-nums text-axal-faint">
              {group.rows.length} {group.rows.length === 1 ? 'deliverable' : 'deliverables'}
            </span>
          </div>
          <div className={`${GRID} hidden border-b border-axal-hairline bg-axal-ground px-4 py-2 md:grid dark:border-gray-700 dark:bg-gray-900/40`}>
            <span className={LABEL}>Deliverable</span>
            <span className={LABEL}>Due</span>
            <span className={LABEL}>Status</span>
            <span className={LABEL}>Attachment</span>
            <span />
          </div>
          {group.rows.map((item) => (
            <ClientRow key={item.id} item={item} engagements={engagements} busy={busy}
              editing={editing === item.id} attaching={attaching === item.id}
              onEdit={onEdit} onAttachOpen={onAttachOpen} onSave={onSave} onAttach={onAttach} onSend={onSend} />
          ))}
        </Card>
      ))}
    </div>
  );
}

function ClientRow({ item, engagements, busy, editing, attaching, onEdit, onAttachOpen, onSave, onAttach, onSend }) {
  const latest = item.latest_version;
  const step = deliverableStep(item);
  const sendable = Boolean(latest && !latest.sent_at && item.client_user_email);
  const att = attachmentOf(item);
  const href = att ? safeHref(att.url) : null;
  return (
    <div className="border-b border-axal-hairline last:border-b-0 dark:border-gray-800" data-testid={`row-a1-${item.id}`}>
      <div className={`${GRID} px-4 py-2.5`}>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <span className="text-[12.5px] font-bold">{item.title}</span>
          {versionTag(latest) && <span className="ml-1.5 text-[10.5px] tabular-nums text-axal-faint">{versionTag(latest)}</span>}
        </div>
        <div className="text-[12px]">
          <span className={`${LABEL} mr-1.5 md:hidden`}>Due</span>
          {item.due_date || <Unrecorded reason="No due date has been set.">Not recorded</Unrecorded>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className={`${LABEL} md:hidden`}>Status</span>
          {step
            ? <Pill tone={STEP_TONE[step]}>{STEP_LABEL[step]}</Pill>
            : <Unrecorded reason="No work status was recorded, and the latest version has no delivery receipt.">Not recorded</Unrecorded>}
          {sendable && (
            <button type="button" className={ghostButtonClass} disabled={busy === `s-${item.id}`}
              onClick={() => onSend?.(item)} data-testid={`send-a1-${item.id}`}>
              Send {versionTag(latest)}
            </button>
          )}
          {!latest?.sent_at && !item.client_user_email && (
            <span className="text-[10.5px] text-amber-700 dark:text-amber-300">No client account, so it cannot be sent</span>
          )}
        </div>
        <div className="min-w-0 text-[12px]">
          <span className={`${LABEL} mr-1.5 md:hidden`}>Attachment</span>
          {att && href && (
            <a href={href} target="_blank" rel="noopener noreferrer" data-testid={`link-a1-${item.id}`}
              className="font-semibold text-emerald-700 underline dark:text-emerald-300">
              {linkHost(href) || 'Open link'}&nbsp;↗
            </a>
          )}
          {/* By version NUMBER: the route builds `latest_version` and each
              entry of `versions` as separate objects, so identity never holds. */}
          {att && href && Number(att.version.version) !== Number(latest?.version) && (
            <span className="ml-1 text-[10.5px] text-axal-faint">on {versionTag(att.version)}</span>
          )}
          {att && !href && <Unrecorded reason="The link recorded is not a web address.">Not a web address</Unrecorded>}
          {!att && (
            <>
              <Unrecorded>No link</Unrecorded>
              <button type="button" className="ml-2 text-[12px] font-semibold text-emerald-700 underline dark:text-emerald-300"
                onClick={() => onAttachOpen?.(attaching ? null : item.id)} data-testid={`attach-a1-${item.id}`}>
                Attach
              </button>
            </>
          )}
        </div>
        <div className="col-span-2 md:col-span-1 md:text-right">
          <button type="button" className={ghostButtonClass} onClick={() => onEdit?.(editing ? null : item.id)}
            data-testid={`edit-a1-${item.id}`}>
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>
      {editing && (
        <div className="px-4 pb-3">
          <DeliverableEditor item={item} engagements={engagements} busy={busy === `e-${item.id}`}
            onCancel={() => onEdit?.(null)} onSave={onSave} />
        </div>
      )}
      {attaching && (
        <div className="px-4 pb-3">
          <AttachForm item={item} busy={busy === `a-${item.id}`} onCancel={() => onAttachOpen?.(null)} onAttach={onAttach} />
        </div>
      )}
    </div>
  );
}

/**
 * The edit form, shared with the flat list in `DeliveryZone`.
 *
 * `onSave(item, body)` resolves to null on success (the page reloads and says
 * so) or to the route's refusal, which is shown here, under the form that
 * caused it.
 */
export function DeliverableEditor({ item, engagements = [], busy = false, onCancel, onSave }) {
  const [draft, setDraft] = useState({
    title: item.title || '',
    engagement_id: item.engagement_id == null ? '' : String(item.engagement_id),
    client_name: item.client_name || '',
    due_date: item.due_date || '', manual_status: item.manual_status || '',
  });
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const plan = deliverableEdit(item, draft);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (plan.error) { setError(plan.error); return; }
    if (plan.confirm && !confirming) { setConfirming(true); return; }
    const refusal = await onSave?.(item, plan.body);
    if (refusal) { setError(refusal); setConfirming(false); }
  };

  const set = (key) => (e) => { setConfirming(false); setDraft((d) => ({ ...d, [key]: e.target.value })); };
  const target = engagements.find((x) => String(x.id) === draft.engagement_id);

  return (
    <form onSubmit={submit} data-testid={`editor-a1-${item.id}`}
      className="rounded-[10px] border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <input className={inputClass} value={draft.title} onChange={set('title')} />
        </Field>
        <Field label="Due date"><input type="date" className={inputClass} value={draft.due_date} onChange={set('due_date')} /></Field>
        <Field label="Work status" hint="Delivery and acceptance are recorded by receipts.">
          <select className={inputClass} value={draft.manual_status} onChange={set('manual_status')}>
            <option value="">Not recorded</option><option value="planned">Planned</option><option value="in_progress">In progress</option>
          </select>
        </Field>
        <Field label="Engagement" hint="A work product under a contract takes its client from it.">
          <select className={inputClass} value={draft.engagement_id} onChange={set('engagement_id')}>
            <option value="">No engagement: type the client below</option>
            {engagements.map((x) => (
              <option key={x.id} value={String(x.id)}>
                {x.client_name}{x.founder_user_id ? '' : ' (no account, so it cannot be sent)'}
              </option>
            ))}
          </select>
        </Field>
        {!draft.engagement_id && (
          <Field label="Client">
            <input className={inputClass} value={draft.client_name} onChange={set('client_name')} />
          </Field>
        )}
      </div>
      {confirming && (
        <p className="mt-2 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300" role="alert">
          {moveWarning(item, target)} Save again to move it.
        </p>
      )}
      {error && <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Saving…' : confirming ? 'Move it and save' : 'Save'}
        </button>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * What moving a SENT work product does, in the client's terms. The founder's
 * received list joins through the engagement, so the move is seen on both
 * sides — which is why it is confirmed rather than saved on the first click.
 */
export function moveWarning(item, target) {
  const from = item?.engagement_id != null ? item.client_name : null;
  const to = target?.client_name || null;
  if (from && to) return `This work product has been sent. Moving it takes it out of ${from}’s received work, and ${to} will see it instead.`;
  if (from) return `This work product has been sent. Taking it off its engagement takes it out of ${from}’s received work.`;
  if (to) return `This work product has been sent. Linking it puts it in ${to}’s received work.`;
  return 'This work product has been sent.';
}

/**
 * Attach a link. A link lives on a version and a recorded version is never
 * edited, so this records the NEXT version, not sent, carrying the link — and
 * the form says so before anything is written.
 */
export function AttachForm({ item, busy = false, onCancel, onAttach }) {
  const [draft, setDraft] = useState({ link_url: '', summary: '' });
  const [error, setError] = useState('');
  const next = Number(item.version_count || 0) + 1;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const res = attachmentBody(draft);
    if (res.error) { setError(res.error); return; }
    const refusal = await onAttach?.(item, res.body);
    if (refusal) setError(refusal);
  };

  return (
    <form onSubmit={submit} data-testid={`attach-form-a1-${item.id}`}
      className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Link">
          <input className={inputClass} value={draft.link_url} placeholder="https://…"
            onChange={(e) => setDraft((d) => ({ ...d, link_url: e.target.value }))} />
        </Field>
        <Field label="What changed" hint="The line the version trail shows.">
          <input className={inputClass} value={draft.summary}
            onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))} />
        </Field>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
        A link travels with a version, and a recorded version is never edited, so this records
        <strong> v{next}, not sent</strong>, carrying the link.
      </p>
      {error && <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Attaching…' : `Attach as v${next}`}</button>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
