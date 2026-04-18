/**
 * PipelineRoom — one Durable Object instance per pipeline `deal_id`.
 *
 * Fans out real-time pipeline events (stage advance, score snapshot, AI
 * recommendation) to every connected admin/partner WebSocket viewer of
 * that deal.
 *
 * Hibernatable WebSockets (state.acceptWebSocket) keep idle connections
 * off the billing clock — the runtime evicts the JS instance and revives
 * it on next message/close. Don't store mutable state in instance fields
 * that you expect to survive eviction; persist via state.storage instead.
 */
import type { Env } from '../types';

const HEARTBEAT_MS = 25_000;
const HEARTBEAT_ALARM_KEY = 'pipeline_room_alarm';

export class PipelineRoom implements DurableObject {
  private state: DurableObjectState;
  // env is unused today but kept on the instance so subclasses / future
  // event handlers (e.g. fetching enrichment data on connect) can reach it.
  private _env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this._env = env;
    void this._env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /broadcast — internal-only event ingest from the worker fetch
    // handler. The DO is NOT publicly addressable (no route binds to it
    // directly); only the worker calls .fetch() on it via the binding.
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const event = await request.json();
      this.broadcast(event);
      return new Response(JSON.stringify({ ok: true, fanout: this.state.getWebSockets().length }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // GET /count — used by /api/infra/queue to report active connections
    if (request.method === 'GET' && url.pathname === '/count') {
      return new Response(JSON.stringify({ active: this.state.getWebSockets().length }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // GET /ws — WebSocket upgrade. The route handler authenticates the
    // user before forwarding here, and forwards the user_id + role on
    // X-Auth-* headers so we can attach them to the socket.
    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      // Hibernatable accept — the runtime will evict the JS instance
      // between events and re-deliver via webSocketMessage/Close.
      this.state.acceptWebSocket(server);

      // Tag so we can route per-user logic later if needed.
      const userId = request.headers.get('x-auth-user-id') || 'unknown';
      const role = request.headers.get('x-auth-role') || 'unknown';
      server.serializeAttachment({ userId, role, connectedAt: Date.now() });

      // Send a hello frame immediately so the client confirms the round-trip
      // worked. After this the socket is silent until events arrive.
      server.send(JSON.stringify({ type: 'hello', room: 'pipeline', ts: Date.now() }));

      // Schedule a heartbeat alarm so dead connections get pruned even
      // when no broadcast is happening.
      await this.scheduleHeartbeat();

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  private broadcast(event: unknown) {
    const payload = JSON.stringify(event);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Socket may be closing; ignore — webSocketClose will clean up.
      }
    }
  }

  private async scheduleHeartbeat() {
    const current = await this.state.storage.getAlarm();
    if (!current) {
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
      await this.state.storage.put(HEARTBEAT_ALARM_KEY, true);
    }
  }

  // Hibernatable WS lifecycle hooks — called by the runtime even after
  // instance eviction. Keep them small and side-effect-free where possible.

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // We only support a 'ping' from clients; everything else is server-push.
    if (typeof message === 'string') {
      try {
        const parsed = JSON.parse(message);
        if (parsed?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // Ignore malformed client frames.
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean) {
    try {
      ws.close(code, 'closed');
    } catch {}
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    try {
      ws.close(1011, 'error');
    } catch {}
  }

  async alarm() {
    // Server-initiated heartbeat — sends a ping to every connected socket
    // so any half-open TCP connections error out and get cleaned up by
    // webSocketError. Reschedules itself if there are still listeners.
    const sockets = this.state.getWebSockets();
    if (sockets.length === 0) {
      await this.state.storage.delete(HEARTBEAT_ALARM_KEY);
      return;
    }
    const ping = JSON.stringify({ type: 'ping', ts: Date.now() });
    for (const ws of sockets) {
      try { ws.send(ping); } catch {}
    }
    await this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }
}
