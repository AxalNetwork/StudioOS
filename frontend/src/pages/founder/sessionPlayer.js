import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Open recording's player (D690, #1692), shared by Customer research and, for
 * a chat's voice notes, the session page (D754 §5, #1980).
 *
 * `GET /sessions/:id/audio` answers one signed URL per chunk, valid 120
 * seconds, single-use, served as an attachment. So each part is fetched once,
 * as a blob, and the parts play in `seq` order in one `<audio>` from object
 * URLs; an expired or refused URL asks the route again and goes on from that
 * part; a replay plays the blobs already held; the object URLs are revoked
 * when the session changes or the page leaves. A chat's voice notes are its
 * session's chunks (D754 W3), so they play the same way.
 */
export const bySeq = (parts) => [...(Array.isArray(parts) ? parts : [])].sort((a, b) => Number(a.seq) - Number(b.seq));

const fetchPart = async (part) => {
  if (!part?.url || (part.expires_at && Date.parse(part.expires_at) <= Date.now())) throw new Error('expired');
  const res = await fetch(part.url);
  if (!res.ok) throw new Error('refused');
  return URL.createObjectURL(await res.blob());
};

/** `{ player, held, audioError, setAudioError, open }` for one chosen session id. */
export function useSessionPlayer(sessions, sessionId) {
  const [audioError, setAudioError] = useState('');
  const player = useRef(null);
  const held = useRef({ session: null, urls: [] });

  // The blobs belong to one session: a new session, or leaving the page, frees them.
  useEffect(() => () => {
    for (const url of held.current.urls) URL.revokeObjectURL?.(url);
    held.current = { session: null, urls: [] };
  }, [sessionId]);

  const playFrom = useCallback((index) => {
    const el = player.current;
    const urls = held.current.urls;
    if (!el || index >= urls.length) return;
    el.src = urls[index];
    el.onended = () => playFrom(index + 1);
    void el.play?.()?.catch?.(() => {});
  }, []);

  const open = useCallback(async () => {
    setAudioError('');
    if (sessionId == null) { setAudioError('No session is chosen.'); return; }
    player.current?.scrollIntoView?.({ block: 'center' });
    // A replay plays what is held and fetches nothing.
    if (held.current.session === sessionId && held.current.urls.length) { playFrom(0); return; }
    try {
      let partsList = bySeq((await sessions.audio(sessionId))?.parts);
      const urls = [];
      for (let i = 0; i < partsList.length; i += 1) {
        let url;
        try { url = await fetchPart(partsList[i]); } catch {
          // Expired or refused: fresh URLs, then go on from this part.
          partsList = bySeq((await sessions.audio(sessionId))?.parts);
          url = await fetchPart(partsList.find((p) => Number(p.seq) === Number(partsList[i]?.seq)) || partsList[i]);
        }
        urls.push(url);
      }
      held.current = { session: sessionId, urls };
      playFrom(0);
    } catch (e) {
      setAudioError(e?.message && !['expired', 'refused'].includes(e.message) ? e.message : 'The recording could not be played.');
    }
  }, [sessions, sessionId, playFrom]);

  return { player, held, audioError, setAudioError, open };
}
