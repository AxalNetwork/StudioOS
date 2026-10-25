import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unreadable } from '../../ui';
import {
  COMPANY_TABS, FIGURES_WAIT, NOT_HELD, NOT_YET, TERMS_WAIT,
  companyHref, companyOf, companyTabOf, holdingLine, reportRows,
} from '../cycles/reportingModel';

/**
 * D1056 (#2427) — the investor's page per portfolio company at
 * `/portfolio/companies/:uid`, with Figures, Reports (`/reports`) and Terms
 * (`/terms`). The header is the investor's own position (`GET /api/positions`);
 * Reports lists this company's updates the investor may read
 * (`GET /api/portfolio-updates?project_id=`, D889's audience rule). Figures
 * and Terms wait for parts 2 and 3, and say so.
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

function Waiting({ id, title, waits }) {
  return (
    <section className={CARD} data-testid={`company-wait-${id}`}>
      <h2 className={H2}>{title}</h2>
      <span className={PILL}>{NOT_YET}</span>
      <p className={MUTED}>{waits}</p>
    </section>
  );
}

function Reports({ projectId }) {
  const [state, setState] = useState({ status: 'loading', rows: [] });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', rows: [] });
    api.portfolioUpdatesList({ project_id: projectId })
      .then((data) => { if (alive) setState({ status: 'ready', rows: reportRows(Array.isArray(data) ? data : data?.items || data?.updates || [], projectId) }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', rows: [] }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  if (state.status === 'loading') return <section className={CARD} aria-busy="true" data-testid="company-reports-loading"><h2 className={H2}>Reports</h2><div className="h-3 w-40 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></section>;
  if (state.status === 'unreadable') return <Unreadable what="This company’s reports" claim="This is not a claim that it sent none." onRetry={() => setReload((n) => n + 1)} />;
  return (
    <section className={CARD} data-testid="company-reports">
      <h2 className={H2}>Reports</h2>
      {!state.rows.length
        ? <p className={MUTED} data-testid="company-reports-none">This company has sent you no update yet.</p>
        : (
          <ul className="m-0 list-none p-0">
            {state.rows.map((r) => (
              <li key={r.key} className="flex items-start justify-between gap-3 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid="company-report-row">
                <div className="min-w-0">
                  {r.href ? <Link to={r.href} className={LINK}>{r.title}</Link> : <span className="font-semibold text-axal-ink dark:text-gray-100">{r.title}</span>}
                  <div className="text-axal-muted dark:text-gray-400">{r.sent ? `Received ${r.sent}` : 'Not sent'}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      <p className={MUTED}>Whether each period was due, late or missing waits for the periods store (part 2).</p>
    </section>
  );
}

export default function PortfolioCompanyPage() {
  const { uid } = useParams();
  const location = useLocation();
  const tab = companyTabOf(location.pathname);
  const [state, setState] = useState({ status: 'loading', position: null });
  const load = useCallback(() => {
    setState({ status: 'loading', position: null });
    return api.positionsList()
      .then((data) => setState({ status: 'ready', position: companyOf(Array.isArray(data) ? data : data?.items || data?.positions || [], uid) }))
      .catch(() => setState({ status: 'unreadable', position: null }));
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  const position = state.position;
  const name = position?.project?.name || 'Company';

  let body;
  if (state.status === 'unreadable') body = <Unreadable what="Your positions" claim="This is not a claim that you hold nothing here." onRetry={load} />;
  else if (state.status === 'loading') body = <div className="h-3 w-48 animate-pulse rounded bg-axal-ground dark:bg-gray-800" aria-busy="true" data-testid="company-loading" />;
  else if (!position || !companyHref(uid)) body = <section className={CARD} data-testid="company-not-held"><p className={MUTED}>{NOT_HELD}</p><Link to="/portfolio/updates" className={LINK}>Back to Reports</Link></section>;
  else if (tab === 'reports') body = <Reports projectId={position.project_id} />;
  else if (tab === 'terms') body = <Waiting id="terms" title="Terms" waits={TERMS_WAIT} />;
  else body = <Waiting id="figures" title="Figures" waits={FIGURES_WAIT} />;

  return (
    <main className="flex min-w-0 flex-col gap-4 px-[22px] pb-[30px] pt-[22px]" data-testid="portfolio-company-page">
      <nav aria-label="Breadcrumb" className="text-[12px] text-axal-muted dark:text-gray-400">
        <Link to="/portfolio/updates" className={LINK}>Portfolio</Link> <span aria-hidden="true">›</span> <span>{name}</span>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{name}</h1>
        {position && <p className={MUTED} data-testid="company-holding">{[position.project?.stage, holdingLine(position)].filter(Boolean).join(' · ')}</p>}
      </header>
      {companyHref(uid) && (
        <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="company-tabs">
          <nav aria-label={name} className="-mb-px flex gap-1 overflow-x-auto">
            {COMPANY_TABS.map((t) => (
              <Link key={t.id} to={companyHref(uid, t.id)} aria-current={t.id === tab ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === tab
                  ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
                  : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
                data-testid={`company-tab-${t.id}`}>
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
      {body}
      <p className={MUTED}>Only what this company sent you. Figures come from its reports, not your bank.</p>
    </main>
  );
}
