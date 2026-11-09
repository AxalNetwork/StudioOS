/**
 * #4622 (Studio audit 4/5): the founder Studio's reads, each committed when it
 * settles.
 *
 * `FounderStudioHome` used to wait for projects, the Lab, advisor progress and
 * the advisor queue together, and only then start the venture's lifecycle and
 * scores, and committed nothing until every one of them had settled. A slow
 * advisor read therefore held the project-dependent reads back and held every
 * zone on its loading state, though each zone reads its own store.
 *
 * Now:
 *   - the four independent reads start together, and each is handed to
 *     `onRead(key, value)` the moment it settles (a failure is `failedRead`, so
 *     the zone says so and offers Retry, as before);
 *   - the venture is resolved from the projects read alone, and its lifecycle
 *     and scores start at once, not after the advisor or the queue;
 *   - no venture, or a failed projects read, settles the dependent zones the
 *     way it always did (`null`, or the failure itself).
 *
 * The returned promise settles when everything has; callers that have moved on
 * (a project change, a retry, an unmount) drop what they are handed.
 */
import { api, spinoutLab } from '../../lib/api';
import { reportError } from '../../lib/log';
import { failedRead } from './founderStudioModel';

const array = (value, key) => (Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : []);

export function startFounderStudioReads({ requestedProjectId, onRead, client = api, lab = spinoutLab } = {}) {
  const settle = async (key, promise) => {
    let value;
    try { value = await promise; } catch (e) {
      reportError(`FounderStudio:${key}`, e);
      value = failedRead(e?.message);
    }
    onRead(key, value);
    return value;
  };
  const independent = [
    settle('lab', lab.state()),
    settle('advisor', client.advisor.progress()),
    settle('queue', client.advisor.queue()),
  ];
  const dependent = (async () => {
    let projects;
    try { projects = await client.listProjects(); } catch (e) {
      reportError('FounderStudio:projects', e);
      projects = failedRead(e?.message);
    }
    if (projects && projects.failed) {
      onRead('project', projects); onRead('lifecycle', projects); onRead('scores', projects);
      return;
    }
    const list = array(projects, 'projects');
    const project = list.find((p) => Number(p?.id) === Number(requestedProjectId)) || list.find((p) => p?.id) || null;
    onRead('project', project);
    if (!project) { onRead('lifecycle', null); onRead('scores', null); return; }
    await Promise.all([
      settle('lifecycle', client.getLifecycle(project.id)),
      settle('scores', client.getScores(project.id)),
    ]);
  })();
  return Promise.all([...independent, dependent]).then(() => undefined);
}
