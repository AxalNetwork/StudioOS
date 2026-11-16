import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { raiseReadState, userFacingRaiseError } from '../../../lib/raiseErrors.js';

/**
 * D1192 (#3126) — Capital relationships' two Overview reads, the prospects and the commitments, in a small
 * file of their own (D5081 part 2, #5081) so CycleRoute can hold them without loading the tool's step
 * (D4574). `CapRelPipeline.jsx` re-exports `useProspects`; `CapRelOverview.jsx` reads both.
 *
 * D5081 part 2: Overview owns its page, and the module header's primary action (Find investors, Follow up,
 * Add investor: `homeAction` in `capRelModel.js`) is chosen from the same prospects read Overview draws.
 * `useCapRelHome` is that one pair of reads; CycleRoute calls it and hands it to Overview. A null venture
 * makes no read.
 */

/** The prospects (`GET /api/contacts/raise-prospects`): its state, its rows and its retry. */
export function useProspects(projectId) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', items: null, projectId });
  useEffect(() => {
    if (projectId == null) return undefined;
    let alive = true;
    // D5073: a re-read of the SAME venture keeps its investors drawn until the new answer lands; another venture's never are.
    setRead((r) => ({ status: 'loading', items: r.projectId === projectId ? r.items : null, projectId }));
    Promise.resolve().then(() => api.raiseProspects(projectId))
      // D6077: whether the read carried Fit, Source and last contact, and whether round calls are on.
      .then((d) => { if (alive) setRead({ status: 'ready', items: Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [], projectId, signals: typeof d?.signals === 'string' ? d.signals : 'not_read', roundCalls: d?.round_calls === true }); })
      // D5079 (#5079): a refusal is not a failed read. Mapping a 403 to
      // `unreadable` told the founder the pipeline "could not be read", which
      // is a claim about the store rather than about access.
      .catch((error) => { if (alive) setRead({ status: raiseReadState(error), items: null, projectId, message: userFacingRaiseError(error, { fallback: '' }) }); });
    return () => { alive = false; };
  }, [projectId, n]);
  // The frame before the effect runs still holds the previous venture's state: never draw it.
  const own = read.projectId === projectId ? read : { status: 'loading', items: null };
  return { status: own.status, items: own.items, message: own.message ?? '', signals: own.signals ?? 'not_read', roundCalls: own.roundCalls === true, reload: () => setN((x) => x + 1) };
}

/** The round's commitments (D1190, `capitalRelationshipsApi.commitments`): its state, its answer and its retry. */
export function useCommitments(projectId) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null, projectId });
  useEffect(() => {
    if (projectId == null) return undefined;
    let alive = true;
    setRead((current) => ({ status: 'loading', data: current.projectId === projectId ? current.data : null, projectId }));
    Promise.resolve().then(() => capitalRelationshipsApi.commitments(projectId))
      .then((data) => { if (alive) setRead({ status: 'ready', data, projectId }); })
      .catch((error) => { if (alive) setRead({ status: raiseReadState(error), data: null, projectId }); });
    return () => { alive = false; };
  }, [projectId, n]);
  const own = read.projectId === projectId ? read : { status: 'loading', data: null };
  return { ...own, projectId, reload: () => setN((x) => x + 1) };
}

/** D5081 part 2: Overview's two reads, held once by CycleRoute for the header's action and Overview. */
export function useCapRelHome(projectId) {
  const prospects = useProspects(projectId);
  const commitments = useCommitments(projectId);
  return { prospects, commitments };
}
