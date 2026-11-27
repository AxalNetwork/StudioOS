import React, { useState } from 'react';
import { adminStatementActionsApi } from '../../../lib/api/adminStatementActions.js';
import { BTN } from './RevenueStates.jsx';

/** Explicit, dated branch checkout evidence, never inferred from a push (#5039). */
export function PromotionReadback({ licenceUid, period }) {
  const [read, setRead] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (busy) return;
    setBusy(true);
    try { setRead(await adminStatementActionsApi.promotionReadback(licenceUid, period)); }
    catch { setRead({ state: 'unreadable', message: 'Branch checkout could not be read.' }); }
    finally { setBusy(false); }
  };
  return <div className="flex min-w-[160px] flex-col items-start gap-1 text-[13px]" data-testid={`promotion-readback-${licenceUid}`}>
    <span role="status">{busy ? 'Reading branch…' : read?.message || 'Enforcement not checked'}</span>
    {!busy && read?.as_of && <span className="text-[12px]">Snapshot {read.as_of.replace('T', ' ').slice(0, 19)} UTC</span>}
    <button type="button" className={`${BTN} min-h-[44px]`} disabled={busy} onClick={check}>{read ? 'Check branch again' : 'Check branch'}</button>
  </div>;
}
