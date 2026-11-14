import { useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { errorSentence } from '../account/notionModel';

/**
 * D1089 (#2954, #2405 part 5) — the Accept of a Notion page as a data-room
 * snapshot, on the Data room's From Notion.
 *
 * A new snapshot is for investors under NDA unless the founder chooses Open
 * here; nothing reaches an investor before this Accept. "Update the snapshot"
 * (the page changed after an earlier snapshot) adds a version to the same file
 * and keeps its gate, so it asks nothing more. The Worker reads the page as of
 * now and refuses one that changed since it was proposed.
 */
export const GATE_WORDS = Object.freeze([
  ['nda', 'Investors who signed the NDA', 'Only investors with access who signed your NDA can open it.'],
  ['open', 'Every investor with access', 'Every investor you gave access to the room can open it.'],
]);

/** An update of an earlier snapshot, by the Worker's wording of the proposal. */
export const isUpdate = (proposal) => /^Update the snapshot/.test(String(proposal?.title || ''));

/** The Accept body: the gate for a new snapshot, nothing for an update. */
export const snapshotBody = (proposal, visibility) => (isUpdate(proposal) ? {} : { visibility: visibility || 'nda' });

export default function NotionSnapshotImport({ proposal, onClose, onAccept }) {
  const update = isUpdate(proposal);
  const [visibility, setVisibility] = useState('nda');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await onAccept(snapshotBody(proposal, visibility)); } catch (e) { setError(errorSentence(e, 'The snapshot could not be added. Try again.')); setBusy(false); }
  };
  const title = update ? 'Update the snapshot' : 'Add a snapshot';
  return (
    <Lightbox label={title} title={title} sub={proposal?.title || ''} onClose={() => { if (!busy) onClose(); }} width={480} testId="notion-snapshot-import" phone="sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy} data-testid="notion-snapshot-confirm">{busy ? 'Saving…' : update ? 'Add the new version' : 'Add to the data room'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100">
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="notion-snapshot-what">
          {update
            ? 'The page as it is in Notion now becomes the file’s newest version. The earlier snapshot stays as a version, and the file keeps who can open it.'
            : 'The page as it is in Notion now is saved as a dated file in your data room. Later changes in Notion do not reach it until you update the snapshot.'}
        </p>
        {!update && (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="notion-snapshot-gate">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">Who can open it</legend>
            {GATE_WORDS.map(([v, label, sub]) => (
              <label key={v} className="flex items-start gap-2">
                <input type="radio" name="notion-snapshot-gate" checked={visibility === v} onChange={() => setVisibility(v)} data-testid={`notion-snapshot-${v}`} className="mt-0.5" />
                <span><span className="font-semibold">{label}</span><span className="block text-[12px] text-axal-muted dark:text-gray-400">{sub}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-snapshot-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
