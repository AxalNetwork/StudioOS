/**
 * D9289 (#9289) — what the Eadwyn chat does for a keyboard, a screen reader
 * and a phone, kept out of `PersonalAdvisor.jsx` so a Node test can import it
 * (that file reaches `lib/advisor/router.js`, which a test cannot).
 *
 *   · `newAssistantLine` / `useAssistantAnnouncement`  the text a polite live
 *     region reads when Eadwyn adds a line. The member's own line, a history
 *     read and the tutor's streamed tokens are not announced.
 *   · `nearBottom` / `shouldFollow` / `useTranscriptFollow`  the transcript
 *     follows a new line only while the reader is at its foot, or when they
 *     just sent one; someone reading older lines is not pulled down.
 *   · `fitHeight` / `useAutoGrow`  the composer grows with its text up to its
 *     CSS max-height, then scrolls.
 *   · `useFocusOnReturn`  focus goes back to the control that opened the
 *     fullscreen view, which is a new element once the card is drawn again.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How far from the foot (px) still counts as "at the newest line". */
export const FOLLOW_SLACK = 48;

/** The text of the newest Eadwyn line among those added since `seen`, or null. */
export function newAssistantLine(seen, messages) {
  const list = Array.isArray(messages) ? messages : [];
  const added = list.length - seen;
  if (added <= 0) return null;
  // An empty transcript filled with several lines at once is the history read
  // on load (or the card ⇄ fullscreen swap), not something Eadwyn just said.
  if (seen === 0 && added > 1) return null;
  for (let i = list.length - 1; i >= seen; i -= 1) {
    const m = list[i];
    if (m?.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content.trim();
  }
  return null;
}

/** The latest line to announce; starts empty, so mounting announces nothing. */
export function useAssistantAnnouncement(messages) {
  const [line, setLine] = useState('');
  const seen = useRef(Array.isArray(messages) ? messages.length : 0);
  useEffect(() => {
    const next = newAssistantLine(seen.current, messages);
    seen.current = Array.isArray(messages) ? messages.length : 0;
    if (next) setLine(next);
  }, [messages]);
  return line;
}

/** True when the scroller shows its foot (within `slack` px). No element counts as at the foot. */
export function nearBottom(el, slack = FOLLOW_SLACK) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

/** Follow a change when the reader was at the foot, or when the change is a line they just sent. */
export function shouldFollow({ wasNearBottom, added, last }) {
  return Boolean(wasNearBottom) || (added > 0 && last?.role === 'user');
}

/**
 * Keeps the transcript at its newest line while the reader is there. Returns
 * the scroller's `onScroll`, which records whether they are; a fresh mount
 * (the card ⇄ fullscreen swap) starts at the foot.
 */
export function useTranscriptFollow(scroller, messages, tutor) {
  const atFoot = useRef(true);
  const seen = useRef(Array.isArray(messages) ? messages.length : 0);
  const onScroll = useCallback(() => { atFoot.current = nearBottom(scroller.current); }, [scroller]);
  useEffect(() => {
    const list = Array.isArray(messages) ? messages : [];
    const added = list.length - seen.current;
    seen.current = list.length;
    const el = scroller.current;
    if (!el) return;
    if (shouldFollow({ wasNearBottom: atFoot.current, added, last: list[list.length - 1] })) {
      el.scrollTop = el.scrollHeight;
      atFoot.current = true;
    }
  }, [scroller, messages, tutor]);
  return onScroll;
}

/** Sizes a textarea to its text (the border included); CSS min/max-height bound it. */
export function fitHeight(el) {
  if (!el || !el.style) return;
  el.style.height = 'auto';
  const border = Math.max(0, (el.offsetHeight || 0) - (el.clientHeight || 0));
  el.style.height = `${(el.scrollHeight || 0) + border}px`;
}

/** Re-fits the composer whenever its text changes. */
export function useAutoGrow(ref, value) {
  useLayoutEffect(() => { fitHeight(ref.current); }, [ref, value]);
}

/** When `on` turns true after being false, focus `target` (the fullscreen view closing). */
export function useFocusOnReturn(on, target) {
  const was = useRef(on);
  useEffect(() => {
    if (on && !was.current) target.current?.focus?.();
    was.current = on;
  }, [on, target]);
}
