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
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { api, spinoutLab } from '../../lib/api';
import { cyclesApi } from '../../lib/api/cycles.js';
import { reportError } from '../../lib/log';
import { failedRead } from './founderStudioModel';
import FounderStudioBody from './FounderStudioBody';
import StudioPhone, { StudioConversations } from './StudioPhone';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { STUDIO_PATH, STUDIO_TICKET_PATH, searchWithTab, studioTabOf, ticketTypeOf, withProjectId } from './studioPhoneModel';
import { useStudioLayout } from '../studio/useStudioLayout';
import { cyclesPlaced } from '../studio/studioLayoutModel';
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
  const studio = useStudioLayout({ profile: 'founder', viewer: user, readOnly: user?.role === 'admin' });
  const cycles = useCycleReads(reads.project, cyclesPlaced(studio.shown));

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
  const body = (inPhone) => (
    <FounderStudioBody user={user} reads={reads} onRetry={again} studio={studio} cycles={cycles.reads} onRetryCycle={cycles.retry} search={venture && reads.project?.id ? `?project_id=${reads.project.id}` : ''} advisorAvailable={advisorAvailable} profileCard={<ProfileFitSection compact />} phone={inPhone}>
      {inPhone ? null : chat}
    </FounderStudioBody>
  );
  if (phone) {
    return <StudioPhone tab={tab} ticketOpen={Boolean(ticket)} advisorAvailable={advisorAvailable} after={body(true)}>{chat}</StudioPhone>;
  }
  return body(false);
}

/**
 * One overview read per cycle with a placed module, for the venture the page
 * reads. Undefined while it loads; `{ failed }` when it failed (or the
 * venture could not be read); `{ noProject }` when there is no venture.
 */
function useCycleReads(project, placed) {
  const [reads, setReads] = useState({});
  const asked = useRef(new Set());
  const mounted = useRef(true);
  const [n, setN] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const want = placed.join(',');
  const projectId = project && !project.failed ? project.id : null;
  const projectState = project === undefined ? 'loading' : project === null ? 'none' : project.failed ? 'failed' : 'ready';
  useEffect(() => {
    if (projectState === 'loading') return;
    // A read in flight is kept when another cycle is added or retried: only unmounting drops it.
    for (const cycle of want.split(',').filter(Boolean)) {
      const k = `${projectState}:${projectId}:${cycle}`;
      if (asked.current.has(k)) continue;
      asked.current.add(k);
      if (projectState === 'none') { setReads((r) => ({ ...r, [cycle]: { noProject: true } })); continue; }
      if (projectState === 'failed') { setReads((r) => ({ ...r, [cycle]: { failed: 'The venture could not be read.' } })); continue; }
      setReads((r) => ({ ...r, [cycle]: undefined }));
      cyclesApi.overview(cycle, projectId).then(
        (d) => { if (mounted.current) setReads((r) => ({ ...r, [cycle]: d || {} })); },
        (e) => { reportError(`FounderStudio:cycle:${cycle}`, e); if (mounted.current) setReads((r) => ({ ...r, [cycle]: { failed: e?.message || 'Source unavailable' } })); },
      );
    }
  }, [want, projectId, projectState, n]);
  const retry = (cycle) => {
    asked.current.delete(`${projectState}:${projectId}:${cycle}`);
    setN((x) => x + 1);
  };
  return { reads, retry };
}
