import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scroll to the element the URL's hash names, once it exists.
 *
 * React Router does not scroll to a hash on its own. `BucketBoard` does this
 * for a board's sections; a zone page that keeps a section behind a redirect
 * (D571: `/practice/session-types` lands on `/practice/sessions#session-types`)
 * needs the same, but only after its data arrives, because a section rendered
 * under a skeleton has no element to scroll to yet. `waiting` is that: true
 * while the section is not on the page, and the effect runs again when it
 * turns false.
 */
export default function useScrollToHash(waiting = false) {
  const { hash } = useLocation();
  useEffect(() => {
    if (waiting || typeof document === 'undefined') return;
    const id = decodeURIComponent(String(hash || '').replace(/^#/, ''));
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [hash, waiting]);
}
