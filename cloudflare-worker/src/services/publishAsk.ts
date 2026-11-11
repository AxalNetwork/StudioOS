/**
 * #4046 (S1, 2026-11-04) — Ask on Publish to…'s post text: what Eadwyn is
 * given, how its answer is cut to the chosen places, and nothing else.
 *
 * `POST /api/publish/ask` (`routes/publish.ts`) quotes or runs ONE `rail_write`
 * under `draft:publish`, metered like every rail press. It WRITES NOTHING: no
 * draft, no proposal, no send. The text goes back to the sheet, whose Accept
 * places it in the Draft box; from there it is the founder's own text, checked
 * and previewed like typed text, and only the confirm dialog's Send publishes.
 *
 *   · WHAT IS READ is the module's own builder (`prefillDraft`, D1333), so the
 *     never-list holds: no customer's or applicant's name, no partner not
 *     agreed to be named, no figure not recorded. Team-only figures are never
 *     read: Eadwyn never ticks them in (D1322), whatever the draft says.
 *   · FOR THE CHOSEN PLACES: each ticked destination passes preview's own rule
 *     (`canPublish` with its integration and destination). The prompt names
 *     each service and its audience, and the answer is cut to the smallest
 *     confirmed text limit.
 *
 * No figure, name or prompt is logged: the route logs outcomes only.
 */
import type { PublishModule } from '../integrations/publishSources';
import { MODULE_LABEL } from './publishSources';

export const PUBLISH_ASK_OPTION = 'draft:publish';
/** The rail page a press is recorded against when the sheet sends none: Grow, which owns Publish to…. */
export const PUBLISH_ASK_PAGE = 'Founder · Grow';
/** At most this many ticked places shape one draft. */
export const ASK_MAX_PLACES = 5;
/** With no confirmed limit, the post is kept to this many characters. */
export const ASK_DEFAULT_LIMIT = 1200;
export const ASK_MAX_TOKENS = 700;

export interface AskPlace { provider_key: string; account: string; audience: string | null; text_limit: number | null }
export interface AskLine { line: string; source: string; as_of: string | null }

/** The smallest confirmed text limit of the chosen places, else the default. */
export function askLimit(places: readonly AskPlace[]): number {
  const limits = places.map((p) => p.text_limit).filter((n): n is number => Number.isSafeInteger(n) && (n as number) > 0);
  return limits.length ? Math.min(...limits, 20_000) : ASK_DEFAULT_LIMIT;
}

export const ASK_SYSTEM = [
  'You write one social post for a startup founder, in their own voice: plain, specific, no hype.',
  'Use ONLY the facts in the numbered lines. Do not add a figure, a date, a name, a customer, a partner or a claim that is not in them.',
  'Never invent a number. If a line has no figure, write it without one.',
  'Write for the services listed and stay under the character limit given.',
  'Answer with the post text only: no title, no quotation marks, no hashtags unless a line holds one, no notes to the founder.',
].join('\n');

/** The user message: the module, the places and their audiences, the limit, and the lines with their sources. */
export function askPrompt(module: PublishModule, lines: readonly AskLine[], places: readonly AskPlace[]): string {
  const where = places.map((p) => `- ${p.provider_key}${p.audience ? ` (${p.audience})` : ''}`).join('\n');
  const facts = lines.map((l, i) => `${i + 1}. ${l.line} [${l.source}${l.as_of ? `, ${l.as_of}` : ''}]`).join('\n');
  return [
    `Topic: ${MODULE_LABEL[module]}.`,
    `Post to:\n${where}`,
    `Character limit: ${askLimit(places)}.`,
    `Facts:\n${facts}`,
  ].join('\n\n');
}

/**
 * The post as it is placed: the model's text without fences, wrapping quotes
 * or a "Post:" label, cut at a word boundary to `limit`. Null when nothing is left.
 */
export function screenPost(raw: unknown, limit: number): string | null {
  if (typeof raw !== 'string') return null;
  let t = raw.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  t = t.replace(/^(post|draft)\s*:\s*/i, '').trim();
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim();
  if (!t) return null;
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const at = cut.lastIndexOf(' ');
  return (at > limit * 0.6 ? cut.slice(0, at) : cut).trimEnd();
}
