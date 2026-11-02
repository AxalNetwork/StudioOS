/**
 * D4086 (#4086, #4087) — a round's recorded exemption and the deck links
 * published under it.
 *
 * The founder records the exemption on the round (`raise_rounds.exemption`,
 * `PUT /api/contacts/raise-round`). Recording anything but 506(c) on a round
 * unpublishes every link published for a deck of that round: the publish key
 * comes off the link's `include_json` (the link itself keeps opening as the
 * private link it was before it was published), the venture's Activity
 * records it, and the venture's founders get a notice. Recording 506(c), or
 * clearing the exemption, unpublishes nothing.
 *
 * The share read, the email gate, the embed and the preview card also check
 * the round each time (`linkStands`), so a link this step could not reach
 * still stops reading as published.
 */
import type { Env } from '../../types';
import { notify } from '../notify';
import { logCycleWrite } from '../cycleActivity';
import { PUBLISHABLE, publishOf, roundExemptionOf, withPublish, type RoundExemption } from './publish';

/** What the round write does with the body's `exemption`: keep (undefined), set a listed value, clear (null), or refuse. */
export function exemptionInput(v: unknown): { value: RoundExemption | null | undefined } | { error: string } {
  if (v === undefined) return { value: undefined };
  if (v === null || v === '') return { value: null };
  const e = roundExemptionOf(v);
  return e ? { value: e } : { error: 'exemption is one of 506b, 506c, reg_cf, reg_s or other' };
}

/** Does recording `next` over `prev` unpublish the round's links: a recorded change to anything but 506(c). */
export function unpublishes(prev: RoundExemption | null, next: RoundExemption | null): boolean {
  return next != null && next !== PUBLISHABLE && next !== prev;
}

export const UNPUBLISHED_TITLE = 'Published deck links were taken down';
export function unpublishedBody(n: number, label: string): string {
  return `${n === 1 ? 'One published deck link was' : `${n} published deck links were`} unpublished because the round is now recorded as ${label}. ${n === 1 ? 'It still opens' : 'They still open'} as private links for the people who have ${n === 1 ? 'it' : 'them'}.`;
}

export const EXEMPTION_LABELS: Record<RoundExemption, string> = {
  '506b': 'Rule 506(b)', '506c': 'Rule 506(c)', reg_cf: 'Regulation Crowdfunding', reg_s: 'Regulation S', other: 'another exemption',
};

/**
 * Take the publish state off every published link of a deck for this round.
 * Returns how many were unpublished. Each write is bound; a link whose state
 * does not read as published is left alone.
 */
export async function unpublishRoundLinks(
  env: Env,
  args: { projectId: number; roundUid: string; exemption: RoundExemption; byUserId: number },
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.include_json FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
      WHERE d.project_id = ? AND d.round_ref = ? AND t.include_json LIKE '%"publish"%'`,
  ).bind(args.projectId, args.roundUid).all<{ id: number; include_json: string | null }>();
  let n = 0;
  for (const r of (rows.results || []) as Array<{ id: number; include_json: string | null }>) {
    if (!publishOf(r.include_json)) continue;
    await env.DB.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?').bind(withPublish(r.include_json, null), r.id).run();
    n++;
  }
  if (!n) return 0;
  const label = EXEMPTION_LABELS[args.exemption];
  await logCycleWrite(env, {
    projectId: args.projectId, userId: args.byUserId, cycle: 'raise', module: 'pitch-deck', entityId: null,
    action: 'deck_link_unpublished', summary: `${n === 1 ? 'A published link was' : `${n} published links were`} unpublished: the round is recorded as ${label}`,
  });
  let founders: number[] = [];
  try {
    const res = await env.DB.prepare(
      "SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ? AND u.role = 'founder'",
    ).bind(args.projectId).all<{ id: number }>();
    founders = ((res.results || []) as Array<{ id: number }>).map((u) => Number(u.id));
  } catch (e) { console.error('[round exemption] founders unreadable', (e as Error).message); }
  if (!founders.length) founders = [args.byUserId];
  for (const userId of new Set(founders)) {
    try {
      await notify(env, {
        userId, type: 'deck_link_unpublished', channels: ['in_app'], link: null,
        title: UNPUBLISHED_TITLE, body: unpublishedBody(n, label),
      });
    } catch (e) { console.error('[round exemption] notice failed', (e as Error).message); }
  }
  return n;
}
