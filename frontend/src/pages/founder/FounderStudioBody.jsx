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
 * platform" are gone. The header carries Customise, and each tile has
 * its own Try again.
 *
 * Below 1024px (owner, #3698 A, superseding D701's chat-only phone page) the
 * home draws this body under the phone chat with `phone`: no header and no
 * chat here, then the strip, the profile card and the modules, and a bottom
 * bar with Customise.
 *
 * D4619 (#4619): a `project_id` the member has no access to draws
 * `ProjectUnavailable` above the zones (which are Unreadable, with the same
 * reason). No other venture is shown in its place.
 *
 * D8729 (#8729) — THE VENTURE FIRST, on both widths. The page opens with the
 * venture header, whose heading names the active venture (`StudioVenture.jsx`),
 * then the Next card with one primary task, then Eadwyn, then the strip, the
 * profile and the modules. The phone draws Eadwyn as a collapsed row under the
 * Next card (owner Q3 A); the chat stays mounted while collapsed, so its
 * thread and availability read are kept. A first venture, an unavailable
 * venture, two ventures with none selected and a failed projects read each
 * draw their own card in the Next card's place. The unavailable notice offers
 * the member's own ventures. Tile Open links carry `?project_id=`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { Unrecorded } from '../../ui';
import { LOADING, UNREADABLE, READY, headerOf, summaryOf, profileOf, isUnavailableProject } from './founderStudioModel';
import { nextStepsOf, studioTaskLink, ventureHeadOf, waitingQuestions } from './founderNextModel';
import { EadwynRow, FirstVentureCard, NextCard, StudioTaskLink, VentureChoices, VentureChooser, VentureHeader, VenturesUnreadable, useReturnFocus } from './StudioVenture';
import StudioModules from '../studio/StudioModules';
import { CustomiseButton, StudioFixedLock } from '../studio/StudioParts';
import { cyclesPlaced } from '../studio/studioLayoutModel';
import { founderNoStoreTiles, founderTiles } from '../studio/tiles/founderTiles';
import '../studio/studioModules.css';

export const NO_ADVISOR_PHONE = 'The guided founder interview is not available in this environment.';
const CHAT_ID = 'studio-chat';

/** A tile's own next step (SFD07): opened in the venture with the way back kept, like the Next card's. */
function TileTaskLink({ next, href, ventureId, venture, slugKey }) {
  const link = studioTaskLink(href, ventureId);
  if (!link) return null;
  return (
    <StudioTaskLink to={link.to} id={`studio-tile-next-${slugKey}`} ventureId={ventureId} venture={venture}
      className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">
      {next.text} ›
    </StudioTaskLink>
  );
}

/** The founder's Studio over a set of reads and a layout. Exported so each state renders in a test. */
export default function FounderStudioBody({
  user, reads, onRetry, studio, cycles = {}, onRetryCycle, search = '', advisorAvailable = null, children = null, profileCard = null, phone = false,
  level = 'h1', eadwynOpen = false,
}) {
  const header = useMemo(() => headerOf({ user, project: reads.project, lab: reads.lab }), [user, reads.project, reads.lab]);
  const summary = summaryOf(reads);
  const profile = profileOf(reads);
  const head = ventureHeadOf({ project: reads.project, ventures: reads.ventures });
  const ventureId = head.kind === 'venture' ? reads.project.id : null;
  const ventures = Array.isArray(reads.ventures) ? reads.ventures : null;
  const nextLink = ventureId == null ? null
    : (key) => (next, href) => <TileTaskLink next={next} href={href} ventureId={ventureId} venture={head.title} slugKey={key} />;
  const tiles = founderTiles({ reads, cycles, onRetry, onRetryCycle, search, nextLink });
  const next = head.kind === 'venture' ? nextStepsOf({ shown: studio.shown, cycles, reads, ventureId, layoutRead: studio.layoutRead }) : null;
  const dim = studio.editing ? 'sm-dim' : '';
  const [open, setOpen] = useState(false);
  const chatShown = !phone || open || eadwynOpen;
  const headingRef = useRef(null);
  const lastVenture = useRef(undefined);
  useReturnFocus();
  // SFD14: a venture switch moves focus to the heading, which names the new venture.
  useEffect(() => {
    if (ventureId == null) return;
    if (lastVenture.current !== undefined && lastVenture.current !== ventureId) headingRef.current?.focus?.();
    lastVenture.current = ventureId;
  }, [ventureId]);
  const openEadwyn = () => {
    setOpen(true);
    const el = typeof document === 'undefined' ? null : document.getElementById(CHAT_ID);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const retryCycles = () => { for (const c of cyclesPlaced(studio.shown)) if (cycles[c] && cycles[c].failed) onRetryCycle?.(c); };
  const addModules = studio.canCustomise ? () => { if (!studio.editing) studio.customise(); studio.setMapOpen?.(true); } : null;
  const waiting = waitingQuestions(reads);
  const eadwynLine = ['Today', head.kind === 'venture' ? head.title : head.kind === 'first' ? 'no venture yet' : null,
    waiting ? `${waiting} ${waiting === 1 ? 'question' : 'questions'} waiting` : null].filter(Boolean).join(' · ');

  return (
    <section className={`fs-root sm-tokens ${phone ? 'px-[22px] pt-4' : ''}`} data-testid="founder-studio-home">
      <VentureHeader head={head} header={header} ventures={ventures} currentId={ventureId} phone={phone} level={level} headingRef={headingRef}
        customise={!phone && head.kind !== 'unavailable' ? <CustomiseButton studio={studio} /> : null} />

      {head.kind === 'venture' && <NextCard next={next} venture={head.title} ventureId={ventureId} phone={phone} onRetry={retryCycles} onOpenEadwyn={openEadwyn} onAddModules={addModules} dim={dim} />}
      {head.kind === 'first' && <FirstVentureCard phone={phone} onOpenEadwyn={openEadwyn} dim={dim} />}
      {head.kind === 'choose' && <VentureChooser ventures={ventures} dim={dim} />}
      {head.kind === 'unreadable' && <VenturesUnreadable onRetry={onRetry} dim={dim} />}
      {isUnavailableProject(reads.project) && <ProjectUnavailable ventures={ventures} />}

      {phone && <EadwynRow open={chatShown} onToggle={() => setOpen(!chatShown)} line={eadwynLine} controls={CHAT_ID} />}
      <section id={CHAT_ID} hidden={!chatShown} aria-label="Eadwyn AI" className={`mb-4 ${dim}`} data-testid="section-founder-advisor">
        {children}
        {advisorAvailable === false && (phone
          ? <p role="status" className="py-3 text-[13px] text-[#615c6e] dark:text-gray-400" data-testid="studio-phone-no-advisor">{NO_ADVISOR_PHONE}</p>
          : <AdvisorUnavailable />)}
      </section>

      <div className={`sm-fixed mb-4 ${dim}`} data-testid="founder-studio-strip">
        <StudioFixedLock />
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" aria-label="Summary" data-testid="founder-studio-summary">
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

/**
 * D4619: the venture the link named is not one of this member's; nothing from another venture is drawn in its place.
 * D8729 (SFD10, SFD12F): the notice offers the member's own ventures by name; "Open your Studio" stays only when
 * their list is empty or could not be read.
 */
export function ProjectUnavailable({ ventures = null }) {
  const list = Array.isArray(ventures) ? ventures : [];
  return (
    <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="status-founder-project-unavailable">
      <p className="font-bold">This venture is not available to your account.</p>
      <p className="mt-1">The link names a venture you cannot open, so no venture&apos;s records are shown here.
        {!list.length && <>{' '}<Link to="/studio" className="font-semibold underline" data-testid="link-founder-project-unavailable-studio">Open your Studio</Link></>}
      </p>
      {list.length > 0 && (
        <div className="mt-2">
          <p className="mb-1.5 font-semibold">Open one of yours:</p>
          <VentureChoices ventures={list} testId="founder-project-unavailable-ventures" />
        </div>
      )}
    </section>
  );
}

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
