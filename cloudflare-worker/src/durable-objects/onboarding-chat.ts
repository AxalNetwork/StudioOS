/**
 * OnboardingChat — one Durable Object instance per founder `user_id`.
 *
 * The Worker calls `/broadcast` from POST /api/profiling/chat (and /save)
 * so that admins viewing the ProfileReviewModal see new transcript lines
 * appear live without polling.
 *
 * Authorization for SUBSCRIBING is enforced by the worker route
 * (admin-only); this DO trusts the upgrade once forwarded. Founders also
 * MAY connect to their own room (route enforces user_id == self.id || admin).
 *
 * Persistence: we keep the last 50 messages in DO storage so a viewer
 * who connects mid-session immediately gets recent context. Older history
 * still lives in the `chat_history` JSON column on the founder profile.
 */
import type { Env } from '../types';
import { bumpActiveWS } from '../services/realtime';

const HEARTBEAT_MS = 25_000;
const RECENT_LIMIT = 50;
const RECENT_KEY = 'recent';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
}

export class OnboardingChat implements DurableObject {
  private state: DurableObjectState;
  private _env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this._env = env;
    void this._env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const msg = (await request.json()) as Partial<ChatMessage>;
      if (!msg?.role || typeof msg.content !== 'string') {
        return new Response(JSON.stringify({ error: 'Bad message shape' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const stamped: ChatMessage = {
        role: msg.role,
        content: msg.content,
        ts: msg.ts ?? Date.now(),
      };
      await this.appendRecent(stamped);
      this.broadcast({ type: 'chat_message', message: stamped });
      return new Response(JSON.stringify({ ok: true, fanout: this.state.getWebSockets().length }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/count') {
      return new Response(JSON.stringify({ active: this.state.getWebSockets().length }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      await bumpActiveWS(this._env, +1);

      const userId = request.headers.get('x-auth-user-id') || 'unknown';
      const role = request.headers.get('x-auth-role') || 'unknown';
      server.serializeAttachment({ userId, role, connectedAt: Date.now() });

      // Send hello + recent backlog so the viewer has context immediately.
      const recent = ((await this.state.storage.get<ChatMessage[]>(RECENT_KEY)) || []);
      server.send(JSON.stringify({ type: 'hello', room: 'onboarding', recent, ts: Date.now() }));

      await this.scheduleHeartbeat();
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  private async appendRecent(msg: ChatMessage) {
    const list = ((await this.state.storage.get<ChatMessage[]>(RECENT_KEY)) || []);
    list.push(msg);
    while (list.length > RECENT_LIMIT) list.shift();
    await this.state.storage.put(RECENT_KEY, list);
  }

  private broadcast(event: unknown) {
    const payload = JSON.stringify(event);
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(payload); } catch {}
    }
  }

  private async scheduleHeartbeat() {
    const current = await this.state.storage.getAlarm();
    if (!current) await this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === 'string') {
      try {
        const parsed = JSON.parse(message);
        if (parsed?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {}
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, 'closed'); } catch {}
    await bumpActiveWS(this._env, -1);
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(1011, 'error'); } catch {}
    await bumpActiveWS(this._env, -1);
  }

  async alarm() {
    const sockets = this.state.getWebSockets();
    if (sockets.length === 0) return;
    const ping = JSON.stringify({ type: 'ping', ts: Date.now() });
    for (const ws of sockets) { try { ws.send(ping); } catch {} }
    await this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }
}
