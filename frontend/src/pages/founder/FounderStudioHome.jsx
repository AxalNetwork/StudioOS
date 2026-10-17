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
 * canvas, in place of `FounderStudioBody`: no zone, tile or header. The one
 * `StudioInterview` element is built here and handed to whichever is drawn.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { api, spinoutLab } from '../../lib/api';
import { reportError } from '../../lib/log';
import { failedRead } from './founderStudioModel';
import FounderStudioBody from './FounderStudioBody';
import StudioPhone, { StudioConversations } from './StudioPhone';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { STUDIO_PATH, STUDIO_TICKET_PATH, searchWithTab, studioTabOf, ticketTypeOf, withProjectId } from './studioPhoneModel';
import './founderStudioHome.css';

const array = (value, key) => (Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : []);

/** The page's reads, each settled on its own. */
export async function readFounderStudio({ requestedProjectId } = {}) {
  const settle = async (key, promise) => {
    try { return [key, await promise]; } catch (e) {
      reportError(`FounderStudio:${key}`, e);
      return [key, failedRead(e?.message)];
    }
  };
  const [[, projects], ...rest] = await Promise.all([
    settle('projects', api.listProjects()),
    settle('lab', spinoutLab.state()),
    settle('advisor', api.advisor.progress()),
    settle('queue', api.advisor.queue()),
    settle('activity', api.getRecentActivity(20)),
  ]);
  const reads = Object.fromEntries(rest);
  if (projects && projects.failed) {
    return { ...reads, project: projects, lifecycle: projects, scores: projects };
  }
  const list = array(projects, 'projects');
  const project = list.find((p) => Number(p?.id) === Number(requestedProjectId)) || list.find((p) => p?.id) || null;
  if (!project) return { ...reads, project: null, lifecycle: null, scores: null };
  const [[, lifecycle], [, scores]] = await Promise.all([
    settle('lifecycle', api.getLifecycle(project.id)),
    settle('scores', api.getScores(project.id)),
  ]);
  return { ...reads, project, lifecycle, scores };
}

export default function FounderStudioHome({ user }) {
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get('project_id');
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const tab = studioTabOf(search);
  const ticket = pathname === STUDIO_TICKET_PATH ? { type: ticketTypeOf(search) } : null;
  const phone = usePhoneWidth();
  const [reads, setReads] = useState({});
  const [advisorAvailable, setAdvisorAvailable] = useState(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setReads({});
    readFounderStudio({ requestedProjectId }).then((r) => { if (alive) setReads(r); });
    return () => { alive = false; };
  }, [requestedProjectId, retry]);

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
  if (phone) {
    return <StudioPhone tab={tab} ticketOpen={Boolean(ticket)} advisorAvailable={advisorAvailable}>{chat}</StudioPhone>;
  }
  return (
    <FounderStudioBody user={user} reads={reads} onRetry={again} advisorAvailable={advisorAvailable} profileCard={<ProfileFitSection compact />}>
      {chat}
    </FounderStudioBody>
  );
}
