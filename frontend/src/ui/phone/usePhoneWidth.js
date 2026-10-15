import { useEffect, useState } from 'react';
import { PHONE_QUERY, isPhoneWidth } from '../../workspaces/lens.jsx';

export function usePhoneWidth() {
  const [phone, setPhone] = useState(isPhoneWidth);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return phone;
}
