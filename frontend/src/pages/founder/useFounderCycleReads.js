/**
 * D4619 (#4619) — one overview read per cycle with a placed module, for the
 * venture the founder Studio reads. Lifted out of `FounderStudioHome.jsx` so a
 * Node test drives the real hook through project changes.
 *
 * ONE KEY FOR THE ANSWER AND THE REQUEST. A cycle's read is kept under the
 * full context it was asked for: the venture's state, its ID and the cycle.
 * The page sees only the answers for the venture it shows now, so a cycle that
 * was read for venture A is never drawn under venture B, and A → B → A asks
 * again for A rather than skipping it.
 *
 * AN ANSWER FOR ANOTHER CONTEXT IS DROPPED. Every request carries a token, and
 * it commits only while it is still the latest request for its key in the
 * current context. A success or a failure that arrives after the venture
 * changed, after a Retry superseded it, or after unmount changes nothing.
 *
 * Each read is undefined while it loads; `{ failed }` when it failed (or the
 * venture could not be read, or is not available to this member);
 * `{ noProject }` when there is no venture.
 */
import { useEffect, useRef, useState } from 'react';
import { cyclesApi } from '../../lib/api/cycles.js';
import { reportError } from '../../lib/log';

/** The context a cycle read belongs to, from the venture read: its state and which venture. */
export function cycleContextOf(project) {
  if (project === undefined) return 'loading:';
  if (project === null) return 'none:';
  if (project.failed) return `failed:${project.unavailable ?? ''}`;
  return `ready:${project.id}`;
}

export function useFounderCycleReads(project, placed) {
  const [reads, setReads] = useState({});
  // key → the token of the one request whose answer may still land.
  const latest = useRef(new Map());
  const context = useRef(null);
  const mounted = useRef(true);
  const [n, setN] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const want = placed.join(',');
  const ctx = cycleContextOf(project);
  const projectId = ctx.startsWith('ready:') ? project.id : null;
  const failure = ctx.startsWith('failed:') ? (project.unavailable ? project.failed : 'The venture could not be read.') : null;
  useEffect(() => {
    if (context.current !== ctx) {
      // A new venture: every request for the old one is now obsolete, and nothing read for it is kept.
      context.current = ctx;
      latest.current = new Map();
      setReads({});
    }
    if (ctx.startsWith('loading:')) return;
    // A read in flight is kept when another cycle is added or retried in the same context.
    for (const cycle of want.split(',').filter(Boolean)) {
      const key = `${ctx}:${cycle}`;
      if (latest.current.has(key)) continue;
      const token = {};
      latest.current.set(key, token);
      const commit = (value) => {
        if (mounted.current && context.current === ctx && latest.current.get(key) === token) setReads((r) => ({ ...r, [key]: value }));
      };
      if (ctx === 'none:') { commit({ noProject: true }); continue; }
      if (failure) { commit({ failed: failure }); continue; }
      Promise.resolve().then(() => cyclesApi.overview(cycle, projectId)).then(
        (d) => commit(d || {}),
        (e) => { reportError(`FounderStudio:cycle:${cycle}`, e); commit({ failed: e?.message || 'Source unavailable' }); },
      );
    }
  }, [want, ctx, projectId, failure, n]);
  const shown = {};
  for (const cycle of placed) shown[cycle] = reads[`${ctx}:${cycle}`];
  const retry = (cycle) => {
    const key = `${ctx}:${cycle}`;
    latest.current.delete(key);
    setReads((r) => { const next = { ...r }; delete next[key]; return next; });
    setN((x) => x + 1);
  };
  return { reads: shown, retry };
}
