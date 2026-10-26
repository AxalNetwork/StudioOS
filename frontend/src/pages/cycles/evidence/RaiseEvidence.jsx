/**
 * D1261 (#2430) — the founder's Evidence view at `/raise/evidence` (VR1), in the
 * Raise shell with Evidence lit after Overview, and the item and claim drawers
 * at `/raise/evidence/item/:id` and `/raise/evidence/claim/:id` (VR2, VR3) as
 * addresses. Every block waits for its part: nothing is counted as zero.
 * `EvidenceSummary` is the investor block (VR8, VR9), placed by the deal page's
 * Evidence tab.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { WorkerRail } from '../../../ui';
import RailFrame from '../../../ui/RailFrame';
import { CycleHeader } from '../CycleOverview';
import { MODULES } from '../modules';
import { AREAS, BASE, NOT_YET, PAGE_LINE, SOURCES, TITLE, WAITS, viewOf } from './evidenceModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export function EvidenceWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`evidence-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

/** VR2, VR3: a drawer named by the address. */
export function EvidenceDrawer({ drawer, search = '' }) {
  if (!drawer) return null;
  return (
    <aside role="dialog" aria-label={drawer === 'item' ? 'Evidence item' : 'Claim'} className={box} data-testid={`evidence-drawer-${drawer}`}>
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-bold">{drawer === 'item' ? 'Evidence item' : 'Claim'}</h2>
        <Link to={`${BASE}${search}`} className="text-[13px] font-semibold underline">Close</Link>
      </div>
      <EvidenceWait id={drawer} />
    </aside>
  );
}

export function EvidenceBody({ drawer = null, search = '' }) {
  return (
    <div className="flex flex-col gap-4" data-testid="raise-evidence">
      <EvidenceDrawer drawer={drawer} search={search} />
      <section className={box}>
        <h2 className="m-0 text-[15px] font-bold">Claims by area</h2>
        <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800" data-testid="evidence-areas">
          {AREAS.map((a) => <li key={a} className="flex justify-between py-1.5 text-[13.5px]"><span className="font-semibold">{a}</span><span className="text-[12px] text-axal-muted">{NOT_YET}</span></li>)}
        </ul>
        <EvidenceWait id="claims" />
      </section>
      <section className={box}><h2 className="m-0 text-[15px] font-bold">Waiting for your review</h2><EvidenceWait id="proposals" /></section>
      <section className={box}>
        <h2 className="m-0 text-[15px] font-bold">Coverage</h2>
        <p className="m-0 text-[12.5px] text-axal-muted">Sources: {SOURCES.map((s) => s.label).join(' · ')}. A Typed figure is the founder’s figure, never Backed.</p>
        <EvidenceWait id="coverage" />
      </section>
      <section className={box}><h2 className="m-0 text-[15px] font-bold">Investor opens</h2><EvidenceWait id="opens" /></section>
    </div>
  );
}

export default function RaiseEvidence() {
  const { pathname, search } = useLocation();
  const { drawer } = viewOf(pathname);
  const cards = MODULES.raise.map((m) => ({ slug: m.slug, name: m.name }));
  const rail = <WorkerRail workspace="Raise" role="founder" stance="Evidence-led view" coverage={['Evidence pack: not read here yet']} footer="Traceable surface · no unsupported automated actions" />;
  return (
    <RailFrame rail={rail} data-testid="raise-evidence-route">
      <main className="space-y-4 p-5 text-axal-ink dark:text-gray-100">
        <CycleHeader cycle="raise" cards={cards} active="evidence" title={TITLE} sub={PAGE_LINE} search={search} />
        <EvidenceBody drawer={drawer} search={search} />
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
