// Execution console — REAL documents, INTENDED signatories, disabled finalize.
//
// Three things the design showed that do not exist and are therefore not here:
//   1. A document version ("v1.3"). The documents table has no version column,
//      so this shows "Draft N" derived from how many drafts exist.
//   2. Per-signer "Signed / Awaiting signature" pills. There is exactly one
//      signed_by/signed_at per DOCUMENT — no per-person signature record for
//      this template exists anywhere. The signatory rows carry no status.
//   3. "Send for signature" / "Fully executed". api.js has no method to sign a
//      documents row; the finalize control is permanently disabled with the
//      reason in its title.
import React from 'react';
import { Link } from 'react-router-dom';
import { ScrollText, Plus, ExternalLink, Lock } from 'lucide-react';
import StatusPill from './StatusPill';

export default function ExecutionConsole({ execution, canEdit, showBuilder, onNewVersion }) {
  const ex = execution || {};
  const documents = Array.isArray(ex.documents) ? ex.documents : [];
  const signatories = Array.isArray(ex.signatories) ? ex.signatories : [];

  return (
    <div id="exec-console" data-testid="card-execution">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Execution console</div>
          {/* The design's subtitle carried the version AND the reason finalize
              is gated. The gate here is real but EXTERNAL — no in-app
              signature gate exists — so it says exactly that. */}
          <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5 max-w-md leading-snug">
            {ex.subtitle || ex.versionLabel}
          </div>
        </div>
        <StatusPill tone={ex.readyTone} label={ex.readyLabel} />
      </div>

      {/* Real documents with their real status */}
      <div className="space-y-2" data-testid="card-existing">
        {documents.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="exec-no-docs">
            No agreement has been generated for this startup yet.
          </p>
        ) : documents.map((doc, i) => (
          <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`doc-${i}`}>
            <ScrollText size={14} className="text-gray-400 dark:text-gray-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50 truncate">{doc.title}</div>
              <div className="text-[10.5px] text-gray-400 dark:text-gray-500">
                {doc.draftLabel} · {doc.createdLabel}{doc.signedByLabel ? ` · ${doc.signedByLabel}` : ''}
              </div>
            </div>
            <StatusPill tone={doc.tone} label={doc.statusLabel} size="xs" />
            <span className="sr-only" data-testid={`doc-status-${i}`}>{doc.statusLabel}</span>
          </div>
        ))}
      </div>

      {!showBuilder && canEdit && (
        <button type="button" onClick={onNewVersion} data-testid="button-new-version" className="mt-3 text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1">
          <Plus size={11} /> Draft a new version
        </button>
      )}

      {/* Intended signatories — NO per-signer status; none exists. */}
      <div className="mt-5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
          Intended signatories
        </div>
        {signatories.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="exec-no-signers">
            No founders named yet — the signature blocks are built from the founders in the Equity split clause.
          </p>
        ) : (
          <div className="space-y-2">
            {signatories.map((sg, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-3 py-2.5" data-testid={`signatory-${i}`}>
                <span className={`w-8 h-8 rounded-lg text-white text-[11px] font-bold flex items-center justify-center shrink-0 ${sg.avatarTone}`}>
                  {sg.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 truncate">{sg.name}</div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {sg.role}{sg.email ? ` · ${sg.email}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 leading-snug">{ex.signatoryNote}</p>
      </div>

      <button
        type="button"
        disabled
        title={ex.disabledReason}
        data-testid="button-finalize"
        className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[12.5px] font-bold py-3 cursor-not-allowed"
      >
        <Lock size={12} /> {ex.finalizeLabel}
      </button>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 text-center leading-snug">{ex.disabledReason}</p>

      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-4">
        <Link to="/legal-capital" className="text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1" data-testid="link-legal-capital">
          Open Legal &amp; Capital <ExternalLink size={10} />
        </Link>
        <Link to="/compliance" className="text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1" data-testid="link-compliance">
          Compliance <ExternalLink size={10} />
        </Link>
      </div>
    </div>
  );
}
