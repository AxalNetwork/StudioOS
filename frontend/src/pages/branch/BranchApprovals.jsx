/**
 * Branch · Approvals — canvas S3, the To-HQ lane (D112).
 *
 * HALF A PAGE, AND IT SAYS WHICH HALF. S3 draws five lanes: four local queues
 * and one outbound to HQ. The four local ones need the approvals read model
 * that PR 13 builds, so this page ships the outbound lane LIVE beside the
 * stated notice for the board. That is the honest shape: a page that waited
 * for all five would leave a branch with no way to ask HQ for anything, and
 * one that quietly drew five lanes with four of them empty would be worse.
 *
 * THE ANSWER IS ONE DECISION, NOT A THREAD, and this page must not suggest
 * otherwise. The canvas says "the answer coming back as a thread with HQ's
 * decision and who made it"; what exists is a single answer with an author and
 * a time. So the drawer renders the decision and no reply box — a reply box
 * that wrote nowhere would be the most expensive kind of lie on this screen,
 * because the person using it would believe they had replied.
 *
 * A SUSPENDED BRANCH CAN STILL RAISE. The frozen banner (D107) names an appeal
 * and the appeal is an escalation, so this form stays live while every other
 * branch write answers 423.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZonePending from './BranchZonePending';

const UNAVAILABLE = Symbol('unavailable');

/**
 * The four things a branch cannot decide for itself, with the words the
 * subsidiary canvas uses. A fifth is a product decision, not a new option.
 */
const KINDS = [
  ['moderation', 'Moderation', 'A case you want HQ to take rather than decide here.'],
  ['content', 'Content for brand approval', 'A localised or original piece that needs HQ sign-off.'],
  ['seat_increase', 'Seat increase', 'Seats are set by HQ, so this is a request to make.'],
  ['other', 'Other', 'Anything the three above do not cover.'],
];

const PILL = 'shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em]';
/**
 * `undelivered` IS NOT AN ERROR STYLE BY ACCIDENT. It is the one state a person
 * can act on — retry — and the only one where the branch holds a row HQ does
 * not, so it reads differently from both open and answered.
 */
const STATUS_PILL = {
  open: `${PILL} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`,
  answered: `${PILL} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`,
  undelivered: `${PILL} bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300`,
};
/** The SLA band the server derived. Never recomputed here — one definition. */
const SLA_LABEL = { ok: null, due_soon: 'due within 24h', past: 'past SLA' };

export default function BranchApprovals() {
  const [lane, setLane] = useState(null);           // null = loading, UNAVAILABLE = failed
  const [kind, setKind] = useState('other');
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const load = useCallback(() => {
    setLane(null);
    api.branchEscalations().then(setLane, (e) => {
      reportError('branch-escalations', e);
      setLane(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      await api.branchEscalate({ kind, subject: subject.trim(), detail: detail.trim() || undefined });
      setSubject('');
      setDetail('');
      load();
    } catch (err) {
      reportError('branch-escalate', err);
      setSendError(err?.message || 'The escalation could not be raised.');
    } finally {
      setSending(false);
    }
  };

  const ready = lane && lane !== UNAVAILABLE && lane.available;
  const items = ready ? (lane.items || []) : [];

  return (
    <div className="space-y-4" data-testid="branch-approvals-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Send size={13} /> S3 · Approvals
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">
          To HQ
        </h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          The outbound lane of the approvals board: the four things this territory cannot decide for
          itself, and what HQ decided. The four local queues are the rest of S3 and are not here yet.
        </p>
      </header>

      <Card className="p-4">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">Raise one</h2>
        <form className="mt-3 space-y-3" onSubmit={submit} data-testid="branch-escalate-form">
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map(([value, label, blurb]) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-2 rounded-xl border p-2.5 text-left ${
                  kind === value
                    ? 'border-slate-700 bg-axal-ground dark:border-slate-300'
                    : 'border-axal-hairline'
                }`}
              >
                <input
                  type="radio"
                  name="escalation-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold">{label}</span>
                  <span className="mt-0.5 block text-[10.5px] text-axal-faint">{blurb}</span>
                </span>
              </label>
            ))}
          </div>
          <input
            className="w-full rounded-xl border border-axal-hairline bg-axal-ground p-2.5 text-[12.5px]"
            placeholder="What is this about?"
            value={subject}
            maxLength={300}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="branch-escalate-subject"
          />
          <textarea
            className="w-full rounded-xl border border-axal-hairline bg-axal-ground p-2.5 text-[12.5px]"
            rows={3}
            placeholder="Anything HQ needs in order to decide (optional)"
            value={detail}
            maxLength={4000}
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!subject.trim() || sending}
              className="rounded-xl bg-slate-700 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-slate-300 dark:text-slate-900"
            >
              {sending ? 'Raising…' : 'Raise to HQ'}
            </button>
            {/* SAID ON THE FORM, because it is the one thing about this screen
                that is different from every other branch write. */}
            <span className="text-[11px] text-axal-faint">
              This stays available while a licence is suspended — it is the appeal path.
            </span>
          </div>
          {sendError && (
            <p className="text-[12px] text-red-700 dark:text-red-300" data-testid="branch-escalate-error">
              {sendError}
            </p>
          )}
        </form>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">Raised from here</h2>
          {ready && <span className="text-[11.5px] text-axal-faint">as of {lane.as_of}</span>}
        </div>

        {lane === UNAVAILABLE && (
          <Unreadable
            what="The To-HQ lane"
            claim="This is not a claim that nothing was raised."
            onRetry={load}
          />
        )}
        {lane && lane !== UNAVAILABLE && !lane.available && (
          <p className="text-[12.5px] leading-relaxed text-axal-muted">
            <Unrecorded /> — {lane.reason}
          </p>
        )}
        {ready && items.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="branch-lane-empty">
            Nothing has been raised from this territory. The store exists and is empty, which is not
            the same as a lane that cannot be read.
          </p>
        )}

        {items.length > 0 && (
          <ul className="space-y-2" data-testid="branch-escalation-list">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-xl border border-axal-hairline bg-axal-ground p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold">{it.subject}</div>
                    <div className="mt-0.5 text-[10.5px] text-axal-faint">
                      {it.kind.replace('_', ' ')} · raised {it.created_at}
                      {it.sla && SLA_LABEL[it.sla] ? ` · ${SLA_LABEL[it.sla]}` : ''}
                    </div>
                  </div>
                  <span className={STATUS_PILL[it.status] || STATUS_PILL.open}>{it.status}</span>
                </div>

                {/* NOT DELIVERED IS ITS OWN STATE, with the reason, because the
                    branch holds this row and HQ does not — nothing may count
                    it as an escalation HQ has. */}
                {it.status === 'undelivered' && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-red-700 dark:text-red-300">
                    This has not reached HQ, so it is not on their queue. {it.delivery_error}
                  </p>
                )}

                {/* `bg-white dark:bg-slate-900`, not an `axal-` token: the
                    declared set is ground/hairline/ink/muted/faint and the
                    first draft invented `axal-surface`, which Tailwind v4
                    mints as nothing at all. The token guard caught it. */}
                {it.answer && (
                  <div className="mt-2 rounded-lg border border-axal-hairline bg-white p-2.5 dark:bg-slate-900">
                    <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      HQ&rsquo;s decision
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed">{it.answer}</p>
                    <p className="mt-1 text-[10.5px] text-axal-faint">
                      {it.answered_by_name || 'Axal VC HQ'} · {it.answered_at}
                      {it.pushed_at ? ` · received ${it.pushed_at}` : ''}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* THE SHAPE, STATED. A reader who expects a conversation should learn
            here that there is not one, rather than by looking for a reply box
            that does not exist. */}
        {ready && (
          <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="branch-answer-shape">
            {lane.answer_note}
          </p>
        )}
      </Card>

      <BranchZonePending
        artboard="S3 Approvals"
        title="The four local queues"
        will="LP applications, referrals, cohort applications and spinout moderation as one work board with SLA bands, assignment, a history drawer and an AI-drafted decision note that never records the decision. They exist today as four separate consoles under the Admin Console; the read model that makes them one board is what is missing."
        pr="PR 13"
      />
    </div>
  );
}
