import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Pill, Stat } from '../../ui';
import { formatCost } from '../../ui/assistCost';
import { api } from '../../lib/api';
import {
  Field, NothingYet, SaveNote, StatedLimit, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { Instrument, PairNote, SourceLegend } from '../../workspaces/canvasKit';
import { useRailOption, useRailPage } from '../../ui/railCrumbs';
import { railOptionFor } from '../../lib/railOptions';
import { createRecordGate } from './recordGate.js';
import { MAX_POLLS, batchSummary, hasPending, pollDelay, reindexTargets, runBatch } from './libraryIndexing.js';
import { answerabilityOf, indexStateOf, rowProblem } from './researchStates.js';

/**
 * Research · Library — the documents you hold, and how far Ask can see into them.
 *
 * THE LAST COLUMN IS THE POINT. The canvas calls a document's indexed state
 * the most important thing on this page, and it is right: what is indexed is
 * precisely Ask's reach, so a file listed here that Ask cannot read is
 * invisible to every question asked upstairs. Rendering that as a tick, or
 * worse as nothing at all, would let a reader assume coverage they do not
 * have. Each row therefore says which of four states it is in, and an
 * unreadable file says why in words rather than showing an icon.
 *
 * `chunk_count` IS NULL UNTIL A FILE IS ACTUALLY INDEXED, never 0, and the
 * page keeps that distinction: "not indexed yet" and "indexed into nothing"
 * are different facts and only one of them means Ask has read the file.
 *
 * WHAT THIS PAGE CAN NOW DO, and could not until task #104: a client can send
 * you a document. `advisor_client_grants` (migration 218) opens one project to
 * one named advisor, and `advisor_client_document_shares` carries a single file
 * inside that grant — a table that had a reader and no writer until the control
 * beside `AdvisorGrantSection` was built.
 *
 * A PUSHED DOCUMENT NOW APPEARS HERE, AND THIS PARAGRAPH USED TO SAY IT DID
 * NOT. It said the file showed only in that reader's client brief, "because
 * this library is your own". The `pr4` artboard disagrees and is right: its
 * fourth tile is `From clients` and two of its six rows carry the seam mark, so
 * a document a client opened to you belongs in the list of what you hold.
 * `GET /documents` returns both sets.
 *
 * NOTHING IS COPIED AND D37 IS UNTOUCHED. A shared document is LISTED, not
 * duplicated — same row, same R2 object, still owned by the client — and it
 * stays indexed in their namespace, which `searchSemantic` never searches for
 * you. So the `In Ask` column reports it as unreachable, which is true and is a
 * sharper version of this page's own point: index state is Ask's reach, and a
 * file can be in your library and outside it.
 *
 * READ-ONLY IS THE OWNERSHIP, NOT A FLAG. Every write path here is
 * `WHERE owner_user_id = ?`, so a client's document 404s on remove and on
 * re-index by construction; the row simply does not draw controls it could not
 * carry out. An empty library still means you have uploaded nothing AND nobody
 * has opened anything to you.
 */

// D3701 (RS-06): index state and answerability are two columns with two
// vocabularies, named once in `researchStates.js`. This file used to say
// "Answerable" inside the index-state pill, so the two read as one fact.
const mark = (s) => <><span aria-hidden="true">{s.glyph}</span> {s.label}</>;

const KINDS = [
  { value: 'document', label: 'Document' },
  { value: 'report', label: 'Report' },
  { value: 'primary', label: 'Primary' },
  { value: 'legal', label: 'Legal' },
  { value: 'playbook', label: 'My playbook' },
  { value: 'client', label: 'About a client' },
];
// The artboard tints kind as well as state, and the two must not read alike: a
// kind is what a document IS and can never be wrong, so none of these is a
// status colour. `seam` and `cite` are the two provenance tones `Pill` carries
// for exactly this reason.
const KIND_TONE = { client: 'seam', playbook: 'cite', document: 'neutral' };

function fmtBytes(n) {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The stat strip, per licence, because the four artboards ask for DIFFERENT
 * TILES — and this file drew one set of four on all of them.
 *
 * THE BUG THIS TABLE FIXES. `Pages · {Founder,Investor} Research` open Library
 * with `Documents`, `Primary sources`, `Questions asked` and `Cost per
 * question`. `Pages · {Advisor,Partner} Research` open it with `Documents`,
 * `Indexed`, `Not indexed` and `From clients`. This page hard-coded the first
 * four for every licence, so a partner's Library has been showing a founder's
 * artboard — three tiles reading "Not recorded" where their own artboard asks
 * for three figures the store can produce.
 *
 * AND TWO OF THOSE THREE WERE ALREADY FALSE. `Questions asked` read "no
 * question history is stored, here or in Ask" and `Cost per question` "the same
 * missing history"; migration 221 stores both. A gap card outliving its gap is
 * worse than never having written one (D68) — it is a confident, specific claim
 * that the product cannot do something it now does. Founder and investor get
 * the real figures from the same place Ask's strip does.
 *
 * D549 counts Primary from the recorded kind, never from the filename.
 */
const LIBRARY_STRIP = {
  advisor: [
    { label: 'Documents', value: (x) => x.total, note: (x) => `${x.clientDocs} client, ${x.reusable} reusable` },
    // #4610 — THE LABELS ARE THE ARTBOARD'S; WHAT CHANGED IS WHAT THEY COUNT.
    // The note under this tile has always read "answerable in Ask", and the
    // figure was `index_state`-derived over every item INCLUDING shares — so it
    // counted a client's indexed share as answerable while the row beside it
    // said "Indexed in their library, not yours". Both now read the Worker's
    // `in_ask`, the one field the rows show, so the tile and its own note and
    // the rows cannot disagree. #3701 owns these labels; this is not a relabel.
    // Null, never 0, until the read succeeds.
    { label: 'Indexed', value: (x) => (x.indexed == null ? 'Unreadable' : x.indexed), note: (x) => (x.indexed == null ? 'the library could not be read' : 'answerable in Ask') },
    { label: 'Not indexed', value: (x) => (x.notIndexed == null ? 'Unreadable' : x.notIndexed), note: (x) => (x.notIndexed == null ? 'the library could not be read' : 'invisible to Ask until indexed') },
    // #4610: null until the library read succeeds, so the tile says Unreadable
    // rather than asserting "0 from clients" about a read that never happened.
    { label: 'From clients', value: (x) => (x.fromClients == null ? 'Unreadable' : x.fromClients), note: (x) => (x.fromClients == null ? 'the library could not be read; that is not a count of zero' : 'read-only, opened to you through a grant') },
  ],
  founder: [
    { label: 'Documents', value: (x) => x.total, note: (x) => (x.indexed == null ? 'how many Ask can answer from could not be read' : `${x.indexed} answerable by Ask`) },
    { label: 'Primary sources', value: (x) => x.primary, note: () => 'classified as primary by their owner' },
    // D4612: a failed read of the Ask history is Unreadable, never "0 asked".
    {
      label: 'Questions asked',
      value: (x) => (x.askState === 'ready' ? x.asked : x.askState === 'unreadable' ? 'Unreadable' : 'Reading…'),
      note: (x) => (x.askState === 'ready' ? `${x.noSource} came back with no source` : x.askState === 'unreadable' ? 'the Ask history could not be read; that is not a count of zero' : 'reading the Ask history'),
    },
    {
      label: 'Cost per question',
      value: (x) => (x.askState === 'ready' && x.asked ? formatCost(x.spend / x.asked) : null),
      note: () => 'mean over the questions on record',
      mono: true,
    },
  ],
};
// Partner's artboard is advisor's and investor's is founder's. Aliased rather
// than duplicated, the same way `ASK_STRIP` is, so a change to one cannot
// silently leave its twin behind.
LIBRARY_STRIP.partner = LIBRARY_STRIP.advisor;
LIBRARY_STRIP.investor = LIBRARY_STRIP.founder;

/** This zone, as the profiles' option inventories name it (`lib/railOptions`). */
const ZONE_FILE = 'pages/research/LibraryZone.jsx';

/**
 * `zoneActions` is the same render prop `AskZone` takes, for the same reason:
 * one route, four licences, four different sets of zone actions. Called with
 * the documents on screen so "export this view" has a view.
 */
export default function LibraryZone({ zoneActions, zoneFilters, role = 'founder' }) {
  const [state, setState] = useState({ loading: true, error: '', payload: null });
  // The zone header row's view, owned here because only this page has the rows.
  // `zoneFiltersByRole` decides WHICH views this licence is offered; the
  // predicate below is the same for all four, because it is the same store.
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  // D771 (#2097): `busy` also covers Remove, so an upload or a re-index names itself to the rail on its own.
  const [running, setRunning] = useState(null);
  // D772 (#2098): each under the key the member's profile gives it on this page.
  const railPage = useRailPage()?.page ?? null;
  const uploadOption = railOptionFor(railPage, { file: ZONE_FILE, control: 'upload' });
  const reindexOption = railOptionFor(railPage, { file: ZONE_FILE, control: 'reindex' });
  useRailOption(running === 'upload' ? uploadOption?.key : null, uploadOption?.label);
  useRailOption(running === 'reindex' ? reindexOption?.key : null, reindexOption?.label);
  const [note, setNote] = useState(null);
  const [kind, setKind] = useState('document');
  const [title, setTitle] = useState('');
  const fileRef = useRef(null);
  const collectionRef = useRef(null);
  const [collectionState, setCollectionState] = useState({ loading: true, error: '', items: [] });
  const [collectionUid, setCollectionUid] = useState('');
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const loadCollections = useCallback(async () => {
    setCollectionState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await api.research.collections();
      setCollectionState({ loading: false, error: '', items: response.items || [] });
    } catch (cause) {
      setCollectionState({ loading: false, error: cause?.message || 'Collections are unreadable.', items: [] });
    }
  }, []);
  useEffect(() => { loadCollections(); }, [loadCollections]);

  // D4612: a read answers only if it is still the latest, and the page is still here.
  const gate = useRef(null);
  if (!gate.current) gate.current = createRecordGate();
  const load = useCallback(async () => {
    const fresh = gate.current.begin();
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const payload = await api.research.documents();
      if (fresh()) setState({ loading: false, error: '', payload });
    } catch (e) {
      if (fresh()) setState({ loading: false, error: e?.message || 'Your library could not be read.', payload: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // D4612: while a document is being read, re-read the library on a bounded
  // schedule, quietly (the table stays on screen), until nothing is pending,
  // the schedule runs out, or the page leaves. A failed re-read keeps the last
  // good table and tries again on the same schedule.
  const polls = useRef(0);
  const [watching, setWatching] = useState('idle'); // idle | watching | stopped
  const pending = hasPending(state.payload?.items);
  useEffect(() => {
    if (!pending) { polls.current = 0; setWatching('idle'); return undefined; }
    const delay = pollDelay(polls.current);
    if (delay == null) { setWatching('stopped'); return undefined; }
    setWatching('watching');
    const timer = setTimeout(async () => {
      polls.current += 1;
      const fresh = gate.current.begin();
      try {
        const payload = await api.research.documents();
        if (fresh()) setState({ loading: false, error: '', payload });
      } catch {
        if (fresh()) setState((c) => ({ ...c, payload: c.payload ? { ...c.payload } : c.payload }));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [pending, state.payload]);
  useEffect(() => () => gate.current.invalidate(), []);
  useEffect(() => {
    if (!state.loading && window.location.hash.startsWith('#document-')) {
      window.document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'center' });
    }
  }, [state.loading, state.payload]);

  // THE ASK HISTORY, READ HERE TOO, AND ONLY ON THE LICENCES WHOSE ARTBOARD
  // ASKS FOR IT. Founder's and investor's Library artboards open with
  // `Questions asked` and `Cost per question` — figures about Ask, on the
  // Library page, because the two zones are one system and the artboards say so
  // from both ends. A failure here leaves those two tiles undrawn rather than
  // failing the page: the documents are what this zone is for.
  // D4612: the Ask figures are their own read, with their own state. A failed
  // read draws them Unreadable with a retry, never as 0 questions asked.
  const [ask, setAsk] = useState(null);
  const [askState, setAskState] = useState('loading'); // loading | ready | unreadable
  const wantsAsk = LIBRARY_STRIP[role] === LIBRARY_STRIP.founder;
  const [askTry, setAskTry] = useState(0);
  useEffect(() => {
    if (!wantsAsk) return undefined;
    let live = true;
    setAskState('loading');
    api.research.askSessions('all')
      .then((r) => { if (live) { setAsk(r?.totals || null); setAskState(r?.totals ? 'ready' : 'unreadable'); } })
      .catch(() => { if (live) { setAsk(null); setAskState('unreadable'); } });
    return () => { live = false; };
  }, [wantsAsk, askTry]);

  const upload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setNote({ ok: false, text: 'Choose a file first.' }); return; }
    setBusy(true); setNote(null); setRunning('upload');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      if (title.trim()) fd.append('title', title.trim());
      await api.research.upload(fd);
      if (fileRef.current) fileRef.current.value = '';
      setTitle('');
      // "Added" rather than "Indexed": reading the file happens on a queue and
      // has not finished yet. Claiming otherwise here would be the same lie
      // the state column exists to prevent.
      setNote({ ok: true, text: 'Added. Reading it now — the state below updates when Ask can use it.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be uploaded. Nothing was saved.' });
    } finally { setBusy(false); setRunning(null); }
  };

  const remove = async (uid) => {
    setBusy(true); setNote(null);
    try {
      await api.research.remove(uid);
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be removed.' });
    } finally { setBusy(false); }
  };

  const download = async (uid) => {
    setNote(null);
    try {
      const res = await api.research.downloadUrl(uid);
      if (res?.url) window.location.href = res.url;
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That file could not be opened.' });
    }
  };

  const payload = state.payload;
  const items = payload?.items || [];

  // `unindexed` TESTS THE STATE, NOT THE PASSAGE COUNT. The Passages column
  // below is right to read `chunk_count == null` — that column reports how much
  // of a file Ask holds. This is a different question, and the two come apart:
  // the indexer's failure path writes `index_state` and `index_note` and leaves
  // `chunk_count` alone, so a document that indexed once and later failed a
  // re-index still carries its old count while being unreadable to Ask. Reading
  // the number here would hide exactly the documents this view is for.
  const visible = items.filter((d) => {
    if (collectionUid && !collectionState.items.find((item) => item.uid === collectionUid)?.document_uids?.includes(d.uid)) return false;
    if (['client', 'playbook', 'report', 'primary', 'legal'].includes(filter)) return d.kind === filter;
    if (filter === 'unindexed') return d.index_state !== 'indexed';
    return true;
  });
  // Clicking the active chip clears it. Two of the four canvases carry no `All`
  // of their own, and adding one the artboard never drew is not this table's
  // call to make — so the chip that is on is also the way back off it.
  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));

  const strip = LIBRARY_STRIP[role] || LIBRARY_STRIP.founder;
  // COUNTED OVER THE WHOLE LIBRARY, NEVER OVER `visible`. A tile that changes
  // because you clicked a chip is not reporting what it claims to — the same
  // rule `SignalsPage`'s age bands follow, and for the same reason.
  /**
   * #4610 — A COUNT NOBODY READ IS NULL, NEVER 0.
   *
   * `payload?.indexed ?? 0` turned a failed or absent library read into three
   * confident zeroes — "0 answerable", "0 not indexed", "0 from clients" — in
   * the same tiles that print real figures when the read works. The Ask-history
   * read beside them had this right already (D4612: `askState === 'ready' ?
   * … : null`), so one strip held both conventions, and the honest one was the
   * newer one. `payload` is null until a read succeeds, so `?? null` is the
   * whole fix and the tiles' own absence handling does the rest.
   */
  const ctx = {
    primary: items.filter((d) => d.kind === 'primary').length,
    total: items.length,
    // `answerable` is the Worker's `in_ask` count — the same field each row
    // carries — so the strip and the rows cannot disagree about whether a
    // client's indexed share is answerable here. It is not.
    indexed: payload?.answerable ?? null,
    notIndexed: payload?.not_answerable ?? null,
    indexState: payload?.indexed ?? null,
    fromClients: payload?.from_clients ?? null,
    clientDocs: items.filter((d) => d.kind === 'client').length,
    reusable: items.filter((d) => d.kind === 'playbook').length,
    // Null, never 0, until the Ask history has been read (D4612).
    asked: askState === 'ready' ? ask.asked : null,
    noSource: askState === 'ready' ? ask.no_source : null,
    spend: askState === 'ready' ? ask.cost_usd : null,
    askState,
  };

  const reindex = async (uid) => {
    setBusy(true); setNote(null); setRunning('reindex');
    try {
      await api.research.reindex(uid);
      setNote({ ok: true, text: 'Reading it again — the state below updates when Ask can use it.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be re-indexed.' });
    } finally { setBusy(false); setRunning(null); }
  };

  // `Re-index` acts on every own document that Ask cannot currently read, which
  // is what the ops row means on a page listing the whole library. It is
  // disabled with a reason rather than hidden when there is nothing to re-run —
  // a control that vanishes leaves a reader wondering whether it ever existed.
  // D4612: what is already being read is left alone, at most two go at once,
  // the page stays busy until every one has answered, and the note says what
  // each did.
  const stale = reindexTargets(items);
  const reindexAll = async () => {
    setBusy(true); setNote(null); setRunning('reindex');
    try {
      const results = await runBatch(stale.map((d) => d.uid), (uid) => api.research.reindex(uid), 2);
      const title = (uid) => items.find((d) => d.uid === uid)?.title || 'Untitled document';
      setNote(batchSummary(results, title));
      await load();
    } finally { setBusy(false); setRunning(null); }
  };
  const handlers = {
    newCollection: () => { setNewCollectionOpen(true); collectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    addDocument: () => fileRef.current?.click(),
    reindex: {
      onClick: reindexAll,
      disabled: busy || stale.length === 0,
      title: stale.length === 0
        ? (pending ? 'the documents Ask cannot see yet are already being read' : 'every document you own is already indexed')
        : `re-read ${stale.length} document${stale.length === 1 ? '' : 's'} Ask cannot currently see`,
    },
  };

  return (
    <div className="space-y-4">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({ value: filter, onChange: choose }) : []}
          actions={zoneActions(visible, handlers)}
        />
      )}
      <ZoneHeading
        title="Evidence Library"
        blurb="Your documents. Only indexed documents can be cited in Ask."
        /* #4610: the pill counts what Ask can answer from — `in_ask`, the
           field the rows show — not what is indexed. An indexed client share
           is indexed and is not answerable here, and this pill used to count
           it as both. */
        action={payload && Number.isFinite(Number(payload.answerable)) ? (
          <Pill tone={payload.not_answerable > 0 ? 'warn' : 'ok'}>
            {payload.answerable} answerable
            {payload.not_answerable > 0 ? ` · ${payload.not_answerable} not` : ''}
          </Pill>
        ) : null}
      />

      <Card className="p-4">
        <form onSubmit={upload}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="File" hint="PDF, Word, PowerPoint, text, markdown or CSV. Up to 20 MB.">
              <input ref={fileRef} type="file" className={inputClass}
                accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv" />
            </Field>
            <Field label="What it is">
              <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Title" hint="Leave blank to use the filename.">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Adding…' : 'Add to library'}
            </button>
          </div>
          <SaveNote note={note} />
        </form>
      </Card>

      {/* THIS LICENCE'S ARTBOARD TILES. See `LIBRARY_STRIP` above for which
          four, and why one table rather than one row of literals. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {strip.map((tile) => {
          const v = payload ? tile.value(ctx) : undefined;
          if (v === null) return null;
          return (
            <Stat
              key={tile.label}
              label={tile.label}
              value={v}
              mono={tile.mono !== false}
              note={payload ? tile.note(ctx) : 'library not read'}
            />
          );
        })}
      </div>

      {ctx.askState === 'unreadable' && wantsAsk && (
        <p className="text-[11.5px] text-axal-muted" data-testid="library-ask-unreadable">
          The Ask figures could not be read.{' '}
          <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => setAskTry((n) => n + 1)}>Try again</button>
        </p>
      )}
      {watching === 'stopped' && (
        <p className="text-[11.5px] text-axal-muted" data-testid="library-watch-stopped">
          Some documents are still being read. This page stopped checking after {MAX_POLLS} tries.{' '}
          <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => { polls.current = 0; load(); }}>Check again</button>
        </p>
      )}

      {/* Cyan is theirs, amber is ours — rendered only where the table can
          actually carry both marks. A legend over rows that are all one source
          explains a distinction the reader cannot see, which is the same defect
          as a filter chip that selects everything. */}
      {ctx.fromClients != null && ctx.fromClients > 0 && (
        <SourceLegend
          theirs="From a client"
          theirsNote="read-only — opened to you through a grant"
          ours="Ours"
          oursNote="uploaded by you, yours to change"
        />
      )}

      <div ref={collectionRef}>
        <CollectionManager state={collectionState} documents={items.filter((document) => document.source !== 'client')}
          selected={collectionUid} onSelect={setCollectionUid} showCreate={newCollectionOpen} onShowCreate={setNewCollectionOpen}
          onSaved={loadCollections} />
      </div>

      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={!state.loading && !state.error && items.length === 0}
        empty={(
          <NothingYet
            title="Nothing in your library yet"
            body="Add a document above and Ask can answer questions from it, citing the passage it used. Nothing here is inferred — an empty library means you have not added anything and no client has opened a file to you, not that something failed to arrive."
          />
        )}
      >
        {/* D3701 RS-10C: on a phone the rows are cards, each with both
            states and its Retry. The table below is for wider screens. */}
        <ul className="space-y-2.5 sm:hidden" data-testid="library-cards">
          {visible.map((d) => {
            const ix = indexStateOf(d);
            const an = answerabilityOf(d);
            const problem = rowProblem(d);
            return (
              <li key={d.uid}>
                <Card className="p-3.5">
                  <p className="break-words text-[13px] font-bold text-axal-ink dark:text-gray-100">{d.title}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Pill tone={ix.tone} className="!text-[10px]">{mark(ix)}</Pill>
                    <Pill tone={an.tone} className="!text-[10px]">{mark(an)}</Pill>
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                    {KINDS.find((k) => k.value === d.kind)?.label || d.kind}
                    {' · '}
                    {d.created_at ? `added ${String(d.created_at).slice(0, 10)}` : 'added: Not recorded'}
                  </p>
                  {problem ? <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">{problem.reason}</p> : null}
                  {problem?.action === 'retry' ? (
                    <button type="button" disabled={busy} onClick={() => reindex(d.uid)}
                      data-testid={`library-card-retry-${d.uid}`}
                      className="mt-2.5 min-h-[44px] w-full rounded-[10px] border border-axal-hairline text-[13px] font-bold text-axal-ink disabled:opacity-60 dark:border-gray-700 dark:text-gray-100">
                      Retry
                    </button>
                  ) : null}
                  {problem?.action === 'replace' ? <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{problem.label}</p> : null}
                </Card>
              </li>
            );
          })}
        </ul>
        <div className="hidden sm:block">
        <Instrument
          testid="library-documents"
          title="Library"
          meta="Indexed is not the same as answerable"
          cols="2.2fr 1fr 1fr .9fr 1.4fr"
          head={['Document', 'Kind', 'Source year', 'Index state', 'Answerable in Ask']}
          rows={visible.map((d) => {
            const ix = indexStateOf(d);
            const an = answerabilityOf(d);
            const problem = rowProblem(d);
            return {
            key: d.uid,
            cells: [
              {
                text: d.title,
                node: <span id={`document-${encodeURIComponent(d.uid)}`} />,
                // Cyan is theirs, amber is ours — the legend above says which,
                // and the marks are the artboard's `seam` and `ours`.
                seam: d.source === 'client' ? (d.source_label || 'From client') : null,
                ours: d.source === 'client' ? null : 'Ours',
                // RS-06: a Failed or Unsupported row says why under its name.
                sub: problem
                  ? `${problem.reason}${problem.action === 'replace' ? ` ${problem.label}` : ''}`
                  : (fmtBytes(d.size_bytes) || 'Size not recorded'),
              },
              { pill: KINDS.find((k) => k.value === d.kind)?.label || d.kind, pillTone: KIND_TONE[d.kind] || 'neutral' },
              // Source year is recorded separately from the upload date (D549).
              { text: d.source_year == null ? 'Not recorded' : String(d.source_year), sub: d.created_at ? `Added ${String(d.created_at).slice(0, 10)}` : 'Added: Not recorded' },
              {
                // What the indexer did, in its own words (D3701).
                pill: mark(ix),
                pillTone: ix.tone,
                // The passage count belongs beside the state and nowhere else:
                // NULL, not 0, because "never read" and "read into nothing" are
                // different facts and only one means Ask can cite the file.
                sub: d.chunk_count == null ? null : `${d.chunk_count} passages`,
              },
              // THE ZONE'S OWN QUESTION, PER ROW, and the one column that is
              // not a restatement of the one before it. A client's document is
              // indexed in THEIR library, so it is unreachable here however
              // green its state reads — which is exactly why the two columns
              // are separate.
              {
                pill: mark(an),
                pillTone: an.tone,
                sub: an.why,
                node: (
                  <>
                    {problem?.action === 'retry' ? (
                      <button type="button" disabled={busy} onClick={() => reindex(d.uid)}
                        data-testid={`library-retry-${d.uid}`}
                        className="rounded-[6px] border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink disabled:opacity-60 dark:border-gray-700 dark:text-gray-100">
                        Retry
                      </button>
                    ) : null}
                    {/* #4610: `Open` DRAWS WHEREVER IT CAN ACT, which now
                        includes a client's share — the download route resolves
                        ownership OR an active share, so the button that used to
                        404 on a shared row works. It is still conditional,
                        because `read_only` is about writing and `Open` is a
                        read: the condition is whether this reader may read the
                        file, which the row says. */}
                    <button type="button" className={ghostButtonClass} onClick={() => download(d.uid)} data-testid={`library-open-${d.uid}`}>
                      Open
                    </button>
                    {/* A CLIENT'S DOCUMENT OFFERS NEITHER. Removing it is not
                        the reader's to do — the route 404s on it, because it is
                        not in their own set — and re-indexing it would index
                        into a namespace it does not belong to. Drawing either
                        would be a control that cannot act. */}
                    {d.source !== 'client' && d.read_only !== true && (
                      <>
                        <DocumentMetadata document={d} onSaved={load} />
                        {problem?.action === 'retry' ? null : (
                          <button
                            type="button" disabled={busy} onClick={() => reindex(d.uid)}
                            className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            Re-index
                          </button>
                        )}
                        <button
                          type="button" disabled={busy} onClick={() => remove(d.uid)}
                          className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </>
                ),
              },
            ],
            };
          })}
          note={ctx.indexed == null
            ? 'How many of your documents Ask can reach could not be read, so this table cannot say. That is a failed read, not a library with nothing answerable in it.'
            : `Ask reaches exactly the ${ctx.indexed} indexed ${ctx.indexed === 1 ? 'document' : 'documents'} you own. Adding a document and making it answerable are two acts, and the last column is where the second one becomes visible — a file on the shelf that Ask cannot read is invisible to every question asked upstairs.`}
        />
        </div>

        {/* THE ARTBOARD'S PAIR NOTE, and the only one in the Research set. It
            earns its place because the `In Ask` column above is meaningless
            without it: the last column is not a status, it is Ask's reach,
            restated here so the relationship is visible from both ends. */}
        <PairNote heading="Library and Ask are one system" meta="Empty library, no Ask">
          What is indexed here is precisely what Ask can answer over. With an empty library
          Ask has no empty-state prose to fall back on — it can only report that nothing is
          indexed, which is why an unindexed document is a working gap rather than
          housekeeping. A document a client opened to you is read-only: you can read it,
          and changing it is not yours to do.
        </PairNote>

        <ZoneDraft
          surface="research/library"
          railOption={railOptionFor(railPage, { file: ZONE_FILE, control: 'research/library' })?.key}
          label="Draft · index gaps"
          accept="Accept draft"
          run="Draft the gaps"
          foot="Counted from index state."
          empty="Points to the documents Ask cannot currently read and what indexing each would unlock — drafted from the index state on this page and nothing else."
          nothingToDraft="Every document you own is already answerable, so there is no gap to draft over."
        />
      </ZoneBody>

      {/* WAS "Nobody can send you a document yet", AND THAT IS NO LONGER TRUE.
          The panel said a founder could not share a document with a reader
          because "the product has that mechanism for investors and no
          counterpart for anyone else". `advisor_client_grants` (migration 218)
          is that counterpart, and the list above now includes what has arrived
          through one. What is still worth stating is the half a reader would
          otherwise get wrong: a shared document is listed and unreachable, and
          those are not a contradiction. */}
      <StatedLimit title="What a shared document does and does not do">
        <p>
          A client can open one of their own files to you, through a grant they control and
          can revoke. It is listed here with their name on it, you can read it, and it is
          not yours to change or remove &mdash; which is the right asymmetry for a record
          they also see.
        </p>
        <p>
          Ask cannot cite it. A shared document stays indexed in the client&rsquo;s library,
          and Ask searches only your own, so the last column reads &ldquo;indexed in their
          library, not yours&rdquo; rather than showing it as answerable.
        </p>
        <p>
          So an empty library means you have uploaded nothing and nobody has opened
          anything to you. It never means something was shared and failed to arrive.
        </p>
      </StatedLimit>
    </div>
  );
}

/** D549: editing metadata never changes a shared client's row. */
export function DocumentMetadata({ document, onSaved }) {
  const [title, setTitle] = useState(document.title || '');
  const [kind, setKind] = useState(document.kind || 'document');
  const [year, setYear] = useState(document.source_year ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (document.read_only || document.source === 'client') return null;
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api.research.updateDocument(document.uid, { title: title.trim(), kind, source_year: year === '' ? null : Number(year) });
      await onSaved?.();
    } catch (cause) { setError(cause?.message || 'Metadata could not be saved.'); }
    finally { setBusy(false); }
  };
  return <details className="w-full text-[12px]" data-testid="document-metadata">
    <summary className="cursor-pointer">Edit title, kind or source year</summary>
    <form className="mt-2 space-y-2" onSubmit={save}>
      <label className="block">Title<input className={inputClass} value={title} maxLength={300} required disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="block">Kind<select aria-label="Kind" className={inputClass} value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)}>{KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="block">Source year<input className={inputClass} type="number" min={1000} max={new Date().getUTCFullYear() + 1} value={year} disabled={busy} onChange={(event) => setYear(event.target.value)} /></label>
      <span>{document.source_year == null ? 'Not recorded' : document.source_year}</span>
      <button className={buttonClass} type="submit" disabled={busy}>Save metadata</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}

/** D549: collections group owned files; removing a group never removes files. */
export function CollectionManager({ state, documents, selected, onSelect, showCreate, onShowCreate, onSaved }) {
  const [name, setName] = useState('');
  const [documentUid, setDocumentUid] = useState('');
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = state.items.find((collection) => collection.uid === selected);
  const write = async (operation) => {
    setBusy(true); setError('');
    try { await operation(); await onSaved?.(); }
    catch (cause) { setError(cause?.message || 'The collection could not be updated.'); }
    finally { setBusy(false); }
  };
  return <Card className="p-4 space-y-3" data-testid="library-collections">
    <h3 className="font-bold">Collections</h3>
    {state.loading ? <p>Reading collections…</p> : state.error ? <p role="alert">Unreadable — {state.error} <button type="button" onClick={onSaved}>Retry</button></p> : <>
      <label className="block text-[12px]">Collection<select aria-label="Collection" className={inputClass} value={selected} onChange={(event) => { onSelect(event.target.value); setRename(''); }}><option value="">All documents</option>{state.items.map((collection) => <option key={collection.uid} value={collection.uid}>{collection.name}</option>)}</select></label>
      {!state.items.length && <p className="text-[12px]">No collections yet. Create one to group your own documents.</p>}
      <button type="button" className={ghostButtonClass} onClick={() => onShowCreate(!showCreate)}>New collection</button>
      {showCreate && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); write(async () => { await api.research.createCollection(name.trim()); setName(''); onShowCreate(false); }); }}>
        <label className="min-w-0 flex-1 text-[12px]">Collection name<input className={inputClass} required maxLength={120} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <button type="submit" className={buttonClass} disabled={busy || !name.trim()}>Create collection</button>
      </form>}
      {current && <div className="space-y-2">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); write(() => api.research.renameCollection(current.uid, rename.trim())); }}>
          <label className="min-w-0 flex-1 text-[12px]">Rename collection<input className={inputClass} placeholder={current.name} required maxLength={120} value={rename} disabled={busy} onChange={(event) => setRename(event.target.value)} /></label>
          <button type="submit" className={buttonClass} disabled={busy || !rename.trim()}>Rename</button>
          <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => write(async () => { await api.research.deleteCollection(current.uid); onSelect(''); })}>Delete collection</button>
        </form>
        <p className="text-[11px]">Deleting a collection leaves its documents in your Library.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); write(async () => { await api.research.addCollectionDocument(current.uid, documentUid); setDocumentUid(''); }); }}>
          <label className="min-w-0 flex-1 text-[12px]">Add document<select aria-label="Add document" className={inputClass} required value={documentUid} disabled={busy} onChange={(event) => setDocumentUid(event.target.value)}><option value="">Choose an owned document</option>{documents.filter((document) => !current.document_uids.includes(document.uid)).map((document) => <option key={document.uid} value={document.uid}>{document.title}</option>)}</select></label>
          <button type="submit" className={buttonClass} disabled={busy || !documentUid}>Add to collection</button>
        </form>
        {!current.document_uids.length && <p className="text-[12px]">This collection is empty.</p>}
        {current.document_uids.map((uid) => <div key={uid} className="flex flex-wrap items-center gap-2 text-[12px]"><span>{documents.find((document) => document.uid === uid)?.title || 'Document unavailable'}</span><button type="button" className={ghostButtonClass} disabled={busy} onClick={() => write(() => api.research.removeCollectionDocument(current.uid, uid))}>Remove from collection</button></div>)}
      </div>}
    </>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
