import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill, Stat } from '../../ui';
import { api } from '../../lib/api';
import {
  NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading, buttonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';

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
/**
 * `zoneActions` is a render prop, called with the citations of the answer on
 * screen. `/research/ask` is one route for four licences and their zone actions
 * differ, so the caller — which knows the role — decides what the row says, and
 * this page renders whatever it is handed. See `workspaces/zoneActionsByRole.js`.
 */
// WHICH LICENCES DRAW THE STAT STRIP, and the rule is not about the licence —
// it is about whether any tile in it is real. Advisor's and partner's artboards
// open with `Indexed documents`, which `api.research.documents()` already
// returns; founder's and investor's four tiles are all downstream of a session
// store that does not exist, so they get one sentence instead of four empty
// tiles. Add a licence here only when its first tile has a source.
const ASK_STRIP_LICENCES = new Set(['advisor', 'partner']);

export default function AskZone({ zoneActions, zoneFilters, role = 'founder' }) {
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
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return (
    <div className="space-y-4">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({}) : []}
          actions={zoneActions(result?.citations || [])}
        />
      )}
      <ZoneHeading
        title="Ask your library"
        blurb="Answers drawn only from documents you have added, with the passage each answer used."
        action={payload ? (
          <Pill tone={indexed > 0 ? 'ok' : 'warn'}>
            {indexed} document{indexed === 1 ? '' : 's'} answerable
          </Pill>
        ) : null}
      />

      {/* THE CANVAS'S STAT STRIP, AND THE ONE PLACE THIS ZONE DOES NOT DRAW IT.
          Every artboard gives a research zone four tiles. Advisor's and
          partner's ask for `Indexed documents`, `Answered`, `No source` and
          `Session spend`; founder's and investor's for `Questions asked`,
          `Answers kept` and two per-question costs.

          On advisor and partner the FIRST tile is real — `api.research.
          documents()` is already loaded above for the empty state — so the
          strip is drawn and the other three say `Not recorded` in words, which
          is the treatment `LibraryZone` established.

          On founder and investor NOT ONE of the four is real: all four are
          downstream of a session store that does not exist. `research.post
          ('/ask')` searches, answers and returns; the only per-question row
          anywhere is `ai_usage_logs`, which holds token counts and no question
          text. Four tiles reading `Not recorded` would say one thing four
          times — the same reason `LibraryZone` omits a column that would be
          `Not recorded` on every row. So those two licences get the sentence
          instead, naming all four labels once. `groupFilterNotes` does exactly
          this in the header row above, for exactly this reason. */}
      {ASK_STRIP_LICENCES.has(role) ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Indexed documents"
            value={payload ? indexed : undefined}
            note={payload ? `of ${items.length} in your library` : 'library not read'}
          />
          <Stat label="Answered" value="Not recorded" mono={false}
            note="no session history is stored, so answers are not counted across questions" />
          <Stat label="No source" value="Not recorded" mono={false}
            note="the same missing history — a refusal is shown once and never tallied" />
          <Stat label="Session spend" value="Not recorded" mono={false}
            note="token counts are logged per call and are never priced back to a question" />
        </div>
      ) : (
        <StatedLimit>
          The canvas puts four figures here — Questions asked, Answers kept,
          First-pass cost and Follow-up cost — and all four count the same
          thing this page does not keep: a session. A question is searched,
          answered and returned; nothing records the question, the answer or
          what you did with it, and the only per-call row anywhere holds token
          counts with no question text. Four tiles reading “Not recorded” would
          state one absence four times, so it is stated once.
        </StatedLimit>
      )}

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

        {/* THE ARTBOARD'S INSTRUMENT CARD, and it is the one part of Ask's
            canvas structure that is fully sourced today. The advisor and
            partner artboards specify `What Ask can reach` with the columns
            `Document / Kind / Added / Index state / In Ask` — every one of
            which is a field `api.research.documents()` already returns and
            this page has already fetched for its empty state. Nothing new is
            called to draw it.

            Founder's and investor's artboards ask for a `Session history`
            table instead — `Question / Drew on / Cost / What you did with it`
            — over rows nothing writes. That one is not drawn, for the reason
            the strip above states once. */}
        {ASK_STRIP_LICENCES.has(role) && items.length > 0 && (
          <Card className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[13px] font-extrabold tracking-tight">What Ask can reach</h3>
              <span className="text-[11px] text-axal-ink-3">Reads over the library and nothing else</span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">
                    <th className="pb-2 pr-3 font-extrabold">Document</th>
                    <th className="pb-2 pr-3 font-extrabold">Kind</th>
                    <th className="pb-2 pr-3 font-extrabold">Added</th>
                    <th className="pb-2 pr-3 font-extrabold">Index state</th>
                    <th className="pb-2 font-extrabold">In Ask</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => (
                    <tr key={d.uid} className="border-t border-axal-border-soft">
                      <td className="py-2 pr-3">{d.title || <Unrecorded>Untitled</Unrecorded>}</td>
                      <td className="py-2 pr-3 capitalize">{d.kind || <Unrecorded>Not recorded</Unrecorded>}</td>
                      {/* `Added`, not the canvas's own column name for this
                          slot. It means when the file arrived here, which is
                          what `created_at` holds — the same relabel
                          `LibraryZone` made for the same reason. */}
                      <td className="py-2 pr-3">
                        {String(d.created_at || '').slice(0, 10) || <Unrecorded>Not recorded</Unrecorded>}
                      </td>
                      <td className="py-2 pr-3">
                        {d.index_state === 'indexed'
                          ? 'Indexed'
                          : <Unrecorded>{d.index_state || 'Not indexed'}</Unrecorded>}
                      </td>
                      {/* The question this zone exists to answer, per row.
                          `index_state`, not `chunk_count`: a document that
                          indexed once and later failed a re-index keeps its old
                          count, and the failure path updates the state and
                          leaves the number alone. */}
                      <td className="py-2">
                        {d.index_state === 'indexed'
                          ? 'Answerable'
                          : <Unrecorded>Not answerable</Unrecorded>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
