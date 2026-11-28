// D6130 part 2 (#6130): the two reads the first screen adds to the workspace —
// the booklet (What to sign) and the notices (What arrived). Each fails on its
// own: one that could not be read is `unreadable`, never an empty answer.
import { useCallback, useEffect, useState } from 'react';
import { fundBookletsApi } from '../../../lib/api/fundBooklets';
import { fundNoticesApi } from '../../../lib/api/fundNotices';

const LOADING = { status: 'loading' };
const IDLE = { status: 'idle' };

/**
 * `wantsBooklet`: the reader's application is approved or they hold a
 * position (the Worker answers the booklet only for an approved application;
 * 404 is "none"). `wantsNotices`: they hold a position.
 */
export default function useFirstScreenReads({ wantsBooklet, wantsNotices }) {
  const [booklet, setBooklet] = useState(IDLE);
  const [notices, setNotices] = useState(IDLE);

  const reloadBooklet = useCallback(() => {
    setBooklet(LOADING);
    return fundBookletsApi.mine().then(
      (view) => setBooklet({ status: 'ready', view }),
      (e) => setBooklet(e?.status === 404 ? { status: 'none' } : { status: 'unreadable' }),
    );
  }, []);
  const reloadNotices = useCallback(() => {
    setNotices(LOADING);
    return fundNoticesApi.mine().then(
      (r) => setNotices(Array.isArray(r?.notices) ? { status: 'ready', list: r.notices } : { status: 'unreadable' }),
      () => setNotices({ status: 'unreadable' }),
    );
  }, []);

  useEffect(() => { if (wantsBooklet) reloadBooklet(); else setBooklet(IDLE); }, [wantsBooklet, reloadBooklet]);
  useEffect(() => { if (wantsNotices) reloadNotices(); else setNotices(IDLE); }, [wantsNotices, reloadNotices]);

  return { booklet, notices, reloadBooklet, reloadNotices };
}
