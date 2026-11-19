// D7180 (#7180, D7046, board RS-18 B RCP04 and RS-18 C RCP05D) — an analysis
// candidate's Signals, on every width (they were hidden below md).
//
// Two groups, never mixed: the signals this analysis's crawl recorded about
// the company (`competitor_signals`), and context that is not about it —
// sector and country signals, read through the candidate's directory profile
// (`directory_uid` → `GET /research/company-directory/:uid` → its tracked
// sector and country → `GET /research/markets/:slug` and
// `GET /research/geographies/:code`), the reads the profile already makes.
// A candidate with no directory match has no context: Not applicable. Each
// signal shows its observed date, or the date it was recorded (`created_at`)
// when `observed_on` is blank, and says so.
import React, { useEffect, useState } from 'react';
import { Card, DataState, Pill, StateChip } from '../../ui';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { relatedSignals } from '../../lib/companyDirectoryView.js';
import { signalDate } from './companyProfileRead.js';

const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

function tone(kind) {
  if (kind === 'pricing') return 'warn';
  if (kind === 'features' || kind === 'funding') return 'info';
  if (kind === 'news' || kind === 'content') return 'ok';
  if (kind === 'careers' || kind === 'hiring') return 'cite';
  return 'neutral';
}

/** Sector and country signals for a directory company, or why there are none. */
function useContext(directoryUid) {
  const [state, setState] = useState({ status: directoryUid ? 'loading' : 'not_applicable', list: [], failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!directoryUid) { setState({ status: 'not_applicable', list: [], failed: false }); return undefined; }
    let alive = true;
    setState({ status: 'loading', list: [], failed: false });
    (async () => {
      try {
        const company = await researchCompaniesApi.get(directoryUid);
        const t = company?.tracked_sector || {};
        const slug = t.status === 'ok' ? t.slug : null;
        const code = t.country_code || null;
        if (!slug && !code) { if (alive) setState({ status: 'not_recorded', list: [], failed: false }); return; }
        const [market, geo] = await Promise.all([
          slug ? researchMarketsApi.get(slug).then((d) => ({ ok: true, d }), () => ({ ok: false })) : { ok: true, d: null },
          code ? researchMarketsApi.geography(code).then((d) => ({ ok: true, d }), () => ({ ok: false })) : { ok: true, d: null },
        ]);
        if (!alive) return;
        const list = relatedSignals(market.d?.signals || [], geo.d?.signals || [])
          .map((s) => ({ ...s, label: s.match === 'Country' ? `Country · ${company?.item?.country || code}` : `Sector · ${t.name || slug}` }));
        setState({ status: 'ok', list, failed: !market.ok || !geo.ok });
      } catch {
        if (alive) setState({ status: 'unreadable', list: [], failed: true });
      }
    })();
    return () => { alive = false; };
  }, [directoryUid, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

export default function CandidateSignals({ name, signals, directoryUid }) {
  const context = useContext(directoryUid);
  return (
    <Card data-testid="candidate-signals">
      <div className={eyebrow}>Signals · {signals.length} about this company{context.status === 'ok' ? ` · ${context.list.length} context` : ''}</div>

      <div className="mt-2.5">
        <h3 className="text-[12.5px] font-extrabold text-axal-ink dark:text-gray-100">About {name || 'this company'} <span className="font-normal text-axal-muted">· from this analysis’s crawl</span></h3>
        {signals.length ? (
          <ul className="mt-1.5 grid gap-2">
            {signals.map((g) => {
              const when = signalDate(g);
              return (
                <li key={g.id || `${g.signal_type}-${g.label}`} className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Pill tone={tone(g.signal_type)}>{g.signal_type}</Pill>
                    <span className="min-w-0 break-words text-[12.5px] text-axal-ink dark:text-gray-100"><strong>{g.label}</strong>{g.detail ? ` — ${g.detail}` : ''}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10.5px] text-axal-muted">
                    {when.label} {when.date}{when.note ? ` · ${when.note}` : ''}
                    {g.source_url ? <> · <a href={g.source_url} target="_blank" rel="noreferrer" className="text-violet-700 underline dark:text-violet-300">source<span className="sr-only"> (opens in a new tab)</span></a></> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-1 text-[12px] text-axal-muted"><StateChip kind="not_applicable" label="None" /> The crawl recorded no signal for this company.</p>}
      </div>

      <div className="mt-4 border-t border-axal-hairline pt-3 dark:border-gray-800">
        <h3 className="text-[12.5px] font-extrabold text-axal-ink dark:text-gray-100">Context · not about this company <span className="font-normal text-axal-muted">· sector and country signals, matched through the directory record</span></h3>
        {context.status === 'not_applicable' ? <p className="mt-1 text-[12px] text-axal-muted"><StateChip kind="not_applicable" label="Context · Not applicable" /> Not linked to a directory company, so no sector or country context.</p>
          : context.status === 'loading' ? <DataState state="loading" size="block" />
          : context.status === 'unreadable' ? <DataState state="unavailable" size="block" what="The context read" claim="This is not zero." onRetry={context.retry} />
          : context.status === 'not_recorded' ? <p className="mt-1 text-[12px] text-axal-muted"><StateChip kind="not_recorded" /> The directory profile has no tracked sector or country to match on.</p>
          : (
            <>
              {context.failed ? <DataState state="unavailable" size="block" what="A context read" claim="This is not zero." onRetry={context.retry} /> : null}
              {context.list.length ? (
                <ul className="mt-1.5 grid gap-2">
                  {context.list.map((s) => (
                    <li key={s.id} className="min-w-0 text-[12.5px]">
                      <span className="mr-2 rounded-full bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-muted dark:bg-gray-800">{s.match}</span>
                      <span className="break-words text-axal-ink dark:text-gray-100">{s.title}</span>
                      <p className="mt-0.5 font-mono text-[10.5px] text-axal-muted">{s.label} · updated {s.updated_at || 'not recorded'} · via the directory profile</p>
                    </li>
                  ))}
                </ul>
              ) : context.failed ? null : <p className="mt-1 text-[12px] text-axal-muted">No signal names this sector or country.</p>}
            </>
          )}
      </div>
    </Card>
  );
}
