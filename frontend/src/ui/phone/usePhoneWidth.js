import { useEffect, useState } from 'react';
import { PHONE_QUERY, isPhoneWidth } from '../../workspaces/lens.jsx';

/** Below `md` (D717, #1854): the Templates tab's phone rule. Every other caller keeps PHONE_QUERY. */
export const BELOW_MD_QUERY = '(max-width: 767px)';

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
