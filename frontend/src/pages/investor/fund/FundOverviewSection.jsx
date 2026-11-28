import React from 'react';
import { FUND, THESIS, TIERS, TIER_RIGHTS, PROCESS_STEPS } from '../../../lib/spinoutFundModel';
import { MONO, CARD, LBL, Chip, SectionLabel } from './FundWorkspaceSupport';
import { LP_ONLY_PHRASE } from '../../../lib/spinoutFundFigures';
import { Link } from 'react-router-dom';
import { Loader2, FileDown } from 'lucide-react';

export default function FundOverviewSection({
  F, P, downloadBrief, briefBusy, briefErr, econ
}) {
return (
<section id="fund" aria-labelledby="fund-heading" tabIndex={-1} className="space-y-6 scroll-mt-6">
      {/* D8731 (#8731): the heading Studio's "See Axal VC Fund terms" names; it takes focus on arrival at #fund. */}
      <div className="flex items-end justify-between gap-3">
        <h2 id="fund-heading" tabIndex={-1} data-section-heading="" className={LBL}>Fund and terms</h2>
        <span className="text-[11.5px] text-gray-400 dark:text-gray-500">The fund brief, open to every investor</span>
      </div>
      {/* hero + raise progress */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e1533] via-[#2d1d52] to-[#3b2470] p-8 text-white">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-green-400/15 px-2.5 py-1 text-[11px] font-bold text-green-300">
              {F.close.status}
            </span>
            <span className="text-xs text-white/60">
              Axal VC Spin-Out Fund I · {FUND.stage} · Vintage {FUND.vintage}
            </span>
          </div>
          <div className="max-w-xl text-2xl font-extrabold leading-tight tracking-tight">
            {THESIS.headline}
          </div>
          <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-white/75">{THESIS.hero}</p>
          {/* Provenance for the program stats below — the same live-vs-model
              disclosure the raise card makes, so neither block can imply a
              source it does not have. */}
          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="mb-2 text-[9.5px] font-semibold uppercase tracking-wider text-white/40">
              {P.live
                ? 'Live program telemetry · computed from graduate records'
                : 'Program track record not recorded yet · appears once graduate records hold it'}
            </div>
          <div className="flex flex-wrap gap-6">
            {[
              [P.graduates, 'Graduates to date'],
              [P.onTime, 'Incorporated on time'],
              [P.alumni, 'Raised by alumni'],
            ].map(([v, k]) => (
              <div key={k}>
                <div className={`${MONO} text-[17px] font-bold`}>{v}</div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-white/55">{k}</div>
              </div>
            ))}
          </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {/* dark:bg-white is deliberate, not a copy-paste slip: this button
                sits on the always-dark gradient hero, so it stays white in both
                themes. The pairing also satisfies the dark-mode guard. */}
            <Link to="/spinout-lab" className="rounded-lg bg-white dark:bg-white px-4 py-2.5 text-[13px] font-bold text-[#2d1d52]">
              Explore the Spin-Out Lab
            </Link>
            {/* Generates the one-pager from this page's own read at click time,
                so a download always carries what the page is currently showing.
                The old link went to /spinout-lab/brief — the public PROGRAM
                brochure, not a fund brief. */}
            <button
              type="button"
              onClick={downloadBrief}
              disabled={briefBusy}
              data-testid="download-fund-brief"
              className="inline-flex items-center gap-2 rounded-lg border border-white/35 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {briefBusy
                ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                : <FileDown size={14} aria-hidden="true" />}
              {briefBusy ? 'Preparing…' : 'Fund brief (PDF)'}
            </button>
          </div>
          <p className="mt-2.5 text-[10.5px] leading-relaxed text-white/45">
            {briefErr
              ? briefErr
              : 'One page, generated now — the fund figures on this page, structure, tiers, track record and the commitment process.'}
          </p>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <SectionLabel right={<Chip tone="gray">First close {F.close.label}</Chip>}>Raise progress</SectionLabel>
          {/* D6137: the target and the close status for every reader; the raise
              itself only when the read carried it (a committed LP's). */}
          <dl className="flex flex-col gap-2.5 text-xs" data-testid="raise-headline">
            {[
              ['Target', F.target.text],
              ['First close', F.close.label],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                <dd className={`${MONO} text-right font-bold text-gray-900 dark:text-gray-100`}>{v}</dd>
              </div>
            ))}
          </dl>
          {F.raise ? (
            <>
              <div className="mt-4 flex items-baseline gap-2 border-t border-gray-100 dark:border-gray-800 pt-4">
                <div className={`${MONO} text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100`}>
                  {F.raise.committed}
                </div>
                <div className="text-[13px] text-gray-500 dark:text-gray-400">committed</div>
              </div>
              {F.raise.pctOfTarget != null && (
                <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div className="h-full rounded-full bg-violet-600" style={{ width: `${F.raise.pctOfTarget}%` }} />
                </div>
              )}
              <dl className="mt-4 flex flex-1 flex-col gap-2.5 text-xs" data-testid="raise-lp-figures">
                {[
                  ['Soft-circled', F.raise.softCircled],
                  ['Accepted LPs', F.raise.lpCount],
                  ['Median commitment', F.raise.median],
                  ['Capacity remaining', F.raise.capacity],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                    <dd className={`${MONO} font-bold text-gray-900 dark:text-gray-100`}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[10.5px] leading-relaxed text-gray-400 dark:text-gray-500">
                Committed = commitments the general partner has recorded on the fund's register; no
                subscription-document store exists, so it does not say a subscription was countersigned.
                Soft-circled amounts are indications, not commitments. Figures come from the fund’s
                limited-partner records; a figure with no record reads Not recorded.
              </p>
            </>
          ) : (
            <p className="mt-4 flex-1 border-t border-gray-100 dark:border-gray-800 pt-4 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
              Committed capital, the LP count and the portfolio are {LP_ONLY_PHRASE}.
            </p>
          )}
        </div>
      </div>

      {/* key terms */}
      <div>
        <SectionLabel>Key terms</SectionLabel>
        <div className={`${CARD} grid grid-cols-1 overflow-hidden sm:grid-cols-2 lg:grid-cols-4`}>
          {econ.map((t) => (
            <div key={t.k} className="border-b border-r border-gray-100 dark:border-gray-800 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.k}</div>
              <div className={`${MONO} mt-1 text-[15px] font-bold text-gray-900 dark:text-gray-100`}>{t.v}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{t.note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* participation tiers */}
      <div>
        <SectionLabel>Participation tiers</SectionLabel>
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className={`px-5 py-3 ${LBL}`}>Rights</th>
                {TIERS.map((t) => (
                  <th key={t.name} className={`px-3 py-3 text-center ${t.hl ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}>
                    <div className="text-[12.5px] font-extrabold text-gray-900 dark:text-gray-100">{t.name}</div>
                    <div className={`${MONO} text-sm font-bold text-violet-700 dark:text-violet-300`}>{t.amount}</div>
                    <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500">{t.sub || ' '}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIER_RIGHTS.map((r) => (
                <tr key={r.right} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-5 py-3">
                    <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">{r.right}</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">{r.note}</div>
                  </td>
                  {r.c.map((c, i) => (
                    <td key={i} className={`px-3 py-3 text-center text-[13px] text-gray-700 dark:text-gray-300 ${TIERS[i].hl ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* commitment process */}
      <div>
        <SectionLabel>Commitment process</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {PROCESS_STEPS.map(([n, label, note]) => (
            <div key={n} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <div className={`${MONO} text-[8px] font-bold text-violet-300 dark:text-violet-700`}>{n}</div>
              <div className="mt-0.5 text-[11.5px] font-bold leading-tight text-gray-900 dark:text-gray-100">{label}</div>
              <div className="mt-0.5 text-[10px] leading-snug text-gray-400 dark:text-gray-500">{note}</div>
            </div>
          ))}
        </div>
      </div>


</section>
);
}
