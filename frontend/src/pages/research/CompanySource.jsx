// D7812 (#7812): shared record attribution using the stored publisher and the reviewed inventory.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { researchCompanyPublishersApi } from '../../lib/api/researchCompanyPublishers.js';
import { companySource } from './companySource.js';
const Publishers = createContext(null);
export function CompanyPublisherProvider({ children, inventory = null }) {
  const parent = useContext(Publishers);
  const [read, setRead] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (parent || inventory) return undefined;
    let live = true;
    setRead({ loading: true });
    researchCompanyPublishersApi.list().then(data => { if (live) setRead({ data }); })
      .catch(() => { if (live) setRead({ error: true }); });
    return () => { live = false; };
  }, [parent, inventory, attempt]);
  return <Publishers.Provider value={parent || (inventory ? { data: inventory } : { ...read, retry: () => setAttempt(n => n + 1) })}>{children}</Publishers.Provider>;
}
export function useCompanySource(record) {
  const read = useContext(Publishers);
  return companySource(record, read?.data?.publishers?.find(p => p.source_name === record?.source_name));
}
export function SourceDetails({ record, testId }) {
  const source = useCompanySource(record);
  const read = useContext(Publishers);
  return <div data-testid={testId} className="mt-0.5 break-words text-[11px] text-axal-muted dark:text-gray-400">
    <span>{source.label} · {source.licenceWords} · {source.asOf ? `as of ${source.asOf}` : 'Date not recorded'}</span>
    {source.sourceLink ? <> · <a className="text-axal-violet underline hover:text-violet-800 focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300" href={source.sourceLink} target="_blank" rel="noreferrer">View the {source.label} record ↗</a></> : null}
    {read?.error ? <p>Publisher reference: Unavailable. <button type="button" onClick={read.retry} className="inline-flex min-h-[44px] items-center underline hover:text-violet-800 focus-visible:ring-2 lg:min-h-0">Try again</button></p> : null}
    {source.attribution ? <p>{source.attribution}</p> : null}
  </div>;
}
export function PublisherBoundary({ attribution = false }) {
  const read = useContext(Publishers);
  if (!read || read.loading) return <span>Company publisher inventory: Loading…</span>;
  if (read.error) return <span>Company publisher inventory: Unavailable. <button type="button" onClick={read.retry} className="inline-flex min-h-[44px] items-center underline hover:text-violet-800 focus-visible:ring-2 lg:min-h-0">Try again</button></span>;
  const lines = [...new Set((read.data?.publishers || []).map(p => companySource({ source_name: p.source_name }, p).attribution).filter(Boolean))];
  return <span>{read.data?.label || 'Company publisher inventory: Not recorded'}{attribution ? lines.map(line => <span className="block" key={line}>{line}</span>) : null}</span>;
}
