import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill } from '../../ui';
import { api } from '../../lib/api';
import {
  NothingYet, StatedLimit, ZoneBody, ZoneHeading, buttonClass, inputClass,
} from '../advisor/expertise/kit';

/**
 * Research · Ask — answers drawn only from your own library, or no answer.
 *
 * `No source` IS THE FEATURE, not a failure state. An Ask box wired to a
 * library with nothing relevant in it will still answer if you let it — from
 * the model's general knowledge, in exactly the voice a cited answer uses.
 * That is the single worst thing a research surface can do, and it is why
 * decisions D9/D12 withdrew four tabs that rendered fixtures. So the worker
 * retrieves first, and only calls the model when there is something to quote.
 * When nothing clears the floor, this page says so and shows what the closest
 * match actually scored, rather than dressing up a guess.
 *
 * THREE OUTCOMES, AND THEY ARE NOT THE SAME:
 *   · answered — with the passages the answer drew on, listed under it.
 *   · no_source — the library was searched and nothing was close enough.
 *     Distinguished on screen between "your library is empty" and "your
 *     library has nothing on this", because the reader's next action differs.
 *   · model_unavailable — retrieval worked and the model did not. Reporting
 *     that as no_source would blame the library and send someone off to
 *     upload a document that would not have helped.
 */
export default function AskZone() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [lib, setLib] = useState({ loading: true, error: '', payload: null });

  const loadLib = useCallback(async () => {
    setLib((c) => ({ ...c, loading: true, error: '' }));
    try {
      setLib({ loading: false, error: '', payload: await api.research.documents() });
    } catch (e) {
      setLib({ loading: false, error: e?.message || 'Your library could not be read.', payload: null });
    }
  }, []);
  useEffect(() => { loadLib(); }, [loadLib]);

  const ask = async (e) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setBusy(true); setError(''); setResult(null);
    try {
      setResult(await api.research.ask(q));
    } catch (err) {
      setError(err?.message || 'That question could not be answered right now.');
    } finally { setBusy(false); }
  };

  const payload = lib.payload;
  const indexed = payload?.indexed ?? 0;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Ask your library"
        blurb="Answers drawn only from documents you have added, with the passage each answer used."
        action={payload ? (
          <Pill tone={indexed > 0 ? 'ok' : 'warn'}>
            {indexed} document{indexed === 1 ? '' : 's'} answerable
          </Pill>
        ) : null}
      />

      <ZoneBody
        loading={lib.loading}
        error={lib.error}
        onRetry={loadLib}
        isEmpty={!lib.loading && !lib.error && indexed === 0}
        empty={(
          <NothingYet
            title="Nothing to ask yet"
            body="Ask answers only from your own documents, so it needs at least one that has been read. Add a document to the library and it becomes answerable here."
            action={(
              <p className="text-[12px]">
                <Link to="/research/library" className="text-axal-violet underline">Open your library →</Link>
              </p>
            )}
          />
        )}
      >
        <Card className="p-4">
          <form onSubmit={ask}>
            <textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className={inputClass}
              placeholder="What do my documents say about…"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="submit" className={buttonClass} disabled={busy || !question.trim()}>
                {busy ? 'Reading your library…' : 'Ask'}
              </button>
              {error && <span className="text-[12px] text-axal-ink-2">{error}</span>}
            </div>
          </form>
        </Card>

        {result?.reason === 'answered' && (
          <Card className="p-4">
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
              Answer
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{result.answer}</p>
            <div className="mt-3 border-t border-axal-border-soft pt-3">
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Drawn from
              </div>
              <ul className="mt-1.5 space-y-1">
                {(result.citations || []).map((ct) => (
                  <li key={`${ct.title}-${ct.chunk}`} className="text-[11.5px] text-axal-ink-2">
                    [{ct.n}] {ct.title}
                    {ct.chunk != null && <span className="text-axal-ink-3"> · passage {ct.chunk + 1}</span>}
                    <span className="text-axal-ink-3"> · match {ct.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {result?.reason === 'no_source' && (
          <Card className="border-dashed bg-axal-surface-2 p-4">
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
              No source
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
              {result.indexed_documents === 0
                ? 'Nothing in your library has been read yet, so there is nothing to answer from.'
                : 'Your library was searched and nothing in it was close enough to answer this.'}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
              {/* The number, not a verdict on it. A reader can see how near it
                  came and decide whether to rephrase or add a document. */}
              {result.best_score != null
                ? `The closest passage scored ${result.best_score}, under the ${result.score_floor} needed to cite it.`
                : 'No passage matched at all.'}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
              This page will not answer from general knowledge. An answer with no source
              behind it reads exactly like one with a source, which is why it is refused
              rather than guessed.
            </p>
          </Card>
        )}

        {result?.reason === 'model_unavailable' && (
          <Card className="border-dashed bg-axal-surface-2 p-4">
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
              Could not write the answer
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
              Your library does have relevant passages — they are listed below — but the
              model that turns them into an answer did not respond. This is not a gap in
              your documents, and adding more will not help. Try again shortly.
            </p>
            <ul className="mt-2 space-y-1">
              {(result.citations || []).map((ct) => (
                <li key={`${ct.title}-${ct.chunk}`} className="text-[11.5px] text-axal-ink-2">
                  {ct.title}
                  {ct.chunk != null && <span className="text-axal-ink-3"> · passage {ct.chunk + 1}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </ZoneBody>

      <StatedLimit title="What Ask will not do">
        <p>
          It answers only from documents you have added and that have been read. It does
          not search the web, company databases or market data — those need a licensed
          source the product does not have, which is why the Companies, AI research and
          News tabs were withdrawn rather than filled with placeholder data.
        </p>
        <p>
          A document that shows as not answerable in your library is invisible here, however
          relevant it looks on the shelf.
        </p>
      </StatedLimit>
    </div>
  );
}
