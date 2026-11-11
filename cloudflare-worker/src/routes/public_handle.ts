/**
 * D4289 P2 (#4291) — the public read behind `axal.vc/@handle`, mounted at
 * /api/public/handle. No sign-in. The rules are `services/influencerHandles.ts`.
 *
 *   GET /api/public/handle/:handle            and  /:handle/:channel
 *     → 200 { state: 'live', handle, channel, name, photo, line, tier, tier_label, offer, disclosure, ref }
 *       200 { state: 'moved', handle, redirect }   an old handle, for 12 months
 *       200 { state: 'unavailable' }               a paused or ended influencer: no name, offer or attribution
 *       404 { state: 'unknown' }
 *
 * A live read records one visit (`handle_visits`) per handle, channel, day and
 * visitor; the visitor is the `X-Axal-Visitor` header's client-held id, hashed
 * with the day. No IP is stored. `ref` is the first-touch cookie value the page
 * sets (`h:<handle>[:<channel>]`).
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import { publicHandle } from '../services/influencerHandles';

const r = new Hono<{ Bindings: Env }>();

async function read(c: Context<{ Bindings: Env }>, channel: string | null) {
  try {
    const out = await publicHandle(c.env, c.req.param('handle') ?? '', channel, c.req.header('x-axal-visitor') ?? null);
    c.header('cache-control', 'no-store');
    return c.json(out.body, out.status);
  } catch (e) {
    console.error('[public_handle] read failed', (e as Error)?.message);
    return refuse(c, 503, { code: 'handle_unreadable', message: 'This page could not be read. Try again in a moment.' });
  }
}

r.get('/:handle', (c) => read(c, null));
r.get('/:handle/:channel', (c) => read(c, c.req.param('channel') ?? null));

export const mount: RouteMount = { path: '/api/public/handle', router: r };
export default r;
