import { useEffect, useState } from 'react';
import { isChoiceSettled, subscribeChoiceSettled } from '../lib/cookieConsent.js';

/**
 * #9201 — true once a cookie choice is stored and the cookie chooser (banner
 * or preferences dialog) is closed; false while the visitor still has to
 * choose. A surface that would cover the chooser (the product tour) waits on
 * it. Re-reads on every consent change, chooser change and cross-tab write.
 */
export default function useCookieChoiceSettled() {
  const [settled, setSettled] = useState(isChoiceSettled);
  useEffect(() => {
    setSettled(isChoiceSettled());
    return subscribeChoiceSettled(setSettled);
  }, []);
  return settled;
}
