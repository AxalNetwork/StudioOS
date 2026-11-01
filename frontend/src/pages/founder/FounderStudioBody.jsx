/**
 * D564 (#1168) — the founder's /studio, over the reads `FounderStudioHome`
 * makes. Apart from the home so a Node test renders every state: the home
 * mounts StudioInterview, whose imports reach Worker modules.
 *
 * D1419 (#3698) — the Studio modularity canvas. The fixed blocks stay where
 * they are and carry no edit control: Eadwyn's chat, the Studio strip (with
 * its lock) and the founder profile card (with its lock). Below them is the
 * member's module grid (`pages/studio/StudioModules.jsx`), in their saved
 * layout or the founder default. "Do these next" and "Activity across the
 * platform" are gone; "Continue where you left off" still links the
 * checklist's first open item. The header drops "Company profile" and
 * "Refresh": each tile has its own Try again.
 *
 * Below 1024px (owner, #3698 A, superseding D701's chat-only phone page) the
 * home draws this body under the phone chat with `phone`: no header and no
 * chat here, then the strip, the profile card and the modules, and a bottom
 * bar with Customise.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { Unrecorded } from '../../ui';
import { LOADING, UNREADABLE, READY, headerOf, summaryOf, actionsOf, profileOf } from './founderStudioModel';
import StudioModules from '../studio/StudioModules';
import { CustomiseButton, StudioFixedLock } from '../studio/StudioParts';
import { founderNoStoreTiles, founderTiles } from '../studio/tiles/founderTiles';
import '../studio/studioModules.css';

/** The founder's Studio over a set of reads and a layout. Exported so each state renders in a test. */
export default function FounderStudioBody({
  user, reads, onRetry, studio, cycles = {}, onRetryCycle, search = '', advisorAvailable = null, children = null, profileCard = null, phone = false,
}) {
  const header = useMemo(() => headerOf({ user, project: reads.project, lab: reads.lab }), [user, reads.project, reads.lab]);
  const summary = summaryOf(reads);
  const actions = actionsOf(reads);
  const profile = profileOf(reads);
  const tiles = founderTiles({ reads, cycles, onRetry, onRetryCycle, search });
  const dim = studio.editing ? 'sm-dim' : '';

  return (
    <section className={`fs-root sm-tokens ${phone ? 'px-[22px] pt-4' : ''}`} data-testid="founder-studio-home">
      {!phone && (
        <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[24px] font-extrabold tracking-tight" data-testid="text-founder-studio-title">Studio</h2>
              {header.phase && <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" data-testid="badge-founder-studio-phase">{header.phase}</span>}
              {header.phaseState === UNREADABLE && <span className="text-[11px] text-axal-muted"><Unrecorded reason="The Lab state could not be read.">Phase unreadable</Unrecorded></span>}
            </div>
            <p className="mt-1.5 max-w-[640px] text-[13.5px] text-axal-muted" data-testid="text-founder-studio-context">
              {header.company || (header.companyState === LOADING ? '…' : 'No company record yet')}
              {' · '}{header.founderLine}: everything you have built across the platform, what it unlocked, and what to do next.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CustomiseButton studio={studio} />
            {actions.state === READY && actions.items[0]?.href && (
              <Link to={actions.items[0].href} className="sm-btn sm-btn-p" data-testid="link-founder-continue">Continue where you left off</Link>
            )}
          </div>
        </header>
      )}

      {!phone && (
        <div className={`mb-4 ${dim}`} data-testid="section-founder-advisor">
          {children}
          {advisorAvailable === false && <AdvisorUnavailable />}
        </div>
      )}

      <div className={`sm-fixed mb-4 ${dim}`} data-testid="founder-studio-strip">
        <StudioFixedLock />
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" data-testid="founder-studio-summary">
          {summary.map((t) => (
            <li key={t.k} className="rounded-xl border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40" data-testid={`founder-summary-${slug(t.k)}`}>
              <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">{t.k}</p>
              <p className="mt-1 text-[20px] font-extrabold tabular-nums">
                {t.state === READY ? t.v : t.state === LOADING ? '…' : <span className="text-[12px] font-semibold text-axal-muted"><Unrecorded reason={t.reason}>{t.state === UNREADABLE ? 'Unreadable' : 'Not recorded'}</Unrecorded></span>}
              </p>
              {t.state === READY && t.sub && <p className="text-[11px] text-axal-muted">{t.sub}</p>}
            </li>
          ))}
        </ul>
      </div>

      <section className={`sm-fixed mb-5 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40 ${dim}`} data-testid="zone-founder-profile" aria-label="Your founder profile">
        <StudioFixedLock />
        <h3 className="mb-2.5 text-[14px] font-extrabold tracking-tight">Your founder profile</h3>
        <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-[28px] font-extrabold tabular-nums" data-testid="founder-profile-pct">
              {profile.completion.state === READY ? `${profile.completion.pct}%`
                : profile.completion.state === LOADING ? <span className="text-[12px] font-semibold text-axal-muted">Reading…</span>
                  : <span className="text-[12px] font-semibold text-axal-muted"><Unrecorded reason={profile.completion.reason}>{profile.completion.state === UNREADABLE ? 'Unreadable' : 'Not recorded'}</Unrecorded></span>}
            </p>
            <p className="text-[11.5px] text-axal-muted">complete</p>
          </div>
          {profileCard && <div className="min-w-0" data-testid="founder-profile-archetype">{profileCard}</div>}
          <div className="min-w-0">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">Confidence by dimension</p>
            {profile.dimensions.state === READY ? (
              <ul className="mt-1.5 grid gap-1.5" data-testid="founder-profile-dimensions">
                {profile.dimensions.items.map((d) => (
                  <li key={d.name} className="text-[12px]">
                    <span className="flex justify-between"><span>{d.name}</span><span className="text-axal-muted">{d.label}</span></span>
                    {d.pct !== null && <span className="mt-0.5 block h-1.5 rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-1.5 rounded-full bg-violet-600" style={{ width: `${d.pct}%` }} /></span>}
                  </li>
                ))}
              </ul>
            ) : profile.dimensions.state !== LOADING && (
              <p className="mt-1 text-[12px] text-axal-muted"><Unrecorded reason={profile.dimensions.reason}>{profile.dimensions.state === UNREADABLE ? 'Unreadable' : 'Not recorded'}</Unrecorded></p>
            )}
          </div>
        </div>
      </section>

      <StudioModules studio={studio} tiles={tiles} extra={founderNoStoreTiles()} />

      {phone && studio.canCustomise && !studio.editing && (
        <div className="sm-phone-bar -mx-[22px] mt-4" data-testid="studio-phone-customise">
          <CustomiseButton studio={studio} />
        </div>
      )}
    </section>
  );
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function AdvisorUnavailable() {
  return (
    <section className="fs-advisor-unavailable" role="status" data-testid="status-founder-advisor-unavailable">
      <div className="fs-advisor-unavailable-main">
        <span className="fs-advisor-mark"><MessageCircle size={17} /></span>
        <div>
          <div className="fs-advisor-title">
            <h3>Eadwyn</h3>
            <span>Founder interview</span>
          </div>
          <p>The guided founder interview is not available in this environment. Your Studio records remain below.</p>
        </div>
      </div>
      <div className="fs-advisor-unavailable-note">
        <span>Live interview</span>
        <strong>Source unavailable</strong>
        <small>No answers or assessment data have been inferred.</small>
      </div>
    </section>
  );
}
