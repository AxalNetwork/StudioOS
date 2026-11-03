// D3959 (#3959) — every client call the learning plan's pages make, in one
// file (the folder's rule: only the reads files call the client). The plan
// is `learningPlanApi` (#3967); the picker's lists are Learning's own reads.
import { learningPlanApi } from '../../lib/api/learningPlan.js';
import { learningApi } from '../../lib/api/learning.js';

export const listPlan = (range) => learningPlanApi.list(range);
export const createPlan = (body) => learningPlanApi.create(body);
export const updatePlan = (uid, body) => learningPlanApi.update(uid, body);
export const removePlan = (uid) => learningPlanApi.remove(uid);
export const markPlanDone = (uid) => learningPlanApi.markDone(uid);

/**
 * The picker's list for one kind: what the member may plan, each
 * `{ key, title, uid }` or, for a course (which the catalog names by slug),
 * `{ key, title, resolve }`, whose uid is read from the course on pick.
 */
export async function planChoices(kind) {
  if (kind === 'course') {
    const r = await learningApi.catalog({ kind: 'course', limit: 50 });
    return (r?.items || []).map((x) => ({ key: `course:${x.id}`, title: x.title, resolve: async () => (await learningApi.course(x.id))?.course?.uid || null }));
  }
  if (kind === 'video') {
    const r = await learningApi.catalog({ kind: 'video', limit: 50 });
    return (r?.items || []).map((x) => ({ key: `video:${x.id}`, uid: x.id, title: x.title }));
  }
  if (kind === 'webinar') {
    const r = await learningApi.webinars('upcoming');
    return (r?.webinars || []).map((x) => ({ key: `webinar:${x.uid}`, uid: x.uid, title: x.title }));
  }
  if (kind === 'exercise' || kind === 'exam') {
    const r = await (kind === 'exercise' ? learningApi.exercises({ limit: 50 }) : learningApi.exams({ limit: 50 }));
    return (r?.items || []).map((x) => ({ key: `${kind}:${x.uid}`, uid: x.uid, title: x.title }));
  }
  return [];
}
