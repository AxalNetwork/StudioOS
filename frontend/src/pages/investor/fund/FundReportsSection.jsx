import { Link } from 'react-router-dom';
import React from 'react';
import { LP_ONLY, LP_ONLY_PHRASE } from '../../../lib/spinoutFundFigures';
import { CARD, MONO, LBL, REPORT_PKG, LADDER, TONES, SectionLabel } from './FundWorkspaceSupport';
import { Loader2, FileDown, Lock, Check, FileText } from 'lucide-react';
import { EmailGp } from '../../SpinoutLabLpCommitment';
import GpReportDesk from './GpReportDesk';

export default function FundReportsSection({
  F, kpis, ARCHIVE_FILTERS, setArchiveFilter, archiveFilter, archive, hasReports, holding, generateReport, reportBusy, reportErr, ambiguousFund, portal, state, chipTone, chipText, derived, commitLabel, isAdmin
}) {
return (
<section id="reports" aria-label="Reports" tabIndex={-1} className="space-y-6 scroll-mt-6">
      {/* underwriting */}
      <div>
        <SectionLabel right={(
          <span className="text-[11.5px] text-gray-400 dark:text-gray-500" data-testid="underwriting-provenance">
            {F.portfolio
              ? `From the fund’s position and mark records · as of ${F.portfolio.asOf}`
              : LP_ONLY}
          </span>
        )}>
          Underwriting data · portfolio to date
        </SectionLabel>
        {F.portfolio ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="underwriting-kpis">
            {kpis.map(([k, v, note]) => (
              <div key={k} className={`${CARD} p-4`}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{k}</div>
                <div className={`${MONO} mt-1 text-lg font-bold text-gray-900 dark:text-gray-100`}>{v}</div>
                <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{note}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`${CARD} px-5 py-4 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400`}>
            Positions, capital deployed, marks, follow-ons and MOIC are {LP_ONLY_PHRASE}.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* reporting */}
        <div>
          <SectionLabel>Fund operations &amp; reporting</SectionLabel>
          <div className={`${CARD} p-5`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className={LBL}>Report archive</div>
              <div className="flex flex-wrap gap-1">
                {ARCHIVE_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setArchiveFilter(f)}
                    className={`rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${
                      archiveFilter === f
                        ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {f === 'all' ? 'All' : f}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
              {archive.map((row) => {
                const generable = row.kind !== 'external' && hasReports && !!holding;
                return (
                  <div key={row.key} className="grid grid-cols-[1.9fr_.7fr_.8fr_auto] items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <div className={`truncate text-xs font-semibold ${hasReports ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{row.readHref && hasReports ? <Link to={row.readHref}>{row.title}</Link> : row.title}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500">
                        {row.kind === 'external' ? row.from
                          : row.kind === 'interim' ? 'Generated from your account · marked draft until the GP issues the period'
                            : 'Issued by the General Partner'}
                      </div>
                    </div>
                    <div className={`${MONO} text-[11px] text-gray-600 dark:text-gray-400`}>{row.period}</div>
                    <div className={`${MONO} text-[11px] text-gray-500 dark:text-gray-400`}>{row.issued}</div>
                    <div>
                      {generable ? (
                        <button
                          type="button"
                          onClick={() => generateReport(row)}
                          disabled={reportBusy === row.key}
                          data-testid={`generate-report-${row.key}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 px-2.5 py-1 text-[10.5px] font-bold text-violet-700 dark:text-violet-300 disabled:opacity-60"
                        >
                          {reportBusy === row.key
                            ? <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                            : <FileDown size={11} aria-hidden="true" />}
                          {reportBusy === row.key ? 'Building…' : row.kind === 'interim' ? 'Draft' : 'Download'}
                        </button>
                      ) : row.kind === 'external' ? (
                        <span className="text-[10.5px] font-semibold text-gray-400 dark:text-gray-500">Not in platform</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-gray-400 dark:text-gray-500">
                          <Lock size={11} /> Locked
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {archive.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500">No documents of this type.</div>
              )}
            </div>
            {reportErr && (
              <p className="mt-2 text-[11.5px] text-red-600 dark:text-red-400">{reportErr}</p>
            )}
            {!hasReports && (
              <p className="mt-3 text-[11.5px] text-gray-400 dark:text-gray-500">
                Archive metadata is visible to invited investors; documents unlock after acceptance.
                Committed LPs receive the complete reporting package below.
              </p>
            )}
            {hasReports && !holding && (
              <p className="mt-3 text-[11.5px] text-amber-700 dark:text-amber-400">
                {ambiguousFund
                  ? 'You hold more than one fund and this one has no slug set, so a statement cannot be attributed to it. Ask the GP to set the fund slug.'
                  : 'No limited-partner position was found for your account in this fund, so there is nothing to report on yet.'}
              </p>
            )}
            {hasReports && holding && !portal?.report_periods?.length && (
              <p className="mt-3 text-[11.5px] text-gray-500 dark:text-gray-400">
                The General Partner has not issued a quarterly period yet. The interim statement above is generated
                from your own commitment, capital calls and distributions, and is marked draft until a period is issued.
              </p>
            )}
            <div className="mt-4 rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/20 p-4">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                Committed LPs receive
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {REPORT_PKG.map((p) => (
                  <div key={p} className="flex gap-2 text-[11.5px] leading-snug text-gray-600 dark:text-gray-400">
                    <span className="flex-none font-bold text-violet-600 dark:text-violet-400">·</span>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* rights ladder + IR */}
        <div className="flex flex-col gap-5">
          <div>
            <SectionLabel>Participation rights</SectionLabel>
            <div className={`${CARD} p-5`}>
              {LADDER.map(([title, need, desc], i) => {
                const on = (({ visitor: 0, pending: 0, approved: 1, committed: 2, voting: 3 })[state] ?? 0) >= need;
                return (
                  <div key={title} className="flex gap-3 pb-4 last:pb-0">
                    <div className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                      on ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                    }`}>
                      {on ? <Check size={13} /> : i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12.5px] font-bold ${on ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{title}</div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-gray-500 dark:text-gray-400">{desc}</div>
                    </div>
                  </div>
                );
              })}
              <div className={`mt-1 rounded-xl px-4 py-3 ${TONES[chipTone]}`}>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Your access</div>
                <div className="text-[12.5px] font-bold">
                  {chipText}
                  {derived.commitmentK > 0 && ` · ${commitLabel} committed`}
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Investor relations</SectionLabel>
            <div className={`${CARD} p-5`}>
              <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                Questions on terms, capacity, anchor commitments or the diligence data room are
                handled directly by the GP.
              </p>
              <div className="mt-3 flex gap-2">
                <EmailGp portal={portal} />
                {derived.holdings > 0 && (
                  <a href="#my-commitment" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                    <FileText size={13} /> My commitment
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* GP desk — admin only */}
      {isAdmin && <GpReportDesk />}


</section>
);
}
