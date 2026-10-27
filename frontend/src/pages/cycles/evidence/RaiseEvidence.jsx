/**
 * D1261 (#2430) — the founder's Evidence view at `/raise/evidence` (VR1), in the
 * Raise shell with Evidence lit after Overview, and the item and claim drawers
 * at `/raise/evidence/item/:id` and `/raise/evidence/claim/:id` (VR2, VR3) as
 * addresses. `EvidenceSummary` is the investor block (VR8, VR9), placed by the
 * deal page's Evidence tab; it waits for part 7.
 *
 * D1266 (#3289): the view reads `GET /api/cycles/raise/evidence` (parts 2 and 3)
 * and draws it through `EvidenceView.jsx`; Waiting for review (VR4) is
 * `/raise/evidence/review` and See as an investor (VR11) `/raise/evidence/preview`.
 * Look again is the Worker's refresh. A change reads the page again.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { WorkerRail } from '../../../ui';
import RailFrame from '../../../ui/RailFrame';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { CycleHeader } from '../CycleOverview';
import { useProject } from '../CycleRoute';
import { MODULES } from '../modules';
import { NOT_YET, PAGE_LINE, TITLE, WAITS, viewOf } from './evidenceModel';
import { viewModel } from './evidenceView';
import { BTN_S } from './EvidenceParts';
import { EvidenceError, EvidenceForbidden, EvidenceLoading, EvidenceMain } from './EvidenceView';
import { ClaimDrawer, ItemDrawer } from './EvidenceDrawers';
import { InvestorPreview, ReviewQueue } from './EvidenceReview';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
/** The read's page: the first 100 of each list. */
export const PAGE = Object.freeze({ limit: 100 });

export function EvidenceWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`evidence-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

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

/** One read of the venture's evidence; `reload({ refresh })` is Look again. */
export function useEvidence(projectId) {
  const [state, setState] = useState({ status: 'loading' });
  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!projectId) return;
    setState((s) => (s.read ? { ...s, busy: true } : { status: 'loading' }));
    try {
      const read = refresh ? await raiseEvidenceApi.refresh(projectId, PAGE) : await raiseEvidenceApi.read(projectId, PAGE);
      setState({ status: 'ready', read });
    } catch (e) {
      setState(e?.status === 403 ? { status: 'forbidden' } : { status: 'error', message: e?.message || '' });
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  return { state, reload: load };
}

export default function RaiseEvidence() {
  const { pathname, search } = useLocation();
  const view = viewOf(pathname);
  const { projectId, status } = useProject();
  const { state, reload } = useEvidence(projectId);
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
/** VR8, VR9: what an investor sees on the deal page's Evidence tab. */
export function EvidenceSummary() {
  return (
    <section className={box} data-testid="evidence-summary">
      <h2 className="m-0 text-[15px] font-bold">Evidence</h2>
      <p className="m-0 text-[13px]">Before an NDA you see coverage only: each kind of evidence, how many, its source and its newest date. After it, the items the founder shared, each with its source, strength and date.</p>
      <EvidenceWait id="investor" />
    </section>
  );
}
