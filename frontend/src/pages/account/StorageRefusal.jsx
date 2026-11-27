import { Link } from 'react-router-dom';
import { RECORDING_KEPT } from './storagePageModel';

/**
 * D1171 (#2449), STG4 — the one storage refusal, drawn where the upload
 * happens: the data room upload, the message composer and Record a Session.
 * `refusal` is `storageRefusal(error)` from `storagePageModel.js`, so the
 * sentence and its two links are the same in all three places. A recording
 * adds the canvas's line that one already in progress finishes and is kept.
 */
export default function StorageRefusal({ refusal, recording = false, testId = 'storage-refusal' }) {
  if (!refusal) return null;
  return <div role="alert" className="flex flex-col gap-1.5 rounded-[9px] border-[1.5px] border-red-300 bg-red-50 px-3 py-2 text-[12.5px] dark:border-red-800 dark:bg-red-950/40" data-testid={testId}>
    <p className="m-0 font-semibold text-red-800 dark:text-red-200"><span aria-hidden="true" className="mr-1.5 font-extrabold">!</span>{refusal.text}</p>
    {refusal.links.length > 0 && <p className="m-0 flex flex-wrap gap-2">
      {refusal.links.map((l) => <Link key={l.to} to={l.to} className="rounded-axal-sm border border-red-200 bg-white px-2 py-1 text-[12px] font-semibold text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-gray-900 dark:text-red-200 dark:hover:bg-red-950/60">{l.label}</Link>)}
    </p>}
    {recording && <p className="m-0 text-[12px] text-red-800/80 dark:text-red-200/80" data-testid="storage-refusal-recording">Start returns once there is room. {RECORDING_KEPT}</p>}
  </div>;
}
