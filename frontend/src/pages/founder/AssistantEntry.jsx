import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ASSISTANTS_HREF, ASSISTANT_CONSENT, ASSISTANT_STEPS, channelBadgeTitle, channelOf, sessionBadge, sessionOrigin, starterPrompt,
} from './assistantSession.js';

/**
 * D668 (#1498) — Record a session's "From an AI assistant" (D665): three
 * steps, a link to Connectors' AI assistants group, and a starter prompt the
 * founder copies. Not mounted in the sheet until #1496 and #1497 are on
 * `main`: until then the link leads to a group that is not drawn.
 */
export function AssistantEntry({ companyName, copy = (t) => navigator.clipboard?.writeText(t) }) {
  const [copied, setCopied] = useState(false);
  const prompt = starterPrompt(companyName);
  return (
    <section className="border-b border-axal-hairline px-5 py-4 dark:border-gray-800" data-testid="assistant-entry">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-axal-faint">From an AI assistant</h3>
      <ol className="list-decimal space-y-1 pl-4 text-[12.5px] text-gray-700 dark:text-gray-300">
        {ASSISTANT_STEPS.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <p className="mt-2 text-[12px] font-semibold text-amber-800 dark:text-amber-300" data-testid="assistant-consent-note">{ASSISTANT_CONSENT}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link to={ASSISTANTS_HREF} className="rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-800" data-testid="link-assistants">Connect an assistant</Link>
        <button type="button" className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          onClick={async () => { try { await copy(prompt); setCopied(true); } catch { setCopied(false); } }} data-testid="button-copy-prompt">
          {copied ? 'Copied' : 'Copy a starter prompt'}
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] text-axal-faint">You paste it into your assistant. StudioOS never sends it anywhere.</p>
    </section>
  );
}

/**
 * The badge a session carries for where it came from: an assistant's (violet,
 * with its host), or, for D684's channels, the channel's own (`ChannelBadge`).
 */
export function AssistantBadge({ session }) {
  const origin = sessionOrigin(session);
  if (!origin) return null;
  if (origin.kind === 'channel') return <ChannelBadge session={session} />;
  return <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-bold text-violet-800 dark:bg-violet-950/40 dark:text-violet-200" data-testid="assistant-badge" title={session.submitted_via_host || 'host not recorded'}>{sessionBadge(session)}</span>;
}

/** D684: "From Telegram", "From Zoom"…: the member's own channel, never an assistant. */
export function ChannelBadge({ session }) {
  const provider = channelOf(session);
  if (!provider) return null;
  return <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10.5px] font-bold text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200" data-testid="channel-badge" data-provider={provider} title={channelBadgeTitle(provider)}>{sessionBadge(session)}</span>;
}

export default AssistantEntry;
