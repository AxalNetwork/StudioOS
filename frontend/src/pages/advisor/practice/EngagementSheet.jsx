import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../../ui';
import { api } from '../../../lib/api';
import { Field, Pill, SaveNote, Unrecorded, buttonClass, inputClass, money } from '../expertise/kit';
import {
  SHAPE_LABEL, SHEET_TABS, canDecideRenewal, deliverablesFor, endReasonLabel,
  longDay, priceLine, priorRecipients, sessionsFor, stateLine,
} from './engagementBoard';
import { historyLine } from './engagementCorrection';

/**
 * #4831 (D4831): one engagement, opened from its card (Practice v2 canvas,
 * PX-03b to PX-03d). Six tabs: Overview · Scope · Sessions · Delivery ·
 * Agreement · Activity.
 *
 * THE SHEET READS NOTHING THE BOARD ALREADY HOLDS. The engagement, the bookings
 * and the deliverables come from the page's own reads, so the card and its
 * sheet cannot disagree. Activity is the one read of its own: the
 * engagement's history (`GET /me/engagements/:id/events`).
 *
 * AN ENDED SIGNED ENGAGEMENT ALWAYS HAS AN OUTCOME. PX-03c draws a required
 * choice: Renewed, Did not renew, Ended for another reason. Since D5316 the
 * Worker refuses an ending without a reason, so the choice is offered on a
 * signed engagement, before it ends. A row that ended before the reason
 * existed reads "Not recorded". Nothing can record a reason after the fact,
 * and the sheet does not guess one.
 *
 * THE AGREEMENT TAB SAYS WHAT IS NOT LINKED. No stored record ties a signed
 * agreement to an engagement, so the tab says so and links to Contracts,
 * where the advisor's agreements still live. It never shows an agreement
 * matched by name.
 */
export default function EngagementSheet({
  e, bookings, deliverables, busy = false, note = null, onClose, onDecide, initialTab = 'Overview',
}) {
  const [tab, setTab] = useState(SHEET_TABS.includes(initialTab) ? initialTab : 'Overview');
  const [events, setEvents] = useState({ loading: true, items: null, error: '' });
  const id = useId();
  const tabRefs = useRef({});

  const loadEvents = useCallback(async () => {
    setEvents({ loading: true, items: null, error: '' });
    try {
      const res = await api.listMyAdvisorEngagementEvents(e.id);
      setEvents({ loading: false, items: Array.isArray(res?.items) ? res.items : [], error: '' });
    } catch (error) {
      setEvents({ loading: false, items: null, error: error?.message || 'The history could not be read.' });
    }
  }, [e.id]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Arrow keys move between tabs, as a tablist should.
  const onTabKey = (ev) => {
    const at = SHEET_TABS.indexOf(tab);
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const next = SHEET_TABS[(at + step + SHEET_TABS.length) % SHEET_TABS.length];
    setTab(next);
    tabRefs.current[next]?.focus?.();
  };

  const panelId = (t) => `${id}-panel-${t}`;
  const tabId = (t) => `${id}-tab-${t}`;

  return (
    <Sheet
      title={e.scope_label || SHAPE_LABEL[e.shape] || 'Engagement'}
      eyebrow={`Engagement · ${e.client_name || 'Client not named'}`}
      sub={<span className="flex flex-wrap items-center gap-2">
        <Pill tone={e.lane === 'renewal_due' ? 'warn' : 'neutral'}>{stateLine(e)}</Pill>
        <span className="text-axal-muted">{SHAPE_LABEL[e.shape] || e.shape} · {priceLine(e, money)}</span>
      </span>}
      onClose={onClose}
      width={560}
      testId={`engagement-sheet-${e.id}`}
    >
      {/* A refused write is said here, where it was made, not behind the sheet. */}
      <SaveNote note={note} testid="engagement-sheet-note" />
      <div role="tablist" aria-label="Sections" className="mb-3 flex flex-wrap gap-3 border-b border-axal-hairline dark:border-gray-700"
        data-testid="engagement-sheet-tabs" onKeyDown={onTabKey}>
        {SHEET_TABS.map((t) => (
          <button key={t} type="button" role="tab" id={tabId(t)} aria-selected={tab === t} aria-controls={panelId(t)}
            tabIndex={tab === t ? 0 : -1} ref={(el) => { tabRefs.current[t] = el; }}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-0.5 pb-2 text-[12.5px] font-semibold ${tab === t
              ? 'border-emerald-600 text-axal-ink dark:text-white'
              : 'border-transparent text-axal-faint hover:text-axal-ink dark:hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} data-testid={`engagement-tab-${tab.toLowerCase()}`}>
        {tab === 'Overview' && <Overview e={e} deliverables={deliverables} events={events} busy={busy} onDecide={onDecide} />}
        {tab === 'Scope' && <ScopeTab e={e} />}
        {tab === 'Sessions' && <SessionsTab e={e} bookings={bookings} />}
        {tab === 'Delivery' && <DeliveryTab e={e} deliverables={deliverables} />}
        {tab === 'Agreement' && <AgreementTab />}
        {tab === 'Activity' && <ActivityTab events={events} onRetry={loadEvents} />}
      </div>
    </Sheet>
  );
}

function KV({ rows }) {
  return (
    <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-axal-faint">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The latest recorded event, or why there is none to show. */
export function latestActivity(events) {
  if (events.loading) return 'Reading the history…';
  if (!events.items) return null;
  const last = events.items[events.items.length - 1];
  return last ? historyLine(last) : 'No history recorded';
}

/** The three outcomes PX-03c offers, and the renewal call each one makes. */
export const OUTCOMES = [
  { key: 'renewed', label: 'Renewed', body: { decision: 'renewed' } },
  { key: 'did_not_renew', label: 'Did not renew', body: { decision: 'ended', end_reason: 'did_not_renew' } },
  { key: 'other', label: 'Ended for another reason', body: { decision: 'ended', end_reason: 'other' } },
];

function Overview({ e, deliverables, events, busy, onDecide }) {
  const recipients = priorRecipients(e, deliverables);
  const latest = latestActivity(events);
  return (
    <div className="grid gap-4">
      {canDecideRenewal(e.lane) && <OutcomeForm e={e} busy={busy} onDecide={onDecide} />}
      <KV rows={[
        ['Client', <>{e.client_name || <Unrecorded>Client not named</Unrecorded>}{' '}
          <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            {e.founder_user_id ? 'Founder account linked' : 'Name only, no account linked'}
          </span></>],
        ['State', stateLine(e)],
        ['Started', longDay(e.started_at) || <Unrecorded>Not signed yet</Unrecorded>],
        ['Term ends', longDay(e.term_ends_at) || <Unrecorded>No term end recorded</Unrecorded>],
        ['Price', <span className="tabular-nums">{priceLine(e, money)}</span>],
        ['Cycles', Number(e.cycles || 0) === 0 ? 'No term run yet' : `${e.cycles} ${Number(e.cycles) === 1 ? 'term' : 'terms'}`],
        ...(e.outcome === 'ended' ? [['Why it ended', endReasonLabel(e) === 'Not recorded'
          ? <Unrecorded>Not recorded</Unrecorded> : endReasonLabel(e)]] : []),
        ['Latest activity', latest || <Unrecorded>Could not be read</Unrecorded>],
      ]} />
      {recipients == null
        ? <p className="text-[11.5px] text-axal-faint" data-testid="engagement-recipients-unread">
          Whether work was already sent under this engagement could not be read.
        </p>
        : recipients.length > 0 && (
          <div role="note" data-testid="engagement-client-change-warning"
            className="flex gap-2 rounded-[10px] border border-amber-200 bg-amber-50/70 p-3 text-[12px] dark:border-amber-900/60 dark:bg-amber-950/20">
            <span aria-hidden="true" className="font-extrabold text-amber-700">!</span>
            <div>
              <b>Changing the client</b>
              <div className="mt-0.5 text-axal-muted">
                This engagement has work previously sent to {recipients.join(', ')}. Changing the client does
                not transfer historical deliveries.
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

/**
 * PX-03c's outcome choice. One of three, then Record outcome. Renewed takes
 * the new term's end; either ending records its reason (D5316).
 */
function OutcomeForm({ e, busy, onDecide }) {
  const [choice, setChoice] = useState('');
  const [termEnds, setTermEnds] = useState('');
  const [note, setNote] = useState('');
  const picked = OUTCOMES.find((o) => o.key === choice);
  const name = useId();
  return (
    <section className="grid gap-2 rounded-[10px] border-[1.5px] border-amber-300 p-3 dark:border-amber-800" data-testid="engagement-outcome">
      <b className="text-[13px]">{e.lane === 'renewal_due' ? 'This term is up for a decision' : 'Record this term’s outcome'}</b>
      <p className="text-[12px] text-axal-muted">A signed engagement can’t end without an outcome. Either answer counts toward the renewal rate.</p>
      <div role="radiogroup" aria-label="Outcome" className="grid gap-1.5">
        {OUTCOMES.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name={name} value={o.key} checked={choice === o.key} onChange={() => setChoice(o.key)} />
            <span className="font-semibold">{o.label}</span>
          </label>
        ))}
      </div>
      {choice === 'renewed' && (
        <Field label="New term ends" hint="When the term you have just started runs out.">
          <input className={inputClass} type="date" value={termEnds} onChange={(ev) => setTermEnds(ev.target.value)} />
        </Field>
      )}
      {picked && (
        <Field label="Note" hint="What the renewal history shows.">
          <input className={inputClass} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </Field>
      )}
      <div>
        <button type="button" className={buttonClass} disabled={busy || !picked} data-testid="engagement-record-outcome"
          onClick={() => onDecide(e, {
            ...picked.body,
            note: note.trim() || null,
            term_ends_at: choice === 'renewed' ? (termEnds || null) : null,
          })}>
          Record outcome
        </button>
      </div>
    </section>
  );
}

function ScopeTab({ e }) {
  return (
    <div className="grid gap-3 text-[12.5px]">
      <KV rows={[
        ['Scope line', e.scope_label || <Unrecorded>No scope line recorded</Unrecorded>],
        ['In scope', e.scope_includes || <Unrecorded>No inclusions recorded</Unrecorded>],
        ['Not in scope', <span className="text-amber-700 dark:text-amber-300">{e.scope_excludes || <Unrecorded>No exclusion recorded</Unrecorded>}</span>],
        ['Shape', SHAPE_LABEL[e.shape] || e.shape],
        ['Price', priceLine(e, money)],
        ['Term ends', longDay(e.term_ends_at) || <Unrecorded>No term end recorded</Unrecorded>],
      ]} />
      <p className="text-[11.5px] text-axal-faint">
        Signed terms change only as a recorded correction: use Correct terms under Scope on file.
      </p>
    </div>
  );
}

function SessionsTab({ e, bookings }) {
  const rows = sessionsFor(e, bookings);
  if (!Array.isArray(bookings)) return <p className="text-[12.5px] text-amber-700 dark:text-amber-300">Your sessions could not be read. Close the sheet and reload to try again.</p>;
  if (!rows) return <p className="text-[12.5px] text-axal-muted">This client is a name with no linked account, so no booking can be joined to this engagement. Link the client account on the card to see their sessions.</p>;
  if (rows.length === 0) return <p className="text-[12.5px] text-axal-muted">{e.client_name} has no session with you on record.</p>;
  return (
    <ul className="grid gap-2" data-testid="engagement-sessions">
      {rows.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-axal-hairline p-2.5 text-[12.5px] dark:border-gray-700">
          <span>
            <b>{b.topic || 'Session'}</b>
            <span className="ml-2 text-axal-faint">{longDay(b.slot_starts_at) || 'Time not recorded'}</span>
          </span>
          <Pill tone="neutral">{b.status}</Pill>
        </li>
      ))}
      <li><Link to="/practice/sessions" className="text-[12px] font-semibold text-emerald-700 underline">Open Sessions</Link></li>
    </ul>
  );
}

function DeliveryTab({ e, deliverables }) {
  const rows = deliverablesFor(e, deliverables);
  if (!rows) return <p className="text-[12.5px] text-amber-700 dark:text-amber-300">Your deliverables could not be read. Close the sheet and reload to try again.</p>;
  if (rows.length === 0) return <p className="text-[12.5px] text-axal-muted">No work product is filed under this engagement.</p>;
  return (
    <ul className="grid gap-2" data-testid="engagement-deliverables">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-axal-hairline p-2.5 text-[12.5px] dark:border-gray-700">
          <b>{d.title}</b>
          <span className="text-axal-faint">{d.version_count ? `v${d.version_count}` : 'No version yet'}</span>
        </li>
      ))}
      <li><Link to="/practice/delivery" className="text-[12px] font-semibold text-emerald-700 underline">Open Delivery</Link></li>
    </ul>
  );
}

function AgreementTab() {
  return (
    <div className="grid gap-2 text-[12.5px]" data-testid="engagement-agreement">
      <b>No agreement is linked to this engagement</b>
      <p className="text-axal-muted">
        Nothing records which signed agreement governs an engagement yet, so none is shown here rather
        than one guessed from the client’s name.
      </p>
      <Link to="/advisor/advisory/contracts" className="font-semibold text-emerald-700 underline">Open Contracts</Link>
    </div>
  );
}

function ActivityTab({ events, onRetry }) {
  if (events.loading) return <p className="text-[12.5px] text-axal-muted">Reading the history…</p>;
  if (!events.items) {
    return (
      <p className="text-[12.5px] text-amber-700 dark:text-amber-300">
        The history could not be read.{' '}
        <button type="button" className="font-semibold underline" onClick={onRetry}>Try again</button>
      </p>
    );
  }
  if (events.items.length === 0) return <p className="text-[12.5px] text-axal-muted">No history recorded for this engagement.</p>;
  return (
    <ol className="grid gap-1.5" data-testid="engagement-activity">
      {events.items.map((ev) => <li key={ev.uid} className="text-[12px] leading-relaxed">{historyLine(ev)}</li>)}
    </ol>
  );
}

