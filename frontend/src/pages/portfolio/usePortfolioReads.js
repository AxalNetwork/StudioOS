/**
 * D4817 part 1 (#5311): every Portfolio board's reads, each on its own.
 *
 * `sources` maps a key to `{ call, shape }`. Each read is committed when it
 * settles, whatever the others are doing, so a slow health sweep never holds
 * the positions table on its skeleton, and one failure leaves the panels
 * beside it standing (canvas PFA09: independent panel failures). `retry(key)`
 * asks again for that source alone; `reload()` asks for all of them. A newer
 * read of a source supersedes an older one, and a page that has gone drops
 * what arrives late.
 *
 * Each entry of `reads` is the model's read: `{ state: 'loading' }`,
 * `{ state: 'ok', value }` or `{ state: 'unreadable' }` (see `readOf`). The
 * Worker's own error `detail` is never kept: a member is shown a sentence,
 * not a database string (#5365 F-26).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../../lib/log';
import { readOf } from './portfolioModel';

export function usePortfolioReads(sources) {
  const keys = Object.keys(sources);
  const [reads, setReads] = useState(() => Object.fromEntries(keys.map((k) => [k, { state: 'loading' }])));
  const alive = useRef(true);
  const sequence = useRef({});
  const latest = useRef(sources);
  latest.current = sources;

  const read = useCallback((key) => {
    const source = latest.current[key];
    if (!source) return;
    const mine = (sequence.current[key] = (sequence.current[key] || 0) + 1);
    setReads((r) => ({ ...r, [key]: { state: 'loading' } }));
    let call;
    try { call = Promise.resolve(source.call()); } catch (e) { call = Promise.reject(e); }
    call.then(
      (value) => {
        if (!alive.current || sequence.current[key] !== mine) return;
        setReads((r) => ({ ...r, [key]: readOf({ status: 'fulfilled', value }, source.shape) }));
      },
      (reason) => {
        if (!alive.current || sequence.current[key] !== mine) return;
        reportError(`Portfolio:${key}`, reason);
        setReads((r) => ({ ...r, [key]: { state: 'unreadable' } }));
      },
    );
  }, []);

  const reload = useCallback(() => { Object.keys(latest.current).forEach(read); }, [read]);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => { alive.current = false; };
  }, [reload]);

  return { reads, retry: read, reload };
}
