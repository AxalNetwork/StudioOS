import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { communityTasksApi } from '../../lib/api/communityTasks.js';
import { reportError } from '../../lib/log';
import { PILL, TONE, dayOf, priorityChip, reviewLine, typeChip } from '../../lib/ticketScreens';
import { bountyLine } from '../tickets/BountyBadge';
import ReviewBadge from '../tickets/ReviewBadge';
import {
  balanceLine, bountyRatesNote, panelTickets, suggestNote, suggestionLine, taskLine,
} from '../../lib/eadwynTickets';
import { dayText, storedDate } from '../../pages/founder/studioPhoneModel.js';

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
 *
 * D701 (#1663) — `variant="phone"` draws Tasks and My tickets as boards S2m
 * and S3m of `Studio Mobile Page.dc.html` (SMP:107-109): rows with a pill
 * under a small heading, and the foot "Suggest a task". The reads, and their
 * three states, are the same.
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
// D701 — the phone rows (SMP:61, :107-109)
// ---------------------------------------------------------------------------

const PHONE_LABEL = 'mb-1 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#7d7889] dark:text-gray-400';
const PHONE_ROW = 'flex min-h-[56px] items-center gap-3 border-b border-[#f0eff3] py-2.5 dark:border-gray-800';
const PHONE_NOTE = 'py-2.5 text-[13px] text-[#615c6e] dark:text-gray-400';

function PhoneGroup({ label, children, testId }) {
  return (
    <section className="pt-[18px]" data-testid={testId}>
      <h2 className={PHONE_LABEL}>{label}</h2>
      {children}
    </section>
  );
}

/** One row: title, a line under it, a pill, and a chevron when it opens something. */
function PhoneRow({ title, description, hint, pill, to, testId }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold leading-snug text-gray-900 dark:text-gray-100">{title}</span>
        {description && <span className="mt-0.5 block text-[12px] leading-snug text-[#615c6e] dark:text-gray-400">{description}</span>}
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-[#615c6e] dark:text-gray-400">{hint}</span>}
      </span>
      {pill && <Chip text={pill.text} tone={pill.tone} />}
      {to && <span aria-hidden="true" className="text-[16px] text-[#c9c6d2] dark:text-gray-600">›</span>}
    </>
  );
  return to
    ? <Link to={to} className={PHONE_ROW} data-testid={testId}>{body}</Link>
    : <div className={PHONE_ROW} data-testid={testId}>{body}</div>;
}

const dayOfStored = (at, now) => {
  const d = storedDate(at);
  return d ? dayText(d, now) : null;
};

/**
 * A suggestion as S2m's row (SMP:107): "Sent <date>" with Pending review,
 * "Approved <date>" with what its grant paid (`suggestionLine`'s words without
 * "Approved · ", so "+10 credits" only when it paid), and "Declined · <reason>".
 */
export function phoneSuggestion(s, now = new Date()) {
  const line = suggestionLine(s);
  if (!line) return null;
  if (s.status === 'pending') {
    const day = dayOfStored(s.created_at, now);
    return { description: day ? `Sent ${day}` : 'Sent', pill: { text: line.text, tone: 'grey' } };
  }
  if (s.status === 'approved') {
    const day = dayOfStored(s.decided_at, now);
    return { description: day ? `Approved ${day}` : 'Approved', pill: { text: line.text.replace(/^Approved · /, ''), tone: line.tone } };
  }
  return {
    description: line.reason ? `Declined · ${line.reason}` : 'Declined · No reason was recorded.',
    pill: { text: line.text, tone: line.tone },
  };
}

/**
 * A ticket as S3m's row (SMP:109): "<Type> · <date>", with D542's bounty
 * words or D604's review words. Not a bug and Duplicate carry D542's hint; the
 * reason and the original's number live only in the ticket's comments.
 */
export function phoneTicket(t, now = new Date()) {
  const type = typeChip(t?.type);
  const day = dayOfStored(t?.created_at, now);
  const bounty = bountyLine(t?.bounty);
  const review = bounty ? null : reviewLine(t?.review);
  return {
    description: [type?.text, day].filter(Boolean).join(' · '),
    pill: bounty ? { text: bounty.text, tone: BOUNTY_TONE[bounty.tone] } : review ? { text: review.text, tone: review.tone } : null,
    hint: bounty?.hint || null,
  };
}

function PhoneTasksView({ list, mine, next, tasks, onSuggest, onStart, onRetry, onOlder, now, suggestLine, assignHref }) {
  return (
    <div className="flex flex-col pb-2" data-testid="eadwyn-tasks-panel">
      <PhoneGroup label="Community tasks" testId="eadwyn-phone-community">
        {list.status === 'loading' && <p className={PHONE_NOTE}>Reading the task list…</p>}
        {list.status === 'unreadable' && (
          <PanelUnreadable testId="eadwyn-tasks-unreadable" text="The task list could not be read. This is not a sign there are none." onRetry={onRetry} />
        )}
        {list.status === 'ready' && !tasks.length && <p className={PHONE_NOTE} data-testid="eadwyn-tasks-empty">No tasks yet. Approved suggestions appear here.</p>}
        {tasks.map((t) => (
          <div key={t.id} className={PHONE_ROW} data-testid={`eadwyn-task-${t.id}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold leading-snug text-gray-900 dark:text-gray-100">{t.title}</span>
              {taskLine(t.body) && <span className="mt-0.5 block text-[12px] leading-snug text-[#615c6e] dark:text-gray-400">{taskLine(t.body)}</span>}
            </span>
            <button type="button" onClick={() => onStart(t)} className="min-h-[36px] text-[13px] font-semibold text-violet-700 dark:text-violet-300" data-testid="eadwyn-task-start">Start →</button>
          </div>
        ))}
      </PhoneGroup>
      {list.status === 'ready' && (
        <PhoneGroup label="My suggestions" testId="eadwyn-phone-suggestions">
          {!mine.length && <p className={PHONE_NOTE} data-testid="eadwyn-suggestions-empty">You have not suggested a task yet.</p>}
          {mine.map((s) => {
            const row = phoneSuggestion(s, now);
            return row && (
              <PhoneRow key={s.id} title={s.title} description={row.description} pill={row.pill}
                to={s.ticket_id ? `/help/tickets/${s.ticket_id}` : null} testId={`eadwyn-suggestion-${s.id}`} />
            );
          })}
          {next != null && (
            <button type="button" onClick={() => onOlder(next)} className="min-h-[36px] text-[13px] font-semibold text-violet-700 dark:text-violet-300" data-testid="eadwyn-suggestions-older">
              Show older suggestions
            </button>
          )}
        </PhoneGroup>
      )}
      <div className="mt-5 flex flex-col gap-3" data-testid="eadwyn-task-actions">
        <PanelAction phone label={SUGGEST_LABEL} onClick={onSuggest} note={suggestLine} testId="eadwyn-suggest-task" noteTestId="eadwyn-suggest-note" />
        {assignHref && <PanelAction phone label={ASSIGN_LABEL} to={assignHref} note={ASSIGN_NOTE} testId="eadwyn-assign-work" noteTestId="eadwyn-assign-note" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// D9284 (#9284) — the panel's three named actions
// ---------------------------------------------------------------------------

/*
 * Three different things, each with its own outcome and its own line saying
 * what happens next:
 *
 *   Suggest a community task  the ticket form on Type = Task, as before (D606):
 *                             a Help Center ticket that Axal reviews; only an
 *                             approved one joins Community tasks and pays its
 *                             reward. It never becomes project work.
 *   Assign project work       Work's assignment for the open company, the path
 *                             #8767 restores (`/account/companies/:uid/work`,
 *                             forwarded to Team › Tasks). That path is in open
 *                             PR #8968, not on main, so the button is HIDDEN
 *                             until ASSIGN_WORK_PATH_LIVE is flipped, never
 *                             drawn as a link that 404s.
 *   Open a support ticket     the Help Center's own ticket form, on no type.
 *                             Nothing from the conversation is copied in.
 */
export const SUGGEST_LABEL = 'Suggest a community task';
export const ASSIGN_LABEL = 'Assign project work';
export const TICKET_LABEL = 'Open a support ticket';
export const ASSIGN_NOTE = 'Opens Work on the company’s Team › Tasks, where the work gets an owner, a status and a next action.';
export const TICKET_NOTE = 'Opens the Help Center ticket form. Nothing from this conversation is copied into it.';
export const SUPPORT_TICKET_PATH = '/help/tickets?new=1';

/** Flip to true once #8767's `/account/companies/:uid/work` route is on main (PR #8968). */
export const ASSIGN_WORK_PATH_LIVE = false;

/**
 * Where "Assign project work" goes for `scope` ({ companyUid, projectId? }),
 * or null, and so no button, while the path is not live or there is no
 * company to assign in.
 */
export function assignWorkHref(scope, live = ASSIGN_WORK_PATH_LIVE) {
  if (!live || !scope?.companyUid) return null;
  const q = new URLSearchParams({ tab: 'tasks' });
  if (scope.projectId != null && scope.projectId !== '') q.set('project', String(scope.projectId));
  return `/account/companies/${encodeURIComponent(scope.companyUid)}/work?${q}`;
}

/** One named action: the button (or link), and one line under it saying what happens next. */
function PanelAction({ label, note, onClick, to, testId, noteTestId, phone = false }) {
  const cls = phone
    ? 'flex min-h-[52px] items-center justify-center rounded-[14px] border border-[#e6dcff] bg-[#f6f2ff] text-[15px] font-bold text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
    : 'w-fit rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-axal-violet-deep';
  const noteCls = phone
    ? 'text-[12px] leading-snug text-[#615c6e] dark:text-gray-400'
    : 'text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400';
  return (
    <div className="flex flex-col gap-1">
      {to
        ? <Link to={to} className={cls} data-testid={testId}>{label}</Link>
        : <button type="button" onClick={onClick} className={cls} data-testid={testId}>{label}</button>}
      <p className={noteCls} data-testid={noteTestId}>{note}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// T2 — Tasks
// ---------------------------------------------------------------------------

/** The Tasks panel as it renders from its reads: pure, so each state is testable. */
export function TasksPanelView({ list, rewards, older = [], olderNext = null, onSuggest, onStart, onRetry, onOlder, variant, now, assignHref = null }) {
  const tasks = list.status === 'ready' ? (list.data?.tasks || []) : [];
  const mine = list.status === 'ready' ? [...(list.data?.my_suggestions || []), ...older] : [];
  const next = older.length ? olderNext : (list.data?.my_suggestions_next ?? null);
  const suggestLine = suggestNote(rewards);
  if (variant === 'phone') {
    return <PhoneTasksView list={list} mine={mine} next={next} tasks={tasks} onSuggest={onSuggest} onStart={onStart} onRetry={onRetry} onOlder={onOlder} now={now || new Date()} suggestLine={suggestLine} assignHref={assignHref} />;
  }
  return (
    <div className="flex flex-col gap-3.5 px-4 py-3.5" data-testid="eadwyn-tasks-panel">
      <div className="flex flex-col gap-2.5" data-testid="eadwyn-task-actions">
        <PanelAction label={SUGGEST_LABEL} onClick={onSuggest} note={suggestLine} testId="eadwyn-suggest-task" noteTestId="eadwyn-suggest-note" />
        {assignHref && <PanelAction label={ASSIGN_LABEL} to={assignHref} note={ASSIGN_NOTE} testId="eadwyn-assign-work" noteTestId="eadwyn-assign-note" />}
      </div>
      <span className={SECTION}>Community tasks</span>

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
    </div>
  );
}

/** `workScope` ({ companyUid, projectId? }) is where Assign project work assigns; with none, or before #8767, it is hidden. */
export function TasksPanel({ onSuggest, onStart, variant, workScope = null }) {
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
      variant={variant}
      assignHref={assignWorkHref(workScope)}
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
export function TicketsPanelView({ tickets, balance, rewards, onRetry, variant, now }) {
  const bal = balanceLine(balance);
  const rows = tickets.status === 'ready' ? panelTickets(tickets.data) : [];
  const rates = bountyRatesNote(rewards);
  if (variant === 'phone') {
    const today = now || new Date();
    return (
      <div className="flex flex-col pb-2" data-testid="eadwyn-tickets-panel">
        <PhoneGroup label="Credit balance" testId="eadwyn-balance">
          <PhoneRow
            title={bal.text}
            description="US$1 each, spent on Perks"
            pill={{ text: 'Perks', tone: 'violet' }}
            to="/perks"
          />
        </PhoneGroup>
        <PhoneGroup label="My tickets" testId="eadwyn-phone-tickets">
          {tickets.status === 'loading' && <p className={PHONE_NOTE}>Reading your tickets…</p>}
          {tickets.status === 'unreadable' && (
            <PanelUnreadable testId="eadwyn-tickets-unreadable" text="Your tickets could not be read. This is not a sign that you have none." onRetry={onRetry} />
          )}
          {tickets.status === 'ready' && !rows.length && <p className={PHONE_NOTE} data-testid="eadwyn-tickets-empty">You have not opened a ticket.</p>}
          {rows.map((t) => {
            const row = phoneTicket(t, today);
            return <PhoneRow key={t.id} title={t.title} description={row.description} hint={row.hint} pill={row.pill} to={`/help/tickets/${t.id}`} testId={`eadwyn-ticket-${t.id}`} />;
          })}
          {tickets.status === 'ready' && rows.length > 0 && (
            <Link to="/help/tickets" className="flex min-h-[44px] items-center text-[13px] font-semibold text-violet-700 dark:text-violet-300" data-testid="eadwyn-all-tickets">All tickets →</Link>
          )}
        </PhoneGroup>
        <div className="mt-5">
          <PanelAction phone label={TICKET_LABEL} to={SUPPORT_TICKET_PATH} note={TICKET_NOTE} testId="eadwyn-open-ticket" noteTestId="eadwyn-open-ticket-note" />
        </div>
      </div>
    );
  }
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
      <PanelAction label={TICKET_LABEL} to={SUPPORT_TICKET_PATH} note={TICKET_NOTE} testId="eadwyn-open-ticket" noteTestId="eadwyn-open-ticket-note" />
      {rates && <p className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="eadwyn-bounty-rates">{rates}</p>}
    </div>
  );
}

export function TicketsPanel({ variant } = {}) {
  const [tickets, reload] = useRead(() => api.listTickets());
  const [balance] = useRead(() => api.perksMine());
  const [rewards] = useRead(() => communityTasksApi.rewards());
  return <TicketsPanelView tickets={tickets} balance={balance} rewards={rewards} onRetry={reload} variant={variant} />;
}
