import VercelPartFrame, { LINE, MUTED, SUB, pillClass } from './VercelPartFrame';
import { liveView, mustHaveView } from './vercelDeploys';

/**
 * D1098 (#2963, VC2) — Prototype / MVP's "From Vercel" part, from the module
 * read's `parts.vercel`:
 *   - the Live strip: each chosen project, "Live at [domain]" with "Ready
 *     since …", "Failing since …" or "Not deployed", and its last production
 *     deploy's commit and build;
 *   - each must-have GitHub feeds: GitHub's state, its Preview pill (matched by
 *     repository and pull request number only) and "In production since …"
 *     (only when a production deploy carries GitHub's merge SHA).
 *
 * Names, domains and preview links reach the venture's members only; the read
 * leaves them out for anyone else. Vercel writes no must-have.
 */
export default function MvpFromVercel({ vercel, reload }) {
  const live = Array.isArray(vercel?.live) ? vercel.live : [];
  const must = Array.isArray(vercel?.must_haves) ? vercel.must_haves : [];
  return (
    <VercelPartFrame part={vercel} sub="What is live, and each must-have's preview" testid="cycle-part-vercel" reload={reload}>
      <div className="flex flex-col gap-1.5" data-testid="vercel-live">
        <h3 className={SUB}>Live</h3>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {live.map((l, i) => {
            const v = liveView(l);
            return (
              <li key={i} className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`vercel-live-${i}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{v.title}</span>
                  <span className={pillClass(v.tone)} data-testid={`vercel-live-pill-${i}`}>{v.pill}</span>
                  {v.name && <span className="text-[11px] text-axal-faint dark:text-gray-500">{v.name}</span>}
                </div>
                {v.detail && <p className={MUTED} data-testid={`vercel-live-detail-${i}`}>{v.detail}</p>}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5" data-testid="vercel-must-haves">
        <h3 className={SUB}>Must-haves</h3>
        {must.length === 0
          ? <p className={MUTED} data-testid="vercel-must-haves-none">No must-have comes from a pull request yet, so no preview can be matched.</p>
          : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {must.map((m, i) => {
                const v = mustHaveView(m);
                return (
                  <li key={m?.feature_id ?? i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-axal-ground pb-1 last:border-b-0 dark:border-gray-800" data-testid={`vercel-must-have-${i}`}>
                    <span className={LINE}>{v.title}</span>
                    {v.status && <span className={pillClass(v.statusTone)}>{v.status}</span>}
                    {v.preview && (v.previewHref
                      ? <a href={v.previewHref} target="_blank" rel="noopener noreferrer" className={`${pillClass(v.previewTone)} hover:underline`} data-testid={`vercel-preview-${i}`}>{v.preview} ↗</a>
                      : <span className={pillClass(v.previewTone)} data-testid={`vercel-preview-${i}`}>{v.preview}</span>)}
                    {v.production && <span className="text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid={`vercel-production-${i}`}>{v.production}</span>}
                    {v.previewNote && <span className="w-full text-[11px] text-axal-muted dark:text-gray-400" data-testid={`vercel-preview-note-${i}`}>{v.previewNote}</span>}
                    {v.productionNote && <span className="w-full text-[11px] text-axal-muted dark:text-gray-400" data-testid={`vercel-production-note-${i}`}>{v.productionNote}</span>}
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </VercelPartFrame>
  );
}
