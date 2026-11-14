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
import { useRailOption, useRailPage } from '../../ui/railCrumbs';
import { railOptionFor } from '../../lib/railOptions';
import { railPressHeaders } from '../../lib/railPage.js';
import { RETRIEVAL_UNAVAILABLE } from './askOutcome.js';
import {
  ASK_STATES, CITATION_AVAILABILITY, HISTORY_TABS, answerWithCitations, answerabilityOf, askStateOf,
  citationAvailability, indexStateOf, tokensRefusal, splitCitations, referenceNote, REFERENCE_LIMIT,
} from './researchStates.js';
import { openAddTokens } from '../../lib/aiTokens.js';
import Sheet from '../../ui/Sheet.jsx';
import AddToResearch from './AddToResearch.jsx';
import { canAddToResearch } from './researchComparisons.js';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';

const mark = (s) => <><span aria-hidden="true">{s.glyph}</span> {s.label}</>;

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
// #4610: four scopes, four server reads. `discarded` joined them — it was a
// client-side filter over `all`'s window and so could not see past it.
const SCOPES = new Set(['session', 'all', 'saved', 'discarded']);

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

/**
 * #4610 — EVERY TILE THAT READS `totals` GOES THROUGH `UNREADABLE` FIRST.
 *
 * `totals` is null when the history read failed, and these tiles used to run
 * against a zero-filled fallback instead — so a failed read printed "0
 * questions asked" and a spend of nothing. `t()` is the one place that decides
 * what an unread figure looks like, so a tile cannot be added that forgets.
 *
 * The figures themselves now cover the WHOLE selected scope rather than the
 * page, so "Questions asked" is the reader's history and not the first two
 * hundred rows of it.
 */
const UNREADABLE = 'Unreadable';
/** What every `totals` note says when the history could not be read. */
const NOT_READ = 'the history could not be read; that is not a count of zero';

const ASK_STRIP = {
  advisor: [
    { label: 'Indexed documents', value: (x) => (x.indexed == null ? UNREADABLE : x.indexed), note: (x) => (x.indexed == null ? 'your library could not be read' : `of ${x.docs} in your library`) },
    { label: 'Answered', value: (x) => (x.totals ? `${x.totals.answered} of ${x.totals.asked}` : UNREADABLE), note: (x) => (x.totals ? 'each with its citations' : NOT_READ) },
    { label: 'No source', value: (x) => (x.totals ? x.totals.no_source : UNREADABLE), note: (x) => (!x.totals ? NOT_READ : x.totals.retrieval_unavailable ? `returned empty, charged nothing · ${x.totals.retrieval_unavailable} could not search` : 'returned empty, charged nothing') },
    { label: 'Session spend', value: (x) => (x.totals ? formatCost(x.totals.cost_usd) : UNREADABLE), note: (x) => (x.totals ? 'the whole selected scope, shown before each question, not only after' : NOT_READ) },
  ],
  founder: [
    { label: 'Questions asked', value: (x) => (x.totals ? x.totals.asked : UNREADABLE), note: (x) => (x.totals ? `${x.totals.no_source} came back with no source${x.totals.retrieval_unavailable ? `, ${x.totals.retrieval_unavailable} could not search` : ''}` : NOT_READ) },
    { label: 'Answers kept', value: (x) => (x.totals ? x.totals.saved : UNREADABLE), note: (x) => (x.totals ? 'kept from the ops row, one at a time' : NOT_READ) },
    {
      label: 'First-pass cost',
      value: (x) => { const m = mean(answeredOf(x.rows).filter((t) => !t.cached).map((t) => t.cost_usd)); return m == null ? null : formatCost(m); },
      // Over the rows LOADED, which is what a per-row mean can be computed
      // from: the Worker's totals carry a sum, not each answer's own cost.
      note: (x) => `mean over the ${x.pageSize} answered questions loaded${x.hasMore ? ' so far' : ''}`,
    },
    {
      label: 'Follow-up cost',
      value: (x) => { const m = mean(answeredOf(x.rows).filter((t) => t.cached).map((t) => t.cost_usd)); return m == null ? null : formatCost(m); },
      note: (x) => `mean over the cached answers among the ${x.pageSize} loaded${x.hasMore ? ' so far' : ''}`,
    },
  ],
};
// One file, one set of tiles per artboard pair: partner reads the same four as
// advisor and investor the same four as founder, because those artboards are
// each other's copies. Aliased rather than duplicated so a change to one cannot
// silently leave the other behind.
ASK_STRIP.partner = ASK_STRIP.advisor;
ASK_STRIP.investor = ASK_STRIP.founder;

/**
 * The chips that NARROW the rows a scope returned, as predicates.
 *
 * #4610 — `discarded` LEFT THIS TABLE AND BECAME A SCOPE. Archived was
 * `scopeFor('discarded') === 'all'` plus a client-side filter, so it searched
 * only the rows `all` had returned — the newest two hundred. A reader who
 * archived an answer and then asked two hundred more questions could not reach
 * it from the one tab that exists to find archived answers. It is a server
 * scope now, with its own statement and its own totals, so the tab reads
 * exactly the archived answers and pages through all of them.
 */
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

/** This zone, as the profiles' option inventories name it (`lib/railOptions`). */
const ZONE_FILE = 'pages/research/AskZone.jsx';

export default function AskZone({ zoneActions, zoneFilters, role = 'founder' }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  // D771 (#2097): `busy` is the question at the model, so the rail names that option while it runs.
  // D772 (#2098): under the key the member's profile gives it on this page.
  const railPage = useRailPage()?.page ?? null;
  const askOption = railOptionFor(railPage, { file: ZONE_FILE, control: 'ask' });
  useRailOption(busy ? askOption?.key : null, askOption?.label);
  const [error, setError] = useState('');
  // D4613: what the live region last said about a question (sent, answered).
  // Errors are announced by their own alert; this is the polite channel.
  const [announce, setAnnounce] = useState('');
  // D3701 part 4: a 402 from Ask is a budget stop, drawn as RS-11's card.
  const [tokens, setTokens] = useState(null);
  const [lib, setLib] = useState({ loading: true, error: '', payload: null });
  const [view, setView] = useState('session');
  const [thread, setThread] = useState({ loading: true, error: '', payload: null });
  const [pricing, setPricing] = useState(null);
  const [savingUid, setSavingUid] = useState('');
  const [copiedUid, setCopiedUid] = useState('');
  const [projectAnswer, setProjectAnswer] = useState(null);
  // D3701 part 6 (RS-10B): on a phone a citation opens as a bottom sheet with
  // its passage; wider screens list every passage inline.
  const phone = usePhoneWidth();
  const [openCite, setOpenCite] = useState(null);
  // D3701 RS-07: the answer and its numbered sources, as recorded. Nothing is
  // sent anywhere; a browser without clipboard access says so.
  const copyAnswer = async (t) => {
    try {
      await navigator.clipboard.writeText(answerWithCitations(t));
      setCopiedUid(t.uid);
    } catch {
      setError('This browser did not allow copying. Select the answer and copy it instead.');
    }
  };

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

  /**
   * #4610 — the rest of the history, appended.
   *
   * The scope's `totals` do not move: they were never the page's. A thread
   * (`order: 'asc'`) reads oldest-first on screen while being paged
   * newest-first from the store, so an older page goes BEFORE the rows already
   * shown; every other scope is a newest-first log and an older page goes
   * after. The Worker says which through `order`, so the page does not have to
   * know each scope's direction.
   */
  const [olderFailed, setOlderFailed] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = async () => {
    const cursor = thread.payload?.next_cursor;
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true); setOlderFailed(false);
    try {
      const more = await api.research.askSessions(scope, sessionUid || undefined, { cursor });
      setThread((c) => {
        if (!c.payload) return c;
        const older = Array.isArray(more?.items) ? more.items : [];
        return {
          ...c,
          payload: {
            ...c.payload,
            items: c.payload.order === 'asc' ? [...older, ...(c.payload.items || [])] : [...(c.payload.items || []), ...older],
            has_more: more?.has_more === true,
            next_cursor: more?.next_cursor || null,
          },
        };
      });
    } catch {
      // The rows already read stay on screen; only the attempt to extend failed.
      setOlderFailed(true);
    } finally { setLoadingOlder(false); }
  };

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
    setBusy(true); setError(''); setTokens(null); setAnnounce('Reading your library…');
    try {
      // D778 part 11: the press names its profile's option on the run (founder's by default).
      const r = await api.research.ask(q, sessionUid, railPressHeaders(askOption?.key ?? 'ask:library'));
      setQuestion('');
      setAnnounce(r?.reason === 'answered' ? 'Answer added to this session.' : 'Your question was recorded without an answer. The reason is shown in this session.');
      // Back to the session view: a reader who asks a question while looking at
      // `All history` has just added to a thread they cannot see, and leaving
      // them there would make the answer look lost.
      setView('session');
      await loadThread('session', r?.session_uid || '');
    } catch (err) {
      const stop = tokensRefusal(err);
      setAnnounce('');
      if (stop) setTokens(stop);
      else setError(err?.message || 'That question could not be answered right now.');
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

  const updateAnswer = async (item, changes) => {
    setSavingUid(item.uid); setError('');
    try {
      await api.research.askUpdateAnswer(item.uid, changes);
      await loadThread(scope, sessionUid);
    } catch (cause) { setError(cause?.message || 'That answer could not be updated.'); }
    finally { setSavingUid(''); }
  };

  const payload = lib.payload;
  // #4610: null, never 0, until the library read succeeds. `?? 0` made a failed
  // read say "no answerable documents" — and it is this value the "Nothing to
  // ask yet" empty state is gated on, so a failed read was presented as an
  // empty library. `answerable` is the Worker's `in_ask` count, which is what
  // "answerable" means on the rows beside it.
  const indexed = payload?.answerable ?? null;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  // D3701 RS-07C: only a library read that succeeded can show that a cited
  // document is gone. Null while it loads or when it failed.
  const libraryUids = useMemo(() => (payload ? new Set(items.map((d) => d.uid)) : null), [payload, items]);
  // D4613: each listed document's current index run, so a citation can say its
  // document was re-indexed after the answer read it.
  const libraryRevisions = useMemo(() => (payload ? new Map(items.map((d) => [d.uid, d.indexed_at || null])) : null), [payload, items]);

  const all = useMemo(() => thread.payload?.items || [], [thread.payload]);
  const visible = useMemo(() => (NARROW[view] ? all.filter(NARROW[view]) : all), [all, view]);
  /**
   * #4610 — THE SCOPE'S TOTALS, AND NULL WHEN NOTHING WAS READ.
   *
   * This was `|| { asked: 0, answered: 0, no_source: 0, cost_usd: 0 }`: a
   * failed history read became four zeroes and a spend of nothing, under tiles
   * that print real figures when it works. The object was also missing
   * `retrieval_unavailable`, which one tile reads, so that tile rendered
   * undefined on the fallback path.
   *
   * The Worker's `totals` now covers the WHOLE selected scope rather than the
   * page, so these figures no longer stop moving at two hundred.
   */
  const totals = thread.payload?.totals || null;
  const hasMore = thread.payload?.has_more === true;

  // The per-1M rates for the task this page actually runs. `research_ask` is the
  // join key; `routes` names the model and `prices` holds its rate, both from
  // `GET /api/ai/pricing`.
  const askModel = pricing?.routes?.research_ask?.model || '';
  const askPrice = pricing?.prices?.[askModel] || null;

  const strip = ASK_STRIP[role] || [];
  const ready = Boolean(payload && thread.payload);
  const ctx = { indexed, docs: items.length, totals, rows: all, pageSize: all.length, hasMore };

  const libRows = items.map((d) => {
    const ix = indexStateOf(d);
    const an = answerabilityOf(d);
    return {
      key: d.uid,
      cells: [
        { text: d.title || '', nr: !d.title },
        { text: d.kind || '', nr: !d.kind },
        // `Added`, not the artboard's own column name for this slot. It means
        // when the file arrived here, which is what `created_at` holds — the same
        // relabel `LibraryZone` made for the same reason.
        { text: String(d.created_at || '').slice(0, 10), nr: !d.created_at },
        { pill: mark(ix), pillTone: ix.tone },
        // The question this zone exists to answer, per row. `in_ask` and
        // `index_state`, never `chunk_count`: a document that indexed once and
        // later failed a re-index keeps its old count, and the failure path
        // updates the state and leaves the number alone (D3701, `answerabilityOf`).
        { pill: mark(an), pillTone: an.tone, sub: an.why },
      ],
    };
  });

  return (
    <div className="space-y-4">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({ value: view, onChange: setView }) : []}
          /* #4610 (S1's live-UI note): the management row is hidden when there
             is nothing to manage. `Export` over an empty history produces a
             file of headers, and `Clear history` offers to clear nothing —
             both are controls that cannot act, which is the same rule the
             Library applies to a client's document. With rows they are back,
             unchanged. */
          actions={visible.length ? zoneActions(visible, { newSession, savedAnswers: () => setView('saved') }) : []}
        />
      )}
      <ZoneHeading
        title="Ask Eadwyn"
        blurb="Ask questions grounded in your research evidence. Eadwyn answers only from documents you have added, with the passage each answer used."
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
        /**
         * #4610 — EXISTING HISTORY SURVIVES THE LAST ANSWERABLE DOCUMENT.
         *
         * The gate was `indexed === 0`, which replaced the WHOLE body —
         * composer, thread, tabs and all — the moment nothing was answerable.
         * So a reader who removed their last document, or whose index went
         * `failed`, lost the answers they had already been given: months of
         * history behind a card saying "Nothing to ask yet", about a library
         * rather than about the history it was hiding. `indexed` was also
         * `?? 0`, so a FAILED library read did the same thing — the one case
         * where the card's own sentence ("Add a document") is advice to act on
         * a false premise.
         *
         * The empty state is now for a reader with no answerable documents AND
         * no history: genuinely nothing to show. With history, the thread
         * renders and the composer's own disabled state says why a new question
         * cannot be asked, which is the honest division — one is a library
         * fact, the other is a record.
         *
         * `indexed == null` (unread) is not zero and does not reach here.
         */
        isEmpty={!lib.loading && !lib.error && indexed === 0 && all.length === 0 && !thread.loading && !thread.error}
        empty={(
          <NothingYet
            title="Nothing to ask yet"
            body="Ask answers only from your own documents, so it needs at least one that has been read. Add a document to the library and it becomes answerable here."
            action={(
              <p className="text-[12px]">
                <Link to="/research/library" className="font-bold text-axal-violet underline">Add evidence →</Link>
                {' '}<Link to="/research/library" className="text-axal-violet underline">Open Library</Link>
              </p>
            )}
          />
        )}
      >
        <Card className="p-4">
          {/* D4613: the label stays on screen (the placeholder is only an
              example), the help and any error are tied to the field, and the
              form says when it is busy. Ctrl+Enter or ⌘+Enter sends from the
              field; Tab reaches the Ask button as before. */}
          <form onSubmit={ask} aria-busy={busy || undefined} aria-label="Ask your library" data-testid="ask-form">
            <label htmlFor="ask-question" className="mb-1.5 block text-[12.5px] font-bold text-axal-ink dark:text-gray-100">What do you want to know?</label>
            <textarea
              id="ask-question"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy && question.trim()) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              aria-describedby={error ? 'ask-question-help ask-question-error' : 'ask-question-help'}
              aria-invalid={error ? true : undefined}
              className={inputClass}
              placeholder="Ask across the library — e.g. “which SOWs cap revisions?”"
            />
            <p id="ask-question-help" className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
              Answers come only from documents in your library that Ask can read. Press Ctrl+Enter (⌘+Enter on a Mac) to ask.
            </p>
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
              {error && <span id="ask-question-error" role="alert" data-testid="ask-error" className="text-[12px] text-gray-700 dark:text-gray-300">{error}</span>}
            </div>
            <p role="status" aria-live="polite" className="sr-only" data-testid="ask-status">{announce}</p>
          </form>
        </Card>

        {tokens ? (
          <Card className="border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/25" data-testid="ask-out-of-tokens">
            <div className="flex flex-wrap items-start justify-between gap-3" role="status">
              <div>
                <p className="text-[13px] font-extrabold text-axal-amber-deep dark:text-amber-300"><span aria-hidden="true">! </span>{tokens.title}</p>
                <p className="mt-1 text-[12px] text-gray-700 dark:text-gray-300">{tokens.body}</p>
                <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400">{tokens.note}</p>
              </div>
              <button type="button" className={buttonClass} data-testid="ask-add-tokens" onClick={() => openAddTokens({ from: 'Research › Ask' })}>Add tokens</button>
            </div>
          </Card>
        ) : null}

        {/* THE THREAD. One card per exchange, in the order asked, each with the
            citations under it and its own charge on the right — which is the
            artboard's layout and, more to the point, the only layout in which a
            reader can see that the unanswered question cost nothing. */}
        {/* D3701 RS-07: the history tabs. They set the same view the toolbar's
            chips set, so the two cannot disagree. */}
        {/* #4610: the rest of the selected scope, reachable. Without this the
            cursor the Worker returns has no reader and a reader with more than
            one page of history cannot see past the first. */}
        {hasMore ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="ask-history-more">
            <button type="button" className={buttonClass} disabled={loadingOlder} onClick={loadOlder} data-testid="ask-history-load-older">
              {loadingOlder ? 'Loading…' : `Load older (${all.length}${totals ? ` of ${totals.asked}` : ''} loaded)`}
            </button>
            {olderFailed ? <span role="alert" className="text-[12px] text-gray-700 dark:text-gray-300">That page could not be read. The answers already loaded are unaffected.</span> : null}
          </div>
        ) : null}
        <div role="tablist" aria-label="History" className="flex flex-wrap gap-1.5" data-testid="ask-history-tabs">
          {HISTORY_TABS.map((tab) => (
            <button key={tab.view} type="button" role="tab" aria-selected={view === tab.view}
              data-testid={`ask-tab-${tab.view}`} onClick={() => setView(tab.view)}
              className={`min-h-[32px] rounded-[8px] border px-3 text-[12px] font-bold ${view === tab.view
                ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200'
                : 'border-axal-hairline text-gray-700 dark:border-gray-700 dark:text-gray-300'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {thread.error ? (
          <Card className="border-dashed p-4">
            <Eyebrow>Session</Eyebrow>
            <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">{thread.error}</p>
          </Card>
        ) : null}

        {/* #4610: `all.length > 0` was the guard because every tab was a
            narrowing of one read, so "nothing here" could only mean "nothing
            among the rows in hand". `saved` and `discarded` are server SCOPES
            now, and an empty scope is an empty READ — `all` is itself zero —
            so the guard admits those two, or the Archived tab with nothing
            archived would render no body at all. */}
        {!thread.loading && !thread.error && visible.length === 0
          && (all.length > 0 || view === 'discarded' || view === 'saved') ? (
          <Card className="border-dashed p-4">
            <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
              {view === 'cited'
                ? 'Every answer in this view already carries its citations, so this filter leaves nothing out.'
                : view === 'discarded' ? 'No discarded answers.'
                  : view === 'saved' ? 'No answers kept yet. Keep one from its own ops row.'
                    : 'Nothing here went unanswered.'}
            </p>
          </Card>
        ) : null}

        <div className="grid gap-2.5">
          {visible.map((t) => {
            // D3701 RS-07C: each exchange names its own response state; none is
            // folded into another. Tinting every non-answer amber said they were
            // all one kind of warning, and amber is the canvas's Insufficient
            // evidence colour, a state the Worker does not record.
            const st = ASK_STATES[askStateOf(t, { libraryUids })];
            return (
            <Card key={t.uid} className="p-3.5" data-testid={`ask-exchange-${t.uid}`}>
              {st ? (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Pill tone={st.tone} className="!text-[10px]" data-testid={`ask-state-${t.uid}`}>{mark(st)}</Pill>
                  {st.action === 'library' ? (
                    <Link to="/research/library" className="text-[11px] font-bold text-violet-700 underline dark:text-violet-300">{st.actionLabel}</Link>
                  ) : null}
                  {askStateOf(t, { libraryUids }) === 'source_unavailable' ? (
                    <span className="text-[11px] text-gray-600 dark:text-gray-400">{st.body}</span>
                  ) : null}
                </div>
              ) : null}
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
                {t.reason === 'answered' ? t.answer : t.reason === 'retrieval_unavailable' ? RETRIEVAL_UNAVAILABLE : (
                  t.reason === 'model_unavailable'
                    ? 'No answer written. Your library does have relevant passages — they are listed below — but the model that turns them into an answer did not respond. Adding documents will not help.'
                    : 'No answer given. Nothing in your library was close enough to answer this, so nothing was retrieved to reason over.'
                )}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {(t.citations || []).length ? (
                  // D3701 RS-07: Sources used, each with its exact passage and
                  // whether its document is still in the library. D4613: the
                  // sources the answer cites come first; passages it was given
                  // and never cites are listed apart as retrieved context.
                  <div className="w-full" data-testid={`ask-sources-${t.uid}`}>
                    {(() => {
                      const note = referenceNote(t);
                      return note ? (
                        <p className="mb-1.5 rounded-[8px] border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-[11.5px] text-gray-800 dark:border-amber-900 dark:bg-amber-950/25 dark:text-gray-200" data-testid={`ask-reference-note-${t.uid}`}>
                          <span aria-hidden="true">! </span>{note.text}
                        </p>
                      ) : null;
                    })()}
                    {(() => {
                      const groups = splitCitations(t);
                      const sections = [
                        { key: 'cited', items: groups.cited, label: `Sources cited · ${groups.cited.length}` },
                        { key: 'retrieved', items: groups.retrieved, label: t.reason === 'answered' ? `Retrieved, not cited · ${groups.retrieved.length}` : `Passages retrieved · ${groups.retrieved.length}` },
                      ].filter((g) => g.items.length);
                      return sections.map((g) => (
                        <section key={g.key} className="mt-1.5" aria-label={g.label} data-testid={`ask-sources-${g.key}-${t.uid}`}>
                          <Eyebrow className="!text-[9px]">{g.label}</Eyebrow>
                          {phone ? (
                            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid={g.key === 'cited' ? `ask-source-buttons-${t.uid}` : undefined}>
                              {g.items.map(({ ct, i }) => (
                                <button key={`${ct.title}-${ct.chunk}-${i}`} type="button" data-testid={`ask-source-open-${t.uid}-${i}`}
                                  onClick={() => setOpenCite({ t, i })}
                                  className="min-h-[44px] max-w-full truncate rounded-[10px] border border-axal-hairline px-3 text-left text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">
                                  {`[${ct.n || i + 1}] `}{ct.title || 'Untitled document'}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <ol className="mt-1.5 space-y-1.5">
                              {g.items.map(({ ct, i }) => {
                                const avail = CITATION_AVAILABILITY[citationAvailability(ct, libraryUids, libraryRevisions)];
                                return (
                                  <li key={`${ct.title}-${ct.chunk}-${i}`} className="rounded-[8px] border border-axal-hairline p-2 dark:border-gray-700">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Pill tone={g.key === 'cited' ? 'cite' : 'neutral'} className="!text-[9.5px]">
                                        {`[${ct.n || i + 1}] `}{ct.title}
                                        {ct.chunk != null ? ` · passage ${ct.chunk + 1}` : ''}
                                      </Pill>
                                      {ct.page != null ? <span className="text-[10px] text-gray-600 dark:text-gray-400">page {ct.page}</span> : null}
                                      {avail ? <Pill tone={avail.tone} className="!text-[9.5px]"><span aria-hidden="true">{avail.glyph}</span> {avail.label}</Pill> : null}
                                      <button type="button" className="text-[11px] font-semibold text-axal-violet underline dark:text-violet-300"
                                        data-testid={`ask-source-inspect-${t.uid}-${i}`} onClick={() => setOpenCite({ t, i })}>
                                        Open passage<span className="sr-only">{` [${ct.n || i + 1}] ${ct.title || 'Untitled document'}`}</span>
                                      </button>
                                    </div>
                                    {ct.passage ? (
                                      <blockquote className="mt-1.5 border-l-2 border-violet-500 pl-2 text-[11.5px] leading-relaxed text-gray-700 dark:text-gray-300" data-testid={`ask-passage-${t.uid}-${i}`}>
                                        {ct.passage}{ct.passage_truncated ? '…' : ''}
                                      </blockquote>
                                    ) : (
                                      <p className="mt-1 text-[10.5px] text-gray-600 dark:text-gray-400">Passage not recorded for this answer.</p>
                                    )}
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </section>
                      ));
                    })()}
                    {t.reason === 'answered' ? <p className="mt-1.5 text-[10.5px] text-gray-600 dark:text-gray-400">{REFERENCE_LIMIT}</p> : null}
                  </div>
                ) : null}
                {t.reason === 'no_source' ? <Unrecorded>No retrievable source</Unrecorded> : null}
                {st?.action === 'retry' ? (
                  <button type="button" data-testid={`button-ask-retry-${t.uid}`} disabled={busy}
                    onClick={() => setQuestion(t.question)}
                    className="whitespace-nowrap rounded-[6px] border border-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-700 hover:border-gray-300 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300">
                    {t.reason === 'retrieval_unavailable' ? 'Ask again' : st.actionLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => toggleSaved(t)}
                  disabled={savingUid === t.uid}
                  className="ml-auto whitespace-nowrap rounded-[6px] border border-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-700 hover:border-gray-300 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300"
                >
                  {t.saved ? 'Kept' : 'Keep'}
                </button>
                {t.reason === 'answered' ? (
                  <button type="button" data-testid={`button-ask-copy-${t.uid}`}
                    onClick={() => copyAnswer(t)}
                    className="whitespace-nowrap text-[10px] font-bold text-violet-700 underline dark:text-violet-300">
                    {copiedUid === t.uid ? 'Copied' : 'Copy with citations'}
                  </button>
                ) : null}
                {t.uid && t.reason === 'answered' && !t.discarded && canAddToResearch(role) ? (
                  <button type="button" data-testid={`button-ask-save-project-${t.uid}`}
                    className="whitespace-nowrap text-[10px] font-bold text-violet-700 underline dark:text-violet-300"
                    onClick={() => setProjectAnswer({ uid: t.uid, name: t.question })}>
                    Save to project
                  </button>
                ) : null}
              </div>

              <AnswerDisposition item={t} busy={savingUid === t.uid} onUpdate={(changes) => updateAnswer(t, changes)} />

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
            );
          })}
        </div>
        {projectAnswer ? <AddToResearch kind="answer" items={[projectAnswer]} onClose={() => setProjectAnswer(null)} /> : null}

        {/* THE ARTBOARD'S INSTRUMENT CARD. Every column is a field
            `api.research.documents()` already returns and this page has already
            fetched for its empty state — nothing new is called to draw it. */}
        {/* D3701 RS-07: Evidence scope, collapsed. What Ask can reach is a
            detail a reader opens, not the page's subject. */}
        <details className="rounded-[12px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="ask-evidence-scope">
          <summary className="cursor-pointer">
            <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Evidence scope</span>
            <span className="block text-[11.5px] text-gray-600 dark:text-gray-400">Ask only uses documents in your Library that you’re allowed to use.</span>
          </summary>
          <div className="mt-3">
        {items.length > 0 && (
          <Instrument
            testid="ask-reach"
            title="What Ask can reach"
            meta="Reads over the library and nothing else"
            cols="2.2fr 1fr 1fr .9fr 1.4fr"
            head={['Document', 'Kind', 'Added', 'Index state', 'In Ask']}
            rows={libRows}
            /* #4610: `indexed` is null until the library read succeeds, so the
               sentence says that rather than interpolating the word "null" —
               which is what a `?? 0` fallback replaced with a confident zero
               and a bare null now replaces with the literal. */
            note={indexed == null
              ? 'How many documents Ask can reach could not be read, so this table cannot say. That is a failed read of your library, not a library with nothing answerable in it.'
              : `Ask reaches exactly the ${indexed} indexed ${indexed === 1 ? 'row' : 'rows'}. A document added but not yet indexed answers nothing, however relevant it looks on the shelf — which is why a question about it comes back empty rather than reaching for it.`}
          />
        )}
          </div>
        </details>

        <ZoneDraft
          surface="research/ask"
          railOption={railOptionFor(railPage, { file: ZONE_FILE, control: 'research/ask' })?.key}
          scopeKey={sessionUid}
          scoped
          blocked={!sessionUid ? 'Ask a question first — there is nothing in this session to gather yet.' : null}
          label="Draft · session brief"
          accept="Accept brief"
          run="Draft the brief"
          foot="Citations preserved per claim."
          empty="Gathers this session’s answers into one brief with every citation carried through, and names any question that went unanswered as a gap rather than dropping it."
          nothingToDraft="Ask a question first — there is nothing in this session to gather yet."
        />
      </ZoneBody>

      {openCite ? (() => {
        const ct = openCite.t.citations?.[openCite.i] || {};
        const availKey = citationAvailability(ct, libraryUids, libraryRevisions);
        const avail = CITATION_AVAILABILITY[availKey];
        return (
          <Sheet label="Source" eyebrow={`${ct.cited === true ? 'Cited source' : 'Retrieved passage'} ${ct.n || openCite.i + 1}`} title={ct.title || 'Untitled document'}
            onClose={() => setOpenCite(null)} phone="sheet" width={480} testId="ask-source-sheet">
            <p className="text-[12px] text-gray-600 dark:text-gray-400">
              {[ct.page != null ? `page ${ct.page}` : null, ct.chunk != null ? `passage ${ct.chunk + 1}` : null].filter(Boolean).join(' · ') || 'Page not recorded'}
            </p>
            {/* D4613: the index run the answer read, so the version is on record beside the passage. */}
            <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid="ask-source-sheet-revision">
              {ct.revision ? `Indexed version read: ${String(ct.revision).slice(0, 16)}` : 'Indexed version not recorded for this answer'}
            </p>
            {ct.cited === true ? null : (
              <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid="ask-source-sheet-uncited">The answer does not cite this passage. It was retrieved as context, not offered as support.</p>
            )}
            {avail ? <Pill tone={avail.tone} className="mt-2 !text-[10px]"><span aria-hidden="true">{avail.glyph}</span> {avail.label}</Pill> : null}
            {ct.passage ? (
              <blockquote className="mt-3 border-l-2 border-violet-500 pl-3 text-[13px] leading-relaxed text-gray-800 dark:text-gray-200" data-testid="ask-source-sheet-passage">
                {ct.passage}{ct.passage_truncated ? '…' : ''}
              </blockquote>
            ) : <p className="mt-3 text-[12px] text-gray-600 dark:text-gray-400">Passage not recorded for this answer.</p>}
            {availKey === 'changed' ? (
              <p className="mt-2 text-[11.5px] text-gray-700 dark:text-gray-300" data-testid="ask-source-sheet-changed">The document was indexed again after this answer. The passage above is the version the answer read; the document may now say something else.</p>
            ) : null}
            {availKey === 'gone' ? (
              <p className="mt-2 text-[11.5px] text-gray-700 dark:text-gray-300" data-testid="ask-source-sheet-gone">The document is no longer in your library, so only the passage recorded with this answer remains.</p>
            ) : null}
            {ct.document_uid && availKey !== 'gone' ? (
              <Link to={`/research/library#document-${encodeURIComponent(ct.document_uid)}`} data-testid="ask-source-sheet-open"
                className="mt-4 flex min-h-[44px] items-center justify-center rounded-[10px] border border-axal-hairline text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100">
                Open in Library
              </Link>
            ) : null}
          </Sheet>
        );
      })() : null}

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

/** D549: an explicit disposition and the reader's optional use note. */
export function AnswerDisposition({ item, busy, onUpdate }) {
  const [note, setNote] = useState(item.use_note || '');
  return <div className="mt-3 space-y-2" data-testid="answer-disposition">
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={item.discarded ? 'warn' : item.saved ? 'ok' : 'neutral'}>{item.discarded ? 'Discarded' : item.saved ? 'Saved' : 'Not decided'}</Pill>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => onUpdate({ discarded: !item.discarded })}>{item.discarded ? 'Undo discard' : 'Discard'}</button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); onUpdate({ use_note: note.trim() || null }); }} className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-[12px]">What you did with it
        <textarea className={inputClass} value={note} maxLength={2000} disabled={busy} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button className={buttonClass} disabled={busy} type="submit">Save note</button>
    </form>
    {item.use_note ? <p className="whitespace-pre-wrap text-[12px]">{item.use_note}</p> : <p className="text-[11px] text-gray-500 dark:text-gray-400">Use note: Not recorded</p>}
  </div>;
}
