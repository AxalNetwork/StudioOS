import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { communityTasksApi } from '../../lib/api/communityTasks.js';
import { reportError } from '../../lib/log';
import { PILL, TONE, dayOf, priorityChip, typeChip } from '../../lib/ticketScreens';
import { bountyLine } from '../tickets/BountyBadge';
import ReviewBadge from '../tickets/ReviewBadge';
import {
  balanceLine, bountyRatesNote, panelTickets, suggestNote, suggestionLine, taskLine,
} from '../../lib/eadwynTickets';

/**
 * D606 (#1108) — the Eadwyn chat's panel, the Eadwyn Tickets canvas's T2 and
 * T3 (`design/canvases/integrated/Eadwyn Tickets Screen.dc.html`, screens
 * `chat-tasks` and `chat-tickets`).
 *
 *   Conversation  the chat itself on a phone; beside the chat, the rail it
 *                 always had (the interview's sections and queue)
 *   Tasks         the approved community tasks for the member's persona and
 *                 their own suggestions, with each one's state (D545)
 *   My tickets    the credit balance, and each ticket's bounty or review
 *
 * Each panel owns its reads, and a failed read says so: never "No tasks yet"
 * for a list that could not be read, never 0 for a balance that could not be.
 */

export const PANEL_TABS = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'tickets', label: 'My tickets' },
];

/** The canvas's tab strip above the panel. */
export function PanelTabs({ tab, onTab, className = '' }) {
  return (
    <div role="tablist" aria-label="Eadwyn panel" className={`flex gap-0.5 border-b border-gray-100 px-3 pt-2 dark:border-gray-800 ${className}`}>
      {PANEL_TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on ? 'true' : 'false'}
            onClick={() => onTab(t.id)}
            data-testid={`eadwyn-tab-${t.id}`}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${on
              ? 'border-axal-violet text-axal-violet-deep dark:text-violet-300'
              : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const SECTION = 'text-[11px] font-semibold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400';
const CARD = 'flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-800';

function Chip({ text, tone }) {
  return <span className={`${PILL} ${TONE[tone] || TONE.grey}`}>{text}</span>;
}

function PanelUnreadable({ text, onRetry, testId }) {
  return (
    <div role="alert" data-testid={testId} className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <b>Unreadable.</b> {text}{' '}
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline">
          <RefreshCw size={11} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  );
}

/** A read in its three states, re-runnable. */
function useRead(reader) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    Promise.resolve().then(reader).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('EadwynPanels:read', e); if (live) setRead({ status: 'unreadable', data: null }); },
    );
    return () => { live = false; };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [read, useCallback(() => setN((x) => x + 1), [])];
}

// ---------------------------------------------------------------------------
// T2 — Tasks
// ---------------------------------------------------------------------------

/** The Tasks panel as it renders from its reads: pure, so each state is testable. */
export function TasksPanelView({ list, rewards, older = [], olderNext = null, onSuggest, onStart, onRetry, onOlder }) {
  const tasks = list.status === 'ready' ? (list.data?.tasks || []) : [];
  const mine = list.status === 'ready' ? [...(list.data?.my_suggestions || []), ...older] : [];
  const next = older.length ? olderNext : (list.data?.my_suggestions_next ?? null);
  return (
    <div className="flex flex-col gap-3.5 px-4 py-3.5" data-testid="eadwyn-tasks-panel">
      <div className="flex items-center justify-between gap-2">
        <span className={SECTION}>Community tasks</span>
        <button type="button" onClick={onSuggest} className="rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-axal-violet-deep" data-testid="eadwyn-suggest-task">
          Suggest a task
        </button>
      </div>

      {list.status === 'loading' && <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Reading the task list…</p>}
      {list.status === 'unreadable' && (
        <PanelUnreadable testId="eadwyn-tasks-unreadable" text="The task list could not be read. This is not a sign there are none." onRetry={onRetry} />
      )}
      {list.status === 'ready' && !tasks.length && (
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="eadwyn-tasks-empty">No tasks yet. Approved suggestions appear here.</p>
      )}
      {tasks.map((t) => {
        const line = taskLine(t.body);
        return (
          <div key={t.id} className={CARD} data-testid={`eadwyn-task-${t.id}`}>
            <span className="text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{t.title}</span>
            {line && <span className="text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">{line}</span>}
            <button type="button" onClick={() => onStart(t)} className="w-fit text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="eadwyn-task-start">
              Start →
            </button>
          </div>
        );
      })}

      {list.status === 'ready' && (
        <>
          <span className={`${SECTION} mt-1`}>My suggestions</span>
          {!mine.length && <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="eadwyn-suggestions-empty">You have not suggested a task yet.</p>}
          {mine.map((s) => {
            const st = suggestionLine(s);
            return (
              <div key={s.id} className={CARD} data-testid={`eadwyn-suggestion-${s.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{s.title}</span>
                  {st && <Chip text={st.text} tone={st.tone} />}
                </div>
                {st?.reason && <span className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">{st.reason}</span>}
                {s.status === 'declined' && !st?.reason && (
                  <span className="text-[12.5px] text-axal-muted dark:text-gray-400">No reason was recorded.</span>
                )}
              </div>
            );
          })}
          {next != null && (
            <button type="button" onClick={() => onOlder(next)} className="w-fit text-[12px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="eadwyn-suggestions-older">
              Show older suggestions
            </button>
          )}
        </>
      )}

      <p className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="eadwyn-suggest-note">{suggestNote(rewards)}</p>
    </div>
  );
}

export function TasksPanel({ onSuggest, onStart }) {
  const [list, reload] = useRead(() => communityTasksApi.list());
  const [rewards] = useRead(() => communityTasksApi.rewards());
  const [older, setOlder] = useState({ rows: [], next: null });
  useEffect(() => { if (list.status === 'loading') setOlder({ rows: [], next: null }); }, [list.status]);
  const onOlder = (before) => {
    communityTasksApi.list(before).then(
      (data) => setOlder((o) => ({ rows: [...o.rows, ...(data?.my_suggestions || [])], next: data?.my_suggestions_next ?? null })),
      (e) => reportError('EadwynPanels:older', e),
    );
  };
  return (
    <TasksPanelView
      list={list}
      rewards={rewards}
      older={older.rows}
      olderNext={older.next}
      onSuggest={onSuggest}
      onStart={onStart}
      onRetry={reload}
      onOlder={onOlder}
    />
  );
}

// ---------------------------------------------------------------------------
// T3 — My tickets
// ---------------------------------------------------------------------------

// D542's bounty wording, in the canvas's palette (Under review grey,
// Confirmed violet, Fixed green, Not a bug and Duplicate grey).
const BOUNTY_TONE = { neutral: 'grey', info: 'violet', ok: 'green', warn: 'amber', muted: 'grey' };

/** The My tickets panel as it renders from its reads: pure, so each state is testable. */
export function TicketsPanelView({ tickets, balance, rewards, onRetry }) {
  const bal = balanceLine(balance);
  const rows = tickets.status === 'ready' ? panelTickets(tickets.data) : [];
  const rates = bountyRatesNote(rewards);
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5" data-testid="eadwyn-tickets-panel">
      <div className="flex items-center justify-between gap-2 rounded-[10px] border border-violet-200 bg-axal-lavender px-3 py-2.5 dark:border-violet-900 dark:bg-violet-950/40" data-testid="eadwyn-balance">
        <div className="flex flex-col">
          {bal.state === 'ready'
            ? <span className="font-mono text-[18px] font-medium text-axal-violet-deep dark:text-violet-300">{bal.text}</span>
            : <span className={`text-[12.5px] ${bal.state === 'unreadable' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`}>{bal.text}</span>}
          <span className="text-[11.5px] text-axal-muted dark:text-gray-400">US$1 each · spent on Perks</span>
        </div>
        <Link to="/perks" className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Perks →</Link>
      </div>

      {tickets.status === 'loading' && <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Reading your tickets…</p>}
      {tickets.status === 'unreadable' && (
        <PanelUnreadable testId="eadwyn-tickets-unreadable" text="Your tickets could not be read. This is not a sign that you have none." onRetry={onRetry} />
      )}
      {tickets.status === 'ready' && !rows.length && (
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="eadwyn-tickets-empty">You have not opened a ticket.</p>
      )}
      {rows.map((t) => {
        const type = typeChip(t.type);
        const prio = priorityChip(t.priority);
        const bounty = bountyLine(t.bounty);
        const updated = dayOf(t.updated_at || t.created_at);
        return (
          <div key={t.id} className={CARD} data-testid={`eadwyn-ticket-${t.id}`}>
            <div className="flex items-center justify-between gap-2">
              <Link to={`/help/tickets/${t.id}`} className="min-w-0 truncate text-[13.5px] font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{t.title}</Link>
              {type && <span className={type.className}>{type.text}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {prio && <span className={prio.className}>{prio.text}</span>}
              {bounty && <Chip text={bounty.text} tone={BOUNTY_TONE[bounty.tone]} />}
              <ReviewBadge review={t.review} />
            </div>
            {bounty?.hint && (
              <span className="text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
                {bounty.hint}{' '}
                <Link to={`/help/tickets/${t.id}`} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Open the ticket →</Link>
              </span>
            )}
            <span className="font-mono text-[11px] text-axal-faint dark:text-gray-500">#{t.id}{updated ? ` · updated ${updated}` : ''}</span>
          </div>
        );
      })}
      {tickets.status === 'ready' && rows.length > 0 && (
        <Link to="/help/tickets" className="w-fit text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="eadwyn-all-tickets">
          All tickets →
        </Link>
      )}
      {rates && <p className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="eadwyn-bounty-rates">{rates}</p>}
    </div>
  );
}

export function TicketsPanel() {
  const [tickets, reload] = useRead(() => api.listTickets());
  const [balance] = useRead(() => api.perksMine());
  const [rewards] = useRead(() => communityTasksApi.rewards());
  return <TicketsPanelView tickets={tickets} balance={balance} rewards={rewards} onRetry={reload} />;
}
