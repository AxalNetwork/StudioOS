/**
 * D701 (#1663) — the founder's `/studio` below 1024px: boards S1m–S5m of
 * `Studio Mobile Page.dc.html` (SMP). Studio is Eadwyn (epic D-i).
 *
 * THE PAGE. The bar (SMP:17-18): Eadwyn's mark, "Eadwyn AI", the tab's label,
 * and the button that opens the Eadwyn menu (`EadwynMenu`, S5m). Under it the
 * chat, handed in as `children` by `FounderStudioHome`, which builds its one
 * `StudioInterview` element for either width. The chat draws the tab:
 * Conversations (the thread, the list below it, the composer pinned), Tasks or
 * My tickets. No zone, tile or header of D564's page is drawn here.
 *
 * TESTABLE ON ITS OWN. This file imports none of `PersonalAdvisor`,
 * `StudioInterview`, `FounderStudioHome` or `AdvisorProgressWidget`, which a
 * Node test cannot import.
 *
 * THE BAR STAYS. It is sticky at the top of the shell's scroll (`<main>`), above
 * the chat's own sticky composer (z-20 over z-10), so it stays put while the
 * thread, Tasks or My tickets scroll under it.
 *
 * THE GUTTER. The shell pads `/studio` (`p-4 md:p-6`); the page cancels it with
 * matching negative margins, as D699's More page does, and the bar and body use
 * the canvas's 22px.
 *
 * NO ADVISOR. Where `/api/advisor` does not exist the page says so in its own
 * words. `AdvisorUnavailable`'s "Your Studio records remain below." would be
 * untrue here, where nothing is below (D-s).
 *
 * THE CONVERSATIONS LIST (S1m) reads `GET /api/eadwyn/conversations/mine`.
 * The active profiling row is the thread above it, so it scrolls there; every
 * other row opens its transcript, read-only, in D699's `PhoneSheet`: user and
 * assistant messages only, no Send. A refusal (the advisor gate's 423) shows
 * the Worker's own words, never an empty transcript.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { eadwynApi } from '../../lib/api/eadwyn.js';
import { reportError } from '../../lib/log';
import { PhoneRows } from '../../ui/phone/PhoneRows.jsx';
import { PhoneSheet } from '../../ui/phone/PhoneSheet.jsx';
import { EadwynMenu } from './EadwynMenu';
import { STUDIO_TICKET_PATH, conversationRows } from './studioPhoneModel';

/** The bar's line under "Eadwyn AI" (SMP:184). */
export const TAB_LABEL = { conversation: 'Conversations', tasks: 'Tasks', tickets: 'My tickets' };
/** The drawer row each tab is, by its route in `EADWYN_MENU`. */
const TAB_ROUTE = { conversation: '/studio', tasks: '/studio?tab=tasks', tickets: '/studio?tab=tickets' };

export const NO_ADVISOR = 'The guided founder interview is not available in this environment.';
/** The thread's anchor: the active profiling row scrolls here. */
export const THREAD_ANCHOR = 'studio-thread';

const NOTE = 'px-[22px] py-2 text-[13px] text-[#615c6e] dark:text-gray-400';

/** The list as it renders from its read: pure, so each state is testable. */
export function ConversationsList({ read, now = new Date(), onOpen, onRetry }) {
  if (!read || read.status === 'loading') {
    return <p className={NOTE} data-testid="studio-conversations-loading">Reading your conversations…</p>;
  }
  if (read.status !== 'ready') {
    return (
      <p role="alert" className={NOTE} data-testid="studio-conversations-unreadable">
        Your conversations could not be read. This is not a sign that you have none.{' '}
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold text-violet-700 underline dark:text-violet-300">
            <RefreshCw size={11} aria-hidden="true" /> Try again
          </button>
        )}
      </p>
    );
  }
  const list = conversationRows(read.data, now);
  return (
    <div className="pt-[18px]" data-testid="studio-conversations">
      {list.rows.length > 0 && (
        <PhoneRows groups={[{
          label: 'Conversations',
          rows: list.rows.map((r) => ({ title: r.title, description: r.description, value: r.value, onClick: () => onOpen?.(r) })),
        }]} />
      )}
      {list.rows.length === 0 && (
        <h2 className="px-[22px] text-[10px] font-extrabold uppercase tracking-wide text-gray-700 dark:text-gray-300">Conversations</h2>
      )}
      {list.unreadable.map((line) => <p key={line} role="alert" className={NOTE}>{line}</p>)}
      {list.empty && <p className={NOTE}>No conversations yet.</p>}
    </div>
  );
}

/** A transcript's lines: the user's and Eadwyn's, nothing the tools or the system said. */
export const transcriptLines = (messages) => (Array.isArray(messages) ? messages : [])
  .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim());

/** The read a row opens: the rail's own read, or the advisor's. */
const readTranscript = (row) => (row.kind === 'profiling' ? api.advisor.conversation(row.id) : eadwynApi.conversation(row.id));

/** One conversation, read-only (decision 6). */
export function TranscriptSheet({ row, onClose, read = readTranscript }) {
  const [state, setState] = useState({ status: 'loading', lines: [], message: null });
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => read(row)).then(
      (data) => { if (live) setState({ status: 'ready', lines: transcriptLines(data?.messages), message: null }); },
      (e) => {
        reportError('StudioPhone:transcript', e);
        // The advisor gate's refusal is said in the Worker's words.
        if (live) setState({ status: 'refused', lines: [], message: (e?.status === 423 && e?.message) || 'This conversation could not be read.' });
      },
    );
    return () => { live = false; };
  }, [row, read]);
  return (
    <PhoneSheet title={row.title} onClose={onClose}>
      <div className="flex flex-col gap-2.5 pb-2" data-testid="studio-transcript">
        {state.status === 'loading' && <p className="text-[13px] text-[#615c6e] dark:text-gray-400">Reading the conversation…</p>}
        {state.status === 'refused' && <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">{state.message}</p>}
        {state.status === 'ready' && !state.lines.length && <p className="text-[13px] text-[#615c6e] dark:text-gray-400">This conversation has no messages.</p>}
        {state.lines.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
            <div className={`max-w-[84%] whitespace-pre-wrap px-3 py-2.5 text-[14px] leading-snug ${m.role === 'user'
              ? 'rounded-[14px_14px_4px_14px] bg-violet-700 text-white'
              : 'rounded-[14px_14px_14px_4px] bg-[#f4f3f7] text-gray-900 dark:bg-gray-800 dark:text-gray-100'}`}
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>
    </PhoneSheet>
  );
}

const readMine = () => eadwynApi.conversationsMine();

/** The Conversations list with its read, for the chat's `belowThread` slot. */
export function StudioConversations({ read = readMine }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(read).then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { reportError('StudioPhone:conversations', e); if (live) setState({ status: 'unreadable', data: null }); },
    );
    return () => { live = false; };
  }, [n, read]);
  const onOpen = useCallback((row) => {
    if (row.kind === 'profiling' && row.active) {
      document.getElementById?.(THREAD_ANCHOR)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return;
    }
    setOpen(row);
  }, []);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <ConversationsList read={state} onOpen={onOpen} onRetry={() => setN((x) => x + 1)} />
      {open && <TranscriptSheet row={open} onClose={close} />}
    </>
  );
}

export default function StudioPhone({ tab = 'conversation', ticketOpen = false, advisorAvailable = null, children }) {
  const [menu, setMenu] = useState(false);
  const opener = useRef(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  return (
    <div className="-m-4 min-h-full bg-white text-gray-900 md:-m-6 dark:bg-gray-950 dark:text-gray-100" data-testid="studio-phone">
      {/* Sticky at the scroll's top (the owner, 2026-10-21: it scrolled away with
          the page). The page is drawn below 1024px only, so this is phone-only;
          its own background keeps the content from showing through. */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2.5 border-b border-[#ececf1] bg-white px-[22px] pb-3 pt-3.5 dark:border-gray-800 dark:bg-gray-950" data-testid="studio-phone-bar">
        <div className="flex items-center gap-2.5">
          <img src="/eadwyn-ai.png" alt="Eadwyn" width="34" height="34" className="block h-[34px] w-[34px] shrink-0 object-contain [image-rendering:pixelated]" />
          <div>
            <h1 className="text-[19px] font-extrabold leading-tight tracking-[-.024em] text-gray-900 dark:text-gray-100">Eadwyn AI</h1>
            <div className="text-[12px] text-[#615c6e] dark:text-gray-400" data-testid="studio-phone-tab">{TAB_LABEL[tab] || TAB_LABEL.conversation}</div>
          </div>
        </div>
        <button
          ref={opener}
          type="button"
          onClick={() => setMenu(true)}
          aria-label="Open the Eadwyn menu"
          aria-haspopup="dialog"
          aria-expanded={menu ? 'true' : 'false'}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#ececf1] text-[#4a4553] dark:border-gray-700 dark:text-gray-300"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
      {advisorAvailable === false && (
        <p role="status" className="px-[22px] py-4 text-[13px] text-[#615c6e] dark:text-gray-400" data-testid="studio-phone-no-advisor">{NO_ADVISOR}</p>
      )}
      {children}
      <EadwynMenu open={menu} onClose={closeMenu} active={ticketOpen ? STUDIO_TICKET_PATH : TAB_ROUTE[tab] || TAB_ROUTE.conversation} opener={opener} />
    </div>
  );
}
