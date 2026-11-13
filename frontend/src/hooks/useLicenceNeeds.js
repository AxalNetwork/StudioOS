import { useEffect, useState } from 'react';
import { licenceAccountApi } from '../lib/api/licenceAccount';
import { reportError } from '../lib/log';

/**
 * D800 (#2233) — what needs the licence's Administrator (D798's
 * `/api/licence/mine/needs`), read once and shared by the Licences row's count
 * pill (`ui/SidebarNav.jsx`) and the Summary's "Needs you" card, so the two
 * cannot disagree for a beat.
 *
 * `undefined` while reading, `null` when nothing was read (a 404 is "you
 * administer no licence"; any other failure is reported), else the payload.
 * Nothing is stored: `refreshLicenceNeeds()` reads again, which the page calls
 * after an answer changes what waits.
 */
let pending = null;
let latest;
const listeners = new Set();

function read() {
  if (!pending) {
    pending = licenceAccountApi.needs().then(
      (d) => d,
      (e) => {
        if (e?.status !== 404) reportError('licence-needs', e);
        return null;
      },
    ).then((v) => {
      latest = v;
      for (const l of listeners) l(v);
      return v;
    });
  }
  return pending;
}

/** Read the needs again, and tell every reader. */
export function refreshLicenceNeeds() {
  pending = null;
  return read();
}

/** @param {boolean} enabled read only where the Licences row or the page is drawn */
export default function useLicenceNeeds(enabled = true) {
  const [value, setValue] = useState(latest);
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(setValue);
    read().then(setValue);
    return () => { listeners.delete(setValue); };
  }, [enabled]);
  return enabled ? value : undefined;
}
