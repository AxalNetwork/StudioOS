import { useCallback, useEffect, useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { actionGhost, actionPrimary } from '../../ui';
import { googleWorkspace } from '../../lib/api/googleWorkspace';
import { googleWorkspaceBuild } from '../../lib/api/googleWorkspaceBuild.js';
import { workspaceRefusal } from '../../lib/googleWorkspaceWords';
import FromGoogle from './FromGoogle';
import MapColumnsDialog from './MapColumnsDialog';

/**
 * D1093 (#2958), Google Workspace part 4 — From Google on Build (GW3) and the
 * roadmap Sheet's Map columns (GW4), on the Worker side D1093 built
 * (`routes/build_google.ts`):
 *   - Solution design: the shared section (`FromGoogle.jsx`) with each spec
 *     Doc's pending proposal, and Accept or Dismiss, each in an in-page dialog
 *     that says what it changes;
 *   - Product roadmap: the shared section with the roadmap items this
 *     connection owns (Objective, Key result, Quarter, Progress), and the
 *     shared Map columns dialog for the Sheet, saved in the Worker's shape
 *     (`{ header_row, columns: { field: letter } }`).
 *
 * The read is `GET /api/cycles/build/google?project=`; Sync is
 * `POST /sync`. A cell the Sheet left empty reads "—" with its reason, never 0
 * (the shared section draws it). No Doc paragraph is ever shown: the Worker
 * keeps the title and headings only.
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-axal-sm border border-axal-hairline bg-white p-4 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const AMBER = 'flex flex-wrap items-center justify-between gap-2 rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
const ALERT = 'm-0 text-[12.5px] text-red-700 dark:text-red-300';
const BTN = `${actionGhost} min-h-[36px] max-sm:min-h-[44px]`;

/** The roadmap Sheet's fields, in the Worker's names (`MAPPED_FIELDS`). Objective, Quarter and Status are required. */
export const ROADMAP_FIELDS = Object.freeze([
  { key: 'objective', label: 'Objective' },
  { key: 'key_result', label: 'Key result' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Progress' },
]);
export const REQUIRED = Object.freeze(['objective', 'quarter', 'status']);

export const ROADMAP_COLUMNS = Object.freeze([
  { key: 'objective', label: 'Objective' }, { key: 'key_result', label: 'Key result' },
  { key: 'quarter', label: 'Quarter' }, { key: 'progress', label: 'Progress' },
]);
export const DESIGN_COLUMNS = Object.freeze([{ key: 'title', label: 'Spec Doc' }, { key: 'headings', label: 'Headings' }]);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The dialog's `{ column: field }` as the Worker stores it: each field's column letter, from the header row's order. */
export function encodeRoadmap(mapping, header) {
  const columns = {};
  header.forEach((col, i) => { const f = mapping?.[col]; if (f && i < LETTERS.length) columns[f] = LETTERS[i]; });
  return { header_row: 1, columns };
}
/** A saved Worker mapping as the dialog's `{ column: field }`, for its first guess. Anything else guesses afresh. */
export function decodeRoadmap(saved, header) {
  const cols = saved?.columns;
  if (!cols || typeof cols !== 'object') return null;
  const out = {};
  for (const [field, letter] of Object.entries(cols)) {
    const i = LETTERS.indexOf(String(letter));
    if (i >= 0 && i < header.length) out[header[i]] = field;
  }
  return out;
}
/** The required fields a mapping does not name yet. */
export const missingFields = (mapping) => REQUIRED.filter((k) => !mapping?.columns?.[k]);

/** Product roadmap's rows: an empty value stays null, so the section draws "—" with its reason. */
export function roadmapRows(items) {
  return (Array.isArray(items) ? items : []).map((o) => ({
    id: o.id, label: o.objective,
    cells: { objective: o.objective, key_result: o.key_result, quarter: o.quarter, progress: typeof o.progress === 'number' ? `${o.progress}%` : null },
  }));
}
/** Solution design's rows: each pending proposal's title and how many headings it holds. */
export function designRows(proposals) {
  return (Array.isArray(proposals) ? proposals : []).map((p) => ({
    id: p.id, label: p.title,
    cells: { title: p.title, headings: Array.isArray(p.headings) && p.headings.length ? `${p.headings.length} ${p.headings.length === 1 ? 'heading' : 'headings'}` : 'No headings in the Doc' },
  }));
}

/** A sync's totals as one sentence: counts only, never a cell or a heading. */
export function syncSentence(t) {
  if (!t) return '';
  const say = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (t.proposed) parts.push(`${say(t.proposed, 'spec Doc', 'spec Docs')} proposed`);
  if (t.changed) parts.push(`${say(t.changed, 'proposal', 'proposals')} changed`);
  if (t.created) parts.push(`${say(t.created, 'roadmap item', 'roadmap items')} added`);
  if (t.updated) parts.push(`${say(t.updated, 'roadmap item', 'roadmap items')} updated`);
  let s = parts.length ? `${parts.join(', ')}.` : 'Nothing new in your Google files.';
  if (t.held) s += ` ${say(t.held, 'item is', 'items are')} held: another tool also feeds ${t.held === 1 ? 'it' : 'them'}.`;
  if (t.deleted_kept) s += ` ${say(t.deleted_kept, 'item you deleted stays', 'items you deleted stay')} deleted.`;
  if (t.blank) s += ` ${say(t.blank, 'row has', 'rows have')} no objective.`;
  if (t.repeated) s += ` ${say(t.repeated, 'objective is', 'objectives are')} repeated in the Sheet and ${t.repeated === 1 ? 'was' : 'were'} not added.`;
  if (t.needs_mapping) s += ' The roadmap Sheet needs its columns mapped first.';
  if (t.unreadable) s += ` ${say(t.unreadable, 'file', 'files')} could not be read.`;
  return s;
}

/** The read both modules share: the From Google read, re-read after each write. */
export function useBuildGoogle(projectId, api = googleWorkspaceBuild) {
  const [s, setS] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    Promise.resolve().then(() => api.fromGoogle(projectId))
      .then((data) => { if (alive) setS({ status: 'ready', data }); }, (error) => { if (alive) setS({ status: 'error', data: null, error }); });
    return () => { alive = false; };
  }, [projectId, tick, api]);
  return { ...s, reload };
}

function DecideDialog({ kind, proposal, onClose, onDecide }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const accept = kind === 'accept';
  const title = accept ? `Accept “${proposal.title}”?` : `Dismiss “${proposal.title}”?`;
  const go = async () => {
    setBusy(true); setRefusal('');
    try { await onDecide(); onClose(true); } catch (e) { setRefusal(e?.status === 409 ? 'This proposal was already decided. The list is read again.' : workspaceRefusal(e)); setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={() => { if (!busy) onClose(false); }} width={480} testId={`build-google-${kind}`}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={() => onClose(false)} disabled={busy}>Cancel</button>
          <button type="button" className={accept ? actionPrimary : actionGhost} onClick={go} disabled={busy} data-testid={`build-google-${kind}-confirm`}>{busy ? 'Saving…' : accept ? 'Accept' : 'Dismiss'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="m-0" data-testid={`build-google-${kind}-says`}>{accept
          ? 'This writes one Solution design note from the Doc’s title and headings, linked to the Doc. Accepting the same Doc again later updates that note.'
          : 'The proposal is set aside. It comes back only if the Doc’s title or headings change.'}</p>
        <p className={MUTED}>Axal VC never changes the Doc in Google.</p>
        {refusal ? <p role="alert" className={ALERT}>{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

function ReadFailed({ read }) {
  return (
    <section aria-label="From Google" className={CARD} data-testid="build-from-google" data-state="error">
      <h3 className="m-0 text-[14px] font-extrabold">From Google</h3>
      <p className={ALERT}>{read.error?.status === 403 ? workspaceRefusal(read.error) : 'Not recorded: your Google files for Build could not be read. That is not the same as having none.'}{' '}
        <button type="button" className="underline" onClick={read.reload} data-testid="build-from-google-retry">Try again</button></p>
    </section>
  );
}

/** Solution design (GW3, GW6): spec Docs as proposals, each accepted or dismissed by the founder. */
export function SolutionDesignFromGoogle({ projectId, reload: reloadModule = null, api = googleWorkspaceBuild }) {
  const read = useBuildGoogle(projectId, api);
  const [note, setNote] = useState('');
  const [dialog, setDialog] = useState(null);
  if (read.status === 'error') return <ReadFailed read={read} />;
  const proposals = read.data?.proposals ?? [];
  const sync = async () => { const r = await api.sync(projectId); setNote(syncSentence(r?.totals)); read.reload(); };
  return (
    <div className="flex flex-col gap-2" data-testid="build-from-google" data-module="solution_design">
      <FromGoogle project={projectId} module="solution_design" columns={DESIGN_COLUMNS} rows={read.status === 'ready' ? designRows(proposals) : null} onSync={sync} />
      {proposals.length ? (
        <section className={CARD} aria-label="Spec Docs waiting for your review" data-testid="build-google-proposals">
          <h4 className="m-0 text-[13px] font-bold">Waiting for your review</h4>
          <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
            {proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid={`build-google-proposal-${p.id}`}>
                <div className="min-w-0">
                  <p className="m-0 font-semibold">{p.title}</p>
                  {p.headings?.length ? <ul className={`${MUTED} m-0 list-disc pl-5`}>{p.headings.slice(0, 6).map((hd, i) => <li key={i}>{hd}</li>)}</ul> : <p className={MUTED}>No headings recorded in the Doc.</p>}
                </div>
                <span className="flex gap-2">
                  <button type="button" className={BTN} onClick={() => setDialog({ kind: 'accept', p })} data-testid={`build-google-accept-${p.id}`}>Accept</button>
                  <button type="button" className={BTN} onClick={() => setDialog({ kind: 'dismiss', p })} data-testid={`build-google-dismiss-${p.id}`}>Dismiss</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {note ? <p role="status" className={MUTED} data-testid="build-google-sync-note">{note}</p> : null}
      {dialog ? (
        <DecideDialog kind={dialog.kind} proposal={dialog.p}
          onDecide={() => (dialog.kind === 'accept' ? api.accept(projectId, dialog.p.id) : api.dismiss(projectId, dialog.p.id))}
          onClose={(done) => { setDialog(null); read.reload(); if (done && dialog.kind === 'accept') reloadModule?.(); }} />
      ) : null}
    </div>
  );
}

/** Product roadmap (GW3, GW4): the mapped Sheet's items, and Map columns for the Sheet. */
export function RoadmapFromGoogle({ projectId, reload: reloadModule = null, api = googleWorkspaceBuild, files = googleWorkspace }) {
  const read = useBuildGoogle(projectId, api);
  const [note, setNote] = useState('');
  const [mapFile, setMapFile] = useState(null);
  const [opening, setOpening] = useState(false);
  if (read.status === 'error') return <ReadFailed read={read} />;
  const sheet = (read.data?.files ?? []).find((f) => f.module === 'product_roadmap') ?? null;
  const sync = async () => { const r = await api.sync(projectId); setNote(syncSentence(r?.totals)); read.reload(); reloadModule?.(); };
  // The dialog needs the file as the files read gives it (with its saved mapping).
  const openMap = async () => {
    setOpening(true); setNote('');
    try {
      const d = await files.files(projectId);
      const f = (d?.items ?? []).find((x) => x.module === 'product_roadmap' && x.uid === sheet?.uid) ?? null;
      if (f) setMapFile(f); else setNote('The roadmap Sheet could not be found. Choose it again.');
    } catch (e) { setNote(workspaceRefusal(e)); } finally { setOpening(false); }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="build-from-google" data-module="product_roadmap">
      {sheet && sheet.mapped === false ? (
        <div className={AMBER} role="status" data-testid="build-google-needs-mapping">
          <span>“{sheet.name}” lands nothing until its columns are mapped: Objective, Quarter and Status at least.</span>
          <button type="button" className={BTN} onClick={openMap} disabled={opening} data-testid="build-google-map">Map columns</button>
        </div>
      ) : null}
      <FromGoogle project={projectId} module="product_roadmap" columns={ROADMAP_COLUMNS} rows={read.status === 'ready' ? roadmapRows(read.data?.roadmap) : null}
        onSync={sheet?.mapped ? sync : null} />
      {sheet?.mapped ? <button type="button" className={`${BTN} self-start`} onClick={openMap} disabled={opening} data-testid="build-google-remap">Map columns again</button> : null}
      {note ? <p role="status" className={MUTED} data-testid="build-google-sync-note">{note}</p> : null}
      {mapFile ? (
        <MapColumnsDialog file={mapFile} fields={ROADMAP_FIELDS} encode={encodeRoadmap} decode={decodeRoadmap}
          onClose={() => setMapFile(null)}
          onSaved={(saved) => {
            setMapFile(null);
            const missing = missingFields(saved);
            setNote(missing.length ? `Saved. Still to map: ${missing.map((k) => ROADMAP_FIELDS.find((f) => f.key === k).label).join(', ')}.` : 'Saved. Sync from Google to read the Sheet with this mapping.');
            read.reload();
          }} />
      ) : null}
    </div>
  );
}
