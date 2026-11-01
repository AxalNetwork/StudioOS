import { useCallback, useEffect, useRef, useState } from 'react';
import { rateOf, seekTarget } from '../cycles/recordHeaderModel.js';

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
 *
 * D1454 (#3710, IV-M3): `seek(ms)` plays from a passage's start (tap a line):
 * the part whose `start_ms` holds it, at the offset inside it (`seekTarget`);
 * a part or passage with no `start_ms` does not play, rather than play from a
 * guess. `rate` and `setRate` give 1×, 1.5× and 2×, kept across parts.
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
  const [rate, setRateState] = useState(1);
  const rateRef = useRef(1);
  const player = useRef(null);
  const held = useRef({ session: null, urls: [], parts: [] });

  // The blobs belong to one session: a new session, or leaving the page, frees them.
  useEffect(() => () => {
    for (const url of held.current.urls) URL.revokeObjectURL?.(url);
    held.current = { session: null, urls: [], parts: [] };
  }, [sessionId]);

  const playFrom = useCallback((index, offsetMs = 0) => {
    const el = player.current;
    const urls = held.current.urls;
    if (!el || index >= urls.length) return;
    el.src = urls[index];
    el.defaultPlaybackRate = rateRef.current;
    el.playbackRate = rateRef.current;
    if (offsetMs > 0) {
      const at = offsetMs / 1000;
      try { el.currentTime = at; } catch { /* set once the metadata is read */ }
      el.onloadedmetadata = () => { el.onloadedmetadata = null; if (Math.abs((el.currentTime || 0) - at) > 0.25) el.currentTime = at; };
    }
    el.onended = () => playFrom(index + 1);
    void el.play?.()?.catch?.(() => {});
  }, []);

  const setRate = useCallback((raw) => {
    const r = rateOf(raw);
    rateRef.current = r;
    setRateState(r);
    const el = player.current;
    if (el) { el.defaultPlaybackRate = r; el.playbackRate = r; }
  }, []);

  /** Fetch every part once; true when they are held. */
  const load = useCallback(async () => {
    if (held.current.session === sessionId && held.current.urls.length) return true;
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
      held.current = { session: sessionId, urls, parts: partsList };
      return true;
    } catch (e) {
      setAudioError(e?.message && !['expired', 'refused'].includes(e.message) ? e.message : 'The recording could not be played.');
      return false;
    }
  }, [sessions, sessionId]);

  const open = useCallback(async () => {
    setAudioError('');
    if (sessionId == null) { setAudioError('No session is chosen.'); return; }
    player.current?.scrollIntoView?.({ block: 'center' });
    // A replay plays what is held and fetches nothing.
    if (await load()) playFrom(0);
  }, [sessionId, load, playFrom]);

  /** Play from `ms` into the session; false when that place cannot be found. */
  const seek = useCallback(async (ms) => {
    setAudioError('');
    if (sessionId == null) { setAudioError('No session is chosen.'); return false; }
    if (!(await load())) return false;
    const target = seekTarget(held.current.parts, ms);
    if (!target) { setAudioError('This passage has no recorded place in the audio.'); return false; }
    playFrom(target.index, target.offsetMs);
    return true;
  }, [sessionId, load, playFrom]);

  return { player, held, audioError, setAudioError, open, seek, rate, setRate };
}
