/**
 * D668 (#1498) — interviews that arrive from an AI assistant (D665, #1495):
 * the "From an AI assistant" entry in Record a session, the badge a
 * submitted session carries, and the label on each proposed placement.
 *
 * AN ASSISTANT'S OUTPUT IS A PROPOSAL FROM THAT ASSISTANT, NEVER A FACT. Its
 * name is self-declared, so a label always carries the redirect host too.
 */

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
 * D684 (#1578) — a session can also arrive through one of the member's own
 * channels. The intake (`services/interviewIntake.ts`) sets `submitted_via` to
 * the provider key and `submitted_via_name` to its label; an assistant's
 * `submitted_via` is its OAuth client id, a random hex string, so the key alone
 * tells the two apart. A channel session is the member's own conversation,
 * not an assistant's proposal: it gets its own badge, never the assistant's.
 */
export const CHANNEL_SOURCES = { telegram: 'Telegram', whatsapp: 'WhatsApp', zoom: 'Zoom', google_meet: 'Google Meet' };
const MEETING_SOURCES = new Set(['zoom', 'google_meet']);

/** The channel a session came through, or null for one recorded here or sent by an assistant. */
export function channelOf(session) {
  const key = String(session?.submitted_via || '').trim();
  return Object.hasOwn(CHANNEL_SOURCES, key) ? key : null;
}

/** Where a session came from: `{ kind: 'channel', provider, text }`, `{ kind: 'assistant', text }`, or null. */
export function sessionOrigin(session) {
  const channel = channelOf(session);
  if (channel) return { kind: 'channel', provider: channel, text: `From ${CHANNEL_SOURCES[channel]}` };
  const name = String(session?.submitted_via_name || '').trim();
  return name ? { kind: 'assistant', text: `From ${name}` } : null;
}

/** The badge's text for a session from a channel or an assistant, or null for a session recorded here. */
export function sessionBadge(session) {
  return sessionOrigin(session)?.text || null;
}

/** The channel badge's tooltip: how the words reached the session. */
export function channelBadgeTitle(provider) {
  const name = CHANNEL_SOURCES[provider] || 'a channel';
  return MEETING_SOURCES.has(provider)
    ? `Imported from the ${name} call’s transcript`
    : `Arrived from your connected ${name} account`;
}

/**
 * The step a session opens on.
 *   'review'      — an assistant's session: its placements are the point.
 *   'channel'     — a channel session with nothing in it yet (still `draft`):
 *                   the page shows what it waits for, never the recorder.
 *   'transcript'  — a channel session with its conversation or call
 *                   transcript in: the words first, then Structure below them.
 *   null          — a session recorded here.
 */
export function openingStep(session) {
  if (channelOf(session)) return session?.status === 'draft' ? 'channel' : 'transcript';
  if (session?.submitted_via_name) return 'review';
  return null;
}
