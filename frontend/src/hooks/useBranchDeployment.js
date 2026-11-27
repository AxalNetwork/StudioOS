import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { notDeployedStrip } from '../lib/branchNotDeployed';

/**
 * The S21 strip's model for the signed-in administrator, read once per
 * session and shared by the strip and the top bar (D287).
 *
 * ONE READ, TWO READERS. The strip above the top bar and the badge inside it
 * say the same fact — this licence's branch is not deployed — and two fetches
 * of `/api/licence/mine` from two components could disagree for a beat. The
 * pending promise is memoised per user id at module level, so the second
 * caller joins the first read; it is not a store, and nothing here survives
 * a reload (S21: "Stores nothing").
 *
 * WHAT A FAILURE MEANS. A 404 is "administers no licence": no strip, and not
 * an error. Any other failure leaves the model null — the strip is a claim
 * about a licence, and a licence this hook could not read is not one it can
 * make a claim about — and is reported. The deployment sub-read's own
 * failure is different: the worker answers it as `readable: false`, and the
 * strip renders "Unreadable".
 */
const pending = new Map();

function readFor(userId) {
  if (!pending.has(userId)) {
    pending.set(userId, api.myLicence().then(
      (data) => notDeployedStrip(data),
      (e) => {
        if (e?.status === 404) return null;
        reportError('branch-not-deployed:licence', e);
        pending.delete(userId);
        return null;
      },
    ));
  }
  return pending.get(userId);
}

/**
 * @param {boolean} enabled read only on the plain Admin shell off a branch
 * @param {number|string|null|undefined} userId the signed-in account
 * @returns {null|object} `notDeployedStrip`'s model, or null
 */
export default function useBranchDeployment(enabled, userId) {
  const [strip, setStrip] = useState(null);
  useEffect(() => {
    if (!enabled || userId === null || userId === undefined) { setStrip(null); return undefined; }
    let alive = true;
    readFor(userId).then((s) => { if (alive) setStrip(s); });
    return () => { alive = false; };
  }, [enabled, userId]);
  return strip;
}
