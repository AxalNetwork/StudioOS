/**
 * D8730 (#8730) — the founder's /studio as an HQ-held Founder preview, built to
 * SPV01 / SPV21 / SPV22 of `design/incoming/Studio Home Previews Page.dc.html`.
 *
 * A preview is the Founder ROLE, not a person, so nothing here comes from the
 * operator's own account: the notice above the page, Eadwyn's interview with
 * the operator's HQ conversation withheld and the founder bank's first two
 * questions as labelled examples (no answers), the composer off, Next up as
 * examples linking to founder pages, and the six figures and the profile
 * "Not applicable in preview", never 0. Before this the page mounted the
 * operator's own interview, so a Super Admin was asked the admin bank and
 * offered "Open Admin".
 *
 * D4362 is kept: the operator still arranges their own Founder Studio here,
 * and every module tile stays withheld, as the other three previews' do.
 * One layout serves desktop and 390px: the blocks stack, the strip is two
 * columns on a phone, and Back to HQ stays in the bar above.
 */
import { useStudioLayout } from '../studio/useStudioLayout';
import StudioModules from '../studio/StudioModules';
import { CustomiseButton } from '../studio/StudioParts';
import { ExampleChip, NotApplicableChip, RolePreviewInterview, RolePreviewNotice } from '../../components/RolePreviewParts';
import { FOUNDER_FIGURES, FOUNDER_PREVIEW } from '../../components/rolePreviewModel';
import '../studio/studioModules.css';

export default function FounderStudioPreview({ user }) {
  const studio = useStudioLayout({ profile: 'founder', viewer: user });
  return (
    <section className="sm-tokens space-y-4" data-testid="founder-studio-preview">
      <RolePreviewNotice role="founder" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[24px] font-extrabold tracking-tight" data-testid="text-founder-studio-title">Studio</h1>
            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">Founder</span>
            <ExampleChip>Preview</ExampleChip>
          </div>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] text-axal-muted dark:text-gray-400">{FOUNDER_PREVIEW.sub}</p>
        </div>
        <CustomiseButton studio={studio} />
      </header>

      <RolePreviewInterview role="founder" nextUp />

      <section aria-labelledby="founder-preview-summary-h" data-testid="founder-preview-strip">
        <h2 id="founder-preview-summary-h" className="sr-only">Venture summary</h2>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {FOUNDER_FIGURES.map((k) => (
            <li key={k} className="rounded-xl border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40" data-figure={k}>
              <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint dark:text-gray-500">{k}</p>
              <p className="mt-1.5"><NotApplicableChip /></p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-axal-muted dark:text-gray-400">{FOUNDER_PREVIEW.tilesLine}</p>
      </section>

      <section className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40" aria-labelledby="founder-preview-profile-h" data-testid="founder-preview-profile">
        <h2 id="founder-preview-profile-h" className="mb-2 text-[14px] font-extrabold tracking-tight">Founder profile</h2>
        <NotApplicableChip />
        <p className="mt-2 max-w-[720px] text-[12.5px] text-axal-muted dark:text-gray-400">{FOUNDER_PREVIEW.profileLine}</p>
      </section>

      <StudioModules studio={studio} tiles={{}} withheld />
    </section>
  );
}
