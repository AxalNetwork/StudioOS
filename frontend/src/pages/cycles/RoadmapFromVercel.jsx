import VercelPartFrame, { MUTED, SUB, pillClass } from './VercelPartFrame';
import { deployBars, deployNotes, deploySummary, releaseMark } from './vercelDeploys';

/**
 * D1098 (#2963, VC3) — Product roadmap's "From Vercel" part, above GitHub's
 * Releases (D1311), from the module read's `parts.vercel`:
 *   - "Deploys to production, last 12 weeks": one bar a week. A measured week
 *     with none is a flat line; a week before the first deploy Vercel read is
 *     drawn as not recorded, never as zero. On a phone the strip scrolls
 *     inside its card (VC7);
 *   - the failed share, the median build, rollbacks and promotions;
 *   - each release, "Live on …" only when a READY production deploy carries
 *     its tag's SHA, else a dashed "No matching deploy".
 *
 * Vercel writes no roadmap item and no release.
 */
export default function RoadmapFromVercel({ vercel, reload }) {
  const bars = deployBars(vercel?.weeks);
  const notes = deployNotes(vercel);
  const releases = Array.isArray(vercel?.releases) ? vercel.releases : [];
  return (
    <VercelPartFrame part={vercel} sub="Production deploys, and which releases are live" testid="cycle-part-vercel" reload={reload}>
      <div className="flex flex-col gap-1.5" data-testid="vercel-deploys">
        <h3 className={SUB}>Deploys to production, last 12 weeks</h3>
        <div className="overflow-x-auto" data-testid="vercel-deploys-scroll">
          <ol className="m-0 flex h-[64px] min-w-[360px] list-none items-end gap-1.5 p-0" aria-label="Deploys to production per week, last 12 weeks">
            {bars.map((b, i) => (
              <li key={b.key} className="flex h-full flex-1 flex-col justify-end" title={b.label} aria-label={b.label} data-testid={`vercel-week-${i}`} data-count={b.measured ? b.count : 'not-recorded'}>
                {b.measured
                  ? <span className="block rounded-sm bg-violet-500 dark:bg-violet-400" style={{ height: b.count === 0 ? '2px' : `${Math.max(b.height, 6)}%` }} />
                  : <span className="block h-[2px] border-t border-dashed border-gray-300 dark:border-gray-600" />}
              </li>
            ))}
          </ol>
        </div>
        <p className="m-0 text-[12px] font-semibold text-axal-ink dark:text-gray-100" data-testid="vercel-deploys-summary">{deploySummary(vercel)}</p>
        {notes.map((n, i) => <p key={i} className={MUTED} data-testid={`vercel-deploys-note-${i}`}>{n}</p>)}
      </div>
      <div className="flex flex-col gap-1.5" data-testid="vercel-releases">
        <h3 className={SUB}>Releases</h3>
        {releases.length === 0
          ? <p className={MUTED} data-testid="vercel-releases-none">No release from GitHub yet, so none can be matched to a deploy.</p>
          : (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {releases.map((r, i) => {
                const m = releaseMark(r);
                return (
                  <li key={r?.release_id ?? i} className="flex items-baseline gap-1.5" data-testid={`vercel-release-${i}`}>
                    <span className="text-[12px] font-semibold text-axal-ink dark:text-gray-100">{m.tag}</span>
                    <span className={pillClass(m.tone, m.dashed)} data-testid={`vercel-release-mark-${i}`}>{m.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </VercelPartFrame>
  );
}
