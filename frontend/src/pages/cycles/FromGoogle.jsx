import { useCallback, useEffect, useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { Unrecorded, Unreadable, actionDanger, actionGhost } from '../../ui';
import { googleWorkspace } from '../../lib/api/googleWorkspace';
import { chooseWorkspaceFiles, loadWorkspacePicker } from '../../lib/googleWorkspacePicker';
import {
  FROM, deleteRowCopy, moduleLabel, partlyLine, sourceLine, unreadableCopy, workspaceRefusal,
} from '../../lib/googleWorkspaceWords';

/**
 * D1091 (#2956), D1314 §3 — the one From Google section every module that
 * reads a chosen Google file mounts (GW3's frame, GW7's four states). Parts
 * 3–6 (#2957–#2960) mount it with their own rows; none draws its own.
 *
 * WHAT IT READS ITSELF. The module's chosen file, from
 * `GET /api/connectors/google-workspace/files?project=` (its first file for
 * this module). WHAT THE MOUNTING FEED HANDS IT. The rows it read (`rows`,
 * each `{ id, cells }`), the table's `columns`, how many rows it kept back
 * (`deleted`), a partial read (`partly: { read, total, reason }`), and the
 * writes it owns: `onSync`, `onDeleteRow`. A feed that has not read yet hands
 * no rows, and the section says what it is reading.
 *
 * THE STATES (GW7): Loading "Reading…"; Empty, with Choose from Google Drive;
 * Unreadable, with the rows read before kept below and Choose again; Partly
 * synced, with the reason and Sync again. An empty cell is "—" with its
 * reason, never 0. Delete opens an in-page dialog that says the row stays
 * deleted and the file in Google is not changed.
 */

const CARD = 'flex min-w-0 flex-col gap-3 rounded-axal-sm border border-axal-hairline bg-white p-4 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = `${actionGhost} min-h-[36px] max-sm:min-h-[44px]`;
const AMBER = 'm-0 rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
export const FROM_GOOGLE_ID = 'from-google';

const DEFAULT_PICKER = { load: loadWorkspacePicker, choose: chooseWorkspaceFiles };

function DeleteRowDialog({ row, module, file, onClose, onDelete }) {
  const copy = deleteRowCopy({ row: row.label, module, file });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const go = async () => {
    setBusy(true); setRefusal('');
    try { await onDelete(row); onClose(true); } catch (e) { setRefusal(workspaceRefusal(e)); setBusy(false); }
  };
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={() => { if (!busy) onClose(false); }} width={480} testId="from-google-delete"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={() => onClose(false)} disabled={busy}>Cancel</button>
          <button type="button" className={actionDanger} onClick={go} disabled={busy} data-testid="from-google-delete-confirm">{busy ? 'Deleting…' : copy.button}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="m-0" data-testid="from-google-delete-says">{copy.body}</p>
        <p className={`m-0 ${MUTED}`} data-testid="from-google-delete-google">{copy.google}</p>
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

function Rows({ columns, rows, onDelete }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid="from-google-rows">
      <div className="hidden gap-3 border-b border-axal-hairline pb-2 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted sm:grid dark:border-gray-800 dark:text-gray-400"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr)) ${onDelete ? '80px' : ''}` }}>
        {columns.map((c) => <span key={c.key}>{c.label}</span>)}{onDelete ? <span /> : null}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-1 border-b border-axal-hairline py-2 last:border-0 sm:grid sm:items-center sm:gap-3 dark:border-gray-800"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr)) ${onDelete ? '80px' : ''}` }} data-testid="from-google-row">
          {columns.map((c) => {
            const v = r.cells?.[c.key];
            const blank = v == null || String(v).trim() === '';
            return (
              <span key={c.key} className="min-w-0 break-words">
                <span className={`mr-1 text-[11px] font-bold uppercase sm:hidden ${MUTED}`}>{c.label}</span>
                {blank ? <Unrecorded reason={`Not recorded: the ${c.label} cell in the sheet is empty.`}>—</Unrecorded> : String(v)}
              </span>
            );
          })}
          {onDelete ? <button type="button" className={`${BTN} self-start`} onClick={() => onDelete(r)} aria-label={`Delete the row “${r.label}”`} data-testid={`from-google-delete-${r.id}`}>Delete</button> : null}
        </div>
      ))}
    </div>
  );
}

export default function FromGoogle({
  project, module, columns = [], rows = null, deleted = 0, partly = null, onSync = null, onDeleteRow = null,
  picker = DEFAULT_PICKER,
}) {
  const [read, setRead] = useState({ status: 'loading', file: null });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState(null);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', file: r.file }));
    Promise.resolve().then(() => googleWorkspace.files(project))
      .then((d) => { if (alive) setRead({ status: 'ready', file: (d?.items || []).find((f) => f.module === module) || null }); })
      .catch(() => { if (alive) setRead({ status: 'error', file: null }); });
    return () => { alive = false; };
  }, [project, module, tick]);

  // Choose (again): Google's own picker, its own drive.file token; the Worker confirms each id.
  const choose = async () => {
    setBusy(true); setNote('');
    try {
      const [config] = await Promise.all([googleWorkspace.pickerConfig(project), picker.load()]);
      if (!config?.configured) throw Object.assign(new Error('picker_not_ready'), { code: 'picker_not_ready' });
      const ids = await picker.choose(config);
      if (ids.length) { await googleWorkspace.choose(project, module, ids); reload(); }
    } catch (e) {
      setNote(workspaceRefusal(e));
    } finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true); setNote('');
    try { await onSync(); reload(); } catch (e) { setNote(workspaceRefusal(e)); } finally { setBusy(false); }
  };

  const file = read.file;
  const state = read.status === 'loading' || (file && rows === null && file.status !== 'unreadable') ? 'loading'
    : read.status === 'error' ? 'error'
      : !file ? 'empty'
        : file.status === 'unreadable' ? 'unreadable'
          : partly ? 'partly' : 'ready';
  const blanks = (rows || []).some((r) => columns.some((c) => r.cells?.[c.key] == null || String(r.cells[c.key]).trim() === ''));

  return (
    <section id={FROM_GOOGLE_ID} aria-label={FROM.title} className={`${CARD} scroll-mt-6`} data-testid="from-google" data-state={state}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 flex items-center gap-2 text-[14px] font-extrabold">
            <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-md bg-axal-ground text-[12px] font-black dark:bg-gray-800">G</span>{FROM.title}
          </h3>
          <p className={`m-0 mt-0.5 text-[12.5px] ${MUTED}`} data-testid="from-google-source">{sourceLine({ file, state })}</p>
        </div>
        {file && state !== 'loading' ? (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={BTN} onClick={choose} disabled={busy} data-testid="from-google-choose">{FROM.choose}</button>
            {onSync ? <button type="button" className={BTN} onClick={sync} disabled={busy} data-testid="from-google-sync">{busy ? 'Syncing…' : FROM.sync}</button> : null}
          </span>
        ) : null}
      </header>

      {state === 'loading' ? <p className={`m-0 ${MUTED}`} data-testid="from-google-loading">{FROM.loading}</p> : null}
      {state === 'error' ? <Unreadable what={`The Google file for ${moduleLabel(module) || 'this module'}`} claim="That is not the same as having none." onRetry={reload} /> : null}

      {state === 'empty' ? (
        <div className="flex flex-col items-start gap-2" data-testid="from-google-empty">
          <p className="m-0 font-semibold">{FROM.empty}</p>
          <p className={`m-0 ${MUTED}`}>{FROM.emptyNote}</p>
          <button type="button" className={BTN} onClick={choose} disabled={busy} data-testid="from-google-empty-choose">{FROM.choose}</button>
        </div>
      ) : null}

      {state === 'unreadable' ? (() => {
        const copy = unreadableCopy(file, rows?.length || null);
        return (
          <div className={AMBER} role="status" data-testid="from-google-unreadable">
            <p className="m-0 font-semibold">{copy.title}</p>
            <p className="m-0">{copy.body}</p>
            <button type="button" className={`${BTN} mt-2`} onClick={choose} disabled={busy} data-testid="from-google-choose-again">{FROM.chooseAgain}</button>
          </div>
        );
      })() : null}

      {state === 'partly' ? (
        <div className={AMBER} role="status" data-testid="from-google-partly">
          <p className="m-0 font-semibold">{partlyLine(partly.read, partly.total)}</p>
          {partly.reason ? <p className="m-0">{partly.reason}</p> : null}
          {onSync ? <button type="button" className={`${BTN} mt-2`} onClick={sync} disabled={busy} data-testid="from-google-sync-again">{FROM.syncAgain}</button> : null}
        </div>
      ) : null}

      {['ready', 'partly', 'unreadable'].includes(state) && rows?.length ? (
        <Rows columns={columns} rows={rows} onDelete={onDeleteRow ? (r) => setDeleting(r) : null} />
      ) : null}
      {['ready', 'partly'].includes(state) && rows && !rows.length ? <p className={`m-0 ${MUTED}`} data-testid="from-google-no-rows">The file holds no rows this module reads.</p> : null}

      {['ready', 'partly', 'unreadable'].includes(state) && (deleted > 0 || blanks) ? (
        <p className={`m-0 text-[12px] ${MUTED}`} data-testid="from-google-notes">
          {deleted > 0 ? `${deleted} ${deleted === 1 ? 'row you deleted stays' : 'rows you deleted stay'} deleted. ` : ''}
          {blanks ? 'A “—” means the sheet’s cell is empty, so nothing was recorded.' : ''}
        </p>
      ) : null}
      {note ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="from-google-note">{note}</p> : null}

      {deleting ? (
        <DeleteRowDialog row={deleting} module={module} file={file?.name} onDelete={onDeleteRow}
          onClose={(done) => { setDeleting(null); if (done) reload(); }} />
      ) : null}
    </section>
  );
}
