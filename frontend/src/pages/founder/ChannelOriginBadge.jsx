import React from 'react';
import { originBadge } from './channelOrigin.js';

/**
 * D684 (#1578) — the badge a session from a connected channel carries: "From
 * Telegram", "From WhatsApp", "From Zoom", "From Google Meet". Teal, so it is
 * never read as the AI-assistant badge (violet, AssistantEntry.jsx).
 */
export function ChannelOriginBadge({ session }) {
  const text = originBadge(session);
  if (!text) return null;
  return <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10.5px] font-bold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200" data-testid="channel-origin-badge" data-provider={session.submitted_via}>{text}</span>;
}

export default ChannelOriginBadge;
