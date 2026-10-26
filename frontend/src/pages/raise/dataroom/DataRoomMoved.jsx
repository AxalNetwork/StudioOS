import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useMovedNotice } from '../../../ui';
import { fireAnalytics } from '../../../lib/seo';
import { redirectKey } from '../../../../../cloudflare-worker/src/services/redirectRoutes.ts';
import { MOVED_FROM, MOVED_NOTICES, movedTarget } from './dataRoomModel';

/**
 * D1109 (#2989, DR24) — the Data room's old addresses land on the tool.
 * `?mode=workspace` lands on Files, `?mode=access` on Access, and a file's
 * number (`/raise/data-room/<id>`, its record page) on its window over Files.
 * The query and the hash are kept, `?moved=` names the notice the tab shows,
 * and each forward counts itself once under its own key (#2319), because the
 * address bar cannot tell these from the tool's own pages.
 */
export function DataRoomMovedRedirect({ kind, id = null, send = fireAnalytics }) {
  const { search, hash } = useLocation();
  const key = MOVED_FROM[kind]?.key || null;
  useEffect(() => { if (key) send(redirectKey(key)); }, [key, send]);
  const to = movedTarget(kind, search, hash, id);
  return to ? <Navigate replace to={to} /> : null;
}

/**
 * The one-line notice under the header of the tab an old address landed on
 * (DR24a Files, DR24b Access). Dismiss drops `moved` and keeps the rest of the address.
 */
export function DataRoomMovedNotice() {
  const notice = useMovedNotice(MOVED_NOTICES);
  if (!notice.text) return null;
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[13px] text-axal-ink dark:border-[#4c3a8a] dark:bg-[#211f3d] dark:text-gray-200" data-testid="dataroom-moved">
      <Info size={15} aria-hidden="true" className="shrink-0 text-axal-violet-deep dark:text-violet-400" />
      <span className="min-w-0 flex-1 leading-[1.45]">{notice.text}</span>
      <button type="button" onClick={notice.dismiss} className="inline-flex min-h-[44px] shrink-0 items-center rounded-[9px] px-2.5 text-[13px] font-bold text-axal-violet-deep sm:min-h-[40px] dark:text-violet-400">Dismiss</button>
    </div>
  );
}
