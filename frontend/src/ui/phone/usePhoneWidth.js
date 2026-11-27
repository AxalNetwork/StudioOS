import { useEffect, useState } from 'react';
import { PHONE_QUERY, isPhoneWidth } from '../../workspaces/lens.jsx';
import { BELOW_MD_QUERY, TABLET_QUERY, tabletFrom } from './tabletTier.js';

/** Below `md` (D717, #1854): the Templates tab's phone rule. Every other caller keeps PHONE_QUERY. */
export { BELOW_MD_QUERY };

const matches = (query) => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia(query).matches;

export function usePhoneWidth(query = PHONE_QUERY) {
  const [phone, setPhone] = useState(() => (query === PHONE_QUERY ? isPhoneWidth() : matches(query)));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return phone;
}

/**
 * D4846 part 2 (#6032, BD14 B): `true` in the tablet tier (768px to 1023px,
 * `tabletTier.js`), and only while `enabled`: a cycle with a tablet layout
 * passes it, and the others read no further width here at all.
 */
export function useTabletWidth(enabled = true) {
  const [tablet, setTablet] = useState(() => (enabled ? tabletFrom(matches) : false));
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setTablet(false);
      return undefined;
    }
    const lists = [window.matchMedia(TABLET_QUERY), window.matchMedia(BELOW_MD_QUERY)];
    const update = () => setTablet(tabletFrom(matches));
    update();
    lists.forEach((m) => m.addEventListener?.('change', update));
    return () => lists.forEach((m) => m.removeEventListener?.('change', update));
  }, [enabled]);
  return tablet;
}
