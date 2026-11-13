import { useCallback, useEffect, useRef, useState } from 'react';
import { presence as readPresence } from './deckV2Adapter';
import { reportError } from '../../../lib/log';

/**
 * D1577 (#3824) — the other members on a deck, for `DeckToolbar`, `GridStage`
 * and the Studio home deck card (`presenceModel.js` says what is drawn).
 *
 * First the read (`deckV2Adapter.presence`, `GET /api/decks/:id/presence`).
 * On a Worker without the room's binding it answers "Coming later",
 * `editors` stays null and nothing is drawn, and no socket is
 * opened. Once it answers, a writer (`live`) joins the room's socket
 * (`/api/decks/:id/presence/ws`, `bearer.<jwt>` subprotocol as
 * `useWebSocket.js`) and sends:
 *   - `area`: the area they selected (or none), which the room refuses with
 *     "Wait or ask [Name]" when another member holds it (`locked`);
 *   - `edit`: on each change, so their soft lock does not lapse;
 *   - `cursor`: their pointer over the stage, as fractions (the room drops
 *     frames faster than five a second).
 * A reader only reads the list once; the socket is the writers'.
 */
export default function useDeckPresence(deckId, { live = false, enabled = true } = {}) {
  const [editors, setEditors] = useState(null);
  const [you, setYou] = useState(null);
  const [locked, setLocked] = useState(null);
  const ws = useRef(null);

  useEffect(() => {
    setEditors(null); setYou(null); setLocked(null);
    if (!enabled || deckId == null) return undefined;
    let alive = true;
    let socket = null;
    readPresence(deckId).then((r) => {
      if (!alive || r?.available !== true) return;
      setEditors(Array.isArray(r.value?.editors) ? r.value.editors : []);
      if (!live || typeof WebSocket === 'undefined' || typeof window === 'undefined') return;
      let token = '';
      try { token = window.localStorage.getItem('token') || ''; } catch { token = ''; }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      try {
        socket = new WebSocket(`${proto}//${window.location.host}/api/decks/${encodeURIComponent(deckId)}/presence/ws`, token ? [`bearer.${token}`] : undefined);
      } catch (e) { reportError('pitch-presence:socket', e); return; }
      ws.current = socket;
      socket.onmessage = (ev) => {
        let f = null;
        try { f = JSON.parse(ev.data); } catch { return; }
        if (f?.type === 'presence' && Array.isArray(f.editors)) setEditors(f.editors);
        else if (f?.type === 'hello') setYou(f.you ?? null);
        else if (f?.type === 'locked') setLocked(typeof f.message === 'string' ? f.message : null);
      };
      socket.onclose = () => { if (ws.current === socket) ws.current = null; };
    }, (e) => reportError('pitch-presence:read', e));
    return () => {
      alive = false;
      if (socket) { try { socket.close(1000, 'left'); } catch { /* already closed */ } }
      ws.current = null;
    };
  }, [deckId, live, enabled]);

  const send = useCallback((frame) => {
    const s = ws.current;
    if (!s || s.readyState !== 1) return;
    try { s.send(JSON.stringify(frame)); } catch { /* the room hears the next one */ }
  }, []);
  const claim = useCallback((card, area) => { setLocked(null); send({ type: 'area', card: card ?? null, area: area ?? null }); }, [send]);
  const edit = useCallback(() => send({ type: 'edit' }), [send]);
  const cursor = useCallback((card, x, y) => send({ type: 'cursor', card: card ?? null, x, y }), [send]);
  return { editors, you, locked, claim, edit, cursor };
}
