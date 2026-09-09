import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill, Stat } from '../../ui';
import { formatCost, formatRate } from '../../ui/assistCost';
import { api } from '../../lib/api';
import {
  NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading, buttonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, MeteredNote } from '../../workspaces/canvasKit';

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
 *
 * ALL THREE ARE NOW KEPT. Migration 221 stores every exchange, including both
 * failures, which is what turned this page from one answer in React state into
 * the thread its artboard draws. A `no_source` row is not housekeeping: it is
 * precisely what the `Unanswered` chip selects on, and the artboard's own
 * third exchange — a question the cache could not answer, named as a gap and
 * charged nothing — is the composition's point.
 */
/**
 * `zoneActions` and `zoneFilters` are handed down bound. `/research/ask` is one
 * route for four licences and their header rows differ, so the caller — which
 * knows the role — decides what the row says, and this page renders whatever it
 * is handed. See `workspaces/zoneActionsByRole.js`.
 */
const SCOPES = new Set(['session', 'all', 'saved']);

/**
 * The stat strip, per licence, because the four artboards ask for DIFFERENT
 * TILES and always did.
 *
 * `Pages · {Advisor,Partner} Research` open with `Indexed documents`,
 * `Answered`, `No source`, `Session spend`. `Pages · {Founder,Investor}
 * Research` open with `Questions asked`, `Answers kept`, `First-pass cost`,
 * `Follow-up cost`. Drawing one set on all four would be matching one artboard
 * and overwriting three — which is the shape `SignalsPage`'s `MARKETS_STRIP`
 * settled into for the same reason, on the same bucket.
 *
 * WHAT CHANGED, AND WHAT DID NOT. This file used to gate the strip on
 * `ASK_STRIP_LICENCES = new Set(['advisor', 'partner'])` and draw exactly one
 * tile — `Indexed documents` — because every other tile on every artboard was
 * downstream of a session store that did not exist. D56's rule (a tile with no
 * store is not drawn) has not moved an inch; migration 221 built the store, so
 * seven of the eight tiles now have one. A tile whose `value` returns null is
 * still not drawn, and the eighth is exactly that case.
 *
 * `Follow-up cost` IS THE EIGHTH, and it is worth reading before anyone
 * "fixes" it. The artboard's pairing — a full-price first pass and a follow-up
 * at a thirtieth of the rate — is DeepSeek's cached-input billing, which is what
 * the design was drawn against. `research_ask` routes to Workers AI Llama 3.3
 * 70B, and `services/aiRouter.ts` marks this task uncached: no answer this
 * product writes is ever billed as a follow-up. So the tile has no rows to
 * average and is not drawn, and it will start being drawn on its own the day a
 * cached answer is written — not because someone modelled one.
 */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const answeredOf = (rows) => rows.filter((t) => t.reason === 'answered');

const ASK_STRIP = {
  advisor: [
    { label: 'Indexed documents', value: (x) => x.indexed, note: (x) => `of ${x.docs} in your library` },
    { label: 'Answered', value: (x) => `${x.totals.answered} of ${x.totals.asked}`, note: () => 'each with its citations' },
    { label: 'No source', value: (x) => x.totals.no_source, note: () => 'returned empty, charged nothing' },
    { label: 'Session spend', value: (x) => formatCost(x.totals.cost_usd), note: () => 'shown before each question, not only after' },
  ],
  founder: [
    { label: 'Questions asked', value: (x) => x.totals.asked, note: (x) => `${x.totals.no_source} came back with no source` },
    { label: 'Answers kept', value: (x) => x.totals.saved, note: () => 'kept from the ops row, one at a time' },
    {
      label: 'First-pass cost',
      value: (x) => { const m = mean(answeredOf(x.rows).filter((t) => !t.cached).map((t) => t.cost_usd)); return m == null ? null : formatCost(m); },
      note: () => 'mean over this view’s answered questions',
    },
    {
      label: 'Follow-up cost',
      value: (x) => { const m = mean(answeredOf(x.rows).filter((t) => t.cached).map((t) => t.cost_usd)); return m == null ? null : formatCost(m); },
      note: () => 'mean over answers billed from cache',
    },
  ],
};
// One file, one set of tiles per artboard pair: partner reads the same four as
// advisor and investor the same four as founder, because those artboards are
// each other's copies. Aliased rather than duplicated so a change to one cannot
// silently leave the other behind.
ASK_STRIP.partner = ASK_STRIP.advisor;
ASK_STRIP.investor = ASK_STRIP.founder;

/** The four chips, as predicates over whichever slice the scope returned. */
const NARROW = {
  cited: (t) => (t.citations || []).length > 0,
  unanswered: (t) => t.reason !== 'answered',
};

/**
 * A chip is either a SCOPE — a different read — or a NARROWING of the rows that
 * came back. Splitting them this way is what keeps `Cited` one chip rather than
 * two: it means the same thing over a session and over the whole history, and
 * the scope beside it decides which.
 */
const scopeFor = (view) => (SCOPES.has(view) ? view : 'session');

export default function AskZone({ zoneActions, zoneFilters, role = 'founder' }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lib, setLib] = useState({ loading: true, error: '', payload: null });
  const [view, setView] = useState('session');
  const [thread, setThread] = useState({ loading: true, error: '', payload: null });
  const [pricing, setPricing] = useState(null);
  const [savingUid, setSavingUid] = useState('');

  const loadLib = useCallback(async () => {
    setLib((c) => ({ ...c, loading: true, error: '' }));
    try {
      setLib({ loading: false, error: '', payload: await api.research.documents() });
    } catch (e) {
      setLib({ loading: false, error: e?.message || 'Your library could not be read.', payload: null });
    }
  }, []);

  const sessionUid = thread.payload?.session?.uid || '';
  const scope = scopeFor(view);

  const loadThread = useCallback(async (wantScope, keepSession) => {
    setThread((c) => ({ ...c, loading: true, error: '' }));
    try {
      const r = await api.research.askSessions(wantScope, keepSession || undefined);
      setThread({ loading: false, error: '', payload: r });
    } catch (e) {
      setThread({ loading: false, error: e?.message || 'Your session could not be read.', payload: null });
    }
  }, []);

  useEffect(() => { loadLib(); }, [loadLib]);
  // The scope is what changes the READ. A narrowing chip must not refetch —
  // clicking `Cited` on a long history and watching the page reload it is the
  // same round trip twice for a filter that runs on data already in hand.
  useEffect(() => { loadThread(scope, ''); }, [loadThread, scope]);
  useEffect(() => {
    // The published rate, never a typed one. `railModels.js` states the rule and
    // D13/D16 are the decisions: a model's rate is a fact and comes from the
    // router's own table. The artboard quotes a price list for a model this
    // product does not run.
    let live = true;
    api.aiPricing().then((p) => { if (live) setPricing(p); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const ask = async (e) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setBusy(true); setError('');
    try {
      const r = await api.research.ask(q, sessionUid);
      setQuestion('');
      // Back to the session view: a reader who asks a question while looking at
      // `All history` has just added to a thread they cannot see, and leaving
      // them there would make the answer look lost.
      setView('session');
      await loadThread('session', r?.session_uid || '');
    } catch (err) {
      setError(err?.message || 'That question could not be answered right now.');
    } finally { setBusy(false); }
  };

  const newSession = async () => {
    setError('');
    try {
      const r = await api.research.askNewSession();
      setView('session');
      await loadThread('session', r?.session?.uid || '');
    } catch {
      setError('A new session could not be started right now.');
    }
  };

  const toggleSaved = async (item) => {
    setSavingUid(item.uid);
    try {
      await api.research.askSaveAnswer(item.uid, !item.saved);
      await loadThread(scope, sessionUid);
    } catch {
      setError('That answer could not be kept right now.');
    } finally { setSavingUid(''); }
  };

  const payload = lib.payload;
  const indexed = payload?.indexed ?? 0;
  const items = Array.isArray(payload?.items) ? payload.items : [];

  const all = useMemo(() => thread.payload?.items || [], [thread.payload]);
  const visible = useMemo(() => (NARROW[view] ? all.filter(NARROW[view]) : all), [all, view]);
  const totals = thread.payload?.totals || { asked: 0, answered: 0, no_source: 0, cost_usd: 0 };

  // The per-1M rates for the task this page actually runs. `research_ask` is the
  // join key; `routes` names the model and `prices` holds its rate, both from
  // `GET /api/ai/pricing`.
  const askModel = pricing?.routes?.research_ask?.model || '';
  const askPrice = pricing?.prices?.[askModel] || null;

  const strip = ASK_STRIP[role] || [];
  const ready = Boolean(payload && thread.payload);
  const ctx = { indexed, docs: items.length, totals, rows: all };

  const libRows = items.map((d) => ({
    key: d.uid,
    rowClass: d.index_state === 'indexed' ? '' : 'bg-amber-50/40 dark:bg-amber-950/20',
    cells: [
      { text: d.title || '', nr: !d.title },
      { text: d.kind || '', nr: !d.kind },
      // `Added`, not the artboard's own column name for this slot. It means
      // when the file arrived here, which is what `created_at` holds — the same
      // relabel `LibraryZone` made for the same reason.
      { text: String(d.created_at || '').slice(0, 10), nr: !d.created_at },
      d.index_state === 'indexed'
        ? { pill: 'Indexed', pillTone: 'ok' }
        : { pill: d.index_state || 'Not indexed', pillTone: 'warn' },
      // The question this zone exists to answer, per row. `index_state`, not
      // `chunk_count`: a document that indexed once and later failed a re-index
      // keeps its old count, and the failure path updates the state and leaves
      // the number alone.
      d.index_state === 'indexed'
        ? { text: 'Answerable in Ask' }
        : { text: 'Not answerable until indexed' },
    ],
  }));

  return (
    <div className="space-y-4">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({ value: view, onChange: setView }) : []}
          actions={zoneActions(visible, { newSession, savedAnswers: () => setView('saved') })}
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

      {/* THE METERED BANNER. The artboard's argument for it is the one this
          product should be making: "this surface spends money, and a founder
          deciding whether to ask should see the number first." The rate is the
          router's, read live — see the effect above for why it is not typed. */}
      {askPrice ? (
        <MeteredNote
          rate={`${formatRate(askPrice.in)} / M in · ${formatRate(askPrice.out)} / M out`}
          spent={`this session: ${formatCost(totals.cost_usd)}`}
        >
          Each question is charged on what it retrieves, then on what the answer costs to
          write. A question the library cannot answer never reaches the model and is
          charged nothing — which is why the count beside the spend is worth reading with it.
        </MeteredNote>
      ) : null}

      {/* THE STAT STRIP — this licence's artboard tiles, and only the ones a
          store can fill. See `ASK_STRIP` above for which is which and for the
          one tile that is still absent. `value === null` drops a tile; a tile
          waiting on a load renders undefined, which is its skeleton. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {strip.map((tile) => {
          const v = ready ? tile.value(ctx) : undefined;
          if (v === null) return null;
          return <Stat key={tile.label} label={tile.label} value={v} note={ready ? tile.note(ctx) : 'not read yet'} />;
        })}
      </div>

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
              placeholder="Ask across the library — e.g. “which SOWs cap revisions?”"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="submit" className={buttonClass} disabled={busy || !question.trim()}>
                {busy ? 'Reading your library…' : 'Ask'}
              </button>
              {/* WHAT THE LAST QUESTION COST, NOT A FORECAST OF THE NEXT ONE.
                  The artboard prints "≈ $0.005 per question", which is a
                  per-question average over a session this page cannot have
                  before it has one. The honest form of the same promise — the
                  number in front of you before you commit — is the charge on
                  the most recent question, which is the best available estimate
                  of the next and is a fact rather than a model of one. */}
              {all.length > 0 && (
                <span className="font-mono text-[11px] text-gray-600 dark:text-gray-400">
                  last question: {formatCost(all[all.length - 1]?.cost_usd ?? 0)}
                </span>
              )}
              {error && <span className="text-[12px] text-gray-700 dark:text-gray-300">{error}</span>}
            </div>
          </form>
        </Card>

        {/* THE THREAD. One card per exchange, in the order asked, each with the
            citations under it and its own charge on the right — which is the
            artboard's layout and, more to the point, the only layout in which a
            reader can see that the unanswered question cost nothing. */}
        {thread.error ? (
          <Card className="border-dashed p-4">
            <Eyebrow>Session</Eyebrow>
            <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">{thread.error}</p>
          </Card>
        ) : null}

        {!thread.loading && !thread.error && visible.length === 0 && all.length > 0 ? (
          <Card className="border-dashed p-4">
            <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
              {view === 'cited'
                ? 'Every answer in this view already carries its citations, so this filter leaves nothing out.'
                : 'Nothing here went unanswered.'}
            </p>
          </Card>
        ) : null}

        <div className="grid gap-2.5">
          {visible.map((t) => (
            <Card
              key={t.uid}
              className={`p-3.5 ${t.reason === 'answered' ? '' : 'bg-amber-50/40 dark:bg-amber-950/20'}`}
            >
              <div className="flex flex-wrap items-baseline gap-2.5">
                <Eyebrow className="!text-[9px] text-axal-amber-deep dark:text-amber-300">Asked</Eyebrow>
                <span className="min-w-0 flex-1 text-[12.5px] font-bold tracking-tight text-axal-ink dark:text-gray-100">
                  {t.question}
                </span>
                <span className="whitespace-nowrap font-mono text-[10px] text-gray-600 dark:text-gray-400">
                  {formatCost(t.cost_usd)}{t.cached ? ' · cached' : ''}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
                {t.reason === 'answered' ? t.answer : (
                  t.reason === 'model_unavailable'
                    ? 'No answer written. Your library does have relevant passages — they are listed below — but the model that turns them into an answer did not respond. Adding documents will not help.'
                    : 'No answer given. Nothing in your library was close enough to answer this, so nothing was retrieved to reason over.'
                )}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {(t.citations || []).map((ct, i) => (
                  <Pill key={`${ct.title}-${ct.chunk}-${i}`} tone="cite" className="!text-[9.5px]">
                    {ct.n ? `[${ct.n}] ` : ''}{ct.title}
                    {ct.chunk != null ? ` · passage ${ct.chunk + 1}` : ''}
                  </Pill>
                ))}
                {t.reason === 'no_source' ? <Unrecorded>No retrievable source</Unrecorded> : null}
                <button
                  type="button"
                  onClick={() => toggleSaved(t)}
                  disabled={savingUid === t.uid}
                  className="ml-auto whitespace-nowrap rounded-[6px] border border-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-700 hover:border-gray-300 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300"
                >
                  {t.saved ? 'Kept' : 'Keep'}
                </button>
              </div>

              {t.reason === 'no_source' ? (
                <p className="mt-2 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {/* The number, not a verdict on it. A reader can see how near
                      it came and decide whether to rephrase or add a document. */}
                  {t.best_score != null && t.score_floor != null
                    ? `The closest passage scored ${t.best_score}, under the ${t.score_floor} needed to cite it. `
                    : 'No passage matched at all. '}
                  This page will not answer from general knowledge: an answer with no source
                  behind it reads exactly like one with a source, which is why it is refused
                  rather than guessed. Nothing is charged for a question the library cannot answer.
                </p>
              ) : null}
            </Card>
          ))}
        </div>

        {/* THE ARTBOARD'S INSTRUMENT CARD. Every column is a field
            `api.research.documents()` already returns and this page has already
            fetched for its empty state — nothing new is called to draw it. */}
        {items.length > 0 && (
          <Instrument
            testid="ask-reach"
            title="What Ask can reach"
            meta="Reads over the library and nothing else"
            cols="2.2fr 1fr 1fr .9fr 1.4fr"
            head={['Document', 'Kind', 'Added', 'Index state', 'In Ask']}
            rows={libRows}
            note={`Ask reaches exactly the ${indexed} indexed ${indexed === 1 ? 'row' : 'rows'}. A document added but not yet indexed answers nothing, however relevant it looks on the shelf — which is why a question about it comes back empty rather than reaching for it.`}
          />
        )}

        <ZoneDraft
          surface="research/ask"
          scopeKey={sessionUid}
          label="Draft · session brief"
          accept="Accept brief"
          run="Draft the brief"
          foot="Citations preserved per claim."
          empty="Gathers this session’s answers into one brief with every citation carried through, and names any question that went unanswered as a gap rather than dropping it."
          nothingToDraft="Ask a question first — there is nothing in this session to gather yet."
        />
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
