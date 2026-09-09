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

const STATE_LABEL = {
  indexed: 'Answerable',
  pending: 'Reading…',
  unsupported: 'Not answerable',
  failed: 'Not answerable',
};
const STATE_TONE = {
  indexed: 'ok',
  pending: 'neutral',
  unsupported: 'warn',
  failed: 'danger',
};

const KINDS = [
  { value: 'document', label: 'Document' },
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
 * `Primary sources` IS THE ONE TILE STILL NOT DRAWN, and it is the D56 case
 * unchanged: nothing on a document records whether it is the reader's own
 * research or a bought report, `kind` is document/playbook/client, and no
 * upload can classify one any other way. Its `value` returns null and the tile
 * is absent. The reason lives here, where whoever adds the field reads it.
 */
const LIBRARY_STRIP = {
  advisor: [
    { label: 'Documents', value: (x) => x.total, note: (x) => `${x.clientDocs} client, ${x.reusable} reusable` },
    { label: 'Indexed', value: (x) => x.indexed, note: () => 'answerable in Ask' },
    { label: 'Not indexed', value: (x) => x.notIndexed, note: () => 'invisible to Ask until indexed' },
    { label: 'From clients', value: (x) => x.fromClients, note: () => 'read-only, opened to you through a grant' },
  ],
  founder: [
    { label: 'Documents', value: (x) => x.total, note: (x) => `${x.indexed} answerable by Ask` },
    { label: 'Primary sources', value: () => null, note: () => '' },
    { label: 'Questions asked', value: (x) => x.asked, note: (x) => `${x.noSource} came back with no source` },
    {
      label: 'Cost per question',
      value: (x) => (x.asked ? formatCost(x.spend / x.asked) : null),
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
  const [note, setNote] = useState(null);
  const [kind, setKind] = useState('document');
  const [title, setTitle] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      setState({ loading: false, error: '', payload: await api.research.documents() });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your library could not be read.', payload: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // THE ASK HISTORY, READ HERE TOO, AND ONLY ON THE LICENCES WHOSE ARTBOARD
  // ASKS FOR IT. Founder's and investor's Library artboards open with
  // `Questions asked` and `Cost per question` — figures about Ask, on the
  // Library page, because the two zones are one system and the artboards say so
  // from both ends. A failure here leaves those two tiles undrawn rather than
  // failing the page: the documents are what this zone is for.
  const [ask, setAsk] = useState(null);
  const wantsAsk = LIBRARY_STRIP[role] === LIBRARY_STRIP.founder;
  useEffect(() => {
    if (!wantsAsk) return undefined;
    let live = true;
    api.research.askSessions('all')
      .then((r) => { if (live) setAsk(r?.totals || null); })
      .catch(() => {});
    return () => { live = false; };
  }, [wantsAsk]);

  const upload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setNote({ ok: false, text: 'Choose a file first.' }); return; }
    setBusy(true); setNote(null);
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
    } finally { setBusy(false); }
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
    if (filter === 'client' || filter === 'playbook') return d.kind === filter;
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
  const ctx = {
    total: items.length,
    indexed: payload?.indexed ?? 0,
    notIndexed: payload?.not_indexed ?? 0,
    fromClients: payload?.from_clients ?? 0,
    clientDocs: items.filter((d) => d.kind === 'client').length,
    reusable: items.filter((d) => d.kind === 'playbook').length,
    asked: ask?.asked ?? 0,
    noSource: ask?.no_source ?? 0,
    spend: ask?.cost_usd ?? 0,
  };

  const reindex = async (uid) => {
    setBusy(true); setNote(null);
    try {
      await api.research.reindex(uid);
      setNote({ ok: true, text: 'Reading it again — the state below updates when Ask can use it.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be re-indexed.' });
    } finally { setBusy(false); }
  };

  // `Re-index` acts on every own document that Ask cannot currently read, which
  // is what the ops row means on a page listing the whole library. It is
  // disabled with a reason rather than hidden when there is nothing to re-run —
  // a control that vanishes leaves a reader wondering whether it ever existed.
  const stale = items.filter((d) => d.source !== 'client' && d.index_state !== 'indexed');
  const handlers = {
    addDocument: () => fileRef.current?.click(),
    reindex: {
      onClick: () => stale.forEach((d) => reindex(d.uid)),
      disabled: busy || stale.length === 0,
      title: stale.length === 0
        ? 'every document you own is already indexed'
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
        title="Your library"
        blurb="The documents Ask reads from. What is answerable here is exactly what Ask can cite."
        action={payload ? (
          <Pill tone={payload.not_indexed > 0 ? 'warn' : 'ok'}>
            {payload.indexed} answerable
            {payload.not_indexed > 0 ? ` · ${payload.not_indexed} not` : ''}
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

      {/* Cyan is theirs, amber is ours — rendered only where the table can
          actually carry both marks. A legend over rows that are all one source
          explains a distinction the reader cannot see, which is the same defect
          as a filter chip that selects everything. */}
      {ctx.fromClients > 0 && (
        <SourceLegend
          theirs="From a client"
          theirsNote="read-only — opened to you through a grant"
          ours="Ours"
          oursNote="uploaded by you, yours to change"
        />
      )}

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
        <Instrument
          testid="library-documents"
          title="Library"
          meta="Index state is Ask’s reach, stated as a column"
          cols="2.2fr 1fr 1fr .9fr 1.4fr"
          head={['Document', 'Kind', 'Added', 'Index state', 'In Ask']}
          rows={visible.map((d) => ({
            key: d.uid,
            // The row a reader has to act on, tinted so the eye finds it before
            // the column does. `In Ask` says what it means; the tint says where.
            rowClass: d.in_ask ? '' : 'bg-amber-50/40 dark:bg-amber-950/20',
            cells: [
              {
                text: d.title,
                // Cyan is theirs, amber is ours — the legend above says which,
                // and the marks are the artboard's `seam` and `ours`.
                seam: d.source === 'client' ? (d.source_label || 'From client') : null,
                ours: d.source === 'client' ? null : 'Ours',
                sub: fmtBytes(d.size_bytes) || 'Size not recorded',
              },
              { pill: KINDS.find((k) => k.value === d.kind)?.label || d.kind, pillTone: KIND_TONE[d.kind] || 'neutral' },
              // `Added`, not the artboard's own word for this slot. It means
              // the source's own date — the thing that makes a 2023 report
              // stale — and nothing records it; `created_at` is when the file
              // arrived here, which is a different fact.
              { text: String(d.created_at || '').slice(0, 10), nr: !d.created_at },
              {
                pill: STATE_LABEL[d.index_state] || d.index_state,
                pillTone: STATE_TONE[d.index_state] || 'neutral',
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
                text: d.in_ask
                  ? 'Answerable in Ask'
                  : (d.source === 'client'
                    ? 'Indexed in their library, not yours'
                    : 'Not answerable until indexed'),
                node: (
                  <>
                    <button type="button" className={ghostButtonClass} onClick={() => download(d.uid)}>
                      Open
                    </button>
                    {/* A CLIENT'S DOCUMENT OFFERS NEITHER. Removing it is not
                        the reader's to do — the route 404s on it, because it is
                        not in their own set — and re-indexing it would index
                        into a namespace it does not belong to. Drawing either
                        would be a control that cannot act. */}
                    {d.source !== 'client' && (
                      <>
                        <button
                          type="button" disabled={busy} onClick={() => reindex(d.uid)}
                          className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          Re-index
                        </button>
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
          }))}
          note={`Ask reaches exactly the ${ctx.indexed} indexed ${ctx.indexed === 1 ? 'document' : 'documents'} you own. Adding a document and making it answerable are two acts, and the last column is where the second one becomes visible — a file on the shelf that Ask cannot read is invisible to every question asked upstairs.`}
        />

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
