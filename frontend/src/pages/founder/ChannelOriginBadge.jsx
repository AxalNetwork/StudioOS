import React from 'react';
import { channelOrigin, originBadge } from './channelOrigin.js';
import BrandIcon from '../../ui/BrandIcon.jsx';
import { channelBadgeTitle } from './assistantSession.js';

/**
 * D684 (#1578) — the badge a session from a connected channel carries: "From
 * Telegram", "From WhatsApp", "From Zoom", "From Google Meet". Teal, so it is
 * never read as the AI-assistant badge (violet, AssistantEntry.jsx). Its
 * tooltip says how the words arrived: a connected account, or a call's transcript.
 */
export function ChannelOriginBadge({ session }) {
  const text = originBadge(session);
  if (!text) return null;
  // D687: the mark of the channel the server recorded (channelOrigin), never a name the client sent.
  return <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10.5px] font-bold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200" data-testid="channel-origin-badge" data-provider={session.submitted_via} title={channelBadgeTitle(session.submitted_via)}><BrandIcon provider={channelOrigin(session)} size={14} variant="bare" fallback="none" />{text}</span>;
}

export default ChannelOriginBadge;
