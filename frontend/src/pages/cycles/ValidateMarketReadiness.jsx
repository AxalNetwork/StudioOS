/**
 * D6010 (#6010) — Market intelligence's stored checks, under its table: the
 * positioning mark, the assumptions mark and the sources list the sizing tool
 * writes (`GET /api/cycles/validate/market-readiness`, D659). A mark that is
 * absent reads "Not recorded" and a source list with none reads "Not recorded",
 * never 0; a failed read says it is unreadable and claims nothing.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cycleValidateApi } from '../../lib/api/cycleValidate';
import { Unrecorded, Unreadable } from '../../ui';

const SECTION = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const LABEL = 'text-[12px] font-semibold text-axal-muted dark:text-gray-400';
const VALUE = 'text-[13px] text-axal-ink dark:text-gray-100';

/** `YYYY-MM-DD` of a stored timestamp, or null when it carries none. */
export function markedOn(at) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(at ?? ''));
  return m ? m[1] : null;
}

/** A source's link, only when it is a web address; anything else is text. */
export function sourceUrl(url) {
  return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

/** The sizing tool's address for this venture. */
export const sizingHref = (projectId) => `/validate/market-intelligence/sizing?project=${encodeURIComponent(projectId)}`;

function Mark({ label, at, testid }) {
  const on = markedOn(at);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2" data-testid={testid}>
      <span className={LABEL}>{label}</span>
      <span className={VALUE}>{on ? `Marked ${on}` : <Unrecorded />}</span>
    </div>
  );
}

/** The part as drawn from one read's outcome; `MarketReadiness` below does the read. */
export function MarketReadinessView({ projectId, status, read, onRetry }) {
  const sources = Array.isArray(read?.sources) ? read.sources : [];
  return (
    <section className={SECTION} data-testid="validate-market-readiness" data-state={status}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Positioning, assumptions and sources</h3>
        {projectId ? <Link to={sizingHref(projectId)} className="text-[12px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="validate-market-readiness-size">Record them in market sizing</Link> : null}
      </div>
      {status === 'loading' ? (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" role="status">Reading the stored checks…</p>
      ) : status === 'unreadable' ? (
        <Unreadable what="The positioning, assumptions and sources" claim="This is not a claim that none are recorded." onRetry={onRetry} />
      ) : (
        <>
          <Mark label="Positioning map" at={read?.positioning_map} testid="validate-market-positioning" />
          <Mark label="Assumptions reviewed" at={read?.assumptions_reviewed} testid="validate-market-assumptions" />
          <div className="flex flex-col gap-1.5" data-testid="validate-market-sources">
            <span className={LABEL}>Sources</span>
            {sources.length === 0 ? (
              <span className={VALUE}><Unrecorded /></span>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {sources.map((s) => {
                  const url = sourceUrl(s.url);
                  return (
                    <li key={s.id} className={VALUE} data-testid="validate-market-source">
                      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">{s.title}</a> : s.title}
                      {s.kind ? <span className="text-axal-muted dark:text-gray-400"> · {s.kind}</span> : null}
                      {markedOn(s.created_at) ? <span className="text-axal-muted dark:text-gray-400"> · added {markedOn(s.created_at)}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default function MarketReadiness({ projectId, read = (id) => cycleValidateApi.marketReadiness(id) }) {
  const [result, setResult] = useState({ key: null, status: 'loading', read: null });
  const [attempt, setAttempt] = useState(0);
  const key = projectId ? `${projectId}|${attempt}` : null;
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    Promise.resolve().then(() => read(projectId))
      .then((r) => { if (alive) setResult({ key, status: r && typeof r === 'object' ? 'ready' : 'unreadable', read: r }); })
      .catch(() => { if (alive) setResult({ key, status: 'unreadable', read: null }); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `read` is a test seam, not a trigger
  if (!projectId) return null;
  const current = result.key === key ? result : { status: 'loading', read: null };
  return <MarketReadinessView projectId={projectId} status={current.status} read={current.read} onRetry={() => setAttempt((n) => n + 1)} />;
}
