/**
 * #4622 (Studio audit 4/5): the investor Studio's two record reads, each on its own.
 *
 * `InvestorStudioHome` read the portfolio and the calendar together and committed
 * both only once both had settled, so a slow calendar held the portfolio tile on
 * its loading state, and one retry asked for both again. Now each source is read,
 * committed and retried by itself:
 *
 *   - a source's answer (or failure) lands when it settles, whatever the other is doing;
 *   - a newer read of a source (a retry, or the viewer changing) supersedes an older
 *     one, and a page that has gone drops what arrives late;
 *   - retry asks again only for the sources that failed, and for the calendar when it
 *     answered but a relevant source inside it did not (a partial answer has no entry
 *     in `failures`); the source that answered stays on the page;
 *   - an admin previewing is withheld (`null`), and reads nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

export function useInvestorSources({ previewing = false, client = api } = {}) {
  const [records, setRecords] = useState({ portfolio: undefined, events: undefined });
  const [failures, setFailures] = useState({});
  const alive = useRef(true);
  const sequence = useRef({ portfolio: 0, events: 0 });
  // listCalendarEvents has no "upcoming" flag contract; filtering locally
  // retains only dated future records and never invents a calendar item.
  const sources = useMemo(() => ({ portfolio: () => client.positionsAnalytics(), events: () => client.listCalendarEvents() }), [client]);

  const read = useCallback((key) => {
    const mine = (sequence.current[key] += 1);
    setRecords((r) => ({ ...r, [key]: undefined }));
    setFailures((f) => { const { [key]: _gone, ...rest } = f; return rest; });
    let call;
    try { call = Promise.resolve(sources[key]()); } catch (e) { call = Promise.reject(e); }
    call.then(
      (value) => { if (alive.current && sequence.current[key] === mine) setRecords((r) => ({ ...r, [key]: value })); },
      (reason) => {
        if (!alive.current || sequence.current[key] !== mine) return;
        reportError(`InvestorStudio:${key}`, reason);
        setFailures((f) => ({ ...f, [key]: reason?.message || 'Source unavailable' }));
      },
    );
  }, [sources]);

  useEffect(() => {
    alive.current = true;
    if (previewing) {
      sequence.current.portfolio += 1; sequence.current.events += 1;
      setRecords({ portfolio: null, events: null });
      setFailures({});
    } else {
      read('portfolio');
      read('events');
    }
    return () => { alive.current = false; };
  }, [previewing, read]);

  const readAll = useCallback(() => { read('portfolio'); read('events'); }, [read]);
  /** Ask again only for what failed; `calendarPartial` adds the calendar when it answered incompletely. */
  const retryFailed = useCallback((calendarPartial = false) => {
    const keys = new Set(Object.keys(failures));
    if (calendarPartial) keys.add('events');
    keys.forEach(read);
  }, [failures, read]);

  return { records, failures, read, readAll, retryFailed };
}
