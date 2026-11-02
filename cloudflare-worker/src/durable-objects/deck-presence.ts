/**
 * D1577 (#3824, deck v2 E4) — DeckPresence: one Durable Object per deck
 * (`deck:<project id>`), so every version of a venture's deck shares its room.
 *
 * It holds who is editing, their cursors and the soft lock on the area each is
 * in, and fans each change out to the others. The rules are in
 * `services/decks/coedit.ts` (`step`, `lockHolder`, `editorView`); this file is
 * only the socket plumbing.
 *
 * NO STORAGE. Each editor's state lives in its socket's attachment
 * (`serializeAttachment`), so the object survives hibernation without a
 * Durable Object storage write, and a closed socket takes its lock with it.
 * Hibernatable WebSockets keep an idle room off the duration bill.
 *
 * BOUND as `DECK_PRESENCE` in all three `wrangler.toml` tables, with the
 * `v3-deck-presence` migration, after the owner approved D1577's monthly cost
 * estimate (decision L, D1556). A Worker without the binding (a test, a
 * branch that dropped it) answers 503 `presence_off` on every presence route.
 */
import type { Env } from '../types';
import { EDITORS_MAX, colourOf, editorView, step, type Editor } from '../services/decks/coedit';

export class DeckPresence implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  private editors(): Array<{ ws: WebSocket; e: Editor }> {
    const out: Array<{ ws: WebSocket; e: Editor }> = [];
    for (const ws of this.state.getWebSockets()) {
      const e = (ws.deserializeAttachment?.() as Editor | null) ?? null;
      if (e) out.push({ ws, e });
    }
    return out;
  }

  private snapshot(now = Date.now()) {
    return { type: 'presence', editors: this.editors().map(({ e }) => editorView(e, now)) };
  }

  private broadcast(now = Date.now(), gone: WebSocket | null = null) {
    const frame = JSON.stringify({ type: 'presence', editors: this.editors().filter(({ ws }) => ws !== gone).map(({ e }) => editorView(e, now)) });
    for (const { ws } of this.editors()) {
      if (ws === gone) continue;
      try { ws.send(frame); } catch { /* closing; webSocketClose cleans up */ }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/state') {
      return Response.json(this.snapshot());
    }
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
    if (request.headers.get('upgrade') !== 'websocket') return new Response('Expected websocket upgrade', { status: 426 });
    if (this.state.getWebSockets().length >= EDITORS_MAX) {
      return Response.json({ error: 'room_full', message: `At most ${EDITORS_MAX} members can edit a deck at once.` }, { status: 409 });
    }
    const userId = Number(request.headers.get('x-auth-user-id'));
    const name = request.headers.get('x-auth-name');
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server);
    const editor: Editor = {
      userId, name: name ? decodeURIComponent(name) : null, colour: colourOf(userId), tab: crypto.randomUUID(),
      card: null, area: null, areaAt: 0, cursor: null, cursorAt: 0,
    };
    server.serializeAttachment(editor);
    server.send(JSON.stringify({ type: 'hello', you: editorView(editor, Date.now()) }));
    this.broadcast();
    const headers: Record<string, string> = {};
    const offered = request.headers.get('sec-websocket-protocol');
    const first = offered?.split(',').map((s) => s.trim()).find(Boolean);
    if (first) headers['sec-websocket-protocol'] = first;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 512) return;
    let frame: unknown;
    try { frame = JSON.parse(message); } catch { return; }
    if ((frame as any)?.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
    const self = (ws.deserializeAttachment?.() as Editor | null) ?? null;
    if (!self) return;
    const now = Date.now();
    const result = step(this.editors().map(({ e }) => e).filter((e) => e.tab !== self.tab).concat(self), self, frame, now);
    if (result.kind === 'ignore') return;
    ws.serializeAttachment(result.editor);
    if (result.kind === 'locked') {
      ws.send(JSON.stringify({ type: 'locked', card: result.editor.card, holder: editorView(result.holder, now), message: result.message }));
    }
    this.broadcast(now);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, 'closed'); } catch { /* already closed */ }
    this.broadcast(Date.now(), ws);
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
    this.broadcast(Date.now(), ws);
  }
}
