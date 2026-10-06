import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { api } from '../../../lib/api';
import { titleCase } from '../../../lib/absence';
import { Card, EmptyState, Pill, SectionLabel, Skeleton, Unreadable, Unrecorded, WorkerRail } from '../../../ui';
import WorkspaceShell from '../../../workspaces/WorkspaceShell';
import { Field, StatedLimit, inputClass } from '../kit';
import { INTERACTION_KINDS, RELATIONSHIP_TYPES, dayOf, interactionBody, timeline } from '../../../lib/partnerEarnings';
import { Panel, WriteNote, primaryButton } from './parts';

/**
 * Partner · Relationship log — `/partner/relationships/:id` (canvas `pe-log`,
 * D569).
 *
 * ONE RELATIONSHIP, TWO LOGS, ONE TIMELINE. `GET /partnernet/relationships/
 * :id/events` is what happened to the relationship itself (asked, accepted,
 * changed, ended); `GET …/interactions` is what its parties logged doing
 * (calls, emails, meetings). Both are read, each with its own states, and
 * merged newest first.
 *
 * "LOG AN INTERACTION" WRITES TO THE INTERACTION LOG, not to `logActivity`.
 * `POST /partnernet/activity/log` takes a closed list of product actions
 * (`deal_review`, `login`, …) and writes nothing about a relationship — and
 * D553 found its insert records nothing at all. `POST …/interactions` is the
 * route that logs a touch on this relationship, and the one the investor book
 * already uses.
 *
 * THE HEADER IS READ FROM THE BOOK. There is no single-relationship route, so
 * the name, role and type come from `GET /partnernet/relationships` — the
 * caller's own accepted relationships — and a relationship not in it says so
 * rather than borrowing a name from anywhere else.
 */

/** A refusal the route meant, told apart from a read that failed. */
function readFailure(e) {
  const status = Number(e?.status);
  if ([403, 404, 409].includes(status)) return { status: 'refused', code: status, message: e?.message || '' };
  return { status: 'unreadable', message: e?.message || '' };
}

const REFUSALS = {
  403: 'This relationship is not one you are a party to.',
  404: 'No relationship with this number exists.',
  409: 'This relationship has not been accepted, or it has ended, so its log is closed.',
};

/** Who the relationship is with, what kind it is, and since when. */
export function RelationshipHeader({ state, rel }) {
  if (state === 'loading') return <Skeleton.Card />;
  if (state === 'unreadable') {
    return <Card padding="md"><Unreadable what="Your relationships" claim="This is not a claim that this one is not yours." /></Card>;
  }
  if (!rel) {
    return (
      <Card padding="md" data-testid="relationship-not-in-book">
        <p className="text-[12.5px] leading-relaxed text-axal-muted">
          This relationship is not among your accepted relationships, so who it is with is not shown here.
          Its log below is whatever the routes let you read.
        </p>
      </Card>
    );
  }
  const other = rel.other || {};
  const since = dayOf(rel.responded_at) || dayOf(rel.created_at);
  const last = dayOf(rel.last_interaction_at);
  const type = RELATIONSHIP_TYPES[rel.relationship_type] || titleCase(rel.relationship_type);
  return (
    <Card padding="md" data-testid="relationship-header">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100" data-testid="text-relationship-name">
          {String(other.name ?? '').trim() || String(other.email ?? '').trim() || <Unrecorded>Name not recorded</Unrecorded>}
        </span>
        {type ? <Pill tone="neutral">{type}</Pill> : null}
      </div>
      <dl className="mt-2.5 grid gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
        <div><dt><SectionLabel tone="faint">Role</SectionLabel></dt><dd className="mt-0.5">{titleCase(other.role) || <Unrecorded>Not recorded</Unrecorded>}</dd></div>
        <div><dt><SectionLabel tone="faint">Company</SectionLabel></dt><dd className="mt-0.5"><Unrecorded reason="A relationship stores no company.">Not recorded</Unrecorded></dd></div>
        <div><dt><SectionLabel tone="faint">In your book since</SectionLabel></dt><dd className="mt-0.5 tabular-nums">{since || <Unrecorded>Not recorded</Unrecorded>}</dd></div>
        <div><dt><SectionLabel tone="faint">Last interaction</SectionLabel></dt><dd className="mt-0.5 tabular-nums">{last || <Unrecorded reason="Nothing has been logged on this relationship.">None logged</Unrecorded>}</dd></div>
      </dl>
    </Card>
  );
}

/**
 * The merged timeline. `events` and `interactions` are each `{ status, data }`
 * so one log failing leaves the other on screen, with the failure said where
 * its entries would have been.
 */
export function RelationshipTimeline({ events, interactions, onRetry, onLog }) {
  if (events.status === 'loading' && interactions.status === 'loading') {
    return <Panel title="Timeline" testid="panel-timeline"><div className="p-4"><Skeleton.Text lines={4} /></div></Panel>;
  }
  const evRows = events.status === 'ready' && Array.isArray(events.data) ? events.data : [];
  const inRows = interactions.status === 'ready' && Array.isArray(interactions.data) ? interactions.data : [];
  const entries = timeline(evRows, inRows);
  const live = entries.filter((e) => !e.voided).length;
  const voided = entries.length - live;
  const failures = [
    ['events', 'The relationship’s history', events],
    ['interactions', 'The interaction log', interactions],
  ].filter(([, , s]) => s.status === 'unreadable' || s.status === 'refused');
  const bothRead = events.status === 'ready' && interactions.status === 'ready';
  return (
    <Panel
      title="Timeline"
      meta={entries.length ? `${live} entr${live === 1 ? 'y' : 'ies'}${voided ? `, ${voided} voided` : ''}, newest first` : null}
      testid="panel-timeline"
    >
      <div className="space-y-2 px-4 py-3">
        {failures.map(([key, what, s]) => (
          s.status === 'refused'
            ? <p key={key} role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={`refused-${key}`}>{REFUSALS[s.code] || s.message}</p>
            : <div key={key} data-testid={`unreadable-${key}`}><Unreadable what={what} claim="This is not a claim that it is empty." onRetry={onRetry} /></div>
        ))}
        {(events.status === 'loading' || interactions.status === 'loading') ? <Skeleton.Text lines={2} /> : null}
        {bothRead && !entries.length ? (
          <EmptyState
            size="sm"
            icon={MessagesSquare}
            title="Nothing logged yet"
            body="No interaction has been logged on this relationship, and no change to it was recorded."
            cta={onLog ? { label: 'Log an interaction', onClick: onLog } : undefined}
            data-testid="empty-timeline"
          />
        ) : null}
        {entries.length ? (
          <ol className="relative space-y-4 border-l border-axal-hairline pl-4 dark:border-gray-700" data-testid="list-timeline">
            {entries.map((e) => (
              <li key={e.key} className="relative" data-testid={`entry-${e.key}`}>
                <span aria-hidden="true" className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${e.kind === 'interaction' ? 'bg-amber-600' : 'bg-axal-faint'}`} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone={e.kind === 'interaction' ? 'warn' : 'neutral'}>{e.kind === 'interaction' ? 'Interaction' : 'Event'}</Pill>
                    <span className={`text-[13.5px] font-semibold text-axal-ink dark:text-gray-100 ${e.voided ? 'line-through decoration-axal-faint' : ''}`}>{e.title}</span>
                    {e.voided ? (
                      <span className="flex items-center gap-1.5" data-testid={`voided-${e.key}`}>
                        <Pill tone="neutral">Voided</Pill>
                        <span className="text-[11.5px] tabular-nums text-axal-faint">
                          {dayOf(e.voidedAt) ? `on ${dayOf(e.voidedAt)}` : <Unrecorded>on a day not recorded</Unrecorded>} · retracted by whoever logged it
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11.5px] tabular-nums text-axal-faint">{dayOf(e.at) || <Unrecorded>Date not recorded</Unrecorded>}</span>
                </div>
                {e.detail
                  ? <p className={`mt-1 whitespace-pre-line text-[13px] leading-relaxed text-axal-muted dark:text-gray-400 ${e.voided ? 'line-through' : ''}`}>{e.detail}</p>
                  : (e.kind === 'interaction' ? <p className="mt-1"><Unrecorded reason="Logged with a date and no note.">No note</Unrecorded></p> : null)}
                {e.by ? <p className="mt-0.5 text-[11px] text-axal-faint">Logged by {e.by}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Log an interaction, stateless: the page owns the draft. The route needs a
 * note or a date — "an empty touch must not move the cold flag" — and the form
 * refuses the same empty touch before sending it.
 */
export function LogInteractionForm({ draft, busy, result, closed, onDraft, onSubmit, formRef }) {
  return (
    <div ref={formRef}>
      <Panel title="Log an interaction" testid="panel-log-interaction">
        <form
          className="space-y-3 px-4 py-3.5"
          onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
          data-testid="form-log-interaction"
        >
          {closed ? (
            <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="text-log-closed">{closed}</p>
          ) : (
            <>
              <Field label="Type">
                <select className={inputClass} value={draft.kind} onChange={(e) => onDraft?.({ kind: e.target.value })} data-testid="select-interaction-kind">
                  {INTERACTION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="When" hint="Leave empty for now.">
                  <input className={inputClass} type="date" value={draft.date} onChange={(e) => onDraft?.({ date: e.target.value })} data-testid="input-interaction-date" />
                </Field>
                <Field label="Time" hint="Optional.">
                  <input className={inputClass} type="time" value={draft.time} onChange={(e) => onDraft?.({ time: e.target.value })} data-testid="input-interaction-time" />
                </Field>
              </div>
              <Field label="Summary" hint="One or two lines. The log keeps what you write here and the type, date and time; it has no outcome field.">
                <textarea className={inputClass} rows={3} maxLength={2000} value={draft.note}
                  onChange={(e) => onDraft?.({ note: e.target.value })} data-testid="input-interaction-note" />
              </Field>
              <div className="flex justify-end">
                <button type="submit" className={primaryButton('partner')} disabled={busy} data-testid="button-log-interaction">
                  {busy ? 'Logging…' : 'Log'}
                </button>
              </div>
            </>
          )}
          <WriteNote note={result} testid="note-log-interaction" />
        </form>
      </Panel>
    </div>
  );
}

const EMPTY_DRAFT = { kind: 'call', date: '', time: '', note: '' };

export default function PartnerRelationshipLog() {
  const { id } = useParams();
  const [book, setBook] = useState({ status: 'loading', data: null });
  const [events, setEvents] = useState({ status: 'loading', data: null });
  const [interactions, setInteractions] = useState({ status: 'loading', data: null });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const formRef = useRef(null);

  const loadBook = useCallback(() => {
    setBook({ status: 'loading', data: null });
    api.partnerRelationships()
      .then((d) => setBook({ status: 'ready', data: Array.isArray(d) ? d : [] }))
      .catch(() => setBook({ status: 'unreadable', data: null }));
  }, []);
  const loadEvents = useCallback(() => {
    setEvents({ status: 'loading', data: null });
    api.relationshipEvents(id)
      .then((d) => setEvents({ status: 'ready', data: Array.isArray(d) ? d : [] }))
      .catch((e) => setEvents({ ...readFailure(e), data: null }));
  }, [id]);
  const loadInteractions = useCallback(() => {
    setInteractions({ status: 'loading', data: null });
    api.partnerInteractionLog(id)
      .then((d) => setInteractions({ status: 'ready', data: Array.isArray(d?.items) ? d.items : [] }))
      .catch((e) => setInteractions({ ...readFailure(e), data: null }));
  }, [id]);
  useEffect(() => { loadBook(); loadEvents(); loadInteractions(); }, [loadBook, loadEvents, loadInteractions]);

  const rel = useMemo(
    () => (book.status === 'ready' ? book.data.find((r) => String(r?.id) === String(id)) || null : null),
    [book, id],
  );
  const name = String(rel?.other?.name ?? '').trim() || String(rel?.other?.email ?? '').trim();
  const closed = interactions.status === 'refused' ? REFUSALS[interactions.code] || interactions.message : null;

  const submit = async () => {
    const body = interactionBody(draft);
    if (!body.note && !body.interacted_at) {
      setResult({ ok: false, text: 'Say what happened or set when it happened: an empty entry is not logged.' });
      return;
    }
    setBusy(true); setResult(null);
    try {
      await api.partnerInteractionAdd(id, body);
      setResult({ ok: true, text: 'Logged.' });
      setDraft(EMPTY_DRAFT);
      loadInteractions(); loadBook();
    } catch (e) {
      setResult({ ok: false, text: e?.message || 'The interaction was not logged.' });
    } finally { setBusy(false); }
  };

  const evCount = events.status === 'ready' ? events.data.length : null;
  // A voided touch is not a logged interaction any more, so the rail does not count it.
  const inCount = interactions.status === 'ready' ? interactions.data.filter((r) => !r?.voided_at).length : null;
  const coverage = [
    evCount === null ? null : `${evCount} recorded change${evCount === 1 ? '' : 's'} to the relationship`,
    inCount === null ? null : `${inCount} logged interaction${inCount === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <WorkspaceShell
      role="partner"
      title={name || 'Relationship log'}
      intro="Every interaction logged on this relationship and every recorded change to it, newest first."
      rail={(
        <WorkerRail
          workspace="Relationship log"
          role="partner"
          stance="Stored records only"
          note="This rail reports what the page read. It drafts no message and logs nothing: an interaction is logged only by your click."
          coverage={coverage}
          coverageNote={coverage.length ? undefined : 'Nothing has been read yet, so there is nothing to report.'}
          unavailable={[
            ['Next step', 'Eadwyn drafts no next message here yet: no draft surface reads this log.'],
            ['Outcome', 'An interaction is stored with a type, a date and a note, and no outcome.'],
          ]}
        />
      )}
    >
      <Link to="/network/relationships" className="mb-3 inline-block text-[12.5px] font-semibold text-amber-700 hover:underline dark:text-amber-300" data-testid="link-back-relationships">
        ‹ Relationships
      </Link>
      <div className="space-y-3">
        <RelationshipHeader state={book.status} rel={rel} />
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <RelationshipTimeline
            events={events}
            interactions={interactions}
            onRetry={() => { loadEvents(); loadInteractions(); }}
            onLog={closed ? undefined : () => formRef.current?.querySelector('select')?.focus()}
          />
          <LogInteractionForm
            formRef={formRef}
            draft={draft}
            busy={busy}
            result={result}
            closed={closed}
            onDraft={(patch) => { setResult(null); setDraft((d) => ({ ...d, ...patch })); }}
            onSubmit={submit}
          />
        </div>
        <StatedLimit title="What this page does not claim">
          <p><strong>Only this relationship’s own records.</strong> A commission or an introduction is not linked to a relationship, so neither appears on this timeline.</p>
          <p className="mt-2"><strong>No outcome.</strong> The interaction log keeps a type, a date and a note; there is nowhere to record how it went apart from the note.</p>
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
