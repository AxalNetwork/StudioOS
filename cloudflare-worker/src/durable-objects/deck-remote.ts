/**
 * D1581 (#3828, deck v2 F2) — DeckRemote: a phone remote for Present, paired by
 * code. The rules are in `services/decks/remote.ts`; access is checked by
 * `routes/deck_remote.ts` before any call reaches here.
 *
 * One class, two kinds of instance:
 *   - `deck:<version id>`, the room. It holds Present's sockets
 *     (Hibernatable WebSockets, so an idle Present costs no duration) and the
 *     pairing (`Pairing`: the live code, or the paired remote). A step from the
 *     paired remote goes out to every Present socket at once.
 *   - `code:<six digits>`, the pointer. It says which deck a live code belongs
 *     to, and gives that answer once: the join takes it.
 *
 * BOUND as `DECK_REMOTE` in all three `wrangler.toml` tables, under the
 * `v7-deck-remote` migration. A Worker without the binding answers 503
 * `remote_off` on every remote route.
 */
import type { Env } from '../types';
import { CODE_TTL_MS, REMOTE_TTL_MS, codeLive, makeCode, remoteLive, stepOf, type Pairing } from '../services/decks/remote';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const PRESENT_MAX = 8;

type Pointer = { deck_id: number; expires: number };

export class DeckRemote implements DurableObject {
  private state: DurableObjectState;
  /** Tests only: the clock and the code source (uniform 32-bit draws). */
  now: () => number = () => Date.now();
  random: (() => number) | undefined = undefined;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  private async pairing(): Promise<Pairing | null> {
    return (await this.state.storage.get<Pairing>('pairing')) ?? null;
  }

  private sockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  private send(frame: unknown): number {
    const text = JSON.stringify(frame);
    let n = 0;
    for (const ws of this.sockets()) {
      try { ws.send(text); n += 1; } catch { /* closing; webSocketClose cleans up */ }
    }
    return n;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const now = this.now();
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

    // ---- the pointer: code → deck ------------------------------------------
    if (url.pathname === '/claim') {
      const held = await this.state.storage.get<Pointer>('pointer');
      if (held && held.expires > now) return json({ ok: false }, 409); // a live code with this number: try another
      const deckId = Number(body.deck_id);
      if (!Number.isSafeInteger(deckId) || deckId < 1) return json({ ok: false }, 400);
      await this.state.storage.put('pointer', { deck_id: deckId, expires: now + CODE_TTL_MS } satisfies Pointer);
      return json({ ok: true });
    }
    if (url.pathname === '/take') {
      const held = await this.state.storage.get<Pointer>('pointer');
      await this.state.storage.delete('pointer');
      return held && held.expires > now ? json({ deck_id: held.deck_id }) : json({ deck_id: null }, 404);
    }

    // ---- the room ---------------------------------------------------------------
    if (url.pathname === '/ws') {
      if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected websocket upgrade', { status: 426 });
      if (this.sockets().length >= PRESENT_MAX) return json({ error: 'room_full' }, 409);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      const p = await this.pairing();
      server.send(JSON.stringify({ type: 'hello', paired: remoteLive(p, p?.remote_id, now) }));
      const headers: Record<string, string> = {};
      const first = req.headers.get('sec-websocket-protocol')?.split(',').map((s) => s.trim()).find(Boolean);
      if (first) headers['sec-websocket-protocol'] = first;
      return new Response(null, { status: 101, webSocket: client, headers });
    }
    if (url.pathname === '/pair') {
      // A new code ends any remote that was paired before.
      const code = makeCode(this.random);
      const p: Pairing = { code, code_expires: now + CODE_TTL_MS, remote_id: null, remote_expires: 0, paired_by: Number(body.user_id) || 0 };
      await this.state.storage.put('pairing', p);
      this.send({ type: 'unpaired' });
      return json({ code, expires_at: new Date(p.code_expires).toISOString() });
    }
    if (url.pathname === '/join') {
      const p = await this.pairing();
      if (!codeLive(p, now) || p!.code !== body.code) return json({ error: 'code_not_found' }, 404);
      const remoteId = crypto.randomUUID();
      const next: Pairing = { ...p!, code: null, code_expires: 0, remote_id: remoteId, remote_expires: now + REMOTE_TTL_MS };
      await this.state.storage.put('pairing', next);
      this.send({ type: 'paired' });
      return json({ remote_id: remoteId, expires_at: new Date(next.remote_expires).toISOString() });
    }
    if (url.pathname === '/step') {
      const p = await this.pairing();
      if (!remoteLive(p, body.remote_id, now)) return json({ error: 'remote_not_paired' }, 409);
      const step = stepOf(body.step);
      if (!step) return json({ error: 'invalid_step' }, 400);
      const delivered = this.send({ type: 'step', step, at: now });
      return json({ ok: true, delivered });
    }
    if (url.pathname === '/unpair') {
      await this.state.storage.delete('pairing');
      this.send({ type: 'unpaired' });
      return json({ ok: true });
    }
    if (url.pathname === '/state') {
      const p = await this.pairing();
      return json({ code_live: codeLive(p, now), paired: remoteLive(p, p?.remote_id, now), presenting: this.sockets().length });
    }
    return json({ error: 'not_found' }, 404);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 256) return;
    try { if (JSON.parse(message)?.type === 'ping') ws.send(JSON.stringify({ type: 'pong' })); } catch { /* not ours */ }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, 'closed'); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
  }
}
