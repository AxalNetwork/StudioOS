/**
 * D1261 (#2430) — the founder's Evidence view at `/raise/evidence` (VR1), in the
 * Raise shell with Evidence lit after Overview, and the item and claim drawers
 * at `/raise/evidence/item/:id` and `/raise/evidence/claim/:id` (VR2, VR3) as
 * addresses.
 *
 * D1266 (#3289): the view reads `GET /api/cycles/raise/evidence` (parts 2 and 3)
 * and draws it through `EvidenceView.jsx`; Waiting for review (VR4) is
 * `/raise/evidence/review` and See as an investor (VR11) `/raise/evidence/preview`.
 * Look again is the Worker's refresh. A change reads the page again.
 *
 * The investor block (VR8–VR10) is `InvestorEvidence.jsx` (D1268), placed by
 * the deal page's Evidence tab, an investor's round call and the diligence room.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { WorkerRail } from '../../../ui';
import RailFrame from '../../../ui/RailFrame';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { CycleHeader } from '../CycleOverview';
import { useProject } from '../CycleRoute';
import { MODULES } from '../modules';
import { PAGE_LINE, TITLE, viewOf } from './evidenceModel';
import { viewModel } from './evidenceView';
import { BTN_S } from './EvidenceParts';
import { EvidenceError, EvidenceForbidden, EvidenceLoading, EvidenceMain } from './EvidenceView';
import { ClaimDrawer, ItemDrawer } from './EvidenceDrawers';
import { InvestorPreview, ReviewQueue } from './EvidenceReview';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';

/** The read's page: the first 100 of each list. */
export const PAGE = Object.freeze({ limit: 100 });

/**
 * The whole page from one read's state: loading, refused, failed, or the read
 * with the page and drawer the address names. Pure in its inputs, so the test
 * renders every state.
 */
export function EvidenceBody({ state, view, search = '', projectId, reload }) {
  const read = state?.read;
  const model = useMemo(() => viewModel(read), [read]);
  if (!state || state.status === 'loading') return <EvidenceLoading />;
  if (state.status === 'forbidden') return <EvidenceForbidden />;
  if (state.status === 'error') return <EvidenceError message={state.message} onRetry={() => reload?.()} />;
  if (view.page === 'review') return <ReviewQueue model={model} read={read} search={search} projectId={projectId} onChanged={() => reload?.()} />;
  if (view.page === 'preview') return model.canDecide ? <InvestorPreview projectId={projectId} search={search} /> : <EvidenceForbidden />;
  const changed = () => reload?.();
  return (
    <>
      <EvidenceMain model={model} read={read} search={search} projectId={projectId} onChanged={changed} onRetry={() => reload?.({ refresh: model.canDecide })} />
      {view.drawer === 'claim' ? <ClaimDrawer id={view.id} model={model} search={search} projectId={projectId} onChanged={changed} /> : null}
      {view.drawer === 'item' ? <ItemDrawer id={view.id} model={model} search={search} projectId={projectId} onChanged={changed} /> : null}
    </>
  );
}

/**
 * One read of the venture's evidence; `reload({ refresh })` is Look again.
 *
 * D5073: a read belongs to the venture that started it. Every read takes a sequence number, and an answer is
 * applied only if it is still the newest read AND the page is still on the venture that asked. The state names
 * its venture, so switching ventures never draws the old venture's evidence while the new one loads, and a slow
 * answer for venture A that lands after B's can never replace B.
 */
export function useEvidence(projectId) {
  const [state, setState] = useState({ status: 'loading' });
  const seq = useRef(0);
  const current = useRef(projectId);
  current.current = projectId;
  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!projectId) return;
    const mine = seq.current + 1;
    seq.current = mine;
    setState((s) => (s.read && s.projectId === projectId ? { ...s, busy: true } : { status: 'loading', projectId }));
    const live = () => seq.current === mine && current.current === projectId;
    try {
      const read = refresh ? await raiseEvidenceApi.refresh(projectId, PAGE) : await raiseEvidenceApi.read(projectId, PAGE);
      if (live()) setState({ status: 'ready', read, projectId });
    } catch (e) {
      if (live()) setState(e?.status === 403
        ? { status: 'forbidden', projectId }
        : { status: 'error', message: userFacingRaiseError(e, { fallback: '' }), projectId });
    }
  }, [projectId]);
  useEffect(() => { load(); return () => { seq.current += 1; }; }, [load]);
  return { state, reload: load };
}

export default function RaiseEvidence() {
  const { pathname, search } = useLocation();
  const view = viewOf(pathname);
  const { projectId, status } = useProject();
  const { state: read, reload } = useEvidence(projectId);
  // D5073: another venture's answer is never drawn, not even for the frame before the new read starts.
  const state = read.projectId === projectId ? read : { status: 'loading' };
  const cards = MODULES.raise.map((m) => ({ slug: m.slug, name: m.name }));
  const founder = !!state.read?.permissions?.can_decide;
  const rail = <WorkerRail workspace="Raise" role="founder" stance="Evidence-led view" coverage={[state.read ? 'Evidence pack: read from your records' : 'Evidence pack: reading']} footer="Traceable surface · no unsupported automated actions" />;
  const look = founder && view.page === 'view'
    ? <button type="button" className={BTN_S} onClick={() => reload({ refresh: true })} disabled={!!state.busy} data-testid="evidence-look-again">{state.busy ? 'Looking…' : 'Look again'}</button> : null;
  const shown = status === 'none' ? { status: 'error', message: 'There is no venture to read evidence for yet.' } : status === 'unreadable' ? { status: 'error', message: 'Your ventures could not be read.' } : state;
  return (
    <RailFrame rail={rail} data-testid="raise-evidence-route">
      <main className="space-y-4 p-4 text-axal-ink sm:p-5 dark:text-gray-100">
        <CycleHeader cycle="raise" cards={cards} active="evidence" title={view.page === 'review' ? 'Waiting for review' : view.page === 'preview' ? 'See as an investor' : TITLE} sub={PAGE_LINE} search={search} more={look} />
        <EvidenceBody state={shown} view={view} search={search} projectId={projectId} reload={reload} />
      </main>
    </RailFrame>
  );
}
/** VR8–VR10: the investor's block lives in `InvestorEvidence.jsx` (D1268), which imports no `ui` index. */
export { EvidenceSummary } from './InvestorEvidence';
