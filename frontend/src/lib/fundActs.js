/**
 * D714 (#1779) — which fund controls this viewer sees, from the Worker's act
 * table (`GET /api/fund-admin/access`).
 *
 * Only an admin on HQ reads it. A GP of record who is not an admin, and an
 * admin on a branch Worker, keep today's controls and make no read: the act
 * table's admin rows do not apply to them. A failed read also keeps the
 * controls, because the Worker still decides every act — a plain Admin who
 * presses one is refused there.
 *
 * A Super Admin act a plain Admin may not take is drawn as one sentence, such
 * as "A Super Admin issues capital calls.", never as a disabled button that
 * looks broken.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuthSync';
import { fundAdminApi } from './api/fundAdmin.js';
import { branchOfUser } from './shellRole.js';

/** True for an admin on HQ: the only viewer whose controls follow the table. */
export function readsFundActs(user) {
  return String(user?.role ?? '') === 'admin' && !branchOfUser(user);
}

/** The sentence that replaces an act's control, or null to keep the control. */
export function fundActRefusal(access, act) {
  const row = Array.isArray(access?.acts) ? access.acts.find((a) => a?.act === act) : null;
  if (!row || row.allowed) return null;
  return row.sentence || 'Only a Super Admin can do this.';
}

/** The act table for this user, or null when they make no read or it failed. */
export function useFundActsFor(user) {
  const reads = readsFundActs(user);
  const [access, setAccess] = useState(null);
  useEffect(() => {
    if (!reads) { setAccess(null); return undefined; }
    let live = true;
    fundAdminApi.access()
      .then((a) => { if (live) setAccess(a); })
      .catch(() => { if (live) setAccess(null); });
    return () => { live = false; };
  }, [reads]);
  return access;
}

/** The act table for the signed-in viewer. */
export function useFundActs() {
  const { user } = useAuth() || {};
  return useFundActsFor(user);
}

/**
 * An act's control, or the sentence that replaces it for a viewer the table
 * refuses. `children` is the control exactly as the page draws it.
 */
export function FundActControl({ access, act, testId, className, children }) {
  const refused = fundActRefusal(access, act);
  if (!refused) return children;
  return React.createElement('span', { 'data-testid': testId, className }, refused);
}
