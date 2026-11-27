/**
 * D913 (#2697, NAR10) — "Answer it" (`draft:narrative-objection`): Eadwyn
 * drafts the words of one section of one version so that they answer one
 * objection investors raised (`objections.ts`). As D1114's section draft:
 * every figure in what it reads is masked (the section's words by
 * `sectionMaterial`, the objection and the founder's answer here), a sentence
 * of the answer that holds a digit is dropped (`screenSection`), and nothing
 * is written. The founder accepts the words into the section, and Save
 * version saves them with Eadwyn as the source.
 */
import { maskFigures, type SectionMaterial } from './sectionDraft';
import type { Objection } from './objections';

/** A hyphen, not a slash: a slash in a founder draft key is a research ZoneDraft surface (D911 §4). */
export const OBJECTION_OPTION = 'draft:narrative-objection';

export const OBJECTION_SYSTEM = 'You are Eadwyn, a writing assistant for a founder\'s investor narrative. You write plain, specific words and never a number. You give no advice. Always return valid JSON.';

/** The prompt: the section's material (masked by `sectionMaterial`) and the objection, masked here. */
export function objectionPrompt(m: SectionMaterial, o: Pick<Objection, 'text' | 'answer'>): string {
  const heard = maskFigures(o.text);
  const answer = o.answer ? maskFigures(o.answer) : '';
  return `Draft the words for this section of the founder's investor narrative so that it answers the objection investors raised, from the material below.

Section: ${m.label}
Audience: ${m.audience || 'not recorded'}
Objection investors raised: ${heard}
The founder's own answer to it: ${answer || 'not recorded'}
Positioning:
${m.positioning.length ? m.positioning.map((p) => `- ${p}`).join('\n') : '- not recorded'}
The founder's words now: ${m.words || 'none yet'}

Return ONLY valid JSON of exactly this shape:
{ "text": "<the section's words>" }

Rules:
- Keep what the founder's words already say, and answer the objection in them.
- Write no numbers, digits, percentages, prices, dates or counts of any kind. Figures are inserted by the founder from their records.
- Where the material shows [figure], write around it; never write [figure].
- At most ${m.max} characters.
- Never invent customers, results, partners or funding. Name no person and no investor. Give no advice.`;
}
