/**
 * D576 (#1189) — a member's Week 1 plan on the page. The Worker owns the
 * rules (`services/week1Plan.ts`) and sends the plan with `/spinout-lab/state`
 * (`week1_plan`, `week1_plan_unreadable`); this file only orders the checklist
 * by it and says why. No ordering is written here.
 */

/**
 * The Week 1 checklist rows in the plan's order. A row sits where its first
 * key sits in the plan; rows the plan does not name keep their catalog order
 * after the rest. With no plan, the rows are returned as they are.
 */
export function orderDeliverables(deliverables, plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : null;
  if (!steps) return deliverables;
  const at = (d) => {
    const idx = d.keys.map((k) => steps.indexOf(k)).filter((i) => i >= 0);
    return idx.length ? Math.min(...idx) : Number.MAX_SAFE_INTEGER;
  };
  return deliverables.map((d, i) => ({ d, i, at: at(d) }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((x) => x.d);
}

/** The one line above the Week 1 checklist: what it is ordered for, or why the standard order is shown. */
export function planLine(state) {
  if (state?.week1_plan_unreadable) {
    return { status: 'unreadable', text: 'Unreadable: your Week 1 order could not be read, so the standard order is shown.' };
  }
  const plan = state?.week1_plan;
  if (!plan) {
    return { status: 'not_recorded', text: 'Ordered for: Not recorded. No plan was computed from your application, so the standard order is shown.' };
  }
  return { status: 'recorded', text: `Ordered for: ${plan.label}.`, why: plan.why };
}

/** A Week 1 milestone key as a person reads it (the checklist's own words). */
export const STEP_LABELS = {
  project_created: 'Create startup record',
  customer_interview_logged_1: 'Customer interview 1',
  customer_interview_logged_2: 'Customer interview 2',
  customer_interview_logged_3: 'Customer interview 3',
  customer_interview_logged_4: 'Customer interview 4',
  customer_interview_logged_5: 'Customer interview 5',
  market_sizing_completed: 'Size TAM / SAM with citations',
  profiling_completed: 'Complete skills, values & archetype assessment',
  icp_defined: 'Finalize ICP definition and validation criteria',
  market_research_shared: 'Export or share initial Market Intel research',
};
export const stepLabel = (key) => STEP_LABELS[key] || key;

/** Who wrote a plan, from its `computed_by` ('user:<id>'). */
export function actorLabel(computedBy) {
  const m = /^user:(\d+)$/.exec(String(computedBy || ''));
  return m ? `the member (user ${m[1]})` : String(computedBy || 'Not recorded');
}
