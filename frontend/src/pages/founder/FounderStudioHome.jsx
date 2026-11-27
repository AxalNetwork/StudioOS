/**
 * D564 (#1168) — the founder's /studio, built to `Founder Studio.dc.html`.
 *
 * There is no separate home: /studio is the founder's one front door (owner on
 * #974, "Home was a mistake, keep everything in /studio"). The body that
 * followed canvas 69dc42f3 (venture, deck, raise, metrics and booking cards)
 * is retired; Eadwyn's chat and its collapse (`StudioInterview`, D324) stay,
 * and so does the archetype card (`ProfileFitSection compact`, D594's lock).
 *
 * EVERY ZONE READS ITS OWN STORE AND FAILS ON ITS OWN. The reads are made once
 * and settled independently; `founderStudioModel.js` turns each into a zone
 * that is loading, unreadable (with Retry), not recorded (with its reason),
 * empty, or ready. A zone the canvas draws with no store behind it says so
 * (`NO_STORE`), and is never drawn as zero.
 *
 * D701 (#1663) — THE TAB AND THE TICKET FORM LIVE IN THE URL. `?tab=` picks
 * Eadwyn's panel tab and a tab change replaces it, keeping every other
 * parameter; `/studio/tickets/new` opens the ticket form, on Task with
 * `?type=task`, and leaving it replaces the URL. Every link written here keeps
 * the page's `project_id`, so a founder keeps the venture they are on.
 *
 * D701 — BELOW 1024px THE PAGE IS `StudioPhone`, the Studio Mobile Page
 * canvas: its bar, then the chat. The one `StudioInterview` element is built
 * here and handed to whichever is drawn.
 *
 * D1419 (#3698) — THE MODULES. The layout is the Worker's
 * (`useStudioLayout`); each placed cycle module adds one overview read for its
 * cycle (`cyclesApi.overview`). The activity read left with "Activity across
 * the platform". Below 1024px the owner's answer A supersedes D701's
 * chat-only page: Eadwyn first, then the strip, the profile card and the
 * modules (`FounderStudioBody` with `phone`), and the chat's composer is no
 * longer pinned, so the modules never scroll under it.
 *
 * D8729 (#8729) — THE ACTIVE VENTURE FIRST. Below 1024px the body (venture
 * header, Next card, Eadwyn's collapsed row with the chat under it, then the
 * strip, the profile and the modules) follows the phone bar, which is no
 * longer a heading. With no `?project_id=` the venture is resolved in order:
 * the switcher's pick on this device, the only venture, else a choice; the
 * result is then written to the address with replace, and that write does not
 * read the page again. A pick in the shell switcher while on /studio writes
 * its venture to the address (SFD04).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { startFounderStudioReads } from './founderStudioReads';
import { useFounderCycleReads } from './useFounderCycleReads';
import FounderStudioBody from './FounderStudioBody';
import StudioPhone, { StudioConversations } from './StudioPhone';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { STUDIO_PATH, STUDIO_TICKET_PATH, searchWithTab, studioTabOf, ticketTypeOf, withProjectId } from './studioPhoneModel';
import { useStudioLayout } from '../studio/useStudioLayout';
import { getActiveProject, useActiveProject } from '../../lib/activeProject';
import { cyclesPlaced } from '../studio/studioLayoutModel';
import './founderStudioHome.css';

// D4474 (#4474): `embedded` is a block on a multi-licence Studio. Below 1024px the home then leaves out the phone
// page's sticky bar and gutter (`StudioPhone`), which assume they own the page, and draws the chat above the body.
export default function FounderStudioHome({ user, embedded = false }) {
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get('project_id');
  const location = useLocation();
  const { pathname, search } = location;
  const navigate = useNavigate();
  const tab = studioTabOf(search);
  const ticket = pathname === STUDIO_TICKET_PATH ? { type: ticketTypeOf(search) } : null;
  const phone = usePhoneWidth();
  const [reads, setReads] = useState({});
  const [advisorAvailable, setAdvisorAvailable] = useState(null);
  const [retry, setRetry] = useState(0);
  // D4362 (#4362): an admin arranges their own Founder Studio (the hook sends `profile`).
  const studio = useStudioLayout({ profile: 'founder', viewer: user });
  // D4619 (#4619): each cycle read is kept and committed under the full venture + cycle key (`useFounderCycleReads`).
  const cycles = useFounderCycleReads(reads.project, cyclesPlaced(studio.shown));

  // #4622: each read is committed as it settles; one a newer run has superseded is dropped (`run`).
  // D8729: the address this page wrote for the venture it resolved itself (`adopted`) is not read again.
  const run = useRef(0);
  const adopted = useRef(null);
  useEffect(() => () => { run.current += 1; }, []);
  useEffect(() => {
    if (requestedProjectId && adopted.current === requestedProjectId) { adopted.current = null; return; }
    adopted.current = null;
    const mine = ++run.current;
    setReads({});
    startFounderStudioReads({
      requestedProjectId,
      preferredProjectId: getActiveProject()?.id ?? null,
      onRead: (key, value) => { if (run.current === mine) setReads((r) => ({ ...r, [key]: value })); },
    });
  }, [requestedProjectId, retry]);
  // The venture resolved without an address is written to it, every other parameter kept.
  const resolvedId = reads.project && !reads.project.failed && reads.project.id != null ? String(reads.project.id) : null;
  useEffect(() => {
    if (!resolvedId || requestedProjectId) return;
    adopted.current = resolvedId;
    const params = new URLSearchParams(search);
    params.set('project_id', resolvedId);
    navigate({ pathname, search: `?${params.toString()}` }, { replace: true, state: location.state });
  }, [resolvedId]); // eslint-disable-line react-hooks/exhaustive-deps -- only a newly resolved venture writes
  // SFD04: the shell switcher stays the one writer of the pick; a new pick on /studio opens that venture here.
  const picked = useActiveProject();
  const pickedId = picked?.id != null ? String(picked.id) : null;
  const lastPick = useRef(pickedId);
  useEffect(() => {
    if (lastPick.current === pickedId) return;
    lastPick.current = pickedId;
    if (!pickedId || pickedId === requestedProjectId) return;
    const params = new URLSearchParams(search);
    params.set('project_id', pickedId);
    navigate({ pathname, search: `?${params.toString()}` }, { replace: true });
  }, [pickedId]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new pick writes

  const again = () => setRetry((n) => n + 1);
  // A tab change stays on the path it is on, so an open ticket form stays open.
  const onTab = (next) => navigate({ pathname, search: searchWithTab(search, next) }, { replace: true });
  const onTicketOpen = (type) => navigate(withProjectId(type === 'task' ? `${STUDIO_TICKET_PATH}?type=task` : STUDIO_TICKET_PATH, search));
  const onTicketClose = () => navigate(withProjectId(ticket?.type === 'task' ? `${STUDIO_PATH}?tab=tasks` : STUDIO_PATH, search), { replace: true });
  // The venture the page reads names the thread ("Today · <venture>").
  const venture = reads.project && !reads.project.failed ? reads.project.name : null;
  const chat = (
    <StudioInterview persona="founder" disablePersistedFullscreen onAvailabilityChange={setAdvisorAvailable}
      tab={tab}
      onTab={onTab}
      ticket={ticket}
      onTicketOpen={onTicketOpen}
      onTicketClose={onTicketClose}
      phone={phone}
      venture={venture}
      belowThread={phone ? <StudioConversations /> : null}
    />
  );
  // D8729: Eadwyn's row opens itself when the address names one of its tabs or the ticket form.
  const body = (inPhone) => (
    <FounderStudioBody user={user} reads={reads} onRetry={again} studio={studio} cycles={cycles.reads} onRetryCycle={cycles.retry} search={venture && reads.project?.id ? `?project_id=${reads.project.id}` : ''} advisorAvailable={advisorAvailable} profileCard={<ProfileFitSection compact />} phone={inPhone}
      level={embedded ? 'h2' : 'h1'} eadwynOpen={tab !== 'conversation' || Boolean(ticket)}>
      {chat}
    </FounderStudioBody>
  );
  if (phone && embedded) {
    return <div className="space-y-4" data-testid="founder-studio-embedded-phone">{body(true)}</div>;
  }
  if (phone) {
    return <StudioPhone tab={tab} ticketOpen={Boolean(ticket)}>{body(true)}</StudioPhone>;
  }
  return body(false);
}
