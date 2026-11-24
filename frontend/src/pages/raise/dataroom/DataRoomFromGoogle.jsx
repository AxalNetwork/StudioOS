import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import { googleWorkspace } from '../../../lib/api/googleWorkspace';
import { cyclesApi, cyclesWrite } from '../../../lib/api/cycles.js';
import { FROM } from '../../../lib/googleWorkspaceWords';
import FromGoogle from '../../cycles/FromGoogle';
import { COLUMNS, COPY_ACCESS_LINE, GOOGLE_PAGE, chosenHere, copyRows, googleState, partlyOf, revokedLine, syncLine } from './dataRoomGoogleModel.js';

/**
 * D6075 (#6075, canvas DR30): From Google on Upload. Only a member whose Google account is connected sees the option:
 * the shared section (`cycles/FromGoogle.jsx`, GW3 and GW7's states) with the copies already in the room, each "From
 * Google Drive, as of <date>". Sync copies each chosen file once; the Worker applies the 20 MB cap, the storage
 * check and the NDA with access "nobody" (D1094), and a copy the founder deleted stays deleted. A member who chose
 * files here and whose connection was revoked reads that, with the copies kept. No route is added.
 */
const CARD = 'flex min-w-0 flex-col gap-2 rounded-axal-sm border border-axal-hairline bg-white p-4 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'm-0 text-[12px] text-axal-muted dark:text-gray-400';
const AMBER = 'm-0 flex flex-wrap items-center gap-2 rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';

const DEFAULT_API = Object.freeze({ googleWorkspace, cyclesApi, cyclesWrite });

export default function DataRoomFromGoogle({ projectId, onCopied, api = DEFAULT_API, picker }) {
  const [mine, setMine] = useState({ status: 'loading' });
  const [module, setModule] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const [counts, setCounts] = useState(null);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setMine({ status: 'loading' });
    Promise.resolve().then(() => api.googleWorkspace.mine())
      .then((data) => { if (alive) setMine({ status: 'ready', data }); })
      .catch(() => { if (alive) setMine({ status: 'error' }); });
    return () => { alive = false; };
  }, [api, tick]);

  const connected = mine.status === 'ready' && mine.data?.state === 'ready';
  useEffect(() => {
    if (!connected || projectId == null) return undefined;
    let alive = true;
    setModule({ status: 'loading' });
    Promise.resolve().then(() => api.cyclesApi.module('raise', projectId, 'data-room'))
      .then((data) => { if (alive) setModule({ status: 'ready', data }); })
      .catch(() => { if (alive) setModule({ status: 'error' }); });
    return () => { alive = false; };
  }, [api, connected, projectId, tick]);

  const state = googleState({ mine, module }, projectId);
  if (state === 'hidden' || state === 'reading' || state === 'unavailable') return null;

  if (state === 'unreadable') {
    return (
      <section aria-label={FROM.title} className={CARD} data-testid="dataroom-google" data-state="unreadable">
        <Unreadable what="Your Google files for this room" claim="That is not the same as having none." onRetry={reload} />
      </section>
    );
  }
  if (state === 'revoked') {
    const n = chosenHere(mine.data, projectId).length;
    return (
      <section aria-label={FROM.title} className={CARD} data-testid="dataroom-google" data-state="revoked">
        <h3 className="m-0 text-[14px] font-extrabold">{FROM.title}</h3>
        <p className={AMBER} role="status" data-testid="dataroom-google-revoked">
          <span aria-hidden="true" className="font-extrabold">!</span>{revokedLine(mine.data.state, n)}
          <Link to={GOOGLE_PAGE} className="font-semibold underline" data-testid="dataroom-google-reconnect">Open the Google page</Link>
        </p>
      </section>
    );
  }

  const part = module.data.parts.google;
  const chosen = Array.isArray(part.files) ? part.files.length : 0;
  const sync = async () => {
    const out = await api.cyclesWrite.raise.googleSync(projectId);
    setCounts(out?.counts || null);
    reload();
    if ((Number(out?.counts?.copies_added) || 0) + (Number(out?.counts?.copies_replaced) || 0) > 0) onCopied?.();
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid="dataroom-google" data-state="section">
      <FromGoogle project={projectId} module="data_room" columns={COLUMNS} rows={copyRows(part)}
        deleted={Number(part.deleted_kept) || 0} partly={partlyOf(counts, chosen)} onSync={sync}
        {...(picker ? { picker } : {})} />
      <p className={MUTED} data-testid="dataroom-google-access">{COPY_ACCESS_LINE}</p>
      {counts ? <p className={MUTED} role="status" data-testid="dataroom-google-synced">{syncLine(counts)}</p> : null}
    </div>
  );
}
