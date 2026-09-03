import React from 'react';
import { FileText } from 'lucide-react';
import { LegalPanel } from '../AdminPage';
import { Unrecorded } from '../advisor/expertise/kit';

/**
 * HQ · Contracts — the master template library (canvas X1, "Master template
 * library" zone), which is the Admin Console's Legal panel framed for HQ.
 *
 * WHAT THE CANVAS ADDS AND THIS DOES NOT. A doc-type REGISTRY above the
 * templates — four governance layers, party roles, required fields, overlap
 * detection — and a cross-tenant oversight ledger. Neither has a store: the
 * templates table holds versions, not types, and no contract row names a
 * tenant (UNRESOLVED_ITEMS U1, U3 row 4). The page names both gaps instead of
 * rendering the canvas's registry cards from their sample data.
 */
export default function HqContractsPage() {
  return (
    <div className="space-y-5" data-testid="hq-contracts-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          <FileText size={13} /> HQ · Contracts
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Contracts</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
          The master templates every tenant instantiates from, versioned. Doc-type
          registry: <Unrecorded /> — the platform holds template versions, not a registry of
          what a contract can be. Cross-tenant oversight: <Unrecorded /> — no contract names
          the subsidiary it belongs to.
        </p>
      </header>

      <LegalPanel />
    </div>
  );
}
