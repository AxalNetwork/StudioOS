/**
 * #8776 (D8776-p3, BLR05B) — the Home checklist rows that open Build's "Quarters, dependencies and scenarios"
 * (`/build/roadmap`) name its By quarter view, keep the venture when they know it, and say they came from Home's
 * checklist so the page can name the row and send Back there.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/roadmap_links_8776.test.ts
 *
 * The venture id is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleChecklist, roadmapChecklistHref } from '../src/routes/progress.ts';
import { CATALOG, ROADMAP_OKRS_ROUTE } from '../src/services/onboardingChecklist.ts';

const SIGNALS = { landing_published: false, interview_count: 0, active_prospects: 0, latest_mrr: null, active_users: null } as never;

test('the lifecycle checklist rows that open /build/roadmap carry the venture, the view and the row', () => {
  // Mutation checked: project_id dropped from roadmapChecklistHref → the href lacks project_id=412; a row put back
  // to the bare '/build/roadmap' → its href differs; the step not set → the page could not name the row.
  assert.equal(roadmapChecklistHref(412, 'roadmap_set'), '/build/roadmap?project_id=412&view=quarters&from=home&step=roadmap_set');
  assert.equal(roadmapChecklistHref(null, 'okrs'), '/build/roadmap?view=quarters&from=home&step=okrs', 'no venture, none invented');
  assert.equal(roadmapChecklistHref(0, 'okrs'), '/build/roadmap?view=quarters&from=home&step=okrs');

  const build = buildLifecycleChecklist('build', SIGNALS, {}, 412);
  const href = (key: string) => build.find((i) => i.key === key)?.href;
  assert.equal(href('roadmap_set'), '/build/roadmap?project_id=412&view=quarters&from=home&step=roadmap_set');
  assert.equal(href('mvp_shipped'), '/build/roadmap?project_id=412&view=quarters&from=home&step=mvp_shipped');
  assert.equal(href('key_role_filled'), '/build/team', 'rows that open other pages are unchanged');
  const launch = buildLifecycleChecklist('launch', SIGNALS, {}, 412);
  assert.equal(launch.find((i) => i.key === 'launch_checklist')?.href, '/build/roadmap?project_id=412&view=quarters&from=home&step=launch_checklist');
});

test('"Add 3 quarterly OKRs" opens By quarter and says it came from Home\'s checklist', () => {
  // Mutation checked: ROADMAP_OKRS_ROUTE put back to '/build/roadmap' → both rows' routes differ.
  assert.equal(ROADMAP_OKRS_ROUTE, '/build/roadmap?view=quarters&from=home&step=okrs');
  for (const role of ['newFounder', 'existingFounder'] as const) {
    const row = CATALOG[role].find((i) => i.key.endsWith('.okrs'));
    assert.equal(row?.route, ROADMAP_OKRS_ROUTE, role);
  }
  const bare = Object.values(CATALOG).flat().filter((i) => i.route === '/build/roadmap');
  assert.deepEqual(bare, [], 'no row opens the bare page');
});
