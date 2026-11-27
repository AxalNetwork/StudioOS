/**
 * D594 — the archetype's locked state, read once for the card and the page.
 *
 * The archetype reads (`GET /api/best-fit/me`, `GET /api/assessment/results/me`)
 * answer `archetype_access: { locked: true, required_plan: { licence, tier,
 * price_label } }` for an account whose licence has no paid plan, and then
 * carry no archetype at all. Either reply saying locked is enough: the server
 * has already withheld the archetype from both.
 *
 * The plan is named from `required_plan.tier`, never from a literal, so a
 * change to the tiers in `services/archetypeEntitlement.ts` reaches the line.
 */

/** The `required_plan` of the first reply that says locked, `{}` if it names none, or null. */
export function archetypeLock(...replies) {
  for (const r of replies) {
    const access = r?.archetype_access;
    if (access && access.locked === true) {
      return access.required_plan && typeof access.required_plan === 'object' ? access.required_plan : {};
    }
  }
  return null;
}

/**
 * The plan's name as the Worker sends it ("Validate + Build", D683), else the
 * tier capitalised ("Professional" from `professional`); null when the reply
 * named neither.
 */
export function lockedPlanName(plan) {
  const name = typeof plan?.name === 'string' ? plan.name.trim() : '';
  if (name) return name;
  const tier = typeof plan?.tier === 'string' ? plan.tier.trim() : '';
  if (!tier) return null;
  return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
}

/** The canvas's one line (board S12). */
export function lockedLine(plan) {
  const name = lockedPlanName(plan);
  return name
    ? `Your archetype is part of the ${name} plan. Your answers are kept.`
    : 'Your archetype is part of a paid plan. Your answers are kept.';
}
