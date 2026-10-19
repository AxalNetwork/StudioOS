import React, { useState } from 'react';
import { spanLabel } from './InterviewReview';
import { citeTarget } from './interviewReviewModel';
import { DIGEST_SECTIONS, digestEdit, digestState, editDraft, engineState, hms, lineFor, sourceBadge, spansOf } from './sessionDigestModel.js';

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

const CARD = 'rounded-2xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-950';
const BTN = 'rounded-md px-3 py-1.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50';
const CHIP = 'rounded-full border border-violet-200 px-2 py-0.5 text-[11px] font-semibold text-violet-800 no-underline hover:bg-violet-50 dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950';

/** "From Zoom", "In person", "Assistant"…: where the conversation came from (D757 §2.12). */
export function SourceBadge({ session }) {
  const text = sourceBadge(session);
  if (!text) return null;
  return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200" data-testid="source-badge">{text}</span>;
}

/**
 * The engine's state (D757 §2.4): a word, then the Worker's own sentence. A
 * refusal for the AI allowance links to Add tokens (D755).
 */
export function EngineLine({ session }) {
  const e = engineState(session);
  if (!e) return null;
  const tone = e.status === 'refused' ? 'text-amber-800 dark:text-amber-300' : e.status === 'skipped' ? 'text-axal-muted dark:text-gray-400' : 'text-gray-800 dark:text-gray-200';
  return (
    <p role="status" aria-live="polite" className={`m-0 text-[13px] ${tone}`} data-testid="engine-state" data-status={e.status}>
      <strong>{e.word}{e.busy ? '…' : ''}</strong>{e.note ? <> · <span data-testid="engine-note">{e.note}</span></> : null}
      {e.addTokens && <>{' '}<a href={e.addTokens} className="font-semibold underline" data-testid="link-engine-add-tokens">Add tokens</a></>}
    </p>
  );
}

/** A cite's chip: the passage's time, linking its line; plain text when the transcript holds none. */
function CiteChip({ cite, spans }) {
  const line = lineFor(spans, cite);
  const label = hms(line?.start_ms) || spanLabel(cite?.from, cite?.to);
  return line
    ? <a href={`#seg-${line.id}`} className={CHIP} data-testid="digest-cite">{label}</a>
    : <span className="text-[11px] text-axal-faint" data-testid="digest-cite-text">{label}</span>;
}

/** One typed section, from the run's suggestions: each item with its state. */
function DigestSection({ title, items }) {
  if (!items?.length) return null;
  return (
    <div data-testid="digest-section">
      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-axal-faint">{title}</h3>
      <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
        {items.map((it) => {
          const p = it.payload || {};
          const text = p.phrase || p.job || p.detail || p.name || p.trigger || p.when || p.signal || 'Not recorded';
          return (
            <li key={it.proposal_id} data-testid={`digest-item-${it.proposal_id}`}>
              {String(text)}
              {it.status && it.status !== 'pending' && <span className="ml-1 text-[11px] text-axal-faint">· {it.status === 'accepted' ? 'Accepted' : 'Discarded'}</span>}
              {it.quote && <span className="ml-1 text-[12px] italic text-gray-600 dark:text-gray-300">“{it.quote}”</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The digest (D757 §2.5): a writer sees the draft, "Draft · written by
 * <model>", with Keep and Edit; anyone else sees a kept digest only. Edit
 * rewords or removes a sentence or a next step, and removes a key quote but
 * never rewrites one.
 */
export function DigestView({ digest, writer = false, segments = [], session = null, busy = false, error = null, onKeep, onEdit }) {
  const [draft, setDraft] = useState(null);
  const [editError, setEditError] = useState(null);
  const view = digestState(digest, { writer });
  if (view.kind === 'none') return null;
  const spans = spansOf(segments);
  const save = () => {
    const edit = digestEdit(digest, draft);
    if (!edit) { setEditError('Keep at least one overview sentence.'); return; }
    setEditError(null);
    Promise.resolve(onEdit?.(edit)).then((ok) => { if (ok !== false) setDraft(null); });
  };
  const set = (list, i, patch) => setDraft((d) => ({ ...d, [list]: d[list].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <section className={CARD} data-testid="digest" data-kind={view.kind} aria-labelledby="digest-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="digest-title" className="m-0 text-[15px] font-bold text-axal-ink dark:text-gray-100">Summary</h2>
        <span className="flex flex-wrap items-center gap-1.5">
          {session && <SourceBadge session={session} />}
          <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold ${view.kind === 'draft' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'}`} data-testid="digest-label">{view.label}</span>
        </span>
      </div>

      {draft ? (
        <div className="mt-3 space-y-3" data-testid="digest-edit">
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase text-axal-faint">Overview</legend>
            {draft.overview.map((o, i) => (
              <div key={o.index} className="flex items-start gap-2">
                <textarea aria-label={`Overview sentence ${i + 1}`} rows={2} value={o.text} disabled={o.removed} onChange={(e) => set('overview', i, { text: e.target.value })} data-testid={`edit-overview-${i}`}
                  className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white p-2 text-[13px] disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                <button type="button" onClick={() => set('overview', i, { removed: !o.removed })} className="text-[12px] font-semibold underline" data-testid={`edit-overview-remove-${i}`}>{o.removed ? 'Restore' : 'Remove'}</button>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase text-axal-faint">Next steps</legend>
            {draft.next_steps.map((n, i) => (
              <div key={n.index} className="flex items-start gap-2">
                <input aria-label={`Next step ${i + 1}`} value={n.text} disabled={n.removed} onChange={(e) => set('next_steps', i, { text: e.target.value })} data-testid={`edit-step-${i}`}
                  className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[13px] disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                <button type="button" onClick={() => set('next_steps', i, { removed: !n.removed })} className="text-[12px] font-semibold underline" data-testid={`edit-step-remove-${i}`}>{n.removed ? 'Restore' : 'Remove'}</button>
              </div>
            ))}
          </fieldset>
          {draft.key_quotes.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-[11px] font-bold uppercase text-axal-faint">Key quotes · remove one, never reword it</legend>
              {draft.key_quotes.map((k, i) => (
                <div key={i} className="flex items-start gap-2 text-[13px]">
                  <span className={`min-w-0 flex-1 italic ${k.removed ? 'line-through opacity-50' : ''}`} data-testid={`edit-quote-${i}`}>“{k.quote}”</span>
                  <button type="button" onClick={() => set('key_quotes', i, { removed: !k.removed })} className="text-[12px] font-semibold underline" data-testid={`edit-quote-remove-${i}`}>{k.removed ? 'Restore' : 'Remove'}</button>
                </div>
              ))}
            </fieldset>
          )}
          {editError && <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="digest-edit-error">{editError}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy} className={`${BTN} bg-violet-700 text-white hover:bg-violet-800`} data-testid="button-digest-save">{busy ? 'Saving…' : 'Save and keep'}</button>
            <button type="button" onClick={() => { setDraft(null); setEditError(null); }} disabled={busy} className={`${BTN} border border-gray-200 dark:border-gray-700`} data-testid="button-digest-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <ol className="m-0 space-y-1.5 pl-5 text-[13.5px] text-gray-800 dark:text-gray-200" data-testid="digest-overview">
            {(digest.overview || []).map((o, i) => (
              <li key={i} data-testid="digest-sentence">{o.text} {o.cite && <CiteChip cite={o.cite} spans={spans} />}</li>
            ))}
          </ol>
          {(digest.key_quotes || []).length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-axal-faint">Key quotes</h3>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {digest.key_quotes.map((k, i) => (
                  <li key={i} className="border-l-2 border-violet-300 pl-2 text-[13px] italic text-gray-700 dark:border-violet-700 dark:text-gray-300" data-testid="digest-quote">
                    “{k.quote}”
                    <span className="ml-1.5 inline-flex flex-wrap gap-1 not-italic">
                      {k.speaker && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200" data-testid="digest-quote-speaker">{k.speaker}</span>}
                      {k.segment_id != null && <a href={`#seg-${k.segment_id}`} className={CHIP} data-testid="digest-quote-time">{hms(k.start_ms) || 'Time not recorded'}</a>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(digest.decisions || []).length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-axal-faint">Decisions</h3>
              <ul className="m-0 list-disc space-y-1 pl-5 text-[13px]">{digest.decisions.map((d, i) => <li key={i} data-testid="digest-decision">{d.text} {d.cite && <CiteChip cite={d.cite} spans={spans} />}</li>)}</ul>
            </div>
          )}
          {(digest.next_steps || []).length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-axal-faint">Next steps</h3>
              <ul className="m-0 list-disc space-y-1 pl-5 text-[13px]">
                {digest.next_steps.map((n, i) => (
                  <li key={i} data-testid="digest-step">{n.text}{n.who ? <span className="ml-1 text-[11.5px] text-axal-faint">· {n.who === 'me' ? 'You' : 'Them'}</span> : null} {n.cite && <CiteChip cite={n.cite} spans={spans} />}</li>
                ))}
              </ul>
            </div>
          )}
          {DIGEST_SECTIONS.map(([key, title]) => <DigestSection key={key} title={title} items={digest.sections?.[key]} />)}
          {view.kind === 'draft' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={onKeep} disabled={busy} className={`${BTN} bg-violet-700 text-white hover:bg-violet-800`} data-testid="button-digest-keep">{busy ? 'Keeping…' : 'Keep'}</button>
              <button type="button" onClick={() => setDraft(editDraft(digest))} disabled={busy} className={`${BTN} border border-gray-200 dark:border-gray-700`} data-testid="button-digest-edit">Edit</button>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="digest-error">{error}</p>}
    </section>
  );
}
