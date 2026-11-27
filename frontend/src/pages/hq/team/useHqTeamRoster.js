/**
 * D5044 (#5044) — HQ Team's one supervision read: the roster and each branch's answer, race-safe.
 *
 * `GET /api/admin/hq/admins` is the expensive read on this page (administrators, licence bindings,
 * the compliance ladder, holder state, the deployment registry and branch state). This hook is the
 * ONLY place the page makes it: the holder console reads its own transfer candidates
 * (`superAdminCandidatesApi`) instead, so the page's first load asks for it once.
 *
 * `q` is what HQ ASKS THE BRANCHES, never a filter on the roster (D138); the roster is complete and
 * the caller narrows it in the browser. `viewAs` reads one branch instead, and HQ's own roster is
 * not read at all (D153).
 *
 * D5042 — WHICH ANSWER IS ON SCREEN. `answeredFor` is the branch query the committed `data` was
 * read for; `pending` is a read in flight. Each read takes a generation number and only the NEWEST
 * may commit, success or failure, so a slow answer for "gu" never lands after a faster one for
 * "gui". The 250ms debounce `AdminPage` already uses keeps each keystroke from asking every branch;
 * WHAT is asked is the shared policy (`../teamSearchPolicy.js`).
 *
 * `reloadKey` is the page's explicit invalidation (`teamInvalidation.js`): a change elsewhere on the
 * page that this roster shows bumps it, and the roster is read again. No full-page reload.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { branchQueryFor } from '../teamSearchPolicy';

export function useHqTeamRoster({ reloadKey = 0, viewAs = null } = {}) {
  const [data, setData] = useState(undefined); // undefined = loading, null = unreadable
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');
  const [answeredFor, setAnsweredFor] = useState('');
  const [pending, setPending] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setAsked(branchQueryFor(typed)), 250);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setError(null);
    setPending(true);
    try {
      const res = await api.hqAdmins(asked, viewAs || undefined);
      if (generation.current !== mine) return;
      setData(res && typeof res === 'object' ? res : null);
      setAnsweredFor(asked);
    } catch (e) {
      if (generation.current !== mine) return;
      reportError('HqTeamTable:load', e);
      setData(null);
      setError(String(e?.message || e || 'Request failed'));
    } finally {
      if (generation.current === mine) setPending(false);
    }
  }, [asked, viewAs]);

  useEffect(() => { load(); }, [load, reloadKey]);

  return { data, error, typed, setTyped, asked, answeredFor, pending, load };
}
