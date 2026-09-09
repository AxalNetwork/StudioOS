import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Pill } from '../../ui';
import { api } from '../../lib/api';
import {
  Field, NothingYet, SaveNote, StatedLimit, ZoneBody, ZoneHeading, buttonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { Instrument, NotRecorded, SourceLegend } from '../../workspaces/canvasKit';
import { accentChipClass } from '../../workspaces/shellConfig';

/**
 * Research · Client prep — the brief, with both sides in it.
 *
 * THIS ZONE WAS A REFUSAL UNTIL MIGRATION 218, and the refusal was accurate:
 * half a brief existed — the topic and the questions the client wrote when they
 * asked for the session — and the other half was the client's own record, which
 * `canAccessFounderResource` closes to an advisor by rule. Task #55 is the
 * grant that opens it, under the founder's own hand and scope by scope.
 *
 * ONE CLIENT PER BRIEF, chosen explicitly. The artboard is emphatic —
 * "context changes only through the switcher, never implicitly" — so this page
 * lists what is open to you and you pick one. It never guesses, and it never
 * merges two clients into one view.
 *
 * PROVENANCE IS ON EVERY ROW. The artboard puts it plainly, and its legend
 * spells it out: "Cyan is theirs, amber is ours." A fact the client recorded and
 * a note the firm wrote are different evidence, and a brief that renders them
 * alike is how a reader quotes their own assumption back at a client as if the
 * client had said it. Founder-sourced rows carry the seam chip and are read-only.
 *
 * BOTH SIDES EXIST NOW, AND THIS DOCBLOCK USED TO SAY ONLY ONE DID. It read
 * "there is nothing to render in emerald yet" and it was right: every row
 * `buildRows` emitted was `source: 'client'`, so the artboard's `Ours only` chip
 * matched nothing and `Founder-sourced` matched everything — a filter that
 * selects all or none is prose, not a chip (D51/D53). Migration 222's
 * `research_brief_notes` is the second source, and the four chips are four
 * predicates over two.
 *
 * `Open items` IS A FLAG ON THE FIRM'S ROWS ONLY, which is the same asymmetry
 * seen from the other end: a founder-sourced row is the client's record, quoted,
 * and the firm ticking it off would be editing someone else's fact.
 *
 * THE BRIEF SAYS WHAT IT IS MISSING. A grant carries three scopes and a founder
 * may open one and not the others. The worker returns `withheld` naming each
 * scope it did not read, and this page prints it — because a brief that looked
 * complete while missing the half it was not granted is exactly the failure the
 * old card warned about.
 *
 * AND IT DOES NOT INFER. The artboard's own example is the one to keep: the
 * client's budget reads "Not recorded" rather than being derived from deals they
 * mentioned, "because a number I inferred and then quoted back at them is the
 * fastest way to lose a session's first ten minutes."
 */

/** The four chips, as predicates over the assembled rows. */
const NARROW = {
  ours: (r) => r.source === 'ours',
  client: (r) => r.source === 'client',
  // Only a firm-written row can be open, so this is `Ours only` narrowed
  // further rather than a third axis — and a brief with no open items says so
  // rather than reading as an empty brief.
  open: (r) => r.source === 'ours' && r.open,
};

export default function ClientPrepZone({ zoneActions, zoneFilters, role = 'advisor' }) {
  const [inbox, setInbox] = useState({ loading: true, error: null, items: [] });
  const [chosen, setChosen] = useState(null);
  const [brief, setBrief] = useState({ loading: false, error: null, data: null });
  const [notes, setNotes] = useState([]);
  const [filter, setFilter] = useState('all');
  const [section, setSection] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [switching, setSwitching] = useState(false);

  const loadInbox = useCallback(async () => {
    setInbox((s) => ({ ...s, loading: true }));
    try {
      const res = await api.advisorClientsSharedWithMe();
      const items = res?.items || [];
      setInbox({ loading: false, error: null, items });
      setChosen((c) => c || items[0]?.project_uid || null);
    } catch (e) {
      setInbox({ loading: false, error: e?.detail || e?.message || 'The client list did not load.', items: [] });
    }
  }, []);
  useEffect(() => { loadInbox(); }, [loadInbox]);

  const loadNotes = useCallback(async (projectUid) => {
    if (!projectUid) { setNotes([]); return; }
    try {
      const r = await api.research.briefNotes(projectUid);
      setNotes(r?.items || []);
    } catch {
      // The client's half of the brief is the half that matters; failing to
      // read our own notes must not take it off the screen.
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    if (!chosen) { setBrief({ loading: false, error: null, data: null }); setNotes([]); return undefined; }
    let alive = true;
    setBrief({ loading: true, error: null, data: null });
    api.advisorClientBrief(chosen)
      .then((data) => { if (alive) setBrief({ loading: false, error: null, data }); })
      .catch((e) => {
        if (alive) setBrief({ loading: false, error: e?.detail || e?.message || 'That brief did not load.', data: null });
      });
    loadNotes(chosen);
    return () => { alive = false; };
  }, [chosen, loadNotes]);

  const data = brief.data;
  const rows = useMemo(() => [...buildRows(data), ...notes.map(noteRow)], [data, notes]);
  const visible = NARROW[filter] ? rows.filter(NARROW[filter]) : rows;
  const active = inbox.items.find((i) => i.project_uid === chosen);
  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));

  const clientRows = rows.filter((r) => r.source === 'client').length;
  const ourRows = rows.filter((r) => r.source === 'ours').length;
  const openItems = rows.filter(NARROW.open).length;

  const addNote = async (e) => {
    e.preventDefault();
    if (!chosen || !section.trim() || !body.trim()) return;
    setBusy(true); setNote(null);
    try {
      await api.research.briefNoteCreate(chosen, section.trim(), body.trim());
      setSection(''); setBody('');
      setNote({ ok: true, text: 'Added to the brief, marked open.' });
      await loadNotes(chosen);
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That note could not be saved.' });
    } finally { setBusy(false); }
  };

  const setOpen = async (uid, open) => {
    setBusy(true); setNote(null);
    try {
      await api.research.briefNoteSetOpen(uid, open);
      await loadNotes(chosen);
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be changed.' });
    } finally { setBusy(false); }
  };

  const handlers = {
    // `Attach to proposal` needs a proposal of the caller's own, and the page
    // has no picker for one. Rather than a control that opens nothing, it links
    // to where a firm's quotes live and carries the client through.
    attachToProposal: {
      onClick: () => { window.location.assign('/quotes'); },
      disabled: !active,
      title: active ? `attach this brief to one of your proposals` : 'pick a client first',
    },
    switchClient: {
      onClick: () => setSwitching((v) => !v),
      disabled: inbox.items.length < 2,
      title: inbox.items.length < 2 ? 'only one client has opened a record to you' : 'change which client this brief is for',
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
        title={active ? `Client brief — ${active.project_name}` : 'Client prep'}
        sub="One client. Founder-sourced rows are read-only."
        /* THE ARTBOARD'S SCOPE PILL, WITH THE SWITCHER INSIDE IT. The picker was
           a separate card below the heading, which is the same control in a
           place that does not say what it scopes. Here the pill names the
           client and carries the affordance that changes it — which is what
           "context changes only through the switcher" looks like on screen. */
        action={active ? (
          <button
            type="button"
            onClick={handlers.switchClient.onClick}
            disabled={handlers.switchClient.disabled}
            title={handlers.switchClient.title}
            className="inline-flex items-center gap-2 rounded-[7px] border border-gray-200 bg-white px-2.5 py-[5px] text-[11px] font-bold text-gray-700 disabled:cursor-default disabled:opacity-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            {active.project_name}
            {inbox.items.length > 1 && <span className="font-semibold text-gray-500">⌄ switch client</span>}
          </button>
        ) : null}
      />

      <ZoneBody
        loading={inbox.loading}
        error={inbox.error}
        isEmpty={!inbox.items.length}
        onRetry={loadInbox}
        empty={(
          <NothingYet
            title="No client has opened their record to you"
            body={role === 'partner'
              ? 'A client brief is assembled from a record the founder opens to a named reader. Nothing here requests one — an empty list means none is open, not that a request is pending.'
              : 'A founder opens their record to you by name, and chooses how much of it. Until one does, the half of a brief you already hold is on Practice · Sessions: what the client wrote when they asked for the session.'}
          />
        )}
      >
        {switching && inbox.items.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {inbox.items.map((i) => (
              <button
                key={i.project_uid}
                type="button"
                onClick={() => { setChosen(i.project_uid); setSwitching(false); }}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  chosen === i.project_uid
                    ? accentChipClass(role)
                    : 'border-axal-hairline text-gray-600 dark:border-gray-700 dark:text-gray-300'
                }`}
              >
                {i.project_name}
              </button>
            ))}
          </div>
        )}

        {/* THE ARTBOARD'S FOUR TILES. Three count rows; the fourth is the
            reader's-data case D68 draws rather than hides — a client who has
            never shared a budget is a fact about this engagement and one of the
            most useful lines on the page. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat4 label="Brief rows" value={data ? rows.length : undefined} note={`${ourRows} written by you`} />
          <Stat4 label="Founder-sourced" value={data ? clientRows : undefined} note="read-only — from their own record" />
          <Stat4 label="Open items" value={data ? openItems : undefined} note="on your own rows, not on theirs" />
          <Stat4 label="Their budget" nr note="not in anything they have shared" />
        </div>

        {brief.loading && <p className="text-[12.5px] text-gray-600 dark:text-gray-300">Assembling the brief…</p>}
        {brief.error && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
              {brief.error} Nothing is shown rather than an empty brief, because an empty brief
              would say this client has told you nothing — and that is not something this page
              can currently know.
            </p>
          </Card>
        )}

        {data && (
          <>
            <SourceLegend
              theirs="Founder-sourced"
              theirsNote="read-only — came from the client’s own record"
              ours="Ours"
              oursNote="written by you, yours to settle or remove"
            />

            <Instrument
              testid="client-brief"
              title={active ? `${active.project_name} — brief` : 'Brief'}
              meta="Cyan is theirs, amber is ours"
              cols="1.3fr 3fr"
              head={['Section', 'What it says']}
              rows={visible.map((r, i) => ({
                key: r.uid || `row-${i}`,
                rowClass: r.value == null ? 'bg-gray-50/60 dark:bg-gray-900/40' : '',
                cells: [
                  {
                    text: r.section,
                    seam: r.source === 'client' ? 'Founder-sourced' : null,
                    ours: r.source === 'ours' ? 'Ours' : null,
                  },
                  {
                    text: r.value,
                    nr: r.value == null,
                    sub: r.sub,
                    node: r.source === 'ours' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setOpen(r.uid, !r.open)}
                        className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      >
                        {r.open ? 'Mark settled' : 'Reopen'}
                      </button>
                    ) : null,
                  },
                ],
              }))}
              note={`${clientRows} of these rows came from the client's own record and are quoted, not rewritten — which matters because the person who opened it to you is not necessarily the person who will read what you write back. Your own ${ourRows === 1 ? 'row is' : `${ourRows} rows are`} yours to settle; theirs are not yours to tick off. Nothing here is inferred: a figure the client has never stated reads "Not recorded" rather than being derived from something they mentioned.`}
            />

            {!visible.length && rows.length > 0 && (
              <p className="text-[12px] text-gray-600 dark:text-gray-300">
                {filter === 'open'
                  ? 'Nothing on this brief is still open.'
                  : 'No row in this brief matches this view.'}
              </p>
            )}

            {data.withheld_note && (
              <Card variant="dashed" padding="lg">
                <p className="text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300">{data.withheld_note}</p>
              </Card>
            )}

            {/* THE SECOND SOURCE, WHERE IT IS WRITTEN. Without a form on this
                page the `Ours only` chip would be live over a store nothing
                fills, which is a dead chip with extra steps. */}
            <Card padding="lg">
              <form onSubmit={addNote}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Section" hint="Your own heading — “Still open”, “What changed”.">
                    <input className={inputClass} value={section} onChange={(e) => setSection(e.target.value)} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="What it says" hint="Written by you. It carries the amber mark and never the seam.">
                      <input className={inputClass} value={body} onChange={(e) => setBody(e.target.value)} />
                    </Field>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="submit" className={buttonClass} disabled={busy || !section.trim() || !body.trim()}>
                    {busy ? 'Adding…' : 'Add a row of your own'}
                  </button>
                </div>
                <SaveNote note={note} />
              </form>
            </Card>

            {data.shared_documents?.length > 0 && (
              <Card padding="lg">
                <h3 className="text-sm font-extrabold tracking-tight">Documents the client sent you</h3>
                <ul className="mt-2 divide-y divide-axal-ground dark:divide-gray-800">
                  {data.shared_documents.map((d) => (
                    <li key={d.uid} className="flex flex-wrap items-baseline gap-2 py-2 text-[12.5px]">
                      <span>{d.title}</span>
                      {/* THE SAME REACH THE LIBRARY REPORTS, IN THE SAME WORDS.
                          A shared document is indexed in the client's namespace,
                          which Ask never searches for you, so "Answerable in
                          Ask" was wrong here — and wrong in the one place a
                          reader would act on it. */}
                      <Pill tone="neutral">Indexed in their library, not yours</Pill>
                      <Pill tone="seam" className="!text-[9.5px]">From the client</Pill>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <ZoneDraft
              surface="research/client-prep"
              scopeKey={chosen || ''}
              label="Draft · checkpoint brief"
              accept="Accept brief"
              run="Draft the brief"
              foot="Read-only rows quoted, never rewritten."
              empty="Gathers the rows above into a one-page brief, keeping founder-sourced facts attributed to the client and your own to you."
              nothingToDraft="There is nothing on this brief to gather yet."
            />
          </>
        )}
      </ZoneBody>

      <StatedLimit title="What this brief will not do">
        <p>
          It quotes what the client recorded; it never rewrites it, and it never derives a figure
          they did not state. Their budget reads &ldquo;Not recorded&rdquo; rather than being
          inferred from deals they mentioned &mdash; a number you inferred and then quoted back at
          them is the fastest way to lose a session&rsquo;s first ten minutes.
        </p>
        <p>
          A brief exists because a founder opened their record to you. Nothing here asks for one,
          and nothing here creates one: an empty list means none is open, not that a request is
          pending.
        </p>
      </StatedLimit>
    </div>
  );
}

/**
 * A strip tile. `Stat` would print an em-dash for a null, which reads as a
 * value, and `NotRecorded` is the artboard's own chip for the fourth tile —
 * so the two shapes live in one small component rather than in four call sites.
 */
function Stat4({ label, value, note, nr = false }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300">{label}</div>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
            {value === undefined ? '—' : value}
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </Card>
  );
}

/** One firm-written note, in the shape the table reads. */
function noteRow(n) {
  return {
    uid: n.uid,
    section: n.section,
    value: n.body,
    source: 'ours',
    open: n.open,
    sub: n.open ? 'Still open' : 'Settled',
  };
}

/**
 * The brief's founder-sourced rows, each carrying where it came from.
 *
 * Only what the payload actually contains. A scope the founder did not open
 * produces no rows at all rather than a row reading "not available", because
 * the reason belongs in one place — `withheld_note` — and not repeated per
 * line where it would read as a data gap rather than a grant boundary.
 */
function buildRows(data) {
  if (!data) return [];
  const out = [];
  if (data.client) {
    out.push({ section: 'Client', value: data.client.name, source: 'client' });
    out.push({ section: 'Sector', value: data.client.sector, source: 'client' });
    out.push({ section: 'Stage', value: data.client.stage, source: 'client' });
  }
  if (data.room) {
    out.push({
      section: 'Data room',
      value: `${data.room.open} file${data.room.open === 1 ? '' : 's'} open to you`
        + (data.room.withheld_behind_nda
          ? ` · ${data.room.withheld_behind_nda} behind an NDA, as a count and never the names`
          : ''),
      source: 'client',
    });
  }
  for (const s of data.other_sessions || []) {
    out.push({
      section: 'Their other sessions',
      value: [s.topic, s.status].filter(Boolean).join(' · '),
      source: 'client',
    });
  }
  return out;
}
