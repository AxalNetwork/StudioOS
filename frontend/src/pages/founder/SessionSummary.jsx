import React from 'react';
import { spanLabel } from './InterviewReview';
import { citeTarget } from './interviewReviewModel';

/**
 * The session summary at the top of the review (D685 §5.10, #1589): StudioOS's
 * own, written by the processing job from the final transcript (#1605), never
 * an assistant's `submitted_summary`. Each sentence links to the passages it
 * cites and the model is named. With no summary it reads "Not recorded"; with
 * a transcript and no summary (the rail's Manual mode, or a refusal) it offers
 * Summarise, which the Worker prices and may refuse in its own words.
 */
export default function SessionSummary({ summary, segments = [], canSummarise = false, busy = false, error = null, onSummarise }) {
  const sentences = Array.isArray(summary?.sentences) ? summary.sentences.filter((s) => s && s.text) : [];
  return (
    <section className="rounded-2xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-950" data-testid="session-summary" aria-labelledby="session-summary-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="session-summary-title" className="m-0 text-[15px] font-bold text-axal-ink dark:text-gray-100">Summary</h2>
        {summary && <span className="text-[11.5px] text-axal-faint dark:text-gray-400" data-testid="summary-model">Written by {summary.model || 'a model not recorded'}{summary.summarised_at ? ` · ${String(summary.summarised_at).slice(0, 16)}` : ''}</span>}
      </div>
      {sentences.length === 0 ? (
        <p className="mt-2 text-[13px] text-axal-muted dark:text-gray-400" data-testid="summary-none">Not recorded</p>
      ) : (
        <ol className="mt-2 space-y-1.5 text-[13.5px] text-gray-800 dark:text-gray-200">
          {sentences.map((s, i) => (
            <li key={i} data-testid="summary-sentence">
              {s.text}{' '}
              {(Array.isArray(s.cites) ? s.cites : []).map((c, j) => {
                const target = citeTarget(segments, c);
                const label = spanLabel(c.from, c.to);
                return target
                  ? <a key={j} href={`#${target}`} title={c.quote || undefined} data-testid="summary-cite" className="mr-1 text-[11.5px] font-semibold text-violet-700 underline dark:text-violet-300">{label}</a>
                  : <span key={j} title={c.quote || undefined} data-testid="summary-cite-text" className="mr-1 text-[11.5px] text-axal-faint dark:text-gray-400">{label}</span>;
              })}
            </li>
          ))}
        </ol>
      )}
      {!summary && canSummarise && (
        <button type="button" onClick={onSummarise} disabled={busy} data-testid="button-summarise"
          className="mt-3 rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-violet-800 disabled:opacity-50">{busy ? 'Summarising…' : 'Summarise'}</button>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="summary-error">{error}</p>}
    </section>
  );
}
