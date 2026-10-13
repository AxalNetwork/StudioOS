/**
 * D668 (#1498) — interviews that arrive from an AI assistant (D665, #1495):
 * the "From an AI assistant" entry in Record a session, the badge a
 * submitted session carries, and the label on each proposed placement.
 *
 * AN ASSISTANT'S OUTPUT IS A PROPOSAL FROM THAT ASSISTANT, NEVER A FACT. Its
 * name is self-declared, so a label always carries the redirect host too.
 */
import { channelOrigin } from './channelOrigin.js';

/** The three steps the sheet shows. */
export const ASSISTANT_STEPS = [
  'Connect your assistant to StudioOS, once, from Connectors.',
  'Run the interview there, or paste its transcript, and ask it to send the interview to StudioOS.',
  'Review it here. Nothing enters a module until you accept it.',
];

/** Where the sheet sends the founder to connect one. */
export const ASSISTANTS_HREF = '/account/connectors#ai-assistants';

/** The consent line the sheet adds for an assistant interview (D665: the Worker checks consent). */
export const ASSISTANT_CONSENT = 'The interviewee’s consent must cover your AI assistant processing the interview, not only the recording.';

/**
 * A starter prompt the founder copies and pastes into their own assistant.
 * StudioOS never sends it anywhere. It names the company and nothing about
 * the interviewee.
 */
export function starterPrompt(companyName) {
  const company = String(companyName || '').trim() || 'my company';
  return [
    `Use the StudioOS connector for ${company}.`,
    `1. Read the Validate context for ${company} and the interview guide.`,
    '2. Help me run a customer interview from that guide, or structure the transcript I paste.',
    '3. When we are done, submit the interview to StudioOS with its transcript, and propose placements that quote the transcript word for word.',
    'Do not mark anything as accepted: I review every placement in StudioOS.',
  ].join('\n');
}

/** "ChatGPT (chatgpt.com)": an assistant's name with its host; either missing is said. */
export function assistantLabel(name, host) {
  const n = String(name || '').trim() || 'An assistant';
  const h = String(host || '').trim();
  return h ? `${n} (${h})` : `${n} (host not recorded)`;
}

/**
 * A placement's source label, from D667's review read: `source` is
 * `assistant` or `studioos`, and an assistant's placement carries the
 * session's `submitted_via_name`. The read holds no redirect host (that lives
 * on the grant, #1496), so a name without one says it is the assistant's own.
 * Nothing is unlabelled, and only `assistant` is credited to one.
 */
export function placementSource(p) {
  if (p?.source !== 'assistant') return 'Proposed by StudioOS';
  const name = String(p.submitted_via_name || '').trim();
  const host = String(p.submitted_via_host || '').trim();
  if (!name) return 'Proposed by an AI assistant (name not recorded)';
  return host ? `Proposed by ${assistantLabel(name, host)}` : `Proposed by ${name} (the name the assistant gave itself)`;
}

/** A run's column heading in the compare view: the assistant's name, or StudioOS's model. */
export function runLabel(run) {
  if (run?.source === 'assistant') return `${String(run.submitted_via_name || '').trim() || 'An AI assistant'} (assistant)`;
  return run?.model ? `StudioOS · ${run.model}` : 'StudioOS · model not recorded';
}

/**
 * The assistant badge's text for a session, or null for a session recorded
 * here. A session from a connected channel (D684) stores its provider's label
 * in the same column, but it is the member's own conversation, not an
 * assistant's: it has its own badge (channelOrigin.js).
 */
export function sessionBadge(session) {
  if (channelOrigin(session)) return null;
  const name = String(session?.submitted_via_name || '').trim();
  return name ? `From ${name}` : null;
}

/** The step a session opens on: one an assistant submitted opens on review. */
export function openingStep(session) {
  if (channelOrigin(session)) return null;
  if (session?.submitted_via_name) return 'review';
  return null;
}
