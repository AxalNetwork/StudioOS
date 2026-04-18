import { useEffect, useRef, useState } from 'react';

/**
 * useWebSocket — auto-reconnecting WebSocket hook for the StudioOS realtime API.
 *
 * Usage:
 *   useWebSocket('/api/pipeline/ws/overview', {
 *     enabled: true,
 *     onMessage: (event) => { ... },
 *   });
 *
 * - The auth token (localStorage 'token') is appended as ?token= because
 *   browsers cannot set Authorization headers on WS handshakes.
 * - Reconnects with exponential backoff capped at 30s, resets on success.
 * - Sends a `{type:'ping'}` every 20s; the server's `{type:'pong'}` is
 *   silently ignored at the consumer level.
 * - When `enabled` flips false (e.g. modal closed) the socket is closed
 *   cleanly and reconnect is suspended.
 */
export function useWebSocket(path, { enabled = true, onMessage } = {}) {
  const [status, setStatus] = useState('idle'); // idle | connecting | open | closed
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const closedByUsRef = useRef(false);

  // Keep the latest onMessage without forcing reconnects when it changes.
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    if (!enabled || !path) {
      closedByUsRef.current = true;
      if (wsRef.current) { try { wsRef.current.close(1000, 'disabled'); } catch {} }
      return;
    }

    closedByUsRef.current = false;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const token = localStorage.getItem('token') || '';
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sep = path.includes('?') ? '&' : '?';
      const url = `${proto}//${window.location.host}${path}${sep}token=${encodeURIComponent(token)}`;
      setStatus('connecting');
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { try { ws.close(); } catch {} return; }
        retriesRef.current = 0;
        setStatus('open');
        // Heartbeat every 20s. Server replies with pong; we don't need to act.
        heartbeatTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
          }
        }, 20_000);
      };

      ws.onmessage = (ev) => {
        if (!onMessageRef.current) return;
        let data = ev.data;
        try { data = JSON.parse(ev.data); } catch {}
        // Swallow pongs so consumers don't see them.
        if (data && data.type === 'pong') return;
        try { onMessageRef.current(data); } catch (e) {
          console.error('[ws] onMessage handler threw', e);
        }
      };

      ws.onclose = () => {
        if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
        setStatus('closed');
        if (!closedByUsRef.current && !cancelled) scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire next; let it handle reconnect.
      };
    };

    const scheduleReconnect = () => {
      if (closedByUsRef.current || cancelled) return;
      const attempt = retriesRef.current++;
      const delay = Math.min(30_000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      closedByUsRef.current = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
      if (wsRef.current) { try { wsRef.current.close(1000, 'unmount'); } catch {} }
    };
  }, [path, enabled]);

  return { status };
}
