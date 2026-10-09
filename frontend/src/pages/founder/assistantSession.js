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
 * A placement's source label. A placement from an assistant names it and its
 * host; one from StudioOS's own structuring (D658) says so. Nothing is
 * unlabelled.
 */
export function placementSource(p) {
  if (p?.proposed_by === 'studioos' || (!p?.submitted_via_name && !p?.proposed_by_name)) return 'Proposed by StudioOS';
  return `Proposed by ${assistantLabel(p.proposed_by_name || p.submitted_via_name, p.proposed_by_host || p.submitted_via_host)}`;
}

/** The assistant badge's text for a session, or null for a session recorded here. */
export function sessionBadge(session) {
  const name = String(session?.submitted_via_name || '').trim();
  return name ? `From ${name}` : null;
}

/** The step a session opens on: one an assistant submitted opens on review. */
export function openingStep(session) {
  if (session?.submitted_via_name) return 'review';
  return null;
}
