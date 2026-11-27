// "Investor-ready report" export modal — shell only. The page owns the
// exportScoringReportPdf() call.
//
// The bullet list describes what the generated PDF actually contains; the
// muted line mirrors the PDF's own footer so the modal never contradicts its
// output (the design's verbatim copy claimed an 8-axis radar, a founder
// profile section and evidence citations the PDF has never produced).

import { AlertTriangle, Check, FileText, Loader2 } from 'lucide-react';
import { EXPORT_NOT_INCLUDED } from '../../lib/scoringViewModel';

// `canGenerate` keeps the button's own contract self-contained: without it the
// component would depend on an invariant enforced two levels up, and a click
// with no snapshot would produce no PDF, no error and no spinner.
export default function ExportReportModal({ open, contents, generating, canGenerate = true, error, onCancel, onGenerate }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-gray-900/40 backdrop-blur-[2px] flex items-center justify-center p-6"
      onClick={onCancel}
      data-testid="export-modal"
    >
      <div
        className="w-full max-w-[440px] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Export investor-ready report"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="w-[38px] h-[38px] flex-none rounded-[10px] bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center">
            <FileText size={17} />
          </span>
          <div className="min-w-0">
            <div className="text-[15.5px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Investor-ready report</div>
            <div className="text-[12px] text-gray-400 dark:text-gray-500">PDF · composite score, radar, evidence, remediation</div>
          </div>
        </div>

        <div className="space-y-2 mb-3">
          {(contents || []).map((c) => (
            <div key={c} className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-300">
              <Check size={14} className="flex-none text-emerald-600 dark:text-emerald-400" /> {c}
            </div>
          ))}
        </div>
        <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-5 leading-relaxed" data-testid="text-export-not-included">
          {EXPORT_NOT_INCLUDED}
        </p>

        {error && (
          <p className="mb-3 text-[12px] text-rose-500 dark:text-rose-400 inline-flex items-center gap-1.5" data-testid="text-export-error">
            <AlertTriangle size={13} /> {error}
          </p>
        )}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            data-testid="button-cancel-export"
            className="flex-1 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || !canGenerate}
            title={canGenerate ? undefined : 'Run a scoring run first'}
            data-testid="button-generate-pdf"
            className="flex-[2] h-10 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5"
          >
            {generating && <Loader2 size={14} className="animate-spin" />} Generate PDF
          </button>
        </div>
      </div>
    </div>
  );
}
