import { useEffect, useState } from 'react';
import { ddDeskApi } from '../../lib/api/ddDesk';
import { DILIGENCE_ROLES } from '../../sidebarConfig';

/** D6292 (#6292): eligible investors always have a Diligence door, even before
 * their first case or when the list fails. Partners/advisors retain their
 * involvement rule. Cached answers are scoped to the account and role. */
const answered = new Map();
const readOne = () => ddDeskApi.cases({ page_size: 1 });

export function useDiligenceInvolvement(user, role, load = readOne) {
  const id = user?.id ?? null;
  const eligibleInvestor = id != null && role === 'investor';
  const asks = !eligibleInvestor && id != null && DILIGENCE_ROLES.includes(role);
  const key = `${id}:${role}`;
  const [answer, setAnswer] = useState(() => ({ key, yes: asks && answered.has(key) ? answered.get(key) : false }));
  useEffect(() => {
    const record = yes => setAnswer(previous => previous.key === key && previous.yes === yes ? previous : { key, yes });
    if (!asks) { record(false); return undefined; }
    if (answered.has(key)) { record(answered.get(key)); return undefined; }
    let alive = true;
    Promise.resolve().then(load)
      .then((r) => {
        const yes = Number(r?.total) > 0 || (Array.isArray(r?.items) && r.items.length > 0);
        answered.set(key, yes);
        if (alive) record(yes);
      })
      .catch(() => { if (alive) record(false); });
    return () => { alive = false; };
  }, [asks, key, load]);
  return eligibleInvestor || (answer.key === key && answer.yes);
}

/** Tests only: forget what was read. */
export function resetDiligenceInvolvement() { answered.clear(); }
