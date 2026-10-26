import { useEffect, useState } from 'react';
import { ddDeskApi } from '../../lib/api/ddDesk';
import { DILIGENCE_ROLES } from '../../sidebarConfig';

/**
 * D1252 (#3267) — whether the signed-in partner, investor or advisor leads or
 * reviews any diligence case, for the sidebar's "Diligence" row
 * (`withDiligenceRow`). The Worker's list (`GET /api/dd/cases`) holds only the
 * cases the caller opened, leads or reviews, so one case on it is the answer.
 * Read once per account; a failed read draws no row (never a row that leads
 * to a refusal). Any other role makes no read.
 */
const answered = new Map();
const readOne = () => ddDeskApi.cases({ page_size: 1 });

export function useDiligenceInvolvement(user, role, load = readOne) {
  const id = user?.id ?? null;
  const asks = id != null && DILIGENCE_ROLES.includes(role);
  const key = `${id}:${role}`;
  const [involved, setInvolved] = useState(() => (asks && answered.has(key) ? answered.get(key) : false));
  useEffect(() => {
    if (!asks) { setInvolved(false); return undefined; }
    if (answered.has(key)) { setInvolved(answered.get(key)); return undefined; }
    let alive = true;
    Promise.resolve().then(load)
      .then((r) => {
        const yes = Number(r?.total) > 0 || (Array.isArray(r?.items) && r.items.length > 0);
        answered.set(key, yes);
        if (alive) setInvolved(yes);
      })
      .catch(() => { if (alive) setInvolved(false); });
    return () => { alive = false; };
  }, [asks, key, load]);
  return involved;
}

/** Tests only: forget what was read. */
export function resetDiligenceInvolvement() { answered.clear(); }
