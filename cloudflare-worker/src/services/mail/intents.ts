/**
 * D1341 (#3549, #3547 EM3) — what a draft is for, by relationship. ONE TABLE:
 * the Worker checks a draft's intent against it, and the composer (#3552)
 * imports this file to draw the intent chips, as `redirectRoutes.ts` is shared.
 * No imports and no side effects, so the SPA can read it.
 *
 * A relationship comes from the person's ref kind (`RELATIONSHIP_OF`); an
 * interviewee's recruiting row is its own interview's stage, so it has no kind. Each
 * intent has its chip's words and the instruction the prompt carries.
 */

export type Relationship = 'customer' | 'investor' | 'advisor' | 'cofounder' | 'network';

export interface Intent { key: string; label: string; instruction: string }

export const INTENTS: Readonly<Record<Relationship, readonly Intent[]>> = Object.freeze({
  customer: Object.freeze([
    { key: 'thank_follow_up', label: 'Thank and follow up', instruction: 'Thank them for their time and follow up on what they said.' },
    { key: 'second_interview', label: 'Ask for a second interview', instruction: 'Ask, politely and briefly, for a second conversation.' },
    { key: 'share_built', label: 'Share what we built from your feedback', instruction: 'Tell them what was built or changed because of their feedback.' },
  ]),
  investor: Object.freeze([
    { key: 'send_update', label: 'Send an update', instruction: 'Send a short investor update from the selected records.' },
    { key: 'ask_meeting', label: 'Ask for a meeting', instruction: 'Ask for a meeting, with one line on why now.' },
    { key: 'answer_dd', label: 'Answer due-diligence questions', instruction: 'Answer their due-diligence questions from the selected records only.' },
  ]),
  advisor: Object.freeze([
    { key: 'ask_advice', label: 'Ask for advice', instruction: 'Ask for their advice on one specific question.' },
    { key: 'book_session', label: 'Book a session', instruction: 'Ask to book the next session.' },
    { key: 'share_progress', label: 'Share progress', instruction: 'Share progress since the last session.' },
  ]),
  cofounder: Object.freeze([
    { key: 'weekly_sync', label: 'Weekly sync summary', instruction: 'Summarise the week for a co-founder: what moved, what is next.' },
  ]),
  network: Object.freeze([
    { key: 'introduce_myself', label: 'Introduce myself', instruction: 'Introduce the sender in a few sentences and suggest a short call.' },
  ]),
});

/** A person ref's kind (`kind:id`) and the relationship it is. */
export const RELATIONSHIP_OF: Readonly<Record<string, Relationship>> = Object.freeze({
  interviewee: 'customer',
  prospect: 'investor',
  cofounder: 'cofounder',
  advisor: 'advisor',
  partner: 'advisor',
  growth_partner: 'advisor',
  member: 'network',
});

export const TONES = Object.freeze(['warm', 'direct', 'formal'] as const);
export const LENGTHS = Object.freeze(['short', 'medium', 'long'] as const);

/** The intent of that key for that relationship, or null when it is not one of its chips. */
export function intentFor(relationship: Relationship, key: unknown): Intent | null {
  return INTENTS[relationship]?.find((i) => i.key === key) ?? null;
}
