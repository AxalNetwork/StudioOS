/**
 * Eadwyn on a Studio home: the full chat while the interview is open, and one
 * collapsed row once it is complete (D324). All five homes mount this rather
 * than PersonalAdvisor directly, so the collapse is the same everywhere.
 *
 * Reads: /advisor/progress decides complete; /advisor/queue gives the row its
 * top three open proposals. A progress read that fails, or that does not say
 * complete, leaves the full chat up: the row claims a finished interview, so
 * it needs the server to have said so.
 *
 * The wrapper carries the page's one `#studio-chat` anchor. The admin
 * posture's "Continue in the chat" links and the assessment band's "Begin with
 * the chat" both point at it.
 *
 * D701 (#1663) — the founder's Studio passes `tab`, `onTab`, `ticket`,
 * `onTicketOpen` and `onTicketClose`, which carry Eadwyn's panel tab in
 * `?tab=` and the ticket form at `/studio/tickets/new`. The collapsed row
 * stands for the conversation, so it is drawn only on Conversation with no
 * ticket form open; Tasks, My tickets and the form are the chat's. The other
 * four homes pass none of them and keep the row as it was.
 */
import React, { useCallback, useEffect, useState } from 'react';
import PersonalAdvisor from './PersonalAdvisor';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { pageLabel, predictTarget } from '../../lib/advisor/router';
import { InterviewCompleteRow, STUDIO_CHAT_ANCHOR, interviewSummary, topProposals } from './interviewCompleteRow';

export default function StudioInterview({ persona, disablePersistedFullscreen = false, onAvailabilityChange, tab, onTab, ticket, onTicketOpen, onTicketClose }) {
  const [summary, setSummary] = useState(null);
  const [proposals, setProposals] = useState({ state: 'loading', items: [] });
  // null = the chat is collapsed if complete; 'chat' or 'ticket' = reopened.
  const [reopened, setReopened] = useState(null);

  const readProposals = useCallback(() => {
    setProposals({ state: 'loading', items: [] });
    api.advisor.queue()
      .then((payload) => {
        const items = topProposals(payload, { predictTarget, pageLabel });
        setProposals(items ? { state: 'ready', items } : { state: 'unreadable', items: [] });
      })
      .catch((e) => {
        reportError('StudioInterview:queue', e);
        setProposals({ state: 'unreadable', items: [] });
      });
  }, []);

  useEffect(() => {
    let alive = true;
    api.advisor.progress()
      .then((p) => { if (alive) setSummary(interviewSummary(p)); })
      .catch((e) => { reportError('StudioInterview:progress', e); });
    return () => { alive = false; };
  }, []);

  const collapsed = summary?.complete === true && !reopened;
  useEffect(() => { if (collapsed) readProposals(); }, [collapsed, readProposals]);
  const rowShown = collapsed && (tab === undefined || tab === 'conversation') && !ticket;
  // The founder's row opens the ticket route and reopens the chat under it,
  // so the "has been filed" message stays in view once the form closes.
  const openTicketRoute = () => { setReopened('chat'); onTicketOpen(); };

  return (
    <div id={STUDIO_CHAT_ANCHOR} data-testid="studio-interview">
      {rowShown ? (
        <InterviewCompleteRow
          persona={persona}
          summary={summary}
          proposals={proposals}
          onResume={() => setReopened('chat')}
          onOpenTicket={onTicketOpen ? openTicketRoute : () => setReopened('ticket')}
          onRetryProposals={readProposals}
        />
      ) : (
        <PersonalAdvisor
          disablePersistedFullscreen={disablePersistedFullscreen}
          onAvailabilityChange={onAvailabilityChange}
          initialTicketOpen={reopened === 'ticket'}
          tab={tab}
          onTab={onTab}
          ticket={ticket}
          onTicketOpen={onTicketOpen}
          onTicketClose={onTicketClose}
        />
      )}
    </div>
  );
}
