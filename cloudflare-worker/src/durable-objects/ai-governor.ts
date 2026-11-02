/**
 * D1502 part 2 (#3753, deck v2 A3a): `AiGovernor` — one Durable Object per
 * account that hands out the per-step slots of its deck generation runs
 * (`services/decks/aiGovernor.ts`: kind caps, two runs at once, a token bucket
 * per model). Its state is in memory: leases expire on their own, so an
 * evicted governor starts empty and costs a step at most a short wait.
 * Only `governorFor` reaches it.
 */
import type { Env } from '../types';
import { Governor, type AcquireInput } from '../services/decks/aiGovernor';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

export class AiGovernor implements DurableObject {
  private governor = new Governor();
  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
    const path = new URL(req.url).pathname;
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
    if (path === '/acquire') {
      const input: AcquireInput = { account: Number(body?.account), run: String(body?.run ?? ''), kind: String(body?.kind ?? 'text'), model: typeof body?.model === 'string' ? body.model : null };
      if (!Number.isSafeInteger(input.account) || input.account <= 0 || !input.run) return json({ error: 'invalid_body' }, 400);
      return json(this.governor.acquire(input));
    }
    if (path === '/release') return json({ released: this.governor.release(String(body?.id ?? '')) });
    return json({ error: 'not_found' }, 404);
  }
}
