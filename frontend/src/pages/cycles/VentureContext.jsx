import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { resolveVenture } from './ventureQuery.js';

/**
 * D5074 (#5074) — the canonical venture context a cycle page's tools read.
 * `CycleRoute` resolves the venture's id from the address (`useProject`, the
 * one place the query is parsed) and provides it here; a tool calls
 * `useVenture()` for `{ projectId, projectUid, project, company, status }`
 * and never reads `?project_id=`, `?project=` or the projects list itself.
 *
 * The record (and so the UID) is looked up from `GET /api/projects` only once
 * a tool asks for it, so a page whose tools need only the id makes no extra
 * read. `status` is the record's: `loading`, `ready`, `missing` (the venture is
 * not in the caller's list, which a tool answers as a refusal), `unreadable`
 * (the list failed: never an empty venture), or `none` (no venture yet).
 * `retry()` reads the list again.
 */

const Ctx = createContext(null);

/** The record for `projectId`, looked up when `enabled`; `load` is the list read (a test seam). */
function useVentureRecord(projectId, enabled, reloadKey = 0, load = () => api.listProjects()) {
  const [tick, setTick] = useState(0);
  const [rec, setRec] = useState({ key: null, status: 'loading', venture: null });
  const id = projectId == null ? null : Number(projectId) || null;
  useEffect(() => {
    if (!enabled || !id) return undefined;
    let alive = true;
    // A re-read for the same venture keeps its record until the new one lands; another venture's never is.
    setRec((r) => (r.key === id && r.status === 'ready' ? r : { key: id, status: 'loading', venture: null }));
    Promise.resolve().then(load)
      .then((list) => { if (alive) { const venture = resolveVenture(list, { id }); setRec({ key: id, status: venture ? 'ready' : 'missing', venture }); } })
      .catch(() => { if (alive) setRec({ key: id, status: 'unreadable', venture: null }); });
    return () => { alive = false; };
  }, [enabled, id, reloadKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- `load` is a test seam, not a trigger
  const retry = useCallback(() => setTick((n) => n + 1), []);
  if (!id) return { status: 'none', venture: null, retry };
  return rec.key === id ? { ...rec, retry } : { status: 'loading', venture: null, retry };
}

const shape = (projectId, projectStatus, rec) => ({
  projectId: projectId == null ? null : Number(projectId) || null,
  projectStatus,
  projectUid: rec.venture?.projectUid ?? null,
  project: rec.venture?.project ?? null,
  company: rec.venture?.company ?? null,
  status: rec.status,
  retry: rec.retry,
});

/** Provided once by `CycleRoute` around its page, with the venture `useProject` resolved. */
export function VentureProvider({ projectId, status = 'ready', reloadKey = 0, load, children }) {
  const [wanted, setWanted] = useState(false);
  const rec = useVentureRecord(projectId, wanted, reloadKey, load);
  const want = useCallback(() => setWanted(true), []);
  const value = useMemo(() => ({ ...shape(projectId, status, rec), want }), [projectId, status, rec.status, rec.venture, rec.retry, want]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The venture context. Under `VentureProvider` it is the page's; mounted on
 * its own (a test, a sheet outside a cycle page) it resolves `projectId`
 * itself, by the same lookup, so a tool has one way to ask either way.
 */
export function useVenture(projectId = null) {
  const ctx = useContext(Ctx);
  const want = ctx?.want;
  useEffect(() => { if (want) want(); }, [want]);
  const own = useVentureRecord(ctx ? null : projectId, !ctx);
  if (ctx) return ctx;
  return shape(projectId, projectId ? 'ready' : 'loading', own);
}
